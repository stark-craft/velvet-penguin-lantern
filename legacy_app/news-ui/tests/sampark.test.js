import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Sampark remains an independent light-only frontend entry', () => {
  const entry = read('../src/sampark/main.jsx');
  assert.match(read('../vite.config.js'), /sampark\/index\.html/);
  assert.match(entry, /basename="\/sampark"/);
  assert.match(entry, /dataset\.theme = 'light'/);
  assert.doesNotMatch(read('../src/main.jsx'), /sampark/);
  assert.doesNotMatch(entry, /GuidePetProvider|ui-polish|index\.css/);
  assert.match(read('../sampark/index.html'), /data-theme="light"/);
});

test('Sampark first milestone contains only the signed-off structural shell', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /techscout-header/);
  assert.match(app, /Search Technologies News/);
  assert.match(app, /Your Personalized Technology briefing/);
  assert.match(app, /main-card-container/);
  assert.match(app, /For You/);
  assert.match(app, /All News/);
  assert.match(app, /Research/);
  assert.match(app, /Samsung News/);
  assert.match(app, /Briefing Stream/);
  assert.match(app, /SRI-D/);
  assert.doesNotMatch(app, /sampark-header|sampark-nav/);
});

test('Sampark shell mounts only allowed Search/Settings integrations and viewer APIs, not original presentation components', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /SamparkSearchResults/);
  assert.match(app, /SamparkSettingsModal/);
  assert.match(app, /SamparkForYou/);
  assert.match(app, /getViewerProfile/);
  assert.match(app, /getAccessCapabilities/);
  assert.match(app, /getRecommendationStatus/);
  assert.match(app, /useLanguage/);
  assert.match(app, /searchExtractedIntelligence|readSamparkSettings/);
  assert.doesNotMatch(app, /ForYouScreen|FeedScreen|SamsungNewsScreen|ArchiveSearchScreen/);
  assert.doesNotMatch(app, /SamparkForYouView|SamparkBriefingView/);
  assert.doesNotMatch(app, /UserProfileModal|ArticleModal|Dossier/);
  assert.doesNotMatch(app, /TopBar|theme-toggle|setTheme/);
  assert.doesNotMatch(app, /fetch\(|https?:\/\//);
  assert.match(app, /shell-region-space/);
  assert.match(read('../src/sampark/SamparkSearchResults.jsx'), /searchExtractedIntelligence/);
  assert.match(read('../src/sampark/SamparkSearchResults.jsx'), /groupedByDate/);
  assert.match(read('../src/sampark/SamparkSettingsModal.jsx'), /updateViewerProfile|pauseViewerPersonalization/);
});

test('Sampark For You uses real recommendation APIs and Sampark-native presentation', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /SamparkForYou/);
  assert.doesNotMatch(app, /ForYouScreen/);
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /getForYou/);
  assert.match(forYou, /getViewerPreferences/);
  assert.match(forYou, /getRecommendationStatus/);
  assert.match(forYou, /getViewerSaved/);
  assert.match(forYou, /getViewerReactions/);
  assert.match(forYou, /hideArticleForViewer|saveArticleForLater|removeSavedArticle|setViewerReaction/);
  assert.match(forYou, /completeViewerPreferences/);
  assert.match(forYou, /articleKey|reactionIdentity/);
  assert.match(forYou, /normalizeList/);
  assert.match(forYou, /sampark-preferences-bar|sampark-metrics-grid|sampark-foryou-grid|sampark-news-card/);
  assert.match(forYou, /SamparkPreferencesModal|SamparkArticleModal|SamparkForYouCard/);
  assert.match(forYou, /sampark-card-media|sampark-card-img/);
  assert.match(forYou, /object-fit:\s*contain|sampark-dossier-img/);
  assert.doesNotMatch(forYou, /ForYouScreen|presentation="sampark"/);
  assert.doesNotMatch(forYou, /fetch\(|https?:\/\/|127\.0\.0\.1/);
  assert.match(read('../src/sampark/sampark.css'), /sampark-for-you-page|sampark-foryou-grid|sampark-metrics-grid/);
  assert.match(read('../src/sampark/sampark.css'), /object-fit:\s*contain/);
  assert.match(forYou, /SamparkArticleModal[\s\S]*why_matters|why_it_matters|summary_points/);
});

