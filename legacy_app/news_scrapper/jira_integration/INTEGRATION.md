# TechScout → Samsung Jira Tech Sensing reports (feature branch)

## User workflow
- Check 1–30 news cards and select **Create Jira**.
- `POST /jira/news-drafts` returns a job ID immediately; the React panel polls
  `GET /jira/news-jobs/{job_id}` for progress.
- Each article receives its **own** Samsung Chat draft with exactly three factual
  Key Facts and one Samsung/India-first strategic Our Insights paragraph.
- Optional Samsung Web Search adds public research context only. The published
  Source section uses **only links already attached to the article**.
- Review and edit title, category, all three facts, Our Insights and caption.
- `POST /jira/news-drafts/{job_id}/publish` starts one independent Jira issue
  per approved draft, and returns another job ID for progress and issue links.
- Reporter remains the backend's Jira SSO account. Assignee behavior follows
  the locally deployed JiraOps/service configuration and project defaults.

## Jira field formatting
- Summary: `[Tech Sensing] <headline>`
- Description: **empty string**
- Status Report: `customfield_15302`, with 16pt heading, 14pt category,
  nested exactly three factual Key Facts, links and publication dates,
  Our Insights, and a centered embedded image/caption.
- Images are uploaded with Guy X's `attach_file_to_jira` and embedded as
  `/secure/attachment/{id}/{filename}` in a follow-up `update_ticket`.
- Missing image or failed attachment does not throw away a created ticket.

## Quotas and automatic continuation
- The existing `samsung_chat` and `samsung_web_search` adapters each
  share an app-wide `PacedRateLimiter`: at most **3 requests/minute**,
  spaced at least **20 seconds** between request starts per API, including
  calls made elsewhere in TechScout.
- On HTTP 429, only the **read-only Chat/Search** call is paused and retried.
  It honors the upstream `Retry-After` header (including an HTTP-date), or
  uses a 60-second minimum exponential fallback capped at 600 seconds.
  The panel displays the automatic retry countdown and progress.
- The worker processes the selected articles sequentially. Do **not** restart
  the backend during an in-progress job; running jobs are **in-memory**, so
  they cannot resume after a process restart. Auto-resume applies to live
  rate-limited jobs, not server restarts.
- **Jira CREATE is never auto-retried** because an uncertain response could
  hide an already-created ticket.

## Duplicate protection and failure handling
- A SQLite file tracks successful Jira issue URLs by normalized article link,
  or article title+source+date as a fallback. It survives normal restarts.
  Configure `JIRA_NEWS_DB_PATH` if persistent backend data lives elsewhere.
- `JIRA_NEWS_DB_PATH` defaults to `data/jira_news_issues.sqlite3` relative
  to the server's current working directory. Keep it in writable persistent
  storage, not a disposable portable package folder.
- Existing issues return their original link instead of a second create.
- Per-article failures are shown separately. Unconfirmed Jira writes are
  **not automatically retried**; check Jira before retrying manually.
- Jobs are access-controlled by the TechScout viewer principal and limited
  per viewer to 8 draft/publish starts per ten minutes.

## Configuration
Keep the original Samsung Chat, Samsung Web Search, Jira and browser settings
in the backend's private `.env`. No tokens go into React or the GitHub branch.
Use `JIRA_NEWS_ENABLED=false` until publishing is intended. Draft generation
requires Samsung Chat configured; research is optional when Web Search is unset.

**Install original Guy X bundle (never reconstructed from chat)**:
`news_scrapper/jira_integration/vendor/{jira_ops.py,cdp_api.py,cdp_browser.py,config.py}`.
Keep `websocket-client>=1.6,<2` installed in the backend venv.

## Deployment caution
This feature branch is based on a reconstructed `legacy_app/` snapshot,
while the office `C:\\scrappyV3` and App_Portable deployments may be newer.
**Do not overwrite existing project files blindly**. For the new version,
copy the new `generation.py`, `jobs.py` and `jira-report.css` plus targeted
updates to `router.py`, `service.py`,
`news-ui/src/news-scrapper/api.js` and
`news-ui/src/sampark/shared/CreateJiraAction.jsx`.
The new Jira generation also updates the existing
`news_scrapper/adapters/samsung_chat.py` and
`news_scrapper/adapters/samsung_web_search.py` in two small 429 handling
blocks to expose Retry-After response headers. Other Sampark pages already
use the shared CreateJiraAction component.
Do not copy `legacy_app/` as a folder into the project root.
Keep `WEB_CONCURRENCY=1` for one shared Chrome CDP profile.
