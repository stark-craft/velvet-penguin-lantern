"""Universal news spider used by the NewsScrapper backend.

This spider is intentionally source-agnostic. It does not know about Samsung,
Broadcast, or the frontend UI. FastAPI passes it:

- keywords to match
- a date range
- a source list file (`sites.json` or `sites_broadcast.json`)
- an optional selected source list

The spider then:

1. loads the configured source list
2. tries RSS/Atom feeds first because feeds are structured and clean
3. falls back to website link discovery if no usable feed exists
4. extracts article text using `newspaper3k` plus an HTML paragraph fallback
5. keeps only articles matching the requested keywords/date range
6. yields clean JSON items for Scrapy to export and optionally live-stream

Important security boundary:

This file is the network-facing crawler. It fetches public web pages. The AI
model stages happen later in `semantic_clustering.py` after raw JSON exists.
"""

import json
import os
import re
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlsplit, urlunsplit

import scrapy
from dateutil import parser
from newspaper import Article, Config
from scrapy.http import TextResponse


class NewsSpider(scrapy.Spider):
    """One spider that can crawl any configured news source list."""

    # Scrapy uses this name in commands:
    #
    #     scrapy crawl news_spider
    #
    # FastAPI launches this exact spider name from `main.py`.
    name = "news_spider"

    # Maximum feed entries to request from one RSS/Atom source. This protects
    # very large feeds from creating hundreds of requests in one scan.
    MAX_RSS_CANDIDATES = 45

    # Maximum links to request from one website fallback page. This keeps a
    # source homepage/listing scan bounded.
    MAX_HTML_CANDIDATES = 45

    # Minimum article body length. Pages below this are usually navigation,
    # category pages, image pages, or thin/non-news content.
    MIN_ARTICLE_WORDS = 45

    # Query parameters that do not change article identity. Removing them helps
    # deduplicate URLs such as:
    #
    #     article.html?utm_source=x
    #     article.html?utm_source=y
    #
    # into the same canonical article URL.
    TRACKING_PARAMS = {
        "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
    }

    # URL path fragments that usually identify non-article pages. These are
    # skipped during website fallback link scoring.
    BLOCKED_PATH_PARTS = {
        "/account", "/advert", "/author/", "/authors/", "/category/", "/contact",
        "/events", "/feed", "/forum", "/login", "/members/", "/newsletter",
        "/podcast", "/privacy", "/profile/", "/search", "/shop", "/sign-in",
        "/signin", "/signup", "/subscribe", "/tag/", "/tags/", "/terms",
        "/topic/", "/topics/", "/user/", "/video/",
    }

    # File extensions that are not article HTML. This prevents wasting requests
    # on images, scripts, stylesheets, PDFs, archives, and feeds.
    NON_ARTICLE_EXTENSIONS = (
        ".css", ".gif", ".ico", ".jpeg", ".jpg", ".js", ".json", ".pdf",
        ".png", ".svg", ".webp", ".xml", ".zip",
    )

    # Anchor text labels that are almost never article links. If a link says
    # only "privacy" or "subscribe", it should not be treated as a story.
    NON_STORY_LABELS = {
        "about", "advertise", "all", "careers", "contact", "home", "latest",
        "login", "menu", "more", "newsletter", "podcasts", "privacy",
        "search", "see all", "sign in", "subscribe", "terms", "videos",
    }

    # Common timezone abbreviations found in RSS feeds. dateutil warns when it
    # sees labels like "PDT" without a mapping. This table makes parsing stable
    # and then the code strips timezone info after normalization.
    TZINFOS = {
        "UTC": 0,
        "GMT": 0,
        "EST": -5 * 3600,
        "EDT": -4 * 3600,
        "CST": -6 * 3600,
        "CDT": -5 * 3600,
        "MST": -7 * 3600,
        "MDT": -6 * 3600,
        "PST": -8 * 3600,
        "PDT": -7 * 3600,
    }

    def __init__(self, *args, **kwargs):
        """Initialize one spider run with parameters provided by FastAPI/Scrapy."""

        super(NewsSpider, self).__init__(*args, **kwargs)

        # newspaper3k parser configuration. It is used only after Scrapy has
        # downloaded an article page, so it parses the HTML we already fetched.
        self.news_config = Config()

        # A normal browser user agent improves compatibility with publisher
        # sites that block Python's default user agent.
        self.news_config.browser_user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )

        # Limit article extraction work so one slow publisher cannot stall the
        # whole crawl.
        self.news_config.request_timeout = 10

        # No internal network fetch is required because parse_article_page gives
        # newspaper3k the HTML already verified and downloaded by Scrapy.

        # `keyword` is passed by FastAPI as a comma-separated string.
        # Example: "Samsung, OLED, AI"
        raw_keywords = getattr(self, "keyword", "")

        # Normalize keywords for case-insensitive matching.
        self.keywords = [
            keyword.strip().lower()
            for keyword in str(raw_keywords).split(",")
            if keyword.strip()
        ]

        # Compile keyword regexes once so every article can be checked quickly.
        # (?<!\w) and (?!\w) avoid matching inside larger words.
        self.keyword_patterns = [
            (keyword, re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)", re.IGNORECASE))
            for keyword in self.keywords
        ]

        # target_sites is either "All" or a comma-separated list of site names.
        self.target_sites = getattr(self, "target_sites", "All")

        # sites_file points at sites.json or sites_broadcast.json. The backend
        # chooses this based on active profile.
        configured_sites_file = getattr(self, "sites_file", "")
        self.sites_file = os.path.abspath(configured_sites_file) if configured_sites_file else None

        # Date range filters are optional. When missing, all dates are allowed.
        self.start_date = self.parse_filter_date(getattr(self, "from_date", None))
        self.end_date = self.parse_filter_date(getattr(self, "to_date", None))

        # Per-run dedupe: once a normalized article URL has been queued, do not
        # request it again from RSS + website fallback.
        self.seen_article_urls = set()

        # Prevent repeated fallback requests for the same source if both RSS and
        # discovered feed paths fail.
        self.fallback_sources = set()
        self.common_feed_sources = set()

        print("LOG: Spider initialized. RSS-first content validation enabled.", flush=True)

    async def start(self):
        """Scrapy 2.13+ async startup entrypoint."""

        for request in self.build_initial_requests():
            yield request

    def start_requests(self):
        # Kept for compatibility with older Scrapy installations.
        yield from self.build_initial_requests()

    def build_initial_requests(self):
        """Create the first request for each active configured source."""

        # Prefer the explicit sites_file passed by FastAPI.
        sites_path = self.sites_file

        # Fallback for running the spider manually from the Scrapy project folder.
        if not sites_path:
            sites_path = os.path.abspath(os.path.join(os.getcwd(), "..", "sites.json"))

        # Fallback for running from repository root.
        if not os.path.exists(sites_path):
            sites_path = os.path.join(os.getcwd(), "sites.json")

        # If no sites file exists, the spider cannot know what to crawl.
        if not os.path.exists(sites_path):
            print(f"LOG: Error - sites file not found: {sites_path}", flush=True)
            return

        # Source files are JSON lists. Each source usually has name, url,
        # category/enabled metadata, and sometimes profile-specific settings.
        with open(sites_path, "r", encoding="utf-8") as f:
            sites_payload = json.load(f)
        # Accept both the legacy JSON list and {"sites": [...]} so source files
        # can be edited without changing the crawler contract.
        sites = sites_payload.get("sites", []) if isinstance(sites_payload, dict) else sites_payload
        if not isinstance(sites, list):
            print(f"LOG: Error - sites file must contain a list: {sites_path}", flush=True)
            return

        # By default, crawl every source with enabled=true or no enabled field.
        active_sites = [site for site in sites if site.get("enabled", True)]

        # If the UI selected specific sources, keep only matching names.
        if self.target_sites != "All":
            target_list = [name.strip().lower() for name in self.target_sites.split(",")]
            active_sites = [
                site for site in active_sites
                if site.get("name", "").strip().lower() in target_list
            ]

        print(f"LOG: Date Range Filter: {self.start_date} -> {self.end_date}", flush=True)
        print(f"LOG: Targeting {len(active_sites)} sources.", flush=True)

        # Every source starts with its configured URL. That URL may be an RSS
        # feed, an Atom feed, or a normal website page.
        for site in active_sites:
            site_name = site.get("name", "Unknown Source")
            configured_url = site.get("url", "")
            if not configured_url:
                continue
            print(f"LOG: Checking feed for {site_name}...", flush=True)
            yield scrapy.Request(
                url=configured_url,
                # parse_source_response decides whether this response is a feed
                # or a website listing page.
                callback=self.parse_source_response,
                # If the configured URL fails, try website fallback where possible.
                errback=self.handle_source_error,
                # meta is Scrapy's per-request context bag. These values travel
                # with the response into later callbacks.
                meta=self.source_meta(site_name, configured_url),
                # Source URLs may repeat between runs; this request should always
                # be allowed within this spider run.
                dont_filter=True,
            )

    @staticmethod
    def parse_filter_date(value):
        """Convert YYYY-MM-DD query values into date objects."""

        if not value or str(value).lower() == "null":
            return None
        try:
            return datetime.strptime(str(value), "%Y-%m-%d").date()
        except ValueError:
            return None

    @staticmethod
    def source_home(url):
        """Return scheme + domain for website fallback discovery."""

        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/"

    def source_meta(self, site_name, configured_url):
        """Build request metadata shared across feed/listing/article callbacks."""

        return {
            "site_name": site_name,
            "configured_url": configured_url,
            "source_home": self.source_home(configured_url),
        }

    def is_in_range(self, date_obj):
        """Return True when an article date is inside the selected date range."""

        # Unknown dates are allowed because many feeds omit dates or publishers
        # format them inconsistently.
        if not date_obj:
            return True

        # Accept either date or datetime values.
        local_date = date_obj.date() if isinstance(date_obj, datetime) else date_obj

        # Drop anything older than the start date.
        if self.start_date and local_date < self.start_date:
            return False

        # Drop anything newer than the end date.
        if self.end_date and local_date > self.end_date:
            return False

        return True

    def parse_source_response(self, response):
        """Classify a source response as feed, discovered feed, or listing page."""

        if response.status >= 400:
            print(
                f"LOG: Source returned HTTP {response.status} for {response.meta['site_name']}. Trying website fallback.",
                flush=True,
            )
            yield from self.request_website_fallback(response.meta)
            return

        # Binary files and non-text responses are not useful as source pages.
        if not isinstance(response, TextResponse):
            print(f"LOG: Skipped non-text source response: {response.url[:65]}", flush=True)
            return

        # Best case: the configured URL itself is already RSS/Atom/XML.
        if self.looks_like_feed(response):
            yield from self.parse_feed(response)
            return

        # Second best: the HTML page advertises an RSS/Atom feed in a <link> tag.
        discovered_feed = self.discover_feed_url(response)
        if discovered_feed:
            print(f"LOG: Discovered RSS/Atom feed for {response.meta['site_name']}.", flush=True)
            yield scrapy.Request(
                discovered_feed,
                callback=self.parse_feed,
                errback=self.handle_feed_error,
                meta=response.meta,
                dont_filter=True,
            )
            return

        # Last resort: scan links from the page and score likely article URLs.
        print(f"LOG: No RSS feed for {response.meta['site_name']}. Scanning article links.", flush=True)
        yield from self.parse_listing_page(response)
        yield from self.request_common_feeds(response.meta)

    def request_common_feeds(self, meta):
        """Try standard feed endpoints in addition to HTML discovery."""

        site_name = meta["site_name"]
        if site_name in self.common_feed_sources:
            return
        self.common_feed_sources.add(site_name)
        for suffix in ("feed/", "rss/", "rss.xml", "feed.xml", "index.xml"):
            yield scrapy.Request(
                urljoin(meta["source_home"], suffix),
                callback=self.parse_feed,
                errback=self.handle_common_feed_error,
                meta={**meta, "common_feed_probe": True},
                dont_filter=False,
            )

    def handle_common_feed_error(self, failure):
        # Standard endpoint probing is best-effort; the HTML listing scan is
        # already running and provides the primary fallback.
        return None

    def looks_like_feed(self, response):
        """Detect whether a response is RSS, Atom, or XML feed content."""

        # Some servers send clear content types such as application/rss+xml.
        content_type = response.headers.get("Content-Type", b"").decode("utf-8").lower()
        if any(token in content_type for token in ("rss", "atom", "xml")):
            return True

        # Other servers use generic text/xml or even text/html, so inspect tags.
        return bool(response.xpath(
            "//*[local-name()='rss' or local-name()='feed' or local-name()='item' or local-name()='entry']"
        ).get())

    def discover_feed_url(self, response):
        """Find an RSS/Atom feed URL advertised by a normal HTML page."""

        # Publishers commonly expose feeds through:
        # <link rel="alternate" type="application/rss+xml" href="...">
        candidates = response.xpath(
            "//link[contains(translate(@type, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'rss') "
            "or contains(translate(@type, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'atom') "
            "or contains(translate(@type, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'xml')]/@href"
        ).getall()

        for candidate in candidates:
            absolute_url = response.urljoin(candidate)
            if absolute_url:
                return absolute_url

        return None

    def parse_feed(self, response):
        """Parse RSS/Atom entries and queue article page requests."""

        site_name = response.meta["site_name"]

        if response.status >= 400:
            return

        # Support RSS <channel><item> and Atom <feed><entry>.
        entries = response.xpath(
            "//*[local-name()='channel']/*[local-name()='item'] | "
            "/*[local-name()='feed']/*[local-name()='entry']"
        )

        # If a feed is empty/broken, attempt website discovery instead.
        if not entries:
            if response.meta.get("common_feed_probe"):
                return
            print(f"LOG: {site_name} feed is empty or invalid. Falling back to website scan.", flush=True)
            yield from self.request_website_fallback(response.meta)
            return

        queued = 0

        for entry in entries:
            # Keep per-source feed work bounded.
            if queued >= self.MAX_RSS_CANDIDATES:
                break

            # RSS/Atom title is a hint. The final title is still re-extracted
            # from the article page.
            title = self.clean_text(entry.xpath("string(./*[local-name()='title'][1])").get())

            # RSS and Atom represent links differently. Try href first, then
            # element text, then guid as fallback.
            link = (
                entry.xpath("./*[local-name()='link'][1]/@href").get()
                or entry.xpath("string(./*[local-name()='link'][1])").get()
                or entry.xpath("string(./*[local-name()='guid'][1])").get()
            )

            # Feeds may use pubDate, published, or updated.
            published = self.parse_published_date(
                entry.xpath("string(./*[local-name()='pubDate'][1])").get()
                or entry.xpath("string(./*[local-name()='published'][1])").get()
                or entry.xpath("string(./*[local-name()='updated'][1])").get()
            )

            # Date filtering happens early to avoid requesting old article pages.
            if published and not self.is_in_range(published):
                continue

            request = self.article_request(
                urljoin(response.url, str(link or "").strip()),
                site_name,
                title=title,
                published=published,
                method="RSS",
                configured_url=response.meta.get("configured_url"),
                source_home=response.meta.get("source_home"),
            )

            if request:
                queued += 1
                yield request

        print(f"LOG: {site_name} feed supplied {queued} article candidates.", flush=True)

    def handle_source_error(self, failure):
        """Configured source URL failed; attempt website fallback."""

        site_name = failure.request.meta["site_name"]
        print(f"LOG: Feed unavailable for {site_name}. Trying website discovery.", flush=True)
        yield from self.request_website_fallback(failure.request.meta)

    def handle_feed_error(self, failure):
        """Discovered feed URL failed; attempt website fallback."""

        site_name = failure.request.meta["site_name"]
        print(f"LOG: Discovered feed failed for {site_name}. Trying website discovery.", flush=True)
        yield from self.request_website_fallback(failure.request.meta)

    def request_website_fallback(self, meta):
        """Queue the source homepage when feed-based crawling cannot be used."""

        site_name = meta["site_name"]

        # Do not fallback more than once per source in a single crawl. A source
        # can fail through the configured URL and a discovered feed URL; without
        # this guard, both failures could request the same homepage again.
        if site_name in self.fallback_sources:
            return

        self.fallback_sources.add(site_name)

        yield scrapy.Request(
            # source_home is scheme + domain, for example:
            # https://example.com/
            meta["source_home"],
            # The homepage/listing parser will inspect links and pick likely
            # article pages.
            callback=self.parse_listing_page,
            # Website fallback is the final discovery attempt for this source.
            errback=self.handle_website_error,
            # Keep the same site_name/configured_url/source_home context.
            meta=meta,
            # Allow this request even if the source homepage was already seen in
            # another branch of the same crawl.
            dont_filter=True,
        )

    def handle_website_error(self, failure):
        """Log final source-discovery failure without stopping the whole crawl."""

        # One broken source must not fail the whole deep scan. Scrapy continues
        # processing other queued sources and articles.
        print(f"LOG: Website discovery failed for {failure.request.meta['site_name']}.", flush=True)

    def parse_listing_page(self, response):
        """Score links from a normal website page and queue article candidates."""

        site_name = response.meta["site_name"]
        next_depth = int(response.meta.get("discovery_depth", 0)) + 1

        # candidates stores tuples:
        #
        #     (score, normalized_article_url, title_hint_from_anchor)
        #
        # The highest scores are requested first.
        candidates = []

        # Used only inside this listing page so one URL is not added twice from
        # multiple selectors.
        candidate_urls = set()

        # Many modern publisher homepages expose story URLs only in JSON-LD
        # ItemList/NewsArticle data, even when visible anchors are generated by
        # JavaScript. Add those URLs to the same scoring pipeline.
        jsonld_links = []
        for raw in response.xpath("//script[@type='application/ld+json']/text()").getall():
            try:
                self.collect_jsonld_urls(json.loads(raw), jsonld_links)
            except (TypeError, ValueError):
                continue
        for link, title_hint in jsonld_links:
            normalized = self.normalize_article_url(response.urljoin(link))
            if not normalized or normalized in candidate_urls:
                continue
            score = self.story_link_score(
                normalized,
                title_hint,
                response.url,
                5,
                configured_url=response.meta.get("configured_url"),
            )
            if score >= 4:
                candidate_urls.add(normalized)
                candidates.append((score, normalized, title_hint))

        # Different page regions are more or less likely to contain real news
        # stories. Links inside <article> get the highest starting score. Links
        # in <main> are useful but less precise. Body links are the broadest
        # fallback and are scored lowest.
        selector_groups = [
            (4, "//article//a[@href]"),
            (3, "//main//a[@href][not(ancestor::nav or ancestor::header or ancestor::footer or ancestor::aside)]"),
            (1, "//body//a[@href][not(ancestor::nav or ancestor::header or ancestor::footer or ancestor::aside or ancestor::form)]"),
        ]

        for context_score, selector in selector_groups:
            for anchor in response.xpath(selector):
                # Convert relative links such as /news/story to absolute URLs.
                link = response.urljoin(anchor.xpath("@href").get() or "")

                # The visible anchor text is a title hint. It helps scoring and
                # becomes the seed title if the article page has no usable title.
                title_hint = self.clean_text(" ".join(anchor.xpath(".//text()").getall()))

                # Normalize before dedupe so tracking URLs collapse to the same
                # canonical article URL.
                normalized = self.normalize_article_url(link)

                if not normalized or normalized in candidate_urls:
                    continue

                # story_link_score rejects non-articles with -1 and gives likely
                # article pages a positive score.
                score = self.story_link_score(
                    normalized,
                    title_hint,
                    response.url,
                    context_score,
                    configured_url=response.meta.get("configured_url"),
                )

                # A minimum score of 4 means at least one strong signal exists,
                # such as <article> context, a date in the URL, or a news path.
                if score < 4:
                    continue

                candidate_urls.add(normalized)
                candidates.append((score, normalized, title_hint))

        # Request the strongest candidates first.
        candidates.sort(key=lambda candidate: candidate[0], reverse=True)

        queued = 0

        # Bound website-discovery requests per source so large homepages cannot
        # explode into hundreds of article downloads.
        for _, link, title_hint in candidates[:self.MAX_HTML_CANDIDATES]:
            request = self.article_request(
                link,
                site_name,
                title=title_hint,
                published=None,
                method="Website Discovery",
                discovery_depth=next_depth,
                configured_url=response.meta.get("configured_url"),
                source_home=response.meta.get("source_home"),
            )

            if request:
                queued += 1
                yield request

        print(f"LOG: {site_name} website supplied {queued} likely article candidates.", flush=True)

    def collect_jsonld_urls(self, value, output, inherited_title=""):
        """Collect URL/title pairs from nested NewsArticle and ItemList JSON-LD."""

        if isinstance(value, list):
            for item in value:
                self.collect_jsonld_urls(item, output, inherited_title)
            return
        if not isinstance(value, dict):
            return
        title = self.clean_text(value.get("headline") or value.get("name") or inherited_title)
        article_url = value.get("url") or value.get("mainEntityOfPage")
        if isinstance(article_url, dict):
            article_url = article_url.get("@id") or article_url.get("url")
        if isinstance(article_url, str) and title:
            output.append((article_url, title))
        for nested in value.values():
            if isinstance(nested, (list, dict)):
                self.collect_jsonld_urls(nested, output, title)

    def story_link_score(
        self,
        link,
        title_hint,
        listing_url,
        context_score,
        configured_url=None,
    ):
        """Return a confidence score that a discovered link is a real story."""

        parsed = urlparse(link)
        origin = urlparse(listing_url)

        # Only crawl links on the same domain as the source page. This avoids
        # following ads, social links, CDNs, and unrelated partner sites.
        if parsed.netloc.lower().removeprefix("www.") != origin.netloc.lower().removeprefix("www."):
            return -1

        path = parsed.path.lower()

        # A configured section such as /technology/news must not inherit every
        # link from the publisher-wide navigation. Keep discovery inside that
        # section's first path segment; homepage sources remain unrestricted.
        configured_path = urlparse(configured_url or "").path.lower()
        configured_parts = [part for part in configured_path.split("/") if part]
        if (
            configured_parts
            and not configured_path.endswith((".xml", ".rss", "/feed", "/rss"))
            and path != f"/{configured_parts[0]}"
            and not path.startswith(f"/{configured_parts[0]}/")
        ):
            return -1

        # Reject dated archive/story URLs outside the requested window before
        # queueing them. Some homepages expose months of daily archive links;
        # downloading all of those makes a one-day scan unnecessarily huge.
        url_date = self.date_from_url(path)
        if url_date and not self.is_in_range(url_date):
            return -1

        # Empty/home URLs and non-HTML assets are not articles.
        if path in ("", "/") or path.endswith(self.NON_ARTICLE_EXTENSIONS):
            return -1

        # Skip source-level pages like tags, topics, authors, login, privacy,
        # podcasts, and videos. These can contain many links but are not stories.
        if any(blocked in path for blocked in self.BLOCKED_PATH_PARTS):
            return -1

        label = title_hint.strip().lower()

        # Links with generic labels are usually navigation, not news.
        if label in self.NON_STORY_LABELS:
            return -1

        # Start with the score implied by where the link was found.
        score = context_score

        # Many publishers put dates in story URLs. That is a strong article sign.
        if re.search(r"/20\d{2}/\d{1,2}/|\b20\d{2}[-/]\d{2}", path):
            score += 3

        # Common story URL sections. This is not required, but boosts confidence.
        if any(marker in path for marker in ("/news/", "/article/", "/story/", "/tech/", "/business/")):
            score += 2

        # Multi-segment paths are more likely to be individual pages than the
        # homepage or top-level category.
        if len([part for part in path.split("/") if part]) >= 2:
            score += 1

        # A descriptive anchor with at least four words is more article-like than
        # short navigation labels.
        if len(title_hint.split()) >= 4:
            score += 1

        return score

    @staticmethod
    def date_from_url(path):
        """Extract common YYYY-MM-DD or /YYYY/MM/DD dates from a URL path."""

        match = re.search(r"/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)", str(path or ""))
        if not match:
            return None
        try:
            return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3))).date()
        except ValueError:
            return None

    def article_request(
        self,
        url,
        site_name,
        title,
        published,
        method,
        discovery_depth=0,
        configured_url=None,
        source_home=None,
    ):
        """Create a Scrapy request for one normalized article page."""

        # Normalize every URL before queueing. This filters bad URLs, strips
        # tracking parameters, and creates a stable dedupe key.
        normalized = self.normalize_article_url(url)

        if not normalized or normalized in self.seen_article_urls:
            return None

        # Per-run dedupe across RSS and website discovery.
        self.seen_article_urls.add(normalized)

        return scrapy.Request(
            normalized,
            callback=self.parse_article_page,
            errback=self.handle_article_error,
            meta={
                # Publisher/source name shown in the UI.
                "site_name": site_name,
                # Title/date hints from RSS or anchor text. The article page can
                # override them with cleaner metadata.
                "seed_title": title,
                "seed_date": published,
                # Explains whether this article came from RSS or website
                # fallback. Useful for debugging source quality.
                "method": method,
                "discovery_depth": discovery_depth,
                "configured_url": configured_url or normalized,
                "source_home": source_home or self.source_home(configured_url or normalized),
            },
        )

    def normalize_article_url(self, url):
        """Return a canonical article URL or None when the URL is not crawlable."""

        try:
            parsed = urlsplit(str(url or "").strip())

            # Only public HTTP(S) pages are crawlable article candidates.
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                return None

            path = parsed.path or "/"

            # Reject obvious non-article assets even if discovered in a link.
            if path.lower().endswith(self.NON_ARTICLE_EXTENSIONS):
                return None

            # Remove tracking parameters while preserving meaningful query
            # parameters, because some publishers use query parameters to route
            # article pages.
            query = urlencode([
                (key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                if not key.lower().startswith("utm_") and key.lower() not in self.TRACKING_PARAMS
            ])

            # Lowercase the domain and remove trailing slash from paths so
            # duplicates collapse consistently:
            #
            #     https://EXAMPLE.com/story/
            #     https://example.com/story
            #
            # become the same URL.
            return urlunsplit((parsed.scheme, parsed.netloc.lower(), path.rstrip("/") or "/", query, ""))

        except ValueError:
            # urlsplit raises ValueError on malformed URLs. Treat them as
            # non-crawlable instead of crashing the crawl.
            return None

    def handle_article_error(self, failure):
        """Log failed article downloads and continue the crawl."""

        print(f"LOG: Article request failed: {failure.request.url[:80]}", flush=True)

    def parse_article_page(self, response):
        """Extract, validate, keyword-filter, and yield one clean article item."""

        seed_title = response.meta.get("seed_title", "")
        site_name = response.meta["site_name"]

        # The article extractor expects text/HTML. Skip binary or non-text pages.
        if not isinstance(response, TextResponse):
            print(f"LOG: Skipped non-text article from {site_name}: {response.url[:65]}", flush=True)
            return

        article = None

        try:
            # newspaper3k builds a structured article object from the HTML that
            # Scrapy already downloaded. No AI model runs here.
            article = Article(response.url, config=self.news_config)

            # Passing input_html avoids asking newspaper3k to perform a fresh
            # network fetch for this article body.
            article.download(input_html=response.text)

            # parse() extracts title, body text, image, authors, and publish date
            # using publisher metadata plus readability-style heuristics.
            article.parse()

        except Exception as error:
            # A parser failure is not fatal; the fallback HTML paragraph extractor
            # below can still recover the body text.
            print(f"LOG: Structured extraction failed for {response.url[:70]}: {error}", flush=True)

        # Publisher-wide document titles such as "Berita" or "Technology
        # News" are common and make unrelated stories look identical to the
        # clustering layer. Prefer article-specific structured metadata and the
        # visible H1 before newspaper3k's document-title fallback.
        title = self.extract_article_title(response, article, seed_title)

        # Some publisher homepages link to dated archive pages first (for
        # example /articles/2026-07-22.html). Those pages contain many actual
        # story links and enough text to look like a long article. Detect them
        # before body extraction and use them as one additional discovery layer.
        if self.is_listing_or_archive_page(response, title):
            depth = int(response.meta.get("discovery_depth", 0))
            if depth <= 2:
                print(f"LOG: Expanding archive/listing page: {response.url[:70]}", flush=True)
                yield from self.parse_listing_page(response)
            return

        # Primary body text from newspaper3k.
        extracted_text = self.clean_text(article.text if article else "")

        # Fallback body text from visible paragraphs in article/main.
        fallback_text = self.extract_clean_body_text(response)

        # Prefer structured extraction if it is long enough. Otherwise use the
        # paragraph fallback because many sites hide article text in custom DOMs.
        full_text = extracted_text if len(extracted_text.split()) >= self.MIN_ARTICLE_WORDS else fallback_text

        # Reject thin/non-story pages. This protects the AI layer from receiving
        # navigation pages or empty publisher error pages.
        if not title or len(full_text.split()) < self.MIN_ARTICLE_WORDS:
            print(f"LOG: Skipped non-article or thin page from {site_name}: {response.url[:65]}", flush=True)
            return

        # Publish date priority:
        # 1. newspaper3k parsed publish_date
        # 2. seed date from RSS/Atom
        # 3. later fallback at item creation uses datetime.now()
        publish_date = (
            self.normalize_datetime(article.publish_date if article else None)
            or response.meta.get("seed_date")
            or self.extract_page_date(response)
        )

        # Date filter is applied again after article extraction because website
        # fallback does not know article dates before opening the article page.
        if publish_date and not self.is_in_range(publish_date):
            return

        # Keyword filtering is the final crawler-level relevance check. The
        # bouncer model and clustering happen after raw collection.
        found_keywords = self.find_keywords(f"{title} {full_text}")

        if not found_keywords:
            return

        # This is a lightweight crawler summary, not the final BART summary.
        # semantic_clustering.py later creates master_summary/ppt_summary.
        quick_summary = self.make_summary(full_text)

        # This dictionary is the raw article JSON shape written to ui_results_*.json.
        item = {
            "source": site_name,
            "title": title,
            "link": response.url,
            "date": str((publish_date or datetime.now()).date()),
            "snippet": quick_summary,
            "full_content": full_text,
            "top_image": (article.top_image if article else "") or self.extract_image(response),
            "authors": list(article.authors) if article and article.authors else [],
            "summary": quick_summary,
            "keywords_found": found_keywords,
            "word_count": len(full_text.split()),
            "method": response.meta.get("method", "Website Discovery"),
        }

        print(f"LOG: Collected clean article: {title[:55]}...", flush=True)

        # After this yield, Scrapy sends the item through ITEM_PIPELINES in
        # settings.py. With SENSE_STREAM_ITEMS=1, LiveStreamPipeline prints the
        # JSON item immediately so FastAPI can bouncer-check and stream cards
        # while the crawl is still running.
        yield item

    def is_listing_or_archive_page(self, response, title):
        """Return True for category/date indexes that should not become cards."""

        path = urlparse(response.url).path.lower().rstrip("/")
        generic_title = self.clean_text(title).lower()
        archive_path = bool(
            re.search(r"/(?:articles?|archive)/20\d{2}[-/]\d{1,2}[-/]?\d{0,2}(?:\.html?)?$", path)
            or re.search(r"/(?:news|latest|articles?|archive)$", path)
        )
        archive_title = any(
            phrase in generic_title
            for phrase in (
                "news today", "latest news", "news archive", "all articles",
                "advertising, marketing, media", "news and views",
                "technology news", "latest mobile phones", "smartphone reviews",
            )
        )
        story_links = response.xpath(
            "//article//a[@href] | //main//a[@href][not(ancestor::nav or ancestor::header or ancestor::footer)]"
        )
        # Long comma-separated SEO titles usually describe a publisher section
        # rather than one story (for example: "Technology News, Latest Mobile
        # Phones, Smartphone Reviews, ..."). Only classify them as listings when
        # the page also exposes several story links.
        path_depth = len([part for part in path.split("/") if part])
        seo_section_title = (
            path_depth <= 1
            and generic_title.count(",") >= 2
            and len(generic_title.split()) >= 8
        )
        return (archive_path or archive_title or seo_section_title) and len(story_links) >= 3

    def extract_article_title(self, response, article=None, seed_title=""):
        """Return the most article-specific title available on the page."""

        jsonld_headlines = []
        for raw in response.xpath("//script[@type='application/ld+json']/text()").getall():
            try:
                self.collect_jsonld_headlines(json.loads(raw), jsonld_headlines)
            except (TypeError, ValueError):
                continue

        candidates = [
            *jsonld_headlines,
            response.xpath("string((//main//h1 | //article//h1 | //h1)[1])").get(),
            response.xpath("string(//meta[@property='og:title']/@content)").get(),
            seed_title,
            article.title if article else "",
        ]
        cleaned_candidates = []
        for candidate in candidates:
            cleaned = self.clean_text(candidate)
            if cleaned:
                cleaned_candidates.append(cleaned)
                if not self.is_generic_document_title(cleaned):
                    return cleaned
        return cleaned_candidates[0] if cleaned_candidates else ""

    @staticmethod
    def is_generic_document_title(title):
        """Identify publisher/category labels that are not story headlines."""

        normalized = " ".join(str(title or "").lower().split()).strip(" -|:")
        return normalized in {
            "article", "articles", "berita", "latest", "latest news", "news",
            "news today", "technology", "technology news", "top stories",
        }

    def collect_jsonld_headlines(self, value, output):
        """Collect headlines only from JSON-LD article objects."""

        if isinstance(value, list):
            for item in value:
                self.collect_jsonld_headlines(item, output)
            return
        if not isinstance(value, dict):
            return

        raw_types = value.get("@type", [])
        types = raw_types if isinstance(raw_types, list) else [raw_types]
        normalized_types = {str(item).lower() for item in types}
        if normalized_types.intersection({"article", "newsarticle", "reportagenewsarticle"}):
            headline = self.clean_text(value.get("headline") or value.get("name"))
            if headline:
                output.append(headline)

        for nested in value.values():
            if isinstance(nested, (list, dict)):
                self.collect_jsonld_headlines(nested, output)

    def extract_clean_body_text(self, response):
        """Fallback body extractor that reads visible article/main paragraphs."""

        # Exclude layout/navigation areas so fallback text does not include menus,
        # footer links, cookie forms, or scripts.
        excluded = (
            "not(ancestor::header or ancestor::nav or ancestor::footer or "
            "ancestor::aside or ancestor::form or ancestor::button or "
            "ancestor::script or ancestor::style or ancestor::*[@role='navigation'])"
        )

        # First try <article>, the semantic HTML container for story content.
        paragraphs = response.xpath(f"//article//p[{excluded}]//text()").getall()

        # If the page does not use <article>, try <main>.
        if not paragraphs:
            paragraphs = response.xpath(f"//main//p[{excluded}]//text()").getall()

        return self.clean_text(" ".join(paragraphs))

    def extract_image(self, response):
        """Return a representative article image from publisher metadata."""

        # OpenGraph and Twitter metadata are the most reliable image hints for
        # news cards.
        return (
            response.xpath("//meta[@property='og:image']/@content").get()
            or response.xpath("//meta[@name='twitter:image']/@content").get()
            or ""
        )

    def find_keywords(self, text):
        """Return configured keywords that appear in title/body text."""

        # Patterns were compiled in __init__ for case-insensitive whole-token
        # matching. This avoids accidental matches inside unrelated words.
        return [
            keyword for keyword, pattern in self.keyword_patterns
            if pattern.search(text or "")
        ]

    def extract_page_date(self, response):
        """Read common HTML metadata and JSON-LD publication dates."""

        candidates = response.xpath(
            "//meta[@property='article:published_time' or "
            "@property='og:published_time' or @name='pubdate' or "
            "@name='publish-date' or @name='date' or "
            "@itemprop='datePublished']/@content | "
            "//time/@datetime"
        ).getall()
        for raw in response.xpath("//script[@type='application/ld+json']/text()").getall():
            try:
                payload = json.loads(raw)
            except (TypeError, ValueError):
                continue
            stack = payload if isinstance(payload, list) else [payload]
            while stack:
                value = stack.pop()
                if isinstance(value, list):
                    stack.extend(value)
                elif isinstance(value, dict):
                    candidates.extend(
                        str(value[key])
                        for key in ("datePublished", "dateCreated", "dateModified")
                        if value.get(key)
                    )
                    stack.extend(v for v in value.values() if isinstance(v, (list, dict)))
        for candidate in candidates:
            parsed = self.parse_published_date(candidate)
            if parsed:
                return parsed
        return None

    @staticmethod
    def normalize_datetime(value):
        """Parse publisher dates into naive datetime objects for comparison."""

        if not value:
            return None

        # newspaper3k may already return datetime.
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)

        try:
            # RSS/Atom dates can contain timezone abbreviations such as PDT.
            # TZINFOS handles known labels so dateutil does not warn or guess.
            return parser.parse(str(value), tzinfos=NewsSpider.TZINFOS).replace(tzinfo=None)

        except (ValueError, TypeError, OverflowError):
            # Bad publisher dates should not crash a scan.
            return None

    def parse_published_date(self, value):
        """Named wrapper used by feed parsing for readability."""

        return self.normalize_datetime(value)

    @staticmethod
    def clean_text(value):
        """Collapse whitespace and convert None into an empty string."""

        return re.sub(r"\s+", " ", str(value or "")).strip()

    def make_summary(self, text):
        """Create a short crawler-side summary from the first few sentences."""

        # This summary is intentionally simple and fast. It gives the UI and
        # bouncer enough context before semantic_clustering.py creates richer
        # summaries.
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", text)
            if sentence.strip()
        ]

        # Prefer sentence boundaries. If sentence splitting fails, take the first
        # 700 characters as a defensive fallback.
        summary = " ".join(sentences[:4]) if sentences else text[:700]

        # Keep the raw crawl item compact. The full article text is already saved
        # in full_content for the summarization/clustering stage.
        return summary[:1000].strip()
