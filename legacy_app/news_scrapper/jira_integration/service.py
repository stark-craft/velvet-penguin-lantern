"""Convert checked TechScout news into a single rich Jira Status Report issue.

Uses Guy X's JiraOps for SSO-backed create/attach/update; no Jira credentials
leave the backend. A request contains 1..30 stories; one issue is created.
"""
from __future__ import annotations

import html
import importlib
import re
import tempfile
import threading
from datetime import date
from pathlib import Path
from urllib.parse import quote

import requests

from core.network_safety import assert_public_http_url
from core.secure_http import tls_verify

JIRA_LOCK = threading.RLock()
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


class JiraNotReady(Exception):
    pass


class JiraCreationFailed(Exception):
    pass


def _safe(value: object) -> str:
    return html.escape(str(value or "").strip(), quote=True)


def build_status_report(articles: list[dict], attachments: dict[int, dict] | None = None) -> str:
    """HTML used by customfield_15302. Indices are stable across uploads."""
    attachments = attachments or {}
    lines = [
        '<h1 dir="auto"><b><span style="color:#000000">TechScout — Selected News</span></b></h1>',
        f'<p><b>{len(articles)} selected news article(s)</b></p>',
    ]
    for index, article in enumerate(articles):
        lines.append(
            f'<h2 dir="auto"><b><span style="color:#000099">'
            f'[{index + 1}] {_safe(article.get("title"))}</span></b></h2>'
        )
        if article.get("summary"):
            # Preserve paragraphs; never treat scraper text as trusted HTML.
            paragraphs = [segment.strip() for segment in str(article["summary"]).splitlines() if segment.strip()]
            for paragraph in paragraphs:
                lines.append(f'<p><span style="color:#000000">{_safe(paragraph)}</span></p>')
        metadata = []
        if article.get("source"):
            metadata.append(f'Source: {_safe(article["source"])}')
        if article.get("date"):
            metadata.append(f'Date: {_safe(article["date"])}')
        if metadata:
            lines.append(f'<p><small>{" · ".join(metadata)}</small></p>')
        if article.get("source_url"):
            # Display article links as text unless they pass the canonical public URL check.
            # These links aren't fetched server-side.
            from urllib.parse import urlsplit
            raw_url = str(article["source_url"]).strip()
            try:
                parsed = urlsplit(raw_url)
                if parsed.scheme.lower() in {"https", "http"} and parsed.netloc and not parsed.username and not parsed.password:
                    lines.append(f'<p><a href="{_safe(raw_url)}">Read original article</a></p>')
            except ValueError:
                pass
        attachment = attachments.get(index)
        if attachment:
            identifier = str(attachment.get("id", ""))
            filename = str(attachment.get("filename", ""))
            if identifier.isdigit() and filename:
                safe_filename = quote(filename, safe="")
                lines.append(
                    f'<p><img src="/secure/attachment/{identifier}/{safe_filename}" '
                    f'alt="{_safe(article.get("title"))}" style="max-width:560px;" /></p>'
                )
    return "\n\n".join(lines)


def _download_image(url: str, destination_dir: str, index: int) -> Path:
    """Fetch a bounded public image. Reject redirects and private/local addresses."""
    checked = assert_public_http_url(url)
    # Preflight hostname validation and no redirects are intentional SSRF defenses.
    with requests.get(
        checked,
        stream=True,
        timeout=(5, 15),
        allow_redirects=False,
        verify=tls_verify("ARTICLE_IMAGE_METADATA"),
    ) as response:
        if response.status_code != 200:
            raise ValueError(f"Image source returned HTTP {response.status_code}.")
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        extension = MIME_EXTENSIONS.get(content_type)
        if not extension:
            raise ValueError("Image content type is not supported.")
        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_IMAGE_BYTES:
            raise ValueError("Image exceeds the 5 MB limit.")
        target = Path(destination_dir) / f"news-{index + 1:02d}{extension}"
        size = 0
        with target.open("wb") as output:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    raise ValueError("Image exceeds the 5 MB limit.")
                output.write(chunk)
        if not size:
            raise ValueError("Image was empty.")
        # Reject obvious HTML or invalid media masquerading as an image.
        signature = target.read_bytes()[:16]
        if content_type == "image/png" and not signature.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Image bytes are not PNG.")
        if content_type == "image/jpeg" and not signature.startswith(b"\xff\xd8\xff"):
            raise ValueError("Image bytes are not JPEG.")
        if content_type == "image/gif" and not signature.startswith((b"GIF87a", b"GIF89a")):
            raise ValueError("Image bytes are not GIF.")
        if content_type == "image/webp" and not (signature.startswith(b"RIFF") and signature[8:12] == b"WEBP"):
            raise ValueError("Image bytes are not WebP.")
        return target


def _load_jira_ops():
    try:
        module = importlib.import_module(
            "news_scrapper.jira_integration.vendor.jira_ops"
        )
        return module.JiraOps
    except (ImportError, AttributeError) as error:
        raise JiraNotReady(
            "Guy X's Jira bundle is not installed on this server."
        ) from error


def _summary(articles: list[dict]) -> str:
    if len(articles) == 1:
        return str(articles[0]["title"]).strip()[:200]
    return f"TechScout: {len(articles)} selected news articles ({date.today().isoformat()})"


def create_news_ticket(articles: list[dict], project: str, issue_type: str = "Task") -> dict:
    """Return issue key/link even if subsequent image operations fail."""
    if not articles or len(articles) > 30:
        raise ValueError("Select between 1 and 30 articles.")
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,19}", project):
        raise JiraNotReady("The Jira project key is invalid.")
    JiraOps = _load_jira_ops()
    warnings: list[str] = []
    attachments: dict[int, dict] = {}

    # CDP uses a shared browser target; operations must not interleave.
    with JIRA_LOCK:
        try:
            jira = JiraOps()
            created = jira.create_ticket(
                project=project,
                summary=_summary(articles),
                issue_type=issue_type,
                description="",
                status_report=build_status_report(articles),
            )
        except Exception as error:
            # Never echo SSO cookies / network details / Jira internal responses.
            raise JiraCreationFailed(
                "Jira ticket creation failed. Check the server's Jira SSO session and project permissions."
            ) from error

        key = str(created.get("key") or "").strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*-\d+", key):
            raise JiraCreationFailed(
                "Jira did not return a valid issue key. Check Jira before retrying."
            )
        url = f"{jira.base_url}/browse/{key}"

        with tempfile.TemporaryDirectory(prefix="techscout-jira-") as directory:
            for index, article in enumerate(articles):
                image_url = str(article.get("image_url") or "").strip()
                if not image_url:
                    continue
                try:
                    local_image = _download_image(image_url, directory, index)
                    info = jira.attach_file_to_jira(key, str(local_image))
                    if not str(info.get("id", "")).isdigit():
                        raise ValueError("Jira did not return an attachment ID.")
                    attachments[index] = info
                except Exception:
                    warnings.append(
                        f"Article {index + 1}: image could not be embedded; the news text was preserved."
                    )

        if attachments:
            try:
                jira.update_ticket(
                    key, "status_report",
                    build_status_report(articles, attachments),
                )
            except Exception:
                warnings.append(
                    "The ticket was created, but Jira did not confirm inline image placement. "
                    "Uploaded images may still be available as attachments."
                )
        return {
            "key": key,
            "url": url,
            "article_count": len(articles),
            "image_count": len(attachments),
            "warnings": warnings,
        }
