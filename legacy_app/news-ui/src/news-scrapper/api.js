// Thin API wrappers. In dev, vite proxies these paths to the backend.
import { getFingerprint, getSessionId } from './utils/session.js';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
} from '../shared/api/requestTimeout.js';

// Always use same-origin API paths. Vite proxies these paths during local
// development, while the production bundle is served by the same FastAPI app
// that owns the endpoints. Baking localhost or a machine name into the bundle
// would make a copied Windows build call the viewer's own PC instead.
const BASE = '';
const GET_CACHE = new Map();
const GET_IN_FLIGHT = new Map();

function selectedProfileOverride() {
  if (typeof window === 'undefined') return '';
  const developerSwitcherEnabled = import.meta.env.DEV
    && String(import.meta.env.VITE_ENABLE_PROFILE_SWITCHER || '').toLowerCase() === 'true';
  if (!developerSwitcherEnabled) return '';
  const value = localStorage.getItem('news-profile-override');
  return value === 'broadcast' || value === 'default' ? value : '';
}

async function jsonFetch(url, opts = {}) {
  const profileOverride = selectedProfileOverride();
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = opts;
  const res = await fetchWithTimeout(BASE + url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(profileOverride ? { 'X-Sense-Profile': profileOverride } : {}),
      ...(fetchOptions.headers || {}),
    },
  }, timeoutMs);
  const body = await readApiResponse(res);
  if (String(fetchOptions.method || 'GET').toUpperCase() !== 'GET') {
    GET_CACHE.clear();
  }
  return body;
}

function abortableSharedPromise(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Request aborted', 'AbortError')), { once: true });
    }),
  ]);
}

/**
 * Tiny same-origin stale-while-revalidate cache for read-heavy product data.
 * Shared in-flight promises deduplicate route switches. A caller can stop
 * waiting with AbortController without cancelling another screen's request.
 */
async function cachedJsonFetch(url, { staleMs = 30_000, maxStaleMs = 5 * 60_000, signal } = {}) {
  const now = Date.now();
  const cached = GET_CACHE.get(url);
  const age = cached ? now - cached.savedAt : Number.POSITIVE_INFINITY;
  if (cached && age <= staleMs) return cached.data;

  const refresh = () => {
    if (GET_IN_FLIGHT.has(url)) return GET_IN_FLIGHT.get(url);
    const request = jsonFetch(url)
      .then((data) => {
        GET_CACHE.set(url, { data, savedAt: Date.now() });
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sense-api-cache-update', { detail: { url, data } }));
        }
        return data;
      })
      .finally(() => GET_IN_FLIGHT.delete(url));
    GET_IN_FLIGHT.set(url, request);
    return request;
  };

  if (cached && age <= maxStaleMs) {
    // A background refresh cannot update React consumers by itself. Await the
    // shared fresh read so mounted routes converge, but keep the last known
    // value as the resilient fallback when the refresh fails.
    return abortableSharedPromise(refresh().catch(() => cached.data), signal);
  }
  return abortableSharedPromise(refresh(), signal);
}

// Same-origin multipart upload. The browser supplies the Content-Type with its
// form boundary; adding one manually would break the request.
async function uploadFetch(url, formData, method = 'POST') {
  const profileOverride = selectedProfileOverride();
  const res = await fetchWithTimeout(BASE + url, {
    method,
    headers: profileOverride ? { 'X-Sense-Profile': profileOverride } : undefined,
    body: formData,
  }, UPLOAD_REQUEST_TIMEOUT_MS);
  return readApiResponse(res);
}

async function readApiResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');
  if (!res.ok || (body && typeof body === 'object' && body.status === 'error')) {
    const rawDetail = body && typeof body === 'object'
      ? body.detail || body.message || ''
      : body;
    const detail = rawDetail && typeof rawDetail === 'object'
      ? rawDetail.message || rawDetail.cause || ''
      : rawDetail;
    const error = new Error(detail || `${res.status} ${res.statusText}`);
    error.status = res.status;
    error.payload = body;
    if (rawDetail && typeof rawDetail === 'object') {
      error.operation = rawDetail.operation;
      error.operationState = rawDetail.state;
      error.recoverable = Boolean(rawDetail.recoverable);
    }
    throw error;
  }
  return body;
}

