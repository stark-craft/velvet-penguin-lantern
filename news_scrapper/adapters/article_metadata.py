"""Secure article image metadata extraction (OpenGraph and JSON-LD)."""

from __future__ import annotations

import json
import os
from urllib.parse import urljoin, urlparse

import requests
from lxml import html

from core.secure_http import tls_verify
from core.network_safety import assert_public_http_url


ENABLED = os.environ.get("ARTICLE_IMAGE_METADATA_ENABLED", "true").lower() in {"1", "true", "yes"}
TIMEOUT = int(os.environ.get("ARTICLE_IMAGE_METADATA_TIMEOUT", "12"))
MAX_BYTES = max(100_000, int(os.environ.get("ARTICLE_IMAGE_METADATA_MAX_BYTES", "2000000")))


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
        current_url = assert_public_http_url(url)
        response = None
        for _ in range(5):
            response = requests.get(
                current_url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; newsScrapper/1.0)"},
                timeout=TIMEOUT,
                verify=tls_verify("ARTICLE_IMAGE_METADATA"),
                allow_redirects=False,
                stream=True,
            )
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location", "")
                if not location:
                    raise RuntimeError("Metadata redirect omitted its destination.")
                current_url = assert_public_http_url(urljoin(current_url, location))
                continue
            response.raise_for_status()
            break
        if response is None:
            raise RuntimeError("Metadata request did not return a response.")
        content_type = str(response.headers.get("content-type", "")).lower()
        if content_type and "html" not in content_type:
            raise RuntimeError("Metadata response was not HTML.")
        body = bytearray()
        for chunk in response.iter_content(chunk_size=64 * 1024):
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise RuntimeError("Metadata response exceeded the safe size limit.")
        tree = html.fromstring(bytes(body), base_url=current_url)
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
            image_url = urljoin(current_url, str(candidate).strip())
            if valid_url(image_url) and not any(term in image_url.lower() for term in ("favicon", "sprite", "placeholder", "1x1")):
                output["top_image"] = image_url
                output["image_metadata_status"] = "success"
                return output
        output["image_metadata_status"] = "no_image_found"
    except Exception as error:
        output["image_metadata_status"] = "failed"
        output["image_metadata_error"] = str(error)[:500]
    return output