test('Sampark For You featured layout is five-card composition and feed beyond five is preserved with pagination', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  const css = read('../src/sampark/sampark.css');
  // Five is a layout number for the first composition
  assert.match(forYou, /featured\s*=\s*items\.slice\(0,\s*5\)/);
  assert.match(forYou, /remaining\s*=\s*items\.slice\(5\)/);
  // No hard cap that discards beyond five
  assert.doesNotMatch(forYou, /items\.slice\(0,\s*[45]\)[\s\S]*return[\s\S]*stories\.length.*only 5/i);
  assert.match(forYou, /sampark-foryou-grid/);
  assert.match(forYou, /sampark-news-card-small-grid/);
  assert.match(css, /sampark-foryou-grid[\s\S]*1\.32fr 1fr|sampark-news-card-small-grid[\s\S]*repeat\(2/);
  // Remaining feed is rendered and pagination is preserved
  assert.match(forYou, /sampark-for-you-remaining|sampark-for-you-more-grid/);
  assert.match(forYou, /feed\?.cursor|loadMore|getForYou\(\{ cursor/);
  assert.match(forYou, /Load more|feed\.total/);
  // Image no-crop contract
  assert.match(css, /\.sampark-card-img[\s\S]*object-fit:\s*contain/);
  assert.match(css, /\.sampark-dossier-img[\s\S]*object-fit:\s*contain/);
  assert.doesNotMatch(css, /\.sampark-card-img[\s\S]*object-fit:\s*cover/);
});

test('Sampark preferences wizard is three-step and Skip preserves automatic personalization', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /01.*Intelligence beats|What deserves your attention/);
  assert.match(forYou, /02.*Work outcomes|What makes a signal useful/);
  assert.match(forYou, /03.*Evidence mix|Where should your signal come from/);
  assert.match(forYou, /topics.*3.*5|minimum.*3.*maximum.*5/);
  assert.match(forYou, /source_families/);
  assert.match(forYou, /Skip.*starter mix|handleSkip|Use a balanced starter mix/);
  assert.match(forYou, /completeViewerPreferences/);
  assert.match(forYou, /sampark-prefs-progress|sampark-prefs-chip|sampark-prefs-wizard/);
});

test('Sampark preferences modal respects Rules of Hooks', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  // useMemo must appear before early return in SamparkPreferencesModal
  const modalSection = forYou.slice(forYou.indexOf('function SamparkPreferencesModal'));
  const memoIndex = modalSection.indexOf('useMemo');
  const returnIndex = modalSection.indexOf('if (!open) return null');
  assert.ok(memoIndex !== -1 && returnIndex !== -1 && memoIndex < returnIndex, 'useMemo must be before early return');
});

test('Sampark Following is within For You and uses real persisted threads', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /getFollowingThreads/);
  assert.match(forYou, /SamparkFollowingModal/);
  assert.match(forYou, /sampark-following-modal|sampark-thread/);
  assert.match(forYou, /Following.*savedKeys\.size|Following.*pill/);
  assert.match(forYou, /removeSavedArticle/);
  assert.doesNotMatch(read('../src/sampark/SamparkApp.jsx'), /FollowingScreen|getFollowingThreads/);
  assert.doesNotMatch(forYou, /fetch\(|localStorage.*following/i);
  assert.match(read('../src/sampark/sampark.css'), /sampark-following-modal|sampark-thread/);
});

