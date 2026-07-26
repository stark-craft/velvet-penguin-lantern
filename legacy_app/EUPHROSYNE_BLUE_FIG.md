# Euphrosyne Blue Fig

This is the complete deployment guide for the existing portable Windows
server layout:

```text
C:\App_Portable
```

It assumes that ordinary `python` commands do not work on the server. Every
Python command in this guide therefore uses:

```text
C:\App_Portable\python_embed\python.exe
```

Do not replace that command with `python`, `py`, or a virtual-environment
command.

## 1. Final server structure

Create or retain this structure:

```text
C:\App_Portable\
│
├── START_SENSE.bat
│
├── python_embed\
│   ├── python.exe
│   ├── python311.dll
│   ├── python311._pth
│   └── Lib\
│       └── site-packages\
│
├── frontend\
│   └── dist\
│       ├── index.html
│       └── assets\
│
└── backend\
    ├── .env
    ├── main.py
    ├── requirements.txt
    ├── template.pptx
    ├── bouncer_model.pkl
    ├── bouncer_model_broadcast.pkl
    │
    ├── core\
    │   ├── __init__.py
    │   ├── profile.py
    │   ├── secure_http.py
    │   ├── settings.py
    │   └── storage.py
    │
    ├── model_weights\
    │   ├── all-MiniLM-L6-v2\
    │   ├── semantic_model\
    │   ├── distilbart-cnn-12-6\
    │   ├── flan-t5-local\
    │   └── distilbert-sst-2\
    │
    ├── news_scrapper\
    │   ├── __init__.py
    │   ├── application.py
    │   ├── learner.py
    │   ├── semantic_clustering.py
    │   ├── train_bouncer.py
    │   ├── adapters\
    │   ├── config\
    │   │   ├── sites.json
    │   │   └── sites_broadcast.json
    │   ├── crawler\
    │   │   ├── scrapy.cfg
    │   │   └── news_aggregator\
    │   └── runtime\
    │       ├── intelligence_store\
    │       │   ├── default\history\
    │       │   └── broadcast\history\
    │       ├── history_archive\
    │       ├── trainingData.json
    │       ├── trainingData_broadcast.json
    │       ├── workflow_store.json
    │       ├── workflow_store_broadcast.json
    │       ├── viewer_profiles.json
    │       ├── viewer_hidden_store.json
    │       ├── usage_tracker.json
    │       ├── not_interested_store.json
    │       ├── not_interested_store_broadcast.json
    │       ├── bouncer_model.pkl
    │       └── bouncer_model_broadcast.pkl
    │
    └── venture_lens\
        ├── __init__.py
        ├── router.py
        ├── service.py
        ├── intelligence.py
        ├── catalog.py
        ├── providers\
        └── runtime\
```

The compiled frontend is a sibling of `backend`, not a child of it. That is
why the `.env` file must explicitly set `NEWSSCRAPPER_FRONTEND_DIST`.

## 2. AI model folders

Copy each complete Hugging Face model into the folder shown below:

```text
C:\App_Portable\backend\model_weights\all-MiniLM-L6-v2
C:\App_Portable\backend\model_weights\semantic_model
C:\App_Portable\backend\model_weights\distilbart-cnn-12-6
C:\App_Portable\backend\model_weights\flan-t5-local
C:\App_Portable\backend\model_weights\distilbert-sst-2
```

Do not create a duplicated inner directory. This is wrong:

```text
model_weights\all-MiniLM-L6-v2\all-MiniLM-L6-v2\config.json
```

This is correct:

```text
model_weights\all-MiniLM-L6-v2\config.json
```

Each model folder must contain its model configuration, tokenizer files, and
weights. Depending on the model, the weights may be named `model.safetensors`
or `pytorch_model.bin`.

### What each model does

| Folder | Runtime job |
|---|---|
| `all-MiniLM-L6-v2` | Bouncer embeddings, Bouncer retraining, and semantic fallback |
| `semantic_model` | Primary semantic clustering and duplicate-story fusion |
| `distilbart-cnn-12-6` | Local article and PowerPoint summarization |
| `flan-t5-local` | Opinion generation and “Why it matters” analysis |
| `distilbert-sst-2` | Positive, negative, or neutral sentiment analysis |

There is currently no independent output field or separately trained model
called `intent analysis`. The FLAN-T5 opinion/“Why it matters” stage performs
the closest strategic interpretation. Category and region classification are
separate rule/learning stages. Do not mistake those stages for a dedicated
intent classifier.

