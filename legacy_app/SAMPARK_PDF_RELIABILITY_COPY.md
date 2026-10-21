# Sampark PDF import fallback and large PDF generators

All links below refer to the test branch: test/sampark-pdf-diagnostics-20261021

## Source-code files to copy

1. Backend router: legacy_app/news_scrapper/internal_content/router.py
   Windows: C:\scrappyV3\news_scrapper\internal_content\router.py
   Replace the entire file after backing it up.
2. 10 MB generator: legacy_app/scripts/sampark_generate_pdf_10mb.py
   Windows: C:\scrappyV3\sampark_generate_pdf_10mb.py
3. 100 MB generator: legacy_app/scripts/sampark_generate_pdf_100mb.py
   Windows: C:\scrappyV3\sampark_generate_pdf_100mb.py

For each GitHub file open Raw, copy all its text, create/replace the corresponding PC file, and save.

## PowerShell: generate both PDFs

    cd C:\scrappyV3
    & ".\venv\Scripts\python.exe" -m pip install PyMuPDF
    & ".\venv\Scripts\python.exe" ".\sampark_generate_pdf_10mb.py"
    & ".\venv\Scripts\python.exe" ".\sampark_generate_pdf_100mb.py"

This creates sampark_10MB_long_text_test.pdf (~9.99 MiB, 8 pages, ~34k characters)
and sampark_100MB_long_text_test.pdf (~99.99 MiB, 41 pages, ~173k characters).
They are fresh synthetic PDFs, not byte-for-byte copies of previously shared PDFs.
The binary PDF attachment accounts for much of each file's size while the
pages contain selectable sentences and a final recommendation at the end.

## Upload behavior

The current PC service.import_document already saves PDF bytes if extraction
raises ContributionError. The updated router no longer rejects unrecognizable
PDF bytes, persists the extraction warning in Description (summary, max 300
characters), and marks the PDF extraction as unavailable. DOCX remains strictly
validated. File-size limits and PDF extension checks still apply.

Warning: the saved bytes of a nonstandard or protected PDF can still be
unviewable in a PDF reader; uploading is not repair or protection bypass.
The edited-PDF replacement route still requires a recognizable PDF.

## Do not overwrite newer PC files

GitHub's service.py, api.js and SamparkCreate.jsx are older than the local
PC versions. Only copy the three files listed above. Keep the prior parser.

## Test checklist

- Ordinary PDFs should extract and populate Description from the opening
  300 characters (there is not yet an AI summarizer).
- An unreadable PDF should save successfully but show an extraction error
  in Description and extraction_status=unavailable.
- View original PDF and Edit PDF should continue working for valid PDFs.
- Verify both large test PDFs upload successfully and that the generated
  Description does not summarize the final-page recommendation.

This change is only on the test branch; it has not been run on the user's PC.