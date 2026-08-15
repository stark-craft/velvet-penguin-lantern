# English → Korean translation performance audit

## Resulting engine order

1. On a secure-context Chrome desktop that exposes the built-in `Translator`
   API, TechScout uses the browser's on-device English → Korean model. Visible
   strings are translated first and applied one by one.
2. On the plain-HTTP LAN deployment, unsupported browsers, or a browser-native
   failure, TechScout uses the bundled local Marian model through FastAPI.
3. Neither path needs Google Cloud, an external translation credential, or a
   user identity. The language setting and translation cache remain in that
   browser; the backend LRU is process-memory-only and stores no viewer key.

English rollback does not translate Korean back to English. The browser keeps
the exact original text and attributes and restores those originals at any
point, including while a request or model download is still running.

## Removed bottlenecks

- Responses update their waiting text nodes directly. The old implementation
  rescanned the entire document after every batch.
- Equal strings are deduplicated in the DOM queue, in each API request, and
  again in the backend before model inference.
- A bounded `sessionStorage` LRU prevents repeated translation after route
  changes or refreshes in the same private browser session.
- The backend rechecks its LRU after acquiring the inference lock. Concurrent
  requests for the same string therefore share the first result rather than
  repeating model work.
- Inference batches are sorted by source length to reduce tokenizer padding,
  while results are restored to request order.
- Immediate UI dictionary labels remain synchronous; viewport content has the
  highest model priority; remaining content continues progressively.
- Model preparation has an explicit single-flight warmup endpoint and clear
  loading, download, progress, retry, and return-to-English states.

## Repeatable orchestration benchmark

Run from the repository root with the project environment:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_translation_pipeline.py
```

The benchmark uses a deterministic inference stub so it measures orchestration
instead of comparing unrelated CPUs or requiring the large model. A run on
2026-08-15 produced:

```text
Input items:              400
Unique inferred items:    40
Duplicate work avoided:   360
Cold orchestration:       25.21 ms
Warm-cache orchestration: 0.10 ms
Warm/cold speedup:        255.4x
```

This is not a claim that Marian inference itself is 255× faster. It proves that
the optimized layer submits 40 unique items instead of 400 and submits zero
items on the warm repeat. Real first-run time still depends on model loading,
CPU/GPU speed, text length, and whether Chrome needs to download its on-device
language pack.

## Verification

```text
Frontend unit/contract tests: 28 passed
Frontend production build:    passed (1,875 modules)
Backend translation tests:    6 passed
Python compile check:          passed
```