function normalizeKeywordsForApi(keywords) {
  if (Array.isArray(keywords)) {
    return keywords.map(String).map((k) => k.trim()).filter(Boolean);
  }

  return String(keywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

// ---------- Briefing / feed ----------
export const getLatestBriefing = () => cachedJsonFetch('/latest-briefing', { staleMs: 30_000 });
export const getSharedBriefing = () => cachedJsonFetch('/briefing/shared/latest', { staleMs: 30_000 });
export const getSamsungInternalFeed = (limit = 100) =>
  cachedJsonFetch(`/internal-content/samsung-feed?limit=${Math.max(1, Math.min(Number(limit) || 100, 100))}`, { staleMs: 60_000 });
export const getBriefingMeta   = () => cachedJsonFetch('/briefing/meta', { staleMs: 30_000 });
export const removeFromBriefing  = (title)   => jsonFetch('/briefing/remove',  { method:'POST', body: JSON.stringify({ title }) });
export const restoreToBriefing   = (article) => jsonFetch('/briefing/restore', { method:'POST', body: JSON.stringify({ article }) });
export const getInsight = (article) => jsonFetch('/insight', { method:'POST', body: JSON.stringify(article) });

// ---------- Per-browser English -> Korean translation ----------
export const getKoreanTranslationStatus = () => jsonFetch('/translation/status');
export const warmupKoreanTranslation = () =>
  jsonFetch('/translation/warmup', { method: 'POST' });
export const translateToKorean = (texts) =>
  jsonFetch('/translation/korean', {
    method: 'POST',
    body: JSON.stringify({
      texts: Array.isArray(texts) ? texts : [String(texts || '')],
      source_language: 'en',
      target_language: 'ko',
    }),
  });

// ---------- Read-only extracted intelligence search ----------
export function searchExtractedIntelligence(params, signal) {
  const u = new URLSearchParams();
  if (params.query)        u.set('query', params.query);
  if (params.from_date)    u.set('from_date', params.from_date);
  if (params.to_date)      u.set('to_date', params.to_date);
  if (params.target_sites) u.set('target_sites', params.target_sites);
  if (params.limit)        u.set('limit', String(params.limit));
  return jsonFetch(`/archive/search?${u.toString()}`, { signal });
}

// ---------- Train / votes ----------
export const trainVote = (keywords, summary, vote, title = '') =>
  jsonFetch('/train', {
    method: 'POST',
    body: JSON.stringify({
      keywords: normalizeKeywordsForApi(keywords),
      summary: String(summary || title || '').trim(),
      vote: vote === 'up' ? 'interested' : vote,
      title: String(title || '').trim(),
    }),
  });
export const correctRegion = (article, region, keywords, reason) =>
  jsonFetch('/region/correct', {
    method: 'POST',
    body: JSON.stringify({
      title: article.title,
      previous_region: article.region || 'Global',
      region,
      keywords,
      reason,
    }),
  });

// ---------- Not interested ----------
export const getNotInterested  = () => jsonFetch('/not-interested');
export const markNotInterested = (article) =>
  jsonFetch('/not-interested', { method:'POST', body: JSON.stringify(article) });
export const restoreNotInterested = (title) =>
  jsonFetch('/not-interested/restore', { method:'POST', body: JSON.stringify({ title }) });

// The backend commits the global Not Interested decision and shared briefing
// mutation as one recoverable operation. Never recreate the old two-request
// sequence here: it could leave the two JSON stores disagreeing.
export async function rejectArticle(article) {
  return markNotInterested(article);
}
export async function unrejectArticle(article) {
  return restoreNotInterested(article.title);
}

// ---------- Personal hidden signals ----------
// Hidden signals retain their legacy viewer/IP-hash scope. They never train
// the bouncer and never remove an article from another user's feed. Saved
// Signals and private URL briefings below use the signed browser identity.
export const getViewerHidden = () => jsonFetch('/viewer/hidden');
export const hideArticleForViewer = (article) =>
  jsonFetch('/viewer/hidden', { method:'POST', body: JSON.stringify(article) });
export const restoreArticleForViewer = (article) =>
  jsonFetch('/viewer/hidden/restore', { method:'POST', body: JSON.stringify(article) });

// ---------- Personal saved-for-later signals ----------
export const getViewerSaved = () => jsonFetch('/viewer/saved');
export const saveArticleForLater = async (article) =>
  jsonFetch('/viewer/saved', {
    method:'POST',
    body: JSON.stringify({ ...article, _tracking_fingerprint: await getFingerprint() }),
  });
export const removeSavedArticle = async (article) =>
  jsonFetch('/viewer/saved/remove', {
    method:'POST',
    body: JSON.stringify({ ...article, _tracking_fingerprint: await getFingerprint() }),
  });

// ---------- Personal URL briefings ----------
export const getViewerBriefings = () => jsonFetch('/viewer/briefings');
export const createViewerBriefings = async (urls) =>
  jsonFetch('/viewer/briefings', {
    method: 'POST',
    body: JSON.stringify({
      urls,
      _tracking_fingerprint: await getFingerprint(),
    }),
  });
export const retryViewerBriefing = (jobId) =>
  jsonFetch(`/viewer/briefings/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });
export const clearViewerBriefings = async (scope = 'finished') =>
  jsonFetch('/viewer/briefings/clear', {
    method: 'POST',
    body: JSON.stringify({
      scope,
      _tracking_fingerprint: await getFingerprint(),
    }),
  });

// ---------- Private viewer personalization ----------
export const getViewerPersonalization = () => jsonFetch('/viewer/personalization');
export const resetViewerPersonalization = () =>
  jsonFetch('/viewer/personalization/reset', { method: 'POST' });

// ---------- Explainable For You ----------
export const getRecommendationStatus = () => cachedJsonFetch('/viewer/recommendation-status', { staleMs: 60_000 });
export const getViewerPreferences = () => jsonFetch('/viewer/preferences');
export const updateViewerPreferences = (preferences) =>
  jsonFetch('/viewer/preferences', { method: 'PUT', body: JSON.stringify(preferences) });
export const completeViewerPreferences = (preferences) =>
  jsonFetch('/viewer/preferences/complete', { method: 'POST', body: JSON.stringify(preferences) });
export const confirmViewerMigration = (confirmed = true) =>
  jsonFetch('/viewer/preferences/migrate', {
    method: 'POST',
    body: JSON.stringify({ confirmed: Boolean(confirmed) }),
  });
export const pauseViewerPersonalization = (paused) =>
  jsonFetch('/viewer/preferences/pause', { method: 'POST', body: JSON.stringify({ paused }) });
export const resetRecommendationProfile = () =>
  jsonFetch('/viewer/preferences/reset', { method: 'POST' });
export function getForYou({ cursor = '', limit = 20 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  // Keep the JSON request under /viewer so Vite can proxy it without taking
  // ownership of the browser's /for-you SPA deep link. The backend retains
  // GET /for-you as a documented API alias for non-browser clients.
  return jsonFetch(`/viewer/for-you?${params.toString()}`);
}
export const sendRecommendationEvents = (feedRequestId, events, options = {}) =>
  jsonFetch('/viewer/recommendation-events', {
    method: 'POST',
    body: JSON.stringify({ feed_request_id: feedRequestId || '', events }),
    ...options,
  });
export const setViewerReaction = (article, reaction) =>
  jsonFetch('/viewer/reactions', {
    method: 'PUT',
    body: JSON.stringify({ article, reaction }),
  });
export async function getViewerReactions(articleIds = []) {
  const unique = [...new Set(articleIds.filter(Boolean).map(String))];
  if (!unique.length) return { status: 'success', reactions: {} };
  const batches = [];
  for (let index = 0; index < unique.length; index += 200) {
    batches.push(jsonFetch('/viewer/reactions/query', {
      method: 'POST',
      body: JSON.stringify({ article_ids: unique.slice(index, index + 200) }),
    }));
  }
  const responses = await Promise.all(batches);
  return {
    status: 'success',
    reactions: Object.assign({}, ...responses.map((response) => response?.reactions || {})),
  };
}
export const getFollowingThreads = () => jsonFetch('/viewer/following');

// ---------- Workflow ----------
export const getWorkflow = () => jsonFetch('/workflow');
export const selectWorkflow = (article) =>
  jsonFetch('/workflow/select', { method:'POST', body: JSON.stringify(article) });
export const importWorkflow = async (items) =>
  jsonFetch('/workflow/import', {
    method: 'POST',
    body: JSON.stringify({
      items,
      _tracking_fingerprint: await getFingerprint(),
    }),
  });
export const approveWorkflow = (title, key='1357') =>
  jsonFetch('/workflow/approve', { method:'POST', body: JSON.stringify({ title, key }) });
export const removeWorkflow = (title, list_type) =>
  jsonFetch('/workflow/remove', { method:'POST', body: JSON.stringify({ title, list_type }) });

// ---------- Sources ----------
export const getSites = () => jsonFetch('/sites');
export const addSite  = (site) => jsonFetch('/sites', { method:'POST', body: JSON.stringify(site) });

// ---------- History ----------
export function getHistoryList() {
  const u = new URLSearchParams({ session_id: getSessionId() });
  return cachedJsonFetch('/history/list?' + u.toString(), { staleMs: 30_000 });
}

export function getHistoryFile(filename) {
  return jsonFetch('/history/' + encodeURIComponent(filename));
}

export function getHistoryRange(from_date, to_date) {
  const u = new URLSearchParams({ from_date, to_date, session_id: getSessionId() });
  return jsonFetch('/history/range?' + u.toString());
}

// ---------- Tracking ----------
export const trackEvent = (fingerprint, action, detail) =>
  jsonFetch('/track', { method:'POST', body: JSON.stringify({ fingerprint, action, detail }) });

// ---------- Status ----------
export const getStatus = () => cachedJsonFetch('/status', { staleMs: 10_000, maxStaleMs: 30_000 });
export const getProfile = () => jsonFetch('/profile');
export const getViewerProfile = () => cachedJsonFetch('/viewer/profile', { staleMs: 60_000 });
export const updateViewerProfile = (profile) =>
  jsonFetch('/viewer/profile', {
    method: 'POST',
    body: JSON.stringify({
      display_name: String(profile?.display_name || '').trim(),
      email: String(profile?.email || '').trim(),
    }),
  });

// ---------- Analytics ----------
export const getAnalyticsAccess = () => jsonFetch('/analytics/access');
export const getTrendsAccess = () => jsonFetch('/trends/access');
export const getAnalytics = (key) => {
  const normalized = String(key || '').trim();
  return jsonFetch(normalized ? `/analytics?${new URLSearchParams({ key: normalized }).toString()}` : '/analytics');
};
export const getRecommendationAnalytics = (key) => {
  const normalized = String(key || '').trim();
  return jsonFetch(normalized ? `/analytics/recommendation-summary?${new URLSearchParams({ key: normalized }).toString()}` : '/analytics/recommendation-summary');
};

// ---------- Gatekeeper Review ----------
function gatekeeperHeaders(key) {
  const normalizedKey = String(key || '').trim();
  return normalizedKey ? { 'X-Gatekeeper-Key': normalizedKey } : {};
}

// ---------- Internal contributions editorial review ----------
// The editor session lives in an HttpOnly cookie set by /review/unlock; page
// JavaScript never stores or sees the key.
export const getInternalReviewQueue = () => jsonFetch('/internal-content/review');

export const unlockInternalReview = (key) =>
  jsonFetch('/internal-content/review/unlock', {
    method: 'POST',
    body: JSON.stringify({ key: String(key || '') }),
  });

export const lockInternalReview = () =>
  jsonFetch('/internal-content/review/lock', { method: 'POST' });

export const publishInternalContent = (recordId) =>
  jsonFetch(`/internal-content/${recordId}/publish`, { method: 'POST' });

export const requestInternalContentChanges = (recordId, note) =>
  jsonFetch(`/internal-content/${recordId}/changes`, {
    method: 'POST',
    body: JSON.stringify({ note: String(note || '') }),
  });

export const rejectInternalContent = (recordId, note = '') =>
  jsonFetch(`/internal-content/${recordId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note: String(note || '') }),
  });

