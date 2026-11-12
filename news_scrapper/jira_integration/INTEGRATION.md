# Tech Sensing → Jira integration (test branch)

## Existing authentication

Use the installed SSO-backed JiraOps vendor bundle. Do not replace the vendor code or introduce a frontend Jira login. JiraOps is intentionally not checked into the GitHub repo.

## Deployment configuration

- Set JIRA_NEWS_ENABLED=true and JIRA_NEWS_PROJECT to the authorized Jira project key in the server's private .env. JIRA_NEWS_ISSUE_TYPE defaults to Task.
- Samsung Chat needs existing SAMSUNG_CHAT_URL, SAMSUNG_CHAT_CLIENT, SAMSUNG_CHAT_TOKEN, and SAMSUNG_CHAT_MODEL_ID. Samsung Web Search is optional and uses existing SAMSUNG_WEB_SEARCH_* settings.
- The signed viewer must possess review.news.submit capability. The browser never receives Jira credentials.
- Keep NEWS_RUNTIME_DIR writable for the SQLite Jira issue identity map. JIRA_NEWS_DB_PATH may override the location.
- Use one FastAPI worker for the shared JiraOps CDP browser target.
- Vite now proxies /jira to FastAPI; production uses same-origin FastAPI routes.

## Workflow

1. Select 1–30 articles in Sampark All News. Create Jira begins drafts, NOT Jira creation.
2. POST /jira/news-drafts starts draft generation. GET /jira/news-jobs/{job_id} reports progress.
3. Review and edit each report: headline, category, exactly three sourced Key Facts, original publisher source links and dates, 60–100 words of Samsung strategy, image caption.
4. POST /jira/news-drafts/{draft_job_id}/insights/{index} regenerates just the insight.
5. POST /jira/news-drafts/{draft_job_id}/publish creates one Jira issue per selected report with [Tech Sensing] original headline, blank Description, Status Report in Jira's customfield_15302, and attached inline article image.
6. Review individual issue keys, links and warnings.

If Samsung Chat cannot create a verified report, the preview is kept editable with empty facts and insight. No fallback facts are invented.

Samsung Chat and Web Search use existing shared limiters of at most 3 requests/minute each, and read-only AI calls retry on HTTP 429 with Retry-After / exponential backoff. Jira issue writes are NOT automatically retried after ambiguous failures, to avoid duplicates.

Jobs are in-memory and will not resume after a server restart. Successful ticket mappings are persisted in SQLite; check Jira for any ambiguous issue creation. The legacy /jira/news-tickets endpoint remains available for existing callers.

## Manual validation on your machine

From legacy_app run: python -m unittest tests.test_jira_news_generation
From legacy_app/news-ui run: npm test
From legacy_app/news-ui run: npm run build

Before using production Jira, test with one report in a safe authorized Jira test project, confirming the issue summary, Status Report rendering, and attachment.

## Rollback

Only test/jira-latest-working-20261102 was changed. The main and old Jira feature branches are untouched.
