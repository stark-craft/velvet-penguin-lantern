# newsScrapper — simple Windows setup

You do **not** need to type PowerShell `$env:` commands every time. The backend
loads one local `.env` file automatically.

## 1. Put the project on the server PC

Clone or unzip the project. In this guide the folder is:

```text
C:\newsScrapper
```

Open PowerShell and go there:

```powershell
cd C:\newsScrapper
```

## 2. Create Python and install the backend

Install 64-bit Python 3.12 first. Then run:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Activation is optional. The commands in this guide call the virtual environment
directly, so PowerShell execution-policy errors do not matter.

## 3. Put the local AI models in these exact folders

```text
C:\newsScrapper\local_miniLM_model
C:\newsScrapper\local_bart_model
C:\newsScrapper\flan-t5-local
```

Each folder must contain the Hugging Face model files themselves, including its
`config.json`; do not put the model inside a second same-named subfolder.

The MiniLM folder powers clustering and both bouncers. BART powers final local
summaries. FLAN-T5 powers the optional “why it matters” opinion helper.

## 4. Create the one configuration file

```powershell
Copy-Item .env.example .env
notepad .env
```

Change these first:

```dotenv
NEWSSCRAPPER_ENV=production
DIRECTOR_KEY=choose-a-long-approval-key
ANALYTICS_KEY=choose-a-long-analytics-key
GATEKEEPER_KEY=choose-a-long-gatekeeper-key
NEWSSCRAPPER_IP_HASH_SECRET=choose-a-long-random-secret
```

The old four-digit `1357` values are development defaults only. Production mode
refuses short keys.

### Broadcast profile IPs

Edit this comma-separated line in `.env`:

```dotenv
BROADCAST_SPECIAL_IPS=107.109.202.212,107.109.202.33,109.109.201.228
```

`109.109.201.228` is already included. A user on one of these addresses is
assigned the Broadcast profile automatically. Other users receive Default.

If Nginx, IIS, or another reverse proxy sits in front of the backend, add only
that proxy server to `TRUSTED_PROXY_IPS`. Otherwise leave the localhost default.
Untrusted browsers cannot fake `X-Forwarded-For` or switch profiles by header.

### Private pages

Edit the allowed-IP lists as required:

```dotenv
ANALYTICS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
GATEKEEPER_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
PROFILE_SETTINGS_ALLOWED_IPS=127.0.0.1,::1,107.109.201.245
```

The Gatekeeper password is `GATEKEEPER_KEY`. Article approval uses
`DIRECTOR_KEY`. Analytics uses `ANALYTICS_KEY`.

### Samsung Web Search and Chat

Paste the existing internal values into these `.env` entries:

```dotenv
SAMSUNG_WEB_SEARCH_CLIENT=
SAMSUNG_WEB_SEARCH_TOKEN=
SAMSUNG_CHAT_CLIENT=
SAMSUNG_CHAT_TOKEN=
SAMSUNG_CHAT_MODEL_ID=
```

Then enable the stages:

```dotenv
WEB_SEARCH_ENRICHMENT_ENABLED=true
FINAL_CHAT_SUMMARY_ENABLED=true
```

TLS verification must remain enabled. For a company certificate, set:

```dotenv
REQUESTS_CA_BUNDLE=C:\path\to\company-ca-bundle.pem
```

Windows system certificates are enabled by `NEWSSCRAPPER_USE_SYSTEM_CA=true`.
Do not disable SSL verification.

## 5. Install and build the frontend

Install Node.js 20 LTS. Then run:

```powershell
cd C:\newsScrapper\news-ui
npm install
npm run build
cd ..
```

The backend serves `news-ui\dist`, so production needs only one running command.

## 6. Start the complete application

```powershell
cd C:\newsScrapper
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open this on the server PC:

```text
http://127.0.0.1:8000
```

Open this from another company PC, replacing the address with the server PC IP:

```text
http://SERVER-PC-IP:8000
```

The terminal shows the complete scheduler pipeline: profile, source discovery,
RSS/website method, article extraction, bouncer decisions, clustering, summary,
and archive path.

## 7. Development frontend only

Use this only when editing React:

```powershell
cd C:\newsScrapper\news-ui
npm run dev -- --host 0.0.0.0
```

Keep the backend running on port 8000 in another PowerShell window. Normal
production use does not need `npm run dev`.

## 8. Files you will edit later

- Default sources: `sites.json`
- Broadcast sources: `sites_broadcast.json`
- Default keywords: `MORNING_KEYWORDS` near the top of `main.py`
- Broadcast keywords: `BROADCAST_MORNING_KEYWORDS` near the top of `main.py`
- All IPs, keys, scheduler controls, TLS, and internal API settings: `.env`

History is stored under `intelligence_store\PROFILE\history` and is retained for
30 days by default. Workflow decisions are stored separately and are not erased
when an old briefing file expires.
