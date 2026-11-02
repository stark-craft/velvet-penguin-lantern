import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Jira draft, preview and one-issue-per-article wrappers are wired consistently', () => {
  const action = read('../src/sampark/shared/CreateJiraAction.jsx');
  const api = read('../src/news-scrapper/api.js');
  const backend = read('../../news_scrapper/jira_integration/router.py');
  const vite = read('../vite.config.js');
  const allNews = read('../src/sampark/all-news/AllNewsPage.jsx');

  for (const name of ['createJiraNewsDrafts', 'getJiraNewsJob', 'publishJiraNewsDrafts', 'regenerateJiraNewsInsight']) {
    assert.match(action, new RegExp(name));
    assert.match(api, new RegExp('export const ' + name));
  }
  assert.match(action, /key_facts/);
  assert.match(action, /60.?100/);
  assert.match(action, /sanitizeExternalUrl/);
  assert.match(action, /source\.name|source\.url/);
  assert.doesNotMatch(action, /createJiraNewsTicket/);
  assert.match(allNews, /<CreateJiraAction/);

  assert.match(api, /\/jira\/news-drafts/);
  assert.match(api, /\/jira\/news-jobs/);
  assert.match(backend, /@router\.post\("\/news-drafts"\)/);
  assert.match(backend, /@router\.post\("\/news-drafts\/\{draft_job_id\}\/publish"\)/);
  assert.match(backend, /@router\.get\("\/news-jobs\/\{job_id\}"\)/);
  assert.match(vite, /'\/jira'/);
});

test('Jira frontend must never hold credentials or invent a new login path', () => {
  const action = read('../src/sampark/shared/CreateJiraAction.jsx');
  assert.doesNotMatch(action, /JIRA_TOKEN|password|jira-ops-login|Authorization:/i);
  assert.match(action, /target="_blank"/);
  assert.match(action, /noopener noreferrer/);
});
