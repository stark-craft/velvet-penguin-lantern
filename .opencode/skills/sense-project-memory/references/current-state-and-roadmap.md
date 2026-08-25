# Current state and roadmap

Snapshot date: **2026-08-25**. Always verify this snapshot with `git status`,
`git log`, live code, and tests before acting.

## 2026-08-25: Samsung Internal, Research, and compact For You release

- `/samsung-internal` is now a premium command center: a fixed-zone five-slide
  Samsung Focus carousel, a thin animated notice ticker contained within the
  Samsung Intelligence Wire, its distinct bottom-to-top article stream, and
  three lower archive channels
  (Global, Local, Inside). Announcements have no competing page-wide rail and
  do not duplicate in the vertical article flow or lower tabs. The wire uses
  the exact 5/3/3 editorial interleave and skips unavailable channels honestly.
- Published-only reader routes now exist for leadership and announcements:
  `/samsung-internal/leadership/:id` and
  `/samsung-internal/announcement/:id`. They preserve Samsung Internal scroll
  context on return and expose complete published content through
  `GET /internal-content/published/{id}`.
- Samsung article arrays are normalized at their channel boundary. Canonical
  `top_image`, escaped external URLs, same-origin contribution covers, unsafe
  schemes, blocked images, and missing-image fallbacks are handled consistently.
- `/research` is now a Research Observatory gateway with a fixed-zone,
  kind-diverse featured carousel, type-aware Evidence Stream, and compact lanes
  for Papers, Repositories, Models, Datasets, Patents, and Technology Radar.
  Optional unavailable providers disappear rather than producing fake zero
  cards.
- `GET /venture-lens/discovery` aggregates independently cached GitHub, arXiv,
  OpenAlex, Hugging Face, optional EPO, and optional X providers. Provider TTLs,
  last-good stale recovery, stable-ID/DOI/title deduplication, metric snapshots,
  real momentum deltas, and starter-snapshot labelling are implemented.
- Venture Lens gained model, dataset, and patent workspaces and dossier APIs;
  model/dataset/patent dossiers do not expose unsupported watch actions.
- Released in commit `bd4aa55`. Verified after the final accessibility pass:
  frontend 87/87, backend 183/183, production build (1,906 modules), live
  light/dark and 700px QA, keyboard workspace navigation, no page overflow or
  broken Samsung images, and Vite/FastAPI production deep links.

## 2026-08-25: Compact For You feedback architecture

- The default For You workspace now uses a compact `Your Feed | Following |
  Create` command strip with a trailing `Tune interests` action. The oversized
  greeting, mix counter, explanation/refresh controls and duplicate desk chrome
  are removed so the five executive signals become the first desktop content.
- For You cards open from their surface, use one consistent Follow/Following
  vocabulary, omit redundant Open/Select/Why-this-story controls, and expose
  reversible per-viewer Like/Dislike reactions with aggregate counts. Reactions
  never remove a card. They affect private ranking immediately and enter shared
  Bouncer training only through an idempotent four-hour consensus batch (five
  unique votes and 70% agreement by default).
- Following is a private semantic story-thread workspace backed by MiniLM
  similarity, entity/topic overlap and recency. Create combines private URL
  briefings with the existing IP-authorized Samsung Internal contribution flow;
  old `/saved/*` and earlier `/for-you/*` desk links redirect to the new routes.
- Verified with frontend 90/90, backend 187/187, the production build (1,906
  modules), desktop light/dark browser QA, live reaction/following/create
  interactions, and Vite/FastAPI production deep links. Mobile QA was
  intentionally deferred at the user's request.

## 2026-08-24: For You and User's Desk merge

- `/for-you/*` is now the single private workspace shell. Its premium,
  keyboard-accessible command strip contains the viewer-named Desk, Saved
  Signals, IP-authorized Contributions, and Private Briefings. The current For
  You experience remains the default Desk view.
- Canonical routes are `/for-you`, `/for-you/saved`,
  `/for-you/contributions`, `/for-you/contributions/leadership`, and
  `/for-you/private-briefings`. Legacy `/saved/*` links redirect without moving
  or rewriting stored data. FastAPI serves production SPA deep links for the
  full `/for-you/*` route family.
