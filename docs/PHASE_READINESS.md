# Signalroom phase readiness

This document distinguishes coded behavior from deployment operations. A phase
marked **coded** has implementation and automated coverage in this repository;
it is not a claim that an unconfigured server laptop is production-ready.

| Phase | Status | Delivered outcome | Remaining deployment check |
| --- | --- | --- | --- |
| 1. JSON runtime and retention | Coded | Atomic `state.json` with backup/recovery and writer locking; 30-day briefing/article cleanup; saved, under-review, and approved records are protected. | Back up and restore the release laptop's `backend\runtime\data` once before rollout. |
| 2. Crawl scheduling and source health | Coded | Dedicated four-hour scheduler, startup run, Default-then-Broadcast order, no overlap, Windows-safe process liveness/locking, stale-job recovery, per-run JSON config reload, and visible all-source failure. | Run one controlled crawl against company-network egress and review publisher permissions. |
| 3. Frontend/API workflow | Coded | Feed, dossier, selection, saved/review worklists, batch actions, exports, VOC, analytics, profile preferences, source editing, scan jobs, and gatekeeper surfaces call real API contracts. | Complete one browser acceptance pass against the packaged backend and representative data. |
| 4. Identity, IP routing, and profiles | Coded | Default/Broadcast routing, capability flags, IP/CIDR allowlists, pseudonymous IP storage, developer switching, and editable display-name/email preferences. Production BFF proxy-header trust also requires a shared secret. | Set real allowlists/secrets and validate from one Default, one Broadcast, and one developer device. |
| 5. Gatekeeper learning and review | Coded | Per-profile feedback collection, review/drop thresholds, audited decisions, verified versioned artifacts, atomic promotion, and fail-open behavior. | Accumulate labeled examples and train each profile after phase 7 activates the intended embedder. |
| 6. Portable Windows release | Coded | Separate frontend/backend layout, embedded-Python-aware launcher, environment template, production frontend build contract, and deterministic release tests. | Assemble and smoke-test the package on the same Windows architecture/Python version as the server laptop. |
| 7. Hugging Face ML packages and weights | Deferred by design | MiniLM (`sentence-transformers/all-MiniLM-L6-v2`) and DistilBART (`sshleifer/distilbart-cnn-12-6`) adapters, explicit local folders, lazy loading, readiness command, and deterministic fallbacks already exist. | Install the optional `ml` dependency extra, download both repositories into `backend/model_weights`, run strict warmup, then retrain the two gatekeeper profiles. |

## Phase 7 behavior

With `SIGNALROOM_HF_LOCAL_ONLY=true`, missing weights never trigger a network
download. The application remains usable but reports degraded ML metadata:

- clustering uses deterministic 384-dimensional hashing embeddings;
- summarization uses the extractive fallback;
- a gatekeeper artifact trained with a different embedding backend is rejected
  safely and the gatekeeper retains articles instead of silently dropping them.

Complete phase 7 from the release root:

```powershell
python_embed\python.exe -m pip install -r requirements.txt
python_embed\python.exe backend\scripts\download_models.py
set "SIGNALROOM_EMBEDDING_MODEL_PATH=%CD%\backend\model_weights\all-MiniLM-L6-v2"
set "SIGNALROOM_SUMMARIZATION_MODEL_PATH=%CD%\backend\model_weights\distilbart-cnn-12-6"
python_embed\python.exe backend\main.py warm-models --strict
python_embed\python.exe backend\main.py train --profile default
python_embed\python.exe backend\main.py train --profile broadcast
```

The strict warmup must return exit code `0` and JSON with `"ready": true`
before the two training commands are run. Training still requires enough useful
keep/drop feedback in each profile; lack of examples is a valid reason to defer
promotion rather than fabricate labels. The supplied launcher persists the same
portable cache location for later API/scheduler processes.

## Release acceptance

Use these gates on the assembled laptop package:

1. `npm test` passes before copying the frontend build.
2. Backend tests pass without model downloads.
3. `start_signalroom.bat` launches exactly one API, one scheduler, and one
   frontend process.
4. `/api/v1/health` and `/api/v1/me` return HTTP 200 locally.
5. A Default device cannot switch to Broadcast or open administrator screens.
6. A saved and an under-review test article survive a forced retention pass.
7. Only after the weights are installed, strict model warmup reports ready and
   freshly trained profile artifacts report the MiniLM backend.

The direct-API Windows topology does not use trusted BFF headers. In a later
reverse-proxy topology, `SIGNALROOM_TRUST_PROXY_IP_HEADERS=true` is valid only
when `SIGNALROOM_PROXY_SHARED_SECRET` contains at least 32 characters and the
company proxy replaces client-supplied `x-signalroom-proxy-secret`, forwarding,
and identity headers with authenticated values.

## Current automated verification

Verified on 2026-07-20 without downloading model weights:

- frontend `npm test`: production Vinext build passed, strict TypeScript passed,
  and 3/3 compiled-worker smoke tests passed;
- backend offline suite: 100/100 tests passed, including 7/7 scheduler tests and
  three mocked Windows process-liveness cases;
- backend `compileall` passed;
- full frontend ESLint completed with zero errors and zero warnings.

These automated results do not replace the target-Windows packaging, real
publisher-network, IP-allowlist, or phase-7 model-cache acceptance checks listed
above.
