# News Scrapper — “For You” and Responsible Hook Implementation Plan

Status: **implemented; For You and grounded hooks are now the standard landing
experience**. No legacy profile, source file, history, Bouncer, workflow store,
or rollback data was deleted. Semantic affinity, unified shadow writes, and
unified serving remain independently controlled by the feature flags in
`.env.example`. The shared Briefing remains a permanent deterministic view and
the three enabled experience flags remain explicit rollback switches.

## 1. Executive decision

Build a separate **For You** experience, but do not treat personalization as a
replacement for editorial quality or access control.

The recommended product model is:

- **For You**: a private, explainable, personally ranked feed;
- **Briefing**: a shared, deterministic editorial baseline;
- **Review Queue / Approved Briefing**: the existing team workflow;
- **Saved / Following**: private user investment that improves future ranking.

Do not port X's production model or infrastructure. Reuse only the architectural
pattern of candidate collection, filtering, scoring, diversity, selection, and
feedback. The current pilot already has MiniLM, semantic clusters, JSON state,
viewer actions, saved stories, and an explainable ranking service. Extend those
assets first.

Do **not** immediately delete the Broadcast profile, its sources, its history,
its workflow state, or its Bouncer. First move to a unified content schema and
one scheduler orchestration cycle behind feature flags. Retire the legacy
profile only after migration reconciliation and endpoint-level regression tests.

### 1.1 Scope boundary

This plan applies only to `legacy_app` and its News Scrapper surface. Do not
change Venture Lens. Do not replace Scrapy, Samsung Web Search, Samsung Chat,
MiniLM, BART/FLAN fallbacks, exports, Gatekeeper, Korean translation, or the
portable Windows hosting model. Compose the new recommendation layer around
those capabilities and repair only the audited defects called out below.

### 1.2 Architecture references

Use the public X implementation as an architecture reference, not as source
code to transplant:

- [xAI/X recommendation repository](https://github.com/xai-org/x-algorithm)
- [Phoenix candidate pipeline](https://github.com/xai-org/x-algorithm/blob/main/home-mixer/candidate_pipeline/phoenix_candidate_pipeline.rs)
- [Weighted scorer](https://github.com/xai-org/x-algorithm/blob/main/home-mixer/scorers/weighted_scorer.rs)
- [X product explanation of For You](https://help.x.com/en/resources/recommender-systems/for-you-home-timeline-recommendations)

Borrow the sequence of viewer hydration, candidate collection, eligibility
filtering, multi-signal scoring, diversity, selection, visibility checks, and
feedback. Do not copy its social graph, Phoenix/Grok models, Rust/Kafka serving
stack, production weights, or raw-engagement objective.

## 2. What “create a hook” should mean

There are two separate hooks.

### 2.1 Content hook

The card must answer, before the user opens it:

1. What changed?
2. Why should this user care?
3. Why now?
4. What could it affect?
5. How strong is the evidence?

This is not clickbait. Preserve the source headline and place the product's
context underneath it as a separately labelled, AI-generated field.

### 2.2 Product hook

The user needs a reason to return tomorrow. The healthy loop is:

```text
New development or followed-story update
→ scan a short trusted brief
→ find something relevant to current work
→ save, follow, select, hide, or tune interests
→ tomorrow's briefing becomes more useful
```

The product promise should be:

> In five minutes, know what changed and what deserves your attention.

Do not optimize for endless scrolling or maximum minutes spent. Optimize for
fast comprehension and useful downstream actions.

## 3. Audited current state

The implementation agent must read these files before editing anything:

- `news_scrapper/application.py`
- `news_scrapper/personalization.py`
- `core/profile.py`
- `core/settings.py`
- `news_scrapper/adapters/samsung_chat.py`
- `news_scrapper/semantic_clustering.py`
- `news_scrapper/config/sites.json`
- `news_scrapper/config/sites_broadcast.json`
- `news-ui/src/news-scrapper/App.jsx`
- `news-ui/src/news-scrapper/api.js`
- `news-ui/src/news-scrapper/screens/FeedScreen.jsx`
- `news-ui/src/news-scrapper/components/ArticleCard.jsx`
- `news-ui/src/news-scrapper/components/modals/ArticleModal.jsx`
- `news-ui/src/news-scrapper/utils/intelligence.js`
- `news-ui/src/news-scrapper/utils/normalize.js`
- `news-ui/src/news-scrapper/utils/tracking.js`
- `docs/PERSONALIZATION_ARCHITECTURE.md`

### 3.1 Features that already exist

- `/latest-briefing` calls `PersonalizationService.rank_articles(...)`.
- Viewer actions are stored with a 30-day decay window.
- Interested, Not Interested, Save, Select, dossier open, article click, Hide,
  private briefing open, and archive import already have ranking weights.
- Saved-story updates can receive the private label
  `Update to a story you saved`.
- Saved and hidden articles are viewer-specific.
- Personalization changes order rather than deleting shared content.
- Default and Broadcast personalization are currently isolated.
- The scheduler already has one APScheduler job that sequentially processes the
  Default and Broadcast profiles every four hours.
- Scheduler retries, manual-scan deferral, and coalesced training are already
  covered by resilience tests.

### 3.2 Gaps and defects to fix before claiming “For You”

1. The existing personalized order is mostly invisible to users.
2. `FeedScreen` groups the returned list with `groupedByDate()`, and that helper
   sorts by publication time again. The main grid can therefore discard the
   backend's personalized ordering.
3. The only broad explanation is a short-lived personalization toast.
4. `Why This Matters` is normally hidden inside the dossier, after the click;
   there is no pre-click attention hook.
5. No explicit topic, outcome, region, or source-family onboarding exists.
6. No true card-impression, meaningful dwell, source-open, scroll-depth, or
   feed-position events exist.
7. The `useTracking()` `fired` ref can prevent page-load and heartbeat tracking
   from restarting correctly after client-side route changes.
8. Personalization identity is keyed only by hashed IP, while analytics identity
   combines IP and browser fingerprint. Two employees behind the same NAT/proxy
   can receive one combined “personal” feed.
9. Source categories are not a stable user-facing taxonomy.
10. Default and Broadcast have separate sites, history, workflow, Bouncers,
    training data, region learning, and Not Interested stores. Deleting the
    profile switch without migrating all of them would lose behavior or mix
    incompatible training signals.
11. `news-ui/src/news-scrapper/api.js` calls an undefined
    `selectedProfile()` from the export path; the defined helper is
    `selectedProfileOverride()`.
12. `TechnologySignalPulse` remains defined in `FeedScreen.jsx` even though it
    is not part of the intended For You architecture. Do not reuse dead UI as
    the new product surface.
13. `article_click` and `briefing_view` are accepted by backend tracking but
    are not emitted reliably by the frontend.
14. Hide tracking is attempted before persistence completes, so a failed hide
    can still pollute analytics/personalization.
15. The live personal ranker uses exact feature overlap. MiniLM is used for
    story clustering, but the current request-time ranker does not yet use an
    embedding-derived viewer affinity.
16. The scheduler and its locks are process-local. JSON storage and scheduled
    execution therefore require one Uvicorn worker until a transactional store
    and distributed lock are introduced.

## 4. Non-negotiable product rules

1. The original source headline must always remain visible.
2. AI context must be labelled and must never invent urgency, facts, dates,
   numbers, consequences, or disagreement.
3. Briefing must remain available as a non-personalized baseline.
4. Eligibility/access filtering runs before personalization.
5. Personal preference must never grant access to restricted content.
6. Passive behavior must never train the shared Bouncer.
7. Hide remains private. Not Interested preserves its existing explicit
   gatekeeper/Bouncer semantics until a separately approved migration.
   Add a separate **Less like this** action for ordinary private recommendation
   feedback; do not let it remove shared content or train the shared Bouncer.
8. A card impression or hover is not evidence of interest.
9. The user must have Edit, Pause, Explain, and Reset controls.
10. The system must never infer sensitive employee traits or present individual
    reading analytics as employee-performance evidence.
11. No per-user physical feed file should be generated. Rank the shared corpus
    at request time.
12. JSON storage remains acceptable for the current single-worker pilot, but the
    design must not claim multi-worker safety.

## 5. Target user experience

### 5.1 Navigation

Add **For You** as the first primary navigation item.

Recommended order:

```text
For You | Briefing | Scan | [User]'s Desk | Review Queue | Approved
```

Keep Briefing. Do not rename Briefing to For You.

### 5.2 Stable landing behavior

Do not bounce new users unpredictably between routes.

- `/for-you` always renders a useful page.
- A new or unconfigured viewer sees **Starter Mix** plus a 30-second setup.
- A configured viewer with insufficient behavior sees
  **Tuned from your choices**.
- Only after a confidence threshold is met should the page say
  **Personalized for [name]**.
- `Skip for now` produces a balanced Starter Mix and never blocks access.
- Briefing is always one click away.
- When the feature flag is enabled for production, `/` should redirect to
  `/for-you`; during rollout it should continue to redirect to `/home`.

### 5.3 Thirty-second interest setup

Use a polished three-step sheet, not a long settings form.

Step 1 — Pick 3–5 intelligence beats:

- AI Models and Agents
- Devices, Displays and Smart Home
- Semiconductors and Compute
- Robotics and Automation
- Cloud, Enterprise and Security
- Policy, Markets and Regulation
- Broadcast, Media and Distribution
- Samsung and Competitor Moves

Step 2 — Pick useful work outcomes:

- Product launches
- Competitive moves
- Regulation
- Research breakthroughs
- Partnerships and investment
- Market shifts
- Risks and incidents
- Follow-ups to saved stories

Step 3 — Pick broad source families:

- Official and primary sources
- Research and standards bodies
- Independent technology press
- Business and financial press
- Industry and trade press
- Regulatory and public-sector sources
- India and regional sources

Also include:

- region preference: Global, India/Local, or Balanced;
- a visible `Surprise me` control, enabled by default;
- `Skip for now`;
- `Save my mix`;
- an explanation that these choices affect order, not factual content.

Do not show 166 individual source checkboxes during onboarding. Individual
source controls may be an advanced setting later.

### 5.4 For You page information architecture

The page should not be the existing Briefing grid in a different order.

Recommended structure:

1. Header:
   - `Good morning, Vineet`;
   - `Here are five signals that may matter today`;
   - `Tuned for you`, `Edit interests`, and `Why these stories?`.
2. `What changed since your last visit`:
   - 1 lead story;
   - 2–4 compact developments;
   - never repeat the same semantic cluster.
3. `Your five-minute executive scan`:
   - a finite group of five cards;
   - visible progress, such as `2 of 5 reviewed`;
   - no infinite-scroll mechanics.
4. `Updates to stories you follow`:
   - only when a saved/followed story has a credible semantic update;
   - label the exact saved story that created the match.
5. `Important outside your usual lane`:
   - a deliberate exploration/diversity module;
   - explain that it is included to avoid a narrow filter bubble.
6. `More for you`:
   - cursor-based results;
   - preserved workflow actions and filters.

### 5.5 Card anatomy

Each For You card should contain:

```text
[Reason chip: Because you follow AI agents]
[Original source headline]
[AI context label]
[Attention hook: 18–35 grounded words]
[Why now / what changed]
[Source count] [confidence] [reading time]
[Why am I seeing this?]
[Open 30-second brief] [Save/Follow] [Select] [Hide] [👍] [👎]
```

Do not replace the original headline with the generated hook.

### 5.6 Dossier changes

At the top of the dossier, show:

- source headline and attribution;
- `What changed`;
- summary lead and bullets;
- `Why this matters`;
- `What to watch next`;
- recommendation reasons;
- sources and evidence count;
- existing workflow controls.

Record meaningful dwell only while the dossier is visible and the browser tab
is active.

## 6. Hook content contract

Add these optional article/cluster fields:

```json
{
  "attention_hook": "A grounded 18–35 word reason to care now.",
  "what_changed": "The concrete new development.",
  "why_now": "The timing or decision-window context.",
  "watch_next": "A verifiable event or signal to monitor next.",
  "hook_type": "change|risk|opportunity|follow_up|disagreement|watch",
  "hook_source": "samsung_chat|local_fallback",
  "hook_grounded": true
}
```

### 6.1 Samsung Chat prompt changes

Extend the strict JSON contract in
`news_scrapper/adapters/samsung_chat.py::summarize_article_with_chat`.

Rules to include in the prompt:

- use only supplied article/cluster evidence;
- preserve qualifications and uncertainty;
- no rhetorical curiosity gaps;
- no `You won't believe`, `shocking`, `game-changing`, or invented urgency;
- no unsupported business consequence;
- hook must be 18–35 words;
- `what_changed` and `watch_next` must be independently understandable;
- return an empty string if evidence does not support a field.

Generate once per semantic story cluster, not once for every duplicate source.

### 6.2 Local fallback

If Chat is unavailable:

1. use an existing, non-weak `why_it_matters` sentence;
2. otherwise use the first factual summary sentence;
3. prefix only with a truthful label such as `What changed:`;
4. set `hook_source=local_fallback`;
5. never synthesize risk or opportunity from keywords alone.

### 6.3 Validation

Reject or clear a generated hook when:

- it introduces a number, date, or named entity absent from the evidence;
- it is substantially identical to the headline;
- it exceeds the length contract;
- it contains banned hype phrases;
- it contradicts the summary;
- the model response cannot be parsed safely.

## 7. Recommendation architecture

Use a composable pipeline inspired by the public X architecture, adapted to
this application's size:

```text
Resolve viewer identity and entitlement
→ load explicit preferences and recent actions
→ collect candidates from the shared briefing corpus
→ hydrate article features and recommendation context
→ apply eligibility and privacy filters
→ compute explainable scores
→ apply source/topic/cluster diversity
→ select page and produce reason codes
→ return results
→ record impressions and meaningful actions in batches
```

Create a new backend package:

```text
news_scrapper/recommendation/
|-- __init__.py
|-- router.py
|-- schemas.py
|-- identity.py
|-- preferences.py
|-- events.py
|-- candidates.py
|-- scoring.py
|-- diversity.py
|-- hooks.py
|-- service.py
`-- migration.py
```

Do not move the crawler, adapters, semantic clustering, or exports into this
package.

### 7.1 Candidate groups

Collect candidates from:

- globally important shared briefing stories;
- explicit topic/source-family matches;
- recent behavior matches;
- saved/followed-story semantic matches;
- unseen fresh stories;
- controlled exploration outside normal interests.

For V1, score all retained daily briefing candidates. There is no need for a
vector database at the current volume.

### 7.2 Eligibility filters

Run these before scoring:

- viewer is entitled to the article audience;
- article was not globally removed;
- article is within retention policy;
- article is not personally hidden;
- article is not a duplicate canonical URL;
- only one representative per semantic cluster unless the UI explicitly asks
  for source-level coverage;
- malformed or unhydrated article is excluded from For You but remains visible
  in operations diagnostics.

### 7.3 V1 explainable scoring

Normalize components to `0.0–1.0`. Store weights in configuration, not scattered
through UI/backend code.

Initial score:

```text
0.38 × editorial importance
+ 0.14 × freshness
+ 0.10 × source/cluster confidence
+ 0.16 × explicit topic/outcome match
+ 0.08 × behavioral affinity
+ 0.05 × source-family affinity
+ 0.06 × saved/followed-story similarity
+ 0.03 × novelty/exploration
- 0.18 × personal negative affinity
- 0.10 × recently-seen penalty
```

These are rollout defaults, not permanent truth. Validate them against pilot
behavior and VOC before changing them.

Signal rules:

| Signal | Ranking meaning |
|---|---|
| Explicit topic/outcome choice | strong positive |
| Save/follow | strongest private positive |
| Select for review | strong operational positive |
| Interested | strong positive |
| Dossier open plus meaningful dwell | moderate positive |
| Source open | moderate positive |
| Plain dossier open | weak positive |
| Card impression | neutral; seen-state only |
| Hover | ignored |
| Hide | strong private negative |
| Not Interested | strong negative plus unchanged Bouncer flow |
| Old behavior | linearly or exponentially decayed |

Do not infer positive interest from a card merely appearing on screen.

### 7.4 Confidence ramp

Use behavior only when enough evidence exists:

- 0 meaningful actions: Starter Mix;
- 1–4 actions or one session: explicit choices dominate;
- 5+ meaningful actions across 2 sessions: label as personalized;
- 20+ meaningful actions: behavior may use its full configured weight.

Implement `behavior_confidence = min(1, meaningful_events / 20)` and multiply
only the behavioral component by this value.

### 7.5 Diversity selector

After scoring, rerank with these first-page constraints:

- maximum two cards from one publisher in the first ten;
- maximum three cards from one broad topic in the first ten;
- maximum one representative from a semantic cluster;
- at least two shared institutional-priority stories in the first ten;
- reserve 10–20% for explained exploration;
- do not allow diversity logic to reintroduce hidden/ineligible content.

Return both the raw score and post-diversity position for diagnostics.

### 7.6 Recommendation explanation

Every item must return machine-stable reason codes plus readable text:

```json
{
  "recommendation": {
    "score": 0.84,
    "reason_codes": ["explicit_topic", "fresh", "multi_source"],
    "reasons": [
      "Matches your AI Models and Agents preference",
      "New since your last visit",
      "Confirmed across three sources"
    ],
    "starter_mix": false,
    "exploration": false,
    "seen_before": false
  }
}
```

## 8. Viewer identity and privacy

Per-user personalization cannot reliably use IP alone. NAT, reverse proxies,
VPNs, DHCP, and shared machines can merge or split viewers.

### 8.1 Recommended identity

Introduce a random, server-issued, signed, HttpOnly, SameSite=Lax cookie. Store
only a keyed hash of its value in JSON. Keep the IP hash for routing diagnostics
and migration, not as the primary recommendation identity.

Requirements:

- same browser retains one private feed;
- different browsers on one IP do not share preferences;
- changing the display name does not change identity;
- raw IP is never stored in recommendation event files;
- tampered/invalid cookies generate a new anonymous viewer identity;
- provide `Reset this desk` for shared workstations;
- preserve the existing viewer display-name uniqueness rule.

### 8.2 Migration from IP-keyed data

Do not destructively move data on first request.

1. Create the cookie identity.
2. Detect existing legacy IP-keyed profile/saved/hidden/personalization data.
3. If a known display name exists, ask `Continue as [name]?`.
4. On confirmation, copy legacy state into the new key and mark
   `migrated_from_legacy_key`.
5. Preserve the legacy source as rollback data for at least one release.
6. Never silently give a new browser another employee's history merely because
   the IP matches.

## 9. JSON storage plan

For the current single-worker portable pilot:

```text
news_scrapper/runtime/recommendation/
|-- article_features.json
|-- taxonomy.json
|-- migration_state.json
`-- viewers/
    `-- <hashed-viewer-id>.json
```

Example viewer document:

```json
{
  "schema_version": 1,
  "preferences": {
    "topics": ["ai_models", "semiconductors"],
    "outcomes": ["competitive_moves", "research"],
    "source_families": ["primary", "research"],
    "regions": ["global"],
    "surprise_me": true,
    "completed_at": "ISO-8601"
  },
  "events": [],
  "served": {},
  "last_visit_at": "ISO-8601",
  "personalization_paused": false
}
```

Rules:

- keep active behavioral events 30 days initially;
- keep explicit preferences until changed;
- keep saved snapshots according to existing saved behavior;
- cap events and served IDs;
- use atomic replacement and process-level locks;
- batch passive events so one card impression does not rewrite a large JSON file;
- document that multiple Uvicorn workers are unsupported until storage moves to
  a transactional database.

## 10. Telemetry contract

Add a batched endpoint rather than one request per visible card:

```http
POST /viewer/recommendation-events
```

Event shape:

```json
{
  "feed_request_id": "opaque-id",
  "events": [
    {
      "event_id": "client-generated-id",
      "action": "qualified_impression",
      "article_id": "stable-article-id",
      "cluster_id": "cluster-id",
      "surface": "for_you",
      "position": 3,
      "occurred_at": "ISO-8601",
      "active_ms": 2400,
      "visible_ratio": 0.72
    }
  ]
}
```

Allowed events:

- `qualified_impression`: at least 50% visible for at least 1.5 seconds;
- `dossier_open`;
- `dossier_dwell`: bucketed active time on close/visibility change;
- `source_open`;
- `save` / `unsave`;
- `select`;
- `interested`;
- `not_interested`;
- `hide`;
- `why_this_story_open`;
- `interest_edit`;
- `feed_refresh`.

Requirements:

- deduplicate by `event_id`;
- ignore client-supplied viewer IDs;
- validate article IDs against served/current candidates where appropriate;
- use `navigator.sendBeacon` or `fetch(..., {keepalive:true})` for final dwell;
- count active, visible time only;
- impression creates seen-state but never positive interest;
- passive events do not train the Bouncer;
- preserve current explicit action endpoints during migration.

## 11. Backend API plan

Create these endpoints:

```text
GET  /for-you?cursor=&limit=20
GET  /viewer/recommendation-status
GET  /viewer/preferences
PUT  /viewer/preferences
POST /viewer/preferences/complete
POST /viewer/preferences/pause
POST /viewer/preferences/reset
POST /viewer/recommendation-events
GET  /briefing/shared/latest
```

### 11.1 `/for-you`

Return:

- ranked items;
- cursor;
- feed request ID;
- mode: `starter`, `configured`, or `learned`;
- confidence;
- last-visit timestamp;
- recommendation explanations;
- counts for follow-up, exploration, and new-since-last-visit modules;
- no raw IP, model vectors, or sensitive internal scores.

### 11.2 Shared Briefing compatibility

Do not break `/latest-briefing` immediately.

1. Add `/briefing/shared/latest` for deterministic editorial order.
2. Move the Briefing UI to the new shared endpoint.
3. Keep `/latest-briefing` as a compatibility wrapper for one release.
4. Mark the wrapper deprecated in logs/tests.
5. Remove only after every frontend and deployment script uses the new endpoint.

### 11.3 Composition root

Add `for-you` and new API roots to the `API_ROUTES` catch-all protection in
`main.py`. Include the recommendation router before the frontend catch-all.

## 12. Unified sources and scheduler migration

### 12.1 Important correction

“One scheduler run” should mean one orchestration cycle, not one undifferentiated
keyword query sent to every source.

Current inventory:

- `sites.json`: 107 entries, 79 enabled;
- `sites_broadcast.json`: 59 entries, all enabled;
- 166 total source records and 138 enabled records;
- 98 Default records declare `rss_url`, while Broadcast declares none;
- nine domains appear in both files;
- same-domain entries may target different paths/feeds and must not be deduped by
  domain alone.

Critical crawler correction: the current
`news_scrapper/crawler/news_aggregator/spiders/universal_spider.py`
`build_initial_requests()` starts from `site["url"]`. It does not prefer the 98
declared `rss_url` values and does not make `allow_deep_scan` operational.
Eighteen NVIDIA definitions share a homepage while pointing to distinct topical
RSS feeds. A naive domain/homepage merge would silently destroy those feeds.
The unified-source phase must therefore fix RSS-first request generation and
preserve path/feed-level source identity before any scheduler cutover.

### 12.2 Unified site schema

Create a versioned schema and migration script. Example:

```json
{
  "schema_version": 2,
  "sites": [
    {
      "id": "stable-source-id",
      "name": "Indian Broadcasting World",
      "url": "https://www.indianbroadcastingworld.com/",
      "domain": "indianbroadcastingworld.com",
      "rss_url": null,
      "enabled": true,
      "allow_deep_scan": true,
      "verticals": ["broadcast"],
      "audiences": ["all"],
      "source_family": "industry_trade",
      "keyword_pack": "broadcast",
      "topic_tags": ["broadcast", "dth", "cable"]
    }
  ]
}
```

Use stable IDs. Treat exact canonical URL/path as part of source identity.

### 12.3 Broadcast policy decision

The request says broadcast news may appear in the shared Briefing, which implies
it is not confidential. The rollout should nevertheless preserve the existing
behavior until management explicitly confirms that assumption.

Support two modes:

```env
BROADCAST_VISIBILITY_MODE=interest
```

- `interest`: all employees may access broadcast content; For You shows it only
  when explicitly selected or when controlled exploration allows it.

```env
BROADCAST_VISIBILITY_MODE=restricted
```

- `restricted`: only entitled viewers may see it anywhere, including Briefing,
  Scan, History, exports, dossiers, and direct endpoints.

Never use a ranking preference as an authorization decision.

### 12.4 One-cycle scheduler flow

Target flow:

```text
APScheduler tick
→ capability preflight once
→ build crawl plans by keyword_pack/vertical
→ crawl/discover plans with bounded parallelism or safe sequencing
→ Web Search enrichment or Scrapy fallback per plan
→ apply the correct vertical-specific Bouncer
→ normalize and attach vertical/audience/source-family metadata
→ merge candidates
→ canonical and semantic deduplication
→ one cross-vertical clustering pass
→ Chat summary + hook generation or local fallback
→ write one shared briefing archive
→ purge retention
→ expose one scheduler status with sub-run diagnostics
```

Persist a durable `scheduler_state.json` with run ID, scheduled time, current
stage, completed partitions, failures, retry state, publish timestamp, and next
due time. Retry only failed partitions. Publish atomically only when all
required partitions succeed; keep serving the previous complete briefing while
a run is partial or failed.

Keep these model/training boundaries initially:

- technology/default Bouncer and training examples;
- broadcast Bouncer and training examples;
- region-learning provenance;
- Gatekeeper decision provenance.

An article's `vertical` decides which Bouncer evaluates it. Do not merge the two
PKL files or training datasets merely because the final corpus is shared.

### 12.5 Migration sequence

1. Add schema fields to both existing files without changing behavior.
2. Build and test a deterministic merger script.
3. Generate a candidate unified file and a machine-readable collision report.
4. Resolve duplicates by canonical URL/path, not domain alone.
5. Add `UNIFIED_CORPUS_ENABLED=false` and dual-read support.
6. In shadow mode, run legacy and unified plans and compare counts, domains,
   dates, keyword matches, drops, clusters, and final article identities.
7. Enable unified writes while retaining legacy files.
8. Reconcile latest/history/workflow/training state.
9. Switch readers to shared corpus.
10. Remove legacy profile switching from ordinary UI.
11. Keep compatibility files and rollback for at least one release.
12. Delete only after backup, migration report, and production sign-off.

## 13. Frontend file plan

### 13.1 New files

```text
news-ui/src/news-scrapper/for-you/
|-- ForYouScreen.jsx
|-- for-you.css
|-- InterestSetup.jsx
|-- ForYouCard.jsx
|-- RecommendationReason.jsx
|-- SinceLastVisit.jsx
|-- ExecutiveScan.jsx
|-- FollowedUpdates.jsx
|-- ExplorationRail.jsx
|-- useRecommendationEvents.js
`-- recommendationState.js
```

### 13.2 Existing files to change

- `App.jsx`: add `/for-you`, gated root redirect, and stable viewer setup.
- `TopBar.jsx`: add For You and keep Briefing.
- `api.js`: add preference/feed/event/shared-briefing wrappers.
- `FeedScreen.jsx`: become the shared Briefing surface; stop claiming its order
  is personalized after the migration.
- `utils/intelligence.js`: add a grouping helper that preserves supplied order;
  do not use `groupedByDate()` for For You.
- `utils/tracking.js`: fix route-change lifecycle; add batched recommendation
  events separately.
- `utils/normalize.js`: preserve hook and recommendation fields.
- `ArticleCard.jsx`: retain shared card behavior; reuse only safe primitives.
- `ArticleModal.jsx`: show hook/context/recommendation explanations and record
  active dwell.
- `SavedScreen.jsx`: expose followed-story relationship and preference reset.
- `AnalyticsScreen.jsx`: show aggregate For You quality metrics, not just minutes.
- translation dictionary/model path: add all new static UI labels without making
  recommendation logic language-dependent.

During corpus migration, expose a backend capability such as
`profile_mode: "legacy" | "unified"`. Continue sending `X-Sense-Profile` and
showing operations-only profile controls in legacy mode. Stop sending it, clear
stale `news-profile`/`news-profile-override` storage, and hide the switch only
after the backend confirms unified mode. This prevents a frontend deployment
from breaking the currently important IP/profile routing path.

### 13.3 Rendering correctness

For You must preserve backend order. If visually grouping by date, iterate in
ranked order and insert date labels without sorting again. Add a unit test that
passes deliberately out-of-date-order personalized items and asserts their
rendered/ranked sequence is unchanged.

## 14. Analytics and success criteria

Primary metrics:

- time to first useful action;
- qualified-impression → dossier-open rate;
- meaningful dossier dwell;
- source-open rate;
- Save/Follow rate;
- Select-for-review rate;
- explicit `Useful / Not useful` response;
- Hide and Not Interested rate;
- duplicate cluster/source/category rate in first ten;
- hook-correction or accuracy complaint rate.

Secondary metrics:

- seven-day return rate;
- percentage completing interest setup;
- percentage using `Why am I seeing this?`;
- percentage resetting or pausing personalization.

Do not use total minutes as the primary success metric.

Run the unchanged Briefing as control. For You succeeds only if useful actions
improve without a material increase in hides, complaints, misleading context,
or loss of source diversity.

## 15. Feature flags and environment variables

Current documented defaults:

```env
FOR_YOU_ENABLED=true
FOR_YOU_DEFAULT_LANDING=true
FOR_YOU_HOOKS_ENABLED=true
FOR_YOU_SEMANTIC_AFFINITY_ENABLED=false
FOR_YOU_EVENT_BATCH_SIZE=10
FOR_YOU_EVENT_FLUSH_SECONDS=15
FOR_YOU_EXPLORATION_PERCENT=15
UNIFIED_CORPUS_ENABLED=false
LEGACY_PROFILE_ROUTING_ENABLED=true
BROADCAST_VISIBILITY_MODE=interest
```

The user-facing experience is active by default while unified-corpus migration
remains legacy-safe and disabled. Validate environment values at startup and
print one concise capability summary without secrets.

## 16. Implementation phases and commit boundaries

### Phase 0 — Baseline and defect repairs

Goal: make existing evidence trustworthy before adding a new page.

Tasks:

1. Snapshot tests and fixtures.
2. Fix personalized-order loss caused by date regrouping.
3. Fix route-change page-load/heartbeat lifecycle.
4. Fix the undefined export profile-helper call.
5. Make Hide tracking authoritative only after persistence succeeds.
6. Add stable article/cluster/source IDs where missing.
7. Add no-op feature flags and config validation.

Acceptance:

- existing 26 targeted personalization/profile/resilience/safeguard tests pass;
- full backend and frontend tests pass;
- personalized rank order survives UI normalization/grouping;
- exports still honor the active legacy profile while compatibility mode is on;
- route navigation restarts page-load and heartbeat tracking once per route;
- failed Hide requests create neither analytics nor ranking events;
- no production route changes while flags are off.

Suggested commit: `Stabilize feed ordering and tracking lifecycle`.

### Phase 1 — Identity and preference foundation

Goal: real browser-scoped private state and cold-start choices.

Tasks:

1. Signed viewer cookie.
2. non-destructive IP-key migration flow;
3. preference schema/store/API;
4. pause/reset/edit controls;
5. onboarding UI behind `FOR_YOU_ENABLED`.

Acceptance:

- two browsers behind one IP receive different viewer keys and preferences;
- rename preserves identity;
- invalid cookie does not expose another viewer's data;
- skip setup returns a Starter Mix;
- saved/hidden legacy state remains intact.

Suggested commit: `Add private viewer preferences and cold start`.

### Phase 2 — Hook enrichment

Goal: make cards worth opening without misleading users.

Tasks:

1. extend Samsung Chat contract;
2. add grounded validation;
3. add deterministic local fallback;
4. preserve fields through normalization/history/export where appropriate;
5. add hook UI to For You cards and dossier.

Acceptance:

- Chat success and failure fixtures produce the same schema;
- invented or malformed hook fields are rejected;
- original headline remains visible;
- no hook blocks article ingestion if generation fails.

Suggested commit: `Add grounded attention context to article clusters`.

### Phase 3 — Recommendation service V1

Goal: explicit, explainable, deterministic personalized ranking.

Tasks:

1. candidate/filter/scorer/diversity service;
2. `/for-you` and status endpoints;
3. Starter Mix and confidence ramp;
4. explanation reason codes;
5. retain existing Bouncer semantics.

Acceptance:

- same corpus + viewer state produces stable ordering;
- different viewers produce different ordering when evidence differs;
- low-quality content cannot win solely from affinity;
- hidden/removed/ineligible content never returns;
- first ten satisfy diversity constraints;
- Briefing order remains shared and deterministic.

Suggested commit: `Add explainable For You recommendation service`.

### Phase 4 — Dedicated For You frontend

Goal: deliver the content and product hook.

Tasks:

1. route/navigation;
2. Starter Mix/setup;
3. since-last-visit;
4. five-minute executive scan;
5. followed-story updates;
6. exploration rail;
7. reason UI and workflow actions;
8. responsive, light/dark, Korean, keyboard, and screen-reader states.

Acceptance:

- all existing actions work from For You;
- route reload/deep link works in Vite and built FastAPI deployment;
- no visual order mutation;
- responsive at 390, 820, 1280, and 1920 px;
- light/dark and Korean/English remain usable;
- loading, empty, error, paused, and offline states are designed.

Suggested commit: `Build the For You intelligence experience`.

### Phase 5 — Telemetry and evaluation

Goal: measure usefulness without training on noise.

Tasks:

1. qualified impression observer;
2. active dossier dwell;
3. batched idempotent endpoint;
4. aggregate analytics;
5. A/B or feature-cohort reporting.

Acceptance:

- impression fires once per served card/request;
- hidden browser tab time is excluded;
- retrying a batch does not double-count;
- passive signals do not train Bouncer;
- admin analytics clearly distinguish Briefing and For You.

Suggested commit: `Add privacy-aware recommendation telemetry`.

### Phase 6 — Unified corpus shadow mode

Goal: one scheduler orchestration without losing vertical quality.

Tasks:

1. versioned unified source schema;
2. deterministic migration and collision report;
3. RSS-first spider request generation with direct-web fallback;
4. operational `allow_deep_scan` and discovery-mode handling;
5. keyword-pack crawl planning;
6. vertical-specific Bouncer selection;
7. durable scheduler stage/partition state;
8. shared normalized archive in shadow mode;
9. parity diagnostics.

Acceptance:

- no enabled source is silently lost;
- all 166 source records and 138 enabled records survive migration;
- all configured RSS entrypoints remain distinct, including NVIDIA topic feeds;
- RSS and direct-web sources remain covered;
- Samsung and Scrapy fallback paths remain covered;
- dates and keyword matching remain valid;
- every article retains vertical, audience, source-family, Bouncer provenance;
- scheduler retry/misfire/manual deferral tests remain green.

Suggested commit: `Add shadow-mode unified intelligence corpus`.

### Phase 7 — Cutover and legacy profile retirement

Goal: activate one shared corpus safely.

Tasks:

1. reconcile histories/workflows/training/region data;
2. enable unified corpus for test cohort;
3. remove ordinary-user profile switch;
4. preserve operations rollback;
5. update deployment docs and `.env.example`;
6. archive, do not immediately delete, legacy files.

Acceptance:

- reconciliation counts and duplicate decisions are documented;
- no route leaks restricted content in restricted mode;
- For You Broadcast preference behaves as specified;
- Briefing, Search, History, exports, dossiers, Gatekeeper, workflow, and
  analytics agree on content visibility;
- one full four-hour scheduler cycle and one failure/retry cycle are observed;
- rollback to legacy corpus is tested.

Suggested commit: `Cut over to unified shared intelligence corpus`.

## 17. Test matrix

### Unit tests

- preference validation and taxonomy IDs;
- confidence ramp;
- explicit/behavioral/negative score contributions;
- time decay;
- saved-story similarity;
- seen penalty;
- diversity constraints;
- hook validator;
- audience eligibility;
- identity cookie validation;
- event idempotency.

### API tests

- new viewer Starter Mix;
- configured viewer;
- learned viewer;
- paused/reset viewer;
- two viewers on one IP;
- one viewer rename;
- cursor pagination stability;
- batched duplicate events;
- Briefing shared order;
- Broadcast interest mode;
- Broadcast restricted mode;
- unauthorized direct/history/search/export access.

### Scheduler/pipeline tests

- unified config migration count;
- nine overlapping domains preserved/resolved by source path;
- RSS source;
- direct website source;
- Samsung Web Search success;
- Web Search runtime failure → full Scrapy extraction;
- Samsung Chat success;
- Chat failure → local BART/FLAN fallback and hook fallback;
- vertical-specific Bouncer;
- cross-vertical dedup/cluster;
- partial sub-run failure and retry;
- sleep/misfire recovery;
- manual scan deferral;
- retention.

### Frontend tests

- route and navigation;
- onboarding keyboard/focus behavior;
- skip/setup/edit/pause/reset;
- recommendation order preserved;
- reason popover;
- impression threshold;
- dwell visibility handling;
- all card workflow actions;
- responsive/light/dark/Korean;
- empty/error/loading/offline;
- deep-link through FastAPI catch-all.

### Load/concurrency tests

- 10 simultaneous viewers;
- 100 simultaneous viewers;
- batched events while ranking;
- concurrent preference/save/hide writes;
- scheduler run while viewers request For You;
- Bouncer retraining queue while events arrive;
- confirm the documented one-worker boundary.

## 18. Rollout and rollback

The initial rollout followed this sequence; steps 1–7 are now complete:

1. Ship all flags off.
2. Enable hook fields internally without changing landing route.
3. Enable For You for developers/approved test cohort.
4. Compare For You with Briefing for at least one complete scheduler/history
   window.
5. Review hook accuracy and VOC manually.
6. Enable For You for broader pilot.
7. Enable default landing only after cold-start and error metrics are healthy.
8. Run unified corpus in shadow mode.
9. Cut over only after reconciliation.

Rollback must be one environment/config change:

```env
FOR_YOU_DEFAULT_LANDING=false
FOR_YOU_ENABLED=false
UNIFIED_CORPUS_ENABLED=false
LEGACY_PROFILE_ROUTING_ENABLED=true
```

Never require deleting migrated data to roll back.

## 19. Files that must not be deleted in the first implementation

- `news_scrapper/config/sites_broadcast.json`
- `bouncer_model_broadcast.pkl` and runtime equivalent;
- `trainingData_broadcast.json` and runtime equivalent;
- Broadcast history;
- Broadcast workflow store;
- Broadcast Not Interested store;
- Broadcast region-learning store;
- `core/profile.py` routing path;
- existing Briefing UI and endpoint;
- existing saved/hidden/personal-briefing data.

Deprecate only after migration; do not erase.

## 20. Definition of done

This project is complete only when:

- the user can explain why each recommendation appeared;
- the card creates a truthful reason to open without rewriting the headline;
- new users receive a useful Starter Mix;
- returning users receive measurably different, evidence-based ordering;
- ranking cannot expose restricted content;
- Briefing remains shared and deterministic;
- saved-story updates work privately;
- all card/workflow actions work from For You;
- ordering survives frontend rendering;
- hook generation has a safe local fallback;
- scheduler and Bouncer fallback paths remain intact;
- feature flags and rollback have been tested;
- deployment and environment documentation are updated;
- full backend/frontend tests and the test matrix above pass.

## 21. Ready-to-paste implementation instruction

Use the following instruction for the coding agent:

> Work only inside `legacy_app`. Read
> `docs/FOR_YOU_HOOK_IMPLEMENTATION_PLAN.md` completely before editing. Follow
> the phases in order and do not combine phases into one rewrite. Start with
> Phase 0 and establish a green baseline. Preserve the existing Briefing,
> scheduler, Samsung/Scrapy fallbacks, Bouncers, workflow, saved/hidden state,
> Korean translation, profile routing, and portable Windows deployment. Never
> delete Broadcast files during the first implementation. Keep all new behavior
> behind legacy-safe feature flags. After each phase, run the listed unit, API,
> frontend, pipeline, and regression tests; report exact files changed, exact
> commands, results, and remaining risks. Do not claim completion based only on
> a build. Stop after the current phase if its acceptance criteria are not met.