// Published notices are removed through the reversible archive transition.
// The permanent-delete endpoint is intentionally reserved for access admins.
export const archiveInternalContent = (recordId) =>
  jsonFetch(`/internal-content/${recordId}/archive`, { method: 'POST' });

export const getInternalNotifications = () => jsonFetch('/internal-content/notifications');

export const markInternalNotificationsRead = (ids) =>
  jsonFetch('/internal-content/notifications/read', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
  });

export const getGatekeeperAccess = () => jsonFetch('/gatekeeper/access');

// ---------- Capability authorization / operations ----------
export const getAccessCapabilities = () => jsonFetch('/access-control/capabilities');
export const unlockCapabilitySession = (role, key) => jsonFetch('/access-control/session/unlock', {
  method: 'POST',
  body: JSON.stringify({ role: String(role || ''), key: String(key || '') }),
});
export const logoutCapabilitySession = () => jsonFetch('/access-control/session/logout', { method: 'POST' });
export const getAccessPrincipals = () => jsonFetch('/access-control/principals');
export const updateAccessPrincipal = (principal, record) => jsonFetch(`/access-control/principals/${encodeURIComponent(principal)}`, {
  method: 'PUT',
  body: JSON.stringify(record || {}),
});
export const getAccessAudit = (limit = 200) => jsonFetch(`/access-control/audit?limit=${Math.max(1, Math.min(Number(limit) || 200, 1000))}`);
export const getSchedulerStatus = () => cachedJsonFetch('/scheduler/status', { staleMs: 10_000, maxStaleMs: 30_000 });
export const runSchedulerNow = () => jsonFetch('/scheduler/run', { method: 'POST' });

