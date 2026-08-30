# TechScout productionization and consolidation report

Date: 2026-08-28 (Asia/Kolkata)
Baseline commit: `786ad8b456a8e07112b349de2bb9ea1bfda842d9`
Branch at completion: `codex/legacy-stabilization`

## 1. Executive summary

This pass productionized the active `legacy_app/` application without rewriting the product or altering the unified corpus. It repaired the Samsung enrichment fallback so optional service failures do not discard valid candidates, introduced capability-based backend and frontend authorization, added a runtime access console and audit trail, completed recoverable internal-content lifecycle operations, hardened uploads and outbound requests, added single-worker/scheduler/runtime-file safeguards, split the frontend into route-level chunks, and consolidated the major live surfaces into one visual and interaction system.

The active shared briefing, one scheduler, one `sites.json`, one Gatekeeper model, private viewer stores, retained history, internal content, and Venture Lens state were preserved. `.env`, model weights, runtime data, uploaded content, briefing history, and `sites.json` were not edited or migrated. The pre-existing repository-root `FORENSIC_AUDIT_2026-08-23.md` remained untouched.

Final verification is green: 92 frontend tests, 204 backend tests, the production Vite build, 68 composed FastAPI routes with no duplicate method/path pair, real browser QA in both themes, Vite deep-link QA, and FastAPI-served production deep-link QA.

## 2. Pipeline integrity

### Web Search overflow

- `WEB_SEARCH_MAX_ENRICH_PER_RUN` limits Samsung Web Search enrichment work, not candidate retention.
- Candidates beyond the Web Search budget receive targeted local extraction one item at a time and remain in the stage output.
- Regression cases cover 50, 100, 101, and 250 candidates. Each case retains exactly its input count, and 101 accounts for all 101 items rather than silently dropping the overflow item.

### Web Search failure

- A preflight failure selects a safe degraded mode instead of starting discovery again.
- A runtime request failure falls back only for the affected article.
- Failed or mismatched Samsung extraction is explicitly labelled; intentional keyword filtering remains distinct from provider failure.
- Overflow, preflight failure, and runtime degradation all use the same per-item recovery boundary.

### Chat failure and cap behavior

- Chat summarization errors create a bounded local lead-and-key-points fallback for that article.
- One Chat failure does not restart the crawl, repeat discovery, or discard other successful summaries.
- Chat cache keys include cluster content. Cached generated fields never overwrite current private metadata, source coverage, or full article text.

### Cache and resume behavior

- Successful Web Search and Chat results are written atomically and reused on later runs.
- A failed refresh does not erase a healthy cached enrichment.
- Pipeline stage outputs are passed forward; recovery resumes at the affected enhancement stage rather than recrawling.

### Candidate accounting and logging

- Accounting reports input, Web Search success, Web Search overflow, cache hits, item recovery, output, and total accounted candidates.
- The final retained count is logged separately from intentional Gatekeeper filtering.
- Tests prove `accounted == input` for the 50/100/101/250 boundary matrix.

## 3. Security

### Capability model

The active capabilities are:

- `review.news.view`, `review.news.submit`, `review.news.approve`
- `review.contributions.view`, `review.contributions.publish`
- `contributions.create`, `approved.view`
- `sources.view`, `sources.manage`
- `scheduler.view`, `scheduler.control`
- `gatekeeper.review`, `analytics.view`
- `region.correct`, `model.train`, `crawl.run`
- `system.status.detail`, `access.manage`

Normal viewers receive personal intelligence functionality but do not receive privileged navigation or data merely because a component is hidden. Direct frontend routes render an unauthorized state when needed, and protected backend operations return HTTP 403.

### Protected route inventory

