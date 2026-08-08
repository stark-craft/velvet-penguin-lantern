// Normalize backend article shape → what prototype components expect.
// Backend fields vary; we fill safe defaults so the UI never crashes.

const TONES = ['warm', 'cool', 'forest', 'plum', 'sand'];

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  bull: '\u2022',
  cent: '\u00a2',
  copy: '\u00a9',
  euro: '\u20ac',
  gt: '>',
  hellip: '\u2026',
  ldquo: '\u201c',
  lsquo: '\u2018',
  lt: '<',
  mdash: '\u2014',
  middot: '\u00b7',
  nbsp: '\u00a0',
  ndash: '\u2013',
  pound: '\u00a3',
  quot: '"',
  rdquo: '\u201d',
  reg: '\u00ae',
  rsquo: '\u2019',
  trade: '\u2122',
  yen: '\u00a5',
});

/**
 * Decode the HTML entities commonly returned in article metadata without
 * depending on browser globals. Unknown or invalid entities stay untouched.
 */
export function decodeHtmlEntities(value) {
  if (value === null || value === undefined) return '';

  return String(value).replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (match, entity) => {
      if (entity[0] !== '#') {
        return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? match;
      }

      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return match;
      }

      return String.fromCodePoint(codePoint);
    },
  );
}

function decodeTextArray(values) {
  return Array.isArray(values) ? values.map(decodeHtmlEntities) : [];
}

function decodeSource(source) {
  if (typeof source === 'string') return { name: decodeHtmlEntities(source) };
  if (!source || typeof source !== 'object') return source;

  const decoded = { ...source };
  for (const key of ['name', 'title', 'source', 'publisher', 'description', 'snippet', 'content']) {
    if (typeof decoded[key] === 'string') decoded[key] = decodeHtmlEntities(decoded[key]);
  }
  return decoded;
}

function decodeEntities(values) {
  if (!Array.isArray(values)) return [];
  return values.map((entity) => {
    if (typeof entity === 'string') return decodeHtmlEntities(entity);
    if (!entity || typeof entity !== 'object') return entity;
    const decoded = { ...entity };
    for (const key of ['name', 'text', 'value', 'label', 'type']) {
      if (typeof decoded[key] === 'string') decoded[key] = decodeHtmlEntities(decoded[key]);
    }
    return decoded;
  });
}

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

export function structuredSummary(raw = {}) {
  const explicitPoints = Array.isArray(raw.summary_points)
    ? raw.summary_points
    : Array.isArray(raw.key_points)
      ? raw.key_points
      : [];
  const master = decodeHtmlEntities(
    raw.master_summary || raw.summary || raw.ppt_summary || raw.description || raw.content || ''
  ).trim();
  const bulletParts = master.split(/\s*[•●▪]\s*/).map((part) => part.trim()).filter(Boolean);
  let lead = decodeHtmlEntities(raw.summary_lead || raw.summary || '').trim();
  let points = explicitPoints.map(decodeHtmlEntities).map((point) => point.trim()).filter(Boolean);

  if (!points.length && bulletParts.length > 1) {
    lead = decodeHtmlEntities(raw.summary_lead || bulletParts[0]).trim();
    points = bulletParts.slice(1);
  }

  if (!points.length) {
    const source = [master, raw.full_contents, raw.full_content, raw.snippet]
      .filter(Boolean)
      .map(decodeHtmlEntities)
      .join(' ');
    const sentences = source
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
      .filter((sentence) => sentence.length >= 20);
    lead = decodeHtmlEntities(raw.summary_lead || sentences.slice(0, 2).join(' ') || master).trim();
    const leadSet = new Set(sentences.slice(0, 2).map((sentence) => sentence.toLowerCase()));
    points = sentences.filter((sentence) => !leadSet.has(sentence.toLowerCase())).slice(0, 5);
  }

  if (!points.length && lead) {
    points = [lead];
  }

  return {
    lead: lead || 'No summary available.',
    points: [...new Set(points)].slice(0, 5),
  };
}

