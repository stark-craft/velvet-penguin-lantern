# TechScout "Create Jira" integration

## Behavior
A user checks one or more news cards and clicks **Create Jira**.
The browser sends **one** `POST /jira/news-tickets` request with the selected
article title, summary, source, date, article URL and image URL.

The backend creates **one Jira issue** containing a separate section for each
selected article in Jira's rich **Status Report** field
(`customfield_15302`). The normal Jira description remains empty.
Images are downloaded only from validated public HTTP(S) URLs, with redirects
disabled, a 5 MB limit, and accepted image MIME types. Each successfully
downloaded image is attached through Guy X's Jira CDP client, then referenced
inside the Status Report via `/secure/attachment/{id}/{filename}`.

The UI displays the issue key and an **Open Jira** link. If images fail after
issue creation, the backend still returns the existing Jira issue URL with
warnings; clicking again for the same selection is disabled until selection
changes, reducing accidental duplicate issues.

## Files touched
- `news-ui/src/sampark/all-news/AllNewsPage.jsx` (bottom selection bar)
- `news-ui/src/sampark/SamparkHistory.jsx` (archive checkboxes + bottom bar)
- `news-ui/src/news-scrapper/screens/FeedScreen.jsx` (legacy bottom bar)
- `news-ui/src/news-scrapper/screens/HistoryScreen.jsx` (legacy archive controls)
- `news-ui/src/sampark/shared/CreateJiraAction.jsx` (common action/status)
- `news-ui/src/news-scrapper/api.js` (same-origin request wrapper)
- `news_scrapper/jira_integration/router.py` (FastAPI boundary)
- `news_scrapper/jira_integration/service.py` (Jira mapping)
- `news_scrapper/jira_integration/vendor/` (Guy X source files, copy locally)
- `main.py` and `news-ui/vite.config.js` (API routing)
- `.env.example` and `requirements.txt` (server configuration)

## Development and server-PC setup
1. Preserve the latest working `C:\scrappyV3` working tree and back up any
   uncommitted local edits. The GitHub Samsung News snapshot may differ.
2. Merge/cherry-pick this feature branch only after comparing it with the
   current local branch.
3. Copy the **four original** supplied files to
   `news_scrapper\jira_integration\vendor\`. The test script and standalone
   requirements are optional for this integration.
4. Install `pip install -r requirements.txt` in your existing backend venv.
5. For safe local validation, keep `JIRA_NEWS_ENABLED=false` and run:
   `python -m unittest tests.test_jira_news_integration`
6. Confirm the corporate Windows account used to start FastAPI can log in
   through Guy X's headless SSO, and the project supports Status Report.
7. Set `JIRA_NEWS_PROJECT=SRIDRDSG`, `JIRA_NEWS_ISSUE_TYPE=Task`,
   and **only when ready for real issue creation** `JIRA_NEWS_ENABLED=true`
   in `legacy_app/.env`. Restart FastAPI.
8. Run `uvicorn main:app --reload` from `legacy_app`; start Vite as usual
   in `news-ui`. Test with one selected news card first.
9. For the server PC, repeat the vendor copy + dependency install, use an
   appropriately secured dedicated Chrome/Edge SSO profile and confirm the
   Windows service account can use Kerberos/AD under corporate policy.

## Security and operational limitations
- Jira creation is gated by `review.news.submit` capability and rate-limited
  (8 requests per signed viewer per 10 minutes). A stricter `jira.create`
  capability may be introduced after permissions are agreed.
- The API is opt-in via `JIRA_NEWS_ENABLED`; no client receives Jira cookies.
- The original CDP session is a **server-side** identity, not the individual
  viewer's Jira identity. All Jira issues are created under that SSO account.
- The CDP browser is serialized with a single lock in this process. Do not use
  multiple FastAPI workers with the same CDP Chrome profile.
- If the Jira POST succeeds but the HTTP connection fails before returning a
  key, Jira may have created a ticket. Check Jira before manually retrying.
- Downloading external news images depends on external access and valid TLS;
  failures return warnings without destroying created tickets.
- No live Jira requests were made or verified by creating this branch.
