"""Versioned, non-destructive unified-source and shadow-briefing utilities."""

from __future__ import annotations

import hashlib
import json
import argparse
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from core.storage import JsonStore


def canonical_url(value: Any) -> str:
    try:
        parsed = urlsplit(str(value or "").strip())
        host = parsed.netloc.casefold().removeprefix("www.")
        path = (parsed.path or "/").rstrip("/") or "/"
        return urlunsplit((parsed.scheme.casefold() or "https", host, path, "", ""))
    except ValueError:
        return str(value or "").strip()


def source_id(profile: str, site: dict[str, Any]) -> str:
    identity = "|".join(
        [profile, str(site.get("name") or ""), canonical_url(site.get("rss_url") or site.get("url"))]
    )
    return hashlib.sha256(identity.casefold().encode("utf-8")).hexdigest()[:18]


def infer_family(site: dict[str, Any]) -> str:
    text = f"{site.get('name', '')} {site.get('category', '')} {site.get('url', '')}".casefold()
    if any(term in text for term in ("government", ".gov", "ministry", "trai", "meity", "mib")):
        return "public_sector"
    if any(term in text for term in ("research", "ieee", "arxiv", "standard")):
        return "research"
    if any(term in text for term in ("business", "financial", "market", "economics")):
        return "business_press"
    if any(term in text for term in ("broadcast", "media", "cable", "dth", "ott")):
        return "industry_trade"
    return "tech_press"


def normalize_site(site: dict[str, Any], profile: str) -> dict[str, Any]:
    legacy_profile = str(site.get("legacy_profile") or profile).strip().lower()
    if legacy_profile not in {"default", "broadcast"}:
        legacy_profile = profile
    website = str(site.get("url") or "").strip()
    rss = str(site.get("rss_url") or "").strip() or None
    return {
        **site,
        "id": str(site.get("id") or source_id(legacy_profile, site)),
        "url": website,
        "domain": urlsplit(website or rss or "").netloc.casefold().removeprefix("www."),
        "rss_url": rss,
        "enabled": site.get("enabled", True) is not False,
        "allow_deep_scan": bool(site.get("allow_deep_scan", legacy_profile == "broadcast")),
        "verticals": list(dict.fromkeys(site.get("verticals") or ["broadcast" if legacy_profile == "broadcast" else "technology"])),
        "audiences": list(dict.fromkeys(site.get("audiences") or ["all"])),
        "source_family": site.get("source_family") or infer_family(site),
        "keyword_pack": site.get("keyword_pack") or legacy_profile,
        "discovery_mode": site.get("discovery_mode") or ("rss_first" if rss else "website"),
        "legacy_profile": legacy_profile,
    }


