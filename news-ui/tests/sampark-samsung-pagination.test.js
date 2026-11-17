import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SAMSUNG_NEWS_PAGE_SIZE, SAMSUNG_NEWS_FETCH_BATCH, samsungPageCount,
  samsungPageItems,
} from '../src/sampark/samsung-news/samsungPagination.js';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Samsung Classic paginates all available items, not just the first 100', () => {
  const items = Array.from({ length: 238 }, (_, i) => ({ id: i + 1 }));
  assert.equal(SAMSUNG_NEWS_PAGE_SIZE, 20);
  assert.equal(SAMSUNG_NEWS_FETCH_BATCH, 100);
  assert.equal(samsungPageCount(items.length), 12);
  assert.deepEqual(samsungPageItems(items, 1).map(x => x.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(samsungPageItems(items, 6).map(x => x.id), Array.from({ length: 20 }, (_, i) => i + 101));
  assert.equal(samsungPageItems(items, 12).length, 18);
  assert.equal(samsungPageItems(items, 13).length, 0);
  assert.deepEqual(samsungPageItems([], 1), []);
  assert.equal(samsungPageCount(0), 0);
});

test('Only Samsung News uses the new paginated API and read-only archive endpoint', () => {
  const api = read('../src/news-scrapper/api.js');
  const page = read('../src/sampark/samsung-news/SamsungNewsPage.jsx');
  const channel = read('../src/sampark/samsung-news/SamsungChannelContent.jsx');
  const controls = read('../src/sampark/samsung-news/SamsungPageControls.jsx');
  const explorer = read('../src/sampark/world-explorer/SamparkWorldExplorer.jsx');
  assert.match(api, /getSamsungInternalFeedPage/);
  assert.match(api, /offset:/);
  assert.match(api, /internal-content\/samsung-feed/);
  assert.match(page, /getSamsungInternalFeedPage/);
  assert.match(page, /loadChannelPage/);
  assert.match(page, /Loading complete Global archive/);
  assert.match(page, /focus_match/);
  assert.match(page, /publishedRecordToSignal/);
  assert.match(channel, /samsungPageItems\(channel\.items, archivePage\)/);
  assert.match(channel, /LeadershipMessageHero/);
  assert.match(channel, /SriDDocumentCard/);
  assert.match(controls, /aria-label=\{label \+ ' pagination'\}/);
  assert.match(explorer, /samsungPageItems\(articles, currentPage\)/);
});
