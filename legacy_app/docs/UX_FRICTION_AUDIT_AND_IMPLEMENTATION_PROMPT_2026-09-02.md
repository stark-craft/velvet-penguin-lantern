# Sense.AI / TechScout UX Friction Audit

**Audit date:** 2 September 2026
**Audited baseline:** `04725760eef04c4d969ced48e4abdab0f1fb4303`
**Active product:** `legacy_app/` only
**Target:** desktop web application; mobile-specific redesign is intentionally out of scope

Unless a path starts with `legacy_app/`, source paths in this report are relative to `legacy_app/`.

## Executive summary

The application is visually coherent and its normal happy paths are substantially covered, but the audit found several cases where the interface tells the user something untrue, loses context, or exposes an action that does not complete. The most urgent risks are:

1. the last part of a Contribution draft can be lost during fast navigation;
2. Briefing reaction totals can remain stale while two windows stay open;
3. Research technology signals navigate without opening the selected signal;
4. a failure loading published Samsung content is shown as genuinely empty content;
5. announcement removal is unavailable for most of a long marquee cycle on large displays;
6. an application chunk/import failure can leave a completely blank page;
7. a temporary capability-service outage is presented as genuine access denial;
8. fetches have no deadline, so a hung request can leave a workspace loading forever.

These are product trust issues, not subjective styling preferences. The recommended implementation order is P1 first, then truthful loading/error states and navigation recovery, then accessibility and polish.

## Remediation status — 2 September 2026

The current working tree now contains remediations for **UX-01 through UX-34**, implemented in priority order. Verification after the final P3 changes completed successfully:

- 109 frontend tests passed, including new timeout, local-date, carousel-reset, route-state, modal-isolation, tab-semantics, theme-boot, and contrast contracts;
- 210 backend tests passed;
- the production Vite build passed;
- desktop browser QA passed in light and dark themes for For You, Briefing, Scan, Briefing Archive, Research, Venture Lens, and Samsung Internal;
- each tested route exposed one `main` landmark, no horizontal page overflow, and no visible error alert;
- Briefing, Research, and Samsung Internal carousels advanced in the running application;
- Scan hydrated and then allowed clearing a `?q=` deep link; and
- a Samsung Internal leadership reader returned to its originating Inside Samsung channel.

Mobile-specific QA remains intentionally out of scope for this audit. This status describes the local working tree; publishing is a separate explicit operation.

## Audit method and confidence

The audit combined:

- direct inspection of the active React and CSS implementation in `legacy_app/news-ui/`;
- comparison of related implementations that should share the same behavior;
- representative desktop browser checks in the running application;
- review of loading, partial-failure, navigation, keyboard, timer, and large-display paths;
- verification against the current project rules and published baseline.

Two defects were reproduced directly in the browser:

- selecting the Research technology signal `AI agents` navigated to `/venturelens/radar?signal=ai-agents`, but no dossier opened;
- opening `/scan?q=Samsung` displayed an empty query and a disabled Search button.

The baseline already contains the Windows/reduced-motion overrides that keep the three live streams and the announcement marquee moving. Do not undo those fixes while addressing this report.

## Priority definitions

- **P1:** likely data loss, a broken primary action, materially false shared state, or a control that is effectively unavailable.
- **P2:** significant confusion, loss of context, false empty/error state, or a workflow interruption with a practical workaround.
- **P3:** accessibility, consistency, or resilience debt that should be fixed after the P1/P2 work.

| Priority | Count | Finding IDs |
| --- | ---: | --- |
| P1 | 8 | UX-01–UX-05, UX-27–UX-29 |
| P2 | 23 | UX-06–UX-24, UX-30–UX-33 |
| P3 | 3 | UX-25, UX-26, UX-34 |

## Findings

### UX-01 — Contribution draft tail can be lost on fast navigation

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/components/personal-desk/ContributionWorkspace.jsx:97-118`; trust copy in `news-ui/src/news-scrapper/components/personal-desk/ContributionEditor.jsx:166-176`.

The editor waits about 400 ms before persisting. Its cleanup clears that timer when the component unmounts, but does not flush the latest draft. Typing and immediately changing a global route can therefore discard the final characters or a brand-new draft. The editor also describes the draft as browser-only even though later code persists it through the backend.

**Required change**

- Keep the latest draft in a ref.
- Flush it on route unmount and `pagehide`; do not depend only on the delayed callback.
- Clear local recovery data only after a confirmed submit or explicit discard.
- Make the storage/privacy copy match the real persistence behavior.

**Acceptance checks**

- With fake timers, type and unmount before 400 ms; the exact final value must be recoverable.
- Submit and discard must still clear the correct recovery state.
- A route navigation test must preserve the last keystroke.

### UX-02 — Briefing reaction counts can stay stale indefinitely

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/FeedScreen.jsx:624-656`; compare the 12-second refresh in `news-ui/src/news-scrapper/for-you/ForYouScreen.jsx:95-129`.

