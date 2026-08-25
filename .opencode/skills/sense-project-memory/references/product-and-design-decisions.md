# Product and design decisions

## Platform information architecture

The whole platform uses one shared shell. Current primary routes are:

| Route | Purpose |
|---|---|
| `/` | Redirects to the configured default; normally For You |
| `/for-you` | Private, explainable personalized intelligence |
| `/home` | Shared deterministic Briefing |
| `/scan` | Search already extracted local archives; never launches a crawler |
| `/saved` | Current viewer's Desk: Saved/Following and private URL briefings |
| `/research` | Research orientation page |
| `/venturelens/*` | Venture Lens workspaces |
| `/samsung-internal` | Internal leadership/editorial destination |
| `/internal-publishing` | Internal authoring/import workspace |
| `/selected` | Shared Review Queue |
| `/approved` | Approved Briefing |
| `/history` | Briefing Archive |
| `/rejected` | Hidden/removed signals as defined by the screen |
| `/sources` | Unified source control |
| `/scheduler` | Scheduler diagnostics/control |
| `/voc` | User feedback |
| `/gatekeeper-review` | Privileged Gatekeeper review |
| `/director-analytics` | Privileged aggregate analytics |

The compact floating navigation keeps the most frequent workspaces visible.
Lower-frequency, operational, and privileged destinations live in Settings.
Venture Lens must remain inside the shared shell rather than launching a second
frontend process.

## Briefing and For You relationship

- `/home` is the familiar shared product and must not be radically redesigned
  without explicit approval. It can be polished, but its established hierarchy
  and behavior are a stability anchor.
- `/for-you` is the default landing experience when enabled.
- New/unconfigured users see a useful Starter Mix and short interest setup; they
  are never blocked by personalization setup.
- Configured low-confidence users see `Tuned from your choices`.
- Only sufficiently learned users should be told the feed is personalized from
  behavior.
- For You is finite and comprehension-oriented, not an infinite-scroll clone.
  Its healthy promise is: in five minutes, know what changed and what deserves
  attention.
- Include globally important stories and useful surprises to avoid a filter
  bubble.
- Original publisher headlines stay visible. AI context and attention hooks are
  separately labelled and grounded.

Recommended For You modules already reflected in the implementation plan:

1. greeting and mix controls;
2. what changed since the last visit;
3. five-minute executive scan;
4. followed-story updates when credible;
5. important items outside the usual lane;
6. more-for-you cursor continuation.

## Interaction semantics

- `Edit interests` must be prominent and obvious to a first-time user.
- `Why these stories?` opens grounded explanations, not generic AI language.
- `Refresh mix` changes selection/ranking without destroying preferences.
- Followed-update and useful-surprise counts must remain readable in both
  themes, including a zero state.
- Every control requires a visible keyboard focus state, accessible name, and
  a reliable loading/error/empty state.
- Route changes and optional guide animation must respect reduced motion.

## Visual system

The target is premium, calm, and information-dense without looking like a
generic admin dashboard.

### Shared rules

- Use the bundled Geist variable font; do not depend on a runtime font CDN.
- Use real code-native icons from the existing icon/Lucide system, not emoji or
  placeholder glyphs.
- Keep spacing deliberate and cards aligned. Avoid uneven masonry where team
  workflow comparison matters.
- Use restrained borders, layered surfaces, readable contrast, and generous
  focus states. Do not make every element glow or compete for attention.
- Modals belong centered in the viewport, with focus trapping, Escape behavior,
  scroll locking, clear primary/secondary actions, and useful error copy.
- Dark and light themes must be designed independently, not produced by simply
  swapping black and white.

### Dark theme

- Retain the established rich purple/plum direction for NewsScrapper.
- Avoid pure black expanses; use layered purple-charcoal surfaces.
- Preserve restrained circular/orbital patterns where they add depth.

### Light theme

- Use a soft gray-blue base with restrained cyan/blue and warm neutral variation;
  avoid glaring pure white.
- Text and kickers must remain readable. Do not use near-white mint text on pale
  cards.
- Keep the circular/orbital patterns visible at low contrast.
- Do not use the grid-based background pattern in the For You hero or legacy
  migration/continue-desk banner. The user explicitly requested circular forms
  only there.
- Buttons in the For You hero should visually stand out for first-time users,
  rather than appearing as faint text inside the background.

### Theme transition

The theme control is a compact toggle without redundant `Light`/`Dark` text.
The transition may sweep diagonally from one corner to the opposite, but it must
be slow enough to perceive and must respect `prefers-reduced-motion`.

## Navbar and settings

- The desired navigation is compact, floating/glass-like, roomy, and modern;
  it should not consume a large vertical band.
- Preserve the reversible classic navigation style constant/test so a visual
  rollback remains possible.
- The user's name/IP/profile editing belongs inside Settings rather than taking
  permanent navbar width.
- Settings currently houses language, theme, optional Scout guide, Venture Lens
  access, operational pages, privileged pages, and user profile controls.
