# Sampark PDF extraction — full-file copy instructions

Test branch: `test/sampark-pdf-diagnostics-20261021`
Repository: `stark-craft/velvet-penguin-lantern`

The user's active project is `C:\scrappyV3`; it does NOT contain a
`legacy_app` directory. The `legacy_app` prefix is only present in GitHub.

**Copy these three complete files, not patches:**

| Source on this GitHub branch | Destination on the Windows PC |
|---|---|
| `legacy_app/news_scrapper/internal_content/document_parser.py` | `C:\scrappyV3\news_scrapper\internal_content\document_parser.py` |
| `legacy_app/news-ui/src/news-scrapper/internal/contributionModel.js` | `C:\scrappyV3\news-ui\src\news-scrapper\internal\contributionModel.js` |
| `legacy_app/news-ui/src/news-scrapper/internal/documentParser.js` | `C:\scrappyV3\news-ui\src\news-scrapper\internal\documentParser.js` |

Before replacing, save backups of these three local files.
Open each GitHub file and select **Raw**, then copy all of the content,
replace all local file contents, and save.

No need to copy the diagnostic scripts, other legacy_app files, or anything
from the repository main branch.

To enable the alternative PDF reader, activate the backend's Python
environment and run:

```powershell
python -m pip install "PyMuPDF>=1.24,<2"
```

Restart the backend and frontend, then try importing the same PDF again.
Do not upload internal PDFs to GitHub.

What this version addresses:
- best-effort per-page extraction using pypdf, optionally PyMuPDF fallback;
- readable PDFs with zero text retain their page count, because the parser
  now returns an empty text result instead of raising solely for empty text;
- oversized extracted text is truncated to 200,000 chars instead of failing
  the entire document import;
- frontend 150 MB / 500-page settings now agree with the backend.

What has not been replaced:
- `service.py`, `router.py`, `api.js`, and `SamparkCreate.jsx` from
  the user's PC. These contain newer PDF editing and other features absent
  from the older public GitHub snapshot.
- The browser's `api.js` still drops `extraction_status` and
  `extraction_warning`. This is a known UI feedback issue, not the core
  text extraction problem.
- Invalid PDF signatures may still be stored by the current service's
  best-effort policy. That validation boundary is a separate follow-up.