Briefing refreshes reaction totals only after focus or visibility changes. If two users keep the Briefing open in foreground windows, a reaction in one window never reaches the other. This violates the application-wide contract that one article has one shared total everywhere.

**Required change**

- Create one reusable reaction synchronization layer for every article surface.
- Prefer server events or WebSocket if the backend already supports it; otherwise use one bounded 12–30 second batched poll.
- Pause polling while the document is hidden.
- Update cards and an open article modal atomically from the same snapshot.
- Avoid one request per card.

**Acceptance checks**

- A two-client integration test must show a reaction made in client A in client B without a focus change.
- A fake-timer test must prove one batch request per interval and cleanup on unmount.
- For You and Briefing must render the same totals for the same article key.

### UX-03 — Research technology signals do not open the selected intelligence

**Priority:** P1 · **Confidence:** high; reproduced in browser
**Evidence:** `news-ui/src/news-scrapper/screens/ResearchScreen.jsx:44,69,80`; `news-ui/src/venture-lens/VentureLensApp.jsx:263-270`.

Research sends every artifact target to React Router. An external technology URL is therefore unsafe as an SPA target. The internal fallback uses `?signal=…`, while Venture Lens reads only `?focus=…` and does not map the radar page to the `technology` dossier type. The URL changes, but the selected signal is not opened.

**Required change**

- Route the primary Inspect action to `/venturelens/radar?focus=<encoded-id>`.
- Add `radar: 'technology'` to the focus-kind mapping.
- Use a separately labelled `Open original source` link for external URLs, opened with `noopener,noreferrer`.
- Preserve browser Back behavior.

**Acceptance checks**

- Test technology artifacts with and without an external URL.
- Inspect must open the matching technology dossier in both cases.
- Back must return to the Research landing state.

### UX-04 — Published Samsung-content failure is presented as a real empty state

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx:261-270`, especially the swallowed published-content failure at line 266; misleading empty behavior near line 321.

If the public Samsung feed loads but the published internal-content endpoint fails, the failure is converted to an empty array. Announcements, leadership messages, and colleague stories disappear without an error or Retry. The page can then imply that no content exists.

**Required change**

- Track Samsung feed and published-content requests independently as `loading`, `ready`, `stale`, or `error`.
- Preserve successful data from either request.
- Show a non-blocking partial-error banner with a targeted Retry.
- Never render genuine-empty copy until the relevant request succeeds with an empty result.

**Acceptance checks**

- With `/samsung-feed` returning 200 and `/published` returning 500, public signals remain visible and a published-content warning appears.
- A successful retry restores announcements and Inside Samsung without remounting the route.

### UX-05 — Announcement removal is unavailable for most of the marquee cycle

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx:66-71,81-101`.

Large displays generate many announcement copies to fill the continuous marquee. Duplicates correctly remain inert, so only copy zero can expose Remove. With one announcement on a 4K display, most visible copies cannot be managed until the original returns.

**Required change**

- Keep marquee duplicates inert and non-focusable.
- Add a stable, non-moving `Manage announcements (N)` action outside the marquee.
- Open a compact list in which every authorized announcement can be archived immediately.
- Preserve the existing recoverable archive semantics.

**Acceptance checks**

- At 1920, 3840, and 7680 CSS pixels, every announcement is immediately removable from the stable control.
- Keyboard focus must never enter an `aria-hidden` marquee duplicate.

### UX-06 — Failed reaction loading is silently shown as a real zero

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/FeedScreen.jsx:587-591,629-646`; `news-ui/src/news-scrapper/components/Bouncer.jsx:6-9,24,37`.

When the reaction query fails, Briefing manufactures zero likes and zero dislikes and suppresses the error. A network failure is therefore indistinguishable from a genuinely unreacted article.

**Required change**

- Model reactions as `loading`, `ready`, `stale`, or `error`.
- Preserve inline or last-known values instead of replacing them with zero.
- Use an unobtrusive unavailable indicator/tooltip and a batched Retry.

**Acceptance checks**

- A mocked reaction failure must never claim a real zero.
- Recovery must replace the unavailable/last-known state without remounting the feed.

### UX-07 — Saved/following failure makes For You cards look unfollowed

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/for-you/ForYouScreen.jsx:31,68-88,352-355`; `news-ui/src/news-scrapper/for-you/ForYouCard.jsx:81`.