If `semantic_model` is absent but `all-MiniLM-L6-v2` is valid, clustering uses
MiniLM as its fallback. For the complete intended setup, install both folders.

## 3. Files that must not be lost during an upgrade

Before replacing anything, stop the server and copy the entire
`C:\App_Portable` directory to a dated backup.

Always preserve:

```text
C:\App_Portable\backend\.env
C:\App_Portable\backend\template.pptx
C:\App_Portable\backend\model_weights
C:\App_Portable\backend\news_scrapper\runtime
C:\App_Portable\backend\venture_lens\runtime
C:\App_Portable\python_embed
```

The runtime folders contain user names, analytics, history, workflows,
selected/hidden articles, VOC, Bouncer feedback, and cached Venture Lens data.
Replacing those folders with empty GitHub folders loses the server state.

## 4. Backend files to copy from GitHub

From the downloaded repository, copy these items into:

```text
C:\App_Portable\backend
```

Copy:

```text
main.py
requirements.txt
core\
news_scrapper\
venture_lens\
```

When copying `news_scrapper`, preserve the existing
`news_scrapper\runtime` directory. When copying `venture_lens`, preserve its
existing `runtime` directory.

Do not copy only `main.py`. The application imports `core`, `news_scrapper`,
and `venture_lens`.

The active source configuration files are:

```text
C:\App_Portable\backend\news_scrapper\config\sites.json
C:\App_Portable\backend\news_scrapper\config\sites_broadcast.json
```

Old `sites.json` files directly under `backend` are not the primary source
files in the new structure.

## 5. Build and copy the frontend

Perform this step on the development PC that has Node.js installed.

Open PowerShell in the repository and run:

```powershell
cd news-ui
npm install
npm run build
```

The build is created at:

```text
news-ui\dist
```

On the server:

1. Stop `START_SENSE.bat`.
2. Rename the existing `C:\App_Portable\frontend\dist` to `dist_backup`.
3. Copy the newly built `dist` folder to:

```text
C:\App_Portable\frontend\dist
```

Verify these two paths exist:

```text
C:\App_Portable\frontend\dist\index.html
C:\App_Portable\frontend\dist\assets
```

The server does not need Node.js, `npm`, the React source, or `node_modules`.
FastAPI serves the static `dist` directory.

## 6. Complete production `.env`

Create this file:

```text
C:\App_Portable\backend\.env
```

Copy the following content into it. Change all example passwords, the hash
secret, IP allowlists, team names, and any internal API settings before real
use.

Do not add the Samsung Web Search client/token or Samsung Chat client/token
until they are available. They are deliberately blank below.

