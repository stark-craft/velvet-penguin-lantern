// Pure dossier field resolution for the shared Sampark news/article dossier.
// Tested behaviorally: same article exposes the same information on every
// surface, and absent fields stay absent (never fabricated).
import { sanitizeExternalUrl } from './safeLink.js';

export function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function safeName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.name || value.title || '';
  return '';
}

export function resolveScore(item) {
  const candidates = [
    item?.score, item?.importance_score, item?.signal_score,
    item?.confidence, item?.conf, item?.personal_rank_score,
  ];
  for (const c of candidates) {
    // Null, undefined, and blank strings are absent — Number(null) and
    // Number('') would otherwise fabricate a score of zero.
    if (c === null || c === undefined) continue;
    if (typeof c === 'string' && c.trim() === '') continue;
    const n = Number(c);
    if (!Number.isFinite(n)) continue;
    // Same 0–100 convention as scoreOf(): 0–1 ratios scale up.
    if (n > 0 && n <= 1) return Math.round(n * 100);
    return n;
  }
  return null;
}

export function resolveRegion(item) {
  const r = item?.region;
  if (!r) return '';
  if (typeof r === 'string') return r.trim();
  if (typeof r === 'object') {
    return String(r.value || r.name || r.region || r.display || '').trim();
  }
  return '';
}

export function resolveLearnedRegion(item) {
  const lr = item?.learned_region;
  if (!lr) return '';
  if (typeof lr === 'string') return lr.trim();
  if (typeof lr === 'object') {
    return String(lr.value || lr.name || '').trim();
  }
  return '';
}

export function resolveEntities(item) {
  const e = item?.entities;
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    const flat = [...(e.people || []), ...(e.organizations || []), ...(e.locations || [])]
      .map((v) => (typeof v === 'string' ? v : v?.name || ''))
      .filter(Boolean).map(String);
    if (flat.length) return dedupeCaseInsensitive(flat).slice(0, 12);
  }
  if (Array.isArray(item?.key_entities)) return dedupeCaseInsensitive(item.key_entities.map(labelOf).map((s) => s.trim()).filter(Boolean)).slice(0, 8);
  if (Array.isArray(item?.entities)) {
    return dedupeCaseInsensitive(item.entities
      .map((v) => (typeof v === 'string' ? v : v?.name || ''))
      .filter(Boolean).map(String).map((s) => s.trim()).filter(Boolean)).slice(0, 8);
  }
  return [];
}

function dedupeCaseInsensitive(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const folded = v.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(v);
  }
  return out;
}

export function resolveKeywords(item) {
  const raw = item?.keywords_found || item?.keywords;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const label = labelOf(entry).trim();
    const folded = label.casefold ? label.casefold() : label.toLowerCase();
    if (!label || seen.has(folded)) continue;
    seen.add(folded);
    out.push(label);
    if (out.length >= 8) break;
  }
  return out;
}

export function resolveImage(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || item?.top_image || item?.thumbnail || '';
}

export function resolveSources(item) {
  const sources = Array.isArray(item?.sources) ? item.sources : item?.source_list || [];
  return sources.map((s) => {
    if (typeof s === 'string') return { name: s, url: '' };
    if (s && typeof s === 'object') {
      return { name: safeName(s) || String(s.name || s.title || ''), url: sanitizeExternalUrl(s.link || s.url || '') };
    }
    return { name: '', url: '' };
  }).filter((s) => s.name || s.url);
}

function labelOf(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const label = value.name || value.title || value.value;
    return typeof label === 'string' ? label : '';
  }
  return '';
}

function normalizedWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pointsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map(labelOf).map((s) => s.trim()).filter(Boolean);
}