test('Sampark viewing behavior feeds existing recommendation learning pipeline', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /useRecommendationEvents/);
  assert.match(forYou, /record\('dossier_open'/);
  assert.match(forYou, /record\('dossier_dwell'/);
  assert.match(forYou, />=\s*5000/);
  assert.match(forYou, /record\('source_open'/);
  assert.match(forYou, /record\('why_this_story_open'/);
  assert.match(forYou, /record\(.*hide/);
  assert.doesNotMatch(forYou, /record\(.*\bsave\b.*\)/);
  assert.doesNotMatch(forYou, /record\(.*unsave/);
  assert.match(forYou, /saveArticleForLater|removeSavedArticle/);
  assert.match(forYou, /flush\(\)|flush\(\{ keepalive/);
  assert.doesNotMatch(forYou, /second.*event.*pipeline|custom.*recommendation/i);
  assert.match(forYou, /feed\?\.feed_request_id/);
  assert.match(forYou, /useRecommendationEvents\(/);
});

test('Viewer/browser identity is cookie-primary and same-IP browsers remain isolated', () => {
  const identity = read('../../news_scrapper/recommendation/identity.py');
  assert.match(identity, /COOKIE_NAME.*techscout_viewer/);
  assert.match(identity, /def viewer_key/);
  assert.match(identity, /hmac/);
  assert.match(identity, /bind_viewer_request/);
  const hiddenApp = read('../../news_scrapper/application.py');
  assert.match(hiddenApp, /def get_viewer_hidden_items[\s\S]*claim_legacy_private_bucket/);
  assert.match(hiddenApp, /hide_for_current_viewer[\s\S]*claim_legacy_private_bucket/);
  assert.match(hiddenApp, /get_private_viewer_key/);
  // Ensure the hidden getter no longer directly uses IP hash without claim
  const hiddenSnippet = hiddenApp.slice(hiddenApp.indexOf('def get_viewer_hidden_items'), hiddenApp.indexOf('def get_viewer_hidden_items') + 500);
  assert.doesNotMatch(hiddenSnippet, /viewer_key = get_viewer_key\(get_client_ip/);
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.doesNotMatch(forYou, /get_client_ip|fingerprint.*primary.*viewer_key/i);
});

test('Sampark header, auth and settings remain standalone and SSO-ready without portal chrome', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /techscout-header/);
  assert.match(app, /sampark-user-menu|sampark-user-trigger/);
  assert.match(app, /SamparkLogin/);
  assert.match(app, /path="\/login"/);
  assert.match(app, /Search Technologies News/);
  assert.match(app, /lang-btn/);
  assert.doesNotMatch(app, /sampark-header|sampark-nav/);
  assert.match(app, /create-news-btn/);
  assert.doesNotMatch(app, /Create News.*workflow|contribution.*create.*modal/i);
  const login = read('../src/sampark/SamparkLogin.jsx');
  assert.match(login, /useSamparkAuth|login\(role/);
  assert.match(login, /Access TechScout|Samsung Sampark SSO will be used/);
  assert.doesNotMatch(login, /localStorage.*key|localStorage.*token/i);
  assert.doesNotMatch(login, /\?user=|X-User-ID/);
  const auth = read('../src/sampark/auth/SamparkAuthContext.jsx');
  assert.match(auth, /getAccessCapabilities|getViewerProfile|unlockCapabilitySession|logoutCapabilitySession/);
  assert.match(auth, /ssoMode.*false|samparkPrincipal/);
  assert.match(auth, /useSamparkAuth/);
  const settings = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(settings, /updateViewerProfile/);
  assert.match(settings, /pauseViewerPersonalization/);
  assert.match(settings, /SAMPARK_SETTINGS_KEY/);
  assert.doesNotMatch(settings, /fetch\(.*\/access-control.*key.*localStorage/i);
  const handoff = read('../../SAMPARK_SSO_INTEGRATION.md');
  assert.match(handoff, /Current State/);
  assert.match(handoff, /Final Sampark Goal/);
  assert.match(handoff, /TBD/);
  assert.match(handoff, /Integration Boundary/);
  assert.match(handoff, /Security Requirements/);
  assert.match(handoff, /Never trust.*frontend/i);
});

test('Sampark structural routes stay inside the separate entry', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  for (const route of ['/for-you', '/all-news', '/research', '/samsung-news']) {
    assert.match(app, new RegExp(`path="${route}"`));
  }
  assert.match(app, /path="\/search"/);
  assert.match(app, /Navigate replace to="\/for-you"/);
  assert.match(app, /Navigate replace to="\/all-news"/);
  assert.match(app, /Navigate replace to="\/samsung-news"/);
});

test('Original NewsScrapper screens remain presentation-agnostic and Sampark owns its presentation', () => {
  assert.doesNotMatch(read('../src/news-scrapper/for-you/ForYouScreen.jsx'), /presentation.*sampark|SamparkForYouView/);
  assert.doesNotMatch(read('../src/news-scrapper/screens/FeedScreen.jsx'), /presentation.*sampark|SamparkBriefingView/);
  assert.doesNotMatch(read('../src/sampark/SamparkApp.jsx'), /presentation="sampark"/);
});

test('Sampark secondary workspaces are Sampark-native under /sampark with real APIs and no old UI leakage', () => {
  const app = read('../src/sampark/SamparkApp.jsx');
  for (const route of ['/following', '/hidden', '/history', '/voc', '/review', '/approved', '/gatekeeper', '/sources', '/scheduler', '/analytics', '/access']) {
    assert.match(app, new RegExp(`path="${route}"`));
  }
  assert.match(app, /SamparkFollowing|SamparkHidden|SamparkHistory|SamparkVoc/);
  assert.match(app, /SamparkReview|SamparkApproved|SamparkGatekeeper/);
  assert.doesNotMatch(app, /href="\/rejected"|href="\/history"|href="\/voc"[^"]/);
  const settings = read('../src/sampark/SamparkSettingsModal.jsx');
  assert.match(settings, /href="\/sampark\/following/);
  assert.match(settings, /href="\/sampark\/hidden/);
  assert.doesNotMatch(settings, /href="\/rejected"/);
  const following = read('../src/sampark/SamparkFollowing.jsx');
  assert.match(following, /getFollowingThreads/);
  assert.doesNotMatch(following, /ForYouScreen|FeedScreen/);
  const hidden = read('../src/sampark/SamparkHidden.jsx');
  assert.match(hidden, /getViewerHidden|restoreArticleForViewer/);
  const history = read('../src/sampark/SamparkHistory.jsx');
  assert.match(history, /getHistoryList/);
  const voc = read('../src/sampark/SamparkVoc.jsx');
  assert.match(voc, /Voice of Customer|getTrendsAccess|\/voc/);
  const shell = read('../src/sampark/shared/SamparkWorkspaceShell.jsx');
  assert.match(shell, /WorkspaceHeader|WorkspaceEmpty|WorkspaceLoading/);
  const css = read('../src/sampark/sampark.css');
  assert.match(css, /sampark-workspace/);
  const doc = read('../../SAMPARK_WORKSPACES.md');
  assert.match(doc, /Saved & Following[\s\S]*\/sampark\/following/);
});

test('Sampark fresh viewer onboarding, search isolation, privacy and persistent activity', () => {
  const forYou = read('../src/sampark/SamparkForYou.jsx');
  assert.match(forYou, /completed_at[\s\S]*setPrefsOpen/);
  assert.match(forYou, /getViewerActivitySummary/);
  assert.match(forYou, /loadActivity/);
  assert.match(forYou, /shouldRecordPassive/);
  const app = read('../src/sampark/SamparkApp.jsx');
  assert.match(app, /getNamespacedHistoryKey/);
  assert.match(app, /readSearchHistoryForViewer/);
  assert.match(app, /SEARCH_HISTORY_KEY/);
  const api = read('../src/news-scrapper/api.js');
  assert.match(api, /getViewerActivitySummary/);
  const router = read('../../news_scrapper/recommendation/router.py');
  assert.match(router, /def activity_summary/);
  assert.match(router, /_validated_timezone/);
  assert.match(router, /news_read/);
  assert.match(router, /likes/);
  assert.match(forYou, /activity\.news_read\.today/);
});
