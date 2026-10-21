# Real NewsScrapper architecture PDF: 100 MiB target without fake data

GitHub test branch: test/sampark-pdf-diagnostics-20261021

## One complete generator file

Source: legacy_app/scripts/generate_real_newsscrapper_architecture_pdf.py

1. Open the source above on GitHub, select Raw and copy all the code.
2. On your PC create C:\scrappyV3\generate_real_newsscrapper_architecture_pdf.py
3. Paste the entire code and save it.
4. From PowerShell:

    cd C:\scrappyV3
    & ".\venv\Scripts\python.exe" -m pip install PyMuPDF Pillow
    & ".\venv\Scripts\python.exe" ".\generate_real_newsscrapper_architecture_pdf.py" --root "C:\scrappyV3" --target-mb 100 --max-gallery 280

Output:

    C:\scrappyV3\NewsScrapper_Real_Architecture_Atlas.pdf

The script prints page count, actual MiB, extracted characters and whether
the final recommendation is reachable in the PDF text layer.

## What is real, and what is not

- Reads real project-authored docs from C:\scrappyV3\docs.
- Derives actual Python route decorators, source file counts, function
  names and frontend exports from the local checkout.
- Includes long architecture chapters on ingestion, Samsung services,
  Bouncer, semantic clustering, recommendations, Sampark creation/review,
  exports, security and deployment.
- Produces high-resolution UNIQUE visual code excerpts showing the source
  that exists on this PC, rather than duplicate paragraphs or random bytes.
- Includes a separately written final architectural recommendation at
  the very END, so the summary test has a meaningful late conclusion.
- Does NOT make claims about verified production metrics or successful tests.

Images of code contribute to PDF size but do not make all that source code
searchable. The prose chapters, source inventory, API listings and final
recommendation are selectable/extractable text.

## Why exactly 100 MiB is not guaranteed

Real usable material determines file size. The source screenshots are unique,
and the generator chooses an image quality near the requested target; it
does not insert filler or duplicate evidence to force a size.

Sampark's current importer has a 500-page limit and an extracted-text cap
of 200,000 characters. For this purpose, meaningful end-to-end content
matters more than hitting a round 100 MiB. The script caps its page count
and text layer to aim within the existing importer limits.

## Test the Description

Upload the finished PDF under Sampark > Create New > PDF.
Expected: Description should reflect system components and the FINAL
RECOMMENDATION, not just start with the opening 'This report is derived...'.
Description remains a maximum of 300 characters.

Check the saved source_document.summary_method:

- `extractive` means a rule-based overview assembled from selected
  evidence across the document, not a fluent LLM summary.
- `ai` means an approved configured model generated the description.

No AI provider is configured by this generator or upload process. A
language-model generated abstract needs an explicitly approved model.

## Security

The atlas contains REAL implementation material and could reveal internal
code structure. The script skips common private paths and redacts common
secret-like assignments, but automated redaction is not a security
guarantee. Review the finished report and follow company data-sharing
rules before uploading or distributing it.

All files are on the test branch, not main. This generator has not yet
been executed in your local Windows checkout.