- Contribution authoring is controlled by `CONTRIBUTIONS_ALLOWED_IPS` through
  `GET /internal-content/contribute-access`. The resolver ignores forwarded
  client headers unless the immediate peer is trusted. Every contributor-owned
  draft, import, submission, notification, and private-media operation repeats
  the IP check before the existing per-viewer ownership check.
- Published Samsung Internal records/media and editor-key review operations
  remain independent and available under their existing rules. Unauthorized
  clients do not render contribution navigation, notifications, or authoring
  actions and receive HTTP 403 if they bypass the UI.
- The workspace children are lazy-loaded, and Saved/Contributions/Private
  Briefings request only their own data. Backend jobs and server/browser drafts
  keep their existing stores and reconnect behavior.

## 2026-08-23 session additions (uncommitted)

- Personal Desk hero redesigned to "The Private Study": typewriter greeting,
  live status sentence, counters-as-doors, drawer tabs on a hairline, For You
  controls as fine print. New `news-ui/src/news-scrapper/styles/desk-study.css`;
  SavedScreen hero JSX replaced (test-pinned contracts preserved).
- Editorial review pipeline added for internal contributions
  (`internal_content/service.py`, `router.py`, `storage.py`):
  - statuses draft|ready → submitted → published | needs_changes → resubmit,
    or archived on reject; needs_changes is author-editable;
  - editor key guard `x-editor-key` using `INTERNAL_EDITOR_KEY`
    (falls back to GATEKEEPER_KEY); `.env.example` documents it;
  - `GET /internal-content/review` + publish/changes/reject routes;
  - covers/documents readable by owner, keyed editor, or anyone once published;
  - per-author notification inbox `runtime/internal_notifications.json`
    (capped at 50) with `/notifications` + `/notifications/read`.
- Review Queue screen gained News signals | Contributions tabs; contributions
  sit behind an in-session key gate (`ContributionReviewDesk.jsx`,
  `review-contributions.css`; view choice persisted in sessionStorage).
- `NotificationBell.jsx` + `notifications.css`: private bell in TopBar polling
  `/internal-content/notifications` every 30s, mark-read, deep links.
- Verified: backend suite green except pre-existing failure
  `test_not_interested_atomicity.test_restore_commits_store_and_shared_briefing_together`
  (stale test predating the per-viewer hide-store migration — fix separately).
  Frontend 57/57 + production build pass.

## 2026-08-23 later: Samsung Internal rebuilt (uncommitted)

- `/samsung-internal` fully redesigned per agreed IA:
  - Full-width hero carousel, same height contract as the Briefing row
    (`clamp(490px, 57vh, 630px)`), same cadence/controls/dots as
    `TopClusterCarousel`, reduced-motion aware. Leadership message is a pinned
    first slide ("From the MD's desk", bold serif title, quoted excerpt,
    portrait cover right; static = always slide 1). Remaining four slides are
    dynamic trending signals preferring Samsung-tagged coverage from the shared
    briefing, honest fallback to top signals when Samsung coverage is thin.
  - Four premium channel tabs: Samsung Global | Samsung Local | Inside Samsung
    (published colleague stories/document imports) | Announcements.
  - New pure model `internal/samsungInternalModel.js` (Samsung relevance,
    local/global scope heuristics, trending ranking, hero assembly, channel
    routing) with its own Node suite (`tests/samsung-internal.test.js`).
  - `samsung-internal.css` replaces the deleted holding-shell stylesheet;
    built on theme tokens; hero stays cinematic-dark in both themes like
    Briefing.
- Announcements channel added end-to-end: backend `content_type="announcement"`
  (accumulates; no leadership-style retirement), fourth Contribute path "Post
  an announcement" (`startAnnouncement`, megaphone icon), Review Queue groups
  Announcements separately, `fromBackendRecord` now carries `announcement`
  type and `publishedAt`.
- Clean-sweep test assertions updated (`research-expansion.test.js`);
  `samsung-internal-shell.css` deleted.
- Verified: frontend 70/70 + production build OK; backend suite green except
  the known pre-existing stale Not-Interested atomicity failure; live smoke
  test on port 8123 confirmed deep link 200, `/internal-content/published`
  returning real published records, published covers publicly readable.
