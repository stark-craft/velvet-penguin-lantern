import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (f)=> readFileSync(new URL(f, import.meta.url),'utf8');

test('Research supported-action gating', ()=>{
  const card = read('../src/sampark/research/ResearchArtifactCard.jsx');
  assert.match(card, /isWatchSupported|isCompareSupported/);
  assert.match(card, /isWatchSupported/);
  assert.doesNotMatch(card, /onWatch && \(\s*\)/);
  // models, datasets, patents must not present controls
  const caps = read('../src/sampark/research/researchCapabilities.js');
  assert.match(caps, /SUPPORTED_WATCH_KINDS/);
  assert.match(caps, /technology.*repository.*paper/);
});

test('Research dossier complete', ()=>{
  const detail = read('../src/sampark/research/ResearchArtifactDetail.jsx');
  assert.match(detail, /Assessment/);
  assert.match(detail, /Recommendation/);
  assert.match(detail, /Practical relevance/);
  assert.match(detail, /Why now/);
  assert.match(detail, /Strengths/);
  assert.match(detail, /Risks/);
  assert.match(detail, /Connected repositories/);
  assert.match(detail, /Connected papers/);
  assert.match(detail, /Evidence metrics/);
  assert.match(detail, /Provider links/);
  assert.match(detail, /overflowWrap.*anywhere/);
});

test('Research refresh real action', ()=>{
  const overview = read('../src/sampark/research/ResearchOverview.jsx');
  assert.match(overview, /Refresh Research/);
  assert.match(overview, /refreshVentureLens/);
  assert.match(overview, /starting/);
  assert.match(overview, /running/);
  assert.match(overview, /success/);
  assert.match(overview, /partial/);
  assert.match(overview, /failure/);
  assert.match(overview, /disabled.*isRefreshing|isRefreshing/);
  assert.doesNotMatch(overview, /Retry on the affected lane/);
});

test('Research internal links stay inside Sampark', ()=>{
  const card = read('../src/sampark/research/ResearchArtifactCard.jsx');
  assert.match(card, /useNavigate/);
  assert.match(card, /\/research\/radar/);
  assert.match(card, /isExternalUrl/);
  assert.match(card, /isInternalSynthesized/);
});

test('Global search scope and performance', ()=>{
  const search = read('../src/sampark/SamparkSearchResults.jsx');
  assert.match(search, /Search all archived news/);
  assert.match(search, /retained TechScout news archive/);
  assert.match(search, /Showing 100 of/);
  assert.match(search, /limit.*100/);
  assert.doesNotMatch(search, /limit.*500.*offset.*while.*offset < total/s);
  assert.match(read('../src/sampark/searchRunner.js'), /AbortController/);
  assert.match(search, /From date/);
  assert.match(search, /To date/);
  assert.match(search, /Source/);
  assert.match(search, /relevance.*newest/s);
});

test('Search private preference and privacy panel', ()=>{
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /remember_search_history/);
  const modal = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(modal, /Remember Search History/);
  const results = read('../src/sampark/SamparkSearchResults.jsx');
  assert.match(results, /Searches help tune your For You briefing/);
  assert.match(results, /Search history is off/);
  assert.match(results, /Manage Settings/);
});

test('Tooltips and optimistic', ()=>{
  const tooltip = read('../src/sampark/shared/SamparkTooltip.jsx');
  assert.match(tooltip, /role="tooltip"/);
  assert.match(tooltip, /aria-describedby/);
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /SamparkTooltip/);
  assert.match(forYou, /useOptimisticAction|per-article/);
});

test('Research width not confined', ()=>{
  const css = read('../src/sampark/research/research.css');
  assert.doesNotMatch(css, /max-width:\s*1120px/);
  assert.match(css, /width:\s*100%/);
});

test('Latest card widths stable', ()=>{
  const css = read('../src/sampark/all-news/all-news.css');
  assert.match(css, /grid-auto-columns.*minmax\(280px, 300px\)/);
  assert.match(css, /min-width:\s*280px/);
});

test('Executive Control', ()=>{
  const router = read('../../news_scrapper/access_control/router.py');
  assert.match(router, /executive/);
  assert.match(router, /EXECUTIVE_KEY/);
  assert.match(router, /ALL_CAPABILITIES/);
  const env = read('../../.env.example');
  assert.match(env, /EXECUTIVE_KEY/);
});

test('VOC uses signed viewer', ()=>{
  const appPy = read('../../news_scrapper/application.py');
  assert.match(appPy, /viewer_key.*get_private_viewer_key/);
  assert.match(appPy, /rating.*focus/);
});

