# UI Theme and Identity Remediation Prompt

Work only in the current `legacy_app/news-ui` experience unless a narrowly required identity API change is called out below. Preserve the existing information architecture, routes, feed behavior, carousel, briefing stream, latest-day signals, dossiers, workflow, analytics, gatekeeper, search, sources, scheduler, and profile-specific content. Do not redesign the product into a different dashboard.

## Objective

Make both themes feel like one premium, production-ready intelligence product:

- Dark theme: an elegant ink/navy newsroom cockpit with restrained cobalt accents.
- Light theme: a cool paper/silver-blue newsroom with white elevated surfaces, dark navy text, slate borders, and restrained cobalt accents.

The result must be coherent, readable, responsive, accessible, and intentional across every route, modal, menu, card, control, state, and viewport. Do not “fix” light mode by globally replacing dark colors.

## 1. Rebuild the theme foundation

1. Define one semantic token system for both themes:
   - page background and ambient background
   - primary, secondary, and elevated surfaces
   - inset/quiet surfaces
   - text primary, secondary, muted, and inverse
   - borders subtle, standard, and strong
   - accent, accent-hover, accent-soft, focus ring
   - success, warning, danger, and information
   - disabled surface, text, and border
   - overlay, shadow, and image scrim
2. Replace component-level hardcoded theme colors with semantic tokens.
3. Consolidate overlapping light-mode override layers in `index.css`, `theme-toggle.css`, and `archive-search.css`.
4. Remove avoidable `!important` rules and resolve specificity structurally.
5. Theme portal-rendered overlays and dialogs through the same tokens.
6. Preserve profile identity: default and broadcast may use distinct accents, but both must remain compatible with light and dark mode.

## 2. Refine dark mode

Keep the current dark foundation, but make it calmer and more premium:

- Reduce the omnipresent purple/violet haze.
- Use deep neutral navy/ink as the primary canvas and reserve purple for rare atmospheric detail.
- Reduce nested borders and “box inside box” repetition.
- Strengthen secondary text and micro-label contrast without making everything white.
- Normalize surface elevation, radius, borders, and shadows.
- Make metrics easier to scan and reduce decorative competition with data.
- Improve image-card scrims so every title and metadata line remains readable regardless of the image.
- Keep atmospheric motion subtle, performant, and respectful of `prefers-reduced-motion`.
- Ensure the fixed header, menus, batch action bar, and dossiers do not crop or overflow at common laptop widths.

## 3. Rebuild light mode

Treat light mode as a complete visual system:

- Use a soft cool-neutral page background, not pure white everywhere.
- Use true white or lightly tinted elevated panels.
- Use dark navy primary text and readable slate secondary text.
- Remove muddy grey hero panels and ghost-like lavender text.
- Do not leave accidental dark cards inside white sections. A dark editorial/photo card is allowed only when intentionally designed with an inverse token set.
- Make every heading, metric, chip, filter, input, table, tooltip, dropdown, disabled state, hover state, focus state, and empty/error/loading state clearly legible.
- Correct the light versions of the top bar, settings menu, carousel, signal pulse, briefing stream, latest-day cards, filter controls, workflow pages, sources, scheduler, history, local search, analytics, gatekeeper, VOC, profile dialog, confirmation dialogs, and article dossier.
- Ensure close icons, metadata chips, right-side dossier metrics, and footer/preview content never disappear against their surfaces.

## 4. Add the viewer identity experience

The existing `UserProfileModal` must be integrated rather than duplicated.

### First visit

- On application startup, request `/viewer/profile`.
- If the current IP identity has no registered display name, open a mandatory first-visit profile dialog.
- The dialog must feel warm and premium, not like an administrative form.
- Use the time-aware greeting: Good morning, Good afternoon, or Good evening.
- Ask what the application should call the user.
- Email remains optional.
- Show the current real IP returned by the backend only to that current viewer.
- Explain briefly that stored analytics use a protected identity/hash.
- Do not rely only on `localStorage` to determine whether onboarding is complete; backend identity is authoritative.
- Display precise inline errors for invalid, duplicate, or failed saves.
- Prevent dismissing the first-visit dialog until a valid name is saved.

### Returning users

- Add a compact user/profile control immediately beside the theme toggle.
- Show the display name or initials without overcrowding the header.
- Opening it reveals display name, optional email, current real IP, active profile, and an Edit action.
- Allow changing the display name from the same polished profile dialog.
- Reflect successful changes immediately in the header and visible UI without requiring refresh.
- Provide loading, success, error, keyboard, focus-management, and escape/close behavior appropriate to whether the dialog is mandatory.

### Identity rules

- Display names are trimmed, case-insensitively unique, and at least two characters.
- Duplicate-name conflicts must explain that the name is already used and ask for another.
- Never expose another user’s real IP in normal UI or analytics.
- Treat the protected viewer ID/IP hash as the stable identity and the name as editable presentation data.
- New selections and approvals must attribute the stable viewer identity, not depend solely on a copied name string.
- When a user renames themselves, the new name must appear everywhere that identity is rendered: selected items, review queue, approved items, dossiers, exports where applicable, and analytics.
- Prefer resolving the current display name from the stable viewer ID at read/render time. If the existing data format stores only `selected_by`/`approved_by`, add the smallest safe compatibility migration or update path required.

## 5. Interaction and accessibility quality

- Every icon-only button needs an accessible name and a visible tooltip.
- Maintain visible keyboard focus.
- Meet WCAG AA contrast for normal text and controls.
- Use at least comfortable pointer targets for header and modal actions.
- Verify hover, active, selected, disabled, loading, empty, warning, success, and error states in both themes.
- Avoid layout shift when switching themes.
- Persist theme selection.
- Test responsive layouts at approximately 1440, 1280, 1024, 768, and 390 pixels.

## 6. Required visual QA

Review both themes on:

- Home/intelligence briefing
- Review queue
- Approved briefing
- Hidden signals
- Source control
- Scheduler
- Briefing archive/history
- Local extracted-intelligence search
- Voice of Customer
- Analytics
- Gatekeeper review
- Settings menu
- Profile onboarding and profile editing
- Article dossier
- Approval/key dialogs, selection dialogs, export dialogs, feedback modal, tooltips, and batch action bar

For every screen, inspect default, hover/focus, populated, empty, loading, and error states where practical. Test theme switching while a menu or modal is open.

## 7. Validation and completion criteria

- Build succeeds with no new warnings.
- Existing frontend tests pass; add focused tests for theme persistence, first-visit detection, duplicate-name handling, profile editing, and live identity refresh.
- No light-mode heading, metric, icon, or action is washed out or invisible.
- No dark-mode secondary information is illegibly dim.
- No unintended dark/light surface mixing remains.
- Header and dialogs remain usable without clipping at supported widths.
- Renaming a viewer updates all identity displays consistently.
- Provide before/after screenshots for representative home, workflow, dossier, and profile states in both themes.
- Do not claim completion until every listed route and overlay has been visually checked.
