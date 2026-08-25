# Sense.AI Architecture

Sense.AI contains two isolated products behind one FastAPI server and one Vite
frontend build.

## Runtime

```text
Browser
  -> Sense.AI frontend build
     -> NewsScrapper React application
     -> Venture Lens React application
  -> FastAPI main.py
     -> NewsScrapper backend and scheduler
     -> Venture Lens GitHub and research providers
```

Start the complete backend from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

During frontend development, run one additional process:

```powershell
cd news-ui
npm run dev -- --host 127.0.0.1
```

Production uses `npm run build` once and then only the FastAPI process.

Keep Uvicorn at **one worker process** for this JSON-backed phase. The supplied
Windows launcher enforces `--workers 1` and restarts Uvicorn after an unexpected
exit. Multiple Uvicorn worker processes would each start their own scheduler and
would not share the in-memory JSON locks.

## Backend boundaries

- `main.py` is the composition root. It mounts both product APIs and serves the
  built frontend.
- `core/` contains shared settings, profile utilities, secure HTTP support, and
  atomic JSON storage.
- `news_scrapper/` owns crawling, scheduling, adapters, clustering, training,
  source configuration, and NewsScrapper runtime data.
- `venture_lens/` owns GitHub discovery, arXiv research discovery, caching, and
  Venture Lens endpoints.
- `model_weights/` is the shared local-model location and is excluded from Git.
- `news_scrapper/runtime/bouncer_model.pkl` is the authoritative trained
  bouncer model for the unified corpus. Startup and retraining use this same
  path; root-level and broadcast-specific pickle files are rollback copies and
  are not loaded.

## Unified corpus and viewer personalization

NewsScrapper uses one shared intelligence corpus:

1. One `sites.json` supplies technology and broadcast sources.
2. One four-hour scheduler creates the shared Briefing.
3. Broadcast is content metadata and a filter, not a separate IP-routed
   product profile.
4. For You privately ranks that shared corpus for the signed viewer.
5. Saved, Hide, interests, and reading events stay viewer-specific; only the
   explicit Not Interested action trains the shared Gatekeeper/Bouncer.

The client-IP resolver is still shared by protected capabilities. Forwarding
headers are accepted only when the immediate peer is in `TRUSTED_PROXY_IPS`.

## For You private workspace

`/for-you/*` is one React workspace shell beneath the main navigation. It
lazy-loads only the active view:

```text
/for-you                              personalized desk (default)
/for-you/saved                        private saved signals
/for-you/contributions                IP-authorized contribution desk
/for-you/contributions/leadership     leadership composer
/for-you/private-briefings            private URL-import briefings
```

The old `/saved/*` addresses remain redirects, so bookmarks keep working.
FastAPI serves the production SPA shell for every `/for-you/*` deep link while
the JSON `GET /for-you` recommendation API keeps its existing content type.

Contribution visibility is a capability, not a new identity system:

- `GET /internal-content/contribute-access` returns the normalized client IP
  and whether it is in `CONTRIBUTIONS_ALLOWED_IPS`.
- The allowlist defaults to loopback only when absent and fails closed in the
  browser if the capability request fails.
- Contributor-owned drafts, imports, media, notifications, and submissions
  require both an allowed IP and the existing signed viewer ownership check.
- Published Samsung Internal content remains public to ordinary viewers.
- Existing editor-key review operations remain independent of the contributor
  IP allowlist.

## Scheduler reliability

- One scheduler processes the unified source corpus every four hours.
- A tick that arrives during another scheduled run is retained and executed
  after the active run finishes.
- A run blocked by a manual crawl is retried instead of discarded.
- A failed profile is retried after `SCHEDULER_RETRY_DELAY_SECONDS` (ten minutes
  by default).
- APScheduler keeps missed ticks eligible for 24 hours, covering ordinary
  Windows sleep/resume periods while the Python process survives.
- On application startup, the latest briefing time for both profiles is checked;
  a stale or missing profile becomes due shortly after startup.
- Scheduler status exposes start/completion timestamps and failed profiles in
  `/status` for authorized operations IPs.

No application can execute while the laptop is powered off. The server laptop
must be configured not to sleep during service hours. The restart loop in
`scripts/start_windows.bat` recovers a crashed Python process, but Windows Task
Scheduler or a Windows service should eventually own process startup after a
machine reboot.

## Feedback training queue

Every interested/not-interested vote is written atomically to the unified
training JSON before the API responds. Retraining runs on one dedicated worker:

1. The first vote queues a model rebuild.
2. Votes received while that rebuild is running remain in JSON and mark the
   profile dirty.
3. When the current rebuild completes, one follow-up rebuild consumes the whole
   latest dataset.
4. The resulting model remains the one authoritative unified bouncer model.

This deliberately coalesces redundant rebuild requests without discarding any
training examples.

## Current capacity boundary

- Read-only feed, profile, history, and Venture Lens traffic is suitable for the
  intended tens-of-users internal deployment.
- Workflow selections, approvals, profile edits, VOC entries, and training votes
  are serialized around short atomic JSON replacements, preventing lost updates
  during request bursts.
- Manual internet crawls are intentionally capped at three concurrent jobs; a
  fourth request receives a capacity response instead of exhausting the laptop.
- One hundred simultaneous readers can be served, but one hundred simultaneous
  heavy crawls, exports, or local-model inference requests are outside this
  laptop/JSON architecture. The next scaling step is a database, a durable job
  broker, multiple worker services, and a single dedicated scheduler service.

## Frontend boundaries

- `src/main.jsx` selects the product from the URL and lazy-loads its bundle.
- `src/news-scrapper/` contains the established NewsScrapper application.
- `src/venture-lens/` contains the Venture Lens application and visual system.
- `src/shared/` contains only cross-product infrastructure.

Routes:

```text
/                  redirects to the private For You landing experience
/for-you/*         private viewer workspace
/home              deterministic shared Briefing
/research          Research orientation
/venturelens/*     Venture Lens workspaces
/samsung-internal  published Samsung Internal content
/samsung-internal/leadership/:id   published leadership reader
/samsung-internal/announcement/:id published announcement reader
```

## Venture Lens data behavior

- `/research` is the premium discovery gateway; detailed work remains under
  `/venturelens/*`.
- `GET /venture-lens/discovery` normalizes repositories, papers, models,
  datasets, patents, technology synthesis, and optional social momentum into a
  single typed artifact contract.
- GitHub and arXiv retain their existing starter snapshots. OpenAlex enriches
  scholarly evidence, and Hugging Face supplies public model/dataset records.
  EPO OPS and X remain hidden until their credentials are configured.
- Each provider has its own TTL and last-success cache under
  `venture_lens/runtime/`. A failed or rate-limited provider never erases a
  healthy cache and never blocks the other providers.
- Provider metrics are ranked only within the same artifact type. Momentum is
  shown only after two real snapshots exist.
- Venture discovery refresh is independent of the one four-hour NewsScrapper
  scheduler.
- Provider failures do not prevent NewsScrapper or FastAPI from starting.

## JSON safety

New JSON-backed features use `core.storage.JsonStore`, which writes a temporary
file, flushes it, and atomically replaces the destination. Existing
NewsScrapper state is copied into `news_scrapper/runtime/` once without deleting
the legacy root-level backup.
