// Minimal server-render harness for executable component tests.
// Bundles a small entry with the repo's own esbuild (no new dependencies),
// executes it with node, and returns the rendered HTML string. Effects never
// run under renderToStaticMarkup, so tests assert the real initial render
// output — including crashes like temporal-dead-zone reads.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const esbuildBin = path.join(root, 'node_modules', '.bin', 'esbuild');

export function srcImport(relPath) {
  return JSON.stringify(path.join(root, 'src', relPath));
}

export function renderToHtml(elementSource, { route = '/' } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'tests', '.ssr-tmp-'));
  try {
    const entry = path.join(dir, 'entry.jsx');
    fs.writeFileSync(
      entry,
      `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
${elementSource}
const __html = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['${route}'] }, __element()),
);
process.stdout.write(JSON.stringify(__html));
`,
    );
    const out = path.join(dir, 'bundle.cjs');
    execFileSync(
      esbuildBin,
      [entry, '--bundle', '--platform=node', '--format=cjs', '--loader:.jsx=jsx', '--loader:.js=jsx', `--outfile=${out}`, '--log-level=error'],
      { stdio: 'pipe' },
    );
    return JSON.parse(execFileSync(process.execPath, [out], { encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