export function getGatekeeperDropped({
  key,
  profile = 'all',
  status = 'all',
  search = '',
  offset = 0,
  limit = 100,
} = {}) {
  const params = new URLSearchParams({
    profile: String(profile || 'all'),
    status: String(status || 'all'),
    search: String(search || ''),
    offset: String(offset || 0),
    limit: String(limit || 100),
  });
  return jsonFetch(`/gatekeeper/dropped?${params.toString()}`, {
    headers: gatekeeperHeaders(key),
  });
}

export function getGatekeeperQueue({ key, profile = 'all' } = {}) {
  const params = new URLSearchParams({ profile: String(profile || 'all') });
  return jsonFetch(`/gatekeeper/queue?${params.toString()}`, {
    headers: gatekeeperHeaders(key),
  });
}

export function queueGatekeeperRestore(droppedId, key) {
  return jsonFetch('/gatekeeper/restore', {
    method: 'POST',
    headers: gatekeeperHeaders(key),
    body: JSON.stringify({ id: String(droppedId || '').trim() }),
  });
}

export function retryGatekeeperRestore(droppedId, key) {
  return jsonFetch('/gatekeeper/retry', {
    method: 'POST',
    headers: gatekeeperHeaders(key),
    body: JSON.stringify({ id: String(droppedId || '').trim() }),
  });
}

