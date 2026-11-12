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
  // Normalize and deduplicate by URL: two rows sharing one URL collapse into
  // a single row keeping the most useful nonempty label. Different URLs never
  // merge merely because labels match. Unsafe URLs validate to '' but keep a
  // valid label as text-only.
  const byUrl = new Map();
  const unlabeled = [];
  const unlabeledSeen = new Set();
  for (const s of sources) {
    if (typeof s === 'string') {
      const name = s.trim();
      const folded = name.toLowerCase();
      if (name && !unlabeledSeen.has(folded)) {
        unlabeledSeen.add(folded);
        unlabeled.push({ name, url: '' });
      }
      continue;
    }
    if (s && typeof s === 'object') {
      const name = safeName(s) || String(s.name || s.title || '').trim();
      const url = sanitizeExternalUrl(s.link || s.url || '');
      if (!name && !url) continue;
      if (!url) {
        unlabeled.push({ name, url: '' });
        continue;
      }
      const key = normalizeUrlKey(url);
      const prev = byUrl.get(key);
      if (!prev || (!prev.name && name) || (name && name.length > prev.name.length)) {
        byUrl.set(key, { name: name || prev?.name || '', url });
      }
      continue;
    }
  }
  return [...byUrl.values(), ...unlabeled];
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

// True when every substantial part of the candidate is already displayed.
// Short fragments (< 25 chars) only count when the whole candidate is covered,
// so no legitimate continuation is ever removed. Sentence boundaries are
// detected on the RAW candidate: normalizedWords strips periods, so splitting
// must happen before normalization.
export function textCoveredBy(shownNorms, candidate) {
  const shown = (shownNorms || []).filter(Boolean).join(' ');
  const raw = safeText(candidate);
  if (!raw) return true;
  const n = normalizedWords(raw);
  if (!n) return true;
  if (!shown) return false;
  if (shown.includes(n)) return true;
  const parts = splitRawSentences(raw).map(normalizedWords).filter((p) => p.length > 24);
  if (!parts.length) return false;
  return parts.every((p) => shown.includes(p));
}

function splitRawSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Remove only a confirmed repeated leading run: drop consecutive leading
// sentences already rendered, keep every distinct continuation — including a
// matching sentence that reappears later in the article. Original wording and
// punctuation of the kept suffix are preserved.
export function stripRepeatedLeading(shownNorms, rawText) {
  const text = safeText(rawText);
  if (!text) return '';
  const shown = (shownNorms || []).filter(Boolean);
  if (!shown.length) return text;
  const sentences = splitRawSentences(text);
  if (!sentences.length) return text;
  let drop = 0;
  for (const sentence of sentences) {
    if (textCoveredBy(shown, sentence)) drop += 1;
    else break;
  }
  if (drop >= sentences.length) return '';
  if (drop === 0) return text;
  const idx = text.indexOf(sentences[drop]);
  return (idx >= 0 ? text.slice(idx) : sentences.slice(drop).join(' ')).trim();
}

// True when the master summary only reconstructs text already displayed as
// the lead and bullet list (then it is hidden to avoid triple repetition).
// Genuinely distinct summaries are preserved.
export function masterSummaryRepeatsDisplayed({ summaryLead, summary, summaryPoints, keyPoints, masterSummary }) {
  const shown = [summaryLead, summary, ...(summaryPoints || []), ...(keyPoints || [])]
    .filter(Boolean).map(normalizedWords);
  return textCoveredBy(shown, masterSummary);
}

function splitLeadingSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Remove only a confirmed repeated prefix from the full body: drop leading
// sentences/paragraphs already displayed, keep every later paragraph — even
// one matching an earlier sentence. Returns '' only if nothing unique remains.
export function stripRepeatedBodyPrefix(shownTexts, body) {
  const raw = safeText(body);
  if (!raw) return '';
  const shown = (shownTexts || []).filter(Boolean).map(normalizedWords).filter(Boolean);
  if (!shown.length) return raw;
  const sentences = splitLeadingSentences(raw);
  if (!sentences.length) return raw;
  let drop = 0;
  for (const sentence of sentences) {
    const n = normalizedWords(sentence);
    if (n && textCoveredBy(shown, sentence)) drop += 1;
    else break;
  }
  if (drop >= sentences.length) return '';
  if (drop === 0) return raw;
  // Rejoin from the original text at the first kept sentence.
  const idx = raw.indexOf(sentences[drop]);
  return (idx >= 0 ? raw.slice(idx) : sentences.slice(drop).join(' ')).trim();
}

export function normalizeUrlKey(url) {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.replace(/\/+$/, '');
}

function pointsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map(labelOf).map((s) => s.trim()).filter(Boolean);
}

// One resolved view per article: every distinct backend text is rendered
// exactly once, absent fields stay absent, nothing is invented.
export function resolveDossierView(item) {
  // Ordered emission: a block renders only when it adds text not already
  // displayed. A lead never erases a distinct summary, and equality with a
  // hidden field can never suppress the only visible copy.
  const shownNorms = [];
  // Ordered emission with prefix trimming: a block renders its distinct
  // continuation even when it opens with already-displayed text. Fields that
  // stay hidden never enter coverage, so equality with a hidden field can
  // never suppress the only visible copy.
  const takeText = (value) => {
    const raw = stripRepeatedLeading(shownNorms, value);
    if (!raw) return '';
    shownNorms.push(normalizedWords(raw));
    return raw;
  };
  const takeList = (value) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const entry of value) {
      const raw = stripRepeatedLeading(shownNorms, labelOf(entry).trim());
      if (!raw) continue;
      shownNorms.push(normalizedWords(raw));
      out.push(raw);
    }
    return out;
  };
  const summaryLead = takeText(item?.summary_lead);
  const summaryPoints = takeList(item?.summary_points);
  const keyPoints = takeList(item?.key_points);
  const summary = takeText(item?.summary);
  const masterSummary = takeText(item?.master_summary);
  const snippet = takeText(item?.snippet);
  const fullBodyRaw = safeText(item?.full_contents || item?.full_content || item?.body);
  // Strip only a confirmed repeated prefix; identical bodies collapse to ''.
  const fullBody = fullBodyRaw && !textCoveredBy(shownNorms, fullBodyRaw)
    ? stripRepeatedBodyPrefix(shownNorms, fullBodyRaw)
    : '';
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
  const externalLinkRawAlt = sanitizeExternalUrl(item?.url);
  // Identical primary/alternate URLs (modulo case and trailing slash) collapse.
  const externalLinkAlt = externalLinkRawAlt
    && normalizeUrlKey(externalLinkRawAlt) !== normalizeUrlKey(externalLink)
    ? externalLinkRawAlt
    : '';
  // Avoid a duplicate source action when the source list already links the
  // same URL shown as the primary external link (normalized comparison).
  const listedUrls = new Set([externalLink, externalLinkAlt].filter(Boolean).map(normalizeUrlKey));
  const dedupedSources = sourceList.filter((s) => !s.url || !listedUrls.has(normalizeUrlKey(s.url)));
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
    keyPoints,
    summary,
    summarizedBy: safeText(item?.summarized_by),
    masterSummary,
    snippet,
    attentionHook: safeText(item?.attention_hook),
    whatChanged: safeText(item?.what_changed),
    whyNow: safeText(item?.why_now),
    whyMatters: safeText(item?.why_matters || item?.why_it_matters),
    watchNext: safeText(item?.watch_next),
    fullBody,
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
