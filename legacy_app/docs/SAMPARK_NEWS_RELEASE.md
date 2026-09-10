# Sampark news presentation

Sampark runs inside the existing frontend and backend. Open `/sampark/for-you`
for the personalized feed or `/sampark/home` for All News. Original `/for-you`
and `/home` remain available for comparison. The existing Vite and single-worker
FastAPI commands apply; Vite proxies same-origin API calls in development.

The news presentation supports the existing dossier, counted reversible
reactions, private Follow and Hide, Saved & Following, interest setup, archive,
profile editing and authorized operational workspaces. Settings includes theme,
Korean translation, optional Scout, role-key login/logout and capability-gated
navigation. Roles and IP grants use existing server policies.

All News combines search with region, category, source, date, strength, freshness,
coverage, image, keyword, content vertical and review-state filters. Its hero,
Briefing Stream and article grid follow the selected filters. No filters change
the underlying corpus or another viewer's settings.

Appearance uses a separate `sampark-theme` preference. Translation uses the
existing progressive browser-local engine with the installed local Marian
fallback. English originals remain canonical.

Validation on 10 September 2026: 113 frontend tests, 212 backend tests and Vite
production build pass. Browser QA covered light/dark, 390px layout, production
FastAPI serving, cross-route reaction/follow state, hide/restore, category and
search filters, preference saving, unchanged-profile saving, login rejection,
Korean article translation and English restoration. Role-session authorization
and private viewer isolation are covered by backend tests. Runtime service
credentials and model readiness remain deployment configuration.

Research and Create continue to open the original workspaces.

Samsung Internal first presentation pass is now available at
`/sampark/samsung-internal`. It reuses the existing Samsung Global, Samsung Local
and Inside Samsung channels, leadership carousel, announcements and published
readers. Archive search and category filtering combine without changing the
corpus. Channel tabs support arrow keys, Home and End. Signal images, headlines,
hero actions and the intelligence wire open the original dossier within Sampark.
Published readers return to the originating channel. Publishing and archiving
retain the existing server capabilities; authoring stays in the original editor.

Follow-up QA verified search/no-results/reset, category filtering, all three
channels, leadership reader and return navigation, image-to-dossier interaction,
keyboard channel selection, and light/dark layouts at desktop and 390px. Fixed
portal dossier colors to avoid white text on a light background. Local data had
no published colleague stories or announcements during this pass; their reader
and permission contracts remain covered by the existing automated suites.
Frontend verification now passes 115 tests and the production build.
