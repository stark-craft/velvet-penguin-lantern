# FORENSIC AUDIT REPORT — Sense.AI repository (`stark-craft/velvet-penguin-lantern`)

**Audit date:** 2026-08-23
**Prepared by:** coding agent, read-only forensic session, for handoff to another engineer
**Audit mode:** strictly read-only. No files created/edited/deleted by the auditor during the audit, no tests run, no state-changing commands issued. Read-only `lsof`/`ps` probes identified running processes.
**Scope:** everything changed in the uncommitted working tree since the last provable baseline commit.
**Note:** this file is an audit artifact, not product code. Keep it out of any future commit.

## 0. Capability disclosure of the auditing agent

The auditing agent does not retain memory between sessions. It could not recall prior conversations, commands, or reasoning. Every statement below derives from repository evidence: git history/reflog, file modification times, diffs, live process inspection, and the project's own handoff document (`.opencode/skills/sense-project-memory/references/current-state-and-roadmap.md`, which documents those sessions from their perspective). Where evidence cannot prove something, this report says **"unknown"** explicitly. Nothing has been invented.

## 1. Repository identity

| Item | Value | Evidence |
|---|---|---|
| Working dir | `/Users/vineet/Documents/UI Redesigning/legacy_app` (repo root is parent) | `pwd`, `git rev-parse --show-toplevel` |
| Branch | `codex/legacy-stabilization` | `git branch --show-current` |
| HEAD | `9219de7` "Unify intelligence pipeline and polish experience" | `git log -1` |
| Remote | `origin = https://github.com/stark-craft/velvet-penguin-lantern.git` — matches policy | `git remote -v` |
| Author | `stark-craft <290818890+stark-craft@users.noreply.github.com>` — no Tourist identity | `git config user.name / user.email` |
| HEAD vs origin/main | Identical (`9219de7`); branch not diverged; no pushes occurred locally per reflog | `git log --decorate` |

## 2. Baseline determination

**Provable baseline: commit `9219de7`, authored 2026-08-16 00:09:43 +0530** (reflog). The reflog contains no commits, resets, checkouts, amends, or rebases after that entry — nothing was committed during the recent work. Therefore all work under audit is uncommitted working-tree state on top of `9219de7`.

The handoff document itself declares a deliberately dirty tree as its snapshot baseline and lists which files were dirty at snapshot time. Comparing its lists to today's status shows the tree grew further after that snapshot was first written (see Contradiction #4). No earlier candidate baseline exists: reflog, refs, and mtimes agree on `9219de7`.

### Activity timeline from mtimes and live processes (local time)

- Aug 15 <=22:58 — last touch of `sites.json`, `trainingData.json`, `bouncer_model.pkl` (pre-work; untouched since)
- Aug 22 19:53–23:03 — `package.json`, `requirements.txt`, `main.py`, `.env.example`, backend module creation; `SKILL.md` (21:03) and root `AGENTS.md` (21:10) written
- Aug 23 16:27 — `.env.example` re-edited (`INTERNAL_EDITOR_KEY`); 16:32 — `.env` scaffolded (gitignored; contents deliberately not read)
- Aug 23 17:38 — Vite dev server started (PID 8264, still running)
- Aug 23 18:37 — Uvicorn on **:8123** started detached (PID 10574, still running); unified history dir written
- Aug 23 19:09 — `scheduler_state.json` written (a scheduler cycle ran today)
- Aug 23 19:21 — second Uvicorn on **:8000** started (PID 12564, still running)
- Aug 23 19:27–19:38 — SavedScreen/SamsungInternalScreen/App.jsx edited; internal-content runtime JSON written 19:37–19:38
- Aug 23 19:40 — roadmap reference document last updated

## 3. Change classification

**A. Commits created during this work: NONE.** Reflog proves zero commits after Aug 16.

**B. Modified tracked files (uncommitted) — 18 files**, `git diff --stat`: 1,113 insertions / 160 deletions:

```
legacy_app/.env.example                                   (+4)
legacy_app/main.py                                        (+3)
legacy_app/news-ui/package.json                           (+2)
legacy_app/news-ui/package-lock.json                      (+496)
legacy_app/news-ui/src/main.jsx                           (~27)
legacy_app/news-ui/src/news-scrapper/App.jsx              (+9)
legacy_app/news-ui/src/news-scrapper/api.js               (+154)
legacy_app/news-ui/src/news-scrapper/components/Icon.jsx  (+4)
legacy_app/news-ui/src/news-scrapper/components/TopBar.jsx(+22)
legacy_app/news-ui/src/news-scrapper/screens/SavedScreen.jsx    (~+212/-60)
legacy_app/news-ui/src/news-scrapper/screens/SelectedScreen.jsx (+36)
legacy_app/news-ui/src/news-scrapper/styles/personal-desk-redesign.css (+1/-1)
legacy_app/news-ui/src/venture-lens/VentureLensApp.jsx    (~72)
legacy_app/news-ui/src/venture-lens/venture-lens.css      (+141/-18)
legacy_app/news-ui/tests/guide-pet.test.js                (+9/-5)
legacy_app/news-ui/tests/navigation-style.test.js         (+8/-6)
legacy_app/news-ui/vite.config.js                         (+1)
legacy_app/requirements.txt                               (+2)
legacy_app/tests/asgi_harness.py                          (+9/-3)
```

**C. New untracked files — 38 total (~9,650 lines):**

- Root handoff: `AGENTS.md`, `.opencode/skills/sense-project-memory/` (6 files)
- Backend feature: `news_scrapper/internal_content/{__init__,document_parser,image_processor,router,schemas,service,storage}.py` (~1,247 lines)
- Backend tests: `tests/test_internal_content.py` (786 lines)
- Frontend components: `ContributionReviewDesk.jsx`, `NotificationBell.jsx`, `personal-desk/{ContributionEditor,ContributionPreview,ContributionWorkspace,CoverImageInput,LeadershipCarouselPreview,useContributions}`
- Frontend models/parsers: `internal/{contributionModel,documentImport,documentParser,samsungInternalModel}.js`
- Screens: `InternalPublishingScreen.jsx`, `ResearchScreen.jsx`, `SamsungInternalScreen.jsx`
- Styles: `contribution-workspace.css`, `desk-study.css`, `internal-publishing.css`, `notifications.css`, `review-contributions.css`, `samsung-internal.css`, `sense-expansion.css`
- Frontend tests: `contributions.test.js`, `document-import.test.js`, `research-expansion.test.js`, `samsung-internal.test.js`

**D. Deleted/renamed tracked files: NONE** (`git status` shows no D/R entries). Two *untracked* files were created and later deleted during the sessions (so they never appear in git): `samsung-internal-shell.css` and `internalContentStore.js` — confirmed absent on disk; lifecycle documented in the roadmap and consistent with current imports.

**E. Generated/ignored/runtime changes:**

- `news-ui/node_modules/` grew by the `mammoth` + `pdfjs-dist` trees (~63 lockfile packages) — ignored
- `news-ui/dist/` build output exists — ignored
- `.env` created from template (Aug 23 16:32) — ignored, contents not read
- Runtime data changed today: `runtime/internal_content/{contributions.json,.bak,covers/,originals/}`, `runtime/internal_notifications.json(.bak)` (19:37–19:38), `scheduler_state.json` (19:09), unified history (18:37). All inside `news_scrapper/runtime/` — properly gitignored
- `__pycache__` inside new source dir — ignored via `legacy_app/.gitignore:5`

**F. Changes outside `legacy_app/`:** only the handoff pair `AGENTS.md` + `.opencode/skills/sense-project-memory/` (untracked documentation, intentional). No code changes in the superseded root `app/`, `backend/`, etc.

**G. Authorship-unprovable changes:** none identified — every change is either documented in the roadmap handoff or consistent with it. Honest limit: because everything is uncommitted, the specific session that produced each hunk cannot be proven beyond what mtimes/roadmap show.

## 4. What each change does (with intent, per roadmap narrative)

### Backend

