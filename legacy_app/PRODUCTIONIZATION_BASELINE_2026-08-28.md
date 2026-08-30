# TechScout productionization safety baseline

Captured before the productionization pass on 2026-08-28 (Asia/Kolkata).

## Repository

- Commit: `786ad8b456a8e07112b349de2bb9ea1bfda842d9`
- Subject: `Unify Venture Lens with TechScout research UI`
- Branch: `codex/legacy-stabilization`
- Remote: `https://github.com/stark-craft/velvet-penguin-lantern.git`
- Commit identity: `stark-craft <290818890+stark-craft@users.noreply.github.com>`
- Modified tracked files: none
- Untracked files: `FORENSIC_AUDIT_2026-08-23.md` (pre-existing, intentionally untouched)
- Recoverable source archive: `/private/tmp/sense-productionization-baseline-786ad8b.tar.gz`

## Backend baseline

- Composition root: `main.py`
- Composed FastAPI routes: 65
- API method/path pairs: 64
- Route decorators in active modules: 115 source declarations (some compatibility aliases and composition-time routes collapse in the live app)
- Python compile-all: pass (`1.96s`)
- Safe import with scheduler disabled: pass (`15.41s`)
- Startup import loaded the existing unified Gatekeeper model and did not start the scheduler.

## Frontend baseline

Primary routes declared by the shared React shell:

- `/`
- `/for-you/*`
- `/home`
- `/scan`
- `/selected`
- `/approved`
- `/saved/*` (legacy redirects)
- `/research`
- `/samsung-internal`
- `/samsung-internal/leadership/:id`
- `/samsung-internal/announcement/:id`
- `/internal-publishing`
- `/venturelens/*`
- `/rejected`
- `/sources`
- `/manage-sources`
- `/scheduler`
- `/history`
- `/trends` (feature-gated legacy route)
- `/voc`
- `/director-analytics`
- `/gatekeeper-review`
- catch-all route

Production Vite build: pass in `3.72s`.

Baseline output sizes:

- `dist/`: 2.4 MB
- main shell JS: 214.66 kB (72.73 kB gzip)
- NewsScrapper app JS: 395.66 kB (104.78 kB gzip)
- largest lazy worker asset: PDF worker 1,078.61 kB
- largest CSS: App 244.15 kB, index 152.67 kB

## Preservation rules for this pass

- The local tracked tree at this baseline is authoritative.
- The untracked forensic audit remains user-owned and is excluded from all edits and commits.
- `.env`, runtime JSON, history, viewer state, internal content, model files, and `sites.json` are excluded from the source backup and must remain untouched by development migrations.
- Significant edits must remain recoverable from Git plus the external baseline archive.
