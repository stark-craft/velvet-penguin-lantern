"""arXiv Atom provider for fresh research-paper metadata."""

from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET

import requests


ARXIV_API_URL = "https://export.arxiv.org/api/query"
ATOM = {"atom": "http://www.w3.org/2005/Atom"}


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fetch_papers(query: str, category: str, limit: int = 10) -> list[dict]:
    response = None
    for attempt in range(2):
        try:
            response = requests.get(
                ARXIV_API_URL,
                params={
                    "search_query": query,
                    "start": 0,
                    "max_results": max(1, min(limit, 10)),
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                },
                headers={"User-Agent": "Sense-AI-Venture-Lens/1.0 (internal research browser)"},
                timeout=45,
            )
            response.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 1:
                raise
            time.sleep(2)
    if response is None:
        return []
    root = ET.fromstring(response.text)

    papers = []
    for entry in root.findall("atom:entry", ATOM):
        raw_id = _clean(entry.findtext("atom:id", "", ATOM))
        paper_id = raw_id.rsplit("/", 1)[-1]
        links = {
            node.attrib.get("rel", ""): node.attrib.get("href", "")
            for node in entry.findall("atom:link", ATOM)
        }
        authors = [
            _clean(author.findtext("atom:name", "", ATOM))
            for author in entry.findall("atom:author", ATOM)
        ]
        papers.append(
            {
                "id": paper_id,
                "title": _clean(entry.findtext("atom:title", "", ATOM)),
                "summary": _clean(entry.findtext("atom:summary", "", ATOM)),
                "url": links.get("alternate") or raw_id,
                "pdf_url": next(
                    (
                        node.attrib.get("href", "")
                        for node in entry.findall("atom:link", ATOM)
                        if node.attrib.get("title") == "pdf"
                    ),
                    "",
                ),
                "authors": [author for author in authors if author][:6],
                "published_at": _clean(
                    entry.findtext("atom:published", "", ATOM)
                )[:10],
                "updated_at": _clean(entry.findtext("atom:updated", "", ATOM))[:10],
                "category": category,
                "starter_snapshot": False,
            }
        )
    return papers
