# Copy, paste, and run newsScrapper

This is the short guide for the **active legacy-compatible application**. Its
code is inside `legacy_app`. The older root frontend/backend remains in the
repository for reference, but the commands below run the version that was
tested and fixed on the MacBook.

## What was fixed

- Restored the legacy FastAPI + Scrapy + Vite/React structure.
- Added reliable RSS, Atom, JSON-LD, and ordinary website discovery.
- Added article/date validation, section boundaries, and cleaner headline extraction.
- Fixed Default/Broadcast profile routing, including `109.109.201.228`.
- Prevented a stale browser profile from overriding the IP-assigned profile.
- Preserved client IPs through the Vite proxy while trusting only configured proxies.
- Added separate Default and Broadcast bouncer models and training stores.
- Added semantic clustering with a unique-publisher safeguard.
- Added the Gatekeeper review queue, restoration worker, access key, and retries.
- Restored Samsung Web Search, Samsung Chat, and image metadata adapter contracts.
- Kept TLS verification enabled and added Windows/custom-CA support.
- Added hashed-IP analytics, viewer names, VOC, 30-day history retention, and exports.
- Added a persistent Light/Dark theme button in the top navigation.
- Added backend tests and crawler fixtures.

## Windows: first installation

Install these first:

1. Git
2. 64-bit Python 3.12
3. Node.js 20 LTS

Open **PowerShell** and paste:

```powershell
git clone https://github.com/stark-craft/velvet-penguin-lantern.git C:\newsScrapper
cd C:\newsScrapper\legacy_app

py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Copy-Item .env.example .env
notepad .env
```

In Notepad, change at least these values and save the file:

```dotenv
NEWSSCRAPPER_ENV=production
DIRECTOR_KEY=replace-with-a-long-approval-password
ANALYTICS_KEY=replace-with-a-long-analytics-password
GATEKEEPER_KEY=replace-with-a-long-gatekeeper-password
NEWSSCRAPPER_IP_HASH_SECRET=replace-with-a-long-random-private-value
```

Do not use `1357` in production. Production mode rejects short keys.

## Put the AI models here

Copy the downloaded Hugging Face model files into:

```text
C:\newsScrapper\legacy_app\local_miniLM_model
C:\newsScrapper\legacy_app\local_bart_model
C:\newsScrapper\legacy_app\flan-t5-local
```

`local_miniLM_model` is required for semantic clustering. BART and FLAN-T5 are
optional until their features are needed. Each folder must directly contain
its own `config.json`; do not create another same-named folder inside it.

## Build the frontend

Paste in PowerShell:

```powershell
cd C:\newsScrapper\legacy_app\news-ui
npm install
npm run build
cd ..
```

## Start the complete application

Paste:

```powershell
cd C:\newsScrapper\legacy_app
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

On the server PC, open:

```text
http://127.0.0.1:8000
```

On another company PC, open the server laptop's real address:

```text
http://SERVER-PC-IP:8000
```

That is the production-style setup. The built frontend is served by FastAPI,
so only the one Uvicorn command needs to remain running.

## Development mode with two terminals

Backend terminal:

```powershell
cd C:\newsScrapper\legacy_app
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend terminal:

```powershell
cd C:\newsScrapper\legacy_app\news-ui
npm run dev -- --host 0.0.0.0
```

Then open `http://127.0.0.1:5173`.

## Broadcast IPs and private access

Edit `C:\newsScrapper\legacy_app\.env`.

Broadcast users:

```dotenv
BROADCAST_SPECIAL_IPS=107.109.202.212,107.109.202.33,109.109.201.228
```

Private pages:

```dotenv
ANALYTICS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
GATEKEEPER_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
PROFILE_SETTINGS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
SYSTEM_STATUS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
```

If IIS, Nginx, or another reverse proxy is used, add only the proxy server IP
to `TRUSTED_PROXY_IPS`. Do not add ordinary user PCs there.

## Internal Samsung services

Paste the real company values only into `.env`:

```dotenv
SAMSUNG_WEB_SEARCH_CLIENT=
SAMSUNG_WEB_SEARCH_TOKEN=
SAMSUNG_CHAT_CLIENT=
SAMSUNG_CHAT_TOKEN=
SAMSUNG_CHAT_MODEL_ID=
WEB_SEARCH_ENRICHMENT_ENABLED=true
FINAL_CHAT_SUMMARY_ENABLED=true
```

For a company certificate bundle:

```dotenv
REQUESTS_CA_BUNDLE=C:\path\to\company-ca-bundle.pem
```

Never disable SSL verification.

## Change sources and keywords

- Default sources: `legacy_app\sites.json`
- Broadcast sources: `legacy_app\sites_broadcast.json`
- Default keywords: `MORNING_KEYWORDS` near the top of `legacy_app\main.py`
- Broadcast keywords: `BROADCAST_MORNING_KEYWORDS` near the top of `legacy_app\main.py`

## Run the checks yourself

Backend tests:

```powershell
cd C:\newsScrapper\legacy_app
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Frontend build:

```powershell
cd C:\newsScrapper\legacy_app\news-ui
npm run build
```

Backend status after starting it:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/status
```

## Light and dark themes

Use the **Light theme / Dark theme** button beside Settings in the top-right
navigation. The choice is stored in the browser, so refreshing or returning
later keeps the selected theme. It does not change another user's preference.

## Not stored in GitHub

For security and privacy, GitHub does not contain:

- `.env` or company tokens
- Hugging Face model weights
- generated briefings
- viewer names and analytics
- VOC submissions and workflow decisions
- temporary crawler output

These files are created or supplied locally on the server machine.