Feed, preferences, and followed-state requests share one loading path. If the feed succeeds but the followed-state request fails, the default empty key set makes every card render `Follow`, which is an incorrect actionable state.

**Required change**

- Load independent resources with `Promise.allSettled` or independent effects.
- Represent followed state as unknown until it is successfully loaded.
- Disable the action or show `Status unavailable · Retry` rather than an inverse action.

**Acceptance checks**

- A saved/following 500 must leave the feed readable without rendering false Follow states.
- Retrying must hydrate the existing cards without a full reload.

### UX-08 — Following failure also renders the true-empty state

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/for-you/FollowingScreen.jsx:15-29,55-57`.

On a failed request, the screen independently renders both its error and `No followed stories yet`. An outage therefore looks partly like the user deleted or never followed anything.

**Required change**

- Use a discriminated request state.
- Render empty copy only after a successful empty response.
- Preserve old threads as stale content during a retry.

**Acceptance checks**

- Initial failure shows only Error + Retry.
- A successful empty response shows only the empty-account guidance.

### UX-09 — Private Briefing failures leak into Contributions

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/SavedScreen.jsx:181-182,269-281,381-429,627-628`; `news-ui/src/news-scrapper/for-you/CreateScreen.jsx:17-21`.

Private Briefing and Contributions share a mounted workspace and shared feedback. A URL briefing failure can remain visible after the user moves to Contributions. Its `Retry desk data` action reloads data rather than retrying the failed submission.

**Required change**

- Scope feedback by view and operation.
- Ignore late results after leaving the originating view.
- Give each error a truthful recovery action: retry the operation or focus the relevant input.

**Acceptance checks**

- Switching views must never show the other view's feedback.
- A submit failure Retry must retry submission or return focus to the URL input.

### UX-10 — Blank Contribution editor announces an error before submission

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/components/personal-desk/ContributionEditor.jsx:29,36-43,155-163`.

A new blank draft immediately renders its unmet requirements inside an assertive `role="alert"`. The screen looks invalid before the user has acted, and assistive technology is interrupted as soon as the editor opens.

**Required change**

- Keep neutral requirements visible before interaction.
- Introduce `attemptedSubmit`/touched state.
- Use the alert only after an invalid submit, and clear/update it as fields become valid.

**Acceptance checks**

- No alert exists on a fresh editor.
- Invalid submit creates the alert; completing requirements removes it.

### UX-11 — PDF/DOCX progress claims unreachable stages

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/components/personal-desk/ContributionWorkspace.jsx:24-48,154-180`.

The UI defines Uploading, Extracting, Creating draft, and Ready, but the handler moves from steps 0/1 directly to 3 only after the request finishes. `Extracting` and `Ready` are effectively unreachable during real work, so a slow import appears frozen or misleading.

**Required change**

- If the backend exposes no progress, show one truthful indeterminate `Uploading and extracting` state, then `Creating draft`, then briefly `Ready`.
- Do not simulate percentages or stages the client cannot observe.

**Acceptance checks**

- A deliberately slow import promise must visit only truthful, reachable states.
- Failure must retain the selected file context and provide a useful retry.

### UX-12 — Returning from an Inside Samsung story loses channel context

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx:221-229,254`; `news-ui/src/news-scrapper/screens/SamsungInternalReaderScreen.jsx:22-41`.

Samsung Internal always initializes on Global. Story navigation does not carry a return channel, and the reader's Back action carries only `restore: true`. A user who opens an Inside Samsung story returns to Global, sometimes with a saved scroll position applied to the wrong panel. The reader also does not clear its prior record/error at the start of an `id` or `kind` change, so a bad record can poison a subsequent valid navigation.

**Required change**

- Make channel state URL-addressable, for example `?channel=inside`.
- Pass a validated return channel and scroll anchor to the reader.
- Clear `record` and `error` before each reader fetch.

**Acceptance checks**

- Inside → story → Back returns to Inside at the prior position.
- Bad ID → valid ID recovers without a route remount.

### UX-13 — Manual carousel selection can be replaced almost immediately

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/ResearchScreen.jsx:54-69`; `news-ui/src/news-scrapper/screens/SamsungInternalScreen.jsx:121-126,134,155-157,171-174`.

The automatic interval is not restarted by arrow or dot navigation. If the user selects a slide just before the interval fires, the selected slide can be replaced roughly half a second later.

