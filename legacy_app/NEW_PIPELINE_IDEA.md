# Samsung enrichment pipeline idea

This is a parallel, opt-in design. It does not replace or modify the current
`main.py`, Scrapy spider, scheduler, semantic clustering module, or adapters.
Nothing in the production application imports `main_new_pipeline_idea.py`.

## Proposed flow

```text
Existing Scrapy spider
  │
  │ RSS/site discovery records: title, URL, date, source, matched keywords
  ▼
Samsung Web Search adapter
  │ authoritative article content, maximum 3 requests per minute
  │ failed matches go to quarantine; crawler body text is not treated as truth
  ▼
Profile bouncer
  │ default/broadcast model, low-priority threshold 0.45, drop threshold 0.60
  ▼
Article metadata adapter
  │ preserves an existing image; finds OpenGraph/JSON-LD image only if missing
  ▼
Local all-MiniLM-L6-v2
  │ semantic clustering with unique-publisher protection
  ▼
Samsung Chat adapter
  │ one final executive summary per clustered event, maximum 3 requests/minute
  ▼
Feed-compatible JSON
```

Samsung Chat runs after clustering, so five reports about the same event consume
one Chat request rather than five. BART is not loaded or called by this design.
Web Search and Chat have independent rate limiters because they are separate
services, but each is hard-capped at three requests per minute.

## Reliability decisions

- Successful Web Search and Chat results are checkpointed under
  `new_pipeline_idea_runtime/<profile>/`. An interrupted run can resume without
  repeating completed paid/rate-limited calls.
- Web Search failures are quarantined because this design treats Web Search—not
  crawler page text—as the article extraction stage.
- Chat failures remain visible as retryable feed candidates with their enriched
  source text. A rerun reuses the Web Search checkpoint and retries Chat.
- MiniLM loads only from `semantic_model` or `local_miniLM_model`. This proposal
  never downloads a model automatically.
- The existing secure adapters remain responsible for company CA/system
  certificate verification. The supplied legacy `VERIFY_SSL=false` behavior was
  intentionally not copied.
- Tokens and client credentials are read from environment variables. The
  attached secret values were not copied into this repository.

## Review without activating anything

From the `legacy_app` directory:

```powershell
.\.venv\Scripts\python.exe .\main_new_pipeline_idea.py --show-flow
```

That command prints the design and makes no network requests.

## Future manual proof run

Only after reviewing the proposal:

1. Copy the variable names from `new_pipeline_idea.env.example` into the local,
   Git-ignored `.env`.
2. Add the real Samsung client, token, and approved Chat model ID locally.
3. Make sure `local_miniLM_model` or `semantic_model` exists.
4. Produce a JSON list of discovery records with the existing spider.
5. Run:

```powershell
.\.venv\Scripts\python.exe .\main_new_pipeline_idea.py `
  --input .\discovered_articles.json `
  --output .\new_pipeline_idea_runtime\default\feed.json `
  --profile default `
  --keywords "AI,display,semiconductor" `
  --allow-live-services
```

The explicit `--allow-live-services` flag prevents an accidental Samsung API
run while the file is only being reviewed.

## Output

- `feed.json`: feed-compatible clustered and summarized items.
- `feed.quarantine.json`: Web Search failures and bouncer drops.
- `feed.report.json`: stage counts and an audit timeline.

## Adoption boundary

To adopt this later, connect the current scheduler to this orchestrator in a
separate reviewed change. Until that happens, the working Phase 1 pipeline is
unchanged.
