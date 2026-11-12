import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { addLocalDays, localDateString } from '../src/news-scrapper/utils/localDate.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function hexRgb(value) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  assert.ok(match, `Expected a six-digit colour, received ${value}`);
  return match.slice(1).map((part) => Number.parseInt(part, 16) / 255);
}

function luminance(value) {
  const [red, green, blue] = hexRgb(value).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function variable(block, name) {
  return block.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
}

test('archive date helpers preserve the viewer local calendar across month boundaries', () => {
  assert.equal(localDateString(new Date(2026, 0, 31, 23, 59)), '2026-01-31');
  assert.equal(addLocalDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addLocalDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addLocalDays('2026-01-01', -1), '2025-12-31');

  const history = read('../src/news-scrapper/screens/HistoryScreen.jsx');
  assert.match(history, /T12:00:00/);
  assert.doesNotMatch(history, /toISOString\(\)\.slice\(0, 10\)/);
});

test('all editorial hero carousels restart a complete timeout after navigation', () => {
  const briefing = read('../src/news-scrapper/screens/FeedScreen.jsx');
  const research = read('../src/news-scrapper/screens/ResearchScreen.jsx');
  const samsung = read('../src/news-scrapper/screens/SamsungInternalScreen.jsx');

  assert.match(briefing, /setTimeout[\s\S]*autoplayDelay\(8000, reducedMotion\)[\s\S]*\[documentVisible, idx, manualPaused, reducedMotion, slides\.length\]/);
  assert.match(research, /setTimeout[\s\S]*autoplayDelay\(9000, reducedMotion\)[\s\S]*\[artifacts\.length, documentVisible, index, manualPaused, reducedMotion\]/);
  assert.match(samsung, /setTimeout[\s\S]*autoplayDelay\(8000, reducedMotion\)[\s\S]*\[documentVisible, index, manualPaused, reducedMotion, slides\.length\]/);
});

test('route state stays addressable and stale asynchronous work cannot win', () => {
  const scan = read('../src/news-scrapper/screens/ScanScreen.jsx');
  const samsung = read('../src/news-scrapper/screens/SamsungInternalScreen.jsx');
  const venture = read('../src/venture-lens/VentureLensApp.jsx');

  assert.match(scan, /const initialQ = params\.get\('q'\) \|\| ''/);
  assert.match(scan, /Page \{page\} of \{pageCount\} loaded/);
  assert.match(samsung, /\?channel=\$\{channel === 'internal' \? 'inside' : channel\}/);
  assert.match(samsung, /\?from=inside/);
  assert.match(venture, /new AbortController\(\)/);
  assert.match(venture, /dossierRequestRef\.current\.token !== token/);
  assert.match(venture, /focusedArtifactRef\.current = key/);
});

test('tab workspaces expose a complete keyboard and panel relationship', () => {
  const outer = read('../src/news-scrapper/for-you/ForYouWorkspaceScreen.jsx');
  const create = read('../src/news-scrapper/for-you/CreateScreen.jsx');

  for (const source of [outer, create]) {
    assert.match(source, /role="tablist"/);
    assert.match(source, /role="tab"/);
    assert.match(source, /role="tabpanel"/);
    assert.match(source, /aria-controls=/);
    assert.match(source, /aria-labelledby=/);
    assert.match(source, /ArrowLeft/);
    assert.match(source, /ArrowRight/);
    assert.match(source, /Home/);
    assert.match(source, /End/);
  }
});

test('leaf routes do not create a second main landmark', () => {
  const leafRoutes = [
    '../src/news-scrapper/screens/HistoryScreen.jsx',
    '../src/news-scrapper/screens/SamsungInternalReaderScreen.jsx',
    '../src/venture-lens/VentureLensApp.jsx',
  ];
  leafRoutes.forEach((path) => assert.doesNotMatch(read(path), /<main(?:\s|>)/));
});

test('modal isolation, cache refresh, and theme boot contracts are explicit', () => {
  const focus = read('../src/news-scrapper/components/modals/useModalFocus.js');
  const api = read('../src/news-scrapper/api.js');
  const index = read('../index.html');

  assert.match(focus, /node\.setAttribute\('inert', ''\)/);
  assert.match(focus, /node\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(focus, /if \(!hadInert\) node\.removeAttribute\('inert'\)/);
  assert.match(api, /return abortableSharedPromise\(refresh\(\)\.catch\(\(\) => cached\.data\), signal\)/);
  assert.ok(index.indexOf('news-theme') < index.indexOf('import("/src/main.jsx")'));
  assert.match(index, /document\.documentElement\.style\.colorScheme = theme/);
});

test('muted theme tokens retain readable text contrast on their base surfaces', () => {
  const css = read('../src/news-scrapper/theme-toggle.css');
  const dark = css.match(/:root,\s*html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] || '';
  const light = css.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1] || '';

  for (const block of [dark, light]) {
    const page = variable(block, 'page');
    assert.ok(contrast(variable(block, 'text-muted'), page) >= 4.5);
    assert.ok(contrast(variable(block, 'text-faint'), page) >= 4.5);
  }
});
