# Sampark document Description — Samsung Chat, with offline DistilBART fallback

Test branch: `test/sampark-pdf-diagnostics-20261021`

## Copy two backend files as full replacements

1. `legacy_app/news_scrapper/internal_content/router.py`
   -> `C:\scrappyV3\news_scrapper\internal_content\router.py`
2. `legacy_app/news_scrapper/internal_content/document_summarizer.py`
   -> `C:\scrappyV3\news_scrapper\internal_content\document_summarizer.py`

Open GitHub Raw for each file, copy the ENTIRE contents, back up the existing
router, replace both local files, and restart Uvicorn. Do not replace your newer
`service.py`, `document_parser.py`, `api.js`, or frontend files with GitHub's
older baseline. The updated router retains PDF upload warning fallback,
Edit PDF, secondary-cover and contribution endpoints.

## Actual processing order

1. Import PDF/DOCX. Retain the existing 150 MiB PDF upload limits and parsing.
2. The importer extracts readable text (up to 200,000 characters).
3. Gather representative statements from *every region* of the extracted text
   including the opening and final recommendation; budget roughly 14k source
   characters for the model.
4. Call the preinstalled `news_scrapper.adapters.samsung_chat.call_samsung_chat`
   with the SAME authenticated Samsung Chat endpoint/settings already used by
   article and report analysis. Request strict JSON: `{"summary": "..."}`.
5. If Samsung Chat is unavailable, fails, or returns no usable summary,
   generate using the already-installed LOCAL DistilBART weights configured
   via `news_scrapper.semantic_clustering.BART_MODEL_DIR`.
6. BART produces notes for multiple document sections, then reduces those
   notes to one short summary. The same shared BART model and inference
   locks are reused; the code does NOT download missing weights.
7. Description is capped at **300 characters** and saved to the draft.

## Existing Samsung Chat configuration

Uses these variables from the existing adapter, with no new endpoint:

    SAMSUNG_CHAT_URL
    SAMSUNG_CHAT_CLIENT
    SAMSUNG_CHAT_TOKEN
    SAMSUNG_CHAT_MODEL_ID

Do NOT paste tokens into source code or GitHub. Configure authorized Samsung
corporate endpoints in the backend environment. The content selection
runs locally; only the selected evidence goes to Samsung Chat. Source text
is treated as untrusted data in the prompt.

## No misleading fallback

- `source_document.summary_method = samsung_chat`: Samsung Chat worked.
- `source_document.summary_method = bart`: local DistilBART took over.
- `source_document.summary_method = unavailable`: both engines failed.
  The original document remains saved, the extracted text remains present,
  and Description says summarization is unavailable and can be entered
  manually. It does NOT silently use the first 300 characters.
- Unreadable PDFs are still stored with their extraction-error Description.

The BART fallback requires a local model directory and Transformers/PyTorch
already supported by the NewsScrapper backend. For a large PDF on a normal
CPU, multi-section generation can take time. Samsung Chat's configured timeout
is controlled by SAMSUNG_CHAT_TIMEOUT in the existing adapter.

## Smoke tests

Copy `legacy_app/scripts/test_document_summarizer.py` into
`C:\scrappyV3\scripts\test_document_summarizer.py`, then run:

    & C:\scrappyV3\venv\Scripts\python.exe C:\scrappyV3\scripts\test_document_summarizer.py

The smoke test mocks the models and validates primary/fallback routing,
long-document section coverage, final recommendation retention and the
300-character limit. Test actual Samsung Chat/BART by uploading a real
readable document and inspecting the returned summary_method metadata.

## Important boundaries

- Full PDF filesize is not the text sent to Chat or BART. Images do not
  become extractable text without a separate authorized OCR path.
- Selection processes all available extracted text, but trims *evidence*
  to the model budget; this is not equivalent to an LLM reading each word
  of a 100 MiB PDF.
- Content beyond the document parser's 200k-character extraction limit
  requires a separate extraction expansion.
- Do not send company documents to unapproved external AI endpoints.

Test branch only; changes have not yet been run on your Windows instance.