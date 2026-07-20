# Signalroom backend

Signalroom is the standalone backend for the AI news-intelligence interface. It crawls configured publishers, groups coverage of the same story, summarizes each story cluster, applies a learnable relevance gatekeeper, and persists immutable briefing snapshots plus each viewer's editorial actions.

The frontend and backend are deliberately separate. This directory owns crawling, ML, scheduling, access policy, API contracts, and JSON runtime state; it does not contain frontend components or build tooling.

## What is implemented

- Two isolated profiles: **Default Intelligence** and **Broadcast Intelligence**.
- Strict, versioned JSON files for each profile's keywords and sources.
- Feed-first Scrapy discovery with HTML-listing fallback and full article-page extraction.
- `sentence-transformers/all-MiniLM-L6-v2` semantic embeddings and transitive cosine clustering.
- `sshleifer/distilbart-cnn-12-6` cluster summarization.
- Per-profile gatekeeper artifacts with review `0.45`, final drop `0.60`, and conservative prefetch drop `0.90` thresholds.
- Crash-safe JSON persistence for globally deduplicated articles/provenance, per-profile intelligence, clusters, briefing snapshots, jobs, actions, VOC, preferences, and privacy-aware telemetry.
- A versioned FastAPI surface for the current frontend, including article dossiers, worklists, feedback, analytics, scans, and gatekeeper training.
- A process-safe interval scheduler that always runs enabled profiles sequentially in `schedule_order`.

The two Hugging Face models load only on first use. If a package or cached weight is unavailable, clustering uses a deterministic 384-dimensional hashing embedder and summarization uses an extractive fallback. The briefing pipeline therefore remains operable offline, while its model metadata reports that it is degraded.

## Architecture

```text
profiles/*.json + sites/*.json
              |
              v
     Scrapy worker subprocess
 (RSS/Atom -> article page; HTML fallback)
              |
              v
 normalize -> canonicalize -> deduplicate
              |
              v
 MiniLM embeddings -> semantic clusters (0.78)
              |
              v
 DistilBART cluster summary -> editorial classification
              |
              v
 profile gatekeeper -> keep / review / drop (0.60 final drop)
              |
              v
Atomic JSON article/provenance
  + profile intelligence
  + clusters + briefing snapshots
              |
              v
           /api/v1 -> frontend
```

Scrapy runs out of process so Twisted never owns the FastAPI event loop. Hugging Face models are lazy singletons inside each pipeline process. The scheduler is a separate process and is not started by importing the API.

Canonical URLs deduplicate the raw article and provenance globally. Every crawl also appends an immutable `article_profile_intelligence` interpretation for its profile and run. This keeps Default and Broadcast summaries, intents, regions, categories, routing, keywords, importance, and gatekeeper metadata isolated even when both profiles discover the same URL. Briefing snapshots resolve the interpretation from their own crawl run, so a later Broadcast analysis cannot rewrite an earlier Default briefing.

Important directories:

```text
backend/
├── main.py                  # ASGI export and operational CLI
├── profiles/                # profile behavior, thresholds, and keywords
├── sites/                   # publisher discovery endpoints
├── models/<profile>/        # verified gatekeeper manifests and versioned .pkl files
├── runtime/                 # JSON state/backup, crawl output, scheduler lock
├── signalroom/
│   ├── app.py               # composition root
│   ├── api.py               # /api/v1 routes
│   ├── crawlers/            # Scrapy spider and extraction policy
│   ├── ml/                  # embeddings, clustering, summarization, gatekeeper
│   ├── services/            # pipeline, scheduler, access and editorial logic
│   ├── json_storage.py      # default atomic JSON repository and retention
│   └── storage.py           # shared repository contracts + legacy SQLite adapter
└── tests/
```

## Install

Python 3.9 or newer is required. From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

The core install deliberately omits Torch, Transformers, sentence-transformers,
and Hugging Face weights. This keeps phases 1–6 portable and uses the explicit
deterministic clustering/summarization fallbacks. The code does not download
model files at import time.

The checked-in `.env.example` is a reference, not an automatically loaded file. Export settings in the shell or configure them in the service manager. Development defaults work on `127.0.0.1`; production mode requires a unique IP-hashing secret.

```bash
export SIGNALROOM_ENV=development
export SIGNALROOM_IP_HASH_SECRET='replace-this-with-at-least-32-random-bytes'
```

To download both Hugging Face repositories into the checked-in empty destination
folders and verify that they can be loaded locally:

```bash
python -m pip install -e '.[ml]'
python scripts/download_models.py
export SIGNALROOM_EMBEDDING_MODEL_PATH=model_weights/all-MiniLM-L6-v2
export SIGNALROOM_SUMMARIZATION_MODEL_PATH=model_weights/distilbart-cnn-12-6
python main.py warm-models --strict
```

The downloader is the only command in this sequence that accesses Hugging Face.
`warm-models --strict` honors `SIGNALROOM_HF_LOCAL_ONLY` and fails unless both
local folders load successfully. Without `--strict`, a fallback is reported as
JSON but does not produce a failing exit code.

## Configure profiles and sources

Profile behavior lives in [profiles/default.json](profiles/default.json) and [profiles/broadcast.json](profiles/broadcast.json). Each file controls:

- the profile's label and enabled state;
- its sources-file basename;
- independent keywords;
- clustering and gatekeeper thresholds;
- scheduler order.

Publisher definitions live in [sites/sites.json](sites/sites.json) for Default and [sites/broadcast_sites.json](sites/broadcast_sites.json) for Broadcast. The Default file contains 107 supplied publishers and retains their original enablement flags (79 enabled and 28 disabled). The Broadcast file contains five enabled homepage-discovery publishers and remains isolated from the Default crawl.

```json
{
  "schema_version": 1,
  "sites": [
    {
      "id": "publisher-slug",
      "name": "Publisher name",
      "enabled": true,
      "category": "General Tech",
      "rss_url": "https://publisher.example/rss.xml",
      "homepage": "https://publisher.example/news/",
      "region": "India",
      "timezone": "Asia/Kolkata",
      "allowed_domains": ["publisher.example"],
      "max_links": 100,
      "allow_deep_scan": false,
      "manual_deep_scan_candidate": false
    }
  ]
}
```

At least one of `rss_url`, `homepage`, or `url` is required. `allowed_domains` is optional and extends the publisher boundary for legitimate sibling hosts; `max_links` is capped at 500. When `allow_deep_scan` is false, the crawler stays feed-only and will not fall back to homepage link discovery. `manual_deep_scan_candidate` is an operator hint and never enables crawling by itself. A source's article URLs and redirects are constrained to that boundary. Scrapy obeys `robots.txt`, uses per-domain throttling, rejects binary responses, and sends an explicit crawler user agent. Confirm that each publisher's terms and the organization's content-use policy permit crawling before enabling it.

## Run locally

Start the API from the backend directory:

```bash
python main.py api
```

Equivalent ASGI invocation:

```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

Check it at `http://127.0.0.1:8000/api/v1/health`; interactive OpenAPI documentation is at `http://127.0.0.1:8000/docs`.

Run a briefing immediately:

```bash
python main.py run --profile default
python main.py run --profile broadcast --from-date 2026-07-19 --to-date 2026-07-20
python main.py run --profile all
```

`--profile all` uses configured schedule order: Default first, Broadcast second. `--keyword` and `--source` are repeatable run-specific overrides. An empty run succeeds without replacing the last non-empty briefing.

### Run the scheduler separately

Use a second process or service unit:

```bash
python main.py scheduler
```

The default interval is four hours and the scheduler runs one cycle after
startup. Configure it with:

```bash
export SIGNALROOM_SCHEDULE_INTERVAL_HOURS=4
export SIGNALROOM_SCHEDULER_RUN_ON_START=true
export SIGNALROOM_TIMEZONE=Asia/Kolkata
```

The scheduler uses a local process lock and executes Default then Broadcast sequentially. Do not embed it in the API or start one scheduler per Uvicorn worker. For the first single-host deployment, run one API process and one scheduler process. A later multi-host deployment should move scheduled and manually submitted jobs to an external queue and replace the local lock.

## Gatekeeper learning

The gatekeeper is independent for each profile. It interprets `1` as drop/not interested and `0` as keep. Training requires both classes and at least four useful examples by default.

Train from the latest persisted `interesting`, `not_interested`, `hide`, `approve`, `save`, `select`, and `restore` actions:

```bash
python main.py train --profile default
```

Or train from a JSON array or JSON Lines file:

```bash
python main.py train --profile default --input runtime/default-feedback.jsonl
```

Example records:

```json
{"profile":"default","action":"interesting","article":{"title":"A useful signal","summary":"...","keywords":["OLED"]}}
{"profile":"default","action":"not_interested","article":{"title":"An irrelevant story","summary":"...","keywords":["celebrity"]}}
```

Training first writes an immutable, versioned classifier and manifest beneath `models/<profile>/`, calculates the artifact SHA-256, and only then atomically promotes `models/<profile>/manifest.json`. Until a valid artifact exists, the gatekeeper fails open: it retains articles and records degraded metadata instead of silently deleting news.

