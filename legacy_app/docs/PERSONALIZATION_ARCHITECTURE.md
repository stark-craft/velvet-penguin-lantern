# NewsScrapper Personalization Architecture

This document is a design proposal only. It deliberately does not activate
personalized ranking yet.

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
viewer_key = HMAC-style keyed hash(IP_HASH_SECRET, normalized client IP)
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

| User action | Suggested weight | Meaning |
|---|---:|---|
| Follow topic/story | +8 | Strong, durable explicit preference |
| Save for later | +6 | Strong explicit interest |
| Mark Interested | +5 | Explicit relevance preference |
| Select for review | +4 | Operationally valuable |
| Export | +4 | Strong downstream usefulness |
| Open dossier | +1 | Weak interest |
| Read for 30–90 seconds | +1 to +3 | Increasing engagement |
| Repeatedly open related stories | +2 | Recurring inferred interest |
| Hide | -4 | Private negative preference |
| Mark Not Interested | -7 | Explicit negative preference and separate Bouncer vote |

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

Apply time decay so old behavior does not permanently define a user. A
reasonable starting point is a 30-day half-life for inferred signals and a
90-day half-life for explicit follows.

## Ranking

Do not generate a completely separate physical feed file per user. Keep one
profile briefing and calculate a deterministic user score when returning it.

Suggested initial score:

```text
final_score =
    0.50 * editorial_importance
  + 0.20 * source_coverage
  + 0.20 * user_topic_similarity
  + 0.10 * freshness
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

### Technology Signal Pulse

Show globally trending keywords, then visually identify topics the viewer
follows. Clicking a topic can offer:

- Filter this briefing;
- Follow this topic;
- Unfollow this topic.

### Latest Day Signal

Reorder cards using `final_score`, but retain controls for:

- Recommended;
- Most important;
- Most recent;
- Most sources.

### Saved & Following

Add a private navigation page with two sections:

- Saved for later: the exact articles the viewer saved;
- Following: topics or story clusters that should surface future related news.

A saved article must remain available beyond the normal 30-day briefing
retention window. Store a compact immutable snapshot plus its source links.

When a new article matches a followed item, show:

```text
Update to a story you follow
```

This tag should be user-specific and must not appear for everyone.

## Proposed JSON files for phase one

For the current single-worker portable server:

```text
news_scrapper\runtime\personalization\
├── viewer_interests.json
├── viewer_saved_articles.json
├── viewer_followed_topics.json
└── viewer_events.json
```

All writes must use `JsonStore` atomic replacement and process-level locks.
Keep event history bounded to 30 days, but do not delete saved article
snapshots or explicit follows.

## Scale boundary

JSON is acceptable for the current internal pilot, but personalized ranking
adds frequent writes. Before running multiple Uvicorn workers or serving a
substantially larger audience, move these stores to a transactional database.

## Rollout sequence

1. Add private Save for Later and Follow actions.
2. Record normalized per-user events without changing ranking.
3. Show a private Saved & Following page.
4. Calculate ranking scores in shadow mode and compare them with current order.
5. Add explainability reasons.
6. Enable personalized ordering for Latest Day Signal.
7. Enable the hybrid hero carousel.
8. Measure satisfaction and allow users to reset personalization.

This order makes the behavior observable before it changes anyone's feed.
