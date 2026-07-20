from __future__ import annotations

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
