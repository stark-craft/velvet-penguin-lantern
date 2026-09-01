import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repeatingCycleCount } from "../src/news-scrapper/hooks/useAutoplayState.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../src/news-scrapper/App.jsx");
const topBar = read("../src/news-scrapper/components/TopBar.jsx");
const briefing = read("../src/news-scrapper/screens/FeedScreen.jsx");
const research = read("../src/news-scrapper/screens/ResearchScreen.jsx");
const samsung = read("../src/news-scrapper/screens/SamsungInternalScreen.jsx");
const continuousStream = read("../src/news-scrapper/components/ContinuousSignalStream.jsx");
const continuousStreamStyles = read("../src/news-scrapper/styles/continuous-signal-stream.css");
const samsungStyles = read("../src/news-scrapper/styles/samsung-internal.css");
const themeStyles = read("../src/news-scrapper/theme-toggle.css");
const autoplay = read("../src/news-scrapper/hooks/useAutoplayState.js");
const publishing = read("../src/news-scrapper/screens/InternalPublishingScreen.jsx");
const saved = read("../src/news-scrapper/screens/SavedScreen.jsx");

test("Research, Samsung Internal and publishing are routes inside the existing app shell", () => {
  assert.match(app, /path="\/research"/);
  assert.match(app, /path="\/samsung-internal"/);
  assert.match(app, /path="\/internal-publishing"/);
  assert.match(app, /path="\/venturelens\/\*"/);
  assert.match(topBar, /label: "Research"/);
  assert.match(topBar, /label: "Samsung Internal"/);
  assert.doesNotMatch(topBar, /label: "Announcements"/);
});

test("Research is a discovery gateway with an observatory, evidence stream and provider-aware lanes", () => {
  assert.match(research, /getVentureDiscovery/);
  assert.match(research, /Research Observatory/);
  assert.match(research, /Evidence Stream/);
  assert.match(research, /\/venturelens\/models/);
  assert.match(research, /\/venturelens\/datasets/);
  assert.match(research, /\/venturelens\/patents/);
  assert.match(research, /payload\?\.providers\?\.\[lane\.provider\]\?\.available !== false/);
  assert.doesNotMatch(research, /Four ways in|Research & Technology Intelligence/);
});

test("Samsung Internal is rebuilt from live contracts, not prototype stores", () => {
  // The rejected prototype mixed a localStorage store, fabricated samples and
  // external news into one carousel. The rebuild reads only the shared
  // briefing and the published server records.
  assert.doesNotMatch(samsung, /getInternalContent|internalSamples|subscribeInternalContent/);
  assert.doesNotMatch(samsung, /internalContentStore/);
  assert.doesNotMatch(samsung, /localStorage/);
  assert.match(samsung, /getSharedBriefing/);
  assert.match(samsung, /getPublishedInternalContent/);
  assert.match(samsung, /samsung-internal\.css/);
});

test("Samsung Focus pins leadership while keeping every carousel zone fixed", () => {
  assert.match(samsung, /sni-focus-carousel/);
  assert.match(samsung, /sni-focus-controls/);
  assert.match(samsung, /window\.setInterval[\s\S]*8000/);
  assert.match(samsung, /autoplayDelay\(8000, reducedMotion\)/);
  assert.match(samsung, /Pause Samsung Focus/);
  assert.match(autoplay, /prefers-reduced-motion: reduce/);
  assert.match(samsung, /Read full message/);
  assert.match(samsungStyles, /grid-template-rows: 52px 38px minmax\(0, 1fr\) 72px/);
  assert.match(samsungStyles, /-webkit-line-clamp: 3/);
});

