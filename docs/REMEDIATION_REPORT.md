# newsScrapper remediation report

Date: 2026-07-21  
Repository: `stark-craft/velvet-penguin-lantern`  
Validation host: macOS Codex workspace (not the target Windows laptop)

## Outcome

The Scrapy zero-entrypoint defect is repaired, source diagnostics and an
offline preflight command are present, secure corporate-CA model download and
offline hash verification are implemented, visible branding is newsScrapper,
Windows diagnostic/launch wrappers are included, the backend/API/frontend were
run locally, and one real TechCrunch profile run succeeded.

The complete intended ML path is **not ready yet** because the two model folders
are empty on this machine. `--verify-only` and `warm-models --strict` correctly
return nonzero. The successful manual crawl therefore used the documented
hashing/extractive fallbacks and a fail-open missing Gatekeeper artifact.

## Root causes

1. **Crawler zero-entrypoint failure:** `NewsSpider` implemented only
   `start_requests()`. The reported Windows Scrapy 2.17 runtime no longer calls
   that method, so no entrypoint generator ran and `_sources_attempted` remained
   empty even though the source file was populated.
2. **Misleading crawl exception:** the runner discarded the counts and paths in
   the source-health artifact and emitted only a generic no-entrypoint message.
3. **Model SSL failure:** the downloader relied on Hugging Face Hub defaults and
   had no approved custom-PEM/system-store client-factory integration. It also
   had no network-free folder/hash verifier.
4. **Frontend certificate warning:** on the reported Windows network, the
   Cloudflare/Miniflare `Request.cf` metadata fetch sees an untrusted chain. On
   this host the warning did not occur; the server stayed alive and returned
   HTTP 200. The application does not read `Request.cf`, and the installed
   Cloudflare Vite plugin schema exposes no supported `cfFetch` option.
5. **Old visible branding:** product text was repeated in metadata, components,
   export documents, API metadata, launch output, documentation, and the Open
   Graph bitmap instead of being centralized.
6. **Windows operation gap:** no read-only doctor, safe development launcher,
   offline model wrapper, or validated manual-profile wrapper existed.
7. **Local npm validation interruption:** the first clean install/build omitted
   Rolldown's optional Darwin ARM native binding (the known npm optional
   dependency issue). A Node 22 `npm install` restored the single missing
   package; the same test then passed.

## Versions used during reproduction

| Component | Version/result |
| --- | --- |
| Node.js used for final frontend checks | `v22.22.2` |
| npm used for final frontend checks | `10.9.7` |
| Python | `3.9.6` |
| pip | `26.0.1` |
| Scrapy | `2.11.0` |
| torch | `2.4.0` |
| transformers | `4.44.0` |
| huggingface-hub | `0.36.2` |
| sentence-transformers | not installed on this host |
| Vinext / Vite | `0.0.50` / `8.0.13` |

The exact target-Windows reproducible versions documented for rollout are
64-bit CPython 3.11.9 and Node.js 22.22.2. The reported Scrapy 2.17 behavior was
addressed through dual startup APIs; this host itself has Scrapy 2.11.

## Code changes

### Original Windows-remediation inventory

The inventory below records the original Windows-remediation pass. A later
personalization and workflow pass added pseudonymous user identity, current-name
analytics, mixed RSS/homepage crawler tests, time-aware greetings, pets,
notifications, approval-key enforcement, and removal of unused starter/database
files. Its operational details are documented in `NEWSSCRAPPER_WINDOWS_GUIDE.md`;
the current Git diff is the authoritative file inventory. No source JSON file
was modified in either pass.

Modified files:

- `README.md`
- `SIGNALROOM_GUIDE.md`
- `app/api/signalroom/[...path]/route.ts`
- `app/globals.css`
- `app/layout.tsx`
- `backend/README.md`
- `backend/main.py`
- `backend/scripts/download_models.py`
- `backend/signalroom/app.py`
- `backend/signalroom/crawlers/settings.py`
- `backend/signalroom/crawlers/spiders/news_spider.py`
- `backend/signalroom/services/crawl_runner.py`
- `backend/signalroom/services/exports.py`
- `backend/signalroom/services/scheduler.py`
- `backend/tests/test_crawl_runner.py`
- `backend/tests/test_crawler.py`
- `backend/tests/test_exports.py`
- `components/Overlays.tsx`
- `components/Search.tsx`
- `components/Shell.tsx`
- `components/SignalroomApp.tsx`
- `deployment/README_WINDOWS.md`
- `deployment/start_signalroom.bat`
- `docs/PHASE_READINESS.md`
- `lib/signalroom-client.ts`
- `package-lock.json`
- `package.json`
- `public/og.png`
- `tests/rendered-html.test.mjs`

New files:

