# Operations, deployment, testing and Git policy

## Development commands

Always run commands from the active application, not the older repository root
application.

### macOS

Backend:

```text
cd legacy_app
./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Frontend:

```text
cd legacy_app/news-ui
npm run dev -- --host 127.0.0.1
```

Convenience launcher:

```text
legacy_app/START_LEGACY_MAC.command
```

### Windows development checkout

Backend from the `legacy_app` directory:

```text
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend from `legacy_app\news-ui`:

```text
npm run dev
```

The Vite proxy sends API traffic to port 8000. No manual frontend environment
variables should be needed for normal same-machine development.

## Portable Windows production

The company server PC may have no system Python. The intended layout is:

```text
C:\App_Portable\
├── main.py
├── .env
├── requirements.txt
├── core\
├── news_scrapper\
│   └── runtime\              persistent mutable state
├── venture_lens\
│   └── runtime\              persistent provider caches
├── frontend\
│   └── dist\                 built Vite output
├── model_weights\            local Hugging Face model folders
├── python_embed\             embedded Python and installed packages
└── scripts\
    └── start_windows.bat
```

Production steps are intentionally simple:

1. build `legacy_app/news-ui` on a development computer with `npm run build`;
2. copy `dist` as `C:\App_Portable\frontend\dist`;
3. copy backend source, requirements and scripts without overwriting `.env`,
   model weights, embedded Python, or runtime JSON;
4. install/update Python dependencies through
   `python_embed\python.exe -m pip install -r requirements.txt`;
5. start `scripts\start_windows.bat`;
6. browse to `http://<server-ip>:8000`.

`core.settings.resolve_frontend_dist()` automatically detects both
`news-ui/dist` in a source checkout and `frontend/dist` in App_Portable. An
explicit `NEWSSCRAPPER_FRONTEND_DIST` remains available for nonstandard layouts.

The Windows launcher uses one worker and restarts Uvicorn after a crash. It
cannot run while the laptop is powered off or asleep. Configure Windows power
and reboot startup separately.

The canonical detailed guide is `legacy_app/CALLIOPE_AMBER_ORBIT.md`. The safe
interactive updater is `legacy_app/scripts/update_portable_app.ps1`; it protects
`.env`, `model_weights`, `python_embed`, and runtime state and asks how to handle
code conflicts.

## Environment configuration

Use `legacy_app/.env.example` as the definitive key list. Copy it to `.env` and
enter real values only in the ignored `.env` file.

Critical operational groups:

- production mode and strong Director/Analytics/Gatekeeper keys;
- distinct IP-hash and viewer-cookie secrets;
- one scheduler with four-hour cadence and retention settings;
- unified-corpus and For You feature switches;
- `SENSE_MODEL_ROOT`, offline mode and model paths;
- runtime directories and optional frontend dist override;
- system CA / approved PEM bundle paths with verification enabled;
- Samsung Web Search and Chat clients, tokens, complete routes and quotas;
- translation settings;
- private URL briefing safety limits;
- optional GitHub token for Venture Lens;
- blank Vite API base values for same-origin behavior.

Production keys require at least six characters. Development may use shorter
defaults, but production deliberately refuses weak secrets.

## Local model installation

The model folders are not committed. Use the model setup sections in
`CALLIOPE_AMBER_ORBIT.md` and `SUPERNOVA_ORCHID_ATLAS.md` for exact downloads.
The server path is normally `C:\App_Portable\model_weights`.

Do not copy a virtual environment from macOS to Windows. Embedded Python and
all compiled dependencies must match the target Windows architecture and Python
version.

## Test matrix

### Frontend

From `legacy_app/news-ui`:

```text
npm test
npm run build
```

The Node test suite covers deployment contracts, private briefings, visible
summary/filter contracts, translation, Scout, navigation, Venture Lens UX,
research expansion and document import. `npm run build` is mandatory because
dynamic PDF/DOCX imports and SPA chunks can pass unit tests but fail bundling.

### Backend

From `legacy_app` with the correct Python executable:

```text
python -m unittest discover -s tests -v
```

Focused backend suites cover:

- unified source inventory and one scheduler cycle;
- identical Bouncer load/train paths and idempotent migration;
- Samsung preflight's four safe modes and runtime failure fallback;
- RSS/website spider behavior;
- Gatekeeper, rapid training votes and atomic JSON updates;
- signed private identity, preference/ranking privacy and cursor stability;
- saved/hidden/private URL briefing isolation;
- frontend dist/deep-link/same-origin serving;
- history, retention, exports, rate limits and secure TLS;
- Korean translation and Venture Lens provider behavior.

### Browser QA

For UI changes, run the backend and Vite, then test the actual route in a browser.
Check both themes and responsive widths. Do not infer Windows layout correctness
from a Mac screenshot alone; avoid fixed heights for variable text and verify
overflow/wrapping using browser emulation plus a real Windows check when
available.

## Capacity and concurrency

- Exactly one Uvicorn worker is required today.
- Read-only traffic for tens of users and bursts around one hundred readers is
  within the pilot's intent.
- Manual internet crawls are bounded; do not let every user launch an unbounded
  crawler.
- One hundred simultaneous heavy crawls, model inferences, exports, or writes
  are outside this architecture.
- Never make scheduler, model, or JSON locks appear multi-process safe when they
  are not.

## Git procedure

Before a requested commit or push:

1. run `git status --short`;
2. inspect the complete diff and identify unrelated user changes;
3. run appropriate tests and build;
4. confirm `git remote -v` points to
   `https://github.com/stark-craft/velvet-penguin-lantern.git`;
5. confirm author name/email belong to `stark-craft`;
6. stage only intended files;
7. commit with an honest message;
8. push only the branch/target the user named;
9. verify the remote commit.

Never attribute commits to Tourist or Tourist02. Never rewrite published history
unless the user explicitly requests and understands that operation.

## Documentation upkeep

When architecture changes, update in the same task:

- `.env.example` when configuration changes;
- relevant implementation tests;
- `docs/ARCHITECTURE.md` or a more focused document;
- Windows deployment guide when paths/startup change;
- this skill's `current-state-and-roadmap.md` when the handoff state changes.

If an older document conflicts with the unified code, fix or clearly mark the
document stale rather than leaving a future agent to revive obsolete behavior.
