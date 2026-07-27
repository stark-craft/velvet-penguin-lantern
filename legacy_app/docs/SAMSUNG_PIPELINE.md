# Samsung Web Search and Chat Production Pipeline

## Preflight and runtime order

When all three switches are enabled:

```dotenv
SAMSUNG_PIPELINE_ENABLED=true
WEB_SEARCH_ENRICHMENT_ENABLED=true
FINAL_CHAT_SUMMARY_ENABLED=true
```

the production scheduler and manual scan first make one authenticated health
request to each Samsung service. The result is cached for 15 minutes by
default.

The preflight selects one safe mode before Scrapy starts:

| Web Search | Chat | Scrapy behavior | Summary behavior |
|---|---|---|---|
| available | available | URL discovery only | Samsung Chat |
| available | unavailable | URL discovery only | local BART + FLAN-T5 |
| unavailable | available | full crawl and extraction | Samsung Chat |
| unavailable | unavailable | full crawl and extraction | local BART + FLAN-T5 |

This prevents a failed Web Search preflight from causing two crawls. After the
decision, the chosen production flow is:

```text
Configured RSS feeds and websites
  -> Scrapy discovers matching article URLs, titles, and dates
  -> Samsung Web Search returns references for the exact linked article
  -> Python rejects every non-exact URL returned by Web Search
  -> A targeted TLS-verified page fetch completes snippet-only references
  -> Extracted content is validated against profile keywords
  -> Default or Broadcast Bouncer scores the extracted content
  -> Missing image metadata is recovered
  -> Local semantic model clusters duplicate coverage
  -> Samsung Chat or local BART creates the final structured intelligence
  -> The profile briefing is archived and served
```

Scrapy still reads RSS feeds and publisher listing pages. In Samsung discovery
mode it does not download and parse each article body. The exact article URL is
included in the Web Search request.

The proven API response can include unrelated domains even when a prompt asks
for one site, and can mark a reference as `scraping: false`. The adapter
therefore treats `content_references` as untrusted discovery metadata:

- only the exact normalized URL supplied by Scrapy is accepted;
- a similar title or matching domain cannot substitute another story;
- YouTube, TikTok, category pages, and other noise are rejected unless they
  are literally the authoritative URL discovered by the configured source;
- `publisher`, `published_time`, `similarity`, `query`, and `scraping` are
  mapped into explicit article metadata;
- when `scraping` is false, one targeted fetch extracts the complete body,
  publication date, and image from that exact URL;
- if exact completion fails, the candidate fails enrichment instead of being
  presented as a full article.

## Structured Chat result

The adapter uses the confirmed non-streaming Samsung Chat contract:

- route: `/api-chat/openapi/chat/v1/messages`;
- `modelIds`: one configured model ID in an array;
- `contents`: the prompt in an array;
- `isStream`: `false`;
- `llmConfig`: includes `seed: null`, token limit, top-k, top-p,
  temperature, and repetition penalty;
- authentication headers: `x-generative-ai-client` and
  `x-openapi-token`.

If an older `.env` contains only the product base URL ending in `/api-chat`,
the adapter upgrades it to the confirmed messages route automatically. A 404
prints a route-specific diagnostic and a sanitized response excerpt.

TLS verification remains enabled. If the company network uses a private
certificate authority, configure the CA bundle described in the deployment
guide rather than setting verification to false.

Samsung Chat is instructed to return strict JSON containing:

```json
{
  "title": "Factual headline",
  "summary_lead": "One or two sentences explaining the event.",
  "key_points": [
    "First important factual point.",
    "Second important factual point.",
    "Third important factual point."
  ],
  "ppt_summary": "Presentation-ready version.",
  "why_it_matters": "Strategic implication.",
  "article_intent": "Product Launch",
  "category": "Artificial Intelligence",
  "region": "Global",
  "importance_score": 8
}
```

Responses without a lead or usable key points fail validation and do not
replace the existing clustered summary.

The dossier renders the lead as readable prose and the important points as
separate bullets. “Why This Matters” uses the stored Chat result, avoiding a
second FLAN-T5 call.

When Samsung Chat passes preflight, the backend does not load FLAN-T5 at
startup and semantic clustering runs in fast mode without loading BART. If
Chat fails preflight, BART is used during clustering and FLAN-T5 is loaded
lazily when strategic insight is requested. MiniLM remains active because
clustering and the Bouncer still require embeddings.

## Quota protection

