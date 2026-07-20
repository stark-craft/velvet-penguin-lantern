"""Conservative defaults for the Signalroom crawler worker."""

BOT_NAME = "signalroom"

SPIDER_MODULES = ["signalroom.crawlers.spiders"]
NEWSPIDER_MODULE = "signalroom.crawlers.spiders"

ROBOTSTXT_OBEY = True
CONCURRENT_REQUESTS = 16
CONCURRENT_REQUESTS_PER_DOMAIN = 2
DOWNLOAD_DELAY = 0.5
RANDOMIZE_DOWNLOAD_DELAY = True
DOWNLOAD_TIMEOUT = 20
DOWNLOAD_MAXSIZE = 10 * 1024 * 1024
DOWNLOAD_WARNSIZE = 5 * 1024 * 1024
REDIRECT_MAX_TIMES = 5

RETRY_ENABLED = True
RETRY_TIMES = 2
RETRY_HTTP_CODES = [408, 425, 429, 500, 502, 503, 504]

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 0.5
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0

COOKIES_ENABLED = False
TELNETCONSOLE_ENABLED = False

# Runs before Scrapy's RedirectMiddleware during response processing and blocks
# a redirect before the redirected request can leave its configured publisher.
DOWNLOADER_MIDDLEWARES = {
    "signalroom.crawlers.policies.PublisherRedirectPolicyMiddleware": 610,
}

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
FEED_EXPORT_ENCODING = "utf-8"
FEED_EXPORT_INDENT = 2

# The address identifies the internal crawler without pretending to be a browser.
USER_AGENT = "SignalroomNewsCrawler/1.0 (+internal-news-intelligence)"

LOG_LEVEL = "INFO"