// True when the master summary only reconstructs text already displayed as
// the lead and bullet list (then it is hidden to avoid triple repetition).
// Genuinely distinct summaries are preserved.
export function masterSummaryRepeatsDisplayed({ summaryLead, summary, summaryPoints, keyPoints, masterSummary }) {
  const shown = [summaryLead, summary, ...(summaryPoints || []), ...(keyPoints || [])]
    .filter(Boolean).map(normalizedWords).join(' ');
  const master = normalizedWords(masterSummary);
  if (!master) return true;
  if (!shown) return false;
  if (shown.includes(master) || master.includes(shown)) return true;
  const parts = master.split('.').map((s) => s.trim()).filter((s) => s.length > 24);
  if (!parts.length) return shown.includes(master);
  return parts.every((p) => shown.includes(p));
}

// One resolved view per article: every available field, nothing invented.
export function resolveDossierView(item) {
  const summaryLead = safeText(item?.summary_lead);
  const summary = safeText(item?.summary);
  const masterSummary = safeText(item?.master_summary);
  const snippet = safeText(item?.snippet);
  const summaryPoints = pointsOf(item?.summary_points);
  const keyPoints = pointsOf(item?.key_points);
  const pointsEqual = summaryPoints.length === keyPoints.length
    && summaryPoints.length > 0
    && summaryPoints.every((v, i) => v === keyPoints[i]);
  const fullBody = safeText(item?.full_contents || item?.full_content || item?.body);
  const shownTexts = [summaryLead, summary, masterSummary].filter(Boolean);
  const masterDistinct = masterSummary
    && masterSummary !== summary
    && masterSummary !== summaryLead
    && !masterSummaryRepeatsDisplayed({ summaryLead, summary, summaryPoints, keyPoints, masterSummary });
  const score = resolveScore(item);
  const region = resolveRegion(item);
  const learnedRegion = resolveLearnedRegion(item);
  const date = safeText(item?.date || item?.archive_date || item?.published_at);
  const category = safeText(item?.category);
  const sourceCount = Number(item?.source_count);
  const sourceList = resolveSources(item);
  const fallbackSource = safeText(item?.src) || safeText(item?.source);
  const sourceNames = sourceList.length
    ? sourceList.map((s) => s.name).filter(Boolean).join(', ')
    : fallbackSource;
  const externalLink = sanitizeExternalUrl(item?.link);
  const externalLinkAlt = sanitizeExternalUrl(item?.url);
  // Avoid a duplicate source action when the source list already links the
  // same URL shown as the primary external link.
  const listedUrls = new Set([externalLink, externalLinkAlt].filter(Boolean));
  const dedupedSources = sourceList.filter((s) => !s.url || !listedUrls.has(s.url));
  return {
    title: safeText(item?.title) || 'Untitled',
    image: resolveImage(item),
    kicker: [category, sourceNames, date,
      score !== null ? `Score ${score}` : '',
      Number.isFinite(sourceCount) && sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ') || '',
    subtitle: [region, learnedRegion ? `Learned: ${learnedRegion}` : '',
      item?.region_correction ? `Correction: ${safeText(item.region_correction)}` : '',
      safeText(item?.sentiment) ? `Sentiment: ${safeText(item.sentiment)}` : '',
    ].filter(Boolean).join(' · ') || '',
    dateLine: date,
    summaryLead,
    summaryPoints,
    keyPoints: pointsEqual ? [] : keyPoints,
    summary: summary && !summaryLead && !summaryPoints.length ? summary : '',
    summarizedBy: safeText(item?.summarized_by),
    masterSummary: masterDistinct ? masterSummary : '',
    snippet: !summaryLead && !summary && !masterSummary && snippet ? snippet : '',
    attentionHook: safeText(item?.attention_hook),
    whatChanged: safeText(item?.what_changed),
    whyNow: safeText(item?.why_now),
    whyMatters: safeText(item?.why_matters || item?.why_it_matters),
    watchNext: safeText(item?.watch_next),
    fullBody: fullBody && !shownTexts.includes(fullBody) ? fullBody : '',
    keywords: resolveKeywords(item),
    entities: resolveEntities(item),
    correction: item?.region && typeof item.region === 'object' ? safeText(item.region.correct) : '',
    sourceList: dedupedSources,
    sourceNames,
    externalLink,
    externalLinkAlt,
    score,
    region,
    learnedRegion,
  };
}
