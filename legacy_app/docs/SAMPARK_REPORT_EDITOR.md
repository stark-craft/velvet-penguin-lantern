# Sampark selected-news report editor

Select daywise All News cards and choose **Create Report** in the existing
selection bar. The full-width modal opens directly into a continuous editable
report. Overview and analysis share the same flow; nothing assigns them fixed
page numbers. Enter adds paragraphs, and the toolbar inserts explicit page breaks.
The flow-page counter is an estimate based on available width and template aspect
ratio, not a guarantee of identical pagination in every export format.

Click an article photo (or focus it and press Enter) to reveal **Replace from
computer**. PNG, JPEG and WebP files up to 1 MB replace that photo in its existing
slot, with Undo available. The toolbar image button replaces the selected photo
or inserts a new picture at the cursor. Imported pixels are embedded in the
private document so saving and exporting do not depend on a local file path.

The initial document reuses stored article summaries and Samsung implications.
For two or more selected articles, **cross-article analysis generates automatically
when the report opens**, through the report-only `/reports/analysis` endpoint.
It uses Samsung Chat directly with the detailed stored summaries rather than
short card captions; no Web Search or OpenAlex lookup is required. This fixed
report-generation task is separate from the two-question Ask AI allowance and
works even when that allowance has been exhausted.

The prompt compares shared themes, differences, evidence, potential Samsung
implications, and next steps. It requires sourced attribution, qualitative
comparison when metrics are absent, explicit uncertainty, and acknowledgement
when the articles are unrelated. It does not invent benchmarks. Up to 100 articles
are supported, with each summary capped at 20,000 characters and a fair total
summary budget of 100,000 characters. Two long summaries fit in full within that
budget. Missing summaries and truncation are disclosed to the model.

Identical article content has a private six-hour cache (up to 16 results per
viewer). Simultaneous opens share one Chat call, including development StrictMode
mounts. Changed summaries produce a different cache entry. The existing adapter
continues to enforce process-wide pacing and TLS verification. Nothing touches
the Ask AI question reservations; missing configuration or upstream failures
offer Retry without spending a question. The editor remains usable while the
analysis runs; export waits for that attempt to finish.

Generated comparison text joins the continuous document without assigning a
fixed page. Native Undo is available. If a user edits the analysis during
generation, the proposed text appears separately for explicit review/replacement.
Changed article context requires a fresh generation. Closing the report or
opening a saved draft invalidates pending insertion, and a saved draft is never
automatically overwritten or regenerated. Saving and exports retain the current
edited comparison text. Ask AI can still refine a selected passage as a separate,
quota-counted question, with its existing preview and stale-edit protection.

Each article has a distinct editable **Why this matters to Samsung** section.
On opening a new report, this section also generates automatically for every
selected article through `/reports/impact`, including a one-article report.
The editor queues one article at a time, reusing full summaries and source
metadata. Samsung Chat is asked
for about 300–450 words covering strategic relevance, opportunities, risks and
uncertainties, relevant business functions, and practical next steps. Sparse
evidence may produce less; the prompt requires labelled inference and forbids
invented Samsung plans or citations. This fixed generation is free of the
Ask AI allowance, even when both questions have already been used. A separate
private six-hour cache retains up to 100 article results per viewer and deduplicates
concurrent requests. Content changes invalidate cached results. JSON evidence
stays intact if escaping expands a long summary; truncation is disclosed.

The editor inserts each result into that article's impact section with native
Undo. Text edited while generation is running is kept for explicit review or
replacement, and changed source evidence requires Retry. Missing summaries skip
that article; connection failures pause the queue and Retry resumes unfinished
articles. Already generated or reviewed sections are kept. Export waits while
generation is pending. Closing or opening a saved draft cancels late insertion
and subsequent queued requests; saved drafts are not regenerated automatically.

The **Samsung impact** toolbar panel remains an optional, quota-counted refinement
using the article's current edited text. Select an article and generate a proposal.

Review the proposal, then **Apply to this article**. It replaces only that impact
section using native Undo. Apply refuses when either that section or the article
context changed after generation. Saving and all exports retain the current
edited wording, including PowerPoint's existing `#INSIGHT` field. Older private
drafts receive section wrappers when opened, preserving their original text.

## Portable integration

Copy `news-ui/src/sampark/report-editor/` into the Windows frontend. Render:

```jsx
<ReportEditor items={selectionSnapshot} onClose={closeReport} />
```

Mount it only while open; pass a snapshot of selected normalized articles. The
existing selection toolbar needs one button. Its current review.news.submit
permission remains the gate for selection and all report endpoints.

Copy `news_scrapper/reports/` into the active backend. Import and include its
router in `main.py` before the SPA fallback; add `reports` to the API-root list.
Add `/reports` to the development Vite proxy. Install the active requirements,
including `beautifulsoup4` and `reportlab`. No new credentials or developer IPs
belong in frontend code. Keep the existing signed viewer middleware and one
Uvicorn worker.

