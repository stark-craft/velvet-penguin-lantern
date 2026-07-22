// Normalize backend article shape → what prototype components expect.
// Backend fields vary; we fill safe defaults so the UI never crashes.

const TONES = ['warm', 'cool', 'forest', 'plum', 'sand'];
function toneFor(key) {
  if (!key) return 'cool';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

function relativeAgo(isoOrStr) {
  if (!isoOrStr) return '';
  const d = new Date(isoOrStr);
  if (isNaN(d)) return isoOrStr;
  const diffMin = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (diffMin < 60)      return diffMin + 'm';
  if (diffMin < 60 * 24) return Math.round(diffMin / 60) + 'h';
  return Math.round(diffMin / (60 * 24)) + 'd';
}

export function normalizeArticle(raw, idx = 0) {
  if (!raw) return null;
  const title   = raw.title || raw.headline || 'Untitled';
  const summary = raw.master_summary || raw.ppt_summary || raw.summary || raw.description || raw.content || '';
  const src     = raw.src || raw.source || (Array.isArray(raw.sources) && (raw.sources[0]?.name || raw.sources[0])) || 'unknown';
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((s) => (typeof s === 'string' ? { name: s } : s))
    : (src ? [{ name: src }] : []);
  const keywords = Array.isArray(raw.keywords) ? raw.keywords
                 : Array.isArray(raw.keywords_found) ? raw.keywords_found
                 : Array.isArray(raw.tags)     ? raw.tags
                 : [];
  const conf = typeof raw.conf === 'number' ? raw.conf
             : typeof raw.importance_score === 'number' ? raw.importance_score
             : typeof raw.importance === 'number' ? raw.importance
             : typeof raw.confidence === 'number' ? raw.confidence
             : 0.75;
  const published = raw.published || raw.date_published || raw.date;
  const dateStr = published ? String(published).slice(0, 10) : '';
  const timeStr = raw.time || (published && String(published).length > 10 ? String(published).slice(11, 16) : '');

  return {
    id:            raw.id || raw.title || ('a' + idx),
    title,
    summary,
    src,
    sources,
    source_count:  raw.source_count || sources.length || 1,
    author:        raw.author || '',
    date:          dateStr,
    time:          timeStr,
    ago:           raw.ago || relativeAgo(published) || '',
    mins_read:     raw.mins_read || Math.max(1, Math.round((summary.split(/\s+/).length || 80) / 200)),
    keywords,
    region:        raw.region || 'Global',
    region_basis:  raw.region_basis || '',
    category:      raw.category || raw.topic || 'News',
    importance:    raw.importance ?? conf,
    conf,
    mark:          raw.mark,
    is_fresh:      raw.is_fresh || false,
    tone:          raw.tone || toneFor(src + title),
    origin:        raw.origin || 'briefing',
    url:           raw.url || raw.link || '',
    image_url:     raw.image_url || raw.image || raw.thumbnail || raw.top_image || raw.media_url || '',
    why_matters:   raw.why_matters || raw.insight || raw.ai_opinion || '',
    // workflow fields passthrough
    selected_by:   raw.selected_by,
    selected_at:   raw.selected_at,
    approved_by:   raw.approved_by,
    approved_at:   raw.approved_at,
    rejected_by:   raw.rejected_by,
    rejected_at:   raw.rejected_at,
    hours_remaining: raw.hours_remaining,
    // history-specific passthrough
    day:           raw.day || dateStr,
    seen_today:    raw.seen_today || 1,
    first_today:   raw.first_today || timeStr,
    last_today:    raw.last_today || timeStr,
    // local extracted-intelligence search metadata
    search_score:  Number(raw.search_score || 0),
    matched_terms: Array.isArray(raw.matched_terms) ? raw.matched_terms : [],
    archive_file:  raw.archive_file || '',
    archive_date:  raw.archive_date || dateStr,
    search_scope:  raw.search_scope || '',
  };
}

export function normalizeList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((a, i) => normalizeArticle(a, i)).filter(Boolean);
}