An artifact records the embedding backend used for training. If it was trained using the hashing fallback and MiniLM later becomes available—or the reverse—the gatekeeper detects the mismatch and fails open until it is retrained with the active embedding backend.

### `.pkl` trust boundary

Python pickle can execute code while loading. A SHA-256 match proves that a file matches its manifest; it does not prove who created either file. Treat `models/` as administrator-controlled executable material:

- never accept a model or manifest through an upload endpoint;
- keep the directory unwritable by the web-facing user where operationally possible;
- transfer artifacts through a trusted release path;
- review ownership and permissions before a process restart.

The loader checks profile isolation, manifest schema, basename/path containment, artifact existence, SHA-256, and classifier interface before use.

## API overview

All active contracts are under `/api/v1`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | service/JSON-storage readiness |
| `GET` | `/me` | pseudonymous actor, active profile, and capabilities |
| `GET` | `/profiles` | profiles visible to the current viewer |
| `GET` | `/sources` | JSON-configured sources for the active profile |
| `POST` | `/sources` | developer-only validated source creation |
| `PUT` | `/sources/{source_id}` | developer-only validated source update |
| `GET` | `/feed` | frontend-shaped briefing aggregate without article/cluster duplication |
| `GET` | `/briefings/latest` | latest immutable briefing snapshot |
| `GET` | `/briefings` | cursor-paginated briefing history |
| `GET` | `/briefings/{briefing_id}` | one historical immutable snapshot |
| `GET` | `/articles` | cursor-paginated profile articles |
| `GET` | `/articles/{article_id}` | full dossier, summary, intent, image, keywords, and provenance |
| `GET` | `/articles/{article_id}/actions` | current viewer's dossier decision trail |
| `GET` | `/clusters` | cursor-paginated semantic clusters |
| `GET` | `/clusters/{cluster_id}` | one story cluster and member articles |
| `POST` | `/articles/{article_id}/actions` | select, save, review, approve, interest, hide, or restore |
| `POST` | `/article-actions/batch` | apply one action to up to 100 prevalidated article UUIDs |
| `GET` | `/worklists?state=selected` | selected/saved/review/interest worklists |
| `POST` | `/exports` | bounded JSON, CSV, XLSX, DOCX, or PPTX download |
| `POST` | `/feedback` | VOC submission |
| `POST` | `/events` | privacy-aware product telemetry |
| `POST` | `/admin/scans` | enqueue a manual crawl/ML job |
| `GET` | `/admin/jobs/{job_id}` | durable job state |
| `GET` | `/admin/jobs/{job_id}/events` | ordered job progress events |
| `GET` | `/admin/analytics` | restricted usage summary |
| `GET` | `/admin/analytics/detail` | bounded per-user and per-session activity rollups |
| `GET` | `/admin/feedback` | restricted VOC review |
| `GET` | `/gatekeeper/audit` | restricted latest-run keep/review/drop audit |
| `POST` | `/admin/gatekeeper/train` | restricted per-profile retraining |

Article, cluster, and job mutations use UUIDs—not titles. Pagination uses the returned opaque `next_cursor`. Admin scan events are pollable with `after_sequence` so the UI can request only new events.

Detailed analytics derives active time from event gaps capped at five minutes,
keeps results profile-scoped and bounded, sanitizes paths, and never returns IP
hashes or arbitrary telemetry properties. The gatekeeper audit reads the latest
successful crawl rather than only the retained briefing, so review and dropped
clusters remain visible to authorized reviewers.

## Frontend integration

The frontend should use one configured API base URL and make these calls in order:

1. `GET /api/v1/me` to obtain the active profile and capability flags.
2. `GET /api/v1/profiles` to render a switcher only when the server exposes another profile.
3. `GET /api/v1/feed` for the UI-ready morning briefing; use `/articles` for the wider raw feed and `/briefings` for History.
4. Open `/articles/{article_id}` for the dossier and `/clusters/{cluster_id}` when showing related coverage.
5. Send every editorial button through the article action endpoint, then use the returned disposition as the source of truth.

Example selection:

```http
POST /api/v1/articles/45df4455-1e8a-493a-9088-5f85c27a9e0b/actions?profile=default
Content-Type: application/json

{
  "action": "select",
  "idempotency_key": "select-45df4455-1e8a-493a-9088-5f85c27a9e0b-v1"
}
```

