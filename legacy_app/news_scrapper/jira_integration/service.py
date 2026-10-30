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
    """Samsung Tech Sensing / Jira JEditor format; safely escaped article data.

    Each published ticket is a standalone article. An attachment's index is
    still 0, preserving the existing create -> attach -> update workflow.
    """
    from datetime import datetime
    from urllib.parse import urlsplit

    attachments = attachments or {}
    parts: list[str] = []

    def p(value: str) -> str:
        return f'<p dir="auto" style="margin-bottom:11px"><span style="font-size:14pt">{value}</span></p>'

    def source_link(url: str, name: str, date: str) -> str:
        try:
            split = urlsplit(url)
            if split.scheme.lower() not in {"http", "https"} or not split.hostname or split.username or split.password:
                return ""
        except ValueError:
            return ""
        date_text = str(date or "").strip()[:10].replace("-", ".").replace("/", ".")
        return f'<a href="{_safe(url)}">{_safe(name or split.hostname)}{f" ({_safe(date_text)})" if date_text else ""}</a>'

    for index, article in enumerate(articles):
        title = str(article.get("title") or "Untitled article").strip()
        if not title.lower().startswith("[tech sensing]"):
            title = "[Tech Sensing] " + title
        parts.append(
            '<h1 dir="auto"><b style="font-size:16pt; font-weight:bold">'
            f'{_safe(title)}</b></h1>'
        )
        parts.append('<ul dir="auto">')
        raw_categories = article.get("category") or article.get("tags") or "Technology"
        if isinstance(raw_categories, (list, tuple)):
            categories = " / ".join(str(x.get("name", "") if isinstance(x, dict) else x).strip() for x in raw_categories if x)
        else:
            categories = str(raw_categories)
        parts.append(
            '<li style="margin-bottom:11px">'
            f'<span style="font-size:14pt"><b>Category:</b> <b>{_safe(categories)}</b></span></li>'
        )

        facts = article.get("key_facts")
        if not isinstance(facts, list) or len(facts) != 3:
            # Compatibility with older existing callers, not AI-created facts.
            facts = [str(article.get("summary") or "").strip()]
        parts.append('<li style="margin-bottom:11px">')
        parts.append(p('<b>Key facts</b>:'))
        parts.append('<ul>')
        for fact in facts:
            if str(fact or "").strip():
                parts.append('<li style="margin-bottom:11px">' + p(_safe(fact)) + '</li>')
        parts.append('</ul></li>')

        original_sources = article.get("sources")
        if not isinstance(original_sources, list):
            original_sources = []
        rendered_sources = []
        seen = set()
        for source in original_sources:
            if not isinstance(source, dict):
                continue
            url = str(source.get("url") or source.get("link") or "")
            if url in seen:
                continue
            link = source_link(url, source.get("name") or source.get("title") or "", source.get("date") or article.get("date") or "")
            if link:
                seen.add(url)
                rendered_sources.append(link)
        legacy_url = str(article.get("source_url") or "")
        if legacy_url and legacy_url not in seen:
            legacy = source_link(legacy_url, article.get("source") or "", article.get("date") or "")
            if legacy:
                rendered_sources.append(legacy)
        parts.append('<li style="margin-bottom:11px">' + p('<b>Source: </b>' + (", ".join(rendered_sources) or "Not provided")) + '</li>')

        insight = str(article.get("insight") or "").strip()
        parts.append('<li style="margin-bottom:11px">' + p('<b>Our Insights:</b>'))
        parts.append('<ul>')
        if insight:
            parts.append('<li style="margin-bottom:11px">' + p(_safe(insight)) + '</li>')
        parts.append('</ul></li></ul>')

        attachment = attachments.get(index)
        if attachment:
            identifier = str(attachment.get("id") or "")
            filename = str(attachment.get("filename") or "")
            if identifier.isdigit() and filename:
                caption = article.get("image_caption") or title.removeprefix("[Tech Sensing] ").strip()
                parts.append(
                    '<p dir="auto" style="margin-bottom:11px;text-align:center">'
                    f'[{_safe(caption)}]</p>'
                )
                parts.append(
                    '<p dir="auto" style="margin-bottom:11px;text-align:center">'
                    '<span class="image-wrap">'
                    f'<img src="/secure/attachment/{identifier}/{quote(filename, safe="")}" '
                    f'alt="{_safe(filename)}" '
                    'style="max-width:560px;border:0px solid black" />'
                    '</span></p>'
                )
        if index + 1 < len(articles):
            parts.append('<hr/>')
    return "\n".join(parts)


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
        title = str(articles[0]["title"]).strip()
        return (title if title.lower().startswith("[tech sensing]") else f"[Tech Sensing] {title}")[:255]
    return f"[Tech Sensing] {len(articles)} selected articles ({date.today().isoformat()})"


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
