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


def build_status_report(
    articles: list[dict],
    attachments: dict[int, dict] | None = None,
) -> str:
    """
    Build JEditor-compatible rich HTML for customfield_15302.

    Formatting follows Guy X's Jira test:
      - Styled H1/H2 headings
      - Clean ordered lists
      - Bordered summary table
      - Embedded Jira attachment images
      - Formatted report details

    The Jira Description field remains completely empty.
    """
    from urllib.parse import urlsplit

    attachments = attachments or {}
    article_count = len(articles)

    def section_heading(title: str) -> str:
        return (
            '<h2 dir="auto">'
            '<b><span style="color:#000099">'
            f'[{_safe(title)}]'
            '</span></b></h2>'
        )

    def original_link(article: dict) -> str:
        raw_url = str(article.get("source_url") or "").strip()

        if not raw_url:
            return "Not available"

        try:
            parsed = urlsplit(raw_url)

            if (
                parsed.scheme.lower() not in {"http", "https"}
                or not parsed.netloc
                or parsed.username
                or parsed.password
            ):
                return "Not available"
        except ValueError:
            return "Not available"

        return (
            f'<a href="{_safe(raw_url)}">'
            'Read original article'
            '</a>'
        )

    # --------------------------------------------------------
    # 1. Main title and background
    # --------------------------------------------------------

    html_parts = [
        '<h1 dir="auto">'
        '<b><span style="color:#000000">'
        'TechScout — Technology Intelligence Report'
        '</span></b>'
        '</h1>',

        section_heading("Background"),

        '<p><span style="color:#000000">'
        'This report contains '
        f'<b>{article_count} selected news '
        f'article{"s" if article_count != 1 else ""}</b> '
        'from the TechScout intelligence platform.'
        '</span></p>',

        '<p><span style="color:#000000">'
        'The following sections consolidate the selected '
        'news, their summaries, source information, '
        'original article links, and available images.'
        '</span></p>',
    ]

    # --------------------------------------------------------
    # 2. Current Status — clean numbered list
    # --------------------------------------------------------

    html_parts.append(section_heading("Current Status"))
    html_parts.append('<ol dir="auto">')

    for article in articles:
        title = _safe(article.get("title") or "Untitled article")

        html_parts.append(
            '<li>'
            '<span style="color:#000000">'
            f'<b>{title}</b>'
            '</span>'
            '</li>'
        )

    html_parts.append('</ol>')

    # --------------------------------------------------------
    # 3. Detailed intelligence — full article summaries
    # --------------------------------------------------------

    html_parts.append(section_heading("Detailed Intelligence"))

    for index, article in enumerate(articles, start=1):
        title = _safe(article.get("title") or "Untitled article")

        html_parts.append(
            '<h3 dir="auto">'
            '<b><span style="color:#000099">'
            f'[{index}] {title}'
            '</span></b>'
            '</h3>'
        )

        summary = str(article.get("summary") or "").strip()

        if summary:
            paragraphs = [
                line.strip()
                for line in summary.splitlines()
                if line.strip()
            ]

            for paragraph in paragraphs:
                html_parts.append(
                    '<p>'
                    '<span style="color:#000000">'
                    f'{_safe(paragraph)}'
                    '</span>'
                    '</p>'
                )
        else:
            html_parts.append(
                '<p><span style="color:#000000">'
                'No summary was provided for this article.'
                '</span></p>'
            )

        source = _safe(article.get("source") or "Not specified")
        published = _safe(article.get("date") or "Not specified")

        html_parts.append(
            '<p>'
            '<span style="color:#000000">'
            f'<b>Source:</b> {source}'
            ' &nbsp; | &nbsp; '
            f'<b>Published:</b> {published}'
            '</span>'
            '</p>'
        )

        html_parts.append(
            '<p>'
            f'<b>Original:</b> {original_link(article)}'
            '</p>'
        )

    # --------------------------------------------------------
    # 4. Artifacts Overview — bordered Jira table
    # --------------------------------------------------------

    html_parts.extend([
        section_heading("Artifacts Overview"),

        '<table border="1" cellpadding="6" '
        'style="border-collapse:collapse;'
        'border-color:#cccccc;width:100%;">',

        '<thead>'
        '<tr style="background-color:#f4f5f7;">'
        '<th style="text-align:left;">No.</th>'
        '<th style="text-align:left;">Article</th>'
        '<th style="text-align:left;">Source</th>'
        '<th style="text-align:left;">Date</th>'
        '<th style="text-align:left;">Reference</th>'
        '</tr>'
        '</thead>',

        '<tbody>',
    ])

    for index, article in enumerate(articles, start=1):
        title = _safe(article.get("title") or "Untitled article")
        source = _safe(article.get("source") or "—")
        published = _safe(article.get("date") or "—")
        reference = original_link(article)

        html_parts.append(
            '<tr>'
            f'<td>{index}</td>'
            f'<td><b>{title}</b></td>'
            f'<td>{source}</td>'
            f'<td>{published}</td>'
            f'<td>{reference}</td>'
            '</tr>'
        )

    html_parts.extend([
        '</tbody>',
        '</table>',
    ])

    # --------------------------------------------------------
    # 5. Visual References — embedded Jira attachments
    # --------------------------------------------------------

    if attachments:
        html_parts.append(section_heading("Visual References"))

        for index, article in enumerate(articles):
            attachment = attachments.get(index)

            if not attachment:
                continue

            attachment_id = str(attachment.get("id") or "").strip()
            filename = str(attachment.get("filename") or "").strip()

            if not attachment_id.isdigit() or not filename:
                continue

            safe_filename = quote(filename, safe="")
            title = _safe(article.get("title") or "Article image")

            html_parts.append(
                '<p>'
                f'<b>Article {index + 1}: {title}</b>'
                '</p>'
            )

            html_parts.append(
                '<p>'
                f'<img src="/secure/attachment/'
                f'{attachment_id}/{safe_filename}" '
                f'alt="{title}" '
                'style="max-width:560px;'
                'border:1px solid #dfe1e6;'
                'border-radius:4px;" />'
                '</p>'
            )

    # --------------------------------------------------------
    # 6. Report details — styled preformatted block
    # --------------------------------------------------------

    html_parts.append(section_heading("Report Details"))

    source_count = len({
        str(article.get("source") or "").strip()
        for article in articles
        if str(article.get("source") or "").strip()
    })

    report_details = (
        "Platform: TechScout\n"
        f"Selected articles: {article_count}\n"
        f"Distinct sources: {source_count}\n"
        f"Embedded images: {len(attachments)}\n"
        "Report destination: Jira Status Report"
    )

    html_parts.append(
        '<pre style="background:#f4f5f7;'
        'padding:10px;'
        'border-radius:4px;'
        'font-family:monospace;'
        'color:#172b4d;">'
        f'{_safe(report_details)}'
        '</pre>'
    )

    return "\n\n".join(html_parts)