test("live streams keep flowing on Windows motion settings and tall displays", () => {
  assert.match(briefing, /autoplayDelay\(8000, reducedMotion\)/);
  assert.match(briefing, /Pause carousel/);
  assert.match(continuousStream, /\[0, 1, 2, 3\]\.map\(renderGroup\)/);
  assert.match(continuousStream, /reducedMotion \? 1\.75 : 1/);
  assert.doesNotMatch(continuousStream, /IntersectionObserver/);
  assert.match(continuousStreamStyles, /translateY\(-25%\)/);
  assert.doesNotMatch(continuousStreamStyles, /animation:none/);
  // The global accessibility reset intentionally suppresses ordinary motion.
  // Required live streams must opt back into only their slowed, pausable loops.
  assert.match(themeStyles, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(continuousStreamStyles, /prefers-reduced-motion:reduce[\s\S]*animation-duration:var\(--stream-duration,63s\)!important[\s\S]*animation-iteration-count:infinite!important/);
  assert.match(samsungStyles, /prefers-reduced-motion: reduce[\s\S]*\.sni-announcement-track[\s\S]*animation-duration: var\(--announcement-duration, 56s\) !important[\s\S]*animation-iteration-count: infinite !important/);
  assert.match(autoplay, /document\.visibilityState === 'visible'/);
  assert.equal(repeatingCycleCount(3840, 1, 286), 28);
  assert.equal(repeatingCycleCount(7680, 1, 286), 55);
  assert.equal(repeatingCycleCount(1920, 10, 410), 4);
});

test("Samsung Internal nests a compact announcement rail in the wire and keeps three archive channels", () => {
  assert.match(samsung, /Samsung Global/);
  assert.match(samsung, /Samsung Local/);
  assert.match(samsung, /Inside Samsung/);
  assert.match(samsung, /getSamsungInternalFeed\(100\)/);
  assert.match(samsung, /DateGroupedSignals/);
  assert.match(samsung, /Sampark stream/);
  assert.match(samsung, /sni-wire-announcements/);
  assert.match(samsung, /repeatingCycleCount\(viewportWidth, items\.length, minimumEntryWidth\)/);
  assert.match(samsung, /Array\.from\(\{ length: copyCount \}/);
  assert.match(samsung, /--announcement-copy-count/);
  assert.match(samsung, /Pause company announcements/);
  assert.doesNotMatch(samsung, /staticMode = reduced \|\| Boolean\(onRemove\)/);
  assert.match(samsung, /function IntelligenceWire\(\{[\s\S]*announcements = \[\][\s\S]*items[\s\S]*onRemoveAnnouncement[\s\S]*\}\)/);
  assert.match(samsung, /<AnnouncementRail[\s\S]*items=\{announcements\}[\s\S]*onRemove=\{onRemoveAnnouncement\}/);
  assert.match(samsung, /Samsung Intelligence Wire/);
  assert.doesNotMatch(samsung, /id: 'announcements'/);
});

test("Samsung Internal renders on theme tokens via its stylesheet", () => {
  assert.match(samsungStyles, /samsung-internal-page/);
  assert.match(samsungStyles, /var\(--text\)/);
  assert.match(samsungStyles, /sni-notice-with-image/);
  assert.match(samsungStyles, /sni-notice-text-only/);
  assert.match(samsungStyles, /html\[data-theme="light"\] \.samsung-internal-page \.sni-chip/);
});

test("internal publishing is the announcement studio on the server pipeline", () => {
  // The old browser-local prototype (localStorage store, client-side PDF
  // parsing, leadership/library views) was stripped. The premium studio now
  // authors announcements only, through the shared /internal-content API.
  assert.doesNotMatch(publishing, /getInternalContent|saveInternalEntry|saveLeadershipMessage/);
  assert.doesNotMatch(publishing, /sense-samsung-internal-v1/);
  assert.match(publishing, /contentType: "announcement"/);
  assert.match(publishing, /importContributionDocument/);
  assert.match(publishing, /createContributionDraft|updateContributionDraft/);
  assert.match(publishing, /submitContributionDraft/);
  assert.match(publishing, /uploadContributionCover/);
  assert.match(publishing, /sessionStorage/);
  // Covers are optional for announcements.
  assert.match(publishing, /Cover visual <small>optional<\/small>/);
  assert.doesNotMatch(topBar, /to: "\/internal-publishing", label: "Announcements"/);
  assert.match(app, /<ContributionOnly access=\{contributionAccess\}>/);
});

test("Saved hosts the inline contribute desk for stories and leadership", () => {
  assert.match(saved, /Contribute to Samsung Internal|Contribute/);
  assert.match(saved, /ContributionWorkspace/);
});
