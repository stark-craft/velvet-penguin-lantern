import assert from 'node:assert/strict';
import test from 'node:test';

import {
  articleKey,
  keywordOptions,
  matchesKeyword,
} from '../src/news-scrapper/utils/intelligence.js';
import {
  decodeHtmlEntities,
  normalizeArticle,
  structuredSummary,
} from '../src/news-scrapper/utils/normalize.js';
import { staticKoreanTranslation } from '../src/news-scrapper/translation/koreanDictionary.js';

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

test('personalization and follow-up metadata survive article normalization', () => {
  const normalized = normalizeArticle({
    title: 'Optimus receives a mission update',
    link: 'https://example.test/optimus-update',
    personal_rank_score: 91.25,
    personalization: {
      applied: true,
      follow_up: true,
      follow_label: 'Update to a story you saved',
      matched_saved_title: 'Tesla sends Optimus to Mars',
    },
  });

  assert.equal(normalized.personal_rank_score, 91.25);
  assert.equal(normalized.personalization.follow_up, true);
  assert.equal(normalized.personalization.follow_label, 'Update to a story you saved');
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

test('HTML entity decoding works without browser DOM globals', () => {
  assert.equal(
    decodeHtmlEntities('&quot;AI &amp; TV&quot; &#8212; &#x1F4FA; &unknown;'),
    '"AI & TV" — 📺 &unknown;',
  );
  assert.equal(decodeHtmlEntities('Invalid: &#x110000; and &#55296;'), 'Invalid: &#x110000; and &#55296;');
});

test('article normalization decodes visible text but preserves URL bytes', () => {
  const article = normalizeArticle({
    id: 'entity-contract',
    title: 'Samsung &amp; LG &#8212; display &#x1F4FA;',
    summary_lead: '&quot;AI TV&quot; is ready &amp; shipping.',
    summary_points: [
      'Costs are &lt; last year&#39;s launch.',
      'Partners said &ldquo;yes&rdquo; &mdash; globally.',
    ],
    master_summary: 'Samsung &amp; LG shared an update.',
    source: 'Research &amp; Markets',
    sources: [{
      name: 'News &amp; Analysis',
      title: 'A &lt; B',
      url: 'https://example.test/story?q=tv&amp;lang=en',
    }],
    author: 'R&amp;D Desk',
    keywords_found: ['AI &amp; ML', 'TV &#x2B; Audio'],
    region: 'Asia &amp; Pacific',
    category: 'TV &amp; Display',
    article_intent: 'Launch &amp; availability',
    why_it_matters: 'Demand is rising &mdash; quickly.',
    selected_by: 'Research &amp; Strategy',
    matched_terms: ['AI &amp; ML'],
    personalization: {
      follow_up: true,
      follow_label: 'Update to &quot;your&quot; story',
      matched_saved_title: 'Earlier TV &amp; AI launch',
    },
    link: 'https://example.test/story?a=1&amp;b=2',
    canonical_link: 'https://example.test/story?a=1&amp;b=2',
    image_url: 'https://cdn.example.test/image?a=1&amp;b=2',
  });

  assert.equal(article.title, 'Samsung & LG — display 📺');
  assert.equal(article.summary_lead, '"AI TV" is ready & shipping.');
  assert.deepEqual(article.summary_points, [
    "Costs are < last year's launch.",
    'Partners said “yes” — globally.',
  ]);
  assert.equal(article.master_summary, 'Samsung & LG shared an update.');
  assert.equal(article.src, 'Research & Markets');
  assert.equal(article.sources[0].name, 'News & Analysis');
  assert.equal(article.sources[0].title, 'A < B');
  assert.deepEqual(article.keywords_found, ['AI & ML', 'TV + Audio']);
  assert.equal(article.region, 'Asia & Pacific');
  assert.equal(article.category, 'TV & Display');
  assert.equal(article.article_intent, 'Launch & availability');
  assert.equal(article.why_matters, 'Demand is rising — quickly.');
  assert.equal(article.selected_by, 'Research & Strategy');
  assert.deepEqual(article.matched_terms, ['AI & ML']);
  assert.equal(article.personalization.follow_label, 'Update to "your" story');
  assert.equal(article.personalization.matched_saved_title, 'Earlier TV & AI launch');

  assert.equal(article.url, 'https://example.test/story?a=1&amp;b=2');
  assert.equal(article.link, 'https://example.test/story?a=1&amp;b=2');
  assert.equal(article.canonical_link, 'https://example.test/story?a=1&amp;b=2');
  assert.equal(article.image_url, 'https://cdn.example.test/image?a=1&amp;b=2');
  assert.equal(article.sources[0].url, 'https://example.test/story?q=tv&amp;lang=en');
});

test('briefing keyword filters count articles and match without case sensitivity', () => {
  const articles = [
    { title: 'One', keywords: ['AI', 'Television', 'AI'] },
    { title: 'Two', keywords: ['ai', 'Display'] },
    { title: 'Three', keywords_found: ['Broadcast'] },
  ];

  assert.deepEqual(keywordOptions(articles), [
    { value: 'AI', count: 2 },
    { value: 'Broadcast', count: 1 },
    { value: 'Display', count: 1 },
    { value: 'Television', count: 1 },
  ]);
  assert.equal(matchesKeyword(articles[0], 'ai'), true);
  assert.equal(matchesKeyword(articles[1], 'Television'), false);
  assert.equal(matchesKeyword(articles[2], 'all'), true);
});

test('critical navigation and dossier controls have immediate Korean labels', () => {
  assert.equal(staticKoreanTranslation('Scan'), '스캔');
  assert.equal(staticKoreanTranslation('Open Dossier'), '상세 브리핑 열기');
  assert.equal(staticKoreanTranslation('AI Summary'), 'AI 요약');
  assert.equal(staticKoreanTranslation('Why This Matters'), '중요한 이유');
  assert.equal(staticKoreanTranslation('Intelligence Dossier'), '정보 분석 보고서');
  assert.equal(staticKoreanTranslation('LED'), 'LED');
});