Supported action values are `select`, `deselect`, `save`, `unsave`, `mark_under_review`, `clear_review`, `approve`, `interesting`, `not_interested`, `hide`, and `restore`. The Selected tab is `GET /api/v1/worklists?state=selected`; analogous states include `saved`, `under_review`, `approved`, `interesting`, `not_interested`, and `hidden`.

Exports accept 1–100 explicit active-profile article UUIDs and `format` set to `json`, `csv`, `xlsx`, `docx`, or `pptx`. They are generated entirely in memory. Image and source URLs are written as text; the backend never fetches remote media during export.

Create one random UUID session ID per browser session for telemetry. Send `page_view`, `article_open`, `article_action`, `search`, `export`, `heartbeat`, `feedback`, and `profile_switch` events deliberately; do not include article text, email addresses, raw IPs, or arbitrary DOM data in telemetry properties.

## Access and privacy

This first deployment is designed for an internal network boundary, not as a public-Internet identity provider.

- Raw client IPs are used transiently for profile/capability resolution, then stored only as an HMAC pseudonym (`ip:v1:...`).
- Forwarding and identity headers are ignored unless explicitly enabled and received from a configured trusted proxy.
- Unknown viewers receive Default and basic read/personalization/VOC capabilities.
- Broadcast access is allowlisted; localhost developer addresses receive profile switching, analytics, scan, and gatekeeper-review capabilities by default in development.
- Admin email/IP allowlists or a bearer `SIGNALROOM_ADMIN_KEY` grant administrative capabilities.
- CORS uses explicit origins; wildcard origins are rejected in production.
- VOC contact email is optional and accepted only when the viewer explicitly allows follow-up.

Before deployment, set a unique `SIGNALROOM_IP_HASH_SECRET`, restrict `SIGNALROOM_DEVELOPER_IPS`, configure trusted proxies precisely, and put authentication plus TLS at the internal reverse proxy. Do not enable trusted identity headers unless that proxy removes client-supplied versions of those headers.

## Environment reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIGNALROOM_STORAGE_PATH` | `runtime/data` | atomic JSON state directory (or an explicit `.json` file) |
| `SIGNALROOM_PROFILE_DIR` | `profiles` | strict profile JSON root |
| `SIGNALROOM_SITES_DIR` | `sites` | strict source JSON root |
| `SIGNALROOM_MODEL_DIR` | `models` | trusted gatekeeper artifact root |
| `SIGNALROOM_CRAWL_OUTPUT_DIR` | `runtime/crawls` | temporary Scrapy feed exports |
| `SIGNALROOM_HF_LOCAL_ONLY` | `true` | prohibit missing-weight downloads during inference |
| `SIGNALROOM_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | semantic embedding model |
| `SIGNALROOM_SUMMARIZATION_MODEL` | `sshleifer/distilbart-cnn-12-6` | summarization model |
| `SIGNALROOM_BROADCAST_IPS` | empty | Broadcast profile CIDR allowlist |
| `SIGNALROOM_DEVELOPER_IPS` | loopback | local developer capability CIDRs |
| `SIGNALROOM_ADMIN_IPS` | empty | administrator CIDR allowlist |
| `SIGNALROOM_ADMIN_EMAILS` | empty | verified administrator identities |
| `SIGNALROOM_ANALYTICS_EMAILS` | empty | verified analytics identities |
| `SIGNALROOM_TRUSTED_PROXY_IPS` | loopback | proxy CIDRs eligible for trusted headers |
| `SIGNALROOM_TRUST_PROXY_HEADERS` | `false` | honor forwarded client IPs from trusted proxies |
| `SIGNALROOM_TRUST_IDENTITY_HEADERS` | `false` | honor identity headers from trusted proxies |

See [.env.example](.env.example) for the complete list.

## Verify

The test suite is offline and does not need model downloads:

```bash
PYTHONPATH=. python -m unittest discover -s tests -v
python -m compileall -q main.py signalroom scripts tests
python -m scrapy list
```

For a running-service smoke test:

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
```

The default repository creates `runtime/data/state.json`, keeps
`runtime/data/state.json.bak`, and uses a process lock plus atomic replacement
so the API and dedicated scheduler can share the small single-host store.
Ordinary briefing/article history is pruned after 30 days; an article with a
current saved, under-review, or approved disposition is retained. Audit actions
and telemetry use a bounded 90-day window, while VOC uses a bounded 365-day
window. Back up the complete `runtime/data` directory before deploying a new
version. Preserve the API and service boundaries when moving persistence or
jobs to shared infrastructure later.

The six coded phases and the deliberately deferred Hugging Face weight step are
tracked in [../docs/PHASE_READINESS.md](../docs/PHASE_READINESS.md).
