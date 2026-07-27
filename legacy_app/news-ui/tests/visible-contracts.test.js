import assert from 'node:assert/strict';
import test from 'node:test';

import { articleKey } from '../src/news-scrapper/utils/intelligence.js';
import { normalizeArticle, structuredSummary } from '../src/news-scrapper/utils/normalize.js';

test('saved identity remains stable after backend persistence and reload', () => {
  const feedArticle = {
    id: 'temporary-ui-id',
    title: 'A signal',
    link: 'https://example.test/articles/signal',
  };
  const persistedArticle = {
    article_key: 'backend-hash',
    title: 'A signal',
    link: 'https://example.test/articles/signal',
  };

  assert.equal(articleKey(feedArticle), articleKey(persistedArticle));
});

test('paragraph-only legacy summaries become a lead plus bullets', () => {
  const raw = {
    title: 'Display investment',
    master_summary:
      'Samsung announced a new display investment. The program begins this quarter. ' +
      'The company will expand production capacity. Partners will support the rollout. ' +
      'The investment targets premium television demand.',
  };
  const normalized = normalizeArticle(raw);

  assert.equal(
    normalized.summary_lead,
    'Samsung announced a new display investment. The program begins this quarter.',
  );
  assert.deepEqual(normalized.summary_points, [
    'The company will expand production capacity.',
    'Partners will support the rollout.',
    'The investment targets premium television demand.',
  ]);
  assert.notEqual(normalized.summary_lead, raw.master_summary);
});

test('Samsung lead and bullet contract is preserved without rewriting', () => {
  const result = structuredSummary({
    summary_lead: 'A concise executive lead.',
    summary_points: ['First fact.', 'Second fact.', 'Third fact.'],
    master_summary: 'A concise executive lead. • First fact. • Second fact. • Third fact.',
  });

  assert.equal(result.lead, 'A concise executive lead.');
  assert.deepEqual(result.points, ['First fact.', 'Second fact.', 'Third fact.']);
});
