# newsScrapper Windows laptop deployment

This is a deliberately small, single-machine deployment for an internal pilot.
It launches three local processes: the API, one process-safe scheduler, and the
already-built frontend. The scheduler runs one cycle at startup and every four
hours thereafter; each cycle runs Default and then Broadcast sequentially.

## Release folder

Put these folders beside `start_signalroom.bat` on the server laptop:

```text
newsScrapper/
├── start_signalroom.bat
├── signalroom.env.cmd
├── backend/                 # copy the complete backend folder
│   └── runtime/data/        # durable JSON state; preserve during upgrades
├── frontend/                # built frontend project; see below
│   ├── dist/
│   ├── node_modules/        # install/package for the target Windows platform
│   ├── node_embed/          # optional portable node.exe
│   ├── package.json
│   └── ...
├── python_embed/
│   ├── python.exe
│   └── ...                  # installed backend packages and model cache
├── node_embed/              # optional alternative location for node.exe
└── logs/                    # created automatically
```

The launcher does not contain or download Python, Node, models, packages, or a
virtual environment. It refuses to start when a required runtime is missing.
An upgrade must preserve `backend\runtime\data`, including `state.json`, its
`.bak`, and lock file. Replace application code around that directory rather
than copying a fresh backend folder over the live state.

## Prepare the frontend

On the development machine, from the frontend project root, run:

```powershell
$env:NEXT_PUBLIC_SIGNALROOM_DIRECT_API_PORT = "8000"
npm ci
npm run build
```

Use Node.js 22.13 or newer. Install and build on Windows, or on an equivalent
Windows architecture: copying `node_modules` from macOS or Linux can leave
native packages unusable. newsScrapper's frontend uses server-side rendering, so
the release still needs Node at runtime; it is not a static-only bundle.

Copy the project to the release's `frontend` folder, including the resulting
`dist`, `package.json`, and the Windows-compatible `node_modules`. The
launcher calls Vinext's production `start` command and binds it to `0.0.0.0`.
It uses `node.exe` from `frontend\node_embed`, then `node_embed`, then the
server's `PATH`.

Production builds default to direct API port `8000`; the explicit
`NEXT_PUBLIC_SIGNALROOM_DIRECT_API_PORT` build setting records that deployment
choice and makes each browser
call `http://SERVER-IP:8000/api/v1` directly, using the same host that served
the UI. This is required for the simple pilot because the backend must see the
employee device's real network address for Default/Broadcast routing and
permissions. Configure `SIGNALROOM_CORS_ORIGINS` with the exact frontend
origin. If a company-controlled reverse proxy is introduced later, omit the
direct-port setting and use the same-origin BFF or set
`NEXT_PUBLIC_SIGNALROOM_API_BASE` to the authenticated API origin instead.
Set `NEXT_PUBLIC_SIGNALROOM_USE_BFF=true` at build time only for that trusted
proxy topology.
The production BFF deliberately refuses requests unless
`SIGNALROOM_TRUST_PROXY_IP_HEADERS=true`; this prevents every proxied employee
from being mistaken for the server's loopback/developer identity.
When that trusted BFF/proxy mode is enabled, set
`SIGNALROOM_PROXY_SHARED_SECRET` to at least 32 random characters and configure
the company proxy to replace (not merely append) the matching
`X-Signalroom-Proxy-Secret` header. Never accept that header directly from
employee browsers.

## Prepare embedded Python

Use the same Windows architecture and compatible Python minor version on the
build and server laptops. A normal virtual environment copied from macOS or
Linux will not work on Windows, and even a Windows venv often contains absolute
paths. Prefer one of these approaches:

1. Create and populate `python_embed` on the target Windows laptop.
2. Build a tested portable Windows Python distribution on an equivalent clean
   Windows machine and copy that entire distribution.

Install the backend project and all runtime dependencies into that exact
distribution. If using the official Python embeddable ZIP, enable `import site`
in its `pythonXY._pth` before installing packages. Install the core runtime and
verify it before transfer:

