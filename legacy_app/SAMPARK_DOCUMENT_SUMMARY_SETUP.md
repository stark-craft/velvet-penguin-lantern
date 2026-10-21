# Sampark: summarize the whole extracted document into 300 characters

Branch: `test/sampark-pdf-diagnostics-20261021`

## Replace/copy two backend files

1. `legacy_app/news_scrapper/internal_content/router.py`
   -> `C:\scrappyV3\news_scrapper\internal_content\router.py`
   (replace complete file; back up your existing PC file first)
2. `legacy_app/news_scrapper/internal_content/document_summarizer.py`
   -> `C:\scrappyV3\news_scrapper\internal_content\document_summarizer.py`
   (new file, paste complete GitHub Raw source)

**Do not copy GitHub service.py, document_parser.py, api.js or SamparkCreate.jsx**
over newer PC files. The new router preserves the PDF upload fallback,
the secondary-cover routes and the Edit PDF replacement endpoints.

## Behavior

- Valid PDF / DOCX: extract text, select important evidence from the entire
  supplied extracted text (not just its opening), and generate a description
  no longer than 300 CHARACTERS.
- Save the computed `summary` on the contribution draft and return it in the
  same /internal-content/import response used to populate Description.
- Save `source_document.summary_method` as `ai` or `extractive`.
- Invalid/unextractable PDF: do not try to summarize; preserve original
  upload and put the actionable extraction warning into Description.
- File-size checks and Edit PDF handling are unchanged.

## Optional true AI-generated summary

By default the dependency-free method is `extractive`: it considers
sentences throughout the document and chooses important representative
phrases. It is NOT an LLM paraphrase.

For actual generated/paraphrased summaries, configure a PRIVATE,
organization-approved OpenAI-compatible chat endpoint in the backend
environment before starting Uvicorn:

    $env:SAMPARK_SUMMARY_API_URL='https://APPROVED-HOST/v1/chat/completions'
    $env:SAMPARK_SUMMARY_MODEL='APPROVED-MODEL-NAME'
    $env:SAMPARK_SUMMARY_API_KEY='YOUR-APPROVED-SERVICE-KEY'

An authorized local service may use http://127.0.0.1:... without a key.
The summarizer supports HTTPS for nonlocal hosts and will NOT send
content anywhere if URL or model are missing. Do not send enterprise
documents to a third-party service without authorization.

The AI text is based on the entire extracted text when it is short, or
a set of globally ranked observations from across the document when long.
If the optional AI request errors or exceeds 15 seconds, the local
extractive summary is returned and the PDF upload still succeeds.

## Test

After copying the two backend files, restart Uvicorn.
Upload a readable PDF, such as the Sampark 10 or 100 MiB synthetic test.
Expected: Description is at most 300 characters and reflects the conclusion
rather than only the opening. `source_document.summary_method` reports
which mode produced the summary. Upload a non-extractable PDF and confirm
its saved Description explains the extraction failure.

Optional independent smoke-test code:

    scripts/test_document_summarizer.py

Copy it to C:\scrappyV3\scripts\test_document_summarizer.py then run:

    & C:\scrappyV3\venv\Scripts\python.exe C:\scrappyV3\scripts\test_document_summarizer.py

## Known extraction limit

`document_parser.py` currently caps extracted text at 200,000 characters.
The summary reads the complete extracted text that reaches the importer.
Documents whose readable content exceeds the cap would require a separate
streaming/full-document extraction implementation. The generated 10 MiB
and 100 MiB synthetic test PDFs were below that character cap.

All edits are on the test branch. Current PC runtime has not been tested.