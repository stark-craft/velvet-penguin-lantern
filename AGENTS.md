# Sense.AI repository instructions

The production-shaped application in this repository is `legacy_app/`. The older
top-level `app/`, `backend/`, `components/`, `deployment/`, and related folders,
plus the root `README.md` and Windows guides that describe Default/Broadcast as
separate IP-routed profiles, are retained history/reference with superseded
behavior. Do not implement new product work in those trees or revive profile
routing unless the user explicitly changes scope.

Before changing code, load the OpenCode skill `sense-project-memory` from
`.opencode/skills/sense-project-memory/SKILL.md`. On the first session in a new
agent, read every file listed under that skill's **Required first-session
reading**. Those references contain the architecture, data flow, UX decisions,
deployment constraints, completed work, and current roadmap. When sources
disagree, live code and tests in `legacy_app/` win over any document.

## Commands

Run everything from `legacy_app/`, never the repository root — the root contains
a different, superseded frontend/backend with its own `package.json`.

Backend (macOS; use `legacy_app/.venv`, not a root environment):

```text
cd legacy_app
./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Frontend (Vite on 5173 proxies same-origin API paths to 127.0.0.1:8000; no env
vars needed):

```text
cd legacy_app/news-ui
npm run dev -- --host 127.0.0.1
```

Verification:

```text
# from legacy_app/news-ui
npm test                            # Node's built-in test runner, not jest/vitest
node --test tests/<file>.test.js    # one suite
npm run build                       # mandatory even when npm test passes

# from legacy_app
./.venv/bin/python -m unittest discover -s tests -v
./.venv/bin/python -m unittest tests.test_<module> -v    # one module
```

`npm run build` catches failures unit tests cannot: lazy PDF/DOCX parser imports
and SPA chunks can pass `npm test` yet fail bundling. Preserve those lazy
imports, and never upgrade dependencies (e.g., React Router) as incidental
cleanup — assess upgrades as their own tested task.

For UI changes, also do browser QA on the real route in both themes and at a
narrow width before claiming success.

## Non-negotiable rules

- Work inside `legacy_app/` unless the user explicitly says otherwise.
- Treat `legacy_app/main.py` as the sole FastAPI composition root and
  `legacy_app/news-ui/` as the sole active frontend.
- Preserve the unified corpus: one active `sites.json`, one four-hour scheduler
  run, one active workflow/training stream, and one authoritative bouncer model.
  Broadcast metadata is now a content vertical/filter, not an IP-routed product
  profile. Legacy broadcast files remain rollback inputs and must not be deleted;
  never regenerate or overwrite `sites.json`.
- Keep the Briefing as the deterministic shared baseline and For You as the
  private, explainable default landing experience.
- Hide, Saved, preferences, and For You events are private per viewer. Not
  Interested is the explicit shared Gatekeeper/Bouncer training action.
- Keep browser API calls same-origin. Never hard-code a developer or server IP
  into the frontend.
- Run exactly one Uvicorn worker while mutable state is JSON and scheduler/rate
  limit locks are process-local.
- Never commit `.env`, credentials, model weights, runtime JSON, user activity,
  generated briefings, or embedded Python.
- Never disable TLS certificate verification. Configure the Windows/system CA
  or an approved CA bundle.
- Preserve unrelated working-tree changes. Inspect `git status` and diffs before
  editing. Do not reset, overwrite, commit, or push work merely because it is
  present.
- Commit or push only when the user explicitly asks. Verify the remote is
  `github.com/stark-craft/velvet-penguin-lantern` and author identity is
  `stark-craft`; never attribute commits to Tourist/Tourist02.
- Do not claim a feature works until relevant automated tests and a production
  build pass. Use browser QA for visual or interaction changes.

Use `legacy_app/.env.example` as the configuration contract and
`legacy_app/CALLIOPE_AMBER_ORBIT.md` as the detailed portable Windows guide.
Older documentation can describe superseded profile behavior; current code,
tests, `.env.example`, and the `sense-project-memory` references take priority.