```powershell
python_embed\python.exe -m pip install -e backend
python_embed\python.exe -c "import apscheduler, fastapi, scrapy, uvicorn"
python_embed\python.exe -m scrapy version
```

Do not copy the current development machine's `.venv` and rename it. Native
packages such as PyTorch must match the target operating system, CPU, and Python
version. The launcher pins `HF_HOME` and `TRANSFORMERS_CACHE` beneath
`python_embed\hf_cache`, unless explicitly overridden, so the deferred phase-7
model weights stay inside the release instead of the Windows user profile.

When phase 7 is intentionally enabled, install the root requirements, download
the two repositories into their explicit backend folders while online, then
verify local-only loading:

```powershell
python_embed\python.exe -m pip install -r requirements.txt
python_embed\python.exe backend\scripts\download_models.py
set "SIGNALROOM_EMBEDDING_MODEL_PATH=%CD%\backend\model_weights\all-MiniLM-L6-v2"
set "SIGNALROOM_SUMMARIZATION_MODEL_PATH=%CD%\backend\model_weights\distilbart-cnn-12-6"
python_embed\python.exe backend\main.py warm-models --strict
```

After that succeeds, the production launcher keeps
`SIGNALROOM_HF_LOCAL_ONLY=true`; normal starts load only these two local folders
and never download weights. `backend\models` is different: it contains generated
Gatekeeper classifiers and must not be used for Hugging Face weights.

## Configure and launch

Copy `signalroom.env.cmd.example` to `signalroom.env.cmd`. At minimum:

- replace the example server IP in `SIGNALROOM_CORS_ORIGINS`;
- generate a unique `SIGNALROOM_IP_HASH_SECRET` of at least 32 random bytes;
- set the Broadcast, developer, and administrator IP/CIDR allowlists;
- keep the one-megabyte mutation body limit and per-client rate limit, or tune
  `SIGNALROOM_MAX_REQUEST_BYTES` and
  `SIGNALROOM_MUTATION_RATE_LIMIT_PER_MINUTE` conservatively;
- keep trusted proxy headers disabled unless a configured internal proxy strips
  client-supplied forwarding and identity headers; when enabled, also configure
  the shared proxy secret described above.

Profile keywords and publisher lists remain editable JSON in `backend\profiles`
and `backend\sites`. They are reloaded at the start of every manual or scheduled
scan, so source additions do not require rebuilding the application.

Double-click `start_signalroom.bat`, or run it from Command Prompt. It opens
separate windows for the API, scheduler, and frontend. Each launch moves the
previous `backend.log`, `scheduler.log`, and `frontend.log` to `.log.1`, removes
the older generation, and writes current logs beneath `logs`. From another
internal device, browse to:

```text
http://SERVER-IP:3000
```

Allow inbound TCP ports 3000 and 8000 only on the required private Windows
Firewall profile and only from the exact company subnet. Do not enable the
rules on Public networks or expose either port to the internet. Plain HTTP can
expose article activity, optional email addresses, and administrator bearer
credentials to anyone able to observe that subnet. Treat it as an isolated
pilot configuration only; for anything broader, put both services behind the
company's authenticated TLS reverse proxy and close direct inbound access.

IP-based identity has one deliberate pilot limitation: colleagues who share a
NAT, forward proxy, or other egress address also share one pseudonymous actor,
including preferences, worklists, and analytics attribution. If distinct users
must be measured behind a shared address, deploy verified company identity at
the authenticated proxy rather than inferring identity from the IP.

## Operational checks

After launch, verify:

```powershell
curl.exe -f http://127.0.0.1:8000/api/v1/health
curl.exe -f http://127.0.0.1:8000/api/v1/me
```

Only one copy of the scheduler may run. Its process lock prevents accidental
duplicates. On startup it marks queued/running jobs older than the configured
stale threshold as failed, coalesces missed interval runs, and never overlaps
two cycles. A publisher run where every configured source is unreachable fails
visibly; a reachable run with no keyword matches remains a valid empty run and
preserves the previous briefing.

To stop newsScrapper, close the three titled process windows. Do not terminate all
Python or Node processes globally because the laptop may run unrelated tools.
