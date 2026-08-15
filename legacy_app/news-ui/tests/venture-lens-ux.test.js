import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/venture-lens/VentureLensApp.jsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/venture-lens/venture-lens.css", import.meta.url), "utf8");

test("Venture Lens radar markup is paired with the layout CSS it actually renders", () => {
  assert.match(appSource, /className="vl-radar-layout"/);
  assert.match(styleSource, /\.vl-signal-radar,\.vl-radar-layout/);
});

test("repository and paper discovery keep separate queries and honest progressive counts", () => {
  assert.match(appSource, /\[repoQuery, setRepoQuery\]/);
  assert.match(appSource, /\[paperQuery, setPaperQuery\]/);
  assert.match(appSource, /Show \{Math\.min\(ALL_PAGE_SIZE, filteredRepositories\.length - repoVisible\)\} more repositories/);
  assert.match(appSource, /Show \{Math\.min\(ALL_PAGE_SIZE, filteredPapers\.length - paperVisible\)\} more papers/);
});

test("comparison and partial workspace state survive normal frontend failure modes", () => {
  assert.match(appSource, /sessionStorage\.getItem\(COMPARISON_STORAGE_KEY\)/);
  assert.match(appSource, /sessionStorage\.setItem\(COMPARISON_STORAGE_KEY/);
  assert.match(appSource, /Promise\.allSettled/);
  assert.match(appSource, /WorkspaceFailure/);
});

test("Venture Lens navigation, filters and dossier expose accessible interaction contracts", () => {
  assert.match(appSource, /aria-current=\{page === id \? "page" : undefined\}/);
  assert.match(appSource, /role="group" aria-label="Filter by topic category"/);
  assert.match(appSource, /event\.key === "Escape"/);
  assert.match(appSource, /node\.setAttribute\("inert", ""\)/);
  assert.match(styleSource, /@media \(max-width: 1320px\)/);
  assert.match(styleSource, /flex-direction: column/);
});
