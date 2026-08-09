# Supernova Orchid Atlas

## A beginner-friendly Windows guide for installing the English-to-Korean model

This guide installs the private, local translation model used by the
**English / Korean** control in News Scrapper. Follow the steps in order. You
do not need a Hugging Face account or token because the model is public.

## Contents

1. [The exact model](#1-the-exact-model)
2. [Where the model belongs](#2-where-the-model-belongs)
3. [Recommended automatic download](#3-recommended-automatic-download)
4. [Manual browser download](#4-manual-browser-download)
5. [Move the model to an offline server](#5-move-the-model-to-an-offline-server)
6. [Configure the environment file](#6-configure-the-environment-file)
7. [Check the installation](#7-check-the-installation)
8. [Start the backend and test a translation](#8-start-the-backend-and-test-a-translation)
9. [Test the button in the browser](#9-test-the-button-in-the-browser)
10. [Common problems](#10-common-problems)
11. [What the application does internally](#11-what-the-application-does-internally)

## 1. The exact model

Download this model and no similarly named substitute:

```text
Helsinki-NLP/opus-mt-tc-big-en-ko
```

- Official model page: <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko>
- Official file list: <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/tree/main>
- Official Hugging Face download documentation:
  <https://huggingface.co/docs/huggingface_hub/main/guides/download>

This model translates **English to Korean**. Do not download a Korean-to-English
model, `opus-mt-ko-en`, or the older `opus-mt-en-ko` model by mistake.

The repository is public and uses the CC-BY-4.0 license. Review the model card
before distributing translated output outside the company.

## 2. Where the model belongs

### Portable production/server computer

Use this exact folder:

```text
C:\App_Portable\model_weights\opus-mt-tc-big-en-ko
```

### Windows development computer

If the project is at `C:\scrappyV2`, use:

```text
C:\scrappyV2\model_weights\opus-mt-tc-big-en-ko
```

If your project has a different root folder, replace `C:\scrappyV2` with that
folder. The important part is:

```text
<project root>\model_weights\opus-mt-tc-big-en-ko
```

The completed directory should look like this:

```text
opus-mt-tc-big-en-ko\
|-- config.json
|-- generation_config.json
|-- model.safetensors
|-- source.spm
|-- target.spm
|-- special_tokens_map.json
|-- tokenizer_config.json
`-- vocab.json
```

Do not accidentally create an extra nested directory such as:

```text
C:\App_Portable\model_weights\opus-mt-tc-big-en-ko\opus-mt-tc-big-en-ko\...
```

The application must find `config.json` directly inside the configured model
folder.

## 3. Recommended automatic download

Use this method on an internet-connected Windows computer. It downloads only
the files the application needs and avoids duplicate model formats.

### A. Portable server layout with `python_embed`

1. Open **File Explorer**.
2. Go to `C:\App_Portable`.
3. Click the address bar, type `powershell`, and press **Enter**.
4. Confirm that the PowerShell prompt starts with:

   ```text
   PS C:\App_Portable>
   ```

5. Install the application dependencies if this has not already been done:

   ```powershell
   .\python_embed\python.exe -m pip install -r .\requirements.txt
   ```

6. Create the model directory:

   ```powershell
   New-Item -ItemType Directory -Force ".\model_weights\opus-mt-tc-big-en-ko" | Out-Null
   ```

7. Copy and run this complete command:

   ```powershell
   .\python_embed\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Helsinki-NLP/opus-mt-tc-big-en-ko', local_dir=r'C:\App_Portable\model_weights\opus-mt-tc-big-en-ko', allow_patterns=['config.json','generation_config.json','model.safetensors','source.spm','target.spm','special_tokens_map.json','tokenizer_config.json','vocab.json'])"
   ```

8. Wait until the PowerShell prompt returns. Do not close the window while files
   are downloading.

### B. Development layout with `.venv`

1. Open **File Explorer**.
2. Go to `C:\scrappyV2` (or your actual project root).
3. Click the address bar, type `powershell`, and press **Enter**.
4. Create the model directory:

   ```powershell
   New-Item -ItemType Directory -Force ".\model_weights\opus-mt-tc-big-en-ko" | Out-Null
   ```

5. Install the dependencies if needed:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
   ```

6. Download only the required model files:

   ```powershell
   .\.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Helsinki-NLP/opus-mt-tc-big-en-ko', local_dir=r'C:\scrappyV2\model_weights\opus-mt-tc-big-en-ko', allow_patterns=['config.json','generation_config.json','model.safetensors','source.spm','target.spm','special_tokens_map.json','tokenizer_config.json','vocab.json'])"
   ```

If your development folder is not `C:\scrappyV2`, change only the
`local_dir=...` path in the last command.

## 4. Manual browser download

Use this method when command-line downloading is blocked by a company proxy or
certificate policy.

1. Open this official page in Chrome or Edge:
   <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/tree/main>
2. Create this directory on the target computer:

   ```text
   C:\App_Portable\model_weights\opus-mt-tc-big-en-ko
   ```

3. On the Hugging Face page, open each filename listed below.
4. On each file page, click **download** (the downward-arrow button).
5. Save the file with its original filename directly into the model directory.

Download exactly these eight files:

| File | Direct official download |
|---|---|
| `config.json` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/config.json?download=true> |
| `generation_config.json` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/generation_config.json?download=true> |
| `model.safetensors` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/model.safetensors?download=true> |
| `source.spm` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/source.spm?download=true> |
| `target.spm` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/target.spm?download=true> |
| `special_tokens_map.json` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/special_tokens_map.json?download=true> |
| `tokenizer_config.json` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/tokenizer_config.json?download=true> |
| `vocab.json` | <https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-ko/resolve/main/vocab.json?download=true> |

Important:

- Download `model.safetensors`.
- Do **not** also download `pytorch_model.bin`; it is another representation of
  the same model weights and wastes disk space.
- Do not download `tf_model.h5` for this application.
- Do not download `benchmark_translations.zip`.
- Windows may hide filename extensions. In File Explorer, select **View > Show
  > File name extensions** and verify that no file ended up as `.json.json`.
- Never work around company SSL errors by disabling certificate verification.
  Use the approved browser/manual-transfer method instead.

## 5. Move the model to an offline server

If `C:\App_Portable` is on a computer without internet access:

1. Complete section 3 or 4 on an approved internet-connected computer.
2. Open the completed `opus-mt-tc-big-en-ko` folder.
3. Confirm that all eight files shown above exist.
4. Copy the whole folder to an approved USB drive or company file share.
5. On the server, create `C:\App_Portable\model_weights` if it does not exist.
6. Copy the whole folder into it.
7. Confirm that the final path is exactly:

   ```text
   C:\App_Portable\model_weights\opus-mt-tc-big-en-ko\config.json
   ```

The model must not be committed to GitHub. Only the application code and these
instructions belong in Git.

## 6. Configure the environment file

1. Open `C:\App_Portable\.env` in Notepad or VS Code.
2. Add or update this block:

   ```env
   # Root folder containing all local Hugging Face models.
   SENSE_MODEL_ROOT=C:\App_Portable\model_weights

   # Turn the private English-to-Korean service on.
   KOREAN_TRANSLATION_ENABLED=true

   # The exact public Hugging Face model identifier.
   KOREAN_TRANSLATION_MODEL_ID=Helsinki-NLP/opus-mt-tc-big-en-ko

   # Exact local model folder used by the portable Windows server.
   KOREAN_TRANSLATION_MODEL_PATH=C:\App_Portable\model_weights\opus-mt-tc-big-en-ko

   # Never download a model when a user changes the language.
   KOREAN_TRANSLATION_LOCAL_ONLY=true

   # Use CUDA when available; otherwise use the CPU.
   KOREAN_TRANSLATION_DEVICE=auto

   # Safety and performance settings. Keep these defaults initially.
   KOREAN_TRANSLATION_MAX_ITEMS=80
   KOREAN_TRANSLATION_MAX_TEXT_CHARS=20000
   KOREAN_TRANSLATION_CACHE_SIZE=5000
   KOREAN_TRANSLATION_BATCH_SIZE=8
   KOREAN_TRANSLATION_NUM_BEAMS=2
   ```

3. Press **Ctrl+S** to save the file.
4. Close and restart the backend. Environment settings are read when the
   backend process starts.

For a development checkout at `C:\scrappyV2`, change only these two paths:

```env
SENSE_MODEL_ROOT=C:\scrappyV2\model_weights
KOREAN_TRANSLATION_MODEL_PATH=C:\scrappyV2\model_weights\opus-mt-tc-big-en-ko
```

No frontend rebuild is required merely because a model was copied or `.env`
was changed. Restart the backend and refresh the browser.

## 7. Check the installation

### A. Check the files

Open PowerShell and run:

```powershell
$ModelFolder = "C:\App_Portable\model_weights\opus-mt-tc-big-en-ko"
Get-ChildItem $ModelFolder
Test-Path "$ModelFolder\config.json"
Test-Path "$ModelFolder\source.spm"
Test-Path "$ModelFolder\target.spm"
Test-Path "$ModelFolder\model.safetensors"
```

The four `Test-Path` commands must each print:

```text
True
```

### B. Check the Python libraries

From `C:\App_Portable`, run:

```powershell
.\python_embed\python.exe -c "import torch, transformers, sentencepiece, sacremoses; print('Translation libraries: OK')"
```

Expected output:

```text
Translation libraries: OK
```

On a development computer, use this instead:

```powershell
.\.venv\Scripts\python.exe -c "import torch, transformers, sentencepiece, sacremoses; print('Translation libraries: OK')"
```

## 8. Start the backend and test a translation

### A. Start the portable server

1. Open PowerShell in `C:\App_Portable`.
2. Run:

   ```powershell
   .\python_embed\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

3. Leave this window open.
4. Open a second PowerShell window for the checks below.

If the normal server batch file already starts this command, use that batch
file instead. Do not start a second backend on the same port.

### B. Ask the backend whether the model is installed

In the second PowerShell window, run:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/translation/status" | ConvertTo-Json -Depth 5
```

The response should include values similar to:

```json
{
  "enabled": true,
  "installed": true,
  "ready": false,
  "model": "Helsinki-NLP/opus-mt-tc-big-en-ko",
  "local_only": true
}
```

`"ready": false` is normal before the first translation. The application
loads the model lazily so ordinary English users do not consume its memory.

### C. Perform a real translation test

Run this entire block in the second PowerShell window:

```powershell
$TranslationBody = @{
  texts = @("Samsung is expanding its artificial intelligence strategy.")
  source_language = "en"
  target_language = "ko"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8000/translation/korean" `
  -Method Post `
  -ContentType "application/json" `
  -Body $TranslationBody | ConvertTo-Json -Depth 5
```

The first request may take noticeably longer because PyTorch is loading the
model. A successful response contains:

```text
"engine": "local-marian"
"model": "Helsinki-NLP/opus-mt-tc-big-en-ko"
```

and a Korean value inside `translated`.

Run the status command again. `"ready"` should now be `true`.

## 9. Test the button in the browser

1. Keep the backend running.
2. Start or open the frontend normally.
3. Open News Scrapper in Chrome or Edge.
4. Open **Settings**.
5. Select the Korean language option.
6. Wait for the first translation request to finish.
7. Confirm that navigation, headings, buttons, article cards, dossiers, and
   supported dynamic text change to Korean.
8. Switch back to English and confirm that the English interface returns.
9. Open the site in a different browser or private window. Its language remains
   independent because the preference is stored per browser, not globally.

Product names, company names, URLs, and some technical terms may correctly
remain in English. That is not evidence that the model failed.

## 10. Common problems

### Status says `installed: false`

The configured folder is wrong, an extra nested directory exists, or one of
these required files is missing:

```text
config.json
source.spm
target.spm
model.safetensors (or pytorch_model.bin, but not both)
```

Check `KOREAN_TRANSLATION_MODEL_PATH`, run the four `Test-Path` commands from
section 7, and restart the backend.

### Status says `ready: false`

This is normal until a real translation request occurs. Run the test in section
8C. If it succeeds, status should then report `ready: true`.

### `No module named sentencepiece`, `transformers`, or `torch`

Run from `C:\App_Portable`:

```powershell
.\python_embed\python.exe -m pip install -r .\requirements.txt
```

Then restart the backend.

### PowerShell says `python` is not recognized

The portable server intentionally has no system Python. Use:

```powershell
.\python_embed\python.exe
```

Do not use plain `python` on that server.

### Download fails with an SSL/certificate error

Do not disable SSL verification. Use the approved company CA configuration, or
download the eight files through the approved browser on another computer and
follow section 5.

### Backend returns HTTP 503

Read the `detail` field in the response and the backend terminal. Common causes
are an incomplete model folder, a damaged download, insufficient memory, or an
invalid device setting. Set `KOREAN_TRANSLATION_DEVICE=auto`, restart, and test
again.

### The first switch to Korean feels slow

This is expected because the model is loaded only on first use. Later requests
reuse the loaded model and an in-memory translation cache. On a low-memory CPU
server, try:

```env
KOREAN_TRANSLATION_BATCH_SIZE=4
```

Restart the backend after changing it. Use `2` only if the server still runs
out of memory.

### The browser does not change language but the endpoint test succeeds

1. Refresh the browser with **Ctrl+F5**.
2. Open Developer Tools with **F12** and check the Console and Network tabs.
3. Confirm the frontend is calling the same host and port as the running
   backend.
4. Confirm `/translation/korean` returns HTTP 200.

## 11. What the application does internally

- The backend starts without loading the translation model.
- When one browser selects Korean, that browser requests English-to-Korean
  translations from `/translation/korean`.
- The backend loads the local model on the first request and then reuses it.
- The user's language selection is stored in that browser's local storage.
- One user's Korean selection does not change another user's interface.
- `KOREAN_TRANSLATION_LOCAL_ONLY=true` prevents surprise runtime downloads.
- The backend writes generated tokenizer cache data under
  `news_scrapper\runtime\translation_tokenizer_cache`; that folder is runtime
  data and is not the downloaded model.
- Switching back to English restores the source interface strings; it does not
  uninstall or reload the model.

Installation is complete only after all three checks pass:

```text
1. /translation/status says installed: true
2. POST /translation/korean returns Korean text
3. The browser can switch between English and Korean
```
