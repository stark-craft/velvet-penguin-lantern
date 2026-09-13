// Executable render tests: real component output via the repo's own esbuild +
// react-dom/server harness (tests/ssr-render.js). No new dependencies.
// A temporal-dead-zone read (like the former isSubmittedView crash) throws
// during render, so these fail on the broken code — not string-presence checks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToHtml, srcImport } from './ssr-render.js';

function createEl(access, items) {
  return `
import SamparkCreate from ${srcImport('sampark/SamparkCreate.jsx')};
function __element() {
  return React.createElement(SamparkCreate, {
    initialAccess: ${JSON.stringify(access)},
    initialItems: ${JSON.stringify(items)},
  });
}
`;
}

test('Create landing renders without a selected template (TDZ regression)', () => {
  const html = renderToHtml(createEl({ allowed: true }, []), { route: '/create' });
  assert.match(html, /What will you publish today\?/);
});

test('Create denied state renders when access is off', () => {
  const html = renderToHtml(createEl({ allowed: false }, []), { route: '/create' });
  assert.match(html, /Publishing access is required/);
});

test('Create dashboard lists every contribution with its total count', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `rec-${i}`,
    title: `Draft ${i}`,
    status: i === 3 ? 'needs_changes' : 'draft',
    contentType: 'story',
    category: 'General',
    updatedAt: '2026-09-01',
    reviewNote: i === 3 ? 'Add a cover' : '',
  }));
  const html = renderToHtml(createEl({ allowed: true }, items), { route: '/create' });
  assert.match(html, /Your contributions \(12\)/);
  assert.match(html, /Draft 0/);
  assert.match(html, /Draft 9/);
  assert.match(html, /Reviewer: Add a cover/);
  // Progressive disclosure: first page plus the remaining count, nothing silently dropped.
  assert.match(html, /Show more \(2 remaining\)/);
});

test('Settings distinguishes network-only from privileged sessions', () => {
  const el = (privileged, role) => `
import SamparkSettingsModal from ${srcImport('sampark/SamparkSettingsModal.jsx')};
function __element() {
  return React.createElement(SamparkSettingsModal, {
    open: true,
    capabilities: ['sources.view'],
    privilegedSessionActive: ${privileged},
    sessionRole: ${JSON.stringify(role)},
    onAccessChanged: () => {},
    onClose: () => {},
    onSaved: () => {},
    settings: { saveSearchHistory: true, personalizedFeed: true },
    viewer: { display_name: 'Tester', principal: 'x' },
  });
}
`;
  const networkOnly = renderToHtml(el(false, ''), { route: '/for-you' });
  assert.match(networkOnly, /Standard access/);
  assert.doesNotMatch(networkOnly, /Privileged session active/);
  const privileged = renderToHtml(el(true, 'editor'), { route: '/for-you' });
  assert.match(privileged, /Privileged session active/);
});
