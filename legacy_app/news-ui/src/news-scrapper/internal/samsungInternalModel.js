// Pure model for the Samsung Internal destination. No DOM, fetch, or storage
// access so ranking and channel rules stay testable in Node.

const SAMSUNG_OUTLETS = /sammobile|samsung newsroom|samsung\.com|samsungmobilepress|sammyfans/i;
const SAMSUNG_LOCAL_SOURCE = /\bsamsung[\s_-]+(?:local|india)\b/i;
const SAMPARK_SOURCE = /\bsampark\b/i;
const SAMSUNG_TOPIC = /\b(?:samsung|galaxy|smartthings|exynos|bixby|one\s+ui|samsung\s+knox|samsung\s+display|samsung\s+electronics|samsung\s+semiconductor|samsung\s+foundry|samsung\s+sdi|harman)\b/i;
const NON_ARTICLE_TITLE = /^(?:see\s+all(?:\s+the)?\s+latest|latest|home|news|technology|articles)$/i;

function textOf(value) {
  return String(value || '');
}

function haystackOf(item) {
  return [
    textOf(item?.title),
    textOf(item?.summary),
    textOf(item?.master_summary),
    textOf(item?.snippet),
  ].join(' ');
}

function sourceNamesOf(item) {
  const nested = item?.sources || item?.source_list || [];
  return [
    item?.source,
    item?.src,
    item?.publisher,
    item?.site_name,
    item?.source_name,
    ...(Array.isArray(nested) ? nested.map((source) => (
      typeof source === 'object'
        ? source?.name || source?.title || source?.source || source?.publisher
        : source
    )) : []),
  ].map(textOf).filter(Boolean);
}

export function isSamsungLocalSource(item) {
  return sourceNamesOf(item).some((source) => SAMSUNG_LOCAL_SOURCE.test(source));
}

export function isSamparkSource(item) {
  return sourceNamesOf(item).some((source) => SAMPARK_SOURCE.test(source));
}

export function isSamsungSignal(item) {
  if (!item || typeof item !== 'object') return false;
  const title = textOf(item?.title).trim();
  if (!title || NON_ARTICLE_TITLE.test(title)) return false;
  if (isSamparkSource(item)) return true;
  if (isSamsungLocalSource(item)) return true;
  if (sourceNamesOf(item).some((source) => SAMSUNG_OUTLETS.test(source))) return true;
  return SAMSUNG_TOPIC.test(haystackOf(item));
}

export function signalScope(item) {
  if (!item || typeof item !== 'object') return 'global';
  if (isSamsungLocalSource(item)) return 'local';
  return 'global';
}

function publishedTimeValue(item) {
  const raw = item?.published_at || item?.first_seen || item?.date || '';
  const parsed = Date.parse(textOf(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function keywordCount(item) {
  const values = item?.keywords_found || item?.keywords || [];
  const list = Array.isArray(values) ? values : [values];
  return new Set(list.map(textOf).filter(Boolean)).size;
}

// Same spirit as the Briefing carousel ordering: multi-source coverage first,
// then editorial score, then visual availability, then recency.
export function rankTrending(items) {
  return [...(items || [])].sort((a, b) => {
    const coverage = (b?.source_count || 1) - (a?.source_count || 1);
    const keywordsA = keywordCount(a);
    const keywordsB = keywordCount(b);
    const keywordCoverage = keywordsB - keywordsA;
    const score = (Number(b?.importance_score) || 0) - (Number(a?.importance_score) || 0);
    const visual = (textOf(a?.image_url || a?.top_image) ? 0 : 1)
      - (textOf(b?.image_url || b?.top_image) ? 0 : 1);
    const recency = publishedTimeValue(b) - publishedTimeValue(a);
    return coverage * 1000 + keywordCoverage * 100 + score * 10 + visual * 5 + recency / 1e12;
  });
}

export function splitByScope(items) {
  const global = [];
  const local = [];
  const inside = [];
  (items || []).forEach((item) => {
    if (isSamparkSource(item)) inside.push(item);
    else (signalScope(item) === 'local' ? local : global).push(item);
  });
  return { global, local, inside };
}

export function groupSignalsByDate(items) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const raw = item?.samsung_internal_date || item?.published_at || item?.first_seen || item?.date || '';
    const parsed = Date.parse(textOf(raw));
    const key = Number.isFinite(parsed)
      ? new Date(parsed).toISOString().slice(0, 10)
      : 'undated';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, signals]) => ({ date, signals }));
}

