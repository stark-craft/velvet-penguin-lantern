# Sampark PDF import reliability — full-file copy

## Copy only one newly updated file

GitHub test branch: `test/sampark-pdf-diagnostics-20261021`

GitHub source:
`legacy_app/news_scrapper/internal_content/router.py`

PC destination:
`C:\scrappyV3\news_scrapper\internal_content\router.py`

Use GitHub **Raw**, copy the *entire* file, replace the local file's
contents, and save. **Back up the local router.py first.**

No `legacy_app` prefix on the PC.

## What changes

- Validate the uploaded PDF/DOCX bytes before saving a new contribution
  draft. An unrecognizable PDF now returns an HTTP 400 with an actionable
  message rather than a 200 response for an unusable file.
- Keep the existing handling of valid scanned PDFs: they can be saved with
  an editable, manually entered description when text extraction is absent.
- Apply the same recognizable-PDF check to the existing edited-PDF
  replacement endpoint.
- Retain the PC version's PDF editing/replacement and secondary cover
  routes. These routes are absent from GitHub's older baseline.

## Important scope

The local `service.py`, `api.js`, `SamparkCreate.jsx`, and PDF
editor are **newer than GitHub's baseline**. Do not copy those older files
from GitHub. The parser, frontend limits, and other files already copied
in the previous step do not need copying again.

This change does **not** make protected/altered bytes readable and does
**not** fix frontend extraction-status field mapping. Those need a
separate update based on the full newer source, not legacy GitHub files.

## Test

1. Restart backend with the project's virtual environment.
2. Upload `Sampark-report.pdf` whose browser-visible bytes had no PDF
   header: expect HTTP 400 with clear error and **no new draft**.
3. Upload the small ordinary PDF that previously extracted 22 characters:
   expect normal extraction and a populated Description.
4. Confirm View original PDF, Edit PDF, and secondary cover UI remain
   functional.

Keep the GitHub branch isolated; don't merge it into main on the
assumption that its old backend/service/frontend baseline is current.