- Fixed Review Queue crash ("Rendered fewer hooks than expected"):
  `ContributionReviewDesk.jsx` ran its `groups` useMemo below the
  `if (unlocked === false)` editor-gate early return, so mounting the
  Contributions tab while locked killed the whole `/selected` route.
  useMemo hoisted above the gate; source-contract regression test added
  (all hook calls must precede the gate). Frontend 71/71 + build re-verified.

## 2026-08-23 later: announcement studio consolidation

- `/internal-publishing` is now the **Announcement desk**: the premium
  Source → Shape → Preview studio was kept visually but stripped of its old
  browser-local prototype (localStorage `internalContentStore.js` deleted,
  leadership/library views and client-side PDF parsing removed). It authors
  announcements only, through the shared `/internal-content` API: create or
  update draft, optional cover upload, "Send for approval" routes through the
  Review Queue. Session recovery kept.
- Covers are now **optional for announcements** end to end:
  `service.submit_draft` only requires covers for non-announcement types;
  frontend `canSubmitContribution` mirrors this. Document imports accept a
  `content_type` form field, so PDF/DOCX memos can import straight into the
  announcement channel with provenance.
- Pipeline routing fixed: the Contribute desk's "Post an announcement" card
  navigates to `/internal-publishing`; Samsung Internal's announcements empty
  state posts there too, while story CTAs go to the Saved contribute desk;
  Settings nav renamed "Internal Publishing" → "Announcements".
- Verified: backend 26/26 internal_content + full suite green except the
  known stale Not-Interested atomicity error; live E2E confirmed announcement
  draft → submit without cover → editor publish → public feed. Frontend
  73/73 + production build OK.

## 2026-08-23 later: leadership rehearsal composer + desk URLs

- **LeadershipEditor** (`personal-desk/LeadershipEditor.jsx`): composing a
  leadership message now happens inside a live demo of the actual Samsung
  Internal hero slide (same `sni-*` markup, `sni-hero-demo` sizing). Headline,
  quoted line, attribution, category, portrait (with framing/focal picker)
  all edit in place inside the carousel; the full message textarea sits right
  below — no editor/preview mode switching. Same save/submit pipeline and
  cover gate as other contributions.
- Desk URLs are now deep-linkable: `/saved` (signals), `/saved/contribute`,
  `/saved/briefings`, `/saved/leadership` (opens contribute tab with the
  leadership composer auto-started). SavedScreen syncs tab ↔ URL via
  `tabFromPathname`/`deskPathFor`; sessionStorage tab memory kept. Settings
  nav gains "Contribute Desk"; Samsung Internal CTAs point to
  `/saved/contribute`.
- Fixed "This contribution type is not supported." on announcement submit:
  root cause was the long-running dev uvicorn on :8000 predating the
  announcement content type (no --reload); restarted it detached.
- Verified: frontend 75/75 + production build OK; backend internal_content
  suite OK.

## 2026-08-23 later: revert of the desk/leadership regression

The separate `/saved/contribute|briefings|leadership` Route entries remounted
SavedScreen on every tab click (blank desk, refetch flashes), and the
LeadershipEditor demo inherited the hero stage's `pointer-events: none`
(uneditable inputs). Reverted and corrected:

- App.jsx uses ONE splat route `/saved/*`; SavedScreen stays mounted across
  `/saved`, `/saved/contribute`, `/saved/briefings`, `/saved/leadership` —
  instant tab swaps with URL sync preserved.
- Leadership authoring reverted to the standard ContributionEditor Edit form.
  The carousel rehearsal now lives in Preview mode only:
  `LeadershipCarouselPreview.jsx` renders the exact `sni-hero-demo` slide with
  in-place editing (headline, quote, attribution, category, portrait +
  framing) wired to the same draft onChange. Demo CSS re-enables pointer
  events explicitly.
- Lesson recorded: never put interactive controls inside `.sni-hero-stage`
  without overriding its `pointer-events: none`; never model sibling routes
  that render the same screen for URL-only variation.
- Verified: frontend 75/75 + production build OK.

## Next steps queued