def build_article_status_report(
    article: dict,
    attachments: dict[int, dict] | None = None,
) -> str:
    """One standalone, escaped Tech Sensing report in Jira's JEditor field.

    The issue description intentionally stays empty. Attachments use the
    existing JiraOps upload path; never embed arbitrary remote image URLs.
    """
    from urllib.parse import urlsplit

    def original_url(value: object) -> str:
        value = str(value or "").strip()
        try:
            parsed = urlsplit(value)
            if parsed.scheme.lower() in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
                return value
        except ValueError:
            pass
        return ""

    facts = article.get("key_facts") or []
    if not isinstance(facts, list) or len(facts) != 3 or not all(
        isinstance(fact, str) and 12 <= len(fact.strip()) <= 1200 for fact in facts
    ):
        raise ValueError("Exactly three factual Key Facts are required.")

    title = _safe(article.get("title"))
    category = _safe(article.get("category") or "Technology")
    insight = str(article.get("insight") or "").strip()
    if not 60 <= len(insight.split()) <= 100:
        raise ValueError("Our Insights must contain 60–100 words.")

    parts = [
        '<h1 dir="auto"><b><span style="font-size:16pt;color:#172b4d">'
        '[Tech Sensing]</span></b></h1>',
        f'<p><b>{title}</b></p>',
        '<h2 dir="auto"><b><span style="font-size:14pt;color:#172b4d">'
        f'Category: {category}</span></b></h2>',
        '<p><b>Key Facts</b></p>',
        '<ul dir="auto">',
    ]
    for fact in facts:
        parts.append(f'<li>{_safe(fact)}</li>')
    parts.extend(['</ul>', '<p><b>Original Sources</b></p>', '<ul dir="auto">'])

    sources = article.get("sources") or []
    added = 0
    seen = set()
    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, dict):
            continue
        url = original_url(source.get("url") or source.get("link"))
        if not url or url in seen:
            continue
        seen.add(url)
        label = _safe(source.get("name") or source.get("publisher") or "Original article")
        date_label = _safe(source.get("date") or article.get("date"))
        parts.append(
            f'<li>{label}'
            f'{" (" + date_label + ")" if date_label else ""}: '
            f'<a href="{_safe(url)}">{_safe(url)}</a></li>'
        )
        added += 1
    if not added:
        url = original_url(article.get("source_url"))
        if url:
            parts.append(
                '<li>'
                f'{_safe(article.get("source") or "Original article")}: '
                f'<a href="{_safe(url)}">{_safe(url)}</a></li>'
            )
        else:
            parts.append('<li>Original source link not available</li>')
    parts.extend([
        '</ul>',
        '<p><b>Our Insights</b></p>',
        f'<p>{_safe(insight)}</p>',
    ])

    attachment = (attachments or {}).get(0)
    if attachment:
        attachment_id = str(attachment.get("id") or "")
        filename = str(attachment.get("filename") or "")
        if attachment_id.isdigit() and filename:
            safe_filename = quote(filename, safe="")
            caption = _safe(article.get("image_caption") or article.get("title") or "")
            parts.append(
                '<p style="text-align:center">'
                f'<img src="/secure/attachment/{attachment_id}/{safe_filename}" '
                f'alt="{caption}" style="display:block;margin:0 auto;'
                'max-width:560px;max-height:400px;" />'
                '</p>'
                f'<p style="text-align:center"><i>{caption}</i></p>'
            )
    return "\n".join(parts)