**Required change**

- Replace the persistent interval with a resettable timeout keyed by the current index or an interaction token.
- Restart a full reading interval after any manual arrow/dot selection.
- Preserve pause, document visibility, and reduced-motion behavior.

**Acceptance checks**

- Fake-timer tests for arrow, dot, pause, hidden document, and reduced motion.
- A manual selection must remain for a full interval.

### UX-14 — Empty/partial Research data can reserve a giant blank hero

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/ResearchScreen.jsx:59,100`; `news-ui/src/news-scrapper/styles/research-observatory.css:2` and the stream implementation.

An empty featured list makes the observatory return `null`, but the fixed two-column primary row still reserves its large hero column. Evidence Stream also has no explicit empty state.

**Required change**

- Fall back from featured artifacts to stream artifacts when possible.
- Apply a one-column layout when one side is missing.
- Render a truthful no-evidence state when both are empty.

**Acceptance checks**

- Fixtures for featured-empty/stream-present, stream-empty/featured-present, and both-empty.
- Verify both themes at 1024, 1366, and 1920 desktop widths.

### UX-15 — Venture Lens hides usable discovery-only data behind a fatal error

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/venture-lens/VentureLensApp.jsx:250-258,342-343`.

The three workspace requests intentionally use `Promise.allSettled`, but fatal viability considers only overview and intelligence. If discovery succeeds while those two fail, Models, Datasets, or Patents data is hidden even though it is usable.

**Required change**

- Include discovery in the viable-data and fatal-error calculation.
- Render every successful lane plus the existing partial warning.
- Let Retry hydrate missing lanes without erasing successful data.

**Acceptance checks**

- A discovery-only fixture must render `/venturelens/models` and `/venturelens/datasets`.
- Retry can add overview/intelligence without remounting the route.

### UX-16 — Focused Venture Lens links cannot retry after a transient dossier failure

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/venture-lens/VentureLensApp.jsx:263-270,299-312`.

The focus key is marked handled before the dossier request succeeds. After one transient 500, refreshing workspace data or pressing the generic Retry does not reopen the focus URL.

**Required change**

- Mark a focus key handled only after success, or clear the latch on dossier failure.
- Keep the focus parameter in the URL.
- Offer a dossier-specific Retry.

**Acceptance checks**

- A fail-once/succeed-next test at `/venturelens/research?focus=<id>` must open the dossier on Retry.

### UX-17 — Fast dossier selection can show the wrong artifact

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/venture-lens/VentureLensApp.jsx:299-313`.

`openDossier` has no request identity or cancellation. If the user opens A and then B while A is slower, A may resolve last and replace B's dossier.

**Required change**

- Use an `AbortController` where supported, plus a monotonically increasing request token.
- Commit a result only if it belongs to the latest requested artifact.
- Keep the latest selection visible while older requests settle.

**Acceptance checks**

- Resolve A after B in a deterministic test; B must remain open.
- Unmounting must cancel or safely ignore the outstanding result.

### UX-18 — Venture Lens active workspace can begin offscreen

**Priority:** P2 · **Confidence:** medium-high
**Evidence:** `news-ui/src/venture-lens/VentureLensApp.jsx:353-360`; `news-ui/src/venture-lens/venture-lens.css:960-962,1421-1425`.

The workspace navigation is horizontally scrollable with hidden scrollbars. Direct-linking to a late item such as Briefs at a compact desktop width can leave the active item outside the initial visible area, with no edge affordance.

**Required change**

- Scroll the active button into view on path change.
- Add subtle edge fades and/or chevrons when more items exist.
- Preserve native keyboard and wheel/trackpad scrolling.

**Acceptance checks**

- Direct-link to first, middle, and last workspaces at 1024, 1195, 1366, and 1920 pixels.
- The active item must always be visible and expose `aria-current="page"`.

### UX-19 — Scan deep links ignore their query parameter

**Priority:** P2 · **Confidence:** high; reproduced in browser
**Evidence:** `news-ui/src/news-scrapper/screens/ScanScreen.jsx:542-546`; `news-ui/src/news-scrapper/App.jsx:159-172`.

Scan reads `initialQ`, but App supplies an empty string for the current query. Nullish coalescing treats that empty string as authoritative, so `/scan?q=Samsung` opens a blank form.

**Required change**

- Hydrate the URL query once when no scan has started and the stored query is empty.
- Do not use a plain `||` fallback that would reinsert the URL value after the user deliberately clears it.
- Decide and test how a later query-parameter change should behave.

**Acceptance checks**