1. Browser QA of the new Samsung Internal page in both themes/narrow width;
   browser QA of desk hero + review desk + bell still outstanding.
2. Design pass on the three desk panels (Saved ledger, My Briefing concierge,
   Contribute writing desk) per agreed Concept A direction.
3. Fix or retire the stale Not-Interested restore atomicity test.

## 2026-08-23 later: clean sweep + leadership pipeline

- `/samsung-internal` gutted to an honest holding shell
  (`SamsungInternalScreen.jsx` + `samsung-internal-shell.css`); deleted
  `samsung-internal.css`; screen no longer imports `internalContentStore`
  (file remains for InternalPublishingScreen) or any sample/legacy data.
- Leadership authoring added as third Contribute path (`startLeadership`,
  contentType "leadership", default title "Vision of the quarter", category
  Leadership); reuses ContributionEditor + persistence/heal logic.
- Backend: CONTENT_TYPES gains "leadership"; DraftUpdate carries
  content_type; publish_record retires prior published visions.
- Review desk groups submissions: Leadership messages | Stories & documents.
- Tests updated to pin the new contracts: research-expansion clean-sweep
  assertions, contributions leadership-path test, internal_content 24/24
  (vision retirement + unknown type rejected). Frontend 59/59 + build OK.

## 2026-08-23 later: review-desk security + full-review modal

- Editor gate moved off sessionStorage to an HttpOnly `internal_editor_session`
  cookie (`POST /internal-content/review/unlock|lock`); cookie stores a SHA-256
  digest of the expected key, JS never sees it. Header path still honored.
  Frontend probes the session on mount; CoverImage now uses plain <img>.
- Full-review modal in ContributionReviewDesk: cover, title, lead, full body as
  plain-text paragraphs (never HTML), large change-request composer, approve/
  reject inside; focus trap via useModalFocus, Escape/overlay close, scroll
  lock. Card titles open it too.
- `.env` scaffolded from `.env.example` for macOS dev (keys=1357 CHANGE-ME;
  identity secrets intentionally commented to avoid orphaning viewer data).
- Verified live: unlock 200 → review 200 with cookie → anon 401.
  Suites: internal_content 22/22; frontend 58/58 + build OK.

## Repository state at handoff

- Remote: `origin = https://github.com/stark-craft/velvet-penguin-lantern.git`.
- Current local branch at snapshot: `codex/legacy-stabilization`.
- `origin/main` and local HEAD at snapshot: `9219de7` — `Unify intelligence
  pipeline and polish experience`.
- Git author configured as `stark-craft` with its GitHub noreply email.
- The working tree is deliberately dirty with an uncommitted Sense.AI expansion.
  Do not reset, clean, or overwrite it.

Modified files at the snapshot include:

```text
legacy_app/news-ui/package.json
legacy_app/news-ui/package-lock.json
legacy_app/news-ui/src/main.jsx
legacy_app/news-ui/src/news-scrapper/App.jsx
legacy_app/news-ui/src/news-scrapper/components/Icon.jsx
legacy_app/news-ui/src/news-scrapper/components/TopBar.jsx
legacy_app/news-ui/src/news-scrapper/screens/SavedScreen.jsx
legacy_app/news-ui/src/venture-lens/VentureLensApp.jsx
legacy_app/news-ui/src/venture-lens/venture-lens.css
legacy_app/news-ui/tests/guide-pet.test.js
legacy_app/news-ui/tests/navigation-style.test.js
```

New untracked expansion files at the snapshot include:

```text
legacy_app/news-ui/src/news-scrapper/internal/
legacy_app/news-ui/src/news-scrapper/screens/InternalPublishingScreen.jsx
legacy_app/news-ui/src/news-scrapper/screens/ResearchScreen.jsx
legacy_app/news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx
legacy_app/news-ui/src/news-scrapper/styles/internal-publishing.css
legacy_app/news-ui/src/news-scrapper/styles/sense-expansion.css
legacy_app/news-ui/tests/document-import.test.js
legacy_app/news-ui/tests/research-expansion.test.js
```

This skill and root `AGENTS.md` are additional handoff files created after that
snapshot. They should be included in the same eventual reviewed commit only when
the user asks to commit/push.

## Completed and validated foundation

