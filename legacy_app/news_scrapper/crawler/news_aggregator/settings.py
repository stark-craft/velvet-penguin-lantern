"""Scrapy runtime settings for the NewsScrapper crawler.

This file does not contain AI model logic. It only tells Scrapy how to run the
spider package, how to export scraped items, and which item pipelines should see
each scraped article.

The high-level flow is:

1. FastAPI launches Scrapy as a subprocess.
2. Scrapy loads these settings.
3. Scrapy runs `news_spider` from `universal_spider.py`.
4. Each yielded article item passes through `ITEM_PIPELINES`.
5. Scrapy writes the final JSON file requested by FastAPI using `-O`.
"""

# Human-readable Scrapy project name.
#
# Where it is used:
# - Scrapy includes this name in logs and internal crawler identity.
# - It is not shown in the frontend.
# - It does not decide which sources are crawled.
#
# If changed:
# - Scrapy logs/project identity change.
# - The spider command still uses `news_spider`; this setting does not rename
#   the spider itself.
BOT_NAME = "news_aggregator"

# Python package paths where Scrapy should look for spider classes.
#
# In this repository, the actual crawler class is:
#
#     news_aggregator/news_aggregator/spiders/universal_spider.py
#
# If this path is wrong, `scrapy crawl news_spider` will not find the spider.
SPIDER_MODULES = ["news_aggregator.spiders"]

# Where Scrapy should create a new spider if someone runs `scrapy genspider`.
# This is mostly a convention; the running app does not dynamically create
# spiders.
#
# If changed:
# - Only future generated spiders are affected.
# - Existing crawling is not affected unless someone relies on genspider.
NEWSPIDER_MODULE = "news_aggregator.spiders"

import os

# Robot rules are environment-controlled and default to compliance.
#
# False:
# - Scrapy does not fetch or enforce robots.txt.
# - More sources/pages can be reached.
#
# True:
# - Scrapy checks robots.txt for each domain.
# - Some valid public article URLs may be skipped if the site disallows bots.
# - This can reduce results and make demos look inconsistent by source.
ROBOTSTXT_OBEY = os.environ.get("SCRAPY_ROBOTSTXT_OBEY", "true").strip().lower() in {"1", "true", "yes", "on"}

# The Telnet debugging console is not needed in an internal packaged service and
# opens an unnecessary local listening socket.
TELNETCONSOLE_ENABLED = False

# Browser-like identity used by Scrapy requests. FastAPI may also pass
# USER_AGENT with `-s`, but keeping it here makes manual/prod Scrapy runs behave
# the same way.
#
# A User-Agent is the client identity string sent in HTTP requests. Real
# browsers send strings like this. Some publishers reject the default Python or
# Scrapy user agent because it looks like automation.
#
# If changed:
# - A newer Chrome-like string may improve compatibility.
# - A strange or empty value may increase 403/blocked responses.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# Default headers make requests look closer to normal browser navigation.
#
# Why this matters:
#
# A real browser normally sends more than just "GET /page". It includes Accept,
# language, referer, and privacy/navigation hints. Some news sites reject very
# bare crawler requests because they look unlike normal human browser traffic.
#
# These headers do not bypass hard bot protection, CAPTCHA, paywalls, or access
# controls. They simply make ordinary HTTP requests complete more reliably on
# normal publisher pages.
DEFAULT_REQUEST_HEADERS = {
    # Accept says what response formats the crawler can understand.
    # This prefers normal HTML pages but still allows XML/RSS feeds.
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    # Accept-Language tells publishers English content is acceptable.
    # Missing language headers can make some sites return different pages.
    "Accept-Language": "en-US,en;q=0.5",

    # Referer is a soft navigation hint. Some sites expect normal browser
    # traffic to arrive from another page/search engine.
    "Referer": "https://www.google.com/",

    # Do Not Track is a common browser privacy preference. It is not used by
    # our code, but it makes the request shape more browser-like.
    "DNT": "1",
}

