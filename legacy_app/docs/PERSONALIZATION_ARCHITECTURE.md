# NewsScrapper Personalization Architecture

This document describes the personalization layer now active in the legacy
application.  The implementation lives in `news_scrapper/personalization.py`,
is applied by `/latest-briefing`, and persists private events in
`news_scrapper/runtime/viewer_personalization.json` (or the configured runtime
directory).

## Product rule

Personalization should change ordering, not editorial truth:

- every user still has access to every article in their assigned profile;
- personalization never changes Default versus Broadcast routing;
- global importance and source coverage remain visible;
- a user-specific ranking must never train the shared Bouncer by itself;
- Hide remains private to one user;
- Not Interested remains an explicit shared-model training action;
- Saved/Following items remain private to one user.

## Identity

Use the existing keyed IP hash as the stable viewer identifier:

```text
viewer_key = SHA-256(IP_HASH_SECRET + normalized client IP)
```

The display name is editable metadata attached to that key. Renaming a user
must not create a new personalization identity.

Personalization data should be isolated by both:

```text
viewer_key + active_profile
```

An employee's Default interests must not reorder the Broadcast feed, or vice
versa.

## Signals

Use explicit actions more strongly than inferred behavior.

| User action | Active weight | Meaning |
|---|---:|---|
| Save for later | +6 | Strong explicit interest |
| Mark Interested | +5 | Explicit relevance preference |
| Select for review | +4 | Operationally valuable |
| Import archive signal | +4 | Operationally valuable |
| Open private briefing | +2.5 | Moderate inferred interest |
| Open dossier | +2 | Weak inferred interest |
| Open article | +1.25 | Weak inferred interest |
| Hide | -4 | Private negative preference |
| Mark Not Interested | -6 | Explicit negative preference and separate Bouncer vote |

Do not treat a single click as a strong preference. Accidental clicks and
shared workstations are realistic edge cases.

## Topic representation

Each article already contains useful ranking features:

- `keywords_found`;
- `category`;
- `article_intent`;
- `region`;
- source/publisher;
- MiniLM semantic embedding;
- title and summary;
- source count and importance score.

Maintain a compact per-user interest profile:

```json
{
  "viewer_key": "hashed identity",
  "profile": "default",
  "topics": {
    "artificial intelligence": 8.4,
    "robotics": 4.1,
    "broadcast regulation": -2.5
  },
  "sources": {
    "Publisher A": 2.0
  },
  "intents": {
    "Research": 3.2,
    "Product Launch": 1.8
  },
  "followed_story_vectors": [],
  "updated_at": "ISO timestamp"
}
```

The current implementation applies linear time decay and a hard 30-day event
window. Saved article snapshots remain available until the user removes them,
but they influence related-story tagging and rank for 30 days from `saved_at`.

## Ranking

Do not generate a completely separate physical feed file per user. Keep one
profile briefing and calculate a deterministic user score when returning it.

Current ranking combines the stored editorial signal, source coverage, a
strictly capped user affinity adjustment, freshness, and a capped related
saved-story boost. It never filters an item from the shared briefing.

```text
final_score =
    0.65 * editorial_signal
  + 3.00 * capped_source_coverage
  + capped_user_affinity (-18 to +18)
  + freshness_bonus
  + capped_saved_story_boost (0 to +30)
```

Add small source and intent affinity adjustments, with a strict cap so a user
cannot push low-quality content above every high-confidence signal.

The response should include explainability metadata:

```json
{
  "personalization_score": 0.82,
  "personalization_reasons": [
    "Matches followed topic: Artificial Intelligence",
    "Similar to two articles saved this week"
  ]
}
```

## Page behavior

### Hero briefing

Use a hybrid carousel to avoid a filter bubble:

- three globally important stories;
- up to two personalized stories;
- no duplicate clusters.

### Technology Signal Pulse (future explicit-topic controls)

Show globally trending keywords, then visually identify topics the viewer
follows. Clicking a topic can offer:

- Filter this briefing;
- Follow this topic;
- Unfollow this topic.

### Latest Day Signal

Cards for the latest day use the personalized score while keeping every
available story accessible through the loaded briefing and filters.

### Saved & Following

The private desk contains two sections:

- Saved for later: the exact articles the viewer saved;
- feed learning from recent reading and saved story relationships.

A saved article must remain available beyond the normal 30-day briefing
retention window. Store a compact immutable snapshot plus its source links.

When a new article matches a followed item, show:

```text
Update to a story you saved
```

This tag should be user-specific and must not appear for everyone.

## JSON state for the current pilot

For the current single-worker portable server:

```text
news_scrapper\runtime\
├── viewer_personalization.json
├── viewer_saved_store.json
├── viewer_profiles.json
└── usage_tracker.json
```

Personalization writes use `JsonStore` atomic replacement and process-level
locks. The older saved/profile/tracker stores keep their existing locked,
temporary-file replacement paths so this feature does not create a second
source of truth for those records.
Keep event history bounded to 30 days, but do not delete saved article
snapshots. Every record is isolated by the keyed viewer identity and active
Default/Broadcast profile.

## Scale boundary

JSON is acceptable for the current internal pilot, but personalized ranking
adds frequent writes. Before running multiple Uvicorn workers or serving a
substantially larger audience, move these stores to a transactional database.

## User controls and explainability

- `/viewer/personalization` reports active event count and top non-title
  interests for the current viewer/profile.
- `/viewer/personalization/reset` clears recent viewing preferences while
  preserving Saved Signals.
- personalized articles carry `personal_rank_score` plus a `personalization`
  object containing reasons and saved-story match metadata.
- the UI shows a short-lived “Personalized for …” notice and marks related
  stories as “Update to a story you saved”.