- Fresh `/scan?q=Samsung` shows Samsung.
- Clearing the field keeps it cleared.
- An in-progress scan is not overwritten by navigation state.

### UX-20 — Scan feedback colors bypass the light-theme design system

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/ScanScreen.jsx:956-960`.

Success and error banners hard-code pale dark-theme Tailwind colors over translucent backgrounds. In light mode this can produce pale text on a pale surface rather than the semantic contrast used elsewhere.

**Required change**

- Replace the inline utility color recipe with `scan-action-feedback is-error/is-success` classes.
- Use semantic theme tokens and explicit light-theme foreground/background/border values.
- Include a visible focus treatment for any recovery action.

**Acceptance checks**

- Computed text contrast must be at least 4.5:1 in both themes.
- Verify success, error, and focused Retry at desktop widths.

### UX-21 — Scan pagination leaves users at the bottom of the next page

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/ScanScreen.jsx:1103-1108`.

Next/Previous swaps up to 25 cards without moving focus, scrolling to the result heading, or announcing that a new page loaded. After clicking Next near the bottom, the user can miss the first results on page two.

**Required change**

- Track user-initiated page changes separately from background refreshes.
- On user pagination, focus and scroll the results heading with `preventScroll`/reduced-motion-aware behavior.
- Announce `Page N of M loaded` through a polite live region.

**Acceptance checks**

- A 50+ result fixture must return mouse and keyboard users to the start of the new result page.
- Background refresh must not steal focus or scroll position.

### UX-22 — Archive date presets use a different day boundary than archive files

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/HistoryScreen.jsx:13`; `legacy_app/news_scrapper/application.py:3120,3222-3225`.

The frontend computes Today with UTC `toISOString()`, while the backend names archives from server-local time. Around midnight in India or on a Windows host, Today and seven-day presets can omit the newest run or begin on the wrong date.

**Required change**

- Use a local-date helper consistently, or return the authoritative archive date/time zone from the backend.
- Use the same boundary for presets, defaults, API parameters, and display.

**Acceptance checks**

- Fake-clock tests around midnight in `Asia/Kolkata` and `America/Los_Angeles` must match the server archive date.

### UX-23 — Archive silently hides individual runs after the newest 18

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/HistoryScreen.jsx:227-246`.

The archive displays the total edition count but creates controls only for `runs.slice(0,18)`. In a four-hour scheduler over a longer range, users cannot select older individual editions and receive no `Show more` affordance.

**Required change**

- Add an accessible Show more/paginated run selector or a virtualized strip covering all runs.
- Keep the displayed count aligned with what can be reached.

**Acceptance checks**

- In a 20-run fixture, run 19 is reachable after Show more.
- Keyboard order and the active-run indication remain stable.

### UX-24 — Unauthorized Archive exposes an unexplained dead action

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/screens/HistoryScreen.jsx:120-129,619-644`.

Users without `review.news.submit` cannot select articles, yet still see a permanently disabled `Send to review` button. The interface looks broken rather than intentionally permission-limited.

**Required change**

- Hide the action when the capability is absent, or replace it with concise access guidance if discoverability is a product requirement.
- Do not expose a control that can never become enabled in the current session.

**Acceptance checks**

- Unauthorized render contains no unexplained dead action.
- Authorized selection and review import remain unchanged.

### UX-25 — Routed screens create nested `main` landmarks

**Priority:** P3 · **Confidence:** high; reproduced in browser
**Evidence:** app shell `news-ui/src/news-scrapper/App.jsx:451-458`; nested route landmarks in `news-ui/src/venture-lens/VentureLensApp.jsx:416`, `news-ui/src/news-scrapper/screens/HistoryScreen.jsx:458`, and `news-ui/src/news-scrapper/screens/SamsungInternalReaderScreen.jsx:42-48`; modal content also uses `main` at `news-ui/src/venture-lens/VentureLensApp.jsx:199`.

The App shell already owns the single `main#news-main-content`. Several routed screens add another `<main>` inside it. Venture Lens produced two main landmarks in the live DOM. This is invalid landmark structure and makes screen-reader landmark navigation ambiguous.

**Required change**

- Keep `main` only in the shell.
- Convert routed screen wrappers and dossier body content to `div`, `section`, or `article` with appropriate labels.
- Preserve the skip-link target on the shell.

**Acceptance checks**

- Every normal route exposes exactly one `main` landmark.
- The skip link still focuses `#news-main-content`.

### UX-26 — URL-changing tab controls have an incomplete interaction contract

