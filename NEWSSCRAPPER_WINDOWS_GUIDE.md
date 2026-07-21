# newsScrapper Windows setup, architecture, and remediation guide

This is the authoritative handoff for the current repository and the internal
Windows deployment at `C:\scrappyV2`. Commands below are PowerShell commands and
must be entered **one line at a time**.

If you have never run a Python/JavaScript project before, do not skip steps and
do not paste the words `PS C:\...>` from a screenshot. Paste only the command
inside each code block. Keep the backend and frontend terminals open while you
use the app; closing either terminal stops that part of the application.

## 1. Reproducible toolchain

Use 64-bit CPython **3.11.9** and Node.js **22.22.2** for the reproducible pilot
build. The package metadata remains compatible with Python 3.9+ and Node
22.13+, but the two exact versions above are the deployment reference. Do not
copy a macOS/Linux virtual environment to Windows.

Vinext and Vite are real development tools. Output such as `vinext dev` and
`Vite 8.0.13` is framework output, not old product branding.

Baseline audit:

```powershell
cd C:\scrappyV2
git status
git branch --show-current
git log -1 --oneline
node --version
npm --version
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip --version
.\.venv\Scripts\python.exe -m scrapy version
.\.venv\Scripts\python.exe -c "import scrapy, torch, transformers, sentence_transformers, huggingface_hub; print('Scrapy:', scrapy.__version__); print('Torch:', torch.__version__); print('Transformers:', transformers.__version__); print('SentenceTransformers:', sentence_transformers.__version__); print('HuggingFace Hub:', huggingface_hub.__version__)"
```

The read-only wrapper performs the same practical checks plus JSON, ports,
models, and backend health:

```powershell
.\scripts\windows\doctor.ps1
```

## 2. Important configuration locations

| Change | File or setting |
| --- | --- |
| Default keywords | `backend\profiles\default.json`, `keywords` |
| Broadcast keywords | `backend\profiles\broadcast.json`, `keywords` |
| Default sources | `backend\sites\sites.json` |
| Broadcast sources | `backend\sites\broadcast_sites.json` |
| Broadcast IP/CIDR allowlist | `SIGNALROOM_BROADCAST_IPS` |
| Developer IP/CIDR allowlist | `SIGNALROOM_DEVELOPER_IPS` |
| Administrator IP/CIDR allowlist | `SIGNALROOM_ADMIN_IPS` |
| MiniLM files | `backend\model_weights\all-MiniLM-L6-v2` |
| DistilBART files | `backend\model_weights\distilbart-cnn-12-6` |
| Durable JSON | `backend\runtime\data` |
| Gatekeeper artifacts | `backend\models\default` and `backend\models\broadcast` |
| Optional legacy PowerPoint template | `template.pptx` in `C:\scrappyV2` |
| Approval PIN | `SIGNALROOM_APPROVAL_KEY` (pilot default `2741`) |
| Gatekeeper PIN | `SIGNALROOM_GATEKEEPER_KEY` (pilot default `6384`) |

Never hard-code real company IPs or certificates in this public repository.
Copy `deployment\signalroom.env.cmd.example` to an ignored
`signalroom.env.cmd`, then enter comma-separated IP addresses or CIDR networks.
An unknown but reachable IP opens the Default profile. A Broadcast allowlisted
IP opens Broadcast. Developer/admin capabilities control profile switching and
restricted screens.

Profile and source JSON is reloaded at the beginning of each pipeline run.
Editing it does not require a frontend rebuild. Preserve the existing source
files during upgrades. The current Default file contains 107 records; a
populated file can still produce zero requests when the spider startup API is
incompatible.

## 3. Clean install from Git

```powershell
git clone https://github.com/stark-craft/velvet-penguin-lantern.git C:\scrappyV2
cd C:\scrappyV2
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci
```

