import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const {
  activeLeadership,
  announcementsOf,
  buildHeroSlides,
  colleagueStoriesOf,
  coverUrl,
  groupSignalsByDate,
  isSamsungSignal,
  isSamsungLocalSource,
  isSamparkSource,
  rankTrending,
  signalLinkOf,
  signalScope,
  splitByScope,
} = await import("../src/news-scrapper/internal/samsungInternalModel.js");
const { canSubmitContribution } = await import(
  "../src/news-scrapper/internal/contributionModel.js"
);

const signal = (overrides = {}) => ({
  id: overrides.title || "signal",
  title: "Generic tech story",
  summary: "Something happened in the industry.",
  source: "TechRadar",
  source_count: 1,
  importance_score: 50,
  link: "https://example.com/story",
  ...overrides,
});

test("Samsung relevance is detected by mention or dedicated outlet", () => {
  assert.equal(isSamsungSignal(signal({ title: "Samsung unveils tri-fold phone" })), true);
  assert.equal(isSamsungSignal(signal({ title: "Galaxy roadmap leaks", keywords_found: ["Samsung supply chain"] })), true);
  assert.equal(isSamsungSignal(signal({ source: "SamMobile" })), true);
  assert.equal(isSamsungSignal(signal({ source: "Samsung Newsroom" })), true);
  assert.equal(isSamsungSignal(signal({
    title: "How to watch the weekend football",
    summary: "A guide to this weekend's fixtures.",
    keywords_found: ["samsung", "tv", "broadcast"],
  })), false);
  assert.equal(isSamsungSignal(signal({ title: "See all latest", summary: "Samsung Galaxy news" })), false);
  assert.equal(isSamsungSignal(signal({ title: "Apple reports earnings" })), false);
  assert.equal(isSamsungSignal(null), false);
});

test("Scope split uses explicit Samsung Local, Samsung India and Sampark source contracts", () => {
  assert.equal(signalScope(signal({ source: "Samsung Local" })), "local");
  assert.equal(signalScope(signal({ source: "Samsung India" })), "local");
  assert.equal(signalScope(signal({ region: "India", source: "TechRadar" })), "global");
  assert.equal(signalScope(signal({ source: "TechRadar" })), "global");
  assert.equal(signalScope(signal({ source: "SamMobile" })), "global");
  assert.equal(isSamsungLocalSource(signal({ source: "Samsung India" })), true);
  assert.equal(isSamparkSource(signal({ source: "Sampark" })), true);

  const { global, local, inside } = splitByScope([
    signal({ id: "g", source: "The Verge" }),
    signal({ id: "l", source: "Samsung Local" }),
    signal({ id: "i", source: "Sampark" }),
  ]);
  assert.deepEqual(global.map((item) => item.id), ["g"]);
  assert.deepEqual(local.map((item) => item.id), ["l"]);
  assert.deepEqual(inside.map((item) => item.id), ["i"]);
});

test("signals group into newest-first daily editions", () => {
  const groups = groupSignalsByDate([
    signal({ id: "older", date: "2026-08-20" }),
    signal({ id: "newer", date: "2026-08-23" }),
    signal({ id: "same-day", published_at: "2026-08-23T18:00:00Z" }),
  ]);
  assert.deepEqual(groups.map((group) => [group.date, group.signals.length]), [
    ["2026-08-23", 2],
    ["2026-08-20", 1],
  ]);
});