def load_sites(path: Path) -> list[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    values = payload.get("sites", []) if isinstance(payload, dict) else payload
    return values if isinstance(values, list) else []


def build_unified_catalog(default_path: Path, broadcast_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    default = [normalize_site(site, "default") for site in load_sites(default_path)]
    broadcast = [normalize_site(site, "broadcast") for site in load_sites(broadcast_path)]
    input_sites = [*default, *broadcast]
    sites: list[dict[str, Any]] = []
    by_entrypoint: dict[str, int] = {}
    duplicate_records = 0
    for site in input_sites:
        entrypoint = canonical_url(site.get("rss_url") or site.get("url"))
        existing_index = by_entrypoint.get(entrypoint) if entrypoint else None
        if existing_index is None:
            if entrypoint:
                by_entrypoint[entrypoint] = len(sites)
            sites.append(site)
            continue

        # A catalog may already contain the old broadcast inventory after the
        # cutover while sites_broadcast.json is retained as a rollback input.
        # Merge that exact entrypoint instead of scheduling it twice.
        duplicate_records += 1
        existing = sites[existing_index]
        existing["enabled"] = bool(existing.get("enabled") or site.get("enabled"))
        existing["allow_deep_scan"] = bool(
            existing.get("allow_deep_scan") or site.get("allow_deep_scan")
        )
        for field in ("verticals", "audiences"):
            existing[field] = list(
                dict.fromkeys([*(existing.get(field) or []), *(site.get(field) or [])])
            )
        if existing.get("legacy_profile") != site.get("legacy_profile"):
            existing["legacy_profile"] = "unified"
            existing["keyword_pack"] = "unified"
    entrypoints: dict[str, list[str]] = {}
    domains: dict[str, list[str]] = {}
    for site in sites:
        entrypoint = canonical_url(site.get("rss_url") or site.get("url"))
        entrypoints.setdefault(entrypoint, []).append(site["id"])
        domains.setdefault(site.get("domain") or "", []).append(site["id"])
    report = {
        "schema_version": 1,
        "input_records": len(input_sites),
        "records": len(sites),
        "enabled": sum(bool(site.get("enabled")) for site in sites),
        "rss_records": sum(bool(site.get("rss_url")) for site in sites),
        "duplicate_entrypoints": {key: ids for key, ids in entrypoints.items() if key and len(ids) > 1},
        "overlapping_domains": {key: ids for key, ids in domains.items() if key and len(ids) > 1},
        "preserves_distinct_source_ids": len({site["id"] for site in sites}) == len(sites),
        "duplicate_records_removed": duplicate_records,
    }
    return {"schema_version": 2, "sites": sites}, report


def write_shadow_catalog(default_path: Path, broadcast_path: Path, runtime_dir: Path) -> dict[str, Any]:
    catalog, report = build_unified_catalog(default_path, broadcast_path)
    root = Path(runtime_dir) / "unified_shadow"
    JsonStore(root / "sites_unified.shadow.json", dict).write(catalog)
    JsonStore(root / "source_collision_report.json", dict).write(report)
    return report


def build_shadow_briefing(
    default_articles: list[dict[str, Any]],
    broadcast_articles: list[dict[str, Any]],
    destination: Path,
    *,
    semantic: bool = False,
) -> dict[str, Any]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    duplicate_count = 0
    for vertical, articles in (("technology", default_articles), ("broadcast", broadcast_articles)):
        for original in articles:
            if not isinstance(original, dict):
                continue
            item = dict(original)
            identity = canonical_url(item.get("canonical_link") or item.get("link") or item.get("url"))
            cluster = str(item.get("cluster_id") or "")
            key = identity or cluster or str(item.get("title") or "").casefold()
            if key in seen:
                duplicate_count += 1
                continue
            seen.add(key)
            item["vertical"] = item.get("vertical") or vertical
            item["audiences"] = item.get("audiences") or ["all"]
            item["legacy_profile"] = item.get("profile") or ("broadcast" if vertical == "broadcast" else "default")
            merged.append(item)
    merged.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    semantic_cluster_count = len(merged)
    if semantic and len(merged) > 1:
        try:
            from news_scrapper.semantic_clustering import MinimalSemanticEngine

            engine = MinimalSemanticEngine(load_summarizer=False)
            clusters = engine.semantic_cluster(merged)
            semantic_items = []
            def importance(item):
                try:
                    return float(
                        item.get("importance_score")
                        or item.get("signal_score")
                        or 0
                    )
                except (TypeError, ValueError):
                    return 0.0
            for cluster in clusters:
                primary = dict(max(cluster, key=importance))
                sources = []
                verticals = set()
                audiences = set()
                for item in cluster:
                    raw_sources = item.get("sources") if isinstance(item.get("sources"), list) else []
                    if raw_sources:
                        sources.extend(raw_sources)
                    else:
                        sources.append({
                            "name": item.get("source") or "Unknown",
                            "link": item.get("link") or item.get("url") or "",
                            "date": item.get("date") or "",
                        })
                    verticals.add(str(item.get("vertical") or "technology"))
                    for audience in item.get("audiences") or ["all"]:
                        audiences.add(str(audience))
                unique_sources = {}
                for source in sources:
                    key = canonical_url(source.get("link") or source.get("url")) or str(source.get("name") or "")
                    unique_sources[key] = source
                primary["sources"] = list(unique_sources.values())
                primary["source_count"] = len(unique_sources)
                primary["verticals"] = sorted(verticals)
                primary["audiences"] = sorted(audiences) or ["all"]
                primary["cluster_id"] = hashlib.sha256(
                    "|".join(sorted(unique_sources)).encode("utf-8")
                ).hexdigest()[:20]
                semantic_items.append(primary)
            merged = semantic_items
            semantic_cluster_count = len(merged)
        except Exception as error:
            print(
                f"[UNIFIED SHADOW] Cross-vertical clustering unavailable; exact dedupe retained: {error}",
                flush=True,
            )
    JsonStore(Path(destination), list).write(merged)
    return {
        "default_count": len(default_articles),
        "broadcast_count": len(broadcast_articles),
        "unified_count": len(merged),
        "duplicates_removed": duplicate_count,
        "semantic_cluster_count": semantic_cluster_count,
        "cross_vertical_clustering": bool(semantic),
        "destination": str(destination),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a non-serving unified source catalog and collision report."
    )
    parser.add_argument("--default", type=Path, required=True)
    parser.add_argument("--broadcast", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    report = write_shadow_catalog(args.default, args.broadcast, args.runtime)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
