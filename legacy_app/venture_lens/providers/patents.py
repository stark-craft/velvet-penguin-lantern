"""Optional EPO OPS patent provider.

The provider remains completely dormant without explicit OAuth credentials.
Network and XML failures are raised to the discovery service, which retains the
last successful patent cache instead of publishing an empty replacement.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET

import requests


EPO_TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken"
EPO_SEARCH_URL = "https://ops.epo.org/3.2/rest-services/published-data/search"


def configured() -> bool:
    return bool(
        os.environ.get("EPO_OPS_CLIENT_ID", "").strip()
        and os.environ.get("EPO_OPS_CLIENT_SECRET", "").strip()
    )


def _clean(value: object, limit: int = 800) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _token() -> str:
    response = requests.post(
        EPO_TOKEN_URL,
        auth=(
            os.environ.get("EPO_OPS_CLIENT_ID", "").strip(),
            os.environ.get("EPO_OPS_CLIENT_SECRET", "").strip(),
        ),
        data={"grant_type": "client_credentials"},
        timeout=20,
    )
    response.raise_for_status()
    return str(response.json().get("access_token") or "")


def fetch_patents(limit: int = 20) -> list[dict]:
    if not configured():
        return []
    token = _token()
    if not token:
        raise RuntimeError("EPO OPS did not return an access token.")
    response = requests.get(
        EPO_SEARCH_URL,
        params={"q": 'ta="artificial intelligence" OR ta="machine learning"'},
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/xml",
            "Range": f"1-{max(1, min(int(limit or 20), 100))}",
        },
        timeout=35,
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)
    patents: list[dict] = []
    for result in root.findall(".//{*}search-result/{*}exchange-documents/{*}exchange-document"):
        country = result.attrib.get("country", "")
        number = result.attrib.get("doc-number", "")
        kind = result.attrib.get("kind", "")
        identifier = "".join((country, number, kind))
        title = _clean(" ".join(node.text or "" for node in result.findall(".//{*}invention-title")), 400)
        abstract = _clean(" ".join(node.text or "" for node in result.findall(".//{*}abstract//{*}p")), 1400)
        publication_date = _clean(next((node.text for node in result.findall(".//{*}publication-reference//{*}date") if node.text), ""), 16)
        if not identifier or not title:
            continue
        patents.append({
            "id": identifier,
            "title": title,
            "summary": abstract,
            "url": f"https://worldwide.espacenet.com/patent/search?q=pn%3D{identifier}",
            "source": "EPO OPS",
            "published_at": publication_date,
            "updated_at": publication_date,
            "category": "Artificial intelligence patents",
            "family_count": 0,
            "starter_snapshot": False,
        })
    return patents