test("Trending ranking prefers multi-source coverage then score then recency", () => {
  const ranked = rankTrending([
    signal({ id: "single-low", source_count: 1, importance_score: 40 }),
    signal({ id: "cluster-high", source_count: 4, importance_score: 88 }),
    signal({ id: "cluster-mid", source_count: 3, importance_score: 70 }),
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["cluster-high", "cluster-mid", "single-low"]);
});

test("Hero leads with the live leadership vision and fills to five dynamic slides", () => {
  const leadership = {
    id: "vision-2",
    contentType: "leadership",
    status: "published",
    publishedAt: "2026-08-20T09:00:00+00:00",
    title: "Vision of the quarter",
  };
  const olderVision = { ...leadership, id: "vision-1", publishedAt: "2026-07-01T09:00:00+00:00" };
  const articles = Array.from({ length: 9 }, (_, index) =>
    signal({
      id: `s-${index}`,
      title: index < 6 ? `Samsung story ${index}` : `Other story ${index}`,
      source_count: 10 - index,
      importance_score: 90 - index,
    }));

  assert.equal(activeLeadership([olderVision, leadership]), leadership);

  const slides = buildHeroSlides({ articles, leadership, limit: 5 });
  assert.equal(slides.length, 5);
  assert.equal(slides[0].kind, "leadership");
  assert.equal(slides[0].record.id, "vision-2");
  assert.ok(slides.slice(1).every((slide) => slide.kind === "signal"));
  // Dynamic slots prefer Samsung-tagged coverage before anything else.
  assert.ok(slides.slice(1).every((slide) => isSamsungSignal(slide.item)));
});

test("Hero falls back to top signals when Samsung coverage is thin, never fabricates", () => {
  const articles = [signal({ id: "a" }), signal({ id: "b" }), signal({ id: "c" })];
  const slides = buildHeroSlides({ articles, leadership: null, limit: 5 });
  assert.equal(slides.length, 3);
  assert.ok(slides.every((slide) => slide.kind === "signal"));

  const empty = buildHeroSlides({ articles: [], leadership: null, limit: 5 });
  assert.deepEqual(empty, []);
});

test("Published records route to their channels by content type", () => {
  const records = [
    { id: "lead", contentType: "leadership", status: "published", publishedAt: "2026-08-01" },
    { id: "note-1", contentType: "announcement", status: "published", publishedAt: "2026-08-02" },
    { id: "note-2", contentType: "announcement", status: "published", publishedAt: "2026-08-05" },
    { id: "draft-note", contentType: "announcement", status: "submitted" },
    { id: "story-1", contentType: "story", status: "published", publishedAt: "2026-08-03" },
    { id: "doc-1", contentType: "document_import", status: "published", publishedAt: "2026-08-04" },
    { id: "archived-story", contentType: "story", status: "archived" },
  ];
  assert.equal(activeLeadership(records).id, "lead");
  assert.deepEqual(announcementsOf(records).map((r) => r.id), ["note-2", "note-1"]);
  assert.deepEqual(colleagueStoriesOf(records).map((r) => r.id), ["doc-1", "story-1"]);
});

test("Cover URLs stay same-origin and cache-bust on updates", () => {
  assert.equal(
    coverUrl({ id: "rec-1", updated_at: "2026-08-05T10:00:00+00:00", cover: { file: "x.webp" } }),
    "/internal-content/rec-1/cover?v=2026-08-05T10%3A00%3A00%2B00%3A00",
  );
  assert.equal(coverUrl({ id: "rec-2", cover: null }), "");
});

test("Signal links prefer canonical article URLs and reject blanks", () => {
  assert.equal(signalLinkOf({ url: "https://x.com/a", link: "" }), "https://x.com/a");
  assert.equal(signalLinkOf({ link: " https://x.com/b " }), "https://x.com/b");
  assert.equal(signalLinkOf({}), "");
});

test("Announcement path exists end to end in the contribute desk contracts", () => {
  const model = read("../src/news-scrapper/internal/contributionModel.js");
  assert.match(model, /ANNOUNCEMENT: 'announcement'/);
  assert.match(model, /announcement: 'Announcement'/);

  const workspace = read("../src/news-scrapper/components/personal-desk/ContributionWorkspace.jsx");
  assert.match(workspace, /startAnnouncement/);
  assert.match(workspace, /Post an announcement/);
  // The desk hands off to the dedicated announcement studio instead of an
  // inline editor.
  assert.match(workspace, /navigate\('\/internal-publishing'\)/);

  const api = read("../src/news-scrapper/api.js");
  assert.match(api, /'leadership', 'announcement'/);
  assert.match(api, /publishedAt: record\.published_at/);

  const desk = read("../src/news-scrapper/components/ContributionReviewDesk.jsx");
  assert.match(desk, /announcements = list\.filter/);
  assert.match(desk, /Announcements/);
});

test("announcements are exempt from the cover requirement on both sides", () => {
  const base = { title: "Cafeteria hours", body: "The cafe now opens at eight sharp.", cover: null };
  assert.equal(canSubmitContribution({ ...base, contentType: "announcement" }).ok, true);
  const story = canSubmitContribution({ ...base, contentType: "story" });
  assert.equal(story.ok, false);
  assert.match(story.problems.join(" "), /cover/i);

  const model = read("../src/news-scrapper/internal/contributionModel.js");
  assert.match(model, /contentType !== CONTRIBUTION_CONTENT_TYPES\.ANNOUNCEMENT/);
});

test("the leadership composer rehearses the message inside a live carousel demo", () => {
  const editor = read("../src/news-scrapper/components/personal-desk/ContributionEditor.jsx");
  // The standard Edit form is unchanged; Preview mode shows the carousel
  // rehearsal for leadership drafts only.
  assert.match(editor, /LeadershipCarouselPreview/);
  assert.match(editor, /CONTRIBUTION_CONTENT_TYPES\.LEADERSHIP \? \(|draft\.contentType === CONTRIBUTION_CONTENT_TYPES\.LEADERSHIP/);

  const rehearsal = read("../src/news-scrapper/components/personal-desk/LeadershipCarouselPreview.jsx");
  // Same slide markup as the published Samsung Internal hero.
  assert.match(rehearsal, /hero-cluster-panel sni-hero sni-hero-demo/);
  assert.match(rehearsal, /sni-leader-title sni-editable-title/);
  assert.match(rehearsal, /sni-leader-quote sni-editable-quote/);
  assert.match(rehearsal, /sni-portrait-empty|sni-portrait-tools/);
  assert.match(rehearsal, /LeadershipCarouselPresentation/);
  assert.match(rehearsal, /sni-hero-stage sni-hero-stage-leadership/);
  assert.match(rehearsal, /From the MD/);
  // The pointer-events trap must never apply to the rehearsal.
  const styles = read("../src/news-scrapper/styles/samsung-internal.css");
  assert.match(styles, /\.sni-hero-demo \.sni-hero-stage,\n\.sni-hero-demo \.sni-hero-stage \* \{\n  pointer-events: auto;/);
  assert.match(styles, /\.sni-hero-demo \.sni-hero-stage\.sni-hero-stage-leadership \{\n  gap: 0;\n  padding: 0;/);

  const workspace = read("../src/news-scrapper/components/personal-desk/ContributionWorkspace.jsx");
  assert.doesNotMatch(workspace, /LeadershipEditor/);
});

test("leadership review reuses the publishing preview instead of a generic cover reader", () => {
  const desk = read("../src/news-scrapper/components/ContributionReviewDesk.jsx");
  assert.match(desk, /LeadershipCarouselPresentation/);
  assert.match(desk, /Open full reader/);
  assert.match(desk, /crc-leadership-card/);
  assert.match(desk, /crc-leadership-reader-stage/);

  const styles = read("../src/news-scrapper/styles/review-contributions.css");
  assert.match(styles, /\.crc-leadership-portrait/);
  assert.match(styles, /\.crc-modal-leadership/);
});

test("every desk surface has its own professional URL without remounting the desk", () => {
  const app = read("../src/news-scrapper/App.jsx");
  // One splat route keeps SavedScreen mounted across desk addresses; a forest
  // of sibling routes would remount (and blank) the desk on every tab click.
  assert.match(app, /path="\/saved\/\*"/);
  assert.doesNotMatch(app, /path="\/saved\/contribute"/);

  const savedScreen = read("../src/news-scrapper/screens/SavedScreen.jsx");
  assert.match(savedScreen, /tabFromPathname/);
  assert.match(savedScreen, /deskPathFor/);
});