test('WS3 Latest News wires hydrated actions like day cards', ()=>{
  const latest = read('../src/sampark/all-news/LatestNews.jsx');
  assert.match(latest, /onLike/);
  assert.match(latest, /onDislike/);
  assert.match(latest, /onFollow/);
  assert.match(latest, /onHide/);
  assert.match(latest, /articleKey/);
  assert.doesNotMatch(latest, /item\.title \|\| ''\) \+ \(item\.date/);
  const page = read('../src/sampark/all-news/AllNewsPage.jsx');
  assert.match(page, /LatestNews items.*onLike.*onDislike.*onFollow.*onHide/s);
  const card = read('../src/sampark/all-news/NewsCard.jsx');
  assert.match(card, /SamparkTooltip/);
  assert.match(card, /sanitizeExternalUrl/);
  assert.match(card, /noreferrer noopener/);
});

test('WS4 engagement covers Following Hidden and card source opens', ()=>{
  const following = read('../src/sampark/SamparkFollowing.jsx');
  assert.match(following, /useArticleEngagement/);
  assert.match(following, /onDossierOpen/);
  assert.match(following, /onDossierClose/);
  assert.match(following, /onSourceOpen/);
  assert.match(following, /ArticleModal/);
  const hidden = read('../src/sampark/SamparkHidden.jsx');
  assert.match(hidden, /source_open/);
  assert.match(hidden, /sanitizeExternalUrl/);
  assert.match(hidden, /noreferrer noopener/);
  const page = read('../src/sampark/all-news/AllNewsPage.jsx');
  assert.match(page, /handleCardSourceOpen/);
  assert.match(page, /onSourceOpen=\{handleCardSourceOpen\}/);
});

test('WS6 every Sampark article surface uses the original TechScout dossier', ()=>{
  const dossier = read('../src/news-scrapper/components/modals/ArticleModal.jsx');
  assert.match(dossier, /sourceList/);
  const model = read('../src/sampark/shared/dossierModel.js');
  for (const field of ['summary_lead','summary_points','key_points','what_changed','why_now','why_matters','watch_next','full_contents','keywords_found','source_count','sentiment','learned']) {
    assert.match(model, new RegExp(field));
  }
  assert.match(dossier, /role="dialog"/);
  assert.match(dossier, /aria-modal/);
  assert.match(dossier, /aria-labelledby/);
  assert.match(dossier, /Close dossier/);
  for (const surface of ['SamparkHistory.jsx', 'SamparkFollowing.jsx', 'SamparkSearchResults.jsx', 'SamparkForYou.jsx', 'SamparkSamsungNews.jsx']) {
    assert.match(read(`../src/sampark/${surface}`), /ArticleModal/);
  }
  const history = read('../src/sampark/SamparkHistory.jsx');
  assert.match(history, /ArticleModal/);
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /ArticleModal/);
  assert.match(read('../src/sampark/all-news/AllNewsPage.jsx'), /ArticleModal/);
  assert.doesNotMatch(forYou, /function SamparkArticleModal/);
});

test('WS2 author dashboard reopens editable records with status actions', ()=>{
  const create = read('../src/sampark/SamparkCreate.jsx');
  assert.match(create, /openRecord/);
  assert.match(create, /needs_changes/);
  assert.match(create, /withdrawn/);
  assert.match(create, /Withdraw/);
  assert.match(create, /Back to contributions/);
  assert.match(create, /Confirm delete/);
  assert.match(create, /reviewNote/);
  assert.doesNotMatch(create, /coverPreview && !form\.id/);
  assert.match(create, /validateCreateSubmit/);
  const model = read('../src/sampark/createModel.js');
  assert.match(model, /coverRequired && !hasCover/);
  const api = read('../src/news-scrapper/api.js');
  assert.match(api, /getOwnedContribution/);
  assert.match(api, /withdrawContribution/);
  assert.match(api, /reviewNote/);
});

test('WS2 review shows full submission and requires Send Back note', ()=>{
  const review = read('../src/sampark/SamparkReview.jsx');
  assert.match(review, /Full submission/);
  assert.match(review, /What should change/);
  assert.match(review, /rowErrors/);
  assert.match(review, /busyIds/);
  assert.doesNotMatch(review, /slice\(0,180\)/);
});