Use lowercase `npm run dev`. `NPM RUN DEV` is not a valid npm command. Keep each
PowerShell assignment and command on its own line; do not paste the prompt text
after an environment-variable assignment.

## 4. Secure AI model installation

The two identities are fixed:

| Purpose | Repository | Pinned revision | Weight SHA-256 |
| --- | --- | --- | --- |
| Embedding/clustering | `sentence-transformers/all-MiniLM-L6-v2` | `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` | `53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db` |
| Summarization | `sshleifer/distilbart-cnn-12-6` | `eb8b5a5eb7de268c0d7db6fa247188c909acf265` | `bb2e2ae9c5e339a6e86adac3c946bb853db50d7c588477ddd1622dd2d1fc567c` |

Normal download:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py
```

If the organization performs HTTPS inspection, obtain the approved root CA
from IT/security and export it as PEM. Then use:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --ca-bundle "C:\Certificates\company-root-ca.pem"
```

Or request the Windows trust store explicitly:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --use-system-ca
```

The downloader also respects `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and
`CURL_CA_BUNDLE`. It selects Hugging Face Hub's supported `httpx` or `requests`
client-factory API at runtime and always verifies TLS.

Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False`,
`HF_HUB_DISABLE_SSL_VERIFY`, or an equivalent bypass. Never install a random
certificate from the internet. Proxy credentials and certificate files must
not be committed.

### Manual copy fallback

If an approved browser or separate trusted machine must download the models,
select the exact revisions above and copy only the required repository files
into the two destination folders. Do not copy `.bin` pickle weights or HTML
error pages. Validate without network access:

```powershell
.\.venv\Scripts\python.exe backend\scripts\download_models.py --verify-only
```

or:

```powershell
.\scripts\windows\verify-models.ps1
```

The verifier checks every required file, folder structure, suspicious HTML,
and both pinned `model.safetensors` hashes. Missing/incorrect files produce a
nonzero exit code.

After verification:

```powershell
$env:SIGNALROOM_HF_LOCAL_ONLY="true"
$env:SIGNALROOM_EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2"
$env:SIGNALROOM_SUMMARIZATION_MODEL="sshleifer/distilbart-cnn-12-6"
$env:SIGNALROOM_EMBEDDING_MODEL_PATH="model_weights/all-MiniLM-L6-v2"
$env:SIGNALROOM_SUMMARIZATION_MODEL_PATH="model_weights/distilbart-cnn-12-6"
.\.venv\Scripts\python.exe backend\main.py warm-models --strict
```

Success requires `ready=true`, `local_files_only=true`, and `degraded=false`
for both models.

## 5. Source preflight and Scrapy compatibility

Run this before any network crawl:

```powershell
.\.venv\Scripts\python.exe backend\main.py preflight --profile default --source techcrunch
```

The command makes no network requests. It reports total/configured/enabled
records, usable entrypoints, selected/rejected source IDs, loaded profile and
source paths, generated request count, and a bounded URL sample.

The spider uses one guarded `_iter_initial_requests()` generator. Modern Scrapy
calls `async start()`; older supported Scrapy calls `start_requests()`. Both
delegate to the same generator, preserving callbacks, errbacks, metadata,
priorities, allowed domains, fallback URLs, counters, and `_sources_attempted`.
The guard prevents the source-selection logic from running twice in one crawl.

If a crawl says no entrypoints were attempted, read the diagnostic counts:

```text
configured=107 enabled=79 usable_entrypoints=1 initial_requests=0 attempted=0
profile=default source_file=...\sites.json
```

`configured=107` proves the JSON is not empty. `initial_requests=0` points to
startup/selection behavior. An unmatched `--source` appears separately. A site
connection or parsing failure after `initial_requests>0` is a different issue.

### RSS and ordinary website URLs

The two source files are intentionally different. `sites.json` mostly contains
RSS/Atom URLs; `broadcast_sites.json` mostly contains ordinary website/listing
URLs. The same spider supports both. For a feed it reads entries and follows
matching article links. For a normal website it scans the listing, applies the
allowed-domain and link limits, then opens candidate article pages. Date and
profile keyword checks are applied before an item reaches the pipeline.

## 6. Manual startup order

Do not start the recurring scheduler until the manual profile run succeeds.

Terminal 1 — API:

```powershell
.\.venv\Scripts\python.exe backend\main.py api --host 127.0.0.1 --port 8000
```

Terminal 2 — frontend:

```powershell
npm run dev
```

Those two commands are enough for an ordinary local start. You do **not** have
to type `$env:...` lines every time. The repository has safe development
defaults. Environment variables are needed only when changing a deployment
value—for example company IP allowlists, model folders, or secret keys. The
portable launcher reads persistent values from the ignored deployment
environment file so they do not have to be retyped.

The frontend uses its same-origin API bridge by default. Set
`NEXT_PUBLIC_SIGNALROOM_DIRECT_API_PORT=8000` only when deliberately bypassing
that bridge during troubleshooting.

In development, the backend trusts forwarding only from loopback (plus the
adapter's anonymous peer used by local Vinext) so the bridge preserves the
requesting workstation address. Production keeps proxy trust locked down and
requires `SIGNALROOM_TRUST_PROXY_IP_HEADERS=true`, a company-controlled proxy,
and `SIGNALROOM_PROXY_SHARED_SECRET` before forwarded identities are accepted.

Verify the API:

```powershell
curl.exe -f http://127.0.0.1:8000/api/v1/health
```

Open `http://localhost:3000/`. The visible product name must be
`newsScrapper`. The internal `/api/signalroom` bridge name and
`SIGNALROOM_*` variables remain compatible.

