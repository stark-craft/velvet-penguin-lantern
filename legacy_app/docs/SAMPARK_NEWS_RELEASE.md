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

Research and Create continue to open the original workspaces. Samsung Internal
is the next requested presentation milestone.
