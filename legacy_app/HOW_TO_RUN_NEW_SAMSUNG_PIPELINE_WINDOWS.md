# Run the isolated Samsung pipeline on Windows

This guide intentionally uses very simple instructions.

## First: understand what this file does

There are currently two different pipelines.

1. `main.py` is the working Phase 1 backend.
2. `main_new_pipeline_idea.py` is the new Samsung pipeline experiment.

They are separate.

Do **not** erase `main.py`.

Do **not** paste `main_new_pipeline_idea.py` inside `main.py`.

Do **not** rename `main_new_pipeline_idea.py` to `main.py`.

The correct result is:

```text
legacy_app
├── main.py
├── main_new_pipeline_idea.py
├── samsung_web_search_adapter.py
├── samsung_chat_adapter.py
├── article_metadata_adapter.py
├── secure_http.py
└── .env
```

The two main files stay beside each other.

## What was changed in GitHub

No existing backend file was changed for this experiment.

These five new files were added:

```text
legacy_app\main_new_pipeline_idea.py
legacy_app\NEW_PIPELINE_IDEA.md
legacy_app\new_pipeline_idea.env.example
legacy_app\new_pipeline_idea_runtime\.gitignore
legacy_app\tests\test_new_pipeline_idea.py
```

The new Python file calls these existing files:

```text
samsung_web_search_adapter.py
samsung_chat_adapter.py
article_metadata_adapter.py
```

It also reads these existing model files or folders:

```text
local_miniLM_model
bouncer_model.pkl
bouncer_model_broadcast.pkl
```

The existing `main.py`, scheduler and spider are not connected to the new
pipeline yet.

## Part 1: get the latest files from GitHub

### If the project is already on the Windows laptop

1. Open the project folder in File Explorer.
2. Click the address bar.
3. Type `powershell`.
4. Press Enter.
5. A PowerShell window will open in that folder.
6. Type:

```powershell
git pull origin main
```

7. Press Enter.
8. Wait until the command finishes.

### If Git is not being used on the Windows laptop

1. Open the GitHub repository in the browser.
2. Download the repository ZIP.
3. Extract the ZIP.
4. Open the extracted folder.
5. Find the `legacy_app` folder.
6. Copy the complete `legacy_app` folder to the server laptop.

Do not copy only `main_new_pipeline_idea.py` into an old project unless the old
project already contains the three adapters, `secure_http.py`, the Scrapy
project, the model folders and all requirements.

## Part 2: open the backend folder

The examples below assume this folder:

```text
C:\scrappyV2\legacy_app
```

If your project is somewhere else, use your real folder instead.

1. Open File Explorer.
2. Go to:

```text
C:\scrappyV2\legacy_app
```

3. Confirm that you can see:

```text
main.py
main_new_pipeline_idea.py
requirements.txt
new_pipeline_idea.env.example
```

If `main_new_pipeline_idea.py` is missing, stop. The GitHub update was not
copied correctly.

## Part 3: prepare Python

1. Click the File Explorer address bar.
2. Type `powershell`.
3. Press Enter.
4. Create the virtual environment if `.venv` does not already exist:

```powershell
py -m venv .venv
```

5. Install the required Python packages:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

6. Wait until installation is complete.

## Part 4: check the MiniLM model

The new pipeline needs MiniLM for the bouncer and semantic clustering.

Inside `C:\scrappyV2\legacy_app`, confirm that at least one of these folders
exists:

```text
local_miniLM_model
```

or:

```text
semantic_model
```

The folder must contain the downloaded Sentence Transformer model files.

### What about BART?

BART is not used by `main_new_pipeline_idea.py`.

Samsung Chat replaces BART in this experiment. You may keep
`local_bart_model`; it will simply not be loaded by the new pipeline.

## Part 5: add the Samsung settings

1. Stay inside:

```text
C:\scrappyV2\legacy_app
```

2. Find the file named `.env`.
3. If `.env` does not exist:
   - copy `.env.example`;
   - rename the copy to `.env`.
4. Right-click `.env`.
5. Open it with Notepad.
6. Add the following lines at the bottom:

```env
SAMSUNG_WEB_SEARCH_URL=https://genai-openapi.sec.samsung.net/swahq/trial/api-web-search/openapi/web-search/v1/search
SAMSUNG_WEB_SEARCH_CLIENT=PUT_THE_REAL_WEB_SEARCH_CLIENT_HERE
SAMSUNG_WEB_SEARCH_TOKEN=PUT_THE_REAL_WEB_SEARCH_TOKEN_HERE
SAMSUNG_WEB_SEARCH_TIMEOUT=90

SAMSUNG_CHAT_URL=https://genai-openapi.sec.samsung.net/swahq/trial/api-chat/openapi/chat/v1/messages
SAMSUNG_CHAT_CLIENT=PUT_THE_REAL_CHAT_CLIENT_HERE
SAMSUNG_CHAT_TOKEN=PUT_THE_REAL_CHAT_TOKEN_HERE
SAMSUNG_CHAT_MODEL_ID=PUT_THE_APPROVED_CHAT_MODEL_ID_HERE
SAMSUNG_CHAT_TIMEOUT=180

NEWSSCRAPPER_USE_SYSTEM_CA=true

NEW_PIPELINE_IDEA_WEB_SEARCH_RPM=3
NEW_PIPELINE_IDEA_CHAT_RPM=3
NEW_PIPELINE_IDEA_MAX_ATTEMPTS=3
NEW_PIPELINE_IDEA_RETRY_BACKOFF_SECONDS=5

NEW_PIPELINE_IDEA_BOUNCER_LOW_THRESHOLD=0.45
NEW_PIPELINE_IDEA_BOUNCER_DROP_THRESHOLD=0.60
NEW_PIPELINE_IDEA_CLUSTER_DISTANCE=0.32

ARTICLE_IMAGE_METADATA_ENABLED=true
ARTICLE_IMAGE_METADATA_TIMEOUT=12
```

