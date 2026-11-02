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
  assert.match(hook, /target\.body\.innerHTML/);
  assert.match(editor, /!replaceEdited && !canApplyAnalysis/);
  assert.match(editor, /!replaceEdited && !canApplyAutomaticImpact/);
  assert.match(editor, /reportStartup\.current\?\.cancel\(\)/);
});