The safe combined development launcher is:

```powershell
.\scripts\windows\start-dev.ps1
```

For an approved Windows system trust store:

```powershell
.\scripts\windows\start-dev.ps1 -UseSystemCA
```

It prints frontend/backend URLs, Node version, system-CA state, local
`Request.cf` behavior, backend health, and owned process IDs. It starts no crawl
and no scheduler by default, and stops only the processes it created.

## 7. Frontend certificate and Request.cf warning

First determine whether `npm run dev` exits. If it prints a local URL and keeps
running, and `curl.exe -I http://localhost:3000/` returns 200, the server is
alive. A message about being unable to fetch `Request.cf` may be limited to
Cloudflare/Miniflare metadata and can fall back to placeholder values.

The application does not read `Request.cf`. The installed Cloudflare Vite
plugin's public configuration schema does not expose a supported `cfFetch`
switch, so the repository does not inject an undocumented option. Production
behavior is unchanged.

Node 22.15+ can use the Windows trust store. The launcher enables
`NODE_USE_SYSTEM_CA=1` only when `-UseSystemCA` is requested and the installed
Node version supports it. It never sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

If TLS warnings remain, check corporate proxy, VPN, antivirus HTTPS inspection,
and the IT-managed Windows root store. Do not hide unrelated TLS failures.

## 8. Manual profile validation and scheduler

After preflight, models, API, and frontend are valid, run one source:

```powershell
.\scripts\windows\run-profile.ps1 -Profile default -Source techcrunch
```

The wrapper validates parameters and prints the exact Python command. Success
must prove that at least one initial request was generated and attempted. A
publisher-specific HTTP/parsing error is not the old zero-entrypoint failure.

Only after a manual profile run succeeds may the scheduler be started:

```powershell
.\.venv\Scripts\python.exe backend\main.py scheduler
```

It runs Default then Broadcast every four hours and uses process locking to
avoid duplicate scheduler instances.

For a one-day test that follows the same Default-then-Broadcast order and labels
the jobs as scheduler jobs:

```powershell
$today = Get-Date -Format "yyyy-MM-dd"
.\.venv\Scripts\python.exe backend\main.py run --profile all --trigger scheduler --from-date $today --to-date $today --requested-by local-validation
```