7. Replace every `PUT_THE_REAL_..._HERE` value with the real company value.
8. Do not add spaces before or after `=`.
9. Press Ctrl+S.
10. Close Notepad.

Never upload `.env` to GitHub. It contains private credentials.

Do not disable SSL verification. If the company certificate is required, add:

```env
REQUESTS_CA_BUNDLE=C:\path\to\company-ca-bundle.pem
```

Use the real certificate file path.

## Part 6: check the design without calling Samsung

1. Open PowerShell in:

```text
C:\scrappyV2\legacy_app
```

2. Run:

```powershell
.\.venv\Scripts\python.exe .\main_new_pipeline_idea.py --show-flow
```

3. You should see seven stages ending with:

```text
Samsung Chat summarizes each clustered event
Feed-compatible JSON is written
```

This command does not call Samsung Web Search or Samsung Chat.

## Part 7: create the spider discovery file

The spider creates the list of article titles and links. The new pipeline then
uses Samsung Web Search to extract the authoritative article information.

1. Create this folder if it does not exist:

```text
C:\scrappyV2\legacy_app\new_pipeline_idea_runtime\default
```

2. Open PowerShell in:

```text
C:\scrappyV2\legacy_app\news_aggregator
```

3. Choose the date to scan. The example below uses `2026-07-24`.
4. Run this command as one complete command:

```powershell
..\.venv\Scripts\python.exe -m scrapy crawl news_spider -a keyword="AI,Samsung,display,semiconductor" -a from_date=2026-07-24 -a to_date=2026-07-24 -a target_sites=All -a sites_file="C:\scrappyV2\legacy_app\sites.json" -s ROBOTSTXT_OBEY=True -O "C:\scrappyV2\legacy_app\new_pipeline_idea_runtime\default\discovered_articles.json"
```

5. Wait for the spider to finish.
6. Open:

```text
C:\scrappyV2\legacy_app\new_pipeline_idea_runtime\default
```

7. Confirm that this file exists:

```text
discovered_articles.json
```

For the Broadcast profile, change:

```text
sites.json
```

to:

```text
sites_broadcast.json
```

Also change the output folder from `default` to `broadcast`.

## Part 8: run the isolated Samsung pipeline

### Default profile

1. Open PowerShell in:

```text
C:\scrappyV2\legacy_app
```

2. Run:

```powershell
.\.venv\Scripts\python.exe .\main_new_pipeline_idea.py --input .\new_pipeline_idea_runtime\default\discovered_articles.json --output .\new_pipeline_idea_runtime\default\feed.json --profile default --keywords "AI,Samsung,display,semiconductor" --allow-live-services
```

### Broadcast profile

Use:

```powershell
.\.venv\Scripts\python.exe .\main_new_pipeline_idea.py --input .\new_pipeline_idea_runtime\broadcast\discovered_articles.json --output .\new_pipeline_idea_runtime\broadcast\feed.json --profile broadcast --keywords "broadcast,DTH,cable,OTT,television" --allow-live-services
```

The `--allow-live-services` text is required. It confirms that Samsung API calls
are allowed for this manual run.

## Part 9: understand the waiting time

Web Search allows a maximum of three requests per minute.

Samsung Chat also allows a maximum of three requests per minute.

The program deliberately waits approximately 20 seconds between calls to the
same Samsung service.

This means the process can take a long time. That is expected.

Do not close PowerShell while it is working.

Successful Samsung results are saved as checkpoints. If the run stops, start
the same command again. Completed successful requests will be reused.

## Part 10: understand the terminal messages

You will see messages similar to:

```text
[NEW-PIPELINE:default] discovery_input: Received 20 crawler/RSS candidates
[NEW-PIPELINE:default] samsung_web_search: 1/20 processed
[NEW-PIPELINE:default] bouncer: Kept 15; dropped 2
[NEW-PIPELINE:default] minilm_clustering: Condensed 15 articles into 8 events
[NEW-PIPELINE:default] samsung_chat: 1/8 processed
[NEW-PIPELINE:default] feed_output: Prepared 8 feed items
```

The exact numbers will be different.

## Part 11: open the output files

After the command finishes, open:

```text
C:\scrappyV2\legacy_app\new_pipeline_idea_runtime\default
```

You should see:

```text
feed.json
feed.quarantine.json
feed.report.json
```

Their meanings are:

- `feed.json`: final clustered and Samsung Chat-summarized articles.
- `feed.quarantine.json`: Web Search failures and bouncer drops.
- `feed.report.json`: counts and the stage-by-stage activity log.

These files do not automatically appear in the website feed. This is still an
isolated experiment.

## Part 12: run the normal backend

The normal backend command has not changed:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Running `main.py` starts the current working application.

Running `main_new_pipeline_idea.py` starts one manual experimental pipeline run.

They are different commands.

## Very short version

1. Pull the latest GitHub code.
2. Keep `main.py` unchanged.
3. Keep `main_new_pipeline_idea.py` beside `main.py`.
4. Install `requirements.txt`.
5. Put MiniLM in `local_miniLM_model` or `semantic_model`.
6. Put the Samsung client, tokens and Chat model ID in `.env`.
7. Run `--show-flow`.
8. Run the spider to create `discovered_articles.json`.
9. Run `main_new_pipeline_idea.py` with `--allow-live-services`.
10. Read `feed.json`, `feed.quarantine.json` and `feed.report.json`.