**Priority:** P3 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/for-you/ForYouWorkspaceScreen.jsx:82-128`; `news-ui/src/news-scrapper/for-you/CreateScreen.jsx:16-21`.

The outer For You tabs implement roving focus but do not associate each tab with its panel through `aria-controls`/`aria-labelledby`. The inner Create switcher uses tab roles without the corresponding arrow-key/roving-focus behavior or controlled tabpanels. These are routes, so links may be a clearer semantic fit.

**Required change**

- Preferred: render URL-changing destinations as `NavLink` items inside a labelled `nav`, using `aria-current="page"`.
- Alternative: complete the WAI-ARIA tabs pattern with stable IDs, `aria-controls`, labelled tabpanels, and keyboard behavior.

**Acceptance checks**

- Keyboard and screen-reader tests cover For You/Following/Create and Private Briefing/Contributions.
- Browser Back/Forward and direct links remain correct.

### UX-27 — Bootstrap/import failure can leave a blank page with no recovery

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/index.html:383-391`; `news-ui/src/main.jsx:20-50`.

The bootstrap removes the static portal, unhides an empty root, and dynamically imports the application without a rejection handler. `launch()` is also invoked without a catch. If the main or App chunk fails—such as a stale deployment cache or interrupted network—the React Error Boundary has not mounted yet, so the user receives a blank screen with no Reload action.

**Required change**

- Preserve or render a small static fatal-load panel when bootstrap fails.
- Give it plain-language copy and a Reload button; log technical detail separately.
- Keep the fallback independent of React chunks so it works when those chunks are the failure.

**Acceptance checks**

- Force the dynamic import to reject and assert that a visible recovery panel remains.
- Reload must retry the application without requiring developer tools.

### UX-28 — Capability-service failure is shown as genuine access denial

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/App.jsx:126-138,224-236`; `news-ui/src/news-scrapper/components/TopBar.jsx:481-485`.

When the capability request times out or returns a server error, App replaces capabilities with an empty array. Privileged navigation disappears and direct routes say `You don't have access`, even for an authorized user. A transport failure and a real denial are different states.

**Required change**

- Represent capability state as `loading`, `ready`, or `error` separately from the returned capability set.
- Continue to fail closed for protected actions.
- On transport error, show `Access could not be verified` with Retry instead of claiming denial.
- Reserve true denial copy for a successful authorization response that lacks the capability.

**Acceptance checks**

- Test 403/denied separately from 503/timeout.
- A successful retry restores the authorized navigation without a full reload.

### UX-29 — Shared fetch clients can wait forever

**Priority:** P1 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/api.js:21-31`; `news-ui/src/shared/api/client.js:6-13`.

Both shared clients call `fetch` without a deadline or a composed abort signal. Many screen effects set only a local `cancelled` flag; that prevents a state write but does not terminate a hung request. A backend connection that never responds can leave `Opening`, `Loading`, or `Checking` visible indefinitely.

**Required change**

- Add one central default timeout, approximately 20–30 seconds.
- Compose the timeout signal with any caller-provided signal and preserve `AbortError` semantics.
- Allow explicit longer deadlines for uploads, scheduler runs, or operations that legitimately take longer.
- Convert timeout failures into the screen's normal retryable error state.

**Acceptance checks**

- A never-resolving mocked fetch must end in a visible, retryable timeout.
- Caller cancellation and timeout cancellation must be distinguishable where behavior differs.
- Long-running operations with explicit overrides must remain supported.

### UX-30 — Background cache refresh does not update mounted screens

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/api.js:54-79`; no listener exists for the dispatched `sense-api-cache-update` event.

For data between `staleMs` and `maxStaleMs`, the client immediately returns cached data and refreshes in the background. It dispatches a cache-update event when fresh data arrives, but the application has no subscriber. A mounted route can therefore remain stale until another navigation or request occurs.

**Required change**

- Either await a fresh response for route-entry loads, or introduce a keyed subscription hook that consumes cache-update events and updates mounted state.
- Preserve stale data while loading rather than blanking the screen.
- Prevent unrelated URLs from triggering rerenders.

**Acceptance checks**

- Seed stale cache, return different server data, and prove that the mounted UI converges without a second navigation.
- Verify cleanup removes subscriptions on unmount.

