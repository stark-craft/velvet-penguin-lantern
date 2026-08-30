import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CONTRIBUTION_LIMITS,
  canSubmitContribution,
  contentTypeLabel,
  coverMeetsResolution,
  createContribution,
  largestSixteenNineCrop,
  statusLabel,
  validateCoverDimensions,
  validateCoverFile,
} from '../src/news-scrapper/internal/contributionModel.js';
import {
  detectTitle,
  splitParagraphs,
  validateDocumentFile,
} from '../src/news-scrapper/internal/documentParser.js';

const savedSource = readFileSync(
  new URL('../src/news-scrapper/screens/SavedScreen.jsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/news-scrapper/App.jsx', import.meta.url),
  'utf8',
);
const apiSource = readFileSync(
  new URL('../src/news-scrapper/api.js', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../src/news-scrapper/components/personal-desk/ContributionWorkspace.jsx', import.meta.url),
  'utf8',
);
const parserSource = readFileSync(
  new URL('../src/news-scrapper/internal/documentParser.js', import.meta.url),
  'utf8',
);
const announcementSource = readFileSync(
  new URL('../src/news-scrapper/screens/InternalPublishingScreen.jsx', import.meta.url),
  'utf8',
);
const workspaceShellSource = readFileSync(
  new URL('../src/news-scrapper/for-you/ForYouWorkspaceScreen.jsx', import.meta.url),
  'utf8',
);
const createScreenSource = readFileSync(
  new URL('../src/news-scrapper/for-you/CreateScreen.jsx', import.meta.url),
  'utf8',
);
const indexSource = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8',
);

