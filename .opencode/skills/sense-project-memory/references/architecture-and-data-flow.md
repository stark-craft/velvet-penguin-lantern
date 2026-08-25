# Architecture and data flow

## One server and one frontend

The active platform deliberately runs as one backend and one frontend:

```text
Browser
  -> React/Vite single-page application
     -> For You / Briefing / Scan / Desk / workflow
     -> Research and Venture Lens
     -> Samsung Internal and Internal Publishing
  -> FastAPI main.py on port 8000
     -> NewsScrapper application and scheduler
     -> recommendation router
     -> Korean translation router
     -> Venture Lens router
     -> built frontend/static assets in production
```

`legacy_app/main.py` imports the FastAPI `app` from
`news_scrapper/application.py`, includes the Venture Lens, translation, and
recommendation routers, then serves the SPA. API prefixes must return real API
404s rather than silently falling through to `index.html`.

In development Vite runs on port 5173 and proxies same-origin API paths to
127.0.0.1:8000. In production `npm run build` creates the bundle and FastAPI
serves it. Frontend requests therefore use relative paths in both environments.

## Active backend boundaries

- `core/settings.py`: project paths, `.env` loading, runtime creation, frontend
  dist detection, and idempotent legacy/unified migrations.
- `core/storage.py`: atomic JSON storage.
- `core/rate_limit.py`: process-wide Samsung service pacing.
- `core/secure_http.py`: verified TLS, system certificate store and CA bundles.
- `news_scrapper/application.py`: news APIs, workflow, crawler orchestration,
  scheduler, Gatekeeper, training queue, exports, retention and analytics.
- `news_scrapper/source_catalog.py`: unifies technology and broadcast catalogs
  while preserving vertical metadata and rollback inputs.
- `news_scrapper/crawler/.../universal_spider.py`: one spider capable of RSS and
  normal listing/article pages.
- `news_scrapper/adapters/samsung_web_search.py`: exact-URL extraction and
  metadata mapping using Samsung Web Search.
- `news_scrapper/adapters/samsung_chat.py`: structured intelligence generation.
- `news_scrapper/adapters/article_metadata.py`: missing image metadata.
- `news_scrapper/semantic_clustering.py`: MiniLM clustering, sentiment, and BART
  local summary fallback.
- `news_scrapper/train_bouncer.py`: one authoritative unified classifier.
- `news_scrapper/recommendation/`: signed viewer identity, preferences, events,
  ranking, diversity, explainability and For You endpoints.
- `news_scrapper/translation.py`: private English-to-Korean local inference API.
- `venture_lens/`: GitHub repository and arXiv research providers, caches,
  comparison, watchlist, notification and dossier APIs.

## Unified content model

The former Default and Broadcast products were merged non-destructively.
Current production defaults in `.env.example` are:

```text
UNIFIED_CORPUS_ENABLED=true
LEGACY_PROFILE_ROUTING_ENABLED=false
BROADCAST_VISIBILITY_MODE=interest
```

Consequences:

- `news_scrapper/config/sites.json` is the active catalog and already contains
  technology plus broadcast sources.
- Broadcast entries keep `verticals`, `keyword_pack`, and `legacy_profile`
  metadata so filters and personalization can distinguish them.
- `sites_broadcast.json` is retained for rollback/reconciliation, not a second
  production scheduler input.
- There is one scheduler scan per interval, one current briefing corpus, one
  workflow store, one training dataset, and one authoritative Bouncer.
- Broadcast is a user-selectable interest/filter, not an IP-address profile.
- Stale frontend profile overrides are removed in unified mode.

Do not reintroduce two scheduler runs or IP-based profile routing unless the
user explicitly requests a rollback.

## Scheduler-to-feed flow

Startup and each four-hour run follow this shape:

```text
FastAPI lifespan
  -> ensure runtime directories
  -> idempotently migrate legacy state; preserve rollback files
  -> resume pending private URL briefing jobs
  -> load/retrain the authoritative unified Bouncer if needed
  -> inspect latest unified briefing timestamp
  -> register one APScheduler job (max_instances=1, coalesced, 24h grace)

scheduled run
  -> authenticated Samsung Web Search and Chat preflight
  -> choose one safe mode before crawling
  -> Scrapy reads enabled RSS/listing/web sources and matches dates/keywords
  -> Web Search exact-URL extraction when healthy, or full Scrapy extraction
  -> keyword/date/content validation
  -> Gatekeeper/Bouncer scoring and dropping
  -> missing image metadata enrichment
  -> MiniLM semantic clustering and cross-source deduplication
  -> Samsung Chat structured intelligence when healthy
  -> local BART summary + FLAN/deterministic implication fallback on failure
  -> atomic unified briefing archive
  -> shared Briefing endpoint and private For You ranking
```

The preflight prevents an avoidable double crawl. If Web Search is available,
Scrapy can do URL discovery only. If it is unavailable before crawling, Scrapy
does full extraction. If Web Search dies after a successful preflight, the run
requests one explicit full-Scrapy retry rather than publishing incomplete
discovery records.

### Samsung Web Search contract

- It is the preferred article extraction/enrichment service when configured.
- The proven response includes `content` and `content_references` with fields
  such as title, link, content, similarity, published time, publisher and query.
- Prompt/domain restrictions are not trusted. Python verifies the canonical
  exact article URL and allowed domain.
