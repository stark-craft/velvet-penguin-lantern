"""Atomic source-file mutations for the local JSON deployment."""

from __future__ import annotations

import ipaddress
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Iterable, Mapping, Optional
from urllib.parse import urlsplit

from signalroom.config import Settings
from signalroom.models import ProfileId
from signalroom.profiles import ProfileRegistry, SiteConfig, SitesFile


_WRITE_LOCK = threading.RLock()


class SourceAlreadyExistsError(ValueError):
    pass


def source_slug(name: str) -> str:
    """Return a stable, human-readable source identifier."""

    value = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    value = value[:100].rstrip("-")
    if len(value) < 2:
        raise ValueError("source name must produce an identifier of at least two characters")
    return value


def _allowed_domain(url: str) -> tuple[str, ...]:
    parsed = urlsplit(url)
    if parsed.scheme.casefold() not in {"http", "https"}:
        raise ValueError("source URL must use http or https")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("source URL must not contain credentials")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("source URL contains an invalid port") from exc
    if port is not None and port not in {80, 443}:
        raise ValueError("source URL port must be 80 or 443")

    raw_hostname = parsed.hostname or ""
    try:
        hostname = raw_hostname.casefold().strip(".").encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("source URL contains an invalid hostname") from exc
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError("source URL must not use a literal IP address")

    blocked_names = {"localhost", "local", "internal"}
    blocked_suffixes = (".localhost", ".local", ".internal")
    if hostname in blocked_names or hostname.endswith(blocked_suffixes):
        raise ValueError("source URL must not use a local or internal hostname")
    if not hostname or "." not in hostname:
        raise ValueError("source URL must contain a valid public hostname")
    return (hostname,)


def _write_sites(path: Path, sites: Iterable[SiteConfig]) -> None:
    """Validate the complete document, fsync it, then replace it atomically."""

    document = SitesFile(schema_version=1, sites=tuple(sites))
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(document.model_dump(mode="json"), handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def create_source(
    settings: Settings,
    profile: ProfileId,
    values: Mapping[str, object],
) -> tuple[SiteConfig, ProfileRegistry]:
    with _WRITE_LOCK:
        registry = ProfileRegistry.from_settings(settings)
        loaded = registry.get(profile)
        identifier = source_slug(str(values["name"]))
        if any(site.id == identifier for site in loaded.sites):
            raise SourceAlreadyExistsError(f"source already exists: {identifier}")
        url = str(values["url"])
        created = SiteConfig.model_validate(
            {
                "id": identifier,
                "name": values["name"],
                "enabled": values["enabled"],
                "url": url,
                "category": values["category"],
                "region": values["region"],
                "timezone": values["timezone"],
                "allowed_domains": _allowed_domain(url),
                "max_links": values["max_links"],
                "allow_deep_scan": values["allow_deep_scan"],
                "manual_deep_scan_candidate": values[
                    "manual_deep_scan_candidate"
                ],
            }
        )
        _write_sites(loaded.sources_path, (*loaded.sites, created))
        return created, ProfileRegistry.from_settings(settings)


def update_source(
    settings: Settings,
    profile: ProfileId,
    source_id: str,
    values: Mapping[str, object],
) -> tuple[Optional[SiteConfig], ProfileRegistry]:
    with _WRITE_LOCK:
        registry = ProfileRegistry.from_settings(settings)
        loaded = registry.get(profile)
        existing = next((site for site in loaded.sites if site.id == source_id), None)
        if existing is None:
            return None, registry

        url = str(values["url"])
        existing_urls = {
            str(candidate): field
            for field, candidate in (
                ("rss_url", existing.rss_url),
                ("homepage", existing.homepage),
                ("url", existing.url),
            )
            if candidate is not None
        }
        data = existing.model_dump(mode="json")
        data.update(
            {
                "name": values["name"],
                "enabled": values["enabled"],
                "category": values["category"],
                "region": values["region"],
                "timezone": values["timezone"],
                "max_links": values["max_links"],
                "allow_deep_scan": values["allow_deep_scan"],
                "manual_deep_scan_candidate": values[
                    "manual_deep_scan_candidate"
                ],
            }
        )
        if url not in existing_urls:
            data.update(
                {
                    "rss_url": None,
                    "homepage": None,
                    "url": url,
                    "allowed_domains": _allowed_domain(url),
                }
            )
        updated = SiteConfig.model_validate(data)
        sites = tuple(updated if site.id == source_id else site for site in loaded.sites)
        _write_sites(loaded.sources_path, sites)
        return updated, ProfileRegistry.from_settings(settings)
