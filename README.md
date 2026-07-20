# Signalroom

Signalroom is a local-first AI news-intelligence workspace. It crawls the
configured Default and Broadcast publisher lists, groups related coverage,
creates briefing summaries, applies a learnable gatekeeper, and exposes the
result through an editorial frontend with dossiers, worklists, exports, VOC,
analytics, and profile-aware access.

The frontend and backend are intentionally separate so the built frontend and
the complete `backend` folder can be copied independently to the internal
Windows server laptop.

**Begin with [`SIGNALROOM_GUIDE.md`](SIGNALROOM_GUIDE.md).** It gives the exact
model download folders, IP/keyword/source configuration locations, Git-clone
commands, Windows packaging steps, architecture, data flow, retention, API,
frontend, Gatekeeper, and operational checks.

## Repository layout

```text
.
├── app/, components/, lib/     # Vinext/React frontend and API client
├── public/                     # frontend images and static files
├── backend/
│   ├── main.py                 # API, scheduler, run, train, warm-models CLI
│   ├── profiles/               # Default/Broadcast keywords and behavior
│   ├── sites/                  # sites.json and broadcast_sites.json
│   ├── model_weights/          # ignored MiniLM/DistilBART destination folders
│   ├── models/                 # generated Gatekeeper artifacts (never HF files)
│   ├── signalroom/             # crawling, ML, services, API, JSON storage
│   └── runtime/                # generated state, crawl files, process locks
├── deployment/                 # portable Windows launcher and instructions
├── requirements.txt            # complete Python backend + ML + test install
├── SIGNALROOM_GUIDE.md         # primary operator/developer handoff
└── docs/PHASE_READINESS.md     # implemented phases and release gates
```

Runtime data is JSON, not a database. The backend writes a human-readable
`state.json`, maintains `state.json.bak`, and serializes writers with a process
lock. Briefings and ordinary articles expire after 30 days. Articles currently
saved, under review, or approved remain available beyond that window.

## Frontend development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
```

Development uses the same-origin `/api/signalroom` bridge by default. A
production build for the direct-API laptop topology should set the API port as
described in [deployment/README_WINDOWS.md](deployment/README_WINDOWS.md).
Direct API is the recommended internal-laptop route because FastAPI receives
the employee device address directly. If a company reverse proxy later enables
the production BFF with `SIGNALROOM_TRUST_PROXY_IP_HEADERS=true`, the frontend
server must also have a unique `SIGNALROOM_PROXY_SHARED_SECRET` of at least 32
characters and the trusted proxy must inject the matching
`x-signalroom-proxy-secret` header after stripping any client-supplied copy.

Frontend release verification is one command:

```bash
npm test
```

It performs a production Vinext build, strict TypeScript checking, renders the
compiled worker, validates the Signalroom shell and metadata, confirms emitted
assets exist, and checks that unknown routes return 404.

Other useful commands:

```bash
npm run build
npm run typecheck
npm run lint
```

## Backend development

Python 3.9 or newer is supported; 64-bit Python 3.11 or 3.12 is recommended.
From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python backend/main.py api
```

Run the four-hour scheduler in a second process:

```bash
python backend/main.py scheduler
```

The scheduler runs Default and then Broadcast, reloads their profile/source
JSON at every cycle, runs once after startup by default, and does not overlap
cycles. See [backend/README.md](backend/README.md) for all commands, endpoints,
configuration, and tests.

## Model activation

The MiniLM and DistilBART integrations are coded, but installing their optional
ML packages and downloading/warming the Hugging Face weights is deliberately
deferred to phase 7. Until those weights are present, the pipeline continues in
an explicitly degraded mode:
semantic vectors use a deterministic hashing fallback and summaries use an
extractive fallback. No request or application import downloads a model.

Once the final Windows `python_embed` folder is ready, install and download the
pinned safetensors snapshots with:

```powershell
python_embed\python.exe -m pip install -r requirements.txt
python_embed\python.exe backend\scripts\download_models.py
set "SIGNALROOM_EMBEDDING_MODEL_PATH=%CD%\backend\model_weights\all-MiniLM-L6-v2"
set "SIGNALROOM_SUMMARIZATION_MODEL_PATH=%CD%\backend\model_weights\distilbart-cnn-12-6"
python_embed\python.exe backend\main.py warm-models --strict
```

The launcher applies those same local folders to normal API/scheduler runs and
keeps inference local-only.

Do not train/promote the final gatekeeper before the intended embedding backend
is active; the backend detects an embedding-backend mismatch and fails open
until that profile is retrained.

## Windows pilot

The supported copy-and-run layout and launcher are documented in
[deployment/README_WINDOWS.md](deployment/README_WINDOWS.md). The package uses
separate `frontend`, `backend`, `python_embed`, and optional `node_embed`
folders beside `start_signalroom.bat`. A macOS/Linux virtual environment cannot
be copied into the Windows release. The frontend also needs Node.js at runtime;
package its `node_modules` on Windows (or an equivalent Windows build machine),
because native packages copied from macOS/Linux are not portable.

This is an internal, single-laptop pilot topology. Restrict ports 3000 and 8000
to the company subnet; use the company authenticated TLS reverse proxy before
exposing it beyond that isolated boundary.
