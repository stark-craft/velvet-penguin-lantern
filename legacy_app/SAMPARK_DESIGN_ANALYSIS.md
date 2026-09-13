# Sampark presentation: design analysis and proposed implementation

Status: analysis only, pending product and hosting decisions. 9 September 2026.

This report compares the six pasted design attachments with the active application in `legacy_app/`. It is a source-level review, not a rendered-browser assessment. No product code has been changed or verified as part of this analysis.

## 1. Scope and recommendation

Keep the current interface for the future Samsung browser. Add a separately styled Sampark presentation in the same active frontend, sharing the existing backend, identity, permissions, article reactions, private preferences, scheduler and corpus. Do not fork the backend or create a second source configuration.

A separate repository is not recommended at this stage: it would increase the risk of behavior and permission fixes diverging between presentations. Prefer a separate frontend entry and a `src/sampark/` implementation boundary. The existing interface should remain the default development entry; a second URL should open Sampark for comparison.

Exclude the prototype's Sampark navigation/header entirely. Keep the TechScout-level controls below it. Sampark authentication and framing must not be inferred from the decorative header or its hardcoded user name.

## 2. What the supplied files actually provide

The design describes a light, blue-and-white interface using Roboto, white rounded containers, category navigation, image-led cards and modal authoring. Its major sections are For You, All News, Research and Samsung News. It is a visual and interaction prototype, not an alternative production frontend.

The pasted source has transport artifacts: some URLs became Markdown links and JavaScript comments/code were flattened onto the same lines. The original ZIP would be preferable before reference rendering. These artifacts should not be attributed to the design team's original files without checking them.

Most illustrations are CSS placeholders and icon stand-ins. The HTML relies on Google Fonts and a Font Awesome CDN; production should use approved locally bundled assets rather than assuming external CDN access inside Sampark.

### Screen mapping

| Supplied design | Current product | Integration decision |
| --- | --- | --- |
| For You | Private personalized feed | Reuse real viewer/preferences/feed; preserve reactions, follow and hide |
| All News | Shared Briefing baseline | Reuse corpus, filters, article identity and dossier actions |
| Research | Research discovery plus Venture Lens | Design covers only a small subset; retain other artifact types and detail tools |
| Samsung News: Global / Local / SRI-D | Samsung Global / Samsung Local / Inside Samsung | Confirm SRI-D naming and content scope |
| Create News | Contributions and document import | Preserve permissions, drafts, review and publishing lifecycle |
| By URL | No unambiguous one-to-one mapping | Current private link briefing is not the same as a public contribution |
| Preferences | Private viewer preferences | Bind existing schema and validation, not hardcoded checked boxes |
| Settings | Existing profile/theme/language and authorized tools | Separate supported controls from prototype-only features |

## 3. Functional gaps in the prototype

- There are no backend requests or persistent storage in its supplied JavaScript. Sample counts, dates, names and news are demonstration data.
- Main tabs swap DOM visibility rather than use routes. Refresh, deep links and browser history need real routing.
- Likes change the icon, not an authoritative shared count. Existing canonical reaction state must be reused everywhere.
- Category tabs and Samsung subtabs mostly change their selected styling; they do not supply the promised data filtering.
- Apply Filters animates cards rather than implementing filtering. Search is also demonstration behavior.
- Card and stream clicks do not implement article readers or research detail views.
- The primary carousel uses a hardcoded three-slide timer. The SRI-D carousel does not have equivalent automatic rotation. Live lists are not continuously streaming; a pulsing live indicator is not a stream implementation.
- Existing announcements, management actions, archive, saved/followed stories, private briefings, moderation and other privileged tools are not fully represented.
- Comment buttons introduce a feature not established by the current article UI. Email alerts, push notifications and daily digest switches likewise must not imply working services without implementation scope.
- The language control changes its displayed label, not the application translation. Dark mode has a switch but no supplied dark design.
- Preference removal is DOM-only, and the apparent three-step preference flow is not implemented as a persisted wizard.
- The personal activity cards and monthly percentage changes are hardcoded. They should be omitted or connected to a defined private aggregate, never recreated with invented numbers.

## 4. Authoring is the main scope boundary

The mockup offers four layout templates, two image uploads, two descriptions, PDF import, URL import and a Hero Banner/SRI-D News placement choice. These choices cannot all be delivered faithfully as CSS over the existing content record.

The current contribution service uses title, summary, body and one cover, with established content types and a review lifecycle. Template identity, a second image/content block and independent placement would require an agreed additive content schema and compatible rendering in both interfaces.

Important inconsistencies to resolve:

- The placement choice is not consumed by the supplied script.
- Some template previews omit fields that the common form lets users fill in. Saving all content without silently dropping fields is mandatory.
- PDF and URL previews do not implement the same template choices as self-authored content.
- PDF browsing and URL extraction are not production import flows in the mockup.
- The description label mixes characters and a 400-word limit.
- A generic Publish success message is not a substitute for server approval. Contributor actions must still submit for review; only authorized publishing actions can publish.
- Current DOCX support should not disappear merely because the prototype labels its upload mode PDF.

