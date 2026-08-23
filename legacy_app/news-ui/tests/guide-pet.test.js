import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guide = read('../src/shared/guide/GuidePet.jsx');
const context = read('../src/shared/guide/GuidePetContext.jsx');
const guideCss = read('../src/shared/guide/guide-pet.css');
const topBar = read('../src/news-scrapper/components/TopBar.jsx');
const venture = read('../src/venture-lens/VentureLensApp.jsx');
const app = read('../src/news-scrapper/App.jsx');
const forYou = read('../src/news-scrapper/for-you/ForYouScreen.jsx');

test('the optional guide is default-off and persists only an explicit choice', () => {
  assert.match(context, /sense-guide-pet-enabled-v1/);
  assert.match(context, /getItem\(GUIDE_ENABLED_KEY\) === "true"/);
  assert.match(context, /localStorage\.setItem\(GUIDE_ENABLED_KEY, String\(next\)\)/);
});

test('the guide is portal-mounted, dismissible by Escape, and respects reduced motion', () => {
  assert.match(guide, /createPortal\(guide, document\.body\)/);
  assert.match(guide, /event\.key === "Escape"/);
  assert.match(guide, /typeof ResizeObserver !== "undefined"/);
  assert.match(guide, /typeof IntersectionObserver === "undefined"/);
  assert.match(guide, /prefers-reduced-motion: reduce/);
  assert.match(guideCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('Scout tracks page targets on the animation frame without scroll-driven React renders', () => {
  assert.match(guide, /window\.requestAnimationFrame\(measureTarget\)/);
  assert.match(guide, /window\.cancelAnimationFrame\(targetFrameRef\.current\)/);
  assert.match(guide, /entranceMeasureTimer = window\.setTimeout\(scheduleTargetMeasure, 1060\)/);
  assert.match(guide, /window\.addEventListener\("scroll", handleScroll, \{ passive: true \}\)/);
  assert.match(guide, /Date\.now\(\) < manualStepLockRef\.current/);
  assert.match(guide, /highlight\.style\.transform = `translate3d/);
  assert.doesNotMatch(guide, /setTargetRect/);
});

test('Scout uses calm compositor-friendly motion instead of repainting a full-screen path', () => {
  assert.match(guideCss, /--guide-motion: cubic-bezier/);
  assert.match(guideCss, /\.sense-guide-pet[\s\S]*?will-change: transform/);
  assert.match(guideCss, /\.sense-guide-highlight[\s\S]*?translate3d/);
  assert.match(guideCss, /\.sense-guide-root\[data-tracking="true"\]/);
  assert.match(guideCss, /@keyframes sense-guide-portal-ring/);
  assert.match(guideCss, /\.sense-guide-root[\s\S]*?transition: none !important/);
  assert.match(guideCss, /\.sense-guide-hole[\s\S]*?transition: none !important/);
  assert.match(guideCss, /\.sense-guide-bubble[\s\S]*?transition: none !important/);
  assert.doesNotMatch(guideCss, /sense-guide-dash/);
});

test('For You remains the landing contract during a transient capability failure', () => {
  assert.match(app, /default_landing:\s*true,[\s\S]*?profile_mode:\s*"unified"/);
  assert.match(app, /legacy_profile_routing:\s*false/);
  assert.match(app, /<Navigate to=\{defaultLanding\} replace/);
  assert.ok(
    forYou.indexOf('if (error && !feed)') < forYou.indexOf('if (status && !status.enabled)'),
    'a service outage must render the retryable error, not a misleading disabled-feature message',
  );
});

test('route-aware guide tours target current NewsScrapper and Venture Lens workspaces', () => {
  assert.match(guide, /"\/for-you"/);
  assert.match(guide, /\.scan-query-deck/);
  assert.match(guide, /\.archive-v2-results/);
  assert.match(guide, /"\/venturelens\/compare": "Compare"/);
  assert.match(guide, /\.vl-compare-workbench/);
  assert.match(guide, /\.vl-brief-grid/);
});

test('NewsScrapper Settings exposes accessible guide controls and opens For You', () => {
  assert.match(topBar, /useGuidePet\(\)/);
  assert.match(topBar, /role="switch"/);
  assert.match(topBar, /aria-checked=\{guideEnabled\}/);
  assert.match(topBar, /requestGuide\(\)/);
  assert.match(topBar, /navigate\("\/for-you"\)/);
});

test('Venture Lens stays inside the shared shell where Settings exposes the guide', () => {
  assert.match(venture, /aria-label="Research workspaces"/);
  assert.match(venture, /navigate\("\/research"\)/);
  assert.match(topBar, /requestGuide\(\)/);
  assert.match(topBar, /navigate\("\/for-you"\)/);
});

test('Scout remains original code-native artwork and never captures the full page', () => {
  assert.match(guide, /<svg className=\{talking/);
  assert.doesNotMatch(guide, /<img|https?:\/\//);
  assert.match(guideCss, /\.sense-guide-root[\s\S]*?pointer-events: none/);
  assert.match(guideCss, /\.sense-guide-pet[\s\S]*?pointer-events: auto/);
});