export function normalizeArticle(raw, idx = 0) {
  if (!raw) return null;
  const title   = decodeHtmlEntities(raw.title || raw.headline || 'Untitled');
  const summaryContract = structuredSummary(raw);
  const summaryLead = summaryContract.lead;
  const summary = summaryLead;
  const summaryPoints = summaryContract.points;
  const src     = decodeHtmlEntities(raw.src || raw.source || (Array.isArray(raw.sources) && (raw.sources[0]?.name || raw.sources[0])) || 'unknown');
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map(decodeSource)
    : (src ? [{ name: src }] : []);
  const keywords = decodeTextArray(Array.isArray(raw.keywords) ? raw.keywords
                 : Array.isArray(raw.keywords_found) ? raw.keywords_found
                 : Array.isArray(raw.tags)     ? raw.tags
                 : []);
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
    summary_lead: summaryLead || summary,
    summary_points: summaryPoints.filter(Boolean).slice(0, 6),
    master_summary: decodeHtmlEntities(raw.master_summary || summary),
    summary_format: raw.summary_format || '',
    summarized_by: raw.summarized_by || '',
    article_intent: decodeHtmlEntities(raw.article_intent || ''),
    entities:       decodeEntities(raw.entities || raw.named_entities || []),
    src,
    sources,
    source_count:  raw.source_count || sources.length || 1,
    author:        decodeHtmlEntities(raw.author || ''),
    date:          dateStr,
    time:          timeStr,
    ago:           raw.ago || relativeAgo(published) || '',
    mins_read:     raw.mins_read || Math.max(1, Math.round((summary.split(/\s+/).length || 80) / 200)),
    keywords,
    keywords_found: Array.isArray(raw.keywords_found) ? decodeTextArray(raw.keywords_found) : keywords,
    region:        decodeHtmlEntities(raw.region || 'Global'),
    region_basis:  decodeHtmlEntities(raw.region_basis || ''),
    category:      decodeHtmlEntities(raw.category || raw.topic || 'News'),
    importance:    raw.importance ?? conf,
    conf,
    mark:          typeof raw.mark === 'string' ? decodeHtmlEntities(raw.mark) : raw.mark,
    is_fresh:      raw.is_fresh || false,
    tone:          raw.tone || toneFor(src + title),
    origin:        raw.origin || 'briefing',
    url:           raw.url || raw.link || '',
    link:          raw.link || raw.url || '',
    canonical_link: raw.canonical_link || raw.link || raw.url || '',
    cluster_id:    raw.cluster_id || '',
    image_url:     raw.image_url || raw.image || raw.thumbnail || raw.top_image || raw.media_url || '',
    why_matters:   decodeHtmlEntities(raw.why_it_matters || raw.why_matters || raw.insight || raw.ai_opinion || ''),
    // workflow fields passthrough
    selected_by:   typeof raw.selected_by === 'string' ? decodeHtmlEntities(raw.selected_by) : raw.selected_by,
    selected_at:   raw.selected_at,
    approved_by:   typeof raw.approved_by === 'string' ? decodeHtmlEntities(raw.approved_by) : raw.approved_by,
    approved_at:   raw.approved_at,
    rejected_by:   typeof raw.rejected_by === 'string' ? decodeHtmlEntities(raw.rejected_by) : raw.rejected_by,
    rejected_at:   raw.rejected_at,
    hours_remaining: raw.hours_remaining,
    // history-specific passthrough
    day:           raw.day || dateStr,
    seen_today:    raw.seen_today || 1,
    first_today:   raw.first_today || timeStr,
    last_today:    raw.last_today || timeStr,
    // local extracted-intelligence search metadata
    search_score:  Number(raw.search_score || 0),
    matched_terms: decodeTextArray(raw.matched_terms),
    archive_file:  raw.archive_file || '',
    archive_date:  raw.archive_date || dateStr,
    search_scope:  decodeHtmlEntities(raw.search_scope || ''),
    // private viewer-specific ranking metadata returned by the backend
    personal_rank_score: Number(raw.personal_rank_score || 0),
    personalization: raw.personalization && typeof raw.personalization === 'object'
      ? {
          ...raw.personalization,
          ...(typeof raw.personalization.follow_label === 'string'
            ? { follow_label: decodeHtmlEntities(raw.personalization.follow_label) }
            : {}),
          ...(typeof raw.personalization.matched_saved_title === 'string'
            ? { matched_saved_title: decodeHtmlEntities(raw.personalization.matched_saved_title) }
            : {}),
        }
      : null,
  };
}

export function normalizeList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((a, i) => normalizeArticle(a, i)).filter(Boolean);
}
