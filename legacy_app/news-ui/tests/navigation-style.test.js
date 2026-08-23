import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const topBar = read("../src/news-scrapper/components/TopBar.jsx");
const resolver = read("../src/news-scrapper/components/navigationStyle.js");
const navigationCss = read("../src/news-scrapper/components/premium-navigation.css");
const venture = read("../src/venture-lens/VentureLensApp.jsx");
const ventureCss = read("../src/venture-lens/venture-lens.css");

test("NewsScrapper keeps a reversible classic navbar while defaulting to floating", () => {
  assert.match(resolver, /VITE_NEWSSCRAPPER_NAV_STYLE/);
  assert.match(resolver, /new Set\(\["classic", "floating"\]\)/);
  assert.match(resolver, /return SUPPORTED_NAV_STYLES\.has\(requested\) \? requested : "floating"/);
  assert.match(topBar, /nav-style-\$\{NEWS_SCRAPPER_NAV_STYLE\}/);
  assert.match(topBar, /data-navigation-style=\{NEWS_SCRAPPER_NAV_STYLE\}/);
  assert.match(navigationCss, /\.premium-command-header\.nav-style-floating/);
  assert.match(navigationCss, /\.premium-command-header\.nav-style-classic/);
});

test("the shared floating shell and research subnavigation retain named, keyboard-visible controls", () => {
  assert.match(navigationCss, /:focus-visible/);
  assert.match(venture, /aria-label="Research workspaces"/);
  assert.match(venture, /className="vl-research-shell-head"/);
  assert.match(ventureCss, /\.vl-research-shell-head/);
  assert.match(ventureCss, /:focus-visible/);
});