The terminal prints source loading, crawler progress, extracted item counts,
normalization, MiniLM loading, cluster counts, Gatekeeper/summarizer stages,
briefing counts, and source failures. A few publisher failures do not fail the
whole profile; an all-source failure does.

## 9. Architecture and data flow

```text
profile JSON + source JSON
        |
        v
source preflight -> Scrapy RSS/listing/article requests
        |
        v
normalization + canonical deduplication
        |
        v
MiniLM embeddings -> cosine graph -> semantic story clusters
        |
        v
DistilBART cluster summary + intent/category/region enrichment
        |
        v
profile Gatekeeper -> keep / review / drop decision with audit evidence
        |
        v
atomic JSON repository -> briefing/history/worklists/VOC/telemetry
        |
        v
FastAPI /api/v1 -> frontend client -> feed, dossier, actions, exports, analytics
```

Key components:

- `backend\main.py`: API, source preflight, manual run, scheduler, model warmup,
  and Gatekeeper training commands.
- `backend\signalroom\crawlers`: source-safe requests, feed/listing extraction,
  article parsing, redirect/domain policy, and source health.
- `backend\signalroom\ml`: embeddings, clustering, summarization, and
  Gatekeeper model loading/training.
- `backend\signalroom\services\pipeline.py`: coordinates the crawl-to-briefing
  flow and persists job events.
- `backend\signalroom\json_storage.py`: atomic state, backup, locking, and
  retention.
- `app`, `components`, `lib`: frontend shell, briefing, dossiers, worklists,
  search, actions, exports, feedback, analytics, and API mapping.

Ordinary briefing/article history is retained for 30 days. Saved,
under-review, and approved articles are protected beyond 30 days. Preserve
`backend\runtime\data` during every upgrade.

### Identity and analytics

The server resolves the current network address, creates a stable HMAC-SHA256
pseudonym with `SIGNALROOM_IP_HASH_SECRET`, and stores only that pseudonym with
events and actions. `/api/v1/me` returns the raw current address only to the
requesting user; it is never written to JSON. Display names are unique without
regard to case. Analytics joins the current display name to the stable actor at
read time, so renaming a user immediately relabels their historical activity.

On a truly new hashed identity, the app opens the “What should newsScrapper call
you?” dialog automatically. It is mandatory once and does not ask again after
the name is saved. Names are unique without regard to upper/lower case. Email
is optional. The raw current IP is shown only in that user’s own account dialog;
it is never stored in JSON or shown as a raw analytics identifier.

To add six fake people and activity rows for Analytics testing:

```powershell
.\.venv\Scripts\python.exe backend\main.py seed-demo-analytics
```

It is safe to run again: existing demo people/events are not duplicated.
Analytics → People lists all users. Select a person, then open Activity to see
that person’s paths, time, event types, and actions.

### What Selected, Saved, Under Review, and Approved mean

- **Selected** is the current user’s private export tray. Other users cannot see
  it. It survives refresh because the hashed actor ID is stored with the action.
- **Saved** is the current user’s private “read later” shelf. Other users cannot
  see it. Saved articles are protected from normal 30-day cleanup.
- **Under Review** is the shared senior-review queue. Everyone can see submitted
  items, but only the submitting user or an administrator can withdraw one.
- **Approved** is the shared final list. Approval requires the approval PIN and
  the backend approval capability.
- **New** in Workflow is the return destination. Moving an owner-controlled item
  back to New removes its workflow state; the fresh feed remains in Discover.

Briefing shows at most five top signals, ranked primarily by corroborating
source count and then relevance/confidence. Discover shows the full retained
current feed. Selecting an article does not submit it for approval; use
**Review/Under Review** for that.

### Voice of Customer (VOC)

