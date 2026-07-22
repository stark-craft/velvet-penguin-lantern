"""Profile-aware feed and HTML news crawler.

The spider is intentionally an extraction worker, not an ML pipeline. It emits
plain JSON-compatible discovery/article dictionaries for the service runner.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

import scrapy

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python 3.9 supplies zoneinfo.
    ZoneInfo = None  # type: ignore[assignment]

from ..extractors import (
    clean_text,
    content_hash,
    extract_authors,
    extract_body,
    extract_canonical_url,
    extract_excerpt,
    extract_feed_date,
    extract_feed_entries,
    extract_feed_excerpt,
    extract_feed_link,
    extract_feed_title,
    extract_lead_image,
    extract_page_dates,
    extract_title,
    parse_datetime,
    redirect_chain,
    utc_now_iso,
)
from ..items import ARTICLE_SCHEMA_VERSION
from ..policies import (
    canonicalize_url,
    is_allowed_publisher_url,
    is_feed_response,
    is_html_response,
    publisher_domains,
    should_skip_article_url,
)


class NewsSpider(scrapy.Spider):
    name = "news_spider"
    MAX_LINKS_PER_LISTING = 80

    def __init__(
        self,
        keyword: str = "",
        from_date: str = "",
        to_date: str = "",
        target_sites: str = "All",
        sites_file: str = "",
        discovery_only: str = "false",
        timezone_name: str = "Asia/Kolkata",
        allow_modified_dates: str = "false",
        profile: str = "",
        profile_id: str = "",
        run_id: str = "",
        match_all: str = "false",
        stats_file: str = "",
        *args: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)

        self.profile = clean_text(profile or profile_id)
        self.run_id = clean_text(run_id)
        self.stats_file = Path(stats_file).expanduser().resolve() if stats_file else None
        if not self.profile:
            raise ValueError("profile is required")
        if not self.run_id:
            raise ValueError("run_id is required")

        self.discovery_only = self._parse_bool(discovery_only, "discovery_only")
        self.allow_modified_dates = self._parse_bool(
            allow_modified_dates, "allow_modified_dates"
        )
        self.match_all = self._parse_bool(match_all, "match_all")

        self.timezone_name = clean_text(timezone_name) or "Asia/Kolkata"
        self.local_timezone = self._validate_timezone(self.timezone_name)
        self.from_date = self._parse_input_date(from_date, "from_date")
        self.to_date = self._parse_input_date(to_date, "to_date")
        if self.from_date and self.to_date and self.from_date > self.to_date:
            raise ValueError("from_date cannot be after to_date")

        self.keywords = self._parse_keywords(keyword)
        if not self.keywords and not self.match_all:
            raise ValueError("keyword cannot be empty unless match_all=true")
        self.target_sites = self._parse_targets(target_sites)
        self.source_diagnostics: Dict[str, Any] = {
            "profile": self.profile,
            "source_files": [],
            "configured": 0,
            "enabled": 0,
            "enabled_with_usable_entrypoints": 0,
            "selected_enabled": 0,
            "usable_entrypoints": 0,
            "usable_entrypoint_urls": 0,
            "entrypoint_kind_counts": {"feed": 0, "auto": 0, "listing": 0},
            "source_entrypoint_kinds": {},
            "enabled_without_usable_entrypoints": 0,
            "sources_without_entrypoint_ids": [],
            "source_ids_selected": [],
            "source_ids_rejected_by_override": [],
            "unmatched_source_overrides": [],
            "initial_requests": 0,
        }
        self.sites = self._load_sites(sites_file)
        self._seen_discoveries: set = set()
        self._sources_attempted: set = set()
        self._sources_responded: set = set()
        self._initial_requests_started = False

        self.logger.info(
            "crawler_initialized",
            extra={
                "event": "crawler_initialized",
                "run_id": self.run_id,
                "profile": self.profile,
                "site_count": len(self.sites),
                "keyword_count": len(self.keywords),
                "discovery_only": self.discovery_only,
            },
        )

    # ------------------------------------------------------------------
    # Strict run/source configuration
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_bool(value: Any, field: str) -> bool:
        if isinstance(value, bool):
            return value
        normalized = clean_text(value).lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
        raise ValueError(f"{field} must be true or false")

    @staticmethod
    def _validate_timezone(value: str):
        if ZoneInfo is None:
            if value.upper() == "UTC":
                from datetime import timezone

                return timezone.utc
            raise ValueError("Named timezones require zoneinfo")
        try:
            return ZoneInfo(value)
        except Exception as exc:
            raise ValueError(f"Unknown timezone: {value}") from exc

    @staticmethod
    def _parse_input_date(value: str, field: str) -> Optional[date]:
        normalized = clean_text(value)
        if not normalized:
            return None
        try:
            return date.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError(f"{field} must use YYYY-MM-DD") from exc

    @staticmethod
    def _parse_keywords(value: str) -> List[str]:
        output: List[str] = []
        seen = set()
        for part in re.split(r"[,;\n]", str(value or "")):
            keyword = clean_text(part)
            key = keyword.casefold()
            if keyword and key not in seen:
                seen.add(key)
                output.append(keyword)
        return output

    @staticmethod
    def _parse_targets(value: str) -> Optional[List[str]]:
        normalized = clean_text(value)
        if not normalized or normalized.casefold() == "all":
            return None
        return [
            clean_text(item).casefold()
            for item in re.split(r"[,;\n]", normalized)
            if clean_text(item)
        ] or None

    @staticmethod
    def _source_enabled(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and value in {0, 1}:
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on", "enabled"}:
                return True
            if normalized in {"false", "0", "no", "off", "disabled"}:
                return False
        raise ValueError("source enabled must be a boolean")

    @staticmethod
    def _source_slug(value: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
        return slug or "source"

    @staticmethod
    def _coerce_values(value: Any, field: str) -> List[str]:
        if value in (None, ""):
            return []
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, list):
            output = []
            for item in value:
                if not isinstance(item, str):
                    raise ValueError(f"{field} entries must be strings")
                if item.strip():
                    output.append(item.strip())
            return output
        raise ValueError(f"{field} must be a string or list of strings")

    def _site_files(self, value: str) -> List[Path]:
        raw = clean_text(value)
        if not raw:
            raise ValueError("sites_file is required")
        if raw.casefold() in {"all", "both"}:
            backend_root = Path(__file__).resolve().parents[3]
            return [
                backend_root / "sites" / "sites.json",
                backend_root / "sites" / "broadcast_sites.json",
            ]
        return [
            Path(part.strip()).expanduser().resolve()
            for part in re.split(r"[,;]", raw)
            if part.strip()
        ]

    def _load_sites(self, sites_file: str) -> List[Dict[str, Any]]:
        configured: List[Dict[str, Any]] = []
        source_ids = set()
        matched_targets = set()
        source_paths = self._site_files(sites_file)
        self.source_diagnostics["source_files"] = [str(path) for path in source_paths]
        for path in source_paths:
            if path.suffix.casefold() != ".json":
                raise ValueError("sites_file must reference JSON")
            if not path.is_file():
                raise ValueError(f"sites_file does not exist: {path}")
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ValueError(f"sites_file is not valid JSON: {path}") from exc
            if isinstance(payload, dict):
                payload = payload.get("sites")
            if not isinstance(payload, list):
                raise ValueError("sites_file must contain a list or a sites list")
            for raw_site in payload:
                if not isinstance(raw_site, dict):
                    raise ValueError("each source must be an object")
                self.source_diagnostics["configured"] += 1
                if not self._source_enabled(raw_site.get("enabled", True)):
                    continue
                self.source_diagnostics["enabled"] += 1
                raw_name = clean_text(
                    raw_site.get("name") or raw_site.get("source") or raw_site.get("title")
                )
                if not raw_name:
                    raise ValueError("enabled source is missing name")
                raw_id = clean_text(raw_site.get("id")) or self._source_slug(raw_name)
                raw_urls = []
                for key in (
                    "rss_url",
                    "feed_url",
                    "feed",
                    "rss",
                    "homepage",
                    "home_url",
                    "base_url",
                    "url",
                ):
                    raw_urls.extend(self._coerce_values(raw_site.get(key), key))
                if not raw_urls:
                    self.source_diagnostics["enabled_without_usable_entrypoints"] += 1
                    self.source_diagnostics["sources_without_entrypoint_ids"].append(raw_id)
                    self.logger.warning(
                        "crawler_source_has_no_supported_url",
                        extra={
                            "event": "crawler_source_has_no_supported_url",
                            "run_id": self.run_id,
                            "profile": self.profile,
                            "source_id": raw_id,
                            "source_file": str(path),
                        },
                    )
                    continue
                site = self._normalize_site(raw_site)
                if site["id"] in source_ids:
                    raise ValueError(f"duplicate source id: {site['id']}")
                source_ids.add(site["id"])
                has_usable_entrypoint = bool(self._entrypoints_for_site(site))
                if has_usable_entrypoint:
                    self.source_diagnostics["enabled_with_usable_entrypoints"] += 1
                else:
                    self.source_diagnostics["enabled_without_usable_entrypoints"] += 1
                    self.source_diagnostics["sources_without_entrypoint_ids"].append(
                        site["id"]
                    )
                selected = not self.target_sites or any(
                    target == site["id"].casefold() or target in site["name"].casefold()
                    for target in self.target_sites
                )
                if selected:
                    configured.append(site)
                    self.source_diagnostics["source_ids_selected"].append(site["id"])
                    if self.target_sites:
                        matched_targets.update(
                            target
                            for target in self.target_sites
                            if target == site["id"].casefold()
                            or target in site["name"].casefold()
                        )
                else:
                    self.source_diagnostics["source_ids_rejected_by_override"].append(
                        site["id"]
                    )
        self.source_diagnostics["selected_enabled"] = len(configured)
        self.source_diagnostics["unmatched_source_overrides"] = sorted(
            set(self.target_sites or ()) - matched_targets
        )
        for site in configured:
            entrypoints = self._entrypoints_for_site(site)
            if entrypoints:
                self.source_diagnostics["usable_entrypoints"] += 1
            kinds = sorted({kind for _url, kind in entrypoints})
            self.source_diagnostics["source_entrypoint_kinds"][site["id"]] = kinds
            self.source_diagnostics["usable_entrypoint_urls"] += len(entrypoints)
            for _url, kind in entrypoints:
                self.source_diagnostics["entrypoint_kind_counts"][kind] += 1
        return configured

    def _normalize_site(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        name = clean_text(raw.get("name") or raw.get("source") or raw.get("title"))
        if not name:
            raise ValueError("enabled source is missing name")
        source_id = clean_text(raw.get("id")) or self._source_slug(name)

        feed_urls: List[str] = []
        for key in ("rss_url", "feed_url", "feed", "rss"):
            feed_urls.extend(self._coerce_values(raw.get(key), key))
        listing_urls: List[str] = []
        for key in ("homepage", "home_url", "base_url"):
            listing_urls.extend(self._coerce_values(raw.get(key), key))
        automatic_urls = self._coerce_values(raw.get("url"), "url")

        def normalized_unique(values: Iterable[str]) -> List[str]:
            output: List[str] = []
            seen = set()
            for candidate in values:
                normalized = canonicalize_url(candidate)
                if not normalized:
                    raise ValueError(f"source {source_id} contains an invalid URL")
                if normalized not in seen:
                    seen.add(normalized)
                    output.append(normalized)
            return output

        feed_urls = normalized_unique(feed_urls)
        listing_urls = normalized_unique(listing_urls)
        automatic_urls = normalized_unique(automatic_urls)
        all_urls = feed_urls + listing_urls + automatic_urls
        if not all_urls:
            raise ValueError(f"source {source_id} has no crawl URL")

        configured_domains = self._coerce_values(
            raw.get("allowed_domains") or raw.get("domains"), "allowed_domains"
        )
        domains = publisher_domains(all_urls, configured_domains)
        source_timezone = clean_text(raw.get("timezone")) or self.timezone_name
        self._validate_timezone(source_timezone)

        return {
            "id": source_id,
            "name": name,
            "category": clean_text(raw.get("category")) or "General",
            "region": clean_text(raw.get("region")) or "Unknown",
            "timezone": source_timezone,
            "feed_urls": feed_urls,
            "listing_urls": listing_urls,
            "automatic_urls": automatic_urls,
            "allowed_domains": sorted(domains),
            "max_links": self._validated_max_links(
                raw.get("max_links", self.MAX_LINKS_PER_LISTING)
            ),
            "allow_deep_scan": self._source_enabled(
                raw.get("allow_deep_scan", True)
            ),
            "manual_deep_scan_candidate": self._source_enabled(
                raw.get("manual_deep_scan_candidate", False)
            ),
            "keywords": self._parse_keywords(
                ",".join(self._coerce_values(raw.get("keywords"), "keywords"))
            ),
        }

    @staticmethod
    def _validated_max_links(value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("source max_links must be an integer") from exc
        if not 1 <= parsed <= 500:
            raise ValueError("source max_links must be between 1 and 500")
        return parsed

    # ------------------------------------------------------------------
    # Requests and routing
    # ------------------------------------------------------------------

    @staticmethod
    def _entrypoints_for_site(site: Dict[str, Any]) -> List[Tuple[str, str]]:
        endpoints: List[Tuple[str, str]] = []
        endpoints.extend((url, "feed") for url in site["feed_urls"])
        endpoints.extend((url, "auto") for url in site["automatic_urls"])
        if not site["feed_urls"] and not site["automatic_urls"] and site["allow_deep_scan"]:
            endpoints.extend((url, "listing") for url in site["listing_urls"])
        return endpoints

    def _iter_initial_requests(self) -> Iterator[scrapy.Request]:
        """Generate entrypoints once for both modern and compatibility APIs."""

        if self._initial_requests_started:
            return
        self._initial_requests_started = True
        self._inc("sites_loaded", len(self.sites))
        for site in self.sites:
            endpoints = self._entrypoints_for_site(site)

            fallback_urls = (
                site["listing_urls"] if site["allow_deep_scan"] else []
            )

            if endpoints:
                self._sources_attempted.add(site["id"])
            else:
                self._inc("sources_without_entrypoints")

            for url, kind in endpoints:
                self._inc("entrypoint_requests")
                self.source_diagnostics["initial_requests"] += 1
                yield scrapy.Request(
                    url,
                    callback=self.parse_entrypoint,
                    errback=self.request_error,
                    dont_filter=True,
                    priority=20 if kind == "feed" else 10,
                    meta={
                        "site": site,
                        "entrypoint_kind": kind,
                        "fallback_urls": (
                            fallback_urls if kind in {"feed", "auto"} else []
                        ),
                        "signalroom_allowed_domains": site["allowed_domains"],
                    },
                )

    async def start(self):
        """Scrapy 2.13+ asynchronous spider-start API."""

        for request in self._iter_initial_requests():
            yield request

    def start_requests(self) -> Iterator[scrapy.Request]:
        """Compatibility API retained for supported older Scrapy releases."""

        yield from self._iter_initial_requests()

    def request_error(self, failure: Any) -> Iterator[scrapy.Request]:
        self._inc("request_errors")
        request = getattr(failure, "request", None)
        self.logger.warning(
            "crawler_request_failed",
            extra={
                "event": "crawler_request_failed",
                "run_id": self.run_id,
                "profile": self.profile,
                "url": getattr(request, "url", "unknown"),
                "error": clean_text(getattr(failure, "value", failure)),
            },
        )
        if request is None or request.meta.get("entrypoint_kind") not in {"feed", "auto"}:
            return
        site = request.meta["site"]
        for url in request.meta.get("fallback_urls", []):
            self._inc("listing_fallback_requests")
            yield scrapy.Request(
                url,
                callback=self.parse_entrypoint,
                errback=self.request_error,
                priority=0,
                meta={
                    "site": site,
                    "entrypoint_kind": "listing",
                    "fallback_urls": [],
                    "signalroom_allowed_domains": site["allowed_domains"],
                },
            )

    def parse_entrypoint(self, response: Any) -> Iterator[Any]:
        site = response.meta["site"]
        if not self._response_stays_with_publisher(response, site):
            return
        self._sources_responded.add(site["id"])
        if is_feed_response(response):
            yield from self.parse_feed(response)
            return
        if not is_html_response(response):
            self._inc("dropped_content_type")
            return

        if response.meta.get("entrypoint_kind") == "feed":
            for url in response.meta.get("fallback_urls", []):
                self._inc("listing_fallback_requests")
                yield scrapy.Request(
                    url,
                    callback=self.parse_entrypoint,
                    errback=self.request_error,
                    priority=0,
                    meta={
                        "site": site,
                        "entrypoint_kind": "listing",
                        "fallback_urls": [],
                        "signalroom_allowed_domains": site["allowed_domains"],
                    },
                )
            return
        yield from self.parse_listing_page(response)

    # ------------------------------------------------------------------
    # Feed discovery
    # ------------------------------------------------------------------

    def parse_feed(self, response: Any) -> Iterator[Any]:
        site = response.meta["site"]
        entries = extract_feed_entries(response)
        self._inc("feed_entries_seen", len(entries))
        if not entries:
            self._inc("feeds_without_entries")
            for url in response.meta.get("fallback_urls", []):
                self._inc("listing_fallback_requests")
                yield scrapy.Request(
                    url,
                    callback=self.parse_entrypoint,
                    errback=self.request_error,
                    priority=0,
                    meta={
                        "site": site,
                        "entrypoint_kind": "listing",
                        "fallback_urls": [],
                        "signalroom_allowed_domains": site["allowed_domains"],
                    },
                )
            return

        for entry in entries:
            title = extract_feed_title(entry)
            if not title:
                self._inc("dropped_missing_title")
                continue
            link = extract_feed_link(entry, response.url)
            if not self._valid_article_url(link, site):
                self._inc("dropped_url_policy")
                continue

            raw_date, date_source, is_modified = extract_feed_date(
                entry, self.allow_modified_dates
            )
            timestamp, precision = parse_datetime(raw_date, site["timezone"])
            if not timestamp:
                # A missing feed date is not proof that an article is old.
                # A full crawl can still recover a publication date from the
                # article page. Discovery-only mode cannot perform that check,
                # so it deliberately retains the strict drop behavior.
                if self.discovery_only:
                    self._inc("dropped_missing_or_invalid_date")
                    continue
                self._inc("feed_entries_pending_article_date")
                date_source = "pending_article"
                precision = "missing"
            elif not self._date_in_range(timestamp):
                self._inc("dropped_out_of_range")
                continue

            excerpt = extract_feed_excerpt(entry)
            matches = self._find_keywords(" ".join((title, excerpt, link)), site)
            if self.discovery_only and not self.match_all and not matches:
                self._inc("dropped_keyword_mismatch")
                continue

            dedupe_key = (site["id"], "RSS", link)
            if dedupe_key in self._seen_discoveries:
                self._inc("dropped_duplicate_discovery")
                continue
            self._seen_discoveries.add(dedupe_key)

            discovery = self._discovery_record(
                site=site,
                url=link,
                title=title,
                title_source="feed_title",
                excerpt=excerpt,
                published_at=None if is_modified or not timestamp else timestamp,
                modified_at=timestamp if is_modified and timestamp else None,
                raw_date=raw_date,
                date_source=date_source,
                date_precision=precision,
                keyword_matches=matches,
                method="RSS",
            )
            self._inc("discoveries_output")
            if self.discovery_only:
                yield discovery
                continue
            self._inc("article_requests")
            yield scrapy.Request(
                link,
                callback=self.parse_article_page,
                errback=self.request_error,
                dont_filter=True,
                meta={
                    "site": site,
                    "discovery": discovery,
                    "signalroom_allowed_domains": site["allowed_domains"],
                },
            )

    # ------------------------------------------------------------------
    # HTML discovery and article extraction
    # ------------------------------------------------------------------

    def parse_listing_page(self, response: Any) -> Iterator[Any]:
        site = response.meta["site"]
        emitted = 0
        for anchor in response.css("a[href]"):
            url = canonicalize_url(anchor.attrib.get("href", ""), response.url)
            if not self._valid_article_url(url, site):
                continue
            anchor_title = clean_text(anchor.xpath("string(.)").get()) or clean_text(
                anchor.attrib.get("title", "")
            )
            matches = self._find_keywords(" ".join((anchor_title, url)), site)
            if self.discovery_only and not self.match_all and not matches:
                continue
            dedupe_key = (site["id"], "HTML", url)
            if dedupe_key in self._seen_discoveries:
                self._inc("dropped_duplicate_discovery")
                continue
            self._seen_discoveries.add(dedupe_key)

            discovery = self._discovery_record(
                site=site,
                url=url,
                title=anchor_title,
                title_source="listing_anchor" if anchor_title else "missing",
                excerpt="",
                published_at=None,
                modified_at=None,
                raw_date="",
                date_source="pending_article",
                date_precision="missing",
                keyword_matches=matches,
                method="HTML",
            )
            self._inc("discoveries_output")
            if self.discovery_only:
                yield discovery
            else:
                self._inc("article_requests")
                yield scrapy.Request(
                    url,
                    callback=self.parse_article_page,
                    errback=self.request_error,
                    dont_filter=True,
                    meta={
                        "site": site,
                        "discovery": discovery,
                        "signalroom_allowed_domains": site["allowed_domains"],
                    },
                )
            emitted += 1
            if emitted >= site["max_links"]:
                break
        self._inc("listing_links_matched", emitted)

    def parse_article_page(self, response: Any) -> Iterator[Dict[str, Any]]:
        site = response.meta["site"]
        discovery = dict(response.meta["discovery"])
        if not self._response_stays_with_publisher(response, site):
            return
        if not is_html_response(response):
            self._inc("dropped_content_type")
            return

        page_title, title_source = extract_title(response)
        title = page_title or discovery.get("title", "")
        if not page_title and title:
            title_source = discovery.get("title_source", "discovery_title")
        if not title:
            self._inc("dropped_missing_title")
            return

        body_text, extraction = extract_body(response)
        excerpt = extract_excerpt(response, body_text) or discovery.get("excerpt", "")
        dates = extract_page_dates(
            response,
            source_timezone=site["timezone"],
            allow_modified=self.allow_modified_dates,
        )
        published_at = dates["published_at"] or discovery.get("published_at")
        modified_at = dates["modified_at"] or discovery.get("modified_at")
        effective_timestamp = published_at or modified_at
        if not effective_timestamp:
            self._inc("dropped_missing_or_invalid_date")
            return
        if not self._date_in_range(str(effective_timestamp)):
            self._inc("dropped_out_of_range")
            return

        modified_date_source = ""
        if dates["published_at"]:
            raw_date = dates["raw_date"] or ""
            date_source = dates["date_source"] or "missing"
            date_precision = dates["date_precision"] or "missing"
        elif discovery.get("published_at"):
            raw_date = discovery.get("raw_date", "")
            date_source = discovery.get("date_source", "missing")
            date_precision = discovery.get("date_precision", "missing")
            if dates["modified_at"]:
                modified_date_source = dates["date_source"] or ""
        elif dates["modified_at"]:
            raw_date = dates["raw_date"] or ""
            date_source = dates["date_source"] or "missing"
            date_precision = dates["date_precision"] or "missing"
        else:
            raw_date = discovery.get("raw_date", "")
            date_source = discovery.get("date_source", "missing")
            date_precision = discovery.get("date_precision", "missing")

        keyword_matches = self._find_keywords(
            " ".join((title, excerpt, body_text, response.url)), site
        )
        if not self.match_all and not keyword_matches:
            self._inc("dropped_keyword_mismatch")
            return

        canonical_url = extract_canonical_url(response, site["allowed_domains"])
        authors = extract_authors(response)
        extraction.update(
            {
                "has_real_title": bool(page_title or discovery.get("title")),
                "has_published_at": bool(effective_timestamp),
            }
        )
        record: Dict[str, Any] = {
            "schema_version": ARTICLE_SCHEMA_VERSION,
            "record_type": "article",
            "run_id": self.run_id,
            "profile": self.profile,
            "source_id": site["id"],
            "source": site["name"],
            "source_category": site["category"],
            "source_region": site["region"],
            "source_timezone": site["timezone"],
            "requested_url": discovery["requested_url"],
            "final_url": canonicalize_url(response.url),
            "canonical_url": canonical_url,
            "title": title,
            "title_source": title_source,
            "excerpt": excerpt,
            "published_at": published_at,
            "modified_at": modified_at,
            "raw_date": raw_date,
            "date_source": date_source,
            "date_precision": date_precision,
            "keyword_matches": keyword_matches,
            "keywords_found": keyword_matches,
            "discovery_method": discovery["discovery_method"],
            "discovered_at": discovery["discovered_at"],
            "lead_image_url": extract_lead_image(response),
            "authors": authors,
            "author": ", ".join(authors),
            "body_text": body_text,
            "content_hash": content_hash(body_text),
            "fetched_at": utc_now_iso(),
            "http_status": int(response.status),
            "redirect_chain": redirect_chain(response),
            "extraction": extraction,
            "extraction_quality": extraction["status"],
            "quality": extraction,
            "provenance": {
                "discovery_method": discovery["discovery_method"],
                "title_source": title_source,
                "date_source": date_source,
                "modified_date_source": modified_date_source,
            },
        }
        self._inc("articles_output")
        yield record

    # ------------------------------------------------------------------
    # Shared helpers and metrics
    # ------------------------------------------------------------------

    def _discovery_record(
        self,
        *,
        site: Dict[str, Any],
        url: str,
        title: str,
        title_source: str,
        excerpt: str,
        published_at: Optional[str],
        modified_at: Optional[str],
        raw_date: str,
        date_source: str,
        date_precision: str,
        keyword_matches: List[str],
        method: str,
    ) -> Dict[str, Any]:
        return {
            "schema_version": ARTICLE_SCHEMA_VERSION,
            "record_type": "discovery",
            "run_id": self.run_id,
            "profile": self.profile,
            "source_id": site["id"],
            "source": site["name"],
            "source_category": site["category"],
            "source_region": site["region"],
            "source_timezone": site["timezone"],
            "requested_url": url,
            "final_url": url,
            "canonical_url": url,
            "title": title,
            "title_source": title_source,
            "excerpt": excerpt,
            "published_at": published_at,
            "modified_at": modified_at,
            "raw_date": raw_date,
            "date_source": date_source,
            "date_precision": date_precision,
            "keyword_matches": keyword_matches,
            "keywords_found": keyword_matches,
            "discovery_method": method,
            "discovered_at": utc_now_iso(),
            "quality": {
                "status": "discovered",
                "extractor": "feed_metadata" if method == "RSS" else "listing_anchor",
                "character_count": len(excerpt),
                "word_count": len(excerpt.split()),
                "paragraph_count": 0,
                "has_real_title": bool(title),
                "has_published_at": bool(published_at or modified_at),
            },
        }

    def _find_keywords(self, text: str, site: Optional[Dict[str, Any]] = None) -> List[str]:
        keywords = list((site or {}).get("keywords") or self.keywords)
        patterns = [
            re.compile(r"(?<!\w)" + re.escape(value) + r"(?!\w)", re.IGNORECASE)
            for value in keywords
        ]
        return [
            keyword
            for keyword, pattern in zip(keywords, patterns)
            if pattern.search(str(text or ""))
        ]

    def _date_in_range(self, timestamp: str) -> bool:
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            local_date = parsed.astimezone(self.local_timezone).date()
        except (TypeError, ValueError):
            return False
        if self.from_date and local_date < self.from_date:
            return False
        if self.to_date and local_date > self.to_date:
            return False
        return True

    def _valid_article_url(self, url: str, site: Dict[str, Any]) -> bool:
        return bool(
            url
            and not should_skip_article_url(url)
            and is_allowed_publisher_url(url, site["allowed_domains"])
        )

    def _response_stays_with_publisher(self, response: Any, site: Dict[str, Any]) -> bool:
        if is_allowed_publisher_url(response.url, site["allowed_domains"]):
            return True
        self._inc("dropped_cross_domain_redirect")
        self.logger.warning(
            "crawler_cross_domain_response_rejected",
            extra={
                "event": "crawler_cross_domain_response_rejected",
                "run_id": self.run_id,
                "profile": self.profile,
                "source_id": site["id"],
                "url": response.url,
            },
        )
        return False

    def _inc(self, metric: str, count: int = 1) -> None:
        crawler = getattr(self, "crawler", None)
        stats = getattr(crawler, "stats", None)
        if stats is not None:
            stats.inc_value(f"signalroom/{metric}", count=count)

    def closed(self, reason: str) -> None:
        crawler = getattr(self, "crawler", None)
        stats = getattr(crawler, "stats", None)
        all_stats = stats.get_stats() if stats is not None else {}
        signalroom_stats = {
            key: value for key, value in all_stats.items() if key.startswith("signalroom/")
        }
        failed_sources = self._sources_attempted - self._sources_responded
        source_health = {
            **self.source_diagnostics,
            "attempted": len(self._sources_attempted),
            "responded": len(self._sources_responded),
            "failed": len(failed_sources),
            "failed_source_ids": sorted(failed_sources),
            "all_sources_failed": bool(
                self._sources_attempted and not self._sources_responded
            ),
            "no_sources_attempted": not bool(self._sources_attempted),
            "close_reason": reason,
        }
        if self.stats_file is not None:
            report = {
                "schema_version": 1,
                "run_id": self.run_id,
                "profile": self.profile,
                "stats": signalroom_stats,
                "source_health": source_health,
            }
            try:
                self.stats_file.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.stats_file.with_suffix(self.stats_file.suffix + ".tmp")
                temporary.write_text(
                    json.dumps(report, ensure_ascii=False, sort_keys=True),
                    encoding="utf-8",
                )
                temporary.replace(self.stats_file)
            except OSError as exc:
                self.logger.error(
                    "crawler_health_report_failed",
                    extra={
                        "event": "crawler_health_report_failed",
                        "run_id": self.run_id,
                        "profile": self.profile,
                        "error": clean_text(exc),
                    },
                )
        self.logger.info(
            "crawler_closed",
            extra={
                "event": "crawler_closed",
                "run_id": self.run_id,
                "profile": self.profile,
                "reason": reason,
                "stats": signalroom_stats,
                "source_health": source_health,
            },
        )
