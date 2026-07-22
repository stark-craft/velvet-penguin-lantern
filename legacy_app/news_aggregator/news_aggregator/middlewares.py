"""Scrapy middleware for the NewsScrapper crawler.

The spider does the article discovery/extraction work. Middleware sits one
level lower in Scrapy's request/response stack and can adjust requests before
they are sent.

The main production middleware in this file is
`BrowserHeadersDownloaderMiddleware`.

Browser-header concept in plain English:

- A normal browser does not only send a URL.
- It also sends headers like Accept, Accept-Language, Referer, DNT, and modern
  navigation hints.
- Some publishers treat extremely bare Python requests as suspicious or broken
  traffic, even when the page itself is public.
- Adding browser-like headers makes Scrapy requests look like normal document
  navigation, which improves compatibility with ordinary news sites.

What this does not do:

- It does not bypass paywalls.
- It does not solve CAPTCHA.
- It does not defeat Cloudflare or advanced bot protection.
- It does not hide the crawler from a determined server.

It is best understood as "send complete, browser-shaped HTTP headers" rather
than "be invisible."
"""

from scrapy import signals


class NewsAggregatorSpiderMiddleware:
    @classmethod
    def from_crawler(cls, crawler):
        s = cls()
        crawler.signals.connect(s.spider_opened, signal=signals.spider_opened)
        return s

    def process_spider_output(self, response, result, spider):
        for i in result:
            yield i

    def spider_opened(self, spider):
        spider.logger.debug("Spider opened: %s" % spider.name)

class NewsAggregatorDownloaderMiddleware:
    @classmethod
    def from_crawler(cls, crawler):
        s = cls()
        crawler.signals.connect(s.spider_opened, signal=signals.spider_opened)
        return s

    def spider_opened(self, spider):
        spider.logger.debug("Spider opened: %s" % spider.name)


class BrowserHeadersDownloaderMiddleware:
    """Apply browser-like headers to each outgoing request.

    Scrapy can make perfectly valid HTTP requests with very few headers, but
    many publishers tune their edge systems around browser traffic. A request
    with no language preference, no navigation hint, and no browser identity can
    be rejected or served a thin/blocked page.

    This middleware gives every outgoing request the same kind of basic context
    a browser would normally send. It helps solve the "bare crawler request"
    problem, not the "site has hard anti-bot enforcement" problem.
    """

    # These defaults mirror the production Scrapy settings but add a few modern
    # navigation hints.
    #
    # Header-by-header:
    #
    # Accept:
    #   Tells the server this request wants an HTML document, while still
    #   accepting XML/RSS and other content when needed.
    #
    # Accept-Language:
    #   Tells the server English content is acceptable. Some sites vary content
    #   or blocking behavior when the header is missing.
    #
    # Referer:
    #   Gives a normal-looking navigation source. This is a soft compatibility
    #   hint for publishers that expect browser-like navigation.
    #
    # DNT:
    #   Standard "Do Not Track" preference. It is not security-sensitive here;
    #   it just matches common browser traffic.
    #
    # Upgrade-Insecure-Requests:
    #   Browsers send this to say HTTPS is preferred when possible.
    #
    # Sec-Fetch-*:
    #   Modern browsers send these to describe navigation context. They help
    #   distinguish a document navigation from script/image/API requests.
    DEFAULT_HEADERS = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.google.com/",
        "DNT": "1",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
    }

    @classmethod
    def from_crawler(cls, crawler):
        """Scrapy factory hook used when DOWNLOADER_MIDDLEWARES loads class."""

        return cls()

    def process_request(self, request):
        """Attach browser-like headers before Scrapy sends the request."""

        for header_name, header_value in self.DEFAULT_HEADERS.items():
            # setdefault is intentional. If a specific request already has a
            # custom header, keep that request-specific choice.
            request.headers.setdefault(header_name, header_value)

        # Returning None tells Scrapy to continue processing this request
        # normally after the headers are set.
        return None


class UndetectableDownloaderMiddleware(BrowserHeadersDownloaderMiddleware):
    """Backward-compatible alias for older production settings.

    Older deployments may still reference:

        news_aggregator.middlewares.UndetectableDownloaderMiddleware

    Keep that import path working, but use the clearer class name in new
    settings. The behavior is exactly the same as BrowserHeadersDownloaderMiddleware.
    """