test('contribution records normalize into the documented shape with safe defaults', () => {
  const record = createContribution({
    title: '  Display roadmap  ',
    body: 'Line one.\n\nLine two.',
    cover: { pendingFile: {}, name: 'cover.jpg', type: 'image/jpeg', size: 900, width: 1600, height: 900, focalX: 7, focalY: -3 },
  });
  assert.equal(record.contentType, 'story');
  assert.equal(record.title, 'Display roadmap');
  assert.equal(record.category, '');
  assert.equal(record.cover.name, 'cover.jpg');
  assert.equal(record.cover.focalX, 1);
  assert.equal(record.cover.focalY, 0);
  assert.equal(record.sourceDocument, null);
  assert.equal(record.status, 'draft');
  assert.equal(typeof record.createdAt, 'string');
  const restored = createContribution({ ...record, id: 'contrib-x', updatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(restored.id, 'contrib-x');
  assert.equal(restored.updatedAt, '2026-01-01T00:00:00.000Z');
});

test('a stored server cover or a pending file satisfies the cover requirement', () => {
  const base = { title: 'A story', body: 'x'.repeat(40) };
  assert.equal(canSubmitContribution({ ...base, cover: { url: '/internal-content/x/cover' } }).ok, true);
  assert.equal(canSubmitContribution({ ...base, cover: { pendingFile: {} } }).ok, true);
  const tinyPending = canSubmitContribution({
    ...base,
    cover: { pendingFile: {}, width: 800, height: 800 },
  });
  assert.equal(tinyPending.ok, false);
});

test('unknown future statuses and content types still render through safe labels', () => {
  assert.equal(statusLabel('published'), 'Published');
  assert.equal(statusLabel('needs_changes'), 'Needs changes');
  assert.equal(statusLabel('mystery_state'), 'Mystery_state');
  assert.equal(contentTypeLabel('document_import'), 'Document import');
  assert.equal(contentTypeLabel('anything_new'), 'Story');
});

test('submission requires a title, usable body, and a valid cover image', () => {
  const base = { title: 'A story', body: 'x'.repeat(40), cover: { url: '/internal-content/x/cover' } };
  assert.equal(canSubmitContribution(base).ok, true);

  const noCover = canSubmitContribution({ ...base, cover: null });
  assert.equal(noCover.ok, false);
  assert.match(noCover.problems.join(' '), /cover image/i);

  const tinyBody = canSubmitContribution({ ...base, body: 'too short' });
  assert.equal(tinyBody.ok, false);
  assert.match(tinyBody.problems.join(' '), /body/i);

  const noTitle = canSubmitContribution({ ...base, title: '   ' });
  assert.equal(noTitle.ok, false);
  assert.match(noTitle.problems.join(' '), /title/i);
});

test('16:9 crop rules accept landscape, tall portrait, and reject weak sources', () => {
  const wideCrop = largestSixteenNineCrop(1920, 1080);
  assert.deepEqual(wideCrop, { width: 1920, height: 1080 });

  // Portrait images are allowed when they hold enough resolution.
  assert.equal(coverMeetsResolution(1080, 1350), true);
  assert.equal(coverMeetsResolution(1600, 2400), true);
  assert.deepEqual(largestSixteenNineCrop(1200, 1600), { width: 1200, height: 675 });

  assert.equal(coverMeetsResolution(800, 800), false);
  assert.equal(coverMeetsResolution(959, 539), false);

  const check = validateCoverDimensions(800, 600);
  assert.equal(check.ok, false);
  assert.match(check.message, /960 × 540/);
});

test('cover files accept only JPG, PNG, and WebP within the size limit', () => {
  assert.equal(validateCoverFile({ name: 'a.jpg', type: 'image/jpeg', size: 100 }).ok, true);
  assert.equal(validateCoverFile({ name: 'a.png', type: '', size: 100 }).ok, true);
  assert.equal(validateCoverFile({ name: 'a.webp', type: 'image/webp', size: 100 }).ok, true);

  const svg = validateCoverFile({ name: 'logo.svg', type: 'image/svg+xml', size: 10 });
  assert.equal(svg.ok, false);
  assert.match(svg.message, /SVG/);

  const gif = validateCoverFile({ name: 'clip.gif', type: 'image/gif', size: 10 });
  assert.equal(gif.ok, false);

  const heic = validateCoverFile({ name: 'photo.heic', type: '', size: 10 });
  assert.equal(heic.ok, false);

  const huge = validateCoverFile({ name: 'big.jpg', type: 'image/jpeg', size: CONTRIBUTION_LIMITS.COVER_MAX_BYTES + 1 });
  assert.equal(huge.ok, false);
  assert.match(huge.message, /10 MB/);
});

test('document imports accept PDF and DOCX only, with exact legacy Word guidance', () => {
  assert.equal(validateDocumentFile({ name: 'brief.pdf', type: 'application/pdf', size: 1000 }).isPdf, true);
  assert.equal(validateDocumentFile({ name: 'notes.docx', type: '', size: 1000 }).isDocx, true);

  const legacy = validateDocumentFile({ name: 'memo.doc', type: '', size: 1000 });
  assert.equal(legacy.ok, false);
  assert.equal(
    legacy.message,
    'This Word format is not supported yet. Save the document as .docx and try again.',
  );

  assert.equal(validateDocumentFile({ name: 'sheet.xlsx', type: '', size: 10 }).ok, false);
  assert.equal(validateDocumentFile({ name: 'slides.pptx', type: '', size: 10 }).ok, false);
  assert.equal(validateDocumentFile({ name: 'thing.zip', type: 'application/zip', size: 10 }).ok, false);

  const oversized = validateDocumentFile({
    name: 'huge.pdf',
    type: 'application/pdf',
    size: CONTRIBUTION_LIMITS.DOCUMENT_MAX_BYTES + 1,
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /25 MB/);
});

test('extracted text becomes an editable draft without inventing a summary', () => {
  const text = 'Quarterly display strategy\n\nThis is the first paragraph of real content.\n\nA second paragraph follows here.';
  const paragraphs = splitParagraphs(text);
  assert.equal(paragraphs.length, 3);
  assert.equal(detectTitle(text, 'fallback.pdf'), 'Quarterly display strategy');
  assert.equal(detectTitle('', 'internal_q3_report.pdf'), 'internal q3 report');
  const longFirstLine = `${'x'.repeat(200)}\n\nBody copy.`;
  assert.equal(detectTitle(longFirstLine, 'doc.docx').length <= CONTRIBUTION_LIMITS.TITLE_MAX, true);
});

test('For You owns a compact Feed, Following and Create workspace', () => {
  const orderMatch = workspaceShellSource.match(/const tabs = \[[\s\S]*?\];/)?.[0] || '';
  assert.match(orderMatch, /Your Feed[\s\S]*Following[\s\S]*Create/);
  assert.match(workspaceShellSource, /greetingForHour/);
  assert.match(workspaceShellSource, /Edit the topics used to rank your feed/);
  assert.match(workspaceShellSource, /role="tablist"/);
  assert.match(workspaceShellSource, /ArrowLeft/);
  assert.match(workspaceShellSource, /ArrowRight/);
  assert.match(workspaceShellSource, /Home/);
  assert.match(workspaceShellSource, /End/);
  assert.match(workspaceShellSource, /<ForYouScreen/);
  assert.match(workspaceShellSource, /<FollowingScreen/);
  assert.match(workspaceShellSource, /<CreateScreen contributionAllowed=\{allowed\}/);
  assert.match(createScreenSource, /Private Briefing[\s\S]*Contributions/);
  assert.match(createScreenSource, /contributionAllowed &&/);
});

test('every owned contribution exposes a labelled permanent delete action', () => {
  assert.match(workspaceSource, /deleteContributionRecord/);
  assert.match(workspaceSource, /Permanently delete/);
  assert.match(workspaceSource, /cw-delete-button/);
  assert.match(workspaceSource, /'Delete'/);
  assert.doesNotMatch(
    workspaceSource,
    /record\.status !== CONTRIBUTION_STATUS\.SUBMITTED[\s\S]{0,300}removeContribution/,
  );
});

test('one For You splat route owns the workspace and legacy Saved routes redirect', () => {
  assert.match(indexSource, /isSenseLanding[\s\S]*window\.location\.replace\("\/for-you"\)/);
  assert.match(appSource, /path="\/for-you\/\*"/);
  assert.match(appSource, /path="\/saved\/\*" element=\{<LegacySavedRedirect \/>\}/);
  assert.match(appSource, /\/saved\/contribute[\s\S]*\/for-you\/create\/contributions/);
  assert.match(appSource, /\/saved\/leadership[\s\S]*\/for-you\/create\/contributions\/leadership/);
  assert.match(appSource, /\/saved\/briefings[\s\S]*\/for-you\/create/);
  assert.match(createScreenSource, /endsWith\('\/leadership'\)/);
});

test('Create uses a compact studio switcher instead of a duplicate desk hero', () => {
  assert.match(createScreenSource, /fy-create-command/);
  assert.match(createScreenSource, /Creation studio/);
  assert.doesNotMatch(createScreenSource, /Turn links into a private briefing, or prepare/);
  assert.match(createScreenSource, /Private Briefing/);
  assert.match(createScreenSource, /Contributions/);
  assert.match(savedSource, /const embedded = Boolean\(view\)/);
  assert.match(savedSource, /\{!embedded && \(/);
});

test('a stale recovered draft id heals by creating fresh instead of failing', () => {
  assert.match(workspaceSource, /updateError\?\.status !== 404\) throw updateError/);
  assert.match(workspaceSource, /if \(!stored\) stored = await createContributionDraft\(draft\)/);
});

test('leadership messages are a third contribution path feeding the same pipeline', () => {
  const modelSource = readFileSyncSafe('../src/news-scrapper/internal/contributionModel.js');
  assert.match(modelSource, /LEADERSHIP: 'leadership'/);
  assert.match(modelSource, /leadership: 'Leadership message'/);
  assert.match(workspaceSource, /startLeadership/);
  assert.match(workspaceSource, /onClick=\{startLeadership\}/);
  assert.match(workspaceSource, /navigate\('\/for-you\/create\/contributions\/leadership', \{ replace: true \}\)/);
  assert.match(workspaceSource, /Vision of the quarter/);
  assert.match(apiSource, /content_type: draft\.contentType \|\| ''/);
});

test('writing and importing share one story entry card', () => {
  assert.match(workspaceSource, /<h3>Write a story<\/h3>/);
  assert.match(workspaceSource, /Start from blank/);
  assert.match(workspaceSource, /Import PDF \/ DOCX/);
  assert.doesNotMatch(workspaceSource, /<h3>Import a document<\/h3>/);
  assert.match(workspaceSource, /setEditing\(record\)/);
});

test('browser session recovery never skips the contribution landing page', () => {
  assert.match(workspaceSource, /setRecoveredDraft\(draft\)/);
  assert.doesNotMatch(workspaceSource, /if \(restored\?\.draft\?\.contentType\)[\s\S]{0,260}setEditing\(draft\)/);
  assert.match(workspaceSource, /A previous draft is waiting/);
  assert.match(workspaceSource, /Resume draft/);
  assert.match(workspaceSource, /Discard recovery/);
});

test('the announcement studio returns explicitly to contributions', () => {
  assert.match(announcementSource, /Back to contributions/);
  assert.match(announcementSource, /navigate\('\/for-you\/create\/contributions'\)/);
});

test('contribution persistence is API-backed on same-origin internal-content endpoints', () => {
  assert.match(apiSource, /jsonFetch\('\/internal-content\/mine'\)/);
  assert.match(apiSource, /uploadFetch\('\/internal-content\/import'/);
  assert.match(apiSource, /\/internal-content\/\$\{id\}\/submit/);
  assert.match(apiSource, /form\.append\('cover', file\)/);
  assert.match(workspaceSource, /importContributionDocument/);
  assert.match(workspaceSource, /submitContributionDraft/);
  assert.match(workspaceSource, /Contribution submitted\./);
  // The browser-only authority is gone: no IndexedDB adapter, no client parsing.
  assert.equal(readFileSyncSafe('../src/news-scrapper/internal/contributionStore.js'), null);
  assert.doesNotMatch(parserSource, /pdfjs|mammoth|parseContributionDocument/);
});

function readFileSyncSafe(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

test('imported document content is never rendered as HTML', () => {
  const editorSource = readFileSync(
    new URL('../src/news-scrapper/components/personal-desk/ContributionEditor.jsx', import.meta.url),
    'utf8',
  );
  const previewSource = readFileSync(
    new URL('../src/news-scrapper/components/personal-desk/ContributionPreview.jsx', import.meta.url),
    'utf8',
  );
  for (const source of [editorSource, previewSource, workspaceSource]) {
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  }
  assert.match(previewSource, /split\(/);
});

test('the review desk runs every hook before its editor-gate early return', () => {
  // Regression: useMemo lived below `if (unlocked === false) return …`, so a
  // locked probe rendered fewer hooks than an unlocked pass and crashed the
  // whole Review Queue route. Hooks must all precede any conditional return.
  const deskSource = readFileSync(
    new URL('../src/news-scrapper/components/ContributionReviewDesk.jsx', import.meta.url),
    'utf8',
  );
  const gateIndex = deskSource.indexOf('if (unlocked === false)');
  assert.notEqual(gateIndex, -1);
  const hookPattern = /\b(useState|useEffect|useMemo|useRef|useCallback|useModalFocus)\(/g;
  let match;
  let lastHookEnd = -1;
  while ((match = hookPattern.exec(deskSource)) !== null) {
    lastHookEnd = match.index;
  }
  assert.ok(
    lastHookEnd !== -1 && lastHookEnd < gateIndex,
    'every hook call must appear before the editor-gate early return',
  );
});