- The first-visit `What should TechScout call you?` experience should feel like
  a polished welcome, not a generic form dialog. Duplicate display names must
  show a clear validation error.

## Scout guide pet

Scout is optional and off by default. When enabled it offers route-aware,
section-level orientation across Sense.AI. It must:

- use original code-native artwork;
- animate using compositor-friendly transforms;
- avoid scroll-driven React rerenders;
- remain smooth and non-blocking;
- be dismissible and respect reduced motion;
- never obscure the user's primary task;
- reappear only when context genuinely changes, not on every minor click.

## Briefing-specific preserved behavior

- Hero banner/carousel shows high-value clustered stories.
- Briefing Archive remains visible in the top composition.
- Latest Day Signals stay contained and do not overlap adjacent sections across
  browser/Windows font metrics.
- Loaded Briefing supports search plus region, category, source, date, signal,
  image, status, vertical, and matched-keyword filters.
- Cards should fit a three-column desktop grid where appropriate.
- Dossier AI Summary renders a lead followed by separately styled bullet
  containers. Why This Matters uses the stored structured result.
- Review Queue and Approved Briefing use equal-height, stable cards with clear
  workflow actions.
- Archive results can be selected/imported into the workflow.
- Scan searches local extracted archives in real time and never launches the
  internet crawler.

## Current expansion surfaces

### Internal Publishing

The latest design is a studio-style workflow:

```text
Source -> Shape -> Preview
```

It contains Create, Leadership, and Library workspaces; local document parsing;
editable generated fields; a live Samsung Internal card preview; readiness
checks; session recovery; and draft/publish/edit/delete actions. This is the
current design baseline for the authoring tool. Do not reduce it to a plain
upload form.

### Samsung Internal

The current implementation is functional but explicitly rejected visually by
the user. It is the next major design target. The intended direction is similar
to the Briefing's confidence and rhythm, without cloning it:

- strong editorial hero/carousel with leadership permanence;
- a clear `Samsung Now` external-intelligence stream;
- visually differentiated `Inside Samsung` people/stories;
- useful `Across Samsung` portals/resources;
- consistent cards, spacing, dossiers and theme behavior;
- a real product destination, not a prototype grid.

Preserve the content adapter and routes while redesigning the information
architecture and visuals.

### Venture Lens

The current Venture Lens visual design was also explicitly rejected and needs a
later redesign after Samsung Internal reaches a stable standard. Preserve the
existing backend/provider behavior and dedicated pages—repositories, research,
radar, comparison, watchlist, notifications and dossiers—while replacing the
visual system. Do not put every capability onto one endless page.

## Design validation

For any visual change, inspect at least:

- dark and light themes;
- desktop and a narrow/mobile width;
- long headlines and missing images;
- loading, error, empty and zero-count states;
- keyboard navigation and visible focus;
- modal open/close/focus restoration;
- Windows-sensitive wrapping/height behavior;
- no horizontal overflow;
- production build, not only Vite HMR.

## Reaction semantics and destructive moderation

- `Like` and `Dislike` are reversible viewer reactions with shared aggregate
  counts. They use the same control, colors, endpoint, and persistence model on
  every surface.
- A reaction never hides, rejects, or removes an article. This keeps the UI
  predictable and prevents a personal click from mutating another viewer's
  feed.
- Bouncer learning uses stable batch consensus, not arithmetic from a single
  click and not synchronous training. Consensus must meet both the configured
  minimum-vote and winning-ratio gates.
- Private `Hide` remains a separate per-viewer action.
- Global removal is a visibly destructive Gatekeeper-IP-only kill switch in
  Briefing. Its backend authorization cannot trust forwarded headers from an
  untrusted peer.

## For You desktop composition

- The default view should reveal meaningful stories immediately instead of
  spending the first viewport on a large salutation or vanity metrics.
- The current desktop lead uses one hero plus four secondary stories so all
  five executive signals are visible together.
- Feed, Following, Create, interests, and preference topics share one compact
  local command rail; it collapses while scrolling down and returns when the
  reader moves upward.
- Story cards are direct-open. Separate Open, Select, and Why-this-story
  controls are excluded from this surface. Follow, Like, Dislike, and private
  Hide are icon-led actions with accessible labels.
- The compact workspace rail uses the same restrained glass-and-thread visual
  language as the primary navigation without copying it. Keep the rail close
  to the navbar, preserve a visible active state, and use a distinct studio
  icon for Create.
- Executive secondary cards keep their action dock pinned to the card bottom:
  Follow occupies a labelled full-width row, while Like, Dislike, and Hide sit
  below it. Every action has a hover/focus tooltip.
- Create begins with one compact studio command bar. Private Briefing and
  Contributions are the command bar's tabs; do not reintroduce a separate
  oversized Create heading or explanatory hero.
- Article reaction identity is global, not route-specific. Preserve the
  canonical server `article_id` when normalizing records; when a legacy record
  has only an article key/link, resolve it through the batched reaction-query
  endpoint so For You, Briefing, Scan, and dossiers show the same totals.
