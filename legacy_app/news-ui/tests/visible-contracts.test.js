import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  articleKey,
  briefingLensOptions,
  groupedByDatePreservingOrder,
  keywordOptions,
  matchesBriefingLens,
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

test('briefing lenses map the unified morning and broadcast keyword packs', () => {
  const articles = [
    { title: 'Model launch', keywords_found: ['Artificial Intelligence'] },
    { title: 'Display launch', keywords_found: ['OLED', 'Samsung'] },
    { title: 'Accelerator launch', keywords_found: ['GPU', 'Nvidia'] },
    { title: 'Factory launch', keywords_found: ['Robot'] },
    { title: 'Platform launch', keywords_found: ['DTH', 'OTT'] },
  ];

  assert.equal(matchesBriefingLens(articles[0], 'ai'), true);
  assert.equal(matchesBriefingLens(articles[1], 'devices'), true);
  assert.equal(matchesBriefingLens(articles[2], 'compute'), true);
  assert.equal(matchesBriefingLens(articles[3], 'robotics'), true);
  assert.equal(matchesBriefingLens(articles[4], 'media'), true);
  assert.equal(matchesBriefingLens(articles[0], 'media'), false);
  assert.deepEqual(briefingLensOptions(articles).map(({ id, count }) => ({ id, count })), [
    { id: 'ai', count: 1 },
    { id: 'devices', count: 1 },
    { id: 'compute', count: 1 },
    { id: 'robotics', count: 1 },
    { id: 'media', count: 1 },
  ]);
});

test('briefing nests five mapped lenses with the carousel and applies them to every surface', () => {
  const feedSource = readFileSync(new URL('../src/news-scrapper/screens/FeedScreen.jsx', import.meta.url), 'utf8');
  const heroPosition = feedSource.lastIndexOf('<TopClusterCarousel');
  const lensPosition = feedSource.lastIndexOf('<BriefingLensRail');
  const streamPosition = feedSource.lastIndexOf('<BriefingStream');
  const latestPosition = feedSource.lastIndexOf('<LatestDaySignals');
  const searchPosition = feedSource.lastIndexOf('<SearchLoadedBriefing');

  assert.ok(heroPosition < lensPosition);
  assert.ok(lensPosition < streamPosition);
  assert.ok(streamPosition < latestPosition);
  assert.ok(latestPosition < searchPosition);
  assert.match(feedSource, /<div className="briefing-hero-stack">[\s\S]*<TopClusterCarousel[\s\S]*<BriefingLensRail/);
  assert.match(feedSource, /<BriefingStream articles=\{lensArticles\}/);
  assert.match(feedSource, /<LatestDaySignals articles=\{lensArticles\}/);
  assert.match(feedSource, /applyFilters\(lensArticles, filters, selectedIds\)/);
  assert.match(feedSource, /setFilters\(emptyFilters\)/);
  assert.doesNotMatch(feedSource, /<BriefingKeywordRibbon/);
  assert.doesNotMatch(feedSource, /briefing-keyword-filter/);
});

test('the unified Briefing keeps scope metadata but presents only the four useful archive filters', () => {
  const feedSource = readFileSync(new URL('../src/news-scrapper/screens/FeedScreen.jsx', import.meta.url), 'utf8');
  assert.match(feedSource, /scope:\s*'all'/);
  assert.match(feedSource, /articleScopes\(item\)\.has\(filters\.scope\)/);
  assert.match(feedSource, /All Regions/);
  assert.match(feedSource, /All Categories/);
  assert.match(feedSource, /All Sources/);
  assert.match(feedSource, /All Dates/);
  assert.doesNotMatch(feedSource, /All Intelligence|Broadcast &amp; Media/);
});

test('critical navigation and dossier controls have immediate Korean labels', () => {
  assert.equal(staticKoreanTranslation('Scan'), '스캔');
  assert.equal(staticKoreanTranslation('Open Dossier'), '상세 브리핑 열기');
  assert.equal(staticKoreanTranslation('AI Summary'), 'AI 요약');
  assert.equal(staticKoreanTranslation('Why This Matters'), '중요한 이유');
  assert.equal(staticKoreanTranslation('Intelligence Dossier'), '정보 분석 보고서');
  assert.equal(staticKoreanTranslation('LED'), 'LED');
  assert.equal(staticKoreanTranslation('For You'), '맞춤 추천');
});