- `NEWSSCRAPPER_WINDOWS_GUIDE.md`
- `backend/signalroom/branding.py`
- `backend/tests/test_download_models.py`
- `docs/REMEDIATION_REPORT.md`
- `lib/brand.ts`
- `scripts/windows/doctor.ps1`
- `scripts/windows/run-profile.ps1`
- `scripts/windows/start-dev.ps1`
- `scripts/windows/verify-models.ps1`

### Crawler

- Added one guarded `_iter_initial_requests()` generator.
- Added modern `async start()` and compatible `start_requests()` wrappers.
- Preserved callbacks, errbacks, priorities, metadata, fallback URLs, allowed
  domains, stats, and `_sources_attempted` accounting.
- Added total/enabled/selected/usable counts, unsupported-source IDs,
  selected/rejected override IDs, unmatched overrides, source-file paths, and
  generated-request counts.
- Added `backend/main.py preflight`, which generates requests without network
  access.
- Expanded the runner exception with profile/path/count diagnostics.

### Model setup and certificates

- Kept both exact repository IDs, pinned revisions, safetensors-only selection,
  and expected SHA-256 values.
- Added `--ca-bundle`, `--use-system-ca`, and standard certificate-environment
  variable support.
- Added runtime selection of Hugging Face Hub's `httpx` client factory or legacy
  `requests` backend factory. TLS verification is always enabled.
- Added `--verify-only`; it performs no network request and checks folders,
  required files, HTML error pages, and pinned weight hashes.
- Added actionable SSL/network/checksum failure categories and secure guidance.

### Visible branding

- Added frontend `lib/brand.ts` and backend
  `backend/signalroom/branding.py`.
- Updated UI, metadata, Open Graph/Twitter descriptions, API title, error
  fallbacks, export files, scheduler/launcher output, docs, and social image.
- Changed the npm-safe name to `news-scrapper-frontend`.
- Retained internal compatibility identifiers listed below.

### Windows tooling

- `scripts/windows/doctor.ps1`: read-only versions, imports, JSON/source counts,
  model hashes, ports, certificate-setting presence, and backend health.
- `scripts/windows/start-dev.ps1`: prerequisite checks, optional Node system CA,
  API/frontend startup, health report, optional guarded scheduler, owned-process
  cleanup, and no automatic crawl.
- `scripts/windows/verify-models.ps1`: offline model verifier.
- `scripts/windows/run-profile.ps1`: validated Default/Broadcast and source
  arguments with exact-command display.

### Documentation

- Added `NEWSSCRAPPER_WINDOWS_GUIDE.md` as the authoritative Windows guide.
- Retained `SIGNALROOM_GUIDE.md` as a compatibility pointer.
- Updated README/deployment/backend/readiness headings and launch instructions.

## Tests added

Crawler regression coverage now verifies:

1. enabled RSS entrypoint generation (existing coverage retained);
2. homepage/deep-scan entrypoint generation;
3. disabled-source suppression;
4. no-URL diagnostics;
5. parity between `async start()` and the shared generator;
6. `_sources_attempted` population;
7. unchanged validation of the 107-record source file;
8. detailed runner no-entrypoint errors;
9. the `techcrunch` source override;
10. double-start protection.

Model tests verify matched hashes, missing-file failures, HTML error detection,
invalid CA rejection, offline/no-network output, nonzero exit behavior, and TLS
error classification.

## Acceptance command ledger