Decide whether these are real new authoring capabilities or visual references for the existing contribution editor. Also decide whether By URL creates a private briefing or a public, reviewed contribution.

## 5. Layout and accessibility risks

These are source-level risks to verify once a runnable reference is available:

- Global selectors and generic classes such as `.modal`, `.card-body` and `.action-btn` would collide with the current global stylesheet stack. Use isolated/scoped Sampark styling and independent entry imports.
- Many labels, headings and metadata use the same 16px size. Establish a deliberate hierarchy while respecting the reference design.
- Very pale secondary text needs contrast checking; dark mode needs its own semantic color tokens rather than color inversion.
- The carousel/sidebar layout stacks at 1200px. A desktop portal content area around 1195px could therefore look substantially different from the intended wide design.
- Fixed 500px carousel height, fixed-width latest cards and large metric-card horizontal padding could waste or constrain space inside a portal.
- The horizontal scrolling step does not match the supplied latest-card width; align scrolling with actual measured cards.
- Dialogs have nested scrolling and minimum heights that need checking on ordinary laptop screens.
- Clickable divs, unnamed icons and decorative dots need semantic controls, accessible names and keyboard handling.
- Dialogs need focus management, focus restoration and unsaved-change protection.
- Automatic content must account for pause, focus, visibility and reduced-motion preferences. Preserve the current application's motion fixes rather than replacing them with the prototype timer.

## 6. Architecture and deployment implications

The current Vite configuration has a single frontend entry. FastAPI serves the current `dist/index.html` for SPA navigation. Adding a folder or a Vite input alone is insufficient: the second entry, assets, deep links and production fallback all need coordinated configuration.

Proposed approach:

1. Keep the existing entry and routes intact.
2. Add a Sampark entry, provisionally under `/sampark/`, with its own stylesheet imports and router base.
3. Reuse existing API clients, shared types and behavior. Extract presentation-neutral logic only where necessary; avoid copying the entire application state container.
4. Provide route-aware links for articles, research details, authoring and secondary tools. Existing absolute route assumptions need review.
5. Configure production handling of Sampark HTML/deep links and verify exports, images and API URLs, not just the development server.
6. Keep one backend and one authoritative set of runtime data.

Hosting questions cannot be solved by styling. Current viewer cookies use SameSite=Lax; privileged session cookies use SameSite=Strict. Cross-site iframe embedding therefore needs a deliberate identity/session design. Do not relax cookie policy automatically or accept an unverified portal-provided name as authorization.

The portal team should specify iframe versus standalone/reverse-proxied route versus direct embedding, intended origin/path, available content width, authentication integration and asset/security restrictions. Local side-by-side work can be planned before all deployment details arrive, but production compatibility cannot be promised yet.

## 7. Suggested implementation phases, after approval

1. **Reference and decisions:** obtain original files/assets where possible; settle authoring scope, landing behavior and hosting assumptions; document screen mapping.
2. **Isolated shell:** add the second entry, scoped design tokens, TechScout header, four primary sections and route/deep-link support. Leave the existing entry visually unchanged.
3. **Read-only screens:** connect real For You, Briefing, Research and Samsung data; retain loading, empty, failure and access-denied states. Connect readers and all existing stream behavior.
4. **Interactions:** connect reactions, follow/hide, preferences, search, filters, profile, theme and translation through existing behavior. Place secondary functionality in discoverable menus.
5. **Authoring:** adapt the approved draft/import/review workflow. Add template metadata only if explicitly included; preserve old UI compatibility and existing content.
6. **Verification:** focused automated tests and production builds; both entries and their deep links; desktop light/dark checks as applicable; Windows/browser zoom and wide-display motion; deployment/session checks against the agreed portal topology. Avoid unrelated feature re-testing and mobile testing unless requested.
7. **Handoff:** document development URLs, production output, portal integration requirements and remaining dependencies. Commit/push only when requested for this work.

## 8. Decisions needed before implementation

1. Should For You remain the initial page, or should All News become the default as in the prototype? Should the featured For You area show the current five signals or the prototype's three?
2. Are all four templates, two images and Hero Banner placement real authoring requirements? What should By URL produce: a private briefing or a reviewed SRI-D contribution?
3. Does SRI-D mean the full existing Inside Samsung section, including its existing content sources and approved contributions?
4. Should Sampark support both light and dark themes at launch? The supplied design defines only light mode.
5. May prototype-only comments, email/push/digest switches and unsupported personal statistics be omitted while existing product features remain available through secondary navigation?
6. How will Sampark host and identify this application? If not yet known, keep that as an explicit deployment dependency rather than a blocker to reviewing the visual plan.

Recommended baseline: preserve For You as default and all current product behavior; treat the supplied files as the new visual reference, not a specification to remove existing capabilities or introduce unapproved backend features.