// ---------- Exports (binary) ----------
function normalizeSourcesForExport(item) {
  const rawSources = item.sources || item.source_list || [];

  if (Array.isArray(rawSources) && rawSources.length) {
    return rawSources.map((source) => {
      if (typeof source === 'string') return { name: source };

      return {
        name: source.name || source.title || source.source || 'Unknown',
      };
    });
  }

  return [{ name: item.source || item.src || 'Unknown' }];
}

function normalizeExportItem(item, index = 0) {
  const title = String(item.title || `Untitled Signal ${index + 1}`).trim();

  const summary = String(
    item.master_summary ||
    item.summary ||
    item.ppt_summary ||
    item.snippet ||
    title
  ).trim();

  const link = String(
    item.link ||
    item.url ||
    item.source_url ||
    item.article_url ||
    '#'
  ).trim();

  const date = String(
    item.date ||
    item.published_at ||
    item.publishedAt ||
    item.first_seen ||
    new Date().toISOString().slice(0, 10)
  ).slice(0, 10);

  const image = (
    item.top_image ||
    item.image_url ||
    item.image ||
    item.thumbnail ||
    item.urlToImage ||
    ''
  );

  return {
    title,
    master_summary: summary,
    summary_lead: String(item.summary_lead || item.summary || summary).trim(),
    summary_points: Array.isArray(item.summary_points)
      ? item.summary_points.filter(Boolean).slice(0, 6)
      : [],
    ppt_summary: String(item.ppt_summary || summary).trim(),
    snippet: String(item.snippet || summary).trim(),
    date,
    link,
    top_image: image || null,
    sources: normalizeSourcesForExport(item),
    importance_score: Number(item.importance_score ?? item.score ?? item.signal_score ?? 50),
    keywords_found: normalizeKeywordsForApi(item.keywords_found || item.keywords || []),
    region: item.region || 'Global',
    full_contents: item.full_contents || item.full_content || '',
    selected_by: item.selected_by || null,
    category: item.category || 'Tech News',
    why_it_matters: item.why_it_matters || item.why_matters || '',
    article_intent: item.article_intent || '',
    summarized_by: item.summarized_by || '',
  };
}

async function exportBinary(path, items, filename) {
  const payloadItems = Array.isArray(items)
    ? items.map((item, index) => normalizeExportItem(item, index))
    : [];

  if (!payloadItems.length) {
    throw new Error('Export failed: no items selected');
  }

  const profileOverride = selectedProfileOverride();
  const res = await fetchWithTimeout(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(profileOverride ? { 'X-Sense-Profile': profileOverride } : {}),
    },
    body: JSON.stringify({
      items: payloadItems,
      filename,
    }),
  }, UPLOAD_REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Export failed: ${res.status} ${res.statusText}: ${body}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export const exportPpt   = (items, filename='digest.pptx') => exportBinary('/export-ppt',   items, filename);