| File | State | Behavior change | Risk assessment |
|---|---|---|---|
| `main.py` | modified | Includes `internal_content.router`; adds `"internal-content"` to `API_ROUTES` so API misses return real 404s, not SPA HTML | Low. Composition-root role preserved; single router addition |
| `.env.example` | modified | Documents `INTERNAL_EDITOR_KEY` with placeholder value only | None. No secrets |
| `requirements.txt` | modified | Adds `pypdf>=4,<7` (backend PDF extraction), `python-multipart>=0.0.9,<1` (uploads) | Low; Windows portable envs need reinstall |
| `tests/asgi_harness.py` | modified | Harness accepts raw bodies (multipart) in addition to JSON | Test-only |
| `internal_content/storage.py` | new | UUID-named files under `NEWS_RUNTIME_DIR/internal_content/`, atomic `JsonStore` writes, `threading.RLock`, 50-entry notification cap | Consistent with storage conventions |
| `internal_content/service.py` | new | Ownership-scoped drafts; status machine draft/ready -> submitted -> published / needs_changes (author-editable, resubmit); archived on reject; announcements exempt from cover requirement; publishing a leadership message archives prior published visions | Coherent; all writes under lock |
| `internal_content/router.py` | new | `/internal-content/*` routes; editor gate = `x-editor-key` header OR HttpOnly cookie holding SHA-256 key digest; static routes declared before `/{record_id}` (correct FastAPI ordering); media visibility owner/editor/public-after-publish | See security notes below |
| `internal_content/document_parser.py`, `image_processor.py`, `schemas.py` | new | pypdf/python-docx extraction, Pillow cover normalization, Pydantic payloads | Local-only |
| `tests/test_internal_content.py` | new | 786-line unittest suite using mocked ASGI harness, offline fixtures | Offline-safe |

**Security observations (router):**

- Cookie is HttpOnly/SameSite=strict/path-scoped but has **no `secure` flag** and stores a *static* SHA-256 digest of the expected key — i.e., a bearer token valid until key rotation, with no server-side revocation. Acceptable pilot trade-off; needs an explicit decision before production.
- `_editor_key_expected()` reads `os.environ` directly instead of `core.settings` — works only because dotenv loads `.env` into environ at startup. Style inconsistency, not a found bug.
- No `verify=False`, no TLS weakening anywhere in active code (grepped).

### Frontend

| File | Behavior change | Risk |
|---|---|---|
| `main.jsx` | Venture Lens standalone boot path removed; single shared shell always loads (incl. `venture-lens.css`) | Architectural pivot: VL no longer boots as a separate app |
| `App.jsx` | Adds routes `/research`, `/samsung-internal`, `/internal-publishing`, `/venturelens/*`, plus **BOTH `/saved` AND `/saved/*`** | See Contradiction #1 |
| `TopBar.jsx` | Review Queue/Approved moved into Settings; Research + Samsung Internal added to primary nav; `NotificationBell` mounted; venture card -> NavLink `/research`; new local `routeMatches()` helper (self-contained, line 192) | Nav IA change as designed |
| `api.js` | +154 lines: same-origin relative-path wrappers for `/internal-content/*` (drafts, submit, publish, review unlock/lock, notifications, cover/document URLs with cache-busting) | Same-origin preserved; `uploadFetch` correctly omits manual Content-Type |
| `SavedScreen.jsx` | Full desk hero rewrite ("Private Study": typewriter greeting reduced-motion aware, status line derived from live data, counters-as-buttons, 3 tabs with URL sync `/saved/contribute|briefings|leadership`, ContributionWorkspace tab) | Large rewrite; test-pinned contracts claimed preserved |
| `SelectedScreen.jsx` | News signals vs Contributions tabs; view persisted in sessionStorage; news UI wrapped in conditional fragment | Cosmetic defect: wrapped fragment keeps old indentation so the diff looks mis-nested. Functionally fine. Low |
| `VentureLensApp.jsx` | Own topbar removed (brand, language toggle, guide trigger, NewsScrapper link) — shared shell supplies these; replaced by compact research shell head | Intended pivot. Possible leftover unused imports (`Newspaper`, `Sparkles`, `X`) — harmless, unverified |
| `venture-lens.css` | Removed Google Fonts CDN `@import` and the global `:root { color-scheme: dark }` hijack that only made sense standalone; scoped under `.venture-lens`; full light-theme token set; sticky sub-head at `top:86px`; responsive breakpoints | Positive. Sticky offset assumes TopBar height — unverified at narrow widths |
| `personal-desk-redesign.css` | Tabs grid 2 -> 3 columns | Matches third desk tab |
| `guide-pet.test.js`, `navigation-style.test.js` | Rewritten to pin the shared-shell VL contract (old assertions pinned the standalone topbar and would fail) | Required consequence of the pivot |
| `package.json` | Adds `mammoth ^1.12.1`, `pdfjs-dist ^5.4.624` | See Contradiction #3 — largely serving dead code |

