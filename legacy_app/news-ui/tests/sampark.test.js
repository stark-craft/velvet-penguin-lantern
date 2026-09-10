import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { filterFeedItems } from '../src/news-scrapper/for-you/filterFeedItems.js';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Sampark uses an independent entry without importing it into the original', () => {
  assert.match(read('../vite.config.js'), /sampark\/index\.html/);
  assert.match(read('../src/sampark/main.jsx'), /basename="\/sampark"/);
  assert.doesNotMatch(read('../src/main.jsx'), /sampark/);
  assert.doesNotMatch(read('../src/sampark/main.jsx'), /localStorage\.setItem/);
  assert.match(read('../sampark/index.html'), /data-theme="light"/);
});

test('Sampark reuses the authoritative feed and gates authoring on verified IP access', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /getAccessCapabilities\(\)/);
  assert.match(app, /has\('contributions\.create'\)/);
  assert.match(app, /<ForYouScreen/);
  assert.match(app, /href="\/research"/);
  assert.match(app, /translationState\?\.prepareBrowser/);
  assert.match(app, /className="techscout-header"/);
  assert.match(app, /<SettingsModal/);
  assert.match(app, /<UserProfileModal/);
  assert.match(app, /presentation="sampark"/);
  assert.match(app, /<FeedScreen presentation="sampark"/);
  assert.match(app, /<FollowingScreen/);
  assert.doesNotMatch(app, /TopBar|theme-toggle|setTheme/);
  assert.doesNotMatch(app, /fetch\(|https?:\/\//);
});

test('Sampark follows the design-team light layout without the superseded portal header', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  const design = read('../src/sampark/design-team.css');
  const forYou = read('../src/sampark/SamparkForYouView.jsx');
  assert.match(app, /techscout-header/);
  assert.match(app, /main-card-container/);
  assert.match(app, /main-tabs/);
  assert.doesNotMatch(app, /sampark-header|sampark-nav/);
  assert.match(design, /--primary:\s*#1428a0/);
  assert.match(forYou, /items\.slice\(0, 5\)/);
});

test('loaded-feed search preserves authoritative objects and supports source/category/Korean text', () => {
  const first = { article_id: 'one', title: 'Samsung display', source: 'Newsroom', reactions: { like_count: 3 } };
  const second = { article_id: 'two', title: '새로운 모델', category: 'Research' };
  const items = [first, second];
  assert.equal(filterFeedItems(items, '  '), items);
  assert.equal(filterFeedItems(items, 'SAMSUNG')[0], first);
  assert.equal(filterFeedItems(items, 'newsroom')[0].reactions.like_count, 3);
  assert.equal(filterFeedItems(items, 'research')[0], second);
  assert.equal(filterFeedItems(items, '모델')[0], second);
  assert.deepEqual(filterFeedItems(items, 'not-present'), []);
  assert.equal(items.length, 2);
});

test('Sampark global search uses a dedicated archive route and keeps archive access visible', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  const search = read('../src/sampark/ArchiveSearchScreen.jsx');
  assert.match(app, /path="\/search"/);
  assert.match(app, /Search all archived news/);
  assert.match(app, /Briefing Archives/);
  assert.doesNotMatch(app, /setSearch\(/);
  assert.match(search, /searchExtractedIntelligence/);
  assert.match(search, /sort: 'date_desc'/);
  assert.match(search, /controller.abort\(\)/);
  assert.match(search, /Object.entries\(groupedByDate\(items\)\)/);
});
