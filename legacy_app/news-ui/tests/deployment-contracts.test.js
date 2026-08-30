import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const apiSource = readFileSync(
  new URL('../src/news-scrapper/api.js', import.meta.url),
  'utf8',
);
const viteSource = readFileSync(
  new URL('../vite.config.js', import.meta.url),
  'utf8',
);
const savedSource = readFileSync(
  new URL('../src/news-scrapper/screens/SavedScreen.jsx', import.meta.url),
  'utf8',
);
const sharedApiSource = readFileSync(
  new URL('../src/shared/api/client.js', import.meta.url),
  'utf8',
);
const vocSource = readFileSync(
  new URL('../src/components/VocFeedback.jsx', import.meta.url),
  'utf8',
);

test('viewer APIs are same-origin in both Vite and the portable build', () => {
  assert.match(apiSource, /const BASE = '';/);
  assert.doesNotMatch(apiSource, /VITE_API_BASE/);
  assert.doesNotMatch(apiSource, /https?:\/\/127\.0\.0\.1:8000/);
  assert.match(viteSource, /'\/viewer'/);
  assert.match(viteSource, /'\/access-control'/);
  assert.match(viteSource, /'\/scheduler'/);
  assert.match(viteSource, /\['\/voc', '\/scheduler'\]\.includes\(p\)/);
  assert.match(viteSource, /acceptsHtml/);
  assert.match(viteSource, /return '\/index\.html'/);
  assert.match(sharedApiSource, /const API_BASE = "";/);
  assert.doesNotMatch(sharedApiSource, /VITE_API_BASE/);
  assert.doesNotMatch(vocSource, /VITE_API_BASE_URL/);
  assert.doesNotMatch(vocSource, /https?:\/\/127\.0\.0\.1:8000/);
});

test('private briefing polling cannot lose a submit or retry refresh', () => {
  assert.match(savedSource, /const refreshPending = useRef\(false\)/);
  assert.match(savedSource, /refreshPending\.current = true/);
  assert.match(savedSource, /while \(refreshPending\.current && mounted\.current\)/);
  assert.match(savedSource, /setInterval\(\(\) => loadAll\(\{ quiet: true \}\), 1800\)/);
});

test('dispatch failures remain visible and recoverable in Your Desk', () => {
  assert.match(savedSource, /response\?\.dispatch_failures/);
  assert.match(savedSource, /use Retry when the service is ready/);
  assert.match(savedSource, /job\.status === 'failed'/);
});