export const exportExcel = (items, filename='digest.xlsx') => exportBinary('/export-excel', items, filename);
export const exportWord  = (items, filename='digest.docx') => exportBinary('/export-word',  items, filename);

// ==========================================
// --- INTERNAL CONTRIBUTIONS (Contribute) ---
// ==========================================
// The backend owns parsing, cover normalization, and persistence. These
// wrappers stay same-origin in dev (Vite proxy), portable builds, and Linux.

export const getContributionAccess = () => jsonFetch('/internal-content/contribute-access');

const toBackendDraftFields = (draft) => ({
  title: draft.title || '',
  summary: draft.summary || '',
  body: draft.body || '',
  category: draft.category || '',
  team: draft.team || '',
  author: draft.author || '',
  owner_name: draft.ownerName || localStorage.getItem('news-viewer-name') || '',
  content_type: draft.contentType || '',
});

const fromBackendRecord = (record) => ({
  id: record.id,
  contentType: ['document_import', 'leadership', 'announcement'].includes(record.content_type)
    ? record.content_type
    : 'story',
  title: record.title || '',
  summary: record.summary || '',
  body: record.body || '',
  category: record.category || '',
  team: record.team || '',
  author: record.author || '',
  ownerName: record.owner_name || '',
  cover: record.cover
    ? {
        name: record.cover.name || '',
        type: record.cover.type || '',
        size: Number(record.cover.size) || 0,
        width: Number(record.cover.width) || 0,
        height: Number(record.cover.height) || 0,
        focalX: Number.isFinite(Number(record.cover.focal_x)) ? Number(record.cover.focal_x) : 0.5,
        focalY: Number.isFinite(Number(record.cover.focal_y)) ? Number(record.cover.focal_y) : 0.5,
        // Cache-bust on every update so replaced covers render immediately.
        url: `/internal-content/${record.id}/cover?v=${encodeURIComponent(record.updated_at || '')}`,
      }
    : null,
  sourceDocument: record.source_document
    ? {
        name: record.source_document.name || '',
        type: record.source_document.type || '',
        size: Number(record.source_document.size) || 0,
        pageCount: record.source_document.page_count ?? null,
        extractedCharacters: Number(record.source_document.extracted_characters) || 0,
        url: `/internal-content/${record.id}/document`,
      }
    : null,
  status: record.status || 'draft',
  createdAt: record.created_at || '',
  updatedAt: record.updated_at || '',
  submittedAt: record.submitted_at || null,
  publishedAt: record.published_at || null,
});

export const getMyContributions = async () => {
  const response = await jsonFetch('/internal-content/mine');
  return (response?.items || []).map(fromBackendRecord);
};

// Future Samsung Internal contract: only records already marked published.
export const getPublishedInternalContent = async () => {
  const response = await jsonFetch('/internal-content/published');
  return (response?.items || []).map(fromBackendRecord);
};

export const getPublishedInternalRecord = async (id) =>
  fromBackendRecord(await jsonFetch(`/internal-content/published/${encodeURIComponent(id)}`));

export const importContributionDocument = async (file, ownerName = '', contentType = '') => {
  const form = new FormData();
  form.append('document', file);
  if (ownerName) form.append('owner_name', ownerName);
  if (contentType) form.append('content_type', contentType);
  return fromBackendRecord(await uploadFetch('/internal-content/import', form));
};

export const createContributionDraft = async (fields) =>
  fromBackendRecord(
    await jsonFetch('/internal-content/drafts', { method: 'POST', body: JSON.stringify(toBackendDraftFields(fields)) }),
  );

export const updateContributionDraft = async (id, fields) =>
  fromBackendRecord(
    await jsonFetch(`/internal-content/${id}`, { method: 'PUT', body: JSON.stringify(toBackendDraftFields(fields)) }),
  );

export const uploadContributionCover = async (id, file, focalX = 0.5, focalY = 0.5) => {
  const form = new FormData();
  form.append('cover', file);
  form.append('focal_x', String(focalX));
  form.append('focal_y', String(focalY));
  return fromBackendRecord(await uploadFetch(`/internal-content/${id}/cover`, form));
};

export const deleteContributionRecord = (id) => jsonFetch(`/internal-content/${id}`, { method: 'DELETE' });

export const submitContributionDraft = async (id) =>
  fromBackendRecord(await jsonFetch(`/internal-content/${id}/submit`, { method: 'POST' }));