- Unrelated domains, category pages, video/social noise, or similar-title
  substitutions are rejected.
- If the exact reference lacks body/date/image, one targeted verified fetch may
  complete it.
- Service quota is at most three requests per minute, shared in the single
  process. Credentials and internal endpoints live only in `.env`.

### Samsung Chat contract

- It is the primary final intelligence generator when preflight succeeds.
- The request uses the confirmed full messages route, authentication headers,
  `modelIds` as an array with one configured ID, `contents` as an array, and
  non-streaming generation.
- It returns the same UI contract required by local fallbacks:
  `summary_lead`, `key_points`, `ppt_summary`, `why_it_matters`, intent,
  category, region, and importance score.
- The dossier shows a short prose lead and separately styled bullet points.
  `why_it_matters` is stored from the same response when available.
- No arbitrary 12,000-character truncation should discard the evidence needed
  for clustering or summarization. Practical request-size protection must be
  explicit and justified by the real service limit.
- Quota is at most three requests per minute. Successful results are cached;
  failures remain retryable and choose local fallbacks with clear terminal logs.

### Local model behavior

Local models belong under `legacy_app/model_weights/` in development and
`C:\App_Portable\model_weights\` in portable production:

- `all-MiniLM-L6-v2`: semantic clustering and Bouncer embeddings.
- `distilbart-cnn-12-6`: local structured summary fallback.
- `distilbert-sst-2`: sentiment analysis when installed; neutral fallback when
  absent in offline mode.
- FLAN-T5 local folder: legacy/local Why This Matters fallback where configured.
- `opus-mt-tc-big-en-ko`: English-to-Korean Marian translation.

Model directories are ignored by Git. With `SENSE_OFFLINE_ONLY=true`, missing
weights must produce honest diagnostics and a safe degraded mode; the server
must not surprise-download weights in production.

## Gatekeeper and training

The active model path is:

```text
news_scrapper/runtime/bouncer_model.pkl
```

`trainingData.json` in the same runtime directory is the authoritative unified
training input. Root-level and broadcast pickle/JSON files are retained legacy
or rollback copies, not active production truth.

Every explicit Interested/Not Interested vote is written atomically before the
API responds. Retraining uses a coalescing worker:

1. first vote queues a rebuild;
2. votes arriving during training remain persisted and mark the model dirty;
3. completion triggers one follow-up rebuild against the complete latest data;
4. startup and retraining resolve the same authoritative pickle path.

This avoids losing rapid votes without launching one expensive training job per
click.

## Storage and retention

Mutable application data lives under `news_scrapper/runtime/` and
`venture_lens/runtime/`. Important NewsScrapper stores include:

```text
intelligence_store/unified/history/
scheduler_state.json
trainingData.json
bouncer_model.pkl
workflow_store.json
usage_tracker.json
viewer_profiles.json
viewer_saved_store.json
viewer_hidden_store.json
viewer_url_briefings.json
viewer_personalization.json
recommendation/viewers/<hashed-viewer>.json
samsung_pipeline_cache/
```

Writes use atomic temporary-file replacement and process locks. This is safe for
the intended single-process pilot, not for multiple Uvicorn workers. The next
scale step would require a transactional database, durable job broker, shared
rate limits, worker processes, and a singleton scheduler service.

## Recommendation data flow

For You never writes a physical feed per user. It reads the shared unified
briefing, applies eligibility, then deterministically ranks at request time from:

- editorial/importance score;
- source coverage;
- freshness;
- explicit onboarding topics, outcomes, source families and region;
- decayed user actions;
- saved/followed story similarity;
- diversity caps and a controlled surprise allocation.

The response carries reason codes and readable explanations. Personal affinity
is capped so weak content cannot outrank every strong global signal. Passive
events do not train the shared Bouncer.

## Private URL briefings

The user's Desk accepts multiple exact news URLs. Jobs are private to the
viewer, survive route changes, expose per-URL progress, deduplicate against the
shared feed and the user's own jobs, and can be cleared by that user. The
recommended processing order is exact-URL fetch/Web Search, normalization,
summary/dossier generation, and optional explicit promotion into the shared
review workflow. User-submitted URLs bypass the shared Bouncer until explicitly
promoted.

## Translation

Language choice is browser-specific. English originals remain canonical.
The frontend translates progressively and prefers a supported browser-local
translation engine; it falls back to the private local Marian model endpoint.
The UI must remain usable during translation, show honest progress/error state,
and allow an immediate return to English. Never imply a fixed five-minute lock.

## Venture Lens

The backend retrieves repository signals from GitHub and paper signals from
arXiv, caches successful results, and keeps curated starter data for outages.
Provider failure must never prevent NewsScrapper or FastAPI from starting.
Comparison must compare like kinds (repository-to-repository or paper-to-paper)
and display real provider metrics rather than invented zeros.

## Internal Publishing current boundary

The new publishing workspace currently parses files in the browser and stores
its editorial library in that browser's localStorage. It is not yet a shared
server publishing database. The import pipeline supports PDF, DOCX, TXT/MD and
PNG/JPEG/WebP; legacy `.doc`, Excel, and image-only PDFs are rejected with
specific guidance. Do not describe this local prototype as multi-user
production persistence until a backend contract is designed and implemented.
