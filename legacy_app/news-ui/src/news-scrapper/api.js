// Thin API wrappers. In dev, vite proxies these paths to the backend.
import { getSessionId } from './utils/session.js';

const BASE = import.meta.env.VITE_API_BASE || '';

function selectedProfileOverride() {
  if (typeof window === 'undefined') return '';
  const value = localStorage.getItem('news-profile-override');
  return value === 'broadcast' || value === 'default' ? value : '';
}

async function jsonFetch(url, opts = {}) {
  const profileOverride = selectedProfileOverride();
  const res = await fetch(BASE + url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(profileOverride ? { 'X-Sense-Profile': profileOverride } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    let detail = '';
    if (contentType.includes('application/json')) {
      const body = await res.json().catch(() => ({}));
      detail = body?.detail || body?.message || '';
    } else {
      detail = await res.text().catch(() => '');
    }
    const error = new Error(detail || `${res.status} ${res.statusText}`);
    error.status = res.status;
    throw error;
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
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
export const getLatestBriefing = () => jsonFetch('/latest-briefing');
export const getBriefingMeta   = () => jsonFetch('/briefing/meta');
export const removeFromBriefing  = (title)   => jsonFetch('/briefing/remove',  { method:'POST', body: JSON.stringify({ title }) });
export const restoreToBriefing   = (article) => jsonFetch('/briefing/restore', { method:'POST', body: JSON.stringify({ article }) });
export const getInsight = (article) => jsonFetch('/insight', { method:'POST', body: JSON.stringify(article) });

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

// Convenience: full not-interested flow (also removes from briefing)
export async function rejectArticle(article) {
  const res = await markNotInterested(article);
  try { await removeFromBriefing(article.title); } catch {}
  return res;
}
export async function unrejectArticle(article) {
  const res = await restoreNotInterested(article.title);
  try { await restoreToBriefing(article); } catch {}
  return res;
}

// ---------- Personal hidden signals ----------
// These endpoints are viewer/IP-hash scoped. They never train the bouncer and
// never remove an article from another user's feed.
export const getViewerHidden = () => jsonFetch('/viewer/hidden');
export const hideArticleForViewer = (article) =>
  jsonFetch('/viewer/hidden', { method:'POST', body: JSON.stringify(article) });
export const restoreArticleForViewer = (article) =>
  jsonFetch('/viewer/hidden/restore', { method:'POST', body: JSON.stringify(article) });

// ---------- Workflow ----------
export const getWorkflow = () => jsonFetch('/workflow');
export const selectWorkflow = (article) =>
  jsonFetch('/workflow/select', { method:'POST', body: JSON.stringify(article) });
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
  return jsonFetch('/history/list?' + u.toString());
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
export const getStatus = () => jsonFetch('/status');
export const getProfile = () => jsonFetch('/profile');
export const getViewerProfile = () => jsonFetch('/viewer/profile');
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
  const u = new URLSearchParams({ key });
  return jsonFetch('/analytics?' + u.toString());
};

// ---------- Gatekeeper Review ----------
function gatekeeperHeaders(key) {
  const normalizedKey = String(key || '').trim();
  return normalizedKey ? { 'X-Gatekeeper-Key': normalizedKey } : {};
}

export const getGatekeeperAccess = () => jsonFetch('/gatekeeper/access');

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
  };
}

async function exportBinary(path, items, filename) {
  const payloadItems = Array.isArray(items)
    ? items.map((item, index) => normalizeExportItem(item, index))
    : [];

  if (!payloadItems.length) {
    throw new Error('Export failed: no items selected');
  }

  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sense-Profile': selectedProfile(),
    },
    body: JSON.stringify({
      items: payloadItems,
      filename,
    }),
  });

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