# Scrapy changed request fingerprinting across versions. Pinning 2.7 gives
# stable duplicate-request behavior with modern Scrapy.
#
# Request fingerprinting is how Scrapy decides "have I already requested this
# URL?" Stable fingerprinting prevents accidental duplicate downloads.
#
# If changed:
# - Duplicate filtering behavior can shift between Scrapy versions.
# - Usually leave this pinned unless upgrading Scrapy deliberately.
REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"

# FastAPI and modern Python environments already use asyncio. This reactor makes
# Scrapy/Twisted cooperate with asyncio instead of using an older default
# reactor. It is important when running Scrapy from the backend process.
#
# Reactor = Twisted's event loop implementation.
#
# If changed:
# - Scrapy may still work from the command line.
# - It can become less predictable when launched by the FastAPI backend.
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

# Export JSON as UTF-8 so article titles, Korean text, smart quotes, and symbols
# are written correctly instead of becoming escaped/garbled byte sequences.
#
# If changed to another encoding:
# - Non-English text may become escaped or unreadable.
# - Frontend cards and exported files can show broken characters.
FEED_EXPORT_ENCODING = "utf-8"

# Keep Scrapy's internal logs quiet. The spider itself prints `LOG:` lines for
# user-facing progress updates consumed by the backend SSE stream.
#
# WARNING means:
# - Scrapy framework noise is reduced.
# - Important warnings/errors still appear.
#
# If changed to INFO/DEBUG:
# - Terminal output becomes much noisier.
# - The backend stream can become harder to read.
LOG_LEVEL = "WARNING"

# Downloader middleware runs before requests are sent. The production crawler
# uses a small local middleware to reinforce browser-like headers per request.
#
# The class is intentionally named BrowserHeadersDownloaderMiddleware instead of
# "undetectable" because it is not magic. It only shapes headers so requests
# resemble ordinary browser navigation.
DOWNLOADER_MIDDLEWARES = {
    # Priority 100 means this middleware runs early in the downloader chain.
    # Lower numbers run earlier. Running early lets it set missing headers
    # before later downloader components process the request.
    "news_aggregator.middlewares.BrowserHeadersDownloaderMiddleware": 100,
}

# ==========================================
# CRAWL BEHAVIOR
# ==========================================

# Global request concurrency across the whole spider run. This is high enough
# for deep scans to finish quickly, while the per-domain cap below keeps any one
# publisher from being hit too aggressively.
#
# If increased:
# - Scans can finish faster.
# - CPU/network pressure rises.
# - More publishers may rate-limit or block.
#
# If decreased:
# - Scans become gentler and more stable.
# - Large "All sources" deep scans take longer.
CONCURRENT_REQUESTS = 32

# Maximum simultaneous requests per publisher/domain.
#
# This is the more important politeness limit. Even if global concurrency is 32,
# one site should receive at most 3 simultaneous requests.
#
# If increased:
# - Individual sources are crawled faster.
# - Rate-limit risk increases.
#
# If decreased:
# - Individual sources are crawled more gently.
# - Slow sources take longer to finish.
CONCURRENT_REQUESTS_PER_DOMAIN = 3

# Small fixed delay between requests. This smooths bursts and reduces blocking.
#
# Unit: seconds.
#
# 0.25 means Scrapy waits about a quarter second between requests to the same
# slot/domain, subject to concurrency and AutoThrottle.
#
# If increased:
# - Crawling becomes more polite.
# - Results arrive slower.
#
# If set to 0:
# - Crawling is faster but burstier.
# - Some publishers may respond with 429/403 more often.
DOWNLOAD_DELAY = 0.25

# If a publisher does not respond within 20 seconds, move on. Slow sources
# should not stall the entire manual/scheduled scan.
#
# Unit: seconds.
#
# If increased:
# - Very slow sites get more time to respond.
# - Bad sources can hold crawl slots longer.
#
# If decreased:
# - Scans fail fast on slow sites.
# - Some legitimate slow articles may be missed.
DOWNLOAD_TIMEOUT = 20

