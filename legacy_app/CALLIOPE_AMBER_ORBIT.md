# Calliope Amber Orbit

This is the complete Windows guide for running Sense.AI/newsScrapper from an
`App_Portable` folder. It assumes the reader can open File Explorer and
PowerShell but does not assume programming experience.

## 1. What the finished server folder must look like

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
│   │   └── broadcast_sites.json
│   ├── crawler
│   └── runtime                 (created/updated by the application)
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

## 2. Make a safety copy before an update

1. Stop the black server window with `Ctrl+C`.
2. Open File Explorer.
3. Open `C:\App_Portable`.
4. Copy these items to a safe backup folder:
   - `.env`
   - `news_scrapper\runtime`
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

### Broadcast-profile routing

Put real client IP addresses after `BROADCAST_SPECIAL_IPS=`, separated by
commas:

```env
BROADCAST_SPECIAL_IPS=109.109.201.228,109.109.201.229
```

Restart the backend after changing `.env`; environment settings are read at
process start. The user then refreshes the browser.

If a reverse proxy is used, put only that proxy's IP in `TRUSTED_PROXY_IPS`.
Never trust every address. Without a proxy, leave loopback values only.

## 6. Install the four local AI models

The application uses:

| Folder | Hugging Face model | Purpose |
|---|---|---|
| `all-MiniLM-L6-v2` | `sentence-transformers/all-MiniLM-L6-v2` | semantic clustering |
| `distilbart-cnn-12-6` | `sshleifer/distilbart-cnn-12-6` | summary fallback |
| `flan-t5-local` | `google/flan-t5-small` | Why This Matters/intent fallback |
| `distilbert-sst-2` | `distilbert/distilbert-base-uncased-finetuned-sst-2-english` | sentiment |

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
```

Copy all four completed folders to
`C:\App_Portable\model_weights`. Do not copy partially downloaded folders.
Models are deliberately excluded from GitHub.

With Samsung Chat healthy, Chat is the primary source for the concise lead,
key points, intent, category, region, importance, and Why This Matters. If Chat
fails preflight or an article call fails, BART/FLAN-T5 provide the local
fallback. MiniLM remains the semantic clustering engine.

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
2. Runtime folders and profile-specific history folders are created.
3. Existing legacy JSON state is copied into the new runtime location only
   when the destination does not already exist.
4. Scheduler calculates the next due time from the newest default and broadcast
   briefing. Missing/stale data triggers a run shortly after startup.
5. Samsung Web Search and Chat are tested before crawling.
6. Scrapy reads the profile's own sites and keywords:
   - default: `news_scrapper\config\sites.json`
   - broadcast: `news_scrapper\config\broadcast_sites.json`
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
13. The final JSON is written atomically into the correct profile history.
14. `/latest-briefing` chooses profile by verified client IP, applies that
    viewer's private hidden list, and returns the feed.
15. The frontend requests `/profile` and `/latest-briefing` from the same
    backend origin and renders the response.

The default profile runs first, then broadcast. A failed profile is retained in
status and retried. A scheduled tick that occurs during a long/manual run is
queued instead of silently discarded.

## 10. Verify the deployment

In PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/status | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:8000/profile | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:8000/latest-briefing | ConvertTo-Json -Depth 10
```

Check:

- `/status` reports the scheduler and next run.
- `/profile` reports the expected default or broadcast profile.
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