## 5. Completeness status per changed area

| Area | Status | Evidence |
|---|---|---|
| `internal_content` backend | Complete, self-consistent, offline-tested | 786-line suite exists using mocked ASGI harness; roadmap claims 26/26 pass |
| Announcement desk (`/internal-publishing`) | Code-complete; end-to-end draft->submit->publish smoke claimed on :8123 | Roadmap; runtime `contributions.json` written 19:37 today proves live exercising |
| Samsung Internal rebuild | Code-complete; browser QA explicitly outstanding | Roadmap "Next steps queued": QA in both themes/narrow width not done |
| Personal Desk hero rewrite | Code-complete; browser QA outstanding | Same roadmap admission |
| Review desk + NotificationBell | Code-complete; hook-order fix verified present in live code (hooks lines 62-102 precede gate at line 170); browser QA outstanding | Direct code inspection + roadmap |
| Venture Lens shell integration | Complete in code; tests rewritten to pin it; visual QA status unknown | Diffs + roadmap silence on VL QA after pivot |
| `documentImport.js` browser extraction | Partial/abandoned-in-place: full pipeline retained but zero callers except `formatFileSize` | Grep: `extractEditorialDocument`/`prepareCoverImage`/`validateEditorialFile` imported nowhere |
| App.jsx `/saved` routing | Uncertain — contradicts the roadmap's own claimed revert | Live lines 389-390 |

## 6. Non-negotiable contract audit

