# Legacy Stabilization and Integration Ledger

This document is the durable handoff between the deployed legacy product and
the newer newsScrapper implementation. It exists so that integration choices
do not depend on chat history or human memory.

## Source-of-truth decisions

- The deployed legacy product is the behavioral and visual baseline.
- The newer implementation on `main` is a preserved donor implementation.
- Stabilization work happens on `codex/legacy-stabilization`.
- Functional repair and production validation happen before visual redesign.
- Production data files are inputs to migration, never disposable fixtures.
- `uvicorn main:app` remains a supported startup contract.

## Authoritative production layout

```text
C:\App_Portable
|-- backend
|   |-- main.py
|   |-- intelligence_store
|   |-- history_archive
|   |-- local_miniLM_model
|   |-- local_bart_model
|   |-- flan-t5-local
|   |-- news_aggregator
|   |-- sites.json
|   |-- sites_broadcast.json
|   `-- template.pptx
|-- frontend
|   `-- dist
|-- python_embed
`-- START_SENSE.bat
```

The application is an internal Windows deployment. Uvicorn listens on port 80
and the compiled frontend is served without requiring Node.js on the server.
AI models and Python dependencies must be usable locally without an internet
connection.

## Preserved donor feature map

| Donor capability | Current implementation | Intended legacy destination | Status |
| --- | --- | --- | --- |
| Application shell and profile-aware navigation | `components/Shell.tsx`, `lib/navigation.ts` | Legacy top bar and settings navigation | Preserved |
| Article dossier and application overlays | `components/Overlays.tsx` | Legacy article-card dossier flow | Preserved |
| Briefing and article presentation | `components/Briefing.tsx` | Legacy feed, briefing, and discover screens | Preserved |
| Search workspace | `components/Search.tsx` | Legacy search/deep-scan screen | Preserved |
| Workflow, analytics, sources, and supporting views | `components/WorkspaceViews.tsx` | Corresponding legacy screens | Preserved |
| User personalization and identity | `lib/personalization.ts` | Legacy user settings and first-visit flow | Preserved |
| Desk pet and notification companion | `components/DeskPet.tsx` | Optional legacy user preference | Preserved |
| Shared design primitives | `components/ui.tsx`, `app/globals.css` | Selective accessibility and interaction improvements | Preserved |
| Typed API client and domain models | `lib/signalroom-client.ts`, `types/news.ts` | Legacy API adapter/contract | Preserved |
| Hybrid RSS and HTML crawler | `backend/signalroom/crawlers` | Legacy Scrapy project and scheduler | Integration target |
| Crawl orchestration and diagnostics | `backend/signalroom/services/crawl_runner.py` | Legacy scheduler/manual scan logging | Integration target |
| Pipeline, clustering, summarization, and Gatekeeper services | `backend/signalroom/services`, `backend/signalroom/ml` | Legacy processing flow | Integration target |
| JSON repository | `backend/signalroom/json_storage.py` | Legacy JSON stores and 30-day retention | Integration target |
| Export services | `backend/signalroom/services/exports.py` | Legacy PPTX, XLSX, and DOCX endpoints | Integration target |
| Security and pseudonymous identity | `backend/signalroom/security.py` | Legacy IP/profile/access behavior | Integration target |

`main` at commit `622e874` is the exact donor snapshot at the start of this
work. Features should be copied from source when needed, not recreated from a
description.

## Baseline validation — 2026-07-22

The baseline was run before changing behavior.

| Check | Result |
| --- | --- |
| Frontend production build | Pass |
| TypeScript typecheck | Pass |
| Rendered production-worker tests | Pass, 3 tests |
| Frontend ESLint | Pass |
| Backend pytest suite | Pass, 124 tests |
| Backend Ruff check | Fail, 1,055 findings |

The Ruff result is a tooling/configuration debt item. The suite currently mixes
Python 3.9 compatibility with aggressive modernization rules and applies them
to tests and operational scripts. It must be made enforceable deliberately;
bulk unsafe rewriting is not part of functional stabilization.

## Known defect ledger

Statuses are `open`, `in progress`, `verified`, or `deferred`.

### Crawler and source handling

| ID | Defect or risk | Status |
| --- | --- | --- |
| CR-01 | Legacy spider performs poorly across the real source set and needs the stronger hybrid crawler mechanics. | open |
| CR-02 | RSS/Atom sources and ordinary website URLs must work in the same run. | open |
| CR-03 | Each source needs explicit counts for entrypoints, candidates, date matches, keyword matches, extraction success, and failure. | open |
| CR-04 | Feed discovery, listing fallback, redirect handling, canonicalization, and publisher-domain boundaries require production validation. | open |
| CR-05 | Date filtering must be based on defensible publication provenance and clearly report unknown dates. | open |
| CR-06 | Default and broadcast source schemas/names must be adapted without overwriting their production files. | open |
| CR-07 | Zero-result runs must distinguish no match, old content, unreachable source, blocked source, and extraction failure. | open |

### Backend and workflow

| ID | Defect or risk | Status |
| --- | --- | --- |
| BE-01 | The legacy `main.py` is a large monolith; startup compatibility must remain while internals become testable. | open |
| BE-02 | Selected items must be private per actor; the under-review and approved queues are shared. | open |
| BE-03 | Only an item's owner or an administrator may remove it from the shared review queue. | open |
| BE-04 | Bouncer vote removal must reverse or supersede prior learning state consistently. | open |
| BE-05 | Approval and Gatekeeper secrets must never be stored in telemetry or returned to clients. | open |
| BE-06 | IP-derived identity, display-name changes, uniqueness, and analytics attribution need one stable contract. | open |
| BE-07 | Thirty-day pruning must preserve saved/review-later material according to the final workflow meaning. | open |
| BE-08 | PPTX export must use the deployed `template.pptx` safely and have a production-path test. | open |
| BE-09 | Scheduler startup recovery, sequential profile execution, and four-hour logging require end-to-end validation. | open |
| BE-10 | JSON writes require atomicity, locking, backup/recovery behavior, and production-data migration tests. | open |

### Frontend behavior and accessibility

| ID | Defect or risk | Status |
| --- | --- | --- |
| FE-01 | Article-card container and nested controls need correct keyboard and pointer semantics. | open |
| FE-02 | Bouncer controls are clickable `div` elements and are not keyboard accessible. | open |
| FE-03 | Hide and Not Relevant overlap and need one unambiguous behavior model. | open |
| FE-04 | The date picker lacks focus trapping, Escape handling, focus restoration, and robust small-screen placement. | open |
| FE-05 | “Last 24 Hours” currently represents two calendar dates rather than a rolling 24-hour interval. | open |
| FE-06 | Profile synchronization can self-confirm a local override instead of remaining server-authoritative. | open |
| FE-07 | Localhost exposes private navigation regardless of the access response. | open |
| FE-08 | Settings lacks outside-click, Escape, focus management, and complete user controls. | open |
| FE-09 | VOC uses a different API environment variable and bypasses the shared API client. | open |
| FE-10 | Mandatory VOC can lock the interface when submission is unavailable. | open |
| FE-11 | Full VOC message content is duplicated into usage telemetry. | open |
| FE-12 | Visible branding and hard-coded user identity are inconsistent. | open |
| FE-13 | Tooltips must cover icon-only or otherwise ambiguous controls. | open |

### Production deployment

| ID | Defect or risk | Status |
| --- | --- | --- |
| DP-01 | The complete release must run from `C:\App_Portable` using embedded Python 3.11. | open |
| DP-02 | `START_SENSE.bat` must provide reliable readiness detection rather than a fixed sleep alone. | open |
| DP-03 | The fixed server URL should be configurable without editing application code. | open |
| DP-04 | Code upgrades must preserve production JSON, models, templates, trained PKL files, and history. | open |
| DP-05 | The built frontend must work when served by FastAPI at `/home` and on direct route refreshes. | open |
| DP-06 | Server logs must expose scheduler and crawler progress without exposing secrets or raw sensitive data. | open |

## Stabilization gates

The functional baseline is complete only when all of the following are true:

1. The known-defect ledger has no unresolved release-blocking item.
2. Both source profiles pass schema and offline crawl-preflight tests.
3. Representative RSS, Atom, HTML listing, and direct-article fixtures pass.
4. A controlled live crawl reports per-source outcomes and produces articles.
5. Workflow ownership and access-control tests pass across multiple actors.
6. Scheduler, retention, clustering, summarization fallback, and exports pass.
7. The frontend passes build, typecheck, lint, interaction, and accessibility checks.
8. A clean portable Windows package starts with one batch file and preserves an
   existing data directory during upgrade.

Visual redesign begins after these gates are met. UI requests received before
then should be added to the donor map or a separate design backlog.