def _status_report_for(articles: list[dict], attachments=None) -> str:
    if len(articles) == 1 and isinstance(articles[0].get("key_facts"), list):
        return build_article_status_report(articles[0], attachments)
    return build_status_report(articles, attachments)


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


def _authenticated_jira_username(jira) -> str:
    """Get the user authenticated in this Jira CDP session."""
    response = jira._make_request(
        "GET",
        f"{jira.base_url}/rest/api/2/myself",
    )
    if not response.ok:
        raise JiraNotReady(
            "Cannot identify the authenticated Jira user. "
            f"Jira returned HTTP {response.status_code}."
        )

    account = response.json()
    if not isinstance(account, dict):
        raise JiraNotReady("Jira returned invalid account information.")

    username = str(account.get("name") or "").strip()
    if not username or account.get("active") is False:
        raise JiraNotReady(
            "No active Jira username was found in the SSO session."
        )
    return username


def _summary(articles: list[dict]) -> str:
    if len(articles) == 1:
        article = articles[0]
        if isinstance(article.get("key_facts"), list):
            original = str(article.get("original_title") or article.get("title") or "").strip()
            return ("[Tech Sensing] " + original)[:255]
        return str(article["title"]).strip()[:200]
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
            # Resolve the currently authenticated Jira account.
            jira_username = _authenticated_jira_username(jira)
            created = jira.create_ticket(
                project=project,
                summary=_summary(articles),
                issue_type=issue_type,
                description="",
                assignee=jira_username,
                status_report=_status_report_for(articles),
            )
        except Exception as error:
            import traceback

            print("\n========== JIRA CREATION ERROR ==========", flush=True)
            traceback.print_exc()
            print("=========================================\n", flush=True)
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
                    _status_report_for(articles, attachments),
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