test('WS2 published projection keeps body separate and lists announcements', ()=>{
  const samsung = read('../src/sampark/SamparkSamsungNews.jsx');
  assert.match(samsung, /announcements/);
  assert.match(samsung, /Announcements/);
  assert.match(samsung, /body: r\.body/);
  assert.match(samsung, /findPublishedFocusRecord/);
  assert.match(samsung, /focus/);
  assert.doesNotMatch(samsung, /summary: r\.summary \|\| r\.body/);
  const dossier = read('../src/sampark/shared/SamparkArticleDossier.jsx');
  assert.match(dossier, /Full article/);
});

test('WS2 Sampark notification bell deep-links records', ()=>{
  const bell = read('../src/sampark/shared/SamparkNotificationBell.jsx');
  assert.match(bell, /getInternalNotifications/);
  assert.match(bell, /markInternalNotificationsRead/);
  assert.match(bell, /notificationDestination/);
  const model = read('../src/sampark/shared/notificationModel.js');
  assert.match(model, /\/create\?open=/);
  assert.match(model, /\/samsung-news\?focus=/);
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /SamparkNotificationBell/);
  const create = read('../src/sampark/SamparkCreate.jsx');
  assert.match(create, /\?open=/);
});

test('WS9 sources use stable keys and paginate', ()=>{
  const sources = read('../src/sampark/SamparkSources.jsx');
  assert.match(sources, /sourceKey/);
  assert.match(sources, /Show more/);
  assert.match(sources, /Showing .* of .* matching/);
  assert.match(sources, /noreferrer noopener/);
  assert.doesNotMatch(sources, /slice\(0,100\)\.map/);
  assert.doesNotMatch(sources, /key=\{s\.domain/);
});

test('WS12 session truthfulness and access records', ()=>{
  const auth = read('../src/sampark/auth/SamparkAuthContext.jsx');
  assert.match(auth, /privilegedSessionActive/);
  assert.match(auth, /sessionRole/);
  assert.doesNotMatch(auth, /isPrivileged: capabilities\.length/);
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /privilegedSessionActive/);
  const access = read('../src/sampark/SamparkAccess.jsx');
  assert.match(access, /Viewer:/);
  assert.match(access, /Network access/);
  assert.match(access, /Save/);
  const settings = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(settings, /Per-section save status|settings-section-status/);
  const router = read('../../news_scrapper/access_control/router.py');
  assert.match(router, /privileged_session_active/);
  assert.match(router, /session_role/);
});

test('WS13 research models partial failure without mutation', ()=>{
  const research = read('../src/sampark/SamparkResearch.jsx');
  assert.match(research, /discoveryError/);
  assert.match(research, /intelligenceError/);
  assert.match(research, /Retry intelligence/);
  assert.match(research, /Research Intelligence/);
  assert.doesNotMatch(research, /r\.kind = 'technology'/);
  assert.match(research, /location\.pathname/);
  const overview = read('../src/sampark/research/ResearchOverview.jsx');
  assert.match(overview, /intelligenceError/);
});

test('WS14 gatekeeper paginates without shell flash', ()=>{
  const gate = read('../src/sampark/SamparkGatekeeper.jsx');
  assert.match(gate, /Show more/);
  assert.match(gate, /Showing .* of .* matching/);
  assert.match(gate, /Refreshing/);
  assert.match(gate, /rowBusy/);
  assert.match(gate, /Apply/);
  assert.match(gate, /restorationActive/);
  assert.match(gate, /createGatekeeperLoader/);
  assert.match(gate, /loaderRef/);
  assert.match(read('../src/sampark/gatekeeperModel.js'), /pageRequest/);
  assert.match(gate, /appliedSearch/);
  assert.match(gate, /fetchQueue: \(params\) => getGatekeeperQueue\(params\)/);
  assert.match(gate, /setScope/);
  assert.match(gate, /decodedRowText/);
  assert.doesNotMatch(gate, /slice\(0,50\)\.map/);
  assert.doesNotMatch(gate, /d\.stage==='queued'/);
});

test('WS10 narrow layout and WS18 theme tokens', ()=>{
  const css = read('../src/sampark/sampark.css');
  assert.match(css, /\.sr-only/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /max-width: 560px/);
  assert.match(css, /sampark-voc-grid/);
  const theme = read('../src/sampark/theme.js');
  assert.match(theme, /sampark-theme/);
  const modal = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(modal, /Theme/);
  const voc = read('../src/sampark/SamparkVoc.jsx');
  assert.match(voc, /fetchWithTimeout/);
  assert.match(voc, /timed out/);
});