- Review workflow: `GET /workflow`, `POST /workflow/select`, `POST /workflow/import`, `POST /workflow/approve`, `POST /workflow/remove` use separate view/submit/approve checks.
- Regions and training: `POST /region/correct`, `POST /train` require their explicit capabilities.
- Source Control: `GET /sites` requires `sources.view`; `POST /sites`, `PUT /sites/{source_id}`, and `DELETE /sites/{source_id}` require `sources.manage`.
- Scheduler and operational status: `GET /scheduler/status`, `POST /scheduler/run`, and detailed `GET /status` are capability-aware; scheduler control is rate limited.
- Crawl: `GET /crawl` requires `crawl.run` and is rate limited even though it streams progress through GET for compatibility.
- Gatekeeper: dropped records, restore queue, restore, and retry require `gatekeeper.review`.
- Briefing-wide removal/restore requires the review capability. Private Hide remains viewer-owned and does not train the shared Gatekeeper.
- Contribution authoring endpoints require contributor access plus signed-viewer ownership; review/publish/archive/restore require editor capabilities; permanent deletion requires `access.manage`.
- Access administration: principal listing/update and audit endpoints require `access.manage`.
- Large export operations are rate limited and use hardened image fetching.

### Session and secret handling

- Privileged unlocks generate random server-side sessions with expiry and an HttpOnly, SameSite=Strict cookie; Secure follows HTTPS configuration.
- Logout revokes the server-side token.
- Production no longer silently accepts a weak privileged default. The legacy short key exists only as an explicit development-mode compatibility fallback.
- Normal API traffic does not carry privileged keys in query parameters.

### Network, upload, and abuse protections

- Forwarded client addresses are accepted only when the immediate peer is in `TRUSTED_PROXY_IPS`; IPv4-mapped IPv6 and spoof attempts are normalized and tested.
- My Briefing and export images share public-network validation: HTTP(S) only, redirect revalidation, DNS checks, private/loopback/internal host rejection, timeouts, content-type and byte caps, and image pixel caps.
- PDF/DOCX and cover uploads stream with size limits before complete in-memory parsing, validate filename/extension/signature, cap PDF pages and extracted text, reject archive/pixel bombs, and confine stored paths.
- Expensive crawl, training, export, upload/import, scheduler, and unlock operations have bounded in-process rate limits.

### Remaining security concerns

- Runtime JSON locks, rate limits, scheduler ownership, and privileged sessions are process-local or local-file based. Exactly one worker remains mandatory until these move to a shared transactional store.
- Privileged sessions are intentionally lost on backend restart; operators must unlock again.
- Production must configure long random secrets, explicit allowlists, trusted proxies, HTTPS, and secure cookies. Development loopback defaults are not production authorization.
- A future multi-host deployment should use a shared identity/session/rate-limit store and centralized audit retention.

## 4. Access management

- Runtime authorization is stored atomically in `runtime/access_control.json`; privilege changes are appended to `runtime/access_control_audit.json`.
- The signed viewer principal is the primary identity. Known IPs are retained as network context, while environment IP allowlists remain bootstrap/backward compatibility inputs.
- Effective authorization is the union of principal grants, explicit environment bootstrap grants, and a live privileged session.
- The Access Management UI can add a signed viewer principal, edit its display label and known IP context, group capabilities by responsibility, save changes immediately, and review the immutable change trail.
- Each changed capability records target, old value, new value, actor, and timestamp. The web UI never edits `.env`.

## 5. Internal content lifecycle

- Authors may create/import/update drafts, submit them, withdraw a submitted record, resume a withdrawn record, and permanently delete only unpublished editable states (`draft`, `ready`, `needs_changes`, `withdrawn`).
- Editors may publish, request changes, reject to archive, archive published content, and restore archived content. A new published leadership vision retires the prior published vision.
- `publish_at`, `expires_at`, and `archived_at` are normalized lifecycle fields. Future or expired records disappear from public published readers without deleting their author record.
- Public readers expose only effectively published records.
- Super-admin permanent deletion is an explicit `access.manage` operation and removes only that record's sanitized cover/original assets plus metadata.
- Existing contribution lists remain the content-management surface, with status and type separation preserved; no stored records were rewritten for this pass.

## 6. Runtime cleanup

The orphan sweeper only considers stale, inactive files matching these exact allowlists:

- `ui_results_scheduler_<job>.json`
- `clustered_results_scheduler_<job>.json`
- `ui_results_<16 lowercase hex>.json`
- `clustered_results_<16 lowercase hex>.json`
- dot-prefixed atomic JSON temps matching `.<name>.json.<32 lowercase hex>.tmp`
- direct temps for `workflow_store`, `dropped_articles`, `gatekeeper_restore_queue`, `viewer_*`, `not_interested_store`, or `region_learning`, each ending in `.json.tmp`

The default stale threshold is 12 hours, active job IDs are excluded, and cleanup reports removed count and reclaimed bytes only when work occurred.

Never matched or deleted: `briefing_*.json`, unified archives, `trainingData.json`, model files, dropped-article canonical state, viewer/recommendation/workflow state, `sites.json`, internal content/uploads, Venture Lens state, Samsung retained caches, manual search logs, or developer `*_before_*` backups.

## 7. Performance

| Measurement | Baseline | Final | Result |
|---|---:|---:|---:|
| Production build time | 3.72 s | 2.52 s | 32% faster in this local run |
| Main shell JS | 214.66 kB / 72.73 kB gzip | 200.14 kB / 67.64 kB gzip | ~7% smaller gzip |
| NewsScrapper App JS | 395.66 kB / 104.78 kB gzip | 68.94 kB / 22.42 kB gzip | ~79% smaller gzip |
| App CSS | 244.15 kB | 92.57 kB | ~62% smaller |
| Samsung projection, retained 22-archive sample | 123.15 ms first projection | 2.286 ms cached | 53.9× cached speedup |

- Major screens, Scout, stream, dossier, publishing, PDF/DOCX parsing, and route CSS now load as independent chunks.
- Same-origin GETs use request deduplication, bounded stale-while-revalidate caching, invalidation after mutations, and `AbortController` cancellation.
- Large lists render progressively. Scan uses explicit submission and a page size of 25.
- Background video is default-light, suppressed for light/reduced-motion/save-data conditions, and route motion pauses offscreen.
- The final `dist/` is 2.5 MB across 65 assets; the PDF worker remains the largest lazy worker at 1,078.61 kB.

## 8. UI

### Scan

- Removed aggressive auto-search. The user composes a query and explicitly submits it.
- Added a compact research console, clear result summary, useful Region/Category/Source/Date controls, progressive result paging, and capability-aware review/source actions.
- Removed the duplicate Scan-specific tour. Scout is the only guide system.

### Briefing

- The carousel keeps fixed zones and no hover trap. The shared continuous stream handles pause/focus/reduced-motion/offscreen behavior.
- Latest Day Signals advances every seven seconds and exposes an explicit pause/resume control.
- “Search Loaded Briefing” is a compact archive utility, distinct from Scan's active investigation workflow.
- Filters are limited to useful Region, Category, Source, and Date controls; obsolete operational scope controls were removed from the ordinary interface.

### History

- Removed oversized introductory content and workflow preloading for ordinary users.
- Uses a utility-first query/filter/result layout, progressive archive cards, and capability-aware archive review actions.

### Settings and navigation

- Privileged links are capability-driven. Ordinary users do not see Review Center, Approved Briefing, Source Control, Scheduler, Gatekeeper, Analytics, or Access Management.
- Language lives in Settings. Duplicate Venture Lens, feedback, contribution, and announcement shortcuts were removed.
- Vite now proxies `/access-control` and `/scheduler`; HTML navigations to the colliding `/voc` and `/scheduler` React routes bypass the API proxy. FastAPI applies the same Accept-aware disambiguation in production.

### Profile and onboarding

- The large IP/hash onboarding was replaced by a compact identity experience focused on display name and optional email.
- The backend-detected network identity is explained without presenting a hash as the person.
- The profile editor, Settings menu, onboarding, and all audited core routes are legible in both themes.

### Scout Guide

- Scout is lazy, default-off, route-aware, keyboard dismissible, versioned (`2026.08-production`), and records per-route completion.
- It uses compositor-friendly movement, honors reduced motion, and can be reopened or disabled from Settings.

