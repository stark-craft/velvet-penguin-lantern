import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Sampark Draft Export uses a portal with its own contrast-safe UI', () => {
  const source = read('../src/news-scrapper/components/modals/DraftExportModal.jsx');
  const style = read('../src/news-scrapper/components/modals/draft-export-sampark.css');
  const allNews = read('../src/sampark/all-news/AllNewsPage.jsx');

  assert.match(allNews, /<DraftExportModal[^>]*source="sampark-all-news"/);
  assert.match(source, /String\(source \|\| ''\)\.startsWith\('sampark'\)/);
  assert.match(source, /window\.location\.pathname/);
  assert.match(source, /samparkRoute/);
  assert.match(source, /data-sampark-draft-export="studio-v2"/);
  assert.match(source, /sde-overlay--sampark/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
  assert.match(source, /useModalFocus\(open, busy \? undefined : onClose\)/);
  assert.match(source, /aria-labelledby="sde-title"/);
  assert.match(source, /aria-describedby="sde-description"/);
  assert.match(source, /className="sde-dialog"/);
  assert.match(source, /import '\.\/draft-export-sampark\.css'/);
  assert.match(style, /\.sde-dialog\s*\{/);
  assert.match(style, /\.sde-overlay--sampark \.sde-dialog/);
  assert.match(style, /background:#14263f/);
  assert.match(style, /\.sde-overlay--sampark \.sde-option/);
  assert.match(style, /background:#203854/);
  assert.match(style, /\.sde-option\s*\{/);
  assert.match(style, /html\[data-theme="dark"\] \.sde-dialog/);
  assert.match(style, /@media\(max-width:600px\)/);
  assert.match(style, /prefers-reduced-motion/);
  assert.doesNotMatch(style, /^\.modal[\s.{]/m);
});

test('Existing draft exports retain filenames, source identity and telemetry', () => {
  const source = read('../src/news-scrapper/components/modals/DraftExportModal.jsx');

  for (const [id, label, ext, handler] of [
    ['ppt', 'PowerPoint', 'pptx', 'exportPpt'],
    ['word', 'Word', 'docx', 'exportWord'],
    ['excel', 'Excel', 'xlsx', 'exportExcel'],
  ]) {
    assert.ok(source.includes("id: '" + id + "'"), id + ' format missing');
    assert.ok(source.includes("label: '" + label + "'"), label + ' missing');
    assert.ok(source.includes("ext: '" + ext + "'"), ext + ' missing');
    assert.ok(source.includes('action: ' + handler), handler + ' missing');
  }
  assert.match(source, /await option\.action\(items, `draft_\$\{source\}_\$\{stamp\}\.\$\{option\.ext\}`\)/);
  assert.match(source, /trackAction\('draft_export'/);
  assert.match(source, /onClose\(\)/);
  assert.match(source, /className="modal sm compact-dialog export-modal"/);
  assert.match(source, /className="modal-overlay"/);
});

test('New export interface supports loading, errors and refusal of duplicate clicks', () => {
  const source = read('../src/news-scrapper/components/modals/DraftExportModal.jsx');

  assert.match(source, /if \(!items\.length \|\| busy\) return/);
  assert.match(source, /setBusy\(option\.id\)/);
  assert.match(source, /disabled=\{!!busy \|\| !selectedCount\}/);
  assert.match(source, /className="sde-working" role="status"/);
  assert.match(source, /className="sde-error" role="alert"/);
  assert.match(source, /onMouseDown=\{busy \? undefined : onClose\}/);
  assert.match(source, /Unapproved material|unapproved material/);
});
