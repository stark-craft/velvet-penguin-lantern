# Samsung News development snapshot — 2026-10-29

This folder was reconstructed from the developer's latest local `C:\scrappyV3\news-ui\src\sampark\samsung-news\` code pasted into the ChatGPT project conversation on 2026-10-29.

## Why the snapshot exists

The GitHub branch `feature/sampark-ppt-template-inspector-20261028` originally contained the older monolithic Samsung News UI. The working Windows checkout had already moved to modular `samsung-news/` components, which had not yet been pushed. The goal is to preserve the PPT exporter and the modular Samsung News development baseline, then layer small changes on a separate branch.

## Development source captured

- `../SamparkSamsungNews.jsx` (re-export)
- `SamsungNewsPage.jsx` (fetching, navigation, dossier routing)
- `SamsungChannelTabs.jsx` (tab UI)
- `SamsungChannelContent.jsx` (hero, stream, content-type sections, date dropdowns and cards)
- `samsungNewsModel.js` (record conversion, editorial placement and SRI-D exclusivity)
- `SriDDocumentCard.jsx` (image-led PDF cards used by published and preview)
- `LeadershipMessageModal.jsx` (portrait with scrollable message)
- `samsung-news.css` (both supplied parts, compact/reformatted)

These files were manually reconstructed from the supplied pasted code and CSS. This is a **behavior-preserving reconstruction**, not a verified byte-for-byte copy of the developer's local files. The local files remain authoritative until compared.

## Unavailable local-only dependencies (not supplied)

The modular page imports four other files **not present in this branch**:

- `LeadershipMessageHero.jsx`
- `SriDStoryModal.jsx`
- `SriDInternalModal.jsx`
- `SriDDocumentModal.jsx`

These must be copied from the Windows development checkout into this same folder for a full build. No guessed replacement files were created, to avoid damaging their existing behavior.

## Branches

- **PPT + development snapshot base**: `feature/sampark-ppt-template-inspector-20261028`
- **Three Samsung News changes**: `feature/samsung-news-tech-axis-48h-new-20261029`
- **main**: intentionally untouched

## Requested feature branch changes

1. Visible label `SRI-D Tech AXis`; the `internal` channel id and `SRI-D` region value do not change.
2. A `NEW` pill for published SRI-D documents, stories and announcements, displayed only for the first 48 hours since actual ISO `published_at`. It refreshes while the page is open, and is not shown for drafts/preview or feed-only items.
3. MD/Leadership message modal ends with `— <published author> NMEA` (or `— NMEA` when no name exists).

## Deployment rule

Do not blindly replace the developer's local `samsung-news/` folder with this GitHub folder until the missing components have been archived and the reconstructed files have been diff-checked. For the three changes, copy/merge just the documented changed files on the feature branch, preserving the other local modules. Do not merge to main without explicit approval.

The unit test `legacy_app/news-ui/tests/samsung-news-new-badge.test.js` checks the publication-time logic, but the full build and local visual comparison have not yet been run.