### Team & Feedback

- Team data is a safe static directory model, not executable content.
- Team and feedback share one coherent route. The duplicate global floating feedback surface was removed.

### Streams, carousel, and reactions

- `ContinuousSignalStream` is shared by Briefing, Research, and Samsung Internal with route-specific visual skins.
- Carousel controls remain explicit and keyboard named; auto-motion pauses on request and respects reduced motion.
- Interested and less-like-this reactions stay optimistic and counted without removing the article. Counts revalidate through the shared viewer reaction API rather than separate route-specific polling loops.

## 9. Identity

The canonical principal is the signed viewer identity created by the existing private viewer resolver. It keys private saved/hidden/recommendation/contribution data and runtime capability grants. Display names remain presentation metadata; IP is limited to trusted deployment bootstrap, audit/network context, and compatibility gates.

Development may grant loopback operator capabilities for local administration. Production does not: it requires explicit allowlists or principal grants. Linux migration must preserve the viewer signing secret and all runtime identity/state files together; copying records without their signing identity would create new principals rather than safely reassigning historical private data.

## 10. Samsung Internal

- Samsung projection is cached by archive path, nanosecond mtime, size, classifier version, and requested limit. Cache hits return deep copies and any archive signature change invalidates the projection.
- The measured retained-archive sample improved from 123.15 ms to 2.286 ms on a cache hit (53.9×).
- Channel and wire image normalization accepts canonical `top_image`, decodes escaped URLs, rejects unsafe/placeholder/favicon sources, preserves same-origin contribution covers, and falls back cleanly on image load error.
- The retained sample currently produced 77 Global records, 0 Local records, and 0 Inside/Sampark records. Missing Local/Inside channels are skipped honestly rather than relabelling Global content.
- Samsung Local ingestion remains dependent on configured retained sources. AX Hub and SRID APIs were not integrated and are not claimed as complete.

## 11. Files changed

Modified existing files:

- `.env.example`
- `CALLIOPE_AMBER_ORBIT.md`
- `main.py`
- `news-ui/src/main.jsx`
- `news-ui/src/news-scrapper/App.jsx`
- `news-ui/src/news-scrapper/api.js`
- `news-ui/src/news-scrapper/archive-search.css`
- `news-ui/src/news-scrapper/components/TopBar.jsx`
- `news-ui/src/news-scrapper/components/UserProfileModal.jsx`
- `news-ui/src/news-scrapper/components/WorkflowBriefingCard.jsx`
- `news-ui/src/news-scrapper/screens/AnalyticsScreen.jsx`
- `news-ui/src/news-scrapper/screens/FeedScreen.jsx`
- `news-ui/src/news-scrapper/screens/HistoryScreen.jsx`
- `news-ui/src/news-scrapper/screens/ResearchScreen.jsx`
- `news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx`
- `news-ui/src/news-scrapper/screens/ScanScreen.jsx`
- `news-ui/src/news-scrapper/screens/SchedulerScreen.jsx`
- `news-ui/src/news-scrapper/screens/SelectedScreen.jsx`
- `news-ui/src/news-scrapper/screens/SourcesScreen.jsx`
- `news-ui/src/news-scrapper/screens/VocScreen.jsx`
- `news-ui/src/news-scrapper/screens/history-redesign.css`
- `news-ui/src/news-scrapper/styles/personalization.css`
- `news-ui/src/news-scrapper/ui-polish.css`
- `news-ui/src/shared/guide/GuidePet.jsx`
- `news-ui/tests/deployment-contracts.test.js`
- `news-ui/tests/visible-contracts.test.js`
- `news-ui/vite.config.js`
- `news_scrapper/adapters/article_metadata.py`
- `news_scrapper/adapters/samsung_web_search.py`
- `news_scrapper/application.py`
- `news_scrapper/internal_content/access.py`
- `news_scrapper/internal_content/document_parser.py`
- `news_scrapper/internal_content/image_processor.py`
- `news_scrapper/internal_content/router.py`
- `news_scrapper/internal_content/schemas.py`
- `news_scrapper/internal_content/service.py`
- `news_scrapper/samsung_internal_feed.py`
- `tests/test_adapters.py`
- `tests/test_frontend_deployment.py`
- `tests/test_gatekeeper.py`
- `tests/test_internal_content.py`
- `tests/test_personal_briefing.py`
- `tests/test_resilience.py`
- `tests/test_samsung_internal_feed.py`
- `tests/test_samsung_production_pipeline.py`
- `tests/test_viewer_identity.py`

