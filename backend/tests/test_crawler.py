from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from scrapy.http import HtmlResponse, Request, XmlResponse

from signalroom.crawlers.extractors import (
    extract_body,
    extract_canonical_url,
    extract_feed_entries,
    extract_feed_link,
    extract_page_dates,
    parse_datetime,
)
from signalroom.crawlers.policies import (
    PublisherRedirectPolicyMiddleware,
    canonicalize_url,
    is_allowed_publisher_url,
    should_skip_article_url,
)
from signalroom.crawlers.spiders.news_spider import NewsSpider


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


class URLPolicyTests(unittest.TestCase):
    def test_canonicalization_preserves_path_case_and_removes_only_tracking(self) -> None:
        value = canonicalize_url(
            "HTTPS://Example.COM:443/News/OpenAI?utm_source=rss&Token=AbC&id=7#section"
        )
        self.assertEqual(value, "https://example.com/News/OpenAI?Token=AbC&id=7")

    def test_domain_and_path_checks_use_boundaries(self) -> None:
        self.assertTrue(is_allowed_publisher_url("https://news.example.com/a", {"example.com"}))
        self.assertFalse(
            is_allowed_publisher_url("https://example.com.evil.test/a", {"example.com"})
        )
        self.assertFalse(should_skip_article_url("https://notfacebook.com/news/story"))
        self.assertFalse(should_skip_article_url("https://example.com/feedback/story"))
        self.assertTrue(should_skip_article_url("https://example.com/privacy"))
        self.assertTrue(should_skip_article_url("https://example.com/report.pdf"))

    def test_redirect_middleware_blocks_before_cross_domain_follow(self) -> None:
        from scrapy.exceptions import IgnoreRequest

        request = Request(
            "https://example.com/start",
            meta={"signalroom_allowed_domains": ["example.com"]},
        )
        response = HtmlResponse(
            request.url,
            request=request,
            status=302,
            headers={"Location": "https://evil.invalid/story"},
        )
        middleware = PublisherRedirectPolicyMiddleware()
        with self.assertRaises(IgnoreRequest):
            middleware.process_response(request, response, object())


class ExtractorTests(unittest.TestCase):
    def test_atom_alternate_link_wins_over_self(self) -> None:
        request = Request("https://feeds.example.com/atom.xml")
        response = XmlResponse(
            request.url,
            request=request,
            body=fixture("atom_feed.xml"),
            encoding="utf-8",
            headers={"Content-Type": "application/atom+xml"},
        )
        entry = extract_feed_entries(response)[0]
        self.assertEqual(
            extract_feed_link(entry, response.url),
            "https://www.example.com/News/OpenAI-Launch?id=42",
        )

    def test_timestamp_is_exact_utc_and_source_timezone_is_explicit(self) -> None:
        parsed, precision = parse_datetime("2026-07-09T06:30:00+05:30", "Asia/Kolkata")
        self.assertEqual(parsed, "2026-07-09T01:00:00Z")
        self.assertEqual(precision, "datetime")
        local_date, date_precision = parse_datetime("2026-07-09", "Asia/Kolkata")
        self.assertEqual(local_date, "2026-07-08T18:30:00Z")
        self.assertEqual(date_precision, "date")

    def test_page_metadata_is_case_normalized_and_body_is_real_text(self) -> None:
        request = Request("https://www.example.com/News/OpenAI-Launch?id=42")
        response = HtmlResponse(
            request.url,
            request=request,
            body=fixture("article.html"),
            encoding="utf-8",
            headers={"Content-Type": "text/html; charset=utf-8"},
        )
        dates = extract_page_dates(response, "Asia/Kolkata")
        self.assertEqual(dates["published_at"], "2026-07-09T01:00:00Z")
        self.assertEqual(dates["date_source"], "page_meta_datepublished")
        body, quality = extract_body(response)
        self.assertIn("source provenance", body)
        self.assertEqual(quality["paragraph_count"], 4)
        self.assertNotEqual(quality["status"], "insufficient")
        self.assertEqual(
            extract_canonical_url(response, {"example.com"}),
            "https://www.example.com/News/OpenAI-Launch?id=42",
        )


class SpiderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.sites_file = Path(self.temp_dir.name) / "sites.json"
        self.sites_file.write_text(
            json.dumps(
                {
                    "sites": [
                        {
                            "id": "example-tech",
                            "name": "Example Technology",
                            "enabled": True,
                            "category": "General Tech",
                            "rss_url": "https://feeds.example.com/atom.xml",
                            "homepage": "https://www.example.com/",
                            "allowed_domains": ["example.com"],
                            "timezone": "Asia/Kolkata",
                            "region": "Global",
                            "allow_deep_scan": False,
                            "manual_deep_scan_candidate": False,
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def spider(self, **overrides: str) -> NewsSpider:
        arguments = {
            "profile": "default",
            "run_id": "crawl_test_001",
            "keyword": "OpenAI, enterprise research",
            "from_date": "2026-07-09",
            "to_date": "2026-07-09",
            "sites_file": str(self.sites_file),
            "timezone_name": "Asia/Kolkata",
            "discovery_only": "false",
        }
        arguments.update(overrides)
        return NewsSpider(**arguments)

    def write_sites(self, sites: list[dict]) -> None:
        self.sites_file.write_text(json.dumps({"sites": sites}), encoding="utf-8")

    @staticmethod
    async def async_start_requests(spider: NewsSpider) -> list[Request]:
        return [request async for request in spider.start()]

    def feed_response(self, spider: NewsSpider) -> XmlResponse:
        site = spider.sites[0]
        request = Request(
            "https://feeds.example.com/atom.xml",
            meta={
                "site": site,
                "entrypoint_kind": "feed",
                "fallback_urls": site["listing_urls"],
            },
        )
        return XmlResponse(
            request.url,
            request=request,
            body=fixture("atom_feed.xml"),
            encoding="utf-8",
            headers={"Content-Type": "application/atom+xml"},
        )

    def test_strict_run_configuration(self) -> None:
        with self.assertRaisesRegex(ValueError, "keyword cannot be empty"):
            self.spider(keyword="")
        with self.assertRaisesRegex(ValueError, "from_date cannot be after"):
            self.spider(from_date="2026-07-10", to_date="2026-07-09")
        with self.assertRaisesRegex(ValueError, "Unknown timezone"):
            self.spider(timezone_name="Not/A_Timezone")
        match_all = self.spider(keyword="", match_all="true")
        self.assertEqual(match_all.keywords, [])

        feed_only = self.spider()
        self.assertEqual(feed_only.sites[0]["category"], "General Tech")
        self.assertFalse(feed_only.sites[0]["allow_deep_scan"])
        entrypoints = list(feed_only.start_requests())
        self.assertEqual(len(entrypoints), 1)
        self.assertEqual(entrypoints[0].meta["fallback_urls"], [])

    def test_homepage_deep_scan_generates_initial_request(self) -> None:
        self.write_sites(
            [
                {
                    "id": "homepage-source",
                    "name": "Homepage Source",
                    "enabled": True,
                    "homepage": "https://example.com/news/",
                    "allow_deep_scan": True,
                }
            ]
        )
        spider = self.spider()
        requests = list(spider._iter_initial_requests())
        self.assertEqual([request.url for request in requests], ["https://example.com/news/"])
        self.assertEqual(requests[0].meta["entrypoint_kind"], "listing")
        self.assertEqual(spider._sources_attempted, {"homepage-source"})

    def test_disabled_source_generates_no_request(self) -> None:
        self.write_sites(
            [
                {
                    "id": "disabled-source",
                    "name": "Disabled Source",
                    "enabled": False,
                    "rss_url": "https://example.com/feed.xml",
                }
            ]
        )
        spider = self.spider()
        self.assertEqual(list(spider._iter_initial_requests()), [])
        self.assertEqual(spider.source_diagnostics["configured"], 1)
        self.assertEqual(spider.source_diagnostics["enabled"], 0)

    def test_enabled_source_without_url_is_counted_not_silently_attempted(self) -> None:
        self.write_sites(
            [{"id": "missing-url", "name": "Missing URL", "enabled": True}]
        )
        spider = self.spider()
        self.assertEqual(list(spider._iter_initial_requests()), [])
        self.assertEqual(
            spider.source_diagnostics["enabled_without_usable_entrypoints"], 1
        )
        self.assertEqual(
            spider.source_diagnostics["sources_without_entrypoint_ids"], ["missing-url"]
        )

    def test_modern_async_start_matches_shared_generator(self) -> None:
        compatibility_spider = self.spider(run_id="compatibility")
        modern_spider = self.spider(run_id="modern")
        compatibility = list(compatibility_spider._iter_initial_requests())
        modern = asyncio.run(self.async_start_requests(modern_spider))
        self.assertEqual(
            [(item.url, item.priority, item.meta["entrypoint_kind"]) for item in modern],
            [
                (item.url, item.priority, item.meta["entrypoint_kind"])
                for item in compatibility
            ],
        )
        self.assertEqual(modern_spider._sources_attempted, {"example-tech"})

    def test_initial_request_generation_is_guarded_against_double_start(self) -> None:
        spider = self.spider()
        self.assertEqual(len(list(spider._iter_initial_requests())), 1)
        self.assertEqual(list(spider.start_requests()), [])
        self.assertEqual(spider.source_diagnostics["initial_requests"], 1)

    def test_repository_source_configuration_preflights_without_mutation(self) -> None:
        sites_file = Path(__file__).parents[1] / "sites" / "sites.json"
        before = sites_file.read_bytes()
        spider = self.spider(
            sites_file=str(sites_file),
            target_sites="techcrunch",
            run_id="repository-preflight",
        )
        requests = list(spider._iter_initial_requests())
        self.assertEqual(spider.source_diagnostics["configured"], 107)
        self.assertEqual(spider.source_diagnostics["enabled"], 79)
        self.assertEqual(spider.source_diagnostics["source_ids_selected"], ["techcrunch"])
        self.assertGreaterEqual(len(requests), 1)
        self.assertEqual(spider._sources_attempted, {"techcrunch"})
        self.assertEqual(sites_file.read_bytes(), before)

    def test_broadcast_homepages_preflight_as_html_listings(self) -> None:
        sites_file = Path(__file__).parents[1] / "sites" / "broadcast_sites.json"
        before = sites_file.read_bytes()
        spider = self.spider(
            sites_file=str(sites_file),
            run_id="broadcast-preflight",
            profile="broadcast",
        )
        requests = list(spider._iter_initial_requests())
        self.assertEqual(spider.source_diagnostics["configured"], 59)
        self.assertEqual(spider.source_diagnostics["enabled"], 59)
        self.assertEqual(len(requests), 59)
        self.assertTrue(all(item.meta["entrypoint_kind"] == "listing" for item in requests))
        self.assertEqual(sites_file.read_bytes(), before)

    def test_mixed_rss_and_homepage_sources_generate_the_correct_request_modes(self) -> None:
        self.write_sites(
            [
                {"id": "feed", "name": "Feed", "enabled": True, "rss_url": "https://example.com/feed.xml"},
                {"id": "web", "name": "Web", "enabled": True, "homepage": "https://example.org/news/", "allow_deep_scan": True},
            ]
        )
        spider = self.spider()
        requests = list(spider._iter_initial_requests())
        self.assertEqual([(item.url, item.meta["entrypoint_kind"]) for item in requests], [
            ("https://example.com/feed.xml", "feed"),
            ("https://example.org/news/", "listing"),
        ])

    def test_full_feed_crawl_checks_article_body_before_keyword_rejection(self) -> None:
        spider = self.spider(keyword="provenance")
        requests = list(spider.parse_feed(self.feed_response(spider)))
        self.assertEqual(len(requests), 1)
        response = HtmlResponse(
            requests[0].url,
            request=requests[0],
            body=fixture("article.html"),
            encoding="utf-8",
            headers={"Content-Type": "text/html"},
        )
        records = list(spider.parse_article_page(response))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["keyword_matches"], ["provenance"])

    def test_footer_only_keyword_does_not_make_an_article_relevant(self) -> None:
        spider = self.spider(keyword="OTT")
        article_request = list(spider.parse_feed(self.feed_response(spider)))[0]
        response = HtmlResponse(
            article_request.url,
            request=article_request,
            body=b"""
                <html><head>
                  <meta property="article:published_time" content="2026-07-09T06:30:00+05:30">
                </head><body>
                  <article><div class="entry-content">
                    <p>A filmmaker announced a festival premiere for a new drama. The cast discussed the story, production schedule, and international screening plans in a detailed press statement.</p>
                    <p>The premiere will take place in September and the producers expect the independent film to reach audiences around the world.</p>
                  </div></article>
                  <footer><p>Our company covers broadcast, OTT, cable TV, IPTV, and connected TV every day.</p></footer>
                </body></html>
            """,
            encoding="utf-8",
            headers={"Content-Type": "text/html"},
        )
        self.assertEqual(list(spider.parse_article_page(response)), [])

    def test_full_html_crawl_follows_candidate_when_keyword_is_only_in_body(self) -> None:
        spider = self.spider(keyword="provenance")
        site = spider.sites[0]
        request = Request("https://www.example.com/", meta={"site": site, "entrypoint_kind": "listing", "fallback_urls": []})
        listing = HtmlResponse(request.url, request=request, body=fixture("listing.html"), encoding="utf-8", headers={"Content-Type": "text/html"})
        article_requests = list(spider.parse_listing_page(listing))
        self.assertEqual(len(article_requests), 1)

    def test_source_specific_keywords_override_profile_keywords(self) -> None:
        self.write_sites([{
            "id": "source-keywords",
            "name": "Source Keywords",
            "enabled": True,
            "rss_url": "https://feeds.example.com/atom.xml",
            "allowed_domains": ["example.com"],
            "keywords": ["provenance"],
            "timezone": "Asia/Kolkata",
        }])
        spider = self.spider(keyword="never-matches")
        request = list(spider.parse_feed(self.feed_response(spider)))[0]
        response = HtmlResponse(request.url, request=request, body=fixture("article.html"), encoding="utf-8", headers={"Content-Type": "text/html"})
        records = list(spider.parse_article_page(response))
        self.assertEqual(records[0]["keyword_matches"], ["provenance"])

    def test_duplicate_source_ids_are_rejected(self) -> None:
        source = {
            "id": "duplicate",
            "name": "Duplicate Source",
            "enabled": True,
            "homepage": "https://example.com/",
            "timezone": "UTC",
        }
        self.sites_file.write_text(
            json.dumps({"sites": [source, {**source, "name": "Another Name"}]}),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "duplicate source id"):
            self.spider()

    def test_discovery_only_yields_json_exportable_dict(self) -> None:
        spider = self.spider(discovery_only="true")
        results = list(spider.parse_feed(self.feed_response(spider)))
        self.assertEqual(len(results), 1)
        item = results[0]
        self.assertIsInstance(item, dict)
        self.assertEqual(item["record_type"], "discovery")
        self.assertEqual(item["profile"], "default")
        self.assertEqual(item["run_id"], "crawl_test_001")
        self.assertEqual(item["source_category"], "General Tech")
        self.assertEqual(item["published_at"], "2026-07-09T01:00:00Z")
        self.assertNotIn("site_file", item)
        json.dumps(item)

    def test_feed_discovery_fetches_and_extracts_article(self) -> None:
        spider = self.spider()
        requests = list(spider.parse_feed(self.feed_response(spider)))
        self.assertEqual(len(requests), 1)
        article_request = requests[0]
        self.assertIsInstance(article_request, Request)
        self.assertEqual(article_request.url, "https://www.example.com/News/OpenAI-Launch?id=42")

        response = HtmlResponse(
            article_request.url,
            request=article_request,
            body=fixture("article.html"),
            encoding="utf-8",
            headers={"Content-Type": "text/html"},
        )
        records = list(spider.parse_article_page(response))
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["record_type"], "article")
        self.assertEqual(record["source_category"], "General Tech")
        self.assertEqual(record["canonical_url"], article_request.url)
        self.assertIn("source provenance", record["body_text"])
        self.assertEqual(len(record["content_hash"]), 64)
        self.assertEqual(record["authors"], ["Asha Rao", "Mateo Chen"])
        self.assertEqual(record["date_source"], "page_meta_datepublished")
        self.assertEqual(
            record["lead_image_url"],
            "https://cdn.example.net/images/research-system.jpg",
        )
        self.assertNotIn("site_file", record)
        json.dumps(record)

    def test_listing_rejects_external_and_navigation_links_and_deduplicates(self) -> None:
        spider = self.spider(discovery_only="true")
        site = spider.sites[0]
        request = Request(
            "https://www.example.com/",
            meta={"site": site, "entrypoint_kind": "listing", "fallback_urls": []},
        )
        response = HtmlResponse(
            request.url,
            request=request,
            body=fixture("listing.html"),
            encoding="utf-8",
            headers={"Content-Type": "text/html"},
        )
        results = list(spider.parse_listing_page(response))
        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0]["canonical_url"],
            "https://www.example.com/News/OpenAI-Launch?id=42",
        )

    def test_cross_domain_redirect_and_binary_content_are_rejected(self) -> None:
        spider = self.spider()
        article_request = list(spider.parse_feed(self.feed_response(spider)))[0]
        redirected = HtmlResponse(
            "https://evil.invalid/stolen",
            request=article_request,
            body=fixture("article.html"),
            encoding="utf-8",
            headers={"Content-Type": "text/html"},
        )
        self.assertEqual(list(spider.parse_article_page(redirected)), [])

        binary = HtmlResponse(
            article_request.url,
            request=article_request,
            body=b"%PDF-not-really-html",
            encoding="utf-8",
            headers={"Content-Type": "application/pdf"},
        )
        self.assertEqual(list(spider.parse_article_page(binary)), [])

    def test_close_report_distinguishes_reachable_sources_from_empty_results(self) -> None:
        stats_file = Path(self.temp_dir.name) / "crawl-health.json"
        spider = self.spider(stats_file=str(stats_file), discovery_only="true")
        list(spider.start_requests())
        list(spider.parse_entrypoint(self.feed_response(spider)))
        spider.closed("finished")

        report = json.loads(stats_file.read_text(encoding="utf-8"))
        self.assertEqual(report["source_health"]["attempted"], 1)
        self.assertEqual(report["source_health"]["responded"], 1)
        self.assertFalse(report["source_health"]["all_sources_failed"])


if __name__ == "__main__":
    unittest.main()
