import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('Redesigned report studio retains editing, AI and export contracts', () => {
  const report = read('../src/sampark/report-editor/ReportEditor.jsx');
  const model = read('../src/sampark/report-editor/reportModel.js');
  const startup = read('../src/sampark/report-editor/reportStartup.js');

  assert.match(report, /seedReport\(items\)/);
  assert.match(report, /dangerouslySetInnerHTML=\{\{__html:initial\}\}/);
  assert.match(report, /contentEditable=\{!busy\}/);
  assert.match(report, /ref=\{editor\}/);
  assert.match(report, /documentHtml\(editor\.current\)/);
  assert.match(report, /prepareImpactSections\(element\)/);
  assert.match(report, /startReportIntelligence\(/);
  assert.match(startup, /await analysis\(\)/);
  assert.match(startup, /await impacts\(\)/);
  assert.match(report, /<AutomaticAnalysisStatus/);
  assert.match(report, /<AutomaticImpactStatus/);
  assert.match(report, /<SamsungImpactPanel/);
  assert.match(report, /<AskAiPanel/);
  assert.match(report, /currentAnalysisInputs\(editor\.current,items\)/);
  assert.match(report, /reportImpactArticles\(editor\.current\)/);
  assert.match(report, /canApplyAutomaticImpact/);
  assert.match(report, /canApplyAnalysis/);
  assert.match(report, /reportRequest\(\x60\/export\/\$\{fmt\}\x60,snapshot\(\)\)/);
  assert.match(report, /reportRequest\('\/drafts',current\)/);
  for (const field of ['data-kind="overview"', 'data-kind="article"', 'data-kind="cross-analysis"', 'data-kind="impact-body"']) {
    assert.ok(model.includes(field), 'missing persisted article structure: '+field);
  }
});

test('Report Studio provides navigation, Samsung AI controls and adaptive canvas', () => {
  const jsx = read('../src/sampark/report-editor/ReportEditor.jsx');
  const css = read('../src/sampark/report-editor/report-studio.css');

  assert.match(jsx, /sr-studio-header/);
  assert.match(jsx, /sr-studio-ai-tools/);
  assert.match(jsx, /Samsung Impact<\/button>/);
  assert.match(jsx, /Ask AI<\/button>/);
  assert.match(jsx, /sr-studio-outline/);
  assert.match(jsx, /navigateReport\(index\)/);
  assert.match(jsx, /new MutationObserver\(sync\)/);
  assert.match(jsx, /sr-studio-paper-wrap/);
  assert.match(jsx, /sr-studio-export-buttons/);
  assert.match(jsx, /report-studio\.css/);
  assert.match(css, /\.sr-studio-outline/);
  assert.match(css, /\.sr-studio-paper-wrap/);
  assert.match(css, /html\[data-theme=dark\]/);
  assert.match(css, /@media\(max-width:840px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('AI progress is real and user-edited passages still require review before replacement', () => {
  const impact = read('../src/sampark/report-editor/AutomaticImpactStatus.jsx');
  const analysis = read('../src/sampark/report-editor/AutomaticAnalysisStatus.jsx');
  const hook = read('../src/sampark/report-editor/useAutomaticImpact.js');
  const editor = read('../src/sampark/report-editor/ReportEditor.jsx');

  assert.match(impact, /pending\.index/);
  assert.match(impact, /role="progressbar"/);
  assert.match(impact, /aria-valuenow=\{finished\}/);
  assert.match(impact, /state\.issues\.map/);
  assert.match(impact, /onKeep\(issue\)/);
  assert.match(analysis, /onRetry/);
  assert.match(analysis, /onApply\(state\.result,state\.target,true\)/);
  assert.match(hook, /completed\.current/);
  assert.match(hook, /completed\.current\.add\(target\.body\)/);
  assert.match(editor, /!replaceEdited && !canApplyAnalysis/);
  assert.match(editor, /!replaceEdited && !canApplyAutomaticImpact/);
  assert.match(editor, /reportStartup\.current\?\.cancel\(\)/);
});

test('Inline AI indicators decorate their own document blocks and are excluded from exports', async () => {
  const {
    updateReportLiveStates, stripReportLiveStates,
  } = await import('../src/sampark/report-editor/reportLiveStates.js');

  const makeNode = () => {
    const attributes = new Map();
    return {
      attributes,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) => attributes.get(name),
      closest: () => null,
    };
  };
  const comparison = makeNode();
  const impactOne = makeNode();
  const impactTwo = makeNode();
  const bodyOne = makeNode();
  const bodyTwo = makeNode();
  bodyOne.closest = () => impactOne;
  bodyTwo.closest = () => impactTwo;
  const boxes = [impactOne, impactTwo];
  const known = new Set([comparison, impactOne, impactTwo, bodyOne, bodyTwo]);
  const root = {
    contains: (node) => known.has(node),
    querySelector: (selector) => selector === '[data-kind="cross-analysis"]' ? comparison
      : selector === '[data-kind="samsung-impact"]' ? impactOne : null,
    querySelectorAll: (selector) => selector === '[data-kind="samsung-impact"]'
      ? boxes : selector === '[data-sr-ai-state]'
        ? [comparison, ...boxes].filter(node=>node.attributes.has('data-sr-ai-state'))
        : [],
  };
  updateReportLiveStates(root, {status:'loading'}, null);
  assert.equal(comparison.getAttribute('data-sr-ai-state'), 'loading');
  assert.equal(impactOne.getAttribute('data-sr-ai-state'), 'queued');
  assert.equal(impactTwo.getAttribute('data-sr-ai-state'), 'queued');

  const pending = {index:1,total:2,body:bodyOne,targets:[bodyOne,bodyTwo]};
  updateReportLiveStates(root, null, {pending,issues:[]});
  assert.equal(impactOne.getAttribute('data-sr-ai-state'), 'loading');
  assert.equal(impactTwo.getAttribute('data-sr-ai-state'), 'queued');
  assert.equal(comparison.getAttribute('data-sr-ai-state'), undefined);

  updateReportLiveStates(root, null, {pending:null,issues:[
    {status:'error',target:{body:bodyOne},message:'Source summary unavailable'},
    {status:'proposal',target:{body:bodyTwo}},
  ]});
  assert.equal(impactOne.getAttribute('data-sr-ai-state'), 'error');
  assert.equal(impactOne.getAttribute('data-sr-ai-detail'), 'Source summary unavailable');
  assert.equal(impactTwo.getAttribute('data-sr-ai-state'), 'review');
  stripReportLiveStates(root);
  for (const block of [comparison, ...boxes]) {
    assert.equal(block.getAttribute('data-sr-ai-state'), undefined);
    assert.equal(block.getAttribute('data-sr-ai-label'), undefined);
    assert.equal(block.getAttribute('data-sr-ai-detail'), undefined);
  }
});

test('Inline generation effects are CSS-only and do not contaminate persisted report HTML', () => {
  const editor = read('../src/sampark/report-editor/ReportEditor.jsx');
  const css = read('../src/sampark/report-editor/report-studio.css');
  const module = read('../src/sampark/report-editor/reportLiveStates.js');
  const impact = read('../src/sampark/report-editor/useAutomaticImpact.js');

  assert.match(editor, /stripReportLiveStates\(clone\)/);
  assert.match(editor, /updateReportLiveStates\(editor\.current, automaticAnalysis, automaticImpact\.state\)/);
  assert.match(module, /data-sr-ai-state/);
  assert.match(module, /data-sr-ai-label/);
  assert.match(module, /data-sr-ai-detail/);
  assert.match(impact, /body:target\.body,targets:bodies/);
  assert.match(css, /\[data-sr-ai-state="loading"\]/);
  assert.match(css, /\[data-sr-ai-state="error"\]/);
  assert.match(css, /\[data-sr-ai-state="queued"\]/);
  assert.match(css, /\[data-sr-ai-state="review"\]/);
  assert.match(css, /sr-inline-ai-flow/);
  assert.match(css, /prefers-reduced-motion/);
});