The following architecture is already implemented and should be preserved:

- `legacy_app` is the active application.
- one `main.py` starts NewsScrapper, recommendation, translation, Venture Lens,
  and the production SPA;
- one Vite frontend contains all products and routes;
- built production and Vite development use same-origin APIs;
- source catalog contains both technology and broadcast sources;
- one unified scheduler run executes every four hours;
- one unified workflow/training stream and active Bouncer are used;
- rollback broadcast files remain preserved;
- scheduler coalescing/retry/durable diagnostics and rapid-vote training queue;
- Samsung Web Search/Chat preflight, exact-URL validation, caching, quotas and
  local failure modes;
- RSS and normal-website spider support;
- MiniLM clustering, BART/FLAN local fallback, structured lead-plus-bullets
  dossier contract, sentiment fallback and image metadata enrichment;
- For You default landing, Starter Mix/onboarding, browser-scoped identity,
  private ranking, reasons, diversity and saved-story updates;
- shared Briefing with vertical/keyword filters;
- private Saved, Hide and multiple-URL personal briefings;
- review/approval workflow, exports, Gatekeeper, VOC and analytics protections;
- 30-day ordinary retention with saved/workflow preservation;
- progressive private English/Korean translation with local Marian fallback;
- optional smooth route-aware Scout guide;
- portable Windows layout, embedded Python support and frontend dist detection.

The last frontend verification before this handoff reported **44 passing Node
tests** and a successful production Vite build. Re-run both; do not treat the
number as permanently current.

## Current uncommitted expansion

### Shared shell routes

The primary shell now exposes:

- Research at `/research`;
- Samsung Internal at `/samsung-internal`;
- Internal Publishing at `/internal-publishing` through Settings;
- Venture Lens pages under `/venturelens/*` without leaving the shell.

Review Queue and Approved Briefing were moved into Settings to keep the primary
navigation compact.

### Internal Publishing

The authoring workspace has been redesigned and implemented with:

- Create, Leadership and Library tabs;
- Source -> Shape -> Preview information architecture;
- local PDF text extraction through `pdfjs-dist`;
- local DOCX extraction through the Mammoth browser build;
- TXT/Markdown import;
- PNG/JPEG/WebP cover image preparation and compression;
- 25 MB document and 8 MB image limits;
- rejection of legacy `.doc`, Excel and unsupported formats;
- clear OCR guidance for image-only PDFs;
- title/summary suggestions from extracted copy;
- editable headline, executive summary, story and byline;
- live preview and publishing-readiness indicators;
- sessionStorage recovery while composing;
- localStorage library with draft/publish/edit/delete and leadership message;
- tests for document recognition, validation, extraction cleanup and routing.

Important limitation: this remains browser-local. It is not yet a shared HR or
server-side publishing system, and images/content are not synchronized between
employees. Designing a production backend, authorization model, storage limits,
malware/file validation, OCR service, and audit log is future work requiring an
explicit product decision.

### Research and Venture Lens

A new Research orientation screen and shared-shell integration exist. Venture
Lens has dedicated overview/repository/research/radar/compare/watchlist and
notification behavior, but the user has explicitly rejected the current visual
design. Preserve backend functionality while redesigning later.

### Samsung Internal

A functional first implementation exists with leadership, Samsung Now, Inside
Samsung and Across Samsung sections. The user has explicitly rejected its
visual design and wants it rebuilt to the quality/rhythm of Briefing.

## Next work order

Unless the user changes priority, continue in this order:

1. **Verify Internal Publishing to perfection**
   - run tests/build and browser QA in both themes;
   - validate PDF/DOCX/TXT/image imports with real fixtures;
   - verify autosave, clear, edit, publish and delete flows;
   - make the browser-local persistence limitation visible and honest;
   - do not add a backend implicitly.
2. **Redesign Samsung Internal**
   - first inspect Briefing and existing shared components;
   - preserve data adapters/content semantics;
   - redesign hero, leadership, external, internal and portal sections;
   - validate empty/loading/error states and both themes.
3. **Redesign Venture Lens**
   - preserve separate task-oriented pages and live provider behavior;
   - replace the rejected visual language;
   - verify real metrics, type-safe comparison and provider fallbacks.