test('For You grouping preserves backend recommendation order across dates', () => {
  const ranked = [
    { title: 'Highest rank, older date', date: '2026-08-13' },
    { title: 'Second rank, newest date', date: '2026-08-15' },
    { title: 'Third rank, middle date', date: '2026-08-14' },
  ];
  const groups = groupedByDatePreservingOrder(ranked);
  assert.deepEqual(Object.values(groups).flatMap((items) => items.map((item) => item.title)), ranked.map((item) => item.title));
});

test('hook and recommendation explanation survive frontend normalization', () => {
  const normalized = normalizeArticle({
    title: 'Grounded signal',
    link: 'https://example.test/grounded',
    attention_hook: 'A grounded context sentence remains visible without replacing the original source headline or introducing unsupported urgency into the intelligence card.',
    what_changed: 'A concrete product update was announced.',
    why_now: 'The release window begins this quarter.',
    watch_next: 'Watch for verified regional availability.',
    hook_type: 'change',
    hook_source: 'samsung_chat',
    hook_grounded: true,
    recommendation: { score: 0.84, reason_codes: ['explicit_topic'], reasons: ['Matches your AI preference'] },
  });
  assert.equal(normalized.hook_grounded, true);
  assert.equal(normalized.watch_next, 'Watch for verified regional availability.');
  assert.deepEqual(normalized.recommendation.reason_codes, ['explicit_topic']);
});

test('reaction counts and semantic follow metadata survive frontend normalization', () => {
  const normalized = normalizeArticle({
    article_id: 'stable-article-id',
    title: 'A followed update',
    link: 'https://example.test/followed',
    reactions: { like_count: 12, dislike_count: 3, viewer_reaction: 'like' },
    follow_match: { score: 0.82, method: 'semantic' },
  });
  assert.deepEqual(normalized.reactions, { like_count: 12, dislike_count: 3, viewer_reaction: 'like' });
  assert.equal(normalized.article_id, 'stable-article-id');
  assert.deepEqual(normalized.follow_match, { score: 0.82, method: 'semantic' });
});

