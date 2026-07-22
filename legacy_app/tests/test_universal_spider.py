import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from scrapy.http import HtmlResponse, Request, XmlResponse

from news_aggregator.news_aggregator.spiders.universal_spider import NewsSpider


def make_response(cls, url, body, meta=None, content_type=b"text/html"):
    request = Request(url, meta=meta or {})
    return cls(url=url, body=body.encode("utf-8"), encoding="utf-8", headers={"Content-Type": content_type}, request=request)


class UniversalSpiderTests(unittest.TestCase):
    def test_rss_feed_queues_matching_dated_article(self):
        spider = NewsSpider(keyword="DTH, Broadcast", from_date="2026-07-22", to_date="2026-07-22")
        xml = """<?xml version="1.0"?><rss><channel><item><title>India DTH platform launches broadcast service</title><link>https://example.com/news/dth-launch</link><pubDate>Wed, 22 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>"""
        response = make_response(XmlResponse, "https://example.com/rss.xml", xml, {"site_name": "Example", "configured_url": "https://example.com/rss.xml", "source_home": "https://example.com/"}, b"application/rss+xml")
        requests = list(spider.parse_feed(response))
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url, "https://example.com/news/dth-launch")
        self.assertEqual(requests[0].meta["method"], "RSS")

    def test_html_listing_discovers_anchor_and_jsonld_articles(self):
        spider = NewsSpider(keyword="DTH")
        html = """<html><head><script type="application/ld+json">{"@type":"NewsArticle","headline":"DTH market expands across India","url":"/news/dth-market-expands"}</script></head><body><main><a href="/news/2026/07/dth-new-service">DTH operator launches new television service</a></main></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/news/", html, {"site_name": "Example", "configured_url": "https://example.com/news/", "source_home": "https://example.com/"})
        urls = {request.url for request in spider.parse_listing_page(response)}
        self.assertIn("https://example.com/news/dth-market-expands", urls)
        self.assertIn("https://example.com/news/2026/07/dth-new-service", urls)

    def test_article_page_extracts_metadata_date_and_keywords(self):
        spider = NewsSpider(keyword="DTH", from_date="2026-07-22", to_date="2026-07-22")
        body = " ".join(["The DTH broadcasting platform announced a major expansion for television viewers in India."] * 10)
        html = f"""<html><head><meta property="article:published_time" content="2026-07-22T08:00:00+05:30"><meta property="og:image" content="https://example.com/story.jpg"></head><body><article><h1>DTH broadcasting expands in India</h1><p>{body}</p></article></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/news/dth-expands", html, {"site_name": "Example", "seed_title": "", "seed_date": None, "method": "Website Discovery"})
        items = list(spider.parse_article_page(response))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["date"], "2026-07-22")
        self.assertIn("dth", items[0]["keywords_found"])
        self.assertEqual(items[0]["top_image"], "https://example.com/story.jpg")

    def test_article_specific_headline_beats_generic_document_title(self):
        spider = NewsSpider(keyword="broadcast")
        html = """<html><head><title>Berita</title><script type="application/ld+json">
        {"@type":"NewsArticle","headline":"Regulator strengthens national broadcast standards"}
        </script></head><body><main><h1>Visible broadcast policy headline</h1></main></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/news/policy", html)
        article = SimpleNamespace(title="Berita")
        self.assertEqual(
            spider.extract_article_title(response, article, "Berita"),
            "Regulator strengthens national broadcast standards",
        )

    def test_generic_h1_falls_back_to_open_graph_story_title(self):
        spider = NewsSpider(keyword="broadcast")
        html = """<html><head><meta property="og:title" content="KPI publishes new broadcast quality rules"></head>
        <body><main><h1>Berita</h1></main></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/news/policy", html)
        self.assertEqual(
            spider.extract_article_title(response, SimpleNamespace(title="Berita"), "Berita"),
            "KPI publishes new broadcast quality rules",
        )

    def test_seo_category_page_is_not_emitted_as_article(self):
        spider = NewsSpider(keyword="fast")
        title = "Technology News, Latest Mobile Phones, Smartphone Reviews, Gadget News, Apps and Tech Tips"
        links = "".join(
            f'<article><a href="/technology/news/story-{number}">A sufficiently descriptive technology story headline {number}</a></article>'
            for number in range(4)
        )
        html = f"<html><body><main><h1>{title}</h1>{links}</main></body></html>"
        response = make_response(HtmlResponse, "https://example.com/technology", html)
        self.assertTrue(spider.is_listing_or_archive_page(response, title))

    def test_dated_archive_expands_story_links_instead_of_becoming_article(self):
        spider = NewsSpider(keyword="broadcast")
        html = """<html><body><main><h1>Advertising, Marketing, Media News Today 22 July 2026</h1>
        <article><a href="/news/one-broadcast-story.html">Broadcaster launches a new television service today</a></article>
        <article><a href="/news/two-broadcast-story.html">Broadcast regulator publishes updated distribution rules</a></article>
        <article><a href="/news/three-broadcast-story.html">Connected television company announces new FAST channels</a></article>
        </main></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/articles/2026-07-22.html", html, {"site_name": "Example", "seed_title": "", "seed_date": None, "method": "Website Discovery", "discovery_depth": 1})
        requests = list(spider.parse_article_page(response))
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(isinstance(item, Request) for item in requests))
        self.assertTrue(all("/news/" in item.url for item in requests))

    def test_listing_rejects_dated_links_outside_scan_window(self):
        spider = NewsSpider(keyword="broadcast", from_date="2026-07-22", to_date="2026-07-23")
        html = """<html><body><main>
        <article><a href="/articles/2026-05-20.html">Old broadcast media archive listing page</a></article>
        <article><a href="/articles/2026-07-22.html">Current broadcast media archive listing page</a></article>
        </main></body></html>"""
        response = make_response(HtmlResponse, "https://example.com/", html, {"site_name": "Example", "configured_url": "https://example.com/", "source_home": "https://example.com/"})
        urls = {request.url for request in spider.parse_listing_page(response)}
        self.assertNotIn("https://example.com/articles/2026-05-20.html", urls)
        self.assertIn("https://example.com/articles/2026-07-22.html", urls)

    def test_configured_section_does_not_crawl_publisher_wide_navigation(self):
        spider = NewsSpider(keyword="broadcast")
        html = """<html><body><main>
        <article><a href="/technology/news/television-platform-launch">Television platform launches a new broadcast service</a></article>
        <article><a href="/sports/cricket/league-final">Broadcast channel announces the cricket league final</a></article>
        </main></body></html>"""
        meta = {
            "site_name": "Example Technology",
            "configured_url": "https://example.com/technology/news",
            "source_home": "https://example.com/",
        }
        response = make_response(HtmlResponse, "https://example.com/technology/news", html, meta)
        requests = list(spider.parse_listing_page(response))
        self.assertEqual([request.url for request in requests], [
            "https://example.com/technology/news/television-platform-launch",
        ])
        self.assertEqual(requests[0].meta["configured_url"], meta["configured_url"])

    def test_sites_file_accepts_wrapped_sites_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            sites_file = Path(directory) / "sites.json"
            sites_file.write_text(json.dumps({"sites": [{"name": "Example", "url": "https://example.com", "enabled": True}]}))
            spider = NewsSpider(keyword="DTH", sites_file=str(sites_file))
            requests = list(spider.build_initial_requests())
            self.assertEqual(len(requests), 1)
            self.assertEqual(requests[0].url, "https://example.com")


if __name__ == "__main__":
    unittest.main()