### UX-31 — Shared modal isolation is incomplete

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/components/modals/useModalFocus.js:20-64`; consumers including `news-ui/src/news-scrapper/components/modals/ArticleModal.jsx:200,261-270`.

The shared modal hook traps and restores keyboard focus and locks scroll, but it does not inert or `aria-hidden` the application behind the dialog. Screen-reader virtual navigation can still reach background content even though the dialog declares `aria-modal="true"`. One-off dialogs implement stronger isolation separately, which makes behavior inconsistent.

**Required change**

- Standardize one portal/modal primitive.
- It must trap and restore focus, inert and hide the app shell from the accessibility tree with full state restoration, lock scroll, support Escape, and block background pointer access.
- Migrate shared dialogs to it without nesting modal ownership.

**Acceptance checks**

- Tab and Shift+Tab loop inside the modal.
- Escape closes and restores the trigger focus.
- Background controls are absent from the accessibility tree and cannot be activated until close.

### UX-32 — Muted/faint design tokens fail normal-text contrast

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/theme-toggle.css:18-27,57-66`; tiny uses in `news-ui/src/news-scrapper/components/premium-navigation.css:698-705,1028-1032,1089-1094,3409-3417`.

The dark `--text-faint` token on the primary surface is approximately 3.53:1. In light mode, `--text-muted` is approximately 4.16:1 and `--text-faint` approximately 3.10:1 on the primary surface. These are below WCAG AA's 4.5:1 requirement for normal text, and the tokens appear in 8–9 px labels and status copy.

**Required change**

- Correct the tokens centrally rather than patching individual selectors.
- Raise the smallest informative text to a readable size where layout permits.
- Recheck every themed surface because translucent overlays change the effective background.

**Acceptance checks**

- Automated contrast assertions must reach at least 4.5:1 for normal text.
- Light/dark desktop QA must cover settings, navigation status, metadata, and footnotes.

### UX-33 — Stored light theme flashes dark during a hard reload

**Priority:** P2 · **Confidence:** high
**Evidence:** `news-ui/index.html:383-391`; `news-ui/src/news-scrapper/App.jsx:40-45,147,173-177`; dark defaults in `news-ui/src/news-scrapper/theme-toggle.css:12-50`.

React reads the stored theme into state, but applies `documentElement.dataset.theme` only in an effect after the first paint. A user who chose light theme can see a dark flash during a hard reload, especially with cache or network throttling.

**Required change**

- Add a tiny pre-paint script in the document head/entry that safely reads the existing storage key.
- Set both `data-theme` and `color-scheme` before CSS/application rendering.
- Keep React state synchronized with that initial value.

**Acceptance checks**

- Hard-reload screenshots with stored light theme show no intermediate dark frame.
- Invalid/missing storage values still fall back safely.

### UX-34 — Wordmark promise and destination disagree

**Priority:** P3 · **Confidence:** high
**Evidence:** `news-ui/src/news-scrapper/components/TopBar.jsx:517-525`.

The wordmark is labelled `Go to briefing home` but navigates to `/for-you`. Screen-reader users are promised one destination and sent to another.

**Required change**

- If For You remains the product landing page, rename the accessible label to `Go to For You` and update the Korean equivalent.
- If the intended destination is Briefing, change the route instead. Do not change both without confirming product intent from current routing tests.

**Acceptance checks**

- A source/interaction test pins the accessible name and actual destination to the same product choice.

## Recommended implementation batches

Do not ask one small model to repair all findings in one pass. Use small, testable batches:

1. **Application boot and authorization truth:** UX-27, UX-28, UX-29, UX-30, UX-33.
2. **Data trust:** UX-01, UX-02, UX-04, UX-06, UX-07, UX-08.
3. **Broken navigation/actions:** UX-03, UX-05, UX-12, UX-16, UX-17, UX-19, UX-34.
4. **Contribution clarity:** UX-09, UX-10, UX-11.
5. **Carousel and partial data resilience:** UX-13, UX-14, UX-15, UX-18.
6. **Scan and Archive usability:** UX-20 through UX-24.
7. **Accessibility and theme semantics:** UX-25, UX-26, UX-31, UX-32.

When the implementation conversation explicitly authorizes commits, commit each completed batch separately so regressions can be isolated. Do not combine dependency upgrades, broad reformatting, or unrelated visual redesign with these fixes.

## Ready-to-paste implementation prompt for a smaller coding model

Copy the prompt below into the implementation model. Replace `[BATCH IDS]` with one batch from the section above.

