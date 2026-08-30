# Calliope Amber Orbit

This is the complete Windows guide for running Sense.AI/newsScrapper from an
`App_Portable` folder. It assumes the reader can open File Explorer and
PowerShell but does not assume programming experience.

> Important: there are two valid layouts in this guide. The development PC
> keeps source code, tests, Node.js files, and a Python virtual environment.
> The server PC uses the smaller `App_Portable` layout and serves an already
> built frontend. Do not try to make both folders look identical.

## Contents

- [1. Development PC folder structure](#1-what-the-development-pc-folder-should-look-like)
  - [Development folders that may be absent](#development-folders-that-may-be-absent-initially)
  - [Files that must not be copied between machines](#development-files-that-must-never-be-copied-from-another-persons-machine)
  - [Verify the development layout](#quick-development-layout-verification)
  - [Run the development application](#normal-development-commands)
- [1A. Production server folder structure](#1a-what-the-finished-server-folder-must-look-like)
  - [Why the server layout is different](#why-the-server-layout-is-intentionally-different)
  - [Authoritative bouncer pickle locations](#important-bouncer-pickle-locations)
  - [Verify bouncer paths and retraining](#verify-the-active-bouncer-paths-and-retraining)
  - [Files controlling the server](#files-that-control-the-running-server)
- [2. Make a safety copy](#2-make-a-safety-copy-before-an-update)
- [3. Build the frontend](#3-build-the-frontend-on-a-development-computer)
- [4. Safely update App_Portable](#4-safely-copy-a-new-code-release-over-app_portable)
- [5. Create the final environment file](#5-create-the-final-env)
  - [Broadcast routing](#broadcast-profile-routing)
- [6. Install the local AI models](#6-install-the-five-local-ai-models)
- [7. Prepare embedded Python](#7-prepare-embedded-python)
- [8. Start and stop the server](#8-start-and-stop-the-server)
- [9. Scheduler-to-feed data flow](#9-what-happens-from-scheduler-to-feed)
- [10. Verify a deployment](#10-verify-the-deployment)
- [11. Frequent problems](#11-frequent-problems)
  - [UI not built](#ui-not-built-yet)
  - [Broadcast user sees Default](#broadcast-user-sees-default)
  - [Samsung API failure](#samsung-api-fails)
  - [Scheduler appears to stop](#scheduler-appears-to-stop)
- [12. Claude Code prompt for Windows UI failures](#12-claude-code-prompt-for-the-two-windows-only-ui-failures)

## 1. What the development PC folder should look like

The development checkout is the place where code is edited, tested, and built.
The repository folder may have any parent path. In this example it is
`C:\Development\velvet-penguin-lantern\legacy_app`.

```text
C:\Development\velvet-penguin-lantern\legacy_app
│
│   .env                         local secrets; ignored by Git
│   .env.example                 safe, commented configuration template
│   .gitignore                   tells Git which generated/private files to ignore
│   main.py                      one FastAPI composition root
│   requirements.txt             complete backend Python dependency list
│   CALLIOPE_AMBER_ORBIT.md      this deployment and recovery guide
│   START_LEGACY_MAC.command     Mac development convenience launcher
│
├── .venv                        development Python environment; never commit
│   ├── Scripts                  Windows virtual-environment executables
│   └── Lib\site-packages        locally installed Python packages
│
├── core                         shared infrastructure used by both products
│   ├── profile.py               trusted-proxy and IP/profile resolution
│   ├── rate_limit.py            Samsung three-requests-per-minute enforcement
│   ├── secure_http.py           verified TLS and company-CA handling
│   ├── settings.py              central paths and runtime migration
│   └── storage.py               safe JSON persistence helpers
│
├── news_scrapper                NewsScrapper backend package
│   ├── application.py           APIs, scheduler, workflow, analytics, pipeline
│   ├── semantic_clustering.py   MiniLM clustering and BART/sentiment fallback
│   ├── train_bouncer.py         profile-aware bouncer training
│   ├── adapters
│   │   ├── samsung_web_search.py
│   │   ├── samsung_chat.py
│   │   └── article_metadata.py
│   ├── config
│   │   ├── sites.json           default-profile sources
│   │   └── sites_broadcast.json broadcast-profile sources
│   ├── crawler
│   │   ├── scrapy.cfg
│   │   └── news_aggregator
│   │       └── spiders
│   │           └── universal_spider.py
│   └── runtime                  generated live data; ignored by Git
│       ├── intelligence_store
│       │   ├── default\history
│       │   └── broadcast\history
│       ├── samsung_pipeline_cache
│       ├── viewer_profiles.json
│       ├── viewer_hidden_store.json
│       ├── viewer_saved_store.json
│       ├── viewer_url_briefings.json       private URL jobs and briefings
│       ├── workflow_store.json
│       ├── workflow_store_broadcast.json
│       ├── trainingData.json
│       ├── usage_tracker.json
│       ├── bouncer_model.pkl              active Default bouncer model
│       └── bouncer_model_broadcast.pkl    active Broadcast bouncer model
│
├── venture_lens                 Venture Lens backend package
│   ├── router.py                Venture Lens API routes
│   └── runtime                  generated snapshots/watchlists; ignored by Git
│
├── news-ui                      one Vite/React frontend for both products
│   ├── package.json             frontend commands and dependencies
│   ├── package-lock.json        locked frontend dependency versions
│   ├── vite.config.js           development server and backend proxy
│   ├── src
│   │   ├── news-scrapper        NewsScrapper screens/components
│   │   ├── venture-lens         Venture Lens screens/components
│   │   └── shared               shared UI and API utilities
│   ├── node_modules             generated by npm install; never commit/copy
│   └── dist                     generated by npm run build; deploy this output
│
├── model_weights                local model files; ignored by Git
│   ├── all-MiniLM-L6-v2
│   ├── distilbart-cnn-12-6
│   ├── flan-t5-local
│   └── distilbert-sst-2
│
├── scripts
│   ├── build_windows.bat
│   ├── start_windows.bat
│   └── update_portable_app.ps1
│
├── tests                        backend regression and architecture tests
└── docs                         focused technical design documents
```

### Development folders that may be absent initially

These are created by installation or the first successful run:

- `.venv`
- `news-ui\node_modules`
- `news-ui\dist`
- `news_scrapper\runtime`
- `venture_lens\runtime`
- cache folders such as `__pycache__`

Their absence in a fresh checkout is normal. Their presence in GitHub is not
required.

### Development files that must never be copied from another person's machine

- `.env`, because it contains local credentials, keys, IPs, and absolute paths.
- `.venv` or `node_modules`, because they contain machine-specific executables.
- runtime analytics/profile JSON, unless intentionally restoring a backup.
- partially downloaded model folders.

### Quick development-layout verification

Open PowerShell inside `legacy_app` and run:

```powershell
Test-Path .\main.py
Test-Path .\requirements.txt
Test-Path .\news_scrapper\application.py
Test-Path .\news_scrapper\config\sites.json
Test-Path .\news_scrapper\config\sites_broadcast.json
Test-Path .\news-ui\package.json
Test-Path .\venture_lens\router.py
```

Every command should print `True`. If one prints `False`, stop and restore that
file from the repository before installing packages or changing configuration.

### Normal development commands

Backend terminal:

```powershell
cd "C:\Development\velvet-penguin-lantern\legacy_app"
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend terminal:

```powershell
cd "C:\Development\velvet-penguin-lantern\legacy_app\news-ui"
npm run dev
```

The development frontend is normally `http://127.0.0.1:5173`; Vite proxies API
requests to the backend at `http://127.0.0.1:8000`. Production does not run
Vite and does not use port 5173.

For development, use local paths or omit path overrides so the defaults beside
the source code are used. Do not copy these production-only absolute paths into
a development `.env` unless the development checkout really lives there:

```env
NEWSSCRAPPER_FRONTEND_DIST=C:\App_Portable\frontend\dist
NEWSSCRAPPER_RUNTIME_DIR=C:\App_Portable\news_scrapper\runtime
VENTURE_LENS_RUNTIME_DIR=C:\App_Portable\venture_lens\runtime
SENSE_MODEL_ROOT=C:\App_Portable\model_weights
```

## 1A. What the finished server folder must look like

Create `C:\App_Portable`. Its important contents must look like this:

```text
C:\App_Portable
│   .env
│   main.py
│   requirements.txt
│
├── core
├── news_scrapper
│   ├── config
│   │   ├── sites.json
│   │   └── sites_broadcast.json
│   ├── crawler
│   └── runtime                 (created/updated by the application)
│       ├── bouncer_model.pkl
│       └── bouncer_model_broadcast.pkl
├── venture_lens
│   └── runtime                 (created/updated by the application)
├── frontend
│   └── dist
│       ├── index.html
│       └── assets
├── model_weights
│   ├── all-MiniLM-L6-v2
│   ├── distilbart-cnn-12-6
│   ├── flan-t5-local
│   └── distilbert-sst-2
├── python_embed
│   ├── python.exe
│   └── Lib\site-packages
└── scripts
    ├── start_windows.bat
    └── update_portable_app.ps1
```

Do not put `dist` directly beside `main.py`. The configured production path is
`C:\App_Portable\frontend\dist`.

### Why the server layout is intentionally different

- `frontend\dist` is built output; the server does not need frontend source.
- `python_embed` replaces a system Python installation.
- `node_modules`, Vite, and `npm run dev` are not needed in production.
- `runtime` remains beside its owning backend package so backup boundaries are
  obvious.
- `news_scrapper\runtime\bouncer_model.pkl` and
  `news_scrapper\runtime\bouncer_model_broadcast.pkl` are the authoritative
  trained bouncer models. Startup, retraining, reloading, status reporting, and
  backup all use these same files.
- `model_weights` remains at the root because NewsScrapper's clustering,
  fallback summarization, intent, and sentiment components share it.

### Important: bouncer pickle locations

Do not place the active bouncer pickle files beside `main.py`.

The only active locations are:

```text
C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl
C:\App_Portable\news_scrapper\runtime\bouncer_model_broadcast.pkl
```

The first file learns from Default-profile feedback. The second learns from
Broadcast-profile feedback. They must remain separate.

Older releases could leave similarly named pickle files in
`C:\App_Portable`. Those root-level files are legacy copies and are no longer
loaded. After stopping the server and making a backup, they may be archived or
removed. Never replace the runtime copies with an older root-level copy.

If this is a new installation and the two runtime pickle files do not exist,
that is acceptable. The application starts without a trained bouncer and
creates the appropriate file after sufficient Interested/Not Interested
training data is submitted and training completes.

### Verify the active bouncer paths and retraining

Use this check when:

- installing the application on a Windows machine for the first time;
- copying a newer backend into `App_Portable`;
- changing `NEWSSCRAPPER_RUNTIME_DIR`;
- investigating whether Interested/Not Interested feedback trains the model
  used for future article scoring; or
- seeing a startup message such as `Loaded default bouncer:
  bouncer_model.pkl` and wanting to know the complete resolved path.

The startup message prints only the filename. It does not prove that the file
was loaded from the folder beside `main.py`. The `/status` endpoint reports the
real, resolved path used by the running backend.

#### Step 1: start the backend first

The commands below call the running backend, so they cannot be used before
Uvicorn starts.

On a development PC, open a PowerShell window and run:

```powershell
cd "C:\Development\velvet-penguin-lantern\legacy_app"
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Leave that PowerShell window open. Wait until it displays:

```text
Application startup complete.
```

On the portable server, start the existing batch file instead:

```powershell
cd C:\App_Portable
.\scripts\start_windows.bat
```

Leave that server window open too. The verification commands must be run in a
different PowerShell window.

#### Step 2: open a second PowerShell window

You can open this second PowerShell window from any folder. These commands use
an HTTP address and therefore do not depend on the current directory.

Copy and run:

```powershell
$status = Invoke-RestMethod http://127.0.0.1:8000/status

$status.profiles.default.bouncer_model_file
$status.profiles.broadcast.bouncer_model_file
```

On `C:\App_Portable`, the correct output is:

```text
C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl
C:\App_Portable\news_scrapper\runtime\bouncer_model_broadcast.pkl
```

On a development checkout, the beginning of the path will be different, but
both paths must still finish with:

```text
news_scrapper\runtime\bouncer_model.pkl
news_scrapper\runtime\bouncer_model_broadcast.pkl
```

To display the complete status record for each profile, run:

```powershell
$status.profiles.default | Format-List *
$status.profiles.broadcast | Format-List *
```

Check these fields:

```text
bouncer_model_file
bouncer_model_exists
training_file
training_file_exists
```

For an established installation, both `exists` values should normally be
`True`. A new installation may legitimately report that a model does not exist
until both training labels have sufficient examples.

#### Step 3: inspect the physical runtime files

On the portable server, run:

```powershell
Get-Item C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl |
    Select-Object FullName, LastWriteTime, Length

Get-Item C:\App_Portable\news_scrapper\runtime\bouncer_model_broadcast.pkl |
    Select-Object FullName, LastWriteTime, Length
```

If either file has not been created yet, PowerShell reports that the path does
not exist. That is not automatically an error on a fresh installation.

The safer version below reports existence without producing a red error:

```powershell
$defaultModel = "C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl"
$broadcastModel = "C:\App_Portable\news_scrapper\runtime\bouncer_model_broadcast.pkl"

Test-Path $defaultModel
Test-Path $broadcastModel

if (Test-Path $defaultModel) {
    Get-Item $defaultModel | Select-Object FullName, LastWriteTime, Length
}

if (Test-Path $broadcastModel) {
    Get-Item $broadcastModel | Select-Object FullName, LastWriteTime, Length
}
```

#### Step 4: prove that feedback updates and reloads the same model

1. Keep the backend terminal visible.
2. In the browser, open the correct profile.
3. Mark one article Interested or Not Interested.
4. Watch the backend terminal. The vote is saved immediately and retraining is
   queued. The terminal should eventually show messages similar to:

```text
[BOUNCER:default] Retraining with new data...
Bouncer model saved to: C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl
[BOUNCER:default] Brain successfully upgraded and reloaded (model_loaded=True).
```

For Broadcast, the message should name:

```text
C:\App_Portable\news_scrapper\runtime\bouncer_model_broadcast.pkl
```

5. After the successful reload message appears, return to the second
   PowerShell window and run:

```powershell
Get-Item C:\App_Portable\news_scrapper\runtime\bouncer_model.pkl |
    Select-Object FullName, LastWriteTime, Length
```

Use the Broadcast filename instead if the vote was made in the Broadcast
profile. `LastWriteTime` should reflect the completed training run.

One vote does not always produce a model. Training needs valid examples from
both classes—Interested and Not Interested. If training reports insufficient
labels, submit legitimate examples of the missing label and allow the queued
training run to finish.

#### How to interpret an incorrect result

If `/status` reports:

```text
C:\App_Portable\bouncer_model.pkl
```

instead of a path inside `news_scrapper\runtime`, do not copy pickle files
around while the server is running. Check these items:

1. Confirm the backend contains the latest
   `news_scrapper\application.py`, `news_scrapper\train_bouncer.py`, and
   `core\settings.py`.
2. Open `C:\App_Portable\.env`.
3. Find `NEWSSCRAPPER_RUNTIME_DIR`.
4. Set it to:

```env
NEWSSCRAPPER_RUNTIME_DIR=C:\App_Portable\news_scrapper\runtime
```

5. Save `.env`.
6. Stop Uvicorn with `Ctrl+C`.
7. Start the batch file again.
8. Repeat the `/status` commands.

The root-level files may remain as old rollback copies. They must not be
manually copied over newer runtime files. The startup migration copies a
root-level legacy file only when the corresponding runtime destination does
not exist; it never overwrites an existing runtime model.

### Files that control the running server

| Item | What it controls | Restart required after editing? |
|---|---|---|
| `.env` | keys, IP routing, paths, scheduler, Samsung services | Yes |
| `news_scrapper\config\sites.json` | default-profile sources | Next scan recommended |
| `news_scrapper\config\sites_broadcast.json` | broadcast sources | Next scan recommended |
| `frontend\dist` | visible frontend | Yes, then hard refresh |
| `model_weights` | local clustering and AI fallbacks | Yes |
| `news_scrapper\runtime` | live JSON data and both trained bouncer pickle files; do not hand-edit while running | Not applicable |

## 2. Make a safety copy before an update

1. Stop the black server window with `Ctrl+C`.
2. Open File Explorer.
3. Open `C:\App_Portable`.
4. Copy these items to a safe backup folder:
   - `.env`
   - `news_scrapper\runtime` (this includes both trained bouncer pickle files)
   - `venture_lens\runtime`
   - `model_weights`
   - `python_embed`
5. Do not delete the old folder until the updated server has been tested.

These contain configuration, profiles, analytics, saved items, votes, history,
trained bouncer state, models, and the portable Python installation.

## 3. Build the frontend on a development computer

The server computer does not need Node.js when a completed `dist` is supplied.

1. Open PowerShell in the repository's `legacy_app` folder.
2. Run:

```powershell
cd "C:\path\to\legacy_app\news-ui"
npm install
npm run build
```

3. Confirm this file exists:

```text
C:\path\to\legacy_app\news-ui\dist\index.html
```

4. In the deployment copy, create `frontend`.
5. Copy the entire `news-ui\dist` folder into `frontend`, producing:

```text
C:\App_Portable\frontend\dist\index.html
```

If `npm run build` reports an error, do not deploy that build.

## 4. Safely copy a new code release over App_Portable

The repository contains an interactive updater. It protects `.env`, models,
portable Python, and mutable runtime data.

1. Extract the new release anywhere except `C:\App_Portable`. Example:

```text
C:\Downloads\new-release\legacy_app
```

2. Open `C:\App_Portable` in File Explorer.
3. Click the address bar, type `powershell`, and press Enter.
4. Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "C:\Downloads\new-release\legacy_app\scripts\update_portable_app.ps1" `
  -Source "C:\Downloads\new-release\legacy_app" `
  -Destination "C:\App_Portable"
```

When a code file already exists, the program offers:

- `K`: keep the current server file.
- `R`: replace it with the new release file.
- `N`: keep both; the new one is saved with `.incoming`.
- `A`: replace this and every remaining code conflict.
- `S`: keep this and every remaining conflict.

For an ordinary upgrade, choose `A` after confirming that the source is the
correct release. The updater never overwrites `.env`, `model_weights`,
`python_embed`, `news_scrapper\runtime`, or `venture_lens\runtime`.

Review any `*.incoming` files before starting the service.

## 5. Create the final .env

1. In `C:\App_Portable`, copy `.env.example`.
2. Rename the copy to `.env`.
3. Open `.env` in Notepad.
4. Read every comment. The supplied template contains every active setting.
5. At minimum, change:
   - `DIRECTOR_KEY`
   - `ANALYTICS_KEY`
   - `GATEKEEPER_KEY`
   - `NEWSSCRAPPER_IP_HASH_SECRET`
   - all allowed-IP lists
   - `CONTRIBUTIONS_ALLOWED_IPS`
   - `TEAM_IP_MAP`
   - Samsung Web Search client/token
   - Samsung Chat client/token
6. Keep:

```env
NEWSSCRAPPER_ENV=production
NEWSSCRAPPER_FRONTEND_DIST=C:\App_Portable\frontend\dist
NEWSSCRAPPER_RUNTIME_DIR=C:\App_Portable\news_scrapper\runtime
VENTURE_LENS_RUNTIME_DIR=C:\App_Portable\venture_lens\runtime
SENSE_MODEL_ROOT=C:\App_Portable\model_weights
SENSE_OFFLINE_ONLY=true
```

Generate the IP hashing secret in PowerShell:

```powershell
[Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLower()
```

Copy the printed 64-character value after
`NEWSSCRAPPER_IP_HASH_SECRET=`. Keep this value stable across upgrades.

Production keys must contain at least six characters. The old four-digit
development PIN is intentionally rejected in production.

### Contributions workspace access

Put the real client IP addresses that may create Samsung Internal content after
`CONTRIBUTIONS_ALLOWED_IPS=`, separated by commas:

```env
CONTRIBUTIONS_ALLOWED_IPS=127.0.0.1,::1,192.0.2.10,192.0.2.11
```

Keep `127.0.0.1,::1` if the same PC is also used for local testing. Restart the
backend after changing `.env`, then refresh the browser. An allowed user sees
**Contributions** inside For You. Other users see only the personal desk, Saved
Signals, and Private Briefings. A direct contribution URL is rejected by both
the browser and backend.

If a reverse proxy is used, put only that proxy's IP in `TRUSTED_PROXY_IPS`.
Never trust every address. Without a proxy, leave loopback values only.

### Capability-based administration

Deployment allowlists bootstrap the first trusted operators. After startup, an
operator with `access.manage` can use **Settings > Access Management** to grant
the minimum capabilities required by each signed viewer. These runtime grants
are written atomically to:

```text
C:\App_Portable\news_scrapper\runtime\access_control.json
```

They apply immediately and never rewrite `.env`. Keep this file with the other
runtime state during upgrades, but do not publish it to Git. Privilege changes
are recorded in the adjacent access audit log. Browser code never receives or
stores the deployment keys after a capability session is unlocked; the server
uses an HttpOnly signed cookie.

Broadcast is now a content vertical in the unified corpus, not an IP-routed
profile. Do not reintroduce separate Default/Broadcast scheduler runs or replace
the active `sites.json` with a legacy broadcast file.

### Optional Research Intelligence providers

Research and Venture Lens work without extra credentials by retaining their
GitHub/arXiv starter cache and using public OpenAlex and Hugging Face access.
The following `.env` values are optional:

```env
GITHUB_TOKEN=
OPENALEX_API_KEY=
HUGGINGFACE_TOKEN=
EPO_OPS_CLIENT_ID=
EPO_OPS_CLIENT_SECRET=
X_BEARER_TOKEN=
```

Leave EPO and X blank when your organization has not provisioned them. Their
lanes disappear cleanly; the application does not render fake zero-valued
cards. Never paste these tokens into the frontend. After changing any value,
restart Uvicorn and refresh the browser. Venture Lens keeps an independent
last-success cache and does not add another NewsScrapper scheduler.

## 6. Install the five local AI models

The application uses:

| Folder | Hugging Face model | Purpose |
|---|---|---|
| `all-MiniLM-L6-v2` | `sentence-transformers/all-MiniLM-L6-v2` | semantic clustering |
| `distilbart-cnn-12-6` | `sshleifer/distilbart-cnn-12-6` | summary fallback |
| `flan-t5-local` | `google/flan-t5-small` | Why This Matters/intent fallback |
| `distilbert-sst-2` | `distilbert/distilbert-base-uncased-finetuned-sst-2-english` | sentiment |
| `opus-mt-tc-big-en-ko` | `Helsinki-NLP/opus-mt-tc-big-en-ko` | private English-to-Korean interface translation |

On an internet-connected development PC:

```powershell
py -m venv model_downloader
.\model_downloader\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install "huggingface_hub[cli]"

huggingface-cli download sentence-transformers/all-MiniLM-L6-v2 `
  --local-dir ".\model_weights\all-MiniLM-L6-v2"

huggingface-cli download sshleifer/distilbart-cnn-12-6 `
  --local-dir ".\model_weights\distilbart-cnn-12-6"

huggingface-cli download google/flan-t5-small `
  --local-dir ".\model_weights\flan-t5-local"

huggingface-cli download distilbert/distilbert-base-uncased-finetuned-sst-2-english `
  --local-dir ".\model_weights\distilbert-sst-2"

huggingface-cli download Helsinki-NLP/opus-mt-tc-big-en-ko `
  --local-dir ".\model_weights\opus-mt-tc-big-en-ko"
```

Copy all five completed folders to
`C:\App_Portable\model_weights`. Do not copy partially downloaded folders.
Models are deliberately excluded from GitHub.

With Samsung Chat healthy, Chat is the primary source for the concise lead,
key points, intent, category, region, importance, and Why This Matters. If Chat
fails preflight or an article call fails, BART/FLAN-T5 provide the local
fallback. MiniLM remains the semantic clustering engine.

The Korean model is loaded only when a browser first switches to Korean. Its
choice is saved in that browser, not globally, so another user remains in
English. The initial Korean request can take longer while the model loads;
later translations reuse the in-process cache.

For exact click-by-click browser downloads, portable-Python commands, the
required file list, `.env` configuration, endpoint validation, and
troubleshooting, follow the dedicated guide:
[SUPERNOVA_ORCHID_ATLAS.md](./SUPERNOVA_ORCHID_ATLAS.md).

## 7. Prepare embedded Python

If a working `python_embed` was already created for this application, preserve
it during upgrades. To build a new one, use the same 64-bit Python version on a
connected Windows computer.

1. Download the official Windows embeddable 64-bit Python package.
2. Extract it into `C:\App_Portable\python_embed`.
3. Open the file ending in `._pth` inside `python_embed`.
4. Ensure it contains:

```text
python312.zip
.
Lib\site-packages
import site
```

The zip name must match the downloaded version (for example, Python 3.12 uses
`python312.zip`).

5. Download `get-pip.py` from `https://bootstrap.pypa.io/get-pip.py` into
   `C:\App_Portable`.
6. Open PowerShell in `C:\App_Portable`.
7. Run:

```powershell
.\python_embed\python.exe .\get-pip.py
.\python_embed\python.exe -m pip install --upgrade pip
.\python_embed\python.exe -m pip install -r .\requirements.txt
```

8. Verify:

```powershell
.\python_embed\python.exe --version
.\python_embed\python.exe -c "import fastapi, scrapy, torch, transformers; print('Python dependencies OK')"
```

If the final line does not print `Python dependencies OK`, do not start the
server. Read the module named in the error and rerun the requirements command.

## 8. Start and stop the server

Double-click:

```text
C:\App_Portable\scripts\start_windows.bat
```

The launcher prefers `python_embed\python.exe`. If it is absent, it falls back
to `.venv\Scripts\python.exe`. It runs one Uvicorn worker, which is required
because the scheduler and JSON stores are process-local.

Open on the server:

```text
http://127.0.0.1:8000
```

Open from another permitted LAN computer:

```text
http://SERVER_IP_ADDRESS:8000
```

Allow TCP port 8000 through Windows Firewall only for the company/private
network. Press `Ctrl+C` in the server window to stop it.

## 9. What happens from scheduler to feed

1. FastAPI starts and reads `.env`.
2. Runtime folders and the unified briefing history folder are created.
3. Existing legacy JSON state is copied into the new runtime location only
   when the destination does not already exist.
4. The single scheduler owner calculates the next due time from the newest
   unified briefing. Missing or stale data triggers one run shortly after
   startup.
5. Samsung Web Search and Chat are tested before crawling.
6. Scrapy reads the one active source catalog and keyword taxonomy from
   `news_scrapper\config\sites.json`; broadcast is metadata within this corpus,
   not another scheduler profile.
7. Scrapy handles RSS feeds and ordinary HTML listing/article pages.
8. If Web Search is healthy, Scrapy discovers matching URLs and Web Search
   supplies exact-reference article data. Python rejects different-domain or
   different-article references. If Web Search is unhealthy, Scrapy performs
   full local extraction.
9. Image metadata fills missing images.
10. Bouncer removes trained unwanted content and preserves low-confidence items
    for review.
11. MiniLM groups semantically similar articles; repeated publishers cannot
    inflate a cluster.
12. Chat creates final structured intelligence when healthy. BART/FLAN-T5 are
    used when Chat is unavailable.
13. The final JSON is written atomically into the unified briefing history.
14. `/latest-briefing` applies the signed viewer's private hidden state and
    returns the same deterministic shared baseline to every authorized client.
15. The frontend requests `/profile` and `/latest-briefing` from the same
    backend origin and renders the response.

There is exactly one scheduler run and one mutable JSON/model state owner. A
failed run retains the previous healthy briefing and is retried. A scheduled
tick that occurs during a long/manual run is queued instead of silently
discarded. Do not configure more than one Uvicorn worker while this storage
model is active.

## 10. Verify the deployment

In PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/status | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:8000/profile | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:8000/latest-briefing | ConvertTo-Json -Depth 10
```

Check:

- `/status` reports the scheduler and next run.
- `/profile` reports the signed viewer identity and unified product profile.
- `/latest-briefing` reports `success` with `result`, or `empty` before the
  first successful run.
- The terminal clearly reports Samsung preflight PASS/FAIL and selected
  fallback mode.
- Browser refresh preserves per-user saved items and hides.

Run automated checks on a development copy:

```powershell
.\python_embed\python.exe -m unittest discover -s tests -v
cd .\news-ui
npm run build
```

## 11. Frequent problems

### “UI not built yet”

Confirm:

```text
C:\App_Portable\frontend\dist\index.html
```

and:

```env
NEWSSCRAPPER_FRONTEND_DIST=C:\App_Portable\frontend\dist
```

Restart the server after changing `.env`.

### Broadcast user sees default

1. Ask the user for the IP shown in their profile panel.
2. Put that exact address in `BROADCAST_SPECIAL_IPS`.
3. If a proxy exists, configure its exact IP in `TRUSTED_PROXY_IPS`.
4. Restart the backend.
5. Ask the user to refresh.
6. Check `/profile`. Never “fix” this by trusting arbitrary forwarded headers.

### Samsung API fails

Use the terminal classification:

- `404`: route is wrong.
- `401` or `403`: client/token is missing, expired, or unauthorized.
- `400`: request schema/model is rejected.
- certificate error: install/use the company CA; never disable verification.
- timeout/rate limit: local extraction or local summary fallback is selected.

### Scheduler appears to stop

Keep the server PC awake and plugged in. Windows sleep pauses the process.
The application catches up after resume within its misfire window, but no
program can execute while the machine is powered off or suspended. Check
`/status`, the terminal's `last_started_at`, `last_completed_at`,
`last_failed_profiles`, and `next_run`.

### Never overwrite these during an update

```text
.env
model_weights
python_embed
news_scrapper\runtime
venture_lens\runtime
```

They are deliberately protected by `update_portable_app.ps1`.

## 12. Claude Code prompt for the two Windows-only UI failures

The following prompt is intentionally self-contained. It does not require
Claude Code to understand a screenshot. Copy the complete block and paste it
into Claude Code while its working directory is the application repository.

```text
Work only inside this repository. Diagnose and fix two frontend layout
regressions that appear on my Windows development PC. Do not change backend
behavior, API response formats, scheduler logic, profile routing, article
data, themes, or unrelated screens.

Environment:

- Windows 11
- PowerShell
- The frontend is normally started from the news-ui folder with:
  npm run dev
- Vite should be opened at http://127.0.0.1:5173 or
  http://localhost:5173.
- The FastAPI server on port 8000 can also serve a compiled frontend from the
  directory selected by NEWSSCRAPPER_FRONTEND_DIST. Do not assume that port
  8000 and the Vite development server show the same frontend bundle.

Before editing:

1. Read these files completely:
   - news-ui/src/main.jsx
   - news-ui/src/news-scrapper/screens/FeedScreen.jsx
   - news-ui/src/news-scrapper/components/modals/ArticleModal.jsx
   - news-ui/src/news-scrapper/utils/normalize.js
   - news-ui/src/news-scrapper/theme-toggle.css
   - the relevant homepage/layout rules in news-ui/src/index.css
2. Confirm which URL/port is being tested.
3. If the browser is on port 5173, inspect Vite's source output.
4. If the browser is on port 8000, inspect the compiled dist/index.html and
   its hashed assets instead.
5. Reproduce each issue before changing code. Test at browser zoom 100% and
   Windows-like effective viewport sizes, including:
   - 1920x1080 with 125% display scaling equivalent
   - 1536x864
   - 1366x768
6. Do not claim that npm run build fixes the problem unless the tested browser
   was actually loading the old compiled dist.

ISSUE 1 — AI Summary points have lost their individual containers

Expected behavior:

- Open any article dossier.
- Under “AI Summary,” the short summary lead appears first.
- Every item in summary_points appears as its own separate rounded container.
- Each point has its own border, subtle background, internal padding, spacing
  from adjacent points, and a small blue/cyan circular marker.
- The containers must be visible in both light and dark themes.

Broken Windows behavior:

- The points appear as plain lines or ordinary bullets.
- There is no visible rounded box/background/border behind each point.
- The points visually run together instead of looking like separate summary
  cards.

Relevant implementation:

- ArticleModal.jsx calculates summaryLead and summaryPoints.
- The expected rendering maps summaryPoints into individual li elements.
- At present, the li presentation relies heavily on Tailwind utility classes
  such as:
  flex, gap-3, rounded-2xl, border, border-white/10,
  bg-white/[0.035], px-4, py-3, text-sm, leading-6 and text-slate-300.
- normalize.js must preserve the structured summary contract:
  summary_lead plus summary_points.

Diagnosis requirements:

1. Determine whether Windows is loading an older ArticleModal JavaScript
   bundle that still renders master_summary/summary as one paragraph.
2. Determine whether the current li elements exist in the DOM but their
   generated Tailwind styles are absent.
3. Compare the page being served on port 5173 with the page served on port
   8000.
4. Confirm that theme-toggle.css is actually imported after index.css.
5. Inspect computed styles for one summary-point li:
   display, border-width, border-color, border-radius, background-color,
   padding and margin.

Required fix:

- Give the summary list and each summary point stable semantic class names,
  for example dossier-summary-list, dossier-summary-point and
  dossier-summary-marker.
- Define their complete appearance explicitly in theme-toggle.css using the
  existing theme variables.
- Do not depend exclusively on generated Tailwind arbitrary-value classes for
  this important visual structure.
- Keep summary_lead and summary_points behavior unchanged.
- Add explicit light-theme styling if required for visible contrast.
- Do not convert the points back into one paragraph.

ISSUE 2 — Homepage sections overlap on Windows

Expected vertical order:

1. Top row:
   - Top Cluster carousel
   - Technology Signal Pulse
   - Briefing Archive/Stream
2. A clearly visible vertical gap.
3. Latest Day Signals, with all five cards contained inside its panel.
4. Another clearly visible vertical gap.
5. Search Loaded Briefing and its filters.

Nothing may overlap. Latest Day cards must remain inside the Latest Day
Signals panel and must not touch the filter panel.

Broken Windows behavior:

- Latest Day Signals moves upward and overlaps the top-row panels.
- Some Latest Day cards extend beyond their containing panel.
- The cards approach or touch Search Loaded Briefing.
- The failure becomes more noticeable with Windows display scaling or a
  shorter effective browser viewport.

Known CSS conflict to investigate:

- index.css contains viewport-fitting homepage rules similar to:

  .briefing-stage {
    height: clamp(610px, calc(100svh - 136px), 968px);
    grid-template-rows: minmax(0, 64fr) minmax(0, 36fr);
  }

- theme-toggle.css gives .hero-cluster-panel a min-height around 390px.
- At a short effective viewport, the computed top grid row can be smaller than
  the hero panel's minimum height.
- The child then overflows its assigned row and collides with the next row.
- Multiple historical definitions of briefing-stage, cockpit-top-card and
  latest-day-stage exist, so inspect the final cascade and computed styles,
  not just the first matching declaration.

Required fix:

- Make the homepage composition content-driven rather than forcing both rows
  into a viewport-derived fixed height.
- The final winning desktop rules should use an automatic stage height and
  automatic rows, conceptually:

  .briefing-stage {
    height: auto;
    min-height: 0;
    grid-template-rows: auto auto;
    gap: ...;
  }

- Ensure .briefing-top-row can grow with its tallest child.
- Ensure cockpit-top-card, hero-cluster-panel, market-panel and
  briefing-stream-panel do not overflow a fixed parent row.
- Keep Latest Day Signals in normal document flow.
- Give Latest Day Signals and Search Loaded Briefing explicit reliable spacing.
- Ensure .latest-day-grid and .latest-signal-card remain contained:
  min-width: 0, max-width: 100%, and appropriate overflow behavior.
- Preserve the intended three-column desktop top row and existing responsive
  one-column behavior on smaller screens.
- Do not solve the problem with arbitrary negative margins, transforms,
  absolute positioning, or clipping content.

Validation:

1. Test dark and light themes.
2. Test default and broadcast profiles.
3. Test at 1366x768, 1536x864 and 1920x1080.
4. Test browser zoom at 100%, 125% and 150%.
5. Open a dossier and confirm every summary point has its own visible
   container.
6. Confirm top row, Latest Day Signals and Search Loaded Briefing have visible
   gaps and zero overlap.
7. Confirm all five latest cards stay inside the Latest Day Signals panel.
8. Run:
   npm test
   npm run build
9. Report:
   - exact root cause of each issue,
   - whether the tested page was Vite port 5173 or backend port 8000,
   - files changed,
   - selectors changed,
   - viewport/zoom combinations tested,
   - test and build results.

Be conservative. Fix only these two presentation defects, preserve all
features, and do not modify backend files.
```

### Important interpretation

Running `npm run dev` does not guarantee that the browser is displaying Vite.
The browser must be opened on port `5173`. Opening port `8000` still displays
the compiled directory configured by `NEWSSCRAPPER_FRONTEND_DIST`.

After Claude Code applies the fix, test the Vite version first:

```powershell
cd C:\path\to\your\repository\news-ui
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Only after that version is correct should the production bundle be rebuilt:

```powershell
npm test
npm run build
```
