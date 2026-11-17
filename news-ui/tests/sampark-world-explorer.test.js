import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORLD_MARKETS, WORLD_REGIONS, WORLD_DESKS,
  buildWorldCoverage, worldArticleLocation,
} from '../src/sampark/world-explorer/worldExplorerModel.js';
import {
  worldExplorerPreferenceKey,
  readWorldExplorerPreference,
  saveWorldExplorerPreference,
} from '../src/sampark/world-explorer/worldExplorerPreference.js';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('world explorer ships the complete configured regional market and business directory', () => {
  assert.equal(WORLD_REGIONS.length, 6);
  assert.equal(WORLD_MARKETS.length, 38);
  assert.equal(new Set(WORLD_MARKETS.map((market) => market.code)).size, WORLD_MARKETS.length);
  assert.equal(WORLD_DESKS.length, 4);
  assert.ok(WORLD_MARKETS.some((market) => market.code === 'DE'));
  assert.ok(WORLD_MARKETS.some((market) => market.code === 'KR'));
  assert.ok(!WORLD_MARKETS.some((market) => market.code === 'IN'), 'India remains in Local channel');
});

test('world explorer classifies country, bilingual, regional and business sources independently', () => {
  const articles = [
    { id: 1, source: 'Samsung Newsroom Korea', title: 'Korea news' },
    { id: 2, source: 'Samsung Newsroom Germany', title: 'Germany news' },
    { id: 3, source: 'Samsung Newsroom Canada (French)', title: 'Canada fr news' },
    { id: 4, source: 'Samsung Newsroom Canada', title: 'Canada en news' },
    { id: 5, source: 'Samsung Semiconductor Newsroom', title: 'Chip news' },
    { id: 6, source: 'Samsung Newsroom Middle East & North Africa', title: 'MENA' },
    { id: 7, source: 'Samsung Newsroom', title: 'Corporate' },
    { id: 8, source: 'SamMobile', title: 'Third party' },
  ];
  const data = buildWorldCoverage(articles);
  assert.deepEqual(data.byCountry.KR.map((article) => article.id), [1]);
  assert.deepEqual(data.byCountry.DE.map((article) => article.id), [2]);
  assert.deepEqual(data.byCountry.CA.map((article) => article.id), [3, 4]);
  assert.deepEqual(data.byBusiness['Samsung Semiconductor Newsroom'].map((article) => article.id), [5]);
  assert.deepEqual(data.byRegional['Samsung Newsroom Middle East & North Africa'].map((article) => article.id), [6]);
  assert.deepEqual(data.worldwide.map((article) => article.id), [7, 8]);
  assert.equal(data.regions.find((region) => region.id === 'middle-east').articleCount, 1);
  assert.equal(data.regions.find((region) => region.id === 'europe').articleCount, 1);
  assert.equal(data.regions.find((region) => region.id === 'north-america').articleCount, 2);
  assert.equal(data.all.length, articles.length);
});

test('world explorer understands article source lists and explicit newsroom metadata', () => {
  assert.deepEqual(
    worldArticleLocation({ sources: [{ name: 'Samsung Newsroom Japan' }], source: 'Samsung' }),
    { kind: 'country', id: 'JP' },
  );
  assert.deepEqual(
    worldArticleLocation({ source: 'Unlabeled newsroom', newsroom_country: 'FR' }),
    { kind: 'country', id: 'FR' },
  );
  assert.deepEqual(worldArticleLocation({ source: 'Unknown outlet' }), { kind: 'worldwide', id: 'worldwide' });
  const empty = buildWorldCoverage([]);
  assert.equal(empty.all.length, 0);
  assert.equal(empty.regions.length, WORLD_REGIONS.length);
  assert.ok(empty.regions.every((region) => region.articleCount === 0));
});

test('World Explorer is off by default and scoped to each viewer on this browser', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
  const alice = { principal: 'alice-test-identity' };
  const bob = { principal: 'bob-test-identity' };
  assert.notEqual(worldExplorerPreferenceKey(alice), worldExplorerPreferenceKey(bob));
  assert.equal(readWorldExplorerPreference(alice, storage), false);
  assert.equal(saveWorldExplorerPreference(alice, true, storage), true);
  assert.equal(readWorldExplorerPreference(alice, storage), true);
  assert.equal(readWorldExplorerPreference(bob, storage), false);
  assert.equal(saveWorldExplorerPreference(alice, false, storage), true);
  assert.equal(readWorldExplorerPreference(alice, storage), false);
  assert.equal(readWorldExplorerPreference(alice, { getItem() { throw new Error('blocked'); } }), false);
});

test('Sampark view toggle is only applied on Samsung Global and uses the existing dossier', () => {
  const settings = read('../src/sampark/SamparkSettingsModal.jsx');
  const app = read('../src/sampark/SamparkApp.jsx');
  const samsung = read('../src/sampark/samsung-news/SamsungNewsPage.jsx');
  const wrapper = read('../src/sampark/SamparkSamsungNews.jsx');
  const explorer = read('../src/sampark/world-explorer/SamparkWorldExplorer.jsx');
  assert.match(settings, /worldExplorerEnabled:\s*false/);
  assert.match(settings, /World Explorer for Samsung Global/);
  assert.match(settings, /saveWorldExplorerPreference/);
  assert.match(app, /readWorldExplorerPreference/);
  assert.match(app, /worldExplorerEnabled=\{Boolean\(settings\.worldExplorerEnabled\)\}/);
  assert.match(wrapper, /samsung-news\/SamsungNewsPage\.jsx/);
  assert.match(samsung, /activeChannel === 'global' && worldExplorerEnabled/);
  assert.match(samsung, /<SamparkWorldExplorer articles=\{model\.global\?\.items \|\| \[\]\} onOpen=\{setOpenArticle\}/);
  assert.match(samsung, /SamsungDossier item=\{openArticle\}/);
  assert.match(samsung, /SamsungChannelContent channel=\{selectedChannel\}/);
  assert.match(explorer, /Briefing Stream/);
  assert.match(explorer, /World Explorer/);
});
