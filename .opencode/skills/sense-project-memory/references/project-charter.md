# Project charter and working rules

## Identity

- Product family: **Sense.AI**.
- News product visible branding: **Samsung TechScout** / NewsScrapper.
- Research product: **Venture Lens**.
- Internal-content product: **Samsung Internal**.
- Product creator credit: **Designed and engineered by Vineet Singh** where a
  restrained credit is appropriate.
- Public repository: `https://github.com/stark-craft/velvet-penguin-lantern`.
- Active GitHub owner and commit identity: `stark-craft`.

Do not rename Vite, Vinext, third-party packages, compatibility identifiers, or
internal module names merely to make branding text consistent. Visible branding
and runtime identifiers are separate concerns.

## Active scope

All continuing product work belongs in `legacy_app/`:

```text
legacy_app/
├── main.py                  one FastAPI composition root
├── core/                    shared settings, storage, rate limits and TLS
├── news_scrapper/           news backend, scheduler and recommendation system
├── venture_lens/            GitHub/arXiv research backend
├── news-ui/                 one React/Vite frontend for the whole platform
├── model_weights/           local model folders; weights are ignored by Git
├── scripts/                 Mac/Windows build, start and update helpers
├── tests/                   backend regression suite
├── docs/                    architecture and implementation records
└── .env.example             authoritative safe configuration template
```

The repository also contains an older top-level frontend/backend. It is not the
current product and must not receive new work unless the user explicitly asks.

## Product principles

1. News intelligence must be useful before it is decorative. Preserve source
   attribution, factual headlines, evidence, dates, and traceability.
2. A "hook" means fast comprehension and a reason to care, not clickbait. A card
   should answer what changed, why now, why it matters, and why this viewer is
   seeing it.
3. For You personalizes order and explanation; it must not rewrite editorial
   truth, hide the shared briefing, or grant access to restricted material.
4. The deterministic Briefing remains available even when recommendation data
   is absent or fails.
5. The application is currently an internal pilot for tens of users, possibly
   around one hundred readers, hosted on one company Windows laptop.
6. JSON storage is intentional for this phase. Do not introduce a database
   without explicit approval, but do not claim JSON is horizontally scalable.
7. Ordinary history is retained for 30 days. Saved/followed items and protected
   workflow records survive ordinary history cleanup until explicitly removed.
8. Features should work in both Vite development and the built portable server
   without changing frontend API addresses.

## Privacy and identity rules

- The backend may resolve the real client IP for trusted-proxy diagnostics and
  privileged access checks.
- Stored analytics and legacy viewer identity use a keyed hash; raw IPs are not
  the normal persistent identity.
- For You uses a random signed HttpOnly browser cookie and stores only its keyed
  hash. Two browsers behind the same NAT should have separate private mixes.
- A viewer can choose a unique display name. Renaming must update the displayed
  identity without changing the underlying viewer identity.
- The current user's own real detected IP may be shown to that user in their
  settings, but it must not be exposed in public/team analytics.
- Saved, Hide, preferences, private URL briefings, and passive recommendation
  telemetry are viewer-specific.
- Review Queue and Approved Briefing are team workflow surfaces. Destructive
  workflow operations retain ownership/admin-key protections.
- Never use individual reading analytics as an employee-performance measure.

## Feedback semantics

- **Hide**: remove a story only from the current viewer's experience. Do not
  train the shared Bouncer.
- **Saved / Follow**: private long-lived user investment. It contributes to
  related-story ranking for a bounded recent window and can surface an
  `Update to a story you saved` label.
- **Interested**: explicit positive relevance signal.
- **Not Interested**: explicit negative action that participates in the shared
  Gatekeeper/Bouncer training flow. This is not the same as Hide.
- **Select for review**: place a story in the shared editorial review queue with
  actor/ownership metadata.
- **Approve**: protected team action requiring the approval key.
- **VOC**: available to ordinary users even when analytics is privileged; the
  automatic prompt should be rare and at most once for a new viewer.

## Safety and change discipline

- Reproduce bugs before editing when practical.
- Inspect code and tests; do not use guess-and-check architecture changes.
- Preserve source catalogs and runtime data. Never regenerate or overwrite
  `sites.json` casually.
- Do not delete rollback files merely because current serving no longer reads
  them.
- Do not expose Samsung tokens, endpoints, `.env` contents, user names, or
  runtime analytics in Git history or terminal output.
- Never solve certificate problems with `verify=False` or an SSL-disable flag.
- Do not commit/push unless the user asks. Before any requested push, inspect the
  diff, run tests/build, verify author identity, and confirm the remote.
