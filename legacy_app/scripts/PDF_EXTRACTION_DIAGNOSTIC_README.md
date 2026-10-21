# Sampark PDF extraction diagnostic (isolated)

This branch contains a **read-only diagnostic script**. It is not an application fix.
It does not change the PDF parser, upload flow, PDF editor, or the main branch.

The original issue: an uploaded PDF may have selectable text but import returns
`extraction_status=unavailable`, `extracted_characters=0`, and
`page_count=null`. We must distinguish a genuine zero-text PDF from
unsupported pypdf extraction, PDF parser errors, or the 200,000-character cap.

## Run on the actual Windows PC without changing the app

Open PowerShell:

```powershell
cd C:\scrappyV3
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/stark-craft/velvet-penguin-lantern/test/sampark-pdf-diagnostics-20261021/legacy_app/scripts/pdf_extraction_diagnostic.py" -OutFile "$env:TEMP\pdf_extraction_diagnostic.py"

py "$env:TEMP\pdf_extraction_diagnostic.py" "C:\path\to\the-problematic-report.pdf"
```

Use the Python interpreter/virtual environment that runs the backend. If
`py` is not that interpreter, use `python` or its absolute path.

The script uses the backend's installed `pypdf` and **optionally**
`PyMuPDF` to compare text extraction without printing any PDF content.
If PyMuPDF isn't installed, the script reports that and can still test pypdf.

For an optional second-engine comparison:

```powershell
py -m pip install pymupdf
py "$env:TEMP\pdf_extraction_diagnostic.py" "C:\path\to\the-problematic-report.pdf"
```

Only install into a disposable/authorized Python environment, not into a
managed production environment, without permission.

## Interpret the JSON

- `pypdf.characters > 0`: pypdf finds text, so the app may instead be rejecting
  extraction for another reason (e.g., normalized size or a later step).
- `pypdf.characters = 0`, `pymupdf.characters > 0`: a PyMuPDF fallback looks
  promising for the real parser.
- Both 0: neither engine found selectable text. This doesn't conclusively
  prove the PDF is scanned or empty; unusual font encodings may be involved.
- `over_current_import_character_limit: true`: the app's 200,000-char
  contract is potentially rejecting otherwise valid extracted content.
- `page_count > 500`: the parser will reject automated extraction due to its
  current page limit, irrespective of text content.

This script does **not** print extracted text or put the PDF into GitHub. It
may show some PDF-library error strings. Inspect output before sharing if the
report is confidential. Do not commit or upload the PDF.

## Next step

Use these read-only results to decide whether to make a controlled parser
fallback and API metadata fix based on the user's **current PC source**, not
the older source code in GitHub. Do not merge this diagnostic branch into main.
