# newsScrapper: simple Windows guide

This is the shortest complete path for installing newsScrapper on Windows 11.
Run every command in **PowerShell** and follow the steps in order.

The examples install the project in `C:\scrappyV2`.

## 1. Install the three required programs

Install:

- Git for Windows
- 64-bit Python 3.11
- Node.js 22

Check them in PowerShell:

```powershell
git --version
py -3.11 --version
node --version
npm --version
```

Do not continue if one of these commands says it is not recognized.

## 2. Clone the project

```powershell
git clone https://github.com/stark-craft/velvet-penguin-lantern.git C:\scrappyV2
cd C:\scrappyV2
```

If you already cloned it, use this instead:

```powershell
cd C:\scrappyV2
git pull
```

## 3. Install the backend

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create the virtual environment on this Windows computer. Do not copy `.venv`
from another computer.

## 4. Install the frontend

```powershell
npm ci
```

## 5. Create your private settings file

```powershell
Copy-Item .\scripts\windows\local-settings.ps1.example .\scripts\windows\local-settings.ps1
notepad .\scripts\windows\local-settings.ps1
```

Edit only the copied `local-settings.ps1`. Git ignores this file, so its IP
addresses, PINs, and secrets will not be uploaded.

These are the important settings:

```powershell
$env:SIGNALROOM_IP_HASH_SECRET = "replace-this-with-at-least-32-random-characters"
$env:SIGNALROOM_APPROVAL_KEY = "2741"
$env:SIGNALROOM_GATEKEEPER_KEY = "6384"
$env:SIGNALROOM_BROADCAST_IPS = ""
$env:SIGNALROOM_ADMIN_IPS = ""
$env:SIGNALROOM_DEVELOPER_IPS = "127.0.0.1,::1"
```

- Replace the IP hash secret once, then keep the same value.
- Add Broadcast-user IPs to `SIGNALROOM_BROADCAST_IPS`.
- Add Analytics/admin IPs to `SIGNALROOM_ADMIN_IPS`.
- Add developer IPs to `SIGNALROOM_DEVELOPER_IPS`.
- Separate multiple IPs with commas.

Example:

```powershell
$env:SIGNALROOM_BROADCAST_IPS = "192.168.1.25,192.168.1.26"
$env:SIGNALROOM_ADMIN_IPS = "192.168.1.10"
$env:SIGNALROOM_DEVELOPER_IPS = "127.0.0.1,::1,192.168.1.10"
```

### The two security PINs

| PIN | Default | Used for |
| --- | --- | --- |
| Approval PIN | `2741` | Moving an article into Approved |
| Gatekeeper PIN | `6384` | Opening Gatekeeper and Dropped Articles |

Change both values in `scripts\windows\local-settings.ps1` before sharing the
application widely. Restart newsScrapper after changing them.

The PINs do not grant Analytics or administrator permission. The backend still
checks the user's configured IP permissions.

## 6. Check the AI models

The two model folders must be here:

```text
C:\scrappyV2\backend\model_weights\all-MiniLM-L6-v2
C:\scrappyV2\backend\model_weights\distilbart-cnn-12-6
```

If you already copied the models, check them:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --verify-only
```

If they are missing, download them with secure Windows certificate support:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --use-system-ca
```

Do not disable SSL verification. If your company uses a private certificate,
ask IT for its PEM file and run:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --ca-bundle "C:\Certificates\company-root-ca.pem"
```

## 7. Check the source configuration

```powershell
.\.venv\Scripts\python.exe backend\main.py preflight --profile all
```

This confirms that both RSS feeds and normal website URLs can create crawler
requests. It does not crawl the internet.

## 8. Start newsScrapper

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\start-dev.ps1
```

This single command loads your settings and starts both the backend and the
frontend. Keep the PowerShell window open.

Open:

```text
http://localhost:3000
```

Press **Ctrl+C** to stop both services.

## 9. Test the crawler

Keep newsScrapper running. Open a second PowerShell window and run a small test:

```powershell
cd C:\scrappyV2
. .\scripts\windows\local-settings.ps1
.\scripts\windows\run-profile.ps1 -Profile default -Source techcrunch
```

If it succeeds, run both profiles for today:

```powershell
$today = Get-Date -Format "yyyy-MM-dd"
.\.venv\Scripts\python.exe backend\main.py run --profile all --trigger scheduler --from-date $today --to-date $today --requested-by local-validation
```

The backend terminal shows crawling, filtering, clustering, summarization, and
briefing progress. Default runs first, then Broadcast.

## 10. Enable the four-hour scheduler

After the crawler test succeeds, stop the original app with **Ctrl+C** and
restart it with:

```powershell
.\scripts\windows\start-dev.ps1 -StartScheduler
```

The scheduler now runs every four hours.

## Normal daily start

After the first installation, this is all you normally need:

```powershell
cd C:\scrappyV2
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\start-dev.ps1 -StartScheduler
```

## Files you may want to edit

| What to change | File |
| --- | --- |
| PINs, secrets, and permitted IPs | `scripts\windows\local-settings.ps1` |
| Default keywords | `backend\profiles\default.json` |
| Broadcast keywords | `backend\profiles\broadcast.json` |
| Default sources | `backend\sites\sites.json` |
| Broadcast sources | `backend\sites\broadcast_sites.json` |

Run the preflight command again after editing sources. The Default source file
can contain RSS feeds and the Broadcast source file can contain ordinary web
pages; the crawler supports both.

## PowerPoint template

Put your legacy template here:

```text
C:\scrappyV2\template.pptx
```

PPTX export uses it automatically. If it is missing, newsScrapper uses its
built-in presentation design.

## What the article states mean

- **Selected** is the current user's private export tray.
- **Saved** is the current user's private read-later list.
- **Under Review** is the shared editorial review queue.
- **Approved** is the shared approved queue and requires the Approval PIN.
- **Gatekeeper** shows rejected articles and requires the Gatekeeper PIN.

The first-time name prompt creates a unique display name. The backend stores a
hash of the user's IP, while the account dialog can show that user their current
raw IP. Analytics is limited to configured administrator/developer IPs. Every
user can submit VOC feedback without Analytics access.

## Updating later

Stop newsScrapper, then run:

```powershell
cd C:\scrappyV2
git pull
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
```

Your local settings, models, runtime JSON data, and learned Gatekeeper files are
not replaced by `git pull`.

## If something fails

Run the automatic check:

```powershell
.\scripts\windows\doctor.ps1
```

Useful individual checks:

```powershell
# Check sources
.\.venv\Scripts\python.exe backend\main.py preflight --profile all

# Start only the backend and show its error
.\.venv\Scripts\python.exe backend\main.py api --host 127.0.0.1 --port 8000

# Start only the frontend and show its error
npm run dev

# Check models
.\scripts\windows\verify-models.ps1
```

The application data is in `backend\runtime\data`. Back up that folder before
moving or updating the server laptop.

For the later portable laptop package, read `deployment\README_WINDOWS.md`.
It is not required for the normal setup above.