| Contract | Verdict | Evidence |
|---|---|---|
| All work inside `legacy_app` | PASS | Only `AGENTS.md` + `.opencode/` (intentional handoff docs) exist outside; superseded root trees untouched |
| `main.py` sole composition root | PASS | One router include + one API_ROUTES entry; SPA-serving imports intact |
| `news-ui` sole active frontend | PASS (strengthened) | VL standalone boot path deleted; everything renders in one shell |
| One unified `sites.json` | PASS | `news_scrapper/config/sites.json` mtime 2026-08-15 22:49 — untouched |
| One four-hour scheduler cycle | CODE PASS / LIVE STATE FAIL | Scheduler code untouched; but two Uvicorn instances currently share the same runtime dir, each registering its own APScheduler job (see #7/#12) |
| One authoritative training stream/Bouncer | PASS | `trainingData.json` (08-15), `bouncer_model.pkl` (08-15) untouched; no changes to `train_bouncer.py` or application.py |
| Broadcast = vertical/filter, not IP profile | PASS | No profile-routing code touched; no legacy profile overrides resurrected |
| Briefing deterministic shared baseline | PASS | FeedScreen/HomeScreen untouched |
| For You private default landing | PASS | ForYouScreen untouched; desk fineprint keeps pause/tune semantics |
| Saved/Hide/preferences/private briefings viewer-specific | PASS | New feature scopes every record by `resolve_viewer` signed cookie; notifications keyed by hashed owner |
| Not Interested = shared Bouncer action | PASS (untouched) | Roadmap notes a stale pre-existing test about restore-atomicity — flagged, not caused by this work |
| Same-origin API calls | PASS | All new wrappers use relative paths; Vite proxy + main.py API_ROUTES extended in tandem; grep found no IPs/hostnames in new frontend code |
| Exactly one Uvicorn worker (production) | CODE PASS / LIVE VIOLATION IN DEV | Production launcher untouched; right now PIDs 10574 (:8123) + 12564 (:8000) run the same app from the same cwd — process-local locks are useless across them |
| Frontend dev from `legacy_app/news-ui` | PASS | Running Vite launched from that directory with `--host 127.0.0.1` |
| Production serves `frontend/dist` | PASS | `abs_frontend_path`/dist logic untouched; `resolve_frontend_dist()` untouched |
| Samsung Web Search/Chat fallbacks intact | PASS | No diffs under `adapters/`, `core/rate_limit.py`, application pipeline |
| MiniLM/BART/FLAN/sentiment/translation paths | PASS | `semantic_clustering.py`, `translation.py`, model settings untouched |
| TLS verification not disabled | PASS | grep `verify=False` across active + new backend: zero hits |
| `sites.json` not regenerated | PASS | mtime evidence above |
| Runtime JSON/pickles not relocated | PASS | Writes confined to established stores plus one new documented store `runtime/internal_content/` (the feature's designed home, gitignored) |
| No secrets/user data/model weights committed | PASS | Nothing was committed; `.env` ignored (verified via `git check-ignore`) and deliberately not read; `.env.example` carries placeholders only |
| New routes don't conflict | PASS | `/internal-content` prefix unique; FastAPI static-before-param declaration order correct; frontend routes distinct; deep-link 200 smoke claimed on :8123 |
| Superseded root app not treated as active | PASS | Zero modifications there |

## 7. Command history — honest accounting

The exact command history of yesterday's/today's earlier sessions is unknown to the auditor. The auditor had no access to those transcripts and did not invent them. What the repository proves about those sessions:

- Dependency installation occurred (`package-lock.json` +63 resolved entries; node_modules present)
- Dev/probe servers were started: Vite 17:38, Uvicorn :8123 18:37 (detached), Uvicorn :8000 19:21
- Servers exercised the feature: `runtime/internal_content/contributions.json` etc. written 19:37–19:38; scheduler cycle wrote `scheduler_state.json` 19:09; unified history 18:37
- A `.env` was scaffolded 16:32 (contents intentionally unread)
- Builds/tests were claimed repeatedly in the roadmap doc (see section 8) — the exact commands producing them are unknown
- Files created then deleted (`samsung-internal-shell.css`, `internalContentStore.js`) prove intermediate iterations existed

Commands executed during the audit session itself (all read-only):

- succeeded: git remote/config/rev-parse/branch/log/reflog/status/diff(--stat, per-file)/check-ignore/ls-files; file reads; content searches; stat across ~20 paths; ls/wc/head/sed; lsof (ports, cwd); ps
- failed harmlessly: three `rg` invocations (rg not installed — fell back to grep tooling); one `head` with wrong-cwd paths (rerun correctly)
- unverified-result: none — every command's output was read and cited above
- state-changing: none

## 8. Testing — truthful accounting

Tests run during the audit: none (forbidden by the requester).

- Cannot vouch: every test/build number ("backend green except stale `test_not_interested_atomicity.test_restore_commits_store_and_shared_briefing_together`", frontend 57->58->59->70->71->73->75/75, "build OK" x5, unlock-401 flow, announcement E2E) comes solely from the roadmap handoff document. These are claims, consistent with each other and with runtime artifacts, but not independently reproducible during the audit.
- Critical timing fact: the last code edits landed 19:27–19:38 (SavedScreen 19:27, SamsungInternalScreen 19:28, App.jsx 19:37) and the roadmap was updated 19:40. The roadmap's final "Verified: frontend 75/75 + production build OK" narratively precedes the routing-revert section it closes with. It cannot be proven that the exact current tree ever passed a build or test run. This is the single largest verification gap.
- Features claimed without validation, by the project's own admission: browser QA of Samsung Internal page, desk hero, review desk, and bell — in either theme, at any width — is listed as outstanding in "Next steps queued". Any claim those surfaces are visually verified would be false.
- Tests that could pass while production misbehaves: plausible candidates: (a) the dual `/saved` route arrangement — a source-contract test asserting the splat exists would not catch the duplicate sibling nor any remount behavior; (b) anything depending on Windows font metrics/wrapping (unit tests cannot see it); (c) bundle-size/chunk regressions from the dead lazy imports — only `npm run build` could catch those.

## 9. Contradiction table

| # | Area | Intended architecture (docs/claims) | Current implementation (live) | Conflict | Evidence | Severity |
|---|---|---|---|---|---|---|
| 1 | Desk routing | "App.jsx uses ONE splat route `/saved/*`" (roadmap revert section) | Lines 389–390 contain BOTH `/saved` and `/saved/*` rendering SavedScreen | Documented fix absent from code; possible re-introduction of the remount-on-tab-click bug the revert claimed to kill | `App.jsx:389-390` vs `current-state-and-roadmap.md` revert section | Medium-High (UX regression, unverified at runtime) |
| 2 | Single-writer runtime | "one worker... locks are process-local" | Two Uvicorn processes (18:37, 19:21) on same cwd/runtime dir, both schedulers armed | Cross-process atomic-write races possible on contributions.json/trainingData/etc.; double crawl risk | `lsof -p 10574,12564` cwd identical; scheduler_state 19:09 | High (live operational hazard, not a code defect) |
| 3 | Document import | "browser-local prototype stripped... backend owns parsing" | `documentImport.js` still ships a complete pdfjs+mammoth browser pipeline; `mammoth`+`pdfjs-dist` added as dependencies; zero callers | Duplicate parallel implementation; dead chunk weight; dependency surface for unused code | grep results; `documentImport.js:54-100` | Medium |
| 4 | Handoff accuracy | Roadmap's snapshot lists exactly which files were dirty | Today's dirty set is a strict superset (api.js, SelectedScreen, vite.config, requirements, asgi_harness, .env.example, main.py missing from snapshot list) | Documentation drift; snapshot not updated when later sessions expanded scope | Compare snapshot lists vs `git status` | Low |
| 5 | Internal Publishing description | `product-and-design-decisions.md` still calls Create/Leadership/Library tabs + local PDF/DOCX parsing "the current design baseline... do not reduce it to a plain upload form" | Reality: announcement-only desk, server persistence, client parsing gutted | Two reference documents describe two generations of the feature; a future agent following the older one will fight the newer code | `product-and-design-decisions.md` "Current expansion surfaces" vs live screen | Medium (future-agent trap) |
| 6 | Editor session security | Charter: privileged actions protected, secrets never exposed in browser | Cookie value = static SHA-256(key) — deterministic, non-expiring server-side, no revocation, no `secure` flag | Acceptable pilot trade-off but weaker than it reads; digest is a permanent bearer token per deployment | `router.py:45-63,132-145` | Low-Medium (pre-production) |
| 7 | Icon.jsx hygiene | Clean diffs | `history:` line re-added with extra leading-space indentation churn alongside the real `megaphone` addition | Pure noise; signals rushed edits | diff hunk | Trivial |

## 10. Changed-file table

Git state legend: **M** = modified tracked, uncommitted; **U** = untracked new; **—** = untracked created then deleted (no git trace).

| File | State | Purpose of change | Risk | Verdict | Evidence |
|---|---|---|---|---|---|
| `legacy_app/main.py` | M | Wire internal_content router + API 404 route entry | Low | KEEP | diff; composition root intact |
| `legacy_app/.env.example` | M | Document INTERNAL_EDITOR_KEY (placeholder only) | None | KEEP | diff |
| `legacy_app/requirements.txt` | M | pypdf + python-multipart for backend parsing/uploads | Low | KEEP | diff; portable envs need reinstall |
| `legacy_app/tests/asgi_harness.py` | M | Raw/multipart body support in test harness | None | KEEP | diff |
| `news_scrapper/internal_content/*` (7 files) | U | Full internal-contributions backend | Low-Med (editor-cookie design note) | KEEP | read in full; offline suite exists |
| `tests/test_internal_content.py` | U | Regression suite for above | None | KEEP | imports inspected; mocked harness |
| `news-ui/src/news-scrapper/api.js` | M | Same-origin `/internal-content` client wrappers | Low | KEEP | diff; relative paths verified |
| `news-ui/vite.config.js` | M | Proxy `/internal-content` | Low | KEEP | diff; mirrors main.py |
| `internal/contributionModel.js`, `documentParser.js`, `samsungInternalModel.js` | U | Pure models/validation used by screens + tests | Low | KEEP | imports resolve from screens |
| `internal/documentImport.js` | U | Browser extraction pipeline — orphaned except `formatFileSize` | Med (dead code + dep weight) | REWORK: strip to helpers or delete after build check | grep: no callers of extractors |
| `package.json` / `package-lock.json` | M | Add mammoth + pdfjs-dist (~63 pkgs) | Med — only referenced by dead lazy imports today | REWORK: decide with previous row; never remove as incidental cleanup without a build | diff stats |
| `main.jsx` | M | Single shared shell; VL standalone boot removed | Med (architectural pivot, tests rewritten accordingly) | KEEP | diff + updated tests pin it |
| `App.jsx` | M | New routes; `/saved` + `/saved/*` duplication | Med-High | REWORK: reconcile to one splat route per recorded decision, then runtime-verify tab switches | live lines 389-390 vs roadmap |
| `TopBar.jsx` | M | Nav IA reshuffle + bell + NavLink venture card | Low | KEEP (browser QA pending) | diff; routeMatches self-contained |
| `Icon.jsx` | M | radar + megaphone icons (+ whitespace churn on history) | Trivial | KEEP; tidy whitespace later | diff |
| `SavedScreen.jsx` | M | Desk hero rewrite, 3 tabs, URL sync, contributions integration | Med (large rewrite, QA outstanding) | KEEP pending browser QA | diff; sessionStorage contracts preserved |
| `SelectedScreen.jsx` | M | Contributions tab with key-gated desk | Low | KEEP | diff; hook-order fix verified in desk component |
| `ContributionReviewDesk.jsx`, `NotificationBell.jsx`, `personal-desk/*` (6), screens x3, styles x7 | U | The feature surfaces themselves | Med collectively — none browser-QA'd | KEEP as a set; verify visually before any commit | files read/sampled; roadmap admits QA gap |
| `tests/guide-pet.test.js`, `navigation-style.test.js` | M | Re-pin contracts to shared shell | None | KEEP | diff |
| `tests/{contributions,document-import,research-expansion,samsung-internal}.test.js` | U | Pin new contracts | None | KEEP | present; counts unverified by auditor |
| `venture-lens.css` | M | De-CDN fonts, scope styles, light theme | Low (sticky offset assumption unverified) | KEEP | diff |
| `VentureLensApp.jsx` | M | Shed standalone chrome | Low | KEEP | diff |
| `.env` | — (ignored) | Scaffolded dev config | None if stays ignored | KEEP — do not touch | mtime; check-ignore |
| `AGENTS.md`, `.opencode/skills/...` | U | Agent handoff docs | None | KEEP (commit only when asked) | roadmap says same |
| `samsung-internal-shell.css`, `internalContentStore.js` | — | Superseded iterations, already gone | None | Nothing to do | absent on disk |

No file qualifies today as a clean REVERT CANDIDATE — nothing demonstrably broke a previously working committed feature; the two genuine problems (#1 routing duplicate, #2 dual servers) are corrections within the new work, not reasons to roll the tree back.

## 11. Recovery proposal (NOT EXECUTED)

### KEEP (safe as-is)

1. Entire `internal_content` backend + its test suite + `main.py` / `.env.example` / `requirements.txt` / harness wiring — smallest coherent unit, independently documented.
2. All same-origin frontend API wrappers + Vite proxy line.
3. Samsung Internal rebuild, desk rewrite, review desk, bell — keep, but treat as unverified visuals until QA.
4. Handoff docs (`AGENTS.md`, skill).
Safest method: leave untouched; when committing is authorized, stage these groups separately so history is reviewable.

### REWORK (intent sound, execution incomplete)

1. **App.jsx saved-routing** — remove exactly one of the two sibling routes (keep the single splat `/saved/*` per recorded decision), then manually click through `/saved <-> contribute <-> briefings` on :5173 checking for remount flashes before believing it fixed.
2. **Dead browser-extraction path** — either delete `extractEditorialDocument`/`extractPdf`/`extractDocx`/`prepareCoverImage`/`validateEditorialFile` from `documentImport.js` (keeping `formatFileSize`) AND drop mammoth/pdfjs-dist from package.json with a fresh `npm run build`; or consciously keep them for a planned client-side mode. One decision, recorded.
3. **Stale reference docs** — update `product-and-design-decisions.md`'s Internal Publishing section (and the snapshot lists in the roadmap) to describe the announcement-desk/server-backed reality, per the repo's own fix-stale-docs rule.
4. **Editor cookie hardening (pre-production)** — add a `secure` flag behind an HTTPS-aware setting; consider a random per-unlock session value instead of the static key digest; needs its own small test.
5. **Icon.jsx whitespace churn** — cosmetic; fold into next touch of that file.

### UNKNOWN (insufficient evidence; establish before any verdict)

1. Whether the current exact tree passes `npm test`, `npm run build`, and the backend suite — last claimed verification predates the final three code edits.
2. Actual remount behavior of the dual-route arrangement (React Router internals differ across minor versions; needs one runtime observation).
3. Windows/narrow-width rendering of every new surface (explicitly never done).

### Immediate operational correction (highest priority, zero code)

Stop one of the two running Uvicorn processes (:8123 started 18:37 is the leftover smoke-test server). Two writers share `runtime/` JSON with process-local locks right now. This is a single graceful stop of PID 10574 by the user — deliberately NOT performed during the audit.

## 12. Closing summary

- **Probable last known good commit:** `9219de7` (2026-08-16) — the only provable committed baseline; reflog shows nothing since.
- **Current HEAD:** `9219de7` on `codex/legacy-stabilization`, identical to `origin/main`.
- **Commits created during this work:** 0
- **Tracked files changed:** 18 (1,113+/160-)
- **Untracked files created:** 38 (~9,647 lines incl. handoff docs); plus ignored artifacts (.env, node_modules growth, dist, runtime stores)
- **Files deleted/renamed (tracked):** 0. Untracked-created-then-deleted during sessions: 2
- **Five highest-risk regressions:**
  1. Dual live Uvicorn processes sharing one runtime dir (active corruption/double-crawl hazard)
  2. Duplicated `/saved` routes contradicting the recorded fix; remount bug possibly resurrected
  3. Unverifiable claim that the final tree ever passed tests/build (edits landed after last recorded verification)
  4. Orphaned pdfjs/mammoth pipeline + dependency bloat inviting future-agent confusion
  5. Stale design references describing a superseded Internal Publishing generation
- **Secrets/exposure finding:** none. Nothing committed; `.env` ignored and unread; `.env.example` placeholders only; no tokens/IPs/user data in diffs reviewed. Residual risk: editor-session cookie design (static digest) noted as pre-production debt, not exposure.
- **Can the repository currently be built?** Unknown-but-plausible. All evidence (claimed builds, coherent imports, resolved dependency graph) suggests yes; proof is impossible without running `npm run build` + suites, which was forbidden during the audit.
- **Still undeterminable:** yesterday's exact command transcript; which session produced each hunk; real pass/fail counts; whether tab navigation currently remounts; visual correctness anywhere; contents/intent of `.env`; whether anything outside this machine was pushed (no push occurred locally per reflog).
- **Next read-only checks for another engineer:**
  1. Confirm/stop PID 10574 (:8123 leftover server).
  2. Run `npm test`, `npm run build`, and backend unittest discover — with owner authorization.
  3. Open `App.jsx:380-400` and decide the one-route question.
  4. Click-test `/saved` tabs on the running Vite instance for remount flashes.
  5. Re-review `git diff legacy_app/news-ui/src/main.jsx` against the Venture Lens standalone rollback expectation.
  6. Skim `test_internal_content.py` assertions vs router paths for drift.
  7. Decide the fate of `documentImport.js` and its two dependencies.
  8. Verify the remote has no unexpected commits (`git fetch`, then compare — network read-only).