## 12. New files

- `PRODUCTIONIZATION_BASELINE_2026-08-28.md`
- `PRODUCTIONIZATION_REPORT_2026-08-28.md`
- `core/network_safety.py`
- `core/request_limits.py`
- `news-ui/src/news-scrapper/components/ContinuousSignalStream.jsx`
- `news-ui/src/news-scrapper/data/teamDirectory.js`
- `news-ui/src/news-scrapper/screens/AccessManagementScreen.jsx`
- `news-ui/src/news-scrapper/screens/GatekeeperCapabilityScreen.jsx`
- `news-ui/src/news-scrapper/styles/access-management-additions.css`
- `news-ui/src/news-scrapper/styles/access-management.css`
- `news-ui/src/news-scrapper/styles/continuous-signal-stream.css`
- `news-ui/src/news-scrapper/styles/gatekeeper-review.css`
- `news_scrapper/access_control/__init__.py`
- `news_scrapper/access_control/router.py`
- `news_scrapper/access_control/service.py`
- `news_scrapper/runtime_safety.py`
- `tests/test_access_control.py`
- `tests/test_runtime_safety.py`
- `tests/test_security_hardening.py`

## 13. Dependencies

No Python or npm dependency was added or upgraded. Existing lazy PDF/DOCX and frontend dependencies were preserved.

## 14. Tests

| Check | Result |
|---|---|
| Frontend unit/contract tests (`npm test`) | PASS — 92/92 |
| Backend full suite (`python -m unittest discover -s tests -v`) | PASS — 204/204 in 4.19 s |
| Production Vite build (`npm run build`) | PASS — 1,912 modules, 2.52 s |
| Python safe import with scheduler disabled | PASS |
| Composed route inventory | PASS — 68 routes, 62 method/path pairs, no duplicates |
| Pipeline 50/100/101/250 candidate matrix | PASS |
| Capability, proxy spoofing, unauthorized mutation tests | PASS |
| Upload, SSRF, image, lifecycle, runtime cleanup tests | PASS |
| Samsung projection cache regression | PASS — 53.9× measured cache hit |
| Vite SPA hard links | PASS, including `/voc`, `/scheduler`, and privileged routes |
| FastAPI production-build hard links | PASS for `/for-you`, `/voc`, `/scheduler`, `/access-management`, `/venturelens/models`, and Samsung reader routes |
| Browser QA | PASS — light and dark themes, core/personal/privileged/research/Samsung routes, Settings, Profile, Scout, no horizontal overflow or console errors |

The browser audit found and fixed two final defects: missing Vite capability/scheduler proxy mappings and illegible light-theme Access Management empty-state copy.

## 15. Remaining work

- Configure production secrets, HTTPS/cookie policy, trusted proxies, and explicit allowlists before deployment; `.env.example` documents the contract, but real values were intentionally not created.
- Keep exactly one Uvicorn worker until mutable JSON, sessions, rate limiting, and scheduler locks move to shared transactional infrastructure.
- AX Hub and SRID ingestion are not integrated. Samsung Local/Inside coverage will remain empty until real configured sources or APIs deliver those records.
- Optional EPO and X research providers remain hidden when credentials are absent. Their absence does not fabricate empty metrics.
- A future capacity pass can move privileged session/rate-limit state to Redis or a database and add centralized audit retention; this was intentionally avoided in the conservative local-file architecture.
- No mobile-specific QA was performed in this pass, following the product's current desktop-only testing direction. Desktop normal and constrained layouts remain covered by existing CSS and automated contracts.