function channelOf(record) {
  return textOf(record?.contentType ?? record?.content_type);
}

function stampOf(record) {
  return textOf(record?.publishedAt ?? record?.published_at ?? '');
}

export function activeLeadership(publishedRecords) {
  const visions = (publishedRecords || []).filter(
    (record) => channelOf(record) === 'leadership' && record?.status === 'published',
  );
  visions.sort((a, b) => stampOf(b).localeCompare(stampOf(a)));
  return visions[0] || null;
}

export function announcementsOf(publishedRecords) {
  return (publishedRecords || [])
    .filter((record) => channelOf(record) === 'announcement' && record?.status === 'published')
    .sort((a, b) => stampOf(b).localeCompare(stampOf(a)));
}

export function colleagueStoriesOf(publishedRecords) {
  return (publishedRecords || [])
    .filter((record) =>
      record?.status === 'published'
      && (channelOf(record) === 'story' || channelOf(record) === 'document_import'))
    .sort((a, b) => stampOf(b).localeCompare(stampOf(a)));
}

export function coverUrl(record) {
  if (!record?.cover) return '';
  if (typeof record.cover?.url === 'string' && record.cover.url.trim()) {
    return record.cover.url.trim();
  }
  if (!record?.id) return '';
  return `/internal-content/${record.id}/cover?v=${encodeURIComponent(record.updatedAt || record.updated_at || '')}`;
}

function decodedImageValue(value) {
  let candidate = textOf(value).trim().replace(/\\\//g, '/');
  if (!candidate) return '';
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // A normal URL may contain a literal percent sign. Keep it unchanged.
  }
  return candidate;
}

export function resolveInternalImage(item) {
  if (!item || typeof item !== 'object') return '';
  const candidates = [
    item.image_url, item.top_image, item.imageUrl, item.image,
    item.thumbnail_url, item.thumbnail, item.og_image,
    item.article_image_url, item.web_search_image_url,
    item.image_metadata?.image_url, item.image_metadata?.url,
    item.media?.image_url, item.media?.url,
    item.images?.[0]?.image_url, item.images?.[0]?.url, item.images?.[0],
  ];
  for (const value of candidates) {
    const candidate = decodedImageValue(value);
    if (!candidate || candidate === '#') continue;
    if (/favicon|placeholder|default[-_]?image|spacer\.gif|blank\.gif/i.test(candidate)) continue;
    if (/^(?:https?:\/\/|\/[^/]|\/\/)/i.test(candidate)) return candidate;
  }
  return '';
}

const WIRE_SEQUENCE = [
  ['global', 0], ['local', 0], ['global', 1], ['inside', 0],
  ['global', 2], ['local', 1], ['inside', 1], ['global', 3],
  ['local', 2], ['inside', 2], ['global', 4],
];

export function buildSamsungWire({ global = [], local = [], inside = [] } = {}) {
  const groups = { global, local, inside };
  return WIRE_SEQUENCE.flatMap(([channel, index]) => {
    const item = groups[channel]?.[index];
    return item ? [{ ...item, samsung_internal_channel: channel }] : [];
  });
}

// The hero always leads with the leadership message when one is live, then
// fills to five with trending Samsung signals. When Samsung-tagged coverage is
// thin, the strongest remaining signals fill the remaining slots so the hero
// never lies about being empty while the briefing has content.
export function buildHeroSlides({ articles = [], leadership = null, limit = 5 } = {}) {
  const slides = [];
  if (leadership) {
    slides.push({ kind: 'leadership', record: leadership });
  }
  const pool = rankTrending((articles || []).filter(Boolean));
  const samsungFirst = [
    ...pool.filter((item) => isSamsungSignal(item)),
    ...pool.filter((item) => !isSamsungSignal(item)),
  ];
  const seen = new Set();
  for (const item of samsungFirst) {
    if (slides.length >= limit) break;
    const key = textOf(item.id || item.title || item.link || item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    slides.push({ kind: 'signal', item });
  }
  return slides.slice(0, limit);
}

export function signalLinkOf(item) {
  return textOf(item?.link || item?.url || '').trim();
}