```dotenv
# ============================================================
# SENSE.AI / NEWSSCRAPPER PORTABLE WINDOWS PRODUCTION SETTINGS
# ============================================================

# Application mode and local security keys
NEWSSCRAPPER_ENV=production
DIRECTOR_KEY=Orion-Approval-9472
ANALYTICS_KEY=Atlas-Analytics-6814
GATEKEEPER_KEY=Hermes-Gatekeeper-5279
NEWSSCRAPPER_IP_HASH_SECRET=replace-this-with-a-long-random-secret-at-least-32-characters

# Portable server paths
NEWSSCRAPPER_FRONTEND_DIST=C:\App_Portable\frontend\dist
NEWSSCRAPPER_RUNTIME_DIR=C:\App_Portable\backend\news_scrapper\runtime
VENTURE_LENS_RUNTIME_DIR=C:\App_Portable\backend\venture_lens\runtime
SENSE_MODEL_ROOT=C:\App_Portable\backend\model_weights

# Force AI inference to use installed local model folders
SENSE_OFFLINE_ONLY=1

# Profile routing
BROADCAST_SPECIAL_IPS=107.109.202.212,107.109.202.33,109.109.201.228

# Restricted-page access
ANALYTICS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
GATEKEEPER_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
PROFILE_SETTINGS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
SYSTEM_STATUS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245

# Direct deployment: trust only local loopback forwarding.
# Add an IIS/Nginx proxy address only if such a proxy is actually installed.
TRUSTED_PROXY_IPS=127.0.0.1,::1

# Optional names shown in analytics
TEAM_IP_MAP=127.0.0.1:Server PC,107.109.201.245:Vineet Singh,109.109.201.228:Broadcast User

# Scheduler and crawler
SCHEDULER_ENABLED=true
SCHEDULER_RETRY_DELAY_SECONDS=600
HISTORY_RETENTION_DAYS=30
CRAWL_LOOKBACK_DAYS=1
SCRAPY_ROBOTSTXT_OBEY=true
DISCOVERY_BACKEND=scrapy
DISCOVERY_MAX_WORKERS=6
DISCOVERY_GROUP_SIZE=10
DISCOVERY_SITE_DELAY_SECONDS=0.5
DISCOVERY_MIN_SIMILARITY=0.30
DISCOVERY_KEEP_UNDATED=true
DISCOVERY_FALLBACK_TO_SCRAPY=true
PIPELINE_KEEP_DEBUG_FILES=false

# Secure Windows/company TLS
NEWSSCRAPPER_USE_SYSTEM_CA=true
# If the company requires an explicit PEM certificate bundle, uncomment:
# REQUESTS_CA_BUNDLE=C:\App_Portable\backend\certificates\company-ca-bundle.pem
# SSL_CERT_FILE=C:\App_Portable\backend\certificates\company-ca-bundle.pem

# Samsung Web Search enrichment
SAMSUNG_WEB_SEARCH_URL=https://genai-openapi.sec.samsung.net/swahq/trial/api-web-search/openapi/web-search/v1/search
SAMSUNG_WEB_SEARCH_CLIENT=
SAMSUNG_WEB_SEARCH_TOKEN=
SAMSUNG_WEB_SEARCH_TIMEOUT=90
SAMSUNG_WEB_SEARCH_VERIFY_SSL=true
SAMSUNG_WEB_SEARCH_DEBUG=false
WEB_SEARCH_ENRICHMENT_ENABLED=false
WEB_SEARCH_MAX_ENRICH_PER_RUN=0
WEB_SEARCH_ENRICH_DELAY_SECONDS=0
WEB_SEARCH_REQUIRE_SUCCESS=false

# Samsung Chat final summarization
SAMSUNG_CHAT_URL=https://genai-openapi.sec.samsung.net/swahq/trial/api-chat/openapi/chat/v1/messages
SAMSUNG_CHAT_CLIENT=
SAMSUNG_CHAT_TOKEN=
SAMSUNG_CHAT_MODEL_ID=
SAMSUNG_CHAT_TIMEOUT=180
SAMSUNG_CHAT_VERIFY_SSL=true
SAMSUNG_CHAT_DEBUG=false
FINAL_CHAT_SUMMARY_ENABLED=false
FINAL_CHAT_SUMMARY_DELAY_SECONDS=0
FINAL_CHAT_SUMMARY_MAX_ARTICLES=0

# Article image metadata enrichment
ARTICLE_IMAGE_METADATA_ENABLED=true
ARTICLE_IMAGE_METADATA_TIMEOUT=12
ARTICLE_IMAGE_METADATA_VERIFY_SSL=true
ARTICLE_IMAGE_METADATA_DEBUG=false

# Venture Lens
# Public GitHub requests work without a token but have a smaller rate limit.
GITHUB_TOKEN=
```

Keep `WEB_SEARCH_ENRICHMENT_ENABLED=false` and
`FINAL_CHAT_SUMMARY_ENABLED=false` while the Samsung credentials are blank.
Local MiniLM/BART/FLAN/DistilBERT processing is independent of those Samsung
features.

## 7. Install backend packages into embedded Python

There is no system Python on this server. Run this exact command from Command
Prompt:

```bat
C:\App_Portable\python_embed\python.exe -m pip install --upgrade pip
C:\App_Portable\python_embed\python.exe -m pip install -r C:\App_Portable\backend\requirements.txt
```

If the first command reports that `pip` is unavailable, inspect:

```text
C:\App_Portable\python_embed\python311._pth
```

It should allow the embedded library and site packages and should not disable
`import site`. The existing portable installation already contained pip and
`Lib\site-packages`, so normally no change is required.

Verify the important imports:

```bat
C:\App_Portable\python_embed\python.exe -c "import fastapi, uvicorn, scrapy, torch, transformers, sentence_transformers, sklearn; print('Python dependencies OK')"
```

Expected output:

```text
Python dependencies OK
```

## 8. Complete `START_SENSE.bat`

Create or replace:

```text
C:\App_Portable\START_SENSE.bat
```

with:

```bat
@echo off
setlocal EnableExtensions
title SENSE Intelligence Platform
color 0A

set "ROOT_DIR=%~dp0"
set "PYTHON_EXE=%ROOT_DIR%python_embed\python.exe"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_INDEX=%ROOT_DIR%frontend\dist\index.html"
set "APP_URL=http://127.0.0.1/"

echo ===================================================
echo       SENSE INTELLIGENCE PLATFORM BOOT SEQUENCE
echo ===================================================
echo.

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Embedded Python was not found:
    echo %PYTHON_EXE%
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\main.py" (
    echo [ERROR] Backend main.py was not found:
    echo %BACKEND_DIR%\main.py
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\.env" (
    echo [ERROR] Backend .env was not found:
    echo %BACKEND_DIR%\.env
    pause
    exit /b 1
)

if not exist "%FRONTEND_INDEX%" (
    echo [ERROR] Frontend build was not found:
    echo %FRONTEND_INDEX%
    echo Build news-ui and copy its dist folder into App_Portable\frontend.
    pause
    exit /b 1
)

cd /d "%BACKEND_DIR%"

echo [1/2] Backend directory: %BACKEND_DIR%
echo [2/2] Opening %APP_URL% after the server starts.
echo.
echo Keep this window open. Closing it stops the application.
echo The backend automatically restarts 10 seconds after a Python crash.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 12; Start-Process '%APP_URL%'"

:run_server
"%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 80 --workers 1

set "SERVER_EXIT_CODE=%ERRORLEVEL%"
echo.
echo [WARNING] Sense.AI stopped with exit code %SERVER_EXIT_CODE%.
echo Restarting in 10 seconds. Press Ctrl+C and confirm Y to stop.
timeout /t 10 /nobreak >nul
goto run_server
```

Use exactly one Uvicorn worker. Multiple workers would create multiple
schedulers and separate process-level JSON locks.

## 9. Windows server settings

The server cannot execute scheduled scans while it is shut down or asleep.

Configure Windows so that:

- the laptop remains connected to company power;
- sleep is disabled while plugged in;
- closing the lid does not sleep the laptop, if applicable;
- the network adapter is not powered down during inactivity;
- Windows Firewall allows inbound TCP port 80 on the company/private network.

Do not expose port 80 to the public internet. This application is designed for
the internal company network.

## 10. Start and validate

Double-click:

```text
C:\App_Portable\START_SENSE.bat
```

On the server PC, open:

```text
http://127.0.0.1/
```

From another internal PC, open:

```text
http://SERVER-PC-IP/
```

For the server address from the original deployment, this was:

```text
http://107.109.202.178/
```

Validate the backend:

```text
http://127.0.0.1/status
```

The response should be JSON and should show:

- `"is_active": false` when idle;
- both Default and Broadcast profile information;
- the next scheduler run;
- existing source configuration files.

Validate profile routing:

```text
http://127.0.0.1/profile
```

An IP in `BROADCAST_SPECIAL_IPS` should receive `broadcast`. Other IPs should
receive `default`.

## 11. Confirm all local AI models

At backend startup and during the first scheduler/manual scan, watch the
terminal for:

```text
AI Gatekeeper is awake and profile-aware.
Opinion Engine Ready.
FUSION ENGINE: Semantic Model Ready.
FUSION ENGINE: Local sentiment model ready
FUSION ENGINE: Shared summarization ready.
```

The semantic and summarization messages appear when the fusion pipeline runs,
not necessarily during the initial Uvicorn startup.

If the terminal says that a model failed to load:

1. Check that its folder is directly under `backend\model_weights`.
2. Check that `config.json` is directly inside that folder.
3. Check that tokenizer files and model weights are present.
4. Check that the `.env` path is:

```dotenv
SENSE_MODEL_ROOT=C:\App_Portable\backend\model_weights
```

5. Restart `START_SENSE.bat`.

With `SENSE_OFFLINE_ONLY=1`, the AI pipeline does not silently download a
missing semantic or sentiment model. That makes missing installations visible
in the terminal and keeps production inference local.

## 12. PowerPoint export

PowerPoint export requires:

```text
C:\App_Portable\backend\template.pptx
```

The batch file changes the working directory to `backend`, so the existing
relative template lookup resolves correctly. PowerPoint export remains
disabled for the Broadcast profile by application policy.

## 13. Safe update checklist

For every future release:

1. Back up `C:\App_Portable`.
2. Stop `START_SENSE.bat`.
3. Preserve `.env`, `template.pptx`, `model_weights`, and both runtime folders.
4. Copy the new backend packages.
5. Install the latest `requirements.txt` using `python_embed\python.exe`.
6. Build the frontend on the development machine.
7. Replace `C:\App_Portable\frontend\dist`.
8. Start `START_SENSE.bat`.
9. Open `/status`, `/profile`, and the main UI.
10. Confirm the five AI-model messages during a scan.