Samsung Web Search and Samsung Chat each have a separate, thread-safe limiter:

```dotenv
SAMSUNG_WEB_SEARCH_REQUESTS_PER_MINUTE=3
SAMSUNG_CHAT_REQUESTS_PER_MINUTE=3
```

Values above three are capped at three. Calls are spaced by at least twenty
seconds. Scheduler and manual-scan threads share the same limiter within the
single Uvicorn process.

Keep Uvicorn at one worker. Multiple workers would have independent in-memory
rate limiters and could exceed the service quota.

## Successful-result cache

Successful results are stored under:

```text
news_scrapper\runtime\samsung_pipeline_cache\
├── web_search_success.json
└── chat_summary_success.json
```

Web Search cache identity uses canonical URL, title, and date. Chat cache
identity additionally includes clustered source URLs and an extracted-content
hash. Changed article content therefore produces a new Chat request.

Only successful responses are cached. Failed responses remain retryable.

## Failure behavior and terminal diagnostics

- Every run prints a `PIPELINE:PRECHECK` block before Scrapy launches.
- A successful service prints `PASS` and its latency.
- A failed service prints `FAIL`, the exact exception type/message, and the
  selected local fallback.
- A Web Search preflight failure switches Scrapy to full article extraction.
- A failed Web Search article extraction is rejected after a successful
  preflight. A minimal discovery record is never presented as complete.
- If all Web Search items fail, the scheduler retains the previous briefing
  instead of archiving an empty replacement.
- A Chat preflight failure selects BART before clustering starts.
- A per-article Chat failure after a successful preflight sends that article
  through local BART and logs its title and error.
- Local BART output is normalized into the same lead-plus-bullets dossier
  contract as Samsung Chat.
- A dossier without a stored Chat implication uses local FLAN-T5 when present,
  then a deterministic strategic fallback if FLAN-T5 cannot load.
- Missing image enrichment does not remove the article.
- One broken publisher does not stop other Scrapy sources.

## Profile isolation

Default and Broadcast retain separate:

- source files;
- keywords;
- Bouncer models;
- Bouncer training;
- history directories;
- workflow files.

The Samsung cache may reuse an identical public article extraction, but
keyword validation, Bouncer decisions, clustering, and briefing storage remain
profile-specific.

## Activation checklist

Start with the copy-ready environment template:

```text
.env.example
```

Copy its contents into the production `.env`, then:

1. Add valid Web Search client and token.
2. Add valid Chat client, token, and model ID.
3. Keep TLS verification enabled.
4. Configure a company CA bundle if Windows trust is insufficient.
5. Set the three enable switches to `true`.
   Optionally set `SAMSUNG_HEALTH_CACHE_SECONDS=900`.
6. Restart the backend because adapter credentials are loaded at process start.
7. Open `/status` and verify:

```json
{
  "pipeline": {
    "mode": "samsung_web_search_and_chat",
    "discovery_only": true,
    "web_search_enabled": true,
    "chat_summary_enabled": true,
    "automatic_local_fallback": true
  }
}
```

8. Run one small manual scan before the full scheduler.
9. Confirm the terminal reports URL discovery, Web Search extraction,
   Gatekeeper scoring, semantic clustering, and Samsung Chat summarization.

## Token capacity and request limit

The supplied working proof establishes a service allowance of up to three
requests per minute and a very large context capacity. The application
enforces the three-RPM ceiling independently for Web Search and Chat.

The current production contract does not impose an application-side character
limit on Samsung Chat input:

- one article is summarized per Chat request;
- the complete extracted article is placed in `contents`;
- generated output is capped at 900 tokens;
- successful summaries are cached;
- repeated articles do not call Chat again.

This conservative single-article contract matches the supplied working test.
The service's larger context capacity leaves room for a future batch mode, but
batching is not enabled until an actual multi-article response schema is
validated. This prevents one malformed batch response from losing summaries
for many articles.

## Local mode

When `SAMSUNG_PIPELINE_ENABLED=false`, the established crawler extraction,
local semantic processing, BART/manual summarization, and FLAN-T5 insight path
remain available. This preserves a controlled rollback path.

## Saved for Later

Feed cards and dossiers now expose Save for Later. The backend stores saved
articles in `news_scrapper/runtime/viewer_saved_store.json`, isolated by the
viewer IP hash and active profile. Saved items do not yet alter ranking; that
remains deliberately reserved for the personalization phase.