# AutoThrottle lets Scrapy adapt speed based on observed latency and server
# responses.
#
# True:
# - Scrapy dynamically adjusts request pacing.
# - Helps avoid overloading slower publishers.
#
# False:
# - Only fixed DOWNLOAD_DELAY/concurrency rules apply.
# - Behavior is simpler but less adaptive.
AUTOTHROTTLE_ENABLED = True

# Initial AutoThrottle delay before Scrapy has enough latency information.
# A small value keeps startup responsive without firing all requests at once.
AUTOTHROTTLE_START_DELAY = 0.5

# Maximum delay AutoThrottle may apply when a site is slow or strained.
# This prevents one source from becoming painfully slow forever.
AUTOTHROTTLE_MAX_DELAY = 15.0

# Desired parallelism per remote server while AutoThrottle is active.
#
# Higher values:
# - More aggressive crawling.
# - Faster but more likely to trigger rate limits.
#
# Lower values:
# - Gentler crawling.
# - Slower but safer for fragile publishers.
AUTOTHROTTLE_TARGET_CONCURRENCY = 4.0

# ==========================================
# RELIABILITY
# ==========================================

# Retry transient failures and rate-limit responses. Permanent parser decisions
# still happen inside universal_spider.py after a response is received.
#
# True:
# - Scrapy retries selected failed responses.
# - Useful for temporary server/rate-limit/network issues.
#
# False:
# - Each failed request fails once and moves on.
# - Faster, but more articles may be missed.
RETRY_ENABLED = True

# Number of retry attempts after the first failed request.
#
# 2 means a request can be tried up to 3 total times:
# first attempt + retry 1 + retry 2.
RETRY_TIMES = 2

# HTTP status codes that should be retried.
#
# 405: method not allowed, sometimes temporary/misconfigured
# 429: rate limited
# 500/502/503/504: server or gateway errors
# 408: request timeout
RETRY_HTTP_CODES = [405, 429, 500, 502, 503, 504, 408]

# Allow these responses through to callbacks instead of turning them into hard
# Scrapy errors. The spider/pipelines can then log or fallback more gracefully.
#
# Why allow error pages?
# - Some sites return a useful page body with a 403/405/429/500.
# - Letting callbacks see the response makes logging/fallback behavior clearer.
#
# Risk:
# - The spider may receive blocked/error HTML.
# - universal_spider.py must keep rejecting thin/non-article pages, which it
#   does with title/body/keyword checks.
HTTPERROR_ALLOWED_CODES = [404, 403, 405, 429, 500]

# Cache disabled so scheduled/manual scans see current publisher content.
#
# True:
# - Faster repeat local development.
# - Can accidentally serve old article pages.
#
# False:
# - Always fetch current source/article content.
# - Better for news freshness and scheduler correctness.
HTTPCACHE_ENABLED = False

# Preserve Referer behavior; some publishers use it as a soft anti-bot signal.
#
# True:
# - Scrapy may set Referer automatically when following links.
# - Our DEFAULT_REQUEST_HEADERS also provide a fallback Referer.
#
# False:
# - Referer headers are stripped.
# - Some publishers may treat requests as less browser-like.
REFERER_ENABLED = True

# Item pipelines run after the spider yields an article item.
#
# Lower number = earlier pipeline.
#
# LiveStreamPipeline runs first. When FastAPI launches Scrapy with
# SENSE_STREAM_ITEMS=1, this pipeline prints each article as:
#
#     SENSE_STREAM_ITEM:{...json...}
#
# FastAPI reads those stdout lines and streams approved cards to the UI while
# crawling is still happening.
#
# NewsAggregatorPipeline is a pass-through placeholder for future validation or
# cleanup. It currently returns the item unchanged.
ITEM_PIPELINES = {
    # Priority 100 runs before the normal pipeline. This matters because live
    # streaming should happen as soon as a clean article item is yielded.
    "news_aggregator.pipelines.LiveStreamPipeline": 100,

    # Priority 300 runs later. This pipeline currently returns the item
    # unchanged, but it is the right place for future item-level cleanup.
    "news_aggregator.pipelines.NewsAggregatorPipeline": 300,
}