| Command | Result |
| --- | --- |
| `git status --short --branch`, branch/log inspection | PASS; clean baseline on `main` at `d7cdab8` |
| `node --version` | PASS; `v22.22.2` |
| `npm --version` | PASS; `10.9.7` |
| Python/pip/Scrapy version commands | PASS; versions above |
| combined ML import/version command | FAIL; `sentence_transformers` absent |
| source JSON parse/count/hash command | PASS; Default 107/79 enabled, Broadcast 5/5 |
| baseline `python3 -m pytest ...` | FAIL; pytest absent from the host system Python |
| baseline `npm run typecheck` | PASS |
| baseline `npm run dev` and `curl -I http://localhost:3000/` | PASS; server remained alive, HTTP 200, no local `Request.cf` failure |
| `PYTHONPATH=backend python3 -m unittest backend.tests.test_crawler backend.tests.test_crawl_runner` | PASS; 22 tests |
| `PYTHONPATH=backend python3 backend/main.py preflight --profile default --source techcrunch` | PASS; 107 configured, 79 enabled, one selected usable source, one request |
| focused crawler/model unit command | PASS; 27 tests |
| `python3 backend/scripts/download_models.py --verify-only` | EXPECTED FAIL (exit 3); both model folders missing |
| `python3 -m compileall -q backend` with external pycache | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `PYTHONPATH=backend python3 -m unittest discover -s backend/tests -v` | PASS; 112 tests |
| first `npm ci` | FAIL; npm exit-handler/cache-log issue in sandbox |
| `npm_config_cache=/private/tmp/news-scrapper-npm-cache npm ci` | PASS with Node-engine and audit warnings from a login-shell Node 20 runtime |
| first `npm test` | FAIL; optional `@rolldown/binding-darwin-arm64` omitted by npm |
| `npm_config_cache=/private/tmp/news-scrapper-npm-cache npm install` under Node 22 | PASS; restored one native package |
| second `npm test` | PASS; build, typecheck, and 3 rendered-worker tests |
| `npm run build` | PASS |
| `python3 backend/main.py api --host 127.0.0.1 --port 8000` | PASS |
| `curl http://127.0.0.1:8000/api/v1/health` | PASS; status `ok` |
| `curl http://127.0.0.1:8000/openapi.json` | PASS; title `newsScrapper API` |
| final `npm run dev` and browser load | PASS; HTTP 200, backend calls 200/201, title and visible masthead `newsScrapper`, no visible old brand |
| `python3 backend/main.py run --profile default --source techcrunch` | PASS; one attempted/responded source, four discovered/normalized/clusters/retained, zero dropped |
| browser briefing verification | PASS; TechCrunch headlines and dossier actions rendered |
| Hugging Face system-CA client-factory smoke test | PASS; selected `requests_backend_factory` for hub 0.36.2 |
| `python3 backend/main.py warm-models --strict` | EXPECTED FAIL (exit 2); both intended models degraded/missing |
| `ruff check backend` | NOT RUN; Ruff is not installed in the host system Python |
| PowerShell script execution | NOT RUN; PowerShell is not installed on this macOS validation host |
| final `git diff --check` | PASS |

## Preservation evidence

The source configurations were not modified:

```text
backend/sites/sites.json
763e629a663474655dfdea7e48267c812eed5e3d0fc13668d81b0e62fb25af9f

backend/sites/broadcast_sites.json
ca345ca2fbef69148855279f4efb388c8c364084f14a2850b5da70a1b67437ba
```

The manual run appended normal runtime/job/briefing data through the repository
API. Runtime data remains ignored and is not part of the source diff.

## Remaining warnings and manual steps

1. Obtain the organization's approved root CA from IT/security if the Windows
   laptop still reports certificate-chain errors. An enterprise root CA is
   still needed **only if** the network performs HTTPS inspection and the
   current Windows/Python/Node trust stores do not already contain it.
2. Securely download or copy both pinned model snapshots and run
   `scripts\windows\verify-models.ps1`.
3. Re-run `warm-models --strict`; do not accept degraded model status.
4. Run `scripts\windows\doctor.ps1` and the full suites on the actual Windows
   target. PowerShell syntax/runtime behavior could not be executed on macOS.
5. npm reports 17 dependency advisories (1 low, 8 moderate, 8 high). No automatic
   or breaking audit fix was applied; review upgrades separately.
6. Vinext build emits Node's `punycode` deprecation warning. It is framework
   dependency output and does not stop the build.
7. The local system Python emits a LibreSSL/urllib3 compatibility warning. The
   documented Windows Python 3.11 reference avoids relying on this macOS system
   Python.
8. After the real models are active, collect reviewed feedback and train the
   profile-specific Gatekeepers. The current missing artifact correctly fails
   open.
9. Do not start the scheduler on Windows until one manual controlled profile
   run succeeds there.

## Compatibility aliases retained

- `signalroom` Python package/import paths;
- `/api/signalroom` frontend bridge and `/api/v1` backend routes;
- `SIGNALROOM_*` and `NEXT_PUBLIC_SIGNALROOM_*` environment variables;
- `signalroom-*` browser-storage/session keys;
- `X-Signalroom-*` compatibility response/proxy headers;
- serialized JSON/state keys and existing runtime data;
- deployment filenames and historical test/module imports;
- `SignalroomApp` and `SignalroomApiError` internal TypeScript symbols;
- `SignalroomScheduler` Python alias.

## Final acceptance status

| Area | Status |
| --- | --- |
| Source configuration preserved | PASS |
| Modern/older Scrapy startup compatibility | PASS by offline tests; actual host Scrapy is 2.11 |
| Initial request generated | PASS |
| Real source attempted/responded | PASS |
| Backend health | PASS |
| Frontend load/branding/backend connection | PASS |
| Production build and frontend tests | PASS |
| Full backend tests | PASS |
| Model files present and hash-verified | FAIL / manual step |
| Strict intended ML backends | FAIL / manual step |
| Windows-specific script execution | PENDING on Windows |
| Recurring scheduler validation | NOT STARTED, intentionally gated |
