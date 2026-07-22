"""Secure article image metadata extraction (OpenGraph and JSON-LD)."""

from __future__ import annotations

import json
import os
from urllib.parse import urljoin, urlparse

import requests
from lxml import html

from secure_http import tls_verify


ENABLED = os.environ.get("ARTICLE_IMAGE_METADATA_ENABLED", "true").lower() in {"1", "true", "yes"}
TIMEOUT = int(os.environ.get("ARTICLE_IMAGE_METADATA_TIMEOUT", "12"))


def valid_url(value: str) -> bool:
    parsed = urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def jsonld_images(value, output):
    if isinstance(value, list):
        for item in value:
            jsonld_images(item, output)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in {"image", "thumbnail", "thumbnailurl"}:
                if isinstance(item, str):
                    output.append(item)
                else:
                    jsonld_images(item, output)
            else:
                jsonld_images(item, output)


def enrich_article_image_metadata(item):
    output = dict(item or {})
    if not ENABLED:
        output["image_metadata_status"] = "disabled"
        return output
    if valid_url(output.get("top_image") or output.get("image")):
        output["image_metadata_status"] = "already_present"
        return output
    url = str(output.get("link") or output.get("canonical_link") or "").strip()
    if not valid_url(url):
        output["image_metadata_status"] = "skipped_no_valid_url"
        return output
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; newsScrapper/1.0)"},
            timeout=TIMEOUT,
            verify=tls_verify("ARTICLE_IMAGE_METADATA"),
        )
        response.raise_for_status()
        tree = html.fromstring(response.content, base_url=response.url)
        candidates = tree.xpath(
            "//meta[@property='og:image' or @property='og:image:secure_url' "
            "or @name='twitter:image' or @name='twitter:image:src']/@content"
        )
        for raw in tree.xpath("//script[@type='application/ld+json']/text()"):
            try:
                jsonld_images(json.loads(raw), candidates)
            except (TypeError, ValueError):
                continue
        for candidate in candidates:
            image_url = urljoin(response.url, str(candidate).strip())
            if valid_url(image_url) and not any(term in image_url.lower() for term in ("favicon", "sprite", "placeholder", "1x1")):
                output["top_image"] = image_url
                output["image_metadata_status"] = "success"
                return output
        output["image_metadata_status"] = "no_image_found"
    except Exception as error:
        output["image_metadata_status"] = "failed"
        output["image_metadata_error"] = str(error)[:500]
    return output