4. **Only after explicit approval, productionize Internal Publishing**
   - backend persistence and access roles;
   - secure upload/content validation;
   - shared media/document storage;
   - audit/version history and publication workflow.

## Known debts and cautions

- Some older docs still describe Default/Broadcast as separate production
  profiles and may claim separate active Bouncer paths. That is obsolete under
  the current unified defaults. Update those documents when touching them.
- The root README still foregrounds an older top-level application structure.
  Do not let it redirect work away from `legacy_app`.
- JSON and scheduler locks are process-local; one worker remains mandatory.
- Runtime caches, models and user data are ignored by Git and therefore absent
  from a fresh clone. Deployment guides must remain explicit about copying or
  recreating them.
- `npm audit --omit=dev` previously reported moderate issues in the existing
  React Router chain. Do not perform a major dependency upgrade as incidental
  cleanup; assess and test it as its own task.
- Dynamic document parsers enlarge build chunks. Preserve lazy imports.
- Browser-native translation is progressive enhancement and may be unavailable
  on LAN HTTP; the local server model fallback must remain complete.
- Never present localStorage Internal Publishing data as organization-wide.

## Handoff prompt for a new OpenCode session

Use this exact prompt after opening the repository in OpenCode:

```text
Load the sense-project-memory skill and read every required first-session
reference before doing anything. Then inspect AGENTS.md, git status, the current
branch and the relevant live code/tests. Work only in legacy_app, preserve all
unrelated dirty changes, and tell me the verified current state plus the next
safe step. Do not edit, commit or push until I give you the next task.
```

For an agent that does not support skills, use:

```text
Read AGENTS.md and every Markdown file under
.opencode/skills/sense-project-memory/references/ in order. Treat them as the
project handoff, then verify all claims against git status and live code before
working. Work only in legacy_app and preserve unrelated changes.
```

## 2026-08-25 reaction and For You desktop pass

- For You, Briefing, Scan cards, and dossiers now share the same counted
  `Bouncer` reaction control and `/viewer/reactions` contract.
- A reaction is one reversible vote per viewer/article. Like and dislike never
  remove the story from any feed. Zero counts stay visually quiet.
- Mature multi-viewer consensus is processed once during the four-hour
  scheduler cycle. The default gate is five votes with a 70% winning ratio;
  one aggregate training row per article is written and one coalesced Bouncer
  retrain is queued. Per-click model training is intentionally forbidden.
- Shared removal is a separate `Remove globally` kill switch. The UI is exposed
  only to Gatekeeper-allowlisted IPs, and the POST endpoint enforces the same
  trusted-proxy-safe IP check server-side. It is not the dislike action.
- The For You desktop lead is a compact `Today's executive pulse`: one lead
  story plus four secondary stories in an asymmetric grid, with a progress
  ring, icon-only actions, a compact topic-aware workspace command rail, and
  downward-scroll auto-collapse.
- Following, Create, Private Briefing, and Contributions have explicit light
  theme contrast. The Following empty state owns its layout CSS so its lazy
  route cannot lose centering or spacing.
- The explicit product request for this pass was desktop QA only; no mobile
  acceptance claim was made.
- Reaction hydration now uses `POST /viewer/reactions/query` in bounded batches
  instead of silently querying only the first 100 visible records. The backend
  accepts canonical reaction IDs and legacy stable article references, mapping
  both aliases to one global article snapshot.
- Feed normalization preserves `article_id` and `article_key`. For You,
  Briefing, and Scan refresh visible reaction snapshots every 12 seconds and
  on focus/visibility return, so a vote from another viewer or route converges
  without a hard refresh.
- The For You rail was tightened into a premium translucent command surface.
  Executive secondary cards now pin a labelled Follow row above a separate
  Like/Dislike/Hide row with accessible tooltips. Create uses a distinct studio
  icon and opens directly into a compact Private Briefing/Contributions command
  bar rather than an oversized introduction.
- Verification for this follow-up: 91 frontend tests, 189 backend tests, the
  production frontend build, and desktop browser QA on For You and Create in
  both light and dark themes. Mobile QA was intentionally omitted per the
  explicit user instruction for this pass.