Every normal user can submit VOC through **Share VOC** in the navigation or the
persistent **Share feedback** button. Analytics access is not required. Only
analytics-authorized users see the collected inbox. The form supports rating,
category, message, optional diagnostic context, and optional follow-up email.

### Approval key

Moving an article into Approved requires both the Gatekeeper-review capability
and a four-digit backend key. The pilot default is `2741`. Replace it for the
Windows deployment before wider use:

```powershell
$env:SIGNALROOM_APPROVAL_KEY="4826"
```

The value is verified server-side and excluded from stored article-action
records. Keep it out of source control.

### Gatekeeper key

Gatekeeper and Dropped Articles remain visible, but a new browser session must
unlock the audit with the four-digit Gatekeeper PIN. The pilot default is
`6384`. Change it in the ignored deployment environment file, for example:

```powershell
set "SIGNALROOM_GATEKEEPER_KEY=9157"
```

This PIN unlocks only the audit/dropped surface. It does not grant Analytics,
source editing, scheduler control, or approval permission.

### Legacy PowerPoint template export

The legacy marker-based PPTX export is implemented. Put the original file at:

```text
C:\scrappyV2\template.pptx
```

When exporting PPTX, the backend checks `SIGNALROOM_PPTX_TEMPLATE`, then root
`template.pptx`, then `backend\template.pptx`. It supports legacy layouts
`CoverLayout` and `NewsLayout` and markers `#TITLE`, `#SUMMARY`, `#LINK`,
`#INSIGHT`, `#DATE_HERE`, and `#Targated_SRID_Team`. Without a template it uses
the built-in presentation design.

The exporter intentionally does not download remote images while rendering.
The legacy code disabled certificate verification for image downloads, which
is unsafe. The picture frame remains and the original image URL is attached as
a hyperlink where PowerPoint supports it. Source URLs, summary, intent/insight,
date, and team are exported.

To keep the template elsewhere, set an absolute path before starting the API:

```powershell
$env:SIGNALROOM_PPTX_TEMPLATE="D:\news-assets\template.pptx"
```

### Notifications

The notification endpoint reports fresh briefings and approvals of articles in
the viewer's selected set. Completed searches also create device-local notices.
Read/unread state is a browser preference; notification facts come from the
backend's briefing and action records.

## 10. Tests and release acceptance

Run only real package scripts:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` already includes a production build; the separate build command is
still useful as an explicit acceptance record.

Python:

```powershell
$env:PYTHONPATH="backend"
.\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
.\.venv\Scripts\python.exe -m compileall -q backend
```

Acceptance means all of the following are observed, not inferred:

1. `doctor.ps1` reports the expected source counts and no unexpected port use.
2. Source preflight generates a TechCrunch request.
3. Both model hashes verify and strict warmup is not degraded.
4. API health succeeds.
5. The frontend stays running, loads in a browser, and says `newsScrapper`.
6. No visible old product branding remains; Vinext/Vite names remain intact.
7. One manual controlled profile run attempts a source.
8. Only then is the scheduler enabled.

## 11. Compatibility boundary

Visible branding is centralized in `lib\brand.ts` and
`backend\signalroom\branding.py`. The npm-safe package name is
`news-scrapper-frontend`.

The following intentionally remain for compatibility: the `signalroom` Python
package, imports, API bridge/routes, `SIGNALROOM_*` environment variables,
browser-storage keys, response headers, serialized JSON keys, deployment file
names, and historical test imports. Renaming those requires aliases and data
migration and is outside this visible-branding repair.

## 12. Remaining enterprise steps

The repository cannot supply the company's private root CA. If the Windows
network presents a certificate chain signed by an enterprise root that Python
or Node does not trust, IT/security must provide and authorize that root. The
code is ready to consume it securely through the Windows trust store or an
explicit PEM bundle; no bypass is implemented.

Model weights are intentionally excluded from Git. A clean clone therefore
fails `--verify-only` until the two exact snapshots are securely downloaded or
copied and hash-verified.