## Identity and storage

`NEWS_RUNTIME_DIR/private_reports.json` stores drafts, revisions, recent AI
questions and export history by the existing HMAC viewer identity. It is runtime
data and must never be committed. Draft history is browser/viewer scoped, not
IP scoped. Clearing the signed identity cookie starts a different private viewer,
matching the application's existing identity model. Up to 50 drafts and 100
export-history records are retained per viewer. Draft saves use optimistic
revision checks so another tab cannot silently overwrite a newer save.

Ctrl+S / Cmd+S saves privately. Unsaved close, opening another draft, and exporting
show Save/Continue/Cancel choices. Export without saving uses current edits and
does not replace the saved draft. Notice banners dismiss after ten seconds.

## Ask AI contract

Samsung Web Search and Samsung Chat use their existing configured adapters,
TLS handling and process-wide pacing. A question invokes Web Search then Chat.
**One submitted question counts once, even though both services are used.**
Each viewer has two questions in a rolling six-hour window, shared across all
reports and tabs. Atomic reservations are persisted before either upstream call.
A **Samsung impact** generation calls Chat only with the supplied article
context and counts as one request in that same allowance. It does not require
Web Search to be configured and does not introduce a separate quota.
Automatic **cross-article analysis** and per-article **Samsung impact** use the
separate fixed report-generation paths above and consume none of those questions.
A repeated request ID returns its completed answer without another reservation;
a concurrent duplicate is rejected. The oldest active reservation's expiry is
returned as `reset_at`, along with server time and remaining allowance.

Missing connections return 503 before charging. An upstream failure after a
reservation remains charged to protect infrastructure; the UI explains that
case. Drafting, editing, saving and exporting do not consume questions. The quota
is private to the signed browser viewer; it is not an authenticated employee-ID
quota across different browsers or cleared cookies.

Whole-report context reads current edits when the question is submitted and
bounds each article so later articles are not simply omitted. Selected-passage
mode sends the selected text. Responses expose actual retrieved evidence links;
they are not guarantees that every model claim is supported. Review before Apply.

## Exports and template

HTML, PDF, DOCX and XLSX export the sanitized current document without calling AI.
HTML keeps supported rich formatting and the flowing image/text arrangement.
PDF and Word paginate content and honor explicit page breaks; their layouts
are format-specific rather than pixel-identical browser screenshots. Word keeps
basic inline emphasis; Excel exports edited text/sections and source URLs, with
spreadsheet-formula injection protection. PDF tries Windows Malgun, macOS Arial
Unicode, then Linux DejaVu; a deployment lacking those fonts uses ReportLab's
standard font and may need a Unicode font for non-Latin content.

PowerPoint requires **`legacy_app/template.pptx`**, which is absent in this Mac
checkout. The NewsLayout should contain the existing placeholder markers:
`#TITLE`, `#SUMMARY`, `#INSIGHT`, `#LINK`, `#DATE_HERE`,
`#Targated_SRID_Team`, and a picture placeholder. Current edited article fields
populate those markers. Overview and analysis text share opening slides and
continue when long. The status endpoint reads slide dimensions and placeholder
geometry, leaving a portable seam for a more exact template preview renderer.
Long article text may require review in the real template's bounded placeholders.
The missing template disables the PowerPoint button while other formats remain
available. Do not commit a proprietary template without authorization.

## Verification

- `python -m unittest tests.test_reports -v`: owner isolation, revisions,
  sanitization, atomic racing quota, both adapters counted once, retry/restart,
  reset/failure, Chat-only detailed impact, shared quota, missing/empty impact
  responses, automatic cross-analysis without charging, fair full-summary context,
  private durable cache/expiry, concurrent-open deduplication, missing/failed
  generation, free automatic per-article impact with exhausted allowance,
  bounded impact cache, intact long JSON evidence, route permissions,
  edited snapshot exports, PDF page break, template marker mapping.
- `node --test tests/samparkReport.test.js`: safe seeding, shared opening flow,
  preserved Samsung implications, article impact sections, stale-edit protection,
  full-summary automatic analysis input, explicit replacement of user edits,
  current article context, automatic impact source/section edit guards, countdown behavior.
- Full frontend tests and production build are required.
- Browser QA covers light/dark/narrow layouts, typing, save shortcut/history,
  unsaved export choices and missing Samsung connection handling.

Live Samsung responses and the actual proprietary PPT template cannot be
validated here until those deployment inputs are configured.

Latest verification (30 September 2026): 245 frontend tests, 25 report backend
tests and a production build pass. Desktop light/dark QA used isolated Chat
fixtures for automatic single/multiple-article impact, protected ongoing edits,
Apply/Undo, cached reopening, private save/reopen and cancellation when opening
a saved draft. The normal backend was restored and its missing-configuration
responses preserved the two-question allowance. Mobile QA was waived by the user
for this update.
