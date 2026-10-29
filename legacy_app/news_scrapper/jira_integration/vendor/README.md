# Installing Guy X's Jira CDP bundle

Copy the **original, unmodified** files from your trusted local folder
`C:\Users\s.vineet\Downloads\jira_ticket_bundle\jira_ticket_bundle\`
into this directory:

- `jira_ops.py`
- `cdp_api.py`
- `cdp_browser.py`
- `config.py`

The standalone `test_create_ticket_with_images.py` is *not* imported by
TechScout. Keep it outside the production package for manual Jira testing.

The files are intentionally not reconstructed from the chat transcript: the
original `jira_ops.py` is over 100 KB, and pasted messages lost line breaks.
Use the original tested bytes to avoid accidentally changing SSO behavior.

**Do not** commit the Chrome/Edge profile, Jira cookies, secrets, or a local
`.env`. The browser profile is maintained outside this directory by Guy X's
code. The backend's existing `legacy_app/.env` is loaded at application boot.

Required server setup:
1. Install `websocket-client>=1.6,<2` (included in app requirements).
2. Install Chrome/Edge and ensure the account running FastAPI can reach Jira.
3. Set `JIRA_NEWS_ENABLED=true`, `JIRA_NEWS_PROJECT=SRIDRDSG`, and
   `JIRA_NEWS_ISSUE_TYPE=Task` in `legacy_app/.env`.
4. Verify that SSO works for the Windows account under which FastAPI runs.
5. Use a dedicated, least-privilege Jira service identity where corporate policy permits.
6. Confirm the target project supports `customfield_15302`.

For development, leave `JIRA_NEWS_ENABLED=false` until you deliberately
want the Create Jira button to create real Jira issues.