```text
You are implementing a tightly scoped UX reliability batch in the Sense.AI / TechScout repository.

Repository root:
/Users/vineet/Documents/UI Redesigning

Active production-shaped application:
legacy_app/

Your assigned findings:
[BATCH IDS]

Authoritative audit:
legacy_app/docs/UX_FRICTION_AUDIT_AND_IMPLEMENTATION_PROMPT_2026-09-02.md

Before editing:
1. Read the repository AGENTS.md completely.
2. Read .opencode/skills/sense-project-memory/SKILL.md completely and every file listed under its Required first-session reading.
3. Read every referenced source and test file for the assigned findings.
4. Run `git status --short` and preserve every unrelated change. In particular, do not add, edit, delete, or commit the root-level untracked `FORENSIC_AUDIT_2026-08-23.md`.
5. Confirm the active baseline and remote, but do not pull, reset, rebase, or change branches.

Hard scope and architecture rules:
- Change only `legacy_app/` unless a test fixture outside it is explicitly required by current code.
- `legacy_app/main.py` is the only FastAPI composition root.
- `legacy_app/news-ui/` is the only active frontend.
- Preserve one unified corpus, one active `sites.json`, one four-hour scheduler, one active workflow/training stream, and one authoritative bouncer model.
- Never regenerate or overwrite `sites.json`.
- Broadcast is a content vertical/filter, not an IP-routed product profile.
- Briefing is the shared deterministic baseline; For You is private and explainable.
- Hide, Saved, preferences, and For You events remain private per viewer. Not Interested remains the explicit shared Gatekeeper/Bouncer training action.
- Keep browser API calls same-origin. Do not hard-code a developer/server IP.
- Keep exactly one Uvicorn worker while mutable state is JSON/process-local.
- Do not commit `.env`, credentials, weights, runtime JSON, user activity, generated briefings, or embedded Python.
- Do not upgrade dependencies or perform opportunistic cleanup.
- Preserve the existing Windows/reduced-motion CSS guarantees that keep Briefing, Research, Samsung Internal streams, and the announcement marquee moving.
- Desktop QA only for this batch; do not spend time on a mobile redesign.

Implementation procedure:
1. For every assigned UX ID, first reproduce it with the smallest targeted test or browser check described in the audit. If the live code has changed and the issue no longer reproduces, document the evidence and do not force a speculative edit.
2. Implement the smallest cohesive fix that addresses the stated root cause, not only the screenshot symptom.
3. Model asynchronous UI truthfully. Never convert a failed or unknown request into zero, empty, unfollowed, unpublished, or successful state.
4. Preserve last-known good data during retry whenever safe.
5. For async selection, use cancellation/request identity so an older response cannot overwrite a newer user choice.
6. For user-triggered navigation, restore the correct route, channel, focus, and scroll context without stealing focus during background refresh.
7. For carousels/streams, keep Pause/Resume, Page Visibility, manual navigation, Windows reduced-motion behavior, and large-display continuity.
8. Use existing semantic theme tokens. Do not introduce new hard-coded light/dark colors unless the existing token set cannot express the state.
9. Add targeted regression tests for every fixed UX ID. Tests must prove both the failure path and recovery path.

Required verification from `legacy_app/news-ui/`:
- Run the smallest relevant test files while iterating.
- Run `npm test`.
- Run `npm run build` even if tests pass.

If backend code changes, required verification from `legacy_app/`:
- Run the smallest relevant unittest module while iterating.
- Run `./.venv/bin/python -m unittest discover -s tests -v` before completion.

Browser QA:
- Test only the real affected desktop routes.
- Check both light and dark themes.
- Use representative desktop widths of 1024, 1195/1200, 1366, and 1920 pixels; add 3840 only for announcement/continuous-stream work.
- Check keyboard focus, visible focus rings, Escape/Back behavior, error + Retry, empty state, and slow-network behavior relevant to the batch.
- Do not claim success from screenshots alone; exercise the interaction.

Completion contract:
- Show a concise mapping from each assigned UX ID to changed files, tests, and observed behavior.
- Report exact test/build results and any remaining risk.
- Review `git diff --check`, `git status --short`, and the final diff.
- Do not touch unrelated changes.
- Do not commit or push unless the human explicitly asks in the implementation conversation.
- If blocked, stop with concrete evidence; do not invent APIs, data, or success.
```

## Definition of done for the overall audit backlog

The backlog is complete only when:

- every P1 and P2 item has a targeted regression test;
- unknown/failed shared state is never rendered as real zero/empty/off state;
- all deep links and Back paths preserve the user's selected context;
- manual carousel selection receives a full reading interval;
- all route surfaces expose exactly one `main` landmark;
- affected routes pass desktop light/dark interaction QA;
- `npm test` and `npm run build` pass after every frontend batch;
- the complete backend suite passes after any backend batch;
- no unrelated file, runtime data, credential, model weight, or existing untracked audit is committed.