test('WS11 motion pauses on focus hidden and reduced motion', ()=>{
  const carousel = read('../src/sampark/all-news/FeaturedCarousel.jsx');
  assert.match(carousel, /prefers-reduced-motion/);
  assert.match(carousel, /onFocus/);
  assert.match(carousel, /visibility/);
  assert.match(carousel, /Pause autoplay/);
  assert.match(carousel, /objectPosition/);
  const rail = read('../src/sampark/all-news/AllNewsRail.jsx');
  assert.match(rail, /IntersectionObserver/);
  assert.match(rail, /prefers-reduced-motion/);
  assert.match(rail, /visibilitychange/);
});

test('WS7 search workspace keeps privacy near controls and stays in Search', ()=>{
  const search = read('../src/sampark/SamparkSearchResults.jsx');
  assert.match(search, /Loading search preferences/);
  assert.match(search, /Enter a search query above/);
  assert.match(search, /needs a query/);
  assert.match(search, /Updating results/);
  assert.match(search, /Manage Settings/);
  assert.match(search, /getArchiveArticle/);
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /path="\/search" element=\{<SamparkSearchResults/);
});

test('WS8 For You requests the compact feed', ()=>{
  const api = read('../src/news-scrapper/api.js');
  assert.match(api, /include_sections/);
  const router = read('../../news_scrapper/recommendation/router.py');
  assert.match(router, /include_sections/);
  assert.match(router, /full_contents/);
});

test('WS5 signed viewer owns For You names and migration', ()=>{
  const router = read('../../news_scrapper/recommendation/router.py');
  assert.match(router, /get_signed_viewer_display_name/);
  assert.match(router, /get_signed_migration_source/);
  assert.doesNotMatch(router, /viewer = legacy\.get_viewer_profile\(legacy\.get_client_ip/);
  const appPy = read('../../news_scrapper/application.py');
  assert.match(appPy, /def get_signed_viewer_display_name/);
  assert.match(appPy, /def get_signed_migration_source/);
});

test('WS16 tooltip preserves labels and cards use it', ()=>{
  const tooltip = read('../src/sampark/shared/SamparkTooltip.jsx');
  assert.match(tooltip, /isValidElement/);
  const card = read('../src/sampark/all-news/NewsCard.jsx');
  assert.match(card, /SamparkTooltip label/);
  const dossier = read('../src/sampark/shared/SamparkArticleDossier.jsx');
  assert.match(dossier, /aria-label="Close dossier"/);
});

test('WS20 day rendering progresses without hiding filters', ()=>{
  const daywise = read('../src/sampark/all-news/DayWiseNews.jsx');
  assert.match(daywise, /Show older days/);
  assert.match(daywise, /visibleDays/);
});

test('Settings exits restore the opening theme and report session truth', ()=>{
  const modal = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(modal, /cancelWithoutSave/);
  assert.match(modal, /openingTheme/);
  assert.match(modal, /applySamparkTheme\(openingTheme\)/);
  assert.match(modal, /privilegedSessionActive/);
  assert.match(modal, /sessionRole/);
  assert.doesNotMatch(modal, /Boolean\(capabilities\?\.length\)/);
  const auth = read('../src/sampark/auth/SamparkAuthContext.jsx');
  assert.match(auth, /privilegedSessionActive/);
  const access = read('../src/sampark/SamparkAccess.jsx');
  assert.match(access, /never listed here/);
  assert.match(access, /right away/);
  assert.match(access, /onAccessChanged/);
});

test('Create header stacks on narrow screens without redesigning desktop', ()=>{
  const css = read('../src/sampark/sampark.css');
  assert.match(css, /sampark-create-header > div:first-child/);
  assert.match(css, /max-width: 560px/);
  assert.match(css, /flex-direction: column/);
});

test('Search shell clear stays in Search via shared targets', ()=>{
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /searchClearTarget/);
  assert.match(app, /searchSubmitTarget/);
  const nav = read('../src/sampark/searchNav.js');
  assert.match(nav, /pathname === '\/search'/);
});

test('Samsung focus explains unresolvable items after loading', ()=>{
  const samsung = read('../src/sampark/SamparkSamsungNews.jsx');
  assert.match(samsung, /focusMissed/);
  assert.match(samsung, /no longer published or is unavailable/);
  assert.match(samsung, /Return to Samsung News/);
  assert.match(samsung, /handledFocusRef/);
  assert.match(samsung, /findPublishedFocusRecord/);
});