test('For You cards are direct-open, followable and reaction-counted without workflow selection', () => {
  const cardSource = readFileSync(new URL('../src/news-scrapper/for-you/ForYouCard.jsx', import.meta.url), 'utf8');
  const screenSource = readFileSync(new URL('../src/news-scrapper/for-you/ForYouScreen.jsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../src/news-scrapper/for-you/for-you.css', import.meta.url), 'utf8');
  assert.match(cardSource, /fy-card-open-layer/);
  assert.match(cardSource, /Unfollow this story' : 'Follow this story privately'/);
  assert.match(cardSource, /const savedKnown = savedStatus === 'ready'/);
  assert.match(cardSource, /<span>\{savedLabel\}<\/span>/);
  assert.match(cardSource, /Following status unavailable · use Retry above/);
  assert.match(cardSource, /disabled=\{Boolean\(busyAction\) \|\| !savedKnown\}/);
  assert.match(cardSource, /data-tooltip="Hide this article only from your private feed"/);
  assert.match(cardSource, /reactions\.like_count/);
  assert.match(cardSource, /reactions\.dislike_count/);
  assert.match(cardSource, /<Bouncer[\s\S]*reactions=\{reactions\}/);
  assert.doesNotMatch(cardSource, /Select for Review|RecommendationReason|Why this story/);
  assert.doesNotMatch(screenSource, /selectWorkflow|trainVote/);
  assert.match(cssSource, /\.fy-executive-grid\{[\s\S]*grid-template-columns:minmax\(0,1\.6fr\)/);
  assert.match(cssSource, /\.is-executive-hero\{grid-row:1\/3\}/);
  assert.match(cssSource, /\.fy-card-body\{z-index:auto\}/);
});

test('Briefing reactions share the private counted endpoint and global removal is an IP-gated kill switch', () => {
  const feedSource = readFileSync(new URL('../src/news-scrapper/screens/FeedScreen.jsx', import.meta.url), 'utf8');
  const bouncerSource = readFileSync(new URL('../src/news-scrapper/components/Bouncer.jsx', import.meta.url), 'utf8');
  const voteFlow = feedSource.match(/const onVote = async[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(voteFlow, /setViewerReaction/);
  assert.doesNotMatch(voteFlow, /rejectArticle|setArticles|trainVote/);
  assert.match(feedSource, /capabilitySet\.has\('gatekeeper\.review'\)/);
  assert.match(feedSource, /canKill && <button className="article-kill-switch/);
  assert.match(feedSource, /const killArticle = async[\s\S]*rejectArticle/);
  assert.match(bouncerSource, /Like this story/);
  assert.match(bouncerSource, /Dislike this story/);
  assert.match(bouncerSource, /likes > 0/);
  assert.match(bouncerSource, /dislikes > 0/);
  assert.match(feedSource, /setInterval\(sync, 12_000\)/);
  assert.match(feedSource, /clearInterval\(timer\)/);
  assert.match(feedSource, /\? 'stale' : 'error'/);
  assert.match(feedSource, /Counts are hidden rather than shown as zero/);
  assert.doesNotMatch(feedSource, /like_count: 0, dislike_count: 0, viewer_reaction: 'neutral'/);
  assert.match(bouncerSource, /Reaction totals unavailable/);
});

test('capability transport failures remain distinct from a real access denial', () => {
  const appSource = readFileSync(new URL('../src/news-scrapper/App.jsx', import.meta.url), 'utf8');
  assert.match(appSource, /status: 'error'/);
  assert.match(appSource, /Access could not be verified\./);
  assert.match(appSource, /TechScout has not treated this as an access denial\./);
  assert.match(appSource, /capabilityLoadAttempt/);
  assert.match(appSource, /Try again/);
});

test('a chunk or bootstrap failure renders a static reload path', () => {
  const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const entrySource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(indexSource, /function showApplicationLoadFailure/);
  assert.match(indexSource, /TechScout could not start\./);
  assert.match(indexSource, /Reload TechScout/);
  assert.match(indexSource, /import\("\/src\/main\.jsx"\)\.catch\(showApplicationLoadFailure\)/);
  assert.match(entrySource, /launch\(\)\.catch/);
  assert.match(entrySource, /__senseReportBootstrapFailure/);
});

test('reaction and following APIs stay same-origin and reactions do not append stale events', () => {
  const apiSource = readFileSync(new URL('../src/news-scrapper/api.js', import.meta.url), 'utf8');
  const screenSource = readFileSync(new URL('../src/news-scrapper/for-you/ForYouScreen.jsx', import.meta.url), 'utf8');
  assert.match(apiSource, /jsonFetch\('\/viewer\/reactions'/);
  assert.match(apiSource, /jsonFetch\('\/viewer\/reactions\/query'/);
  assert.match(apiSource, /index \+= 200/);
  assert.match(apiSource, /jsonFetch\('\/viewer\/following'\)/);
  const reactionFlow = screenSource.match(/const react = async[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(reactionFlow, /setViewerReaction/);
  assert.doesNotMatch(reactionFlow, /record\(/);
});

test('For You data uses the viewer API without colliding with the SPA deep link', () => {
  const apiSource = readFileSync(new URL('../src/news-scrapper/api.js', import.meta.url), 'utf8');
  assert.match(apiSource, /jsonFetch\(`\/viewer\/for-you\?\$\{params\.toString\(\)\}`\)/);
  assert.doesNotMatch(apiSource, /jsonFetch\(`\/for-you\?\$\{params\.toString\(\)\}`\)/);
});

test('stale profile overrides cannot leak into the unified production experience', () => {
  const apiSource = readFileSync(new URL('../src/news-scrapper/api.js', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/news-scrapper/App.jsx', import.meta.url), 'utf8');
  assert.match(apiSource, /import\.meta\.env\.DEV/);
  assert.match(apiSource, /VITE_ENABLE_PROFILE_SWITCHER/);
  assert.match(apiSource, /if \(!developerSwitcherEnabled\) return ''/);
  assert.match(appSource, /profile_mode:\s*"unified"/);
  assert.match(appSource, /setActiveProfile\("default"\)/);
  assert.match(appSource, /PROFILE_SWITCHER_ENABLED\s*&&\s*<Route path="\/trends"/);
});

test('global reject and restore use one recoverable backend operation', () => {
  const apiSource = readFileSync(new URL('../src/news-scrapper/api.js', import.meta.url), 'utf8');
  const rejectFlow = apiSource.match(/export async function rejectArticle[\s\S]*?\n}/)?.[0] || '';
  const restoreFlow = apiSource.match(/export async function unrejectArticle[\s\S]*?\n}/)?.[0] || '';
  assert.match(rejectFlow, /return markNotInterested\(article\)/);
  assert.doesNotMatch(rejectFlow, /removeFromBriefing|catch\s*\{\s*\}/);
  assert.match(restoreFlow, /return restoreNotInterested\(article\.title\)/);
  assert.doesNotMatch(restoreFlow, /restoreToBriefing|catch\s*\{\s*\}/);
  assert.match(apiSource, /body\.status === 'error'/);
});

test('large briefing archives render progressively instead of mounting every card', () => {
  const historySource = readFileSync(new URL('../src/news-scrapper/screens/HistoryScreen.jsx', import.meta.url), 'utf8');
  assert.match(historySource, /const ARCHIVE_PAGE_SIZE = 48/);
  assert.match(historySource, /filteredArticles\.slice\(0, renderLimit\)/);
  assert.match(historySource, /Show next/);
});

test('large archive ranges stay inside one shrinkable page track', () => {
  const archiveStyles = readFileSync(new URL('../src/news-scrapper/screens/history-redesign.css', import.meta.url), 'utf8');
  assert.match(archiveStyles, /\.archive-v2-page\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(archiveStyles, /\.archive-v2-page\s*>\s*\*\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(archiveStyles, /\.archive-v2-run-track\s*\{[\s\S]*?max-width:\s*100%/);
});

test('Korean translation is progressive, private, retryable, and always reversible', () => {
  const topBarSource = readFileSync(new URL('../src/news-scrapper/components/TopBar.jsx', import.meta.url), 'utf8');
  const translationSource = readFileSync(new URL('../src/news-scrapper/translation/usePageTranslation.js', import.meta.url), 'utf8');
  assert.match(topBarSource, /private on-device translation/i);
  assert.match(topBarSource, /role="alertdialog"/);
  assert.doesNotMatch(topBarSource, /translationLocked/);
  assert.match(topBarSource, /translation-failure-notice/);
  assert.match(topBarSource, /Return to English/);
  assert.match(topBarSource, /Retry translation/);
  assert.match(translationSource, /translating:\s*true/);
  assert.match(translationSource, /window\.sessionStorage/);
  assert.match(translationSource, /browserTranslationCapability/);
  assert.match(topBarSource, /translationState\?\.prepareBrowser\?\.\(\)/);
  assert.match(translationSource, /Call create\(\) synchronously inside the user's confirmation click/);
  assert.match(translationSource, /targets\.get\(source\)/);
  assert.match(translationSource, /warmupKoreanTranslation/);
});

test('the primary interface font is bundled instead of fetched at runtime', () => {
  const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const entrySource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const polishSource = readFileSync(new URL('../src/news-scrapper/ui-polish.css', import.meta.url), 'utf8');

  assert.doesNotMatch(indexSource, /fonts\.googleapis|fonts\.gstatic|api\.fontshare/);
  assert.match(entrySource, /@fontsource-variable\/geist\/wght\.css/);
  assert.match(polishSource, /font-family:\s*"Geist Variable"/);
});

test('Access Management offers a simple exact-IP full-access path and env recipe', () => {
  const accessSource = readFileSync(new URL('../src/news-scrapper/screens/AccessManagementScreen.jsx', import.meta.url), 'utf8');
  assert.match(accessSource, /FULL_ACCESS_ALLOWED_IPS=192\.0\.2\.25/);
  assert.match(accessSource, /Add an IP address/);
  assert.match(accessSource, /Full access is selected by default/);
  assert.match(accessSource, /grant_by_ip/);
  assert.match(accessSource, /Choose specific access instead/);
  assert.doesNotMatch(accessSource, /Viewer identity token/);
});
