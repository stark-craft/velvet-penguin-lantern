---
name: sense-project-memory
description: Resume work on the Sense.AI / Samsung TechScout repository without losing its architecture, backend pipeline, unified-corpus migration, personalization rules, design decisions, Windows portable deployment model, GitHub policy, completed work, or roadmap. Use before planning, editing, testing, reviewing, deploying, committing, or explaining anything in this repository.
metadata:
  audience: coding-agents
  project: sense-ai
  repository: stark-craft/velvet-penguin-lantern
---

# Sense.AI project memory

This skill is the portable handoff for the project. It exists so a new coding
agent can continue from the current state instead of reconstructing months of
decisions from chat history.

## Required first-session reading

Before making any change in a fresh session, read these files completely and in
this order:

1. `references/project-charter.md`
2. `references/architecture-and-data-flow.md`
3. `references/product-and-design-decisions.md`
4. `references/operations-and-quality.md`
5. `references/current-state-and-roadmap.md`

After that, inspect `git status`, the relevant code, and its tests. The reference
files are a map, not a substitute for verifying the live implementation.

## Workflow for every task

1. Restate the requested outcome and identify whether it is explanation,
   diagnosis, implementation, deployment, or Git work.
2. Confirm the active target is `legacy_app/`.
3. Inspect the relevant implementation and tests before proposing or editing.
4. Preserve all unrelated dirty work.
5. Make the smallest coherent change that satisfies the product intent without
   violating privacy, unified-corpus, same-origin, scheduler, or JSON
   single-worker constraints.
6. Add or update focused tests for behavior changes.
7. Run frontend tests/build, backend tests, and browser QA in proportion to the
   risk.
8. Report evidence, limitations, and remaining work plainly. Never convert an
   unverified assumption into a success claim.
9. Update `references/current-state-and-roadmap.md` when a meaningful milestone
   or architectural decision changes.

## Source-of-truth priority

When files disagree, use this order:

1. the user's newest explicit instruction;
2. live code and tests in `legacy_app/`;
3. `legacy_app/.env.example`;
4. these project-memory references;
5. `legacy_app/docs/` and the Windows guides;
6. older top-level application code and documentation.

Never silently resurrect the former Default/Broadcast IP-routing architecture
because an older guide still describes it.
