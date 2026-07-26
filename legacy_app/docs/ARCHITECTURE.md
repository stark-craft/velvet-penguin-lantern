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

## Profile routing guarantee

NewsScrapper profile selection remains backend-authoritative:

1. FastAPI resolves the real client IP.
2. Forwarding headers are accepted only from IPs in `TRUSTED_PROXY_IPS`.
3. The resolved IP is compared with `BROADCAST_SPECIAL_IPS` from the root
   `.env`.
4. Matching users receive `broadcast`; all other users receive `default`.
5. IP hashing happens later for analytics and never controls profile routing.
6. An explicit profile override is honored only for
   `PROFILE_SETTINGS_ALLOWED_IPS`.

Changing the broadcast list requires restarting FastAPI.

## Scheduler reliability

- The combined scheduler processes `default` first and `broadcast` second every
  four hours.
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

Every interested/not-interested vote is written atomically to the profile's
training JSON before the API responds. Retraining runs on one dedicated worker:

1. The first vote queues a model rebuild.
2. Votes received while that rebuild is running remain in JSON and mark the
   profile dirty.
3. When the current rebuild completes, one follow-up rebuild consumes the whole
   latest dataset.
4. Default and broadcast votes remain in separate datasets and model files.

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
/             Sense.AI portal
/home         NewsScrapper
/venturelens  Venture Lens
```

## Venture Lens data behavior

- GitHub data comes from the GitHub public repository-search API.
- Research data comes from the public arXiv Atom API.
- A root `.env` `GITHUB_TOKEN` is optional and raises GitHub rate limits.
- Cached results are stored under `venture_lens/runtime/`.
- A curated starter snapshot keeps the interface usable before the first live
  synchronization or during a provider outage.
- Provider failures do not prevent NewsScrapper or FastAPI from starting.

## JSON safety

New JSON-backed features use `core.storage.JsonStore`, which writes a temporary
file, flushes it, and atomically replaces the destination. Existing
NewsScrapper state is copied into `news_scrapper/runtime/` once without deleting
the legacy root-level backup.
