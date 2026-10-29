import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import {
  activeLeadership, coverUrl, groupSignalsByDate, rankTrending, resolveInternalImage,
} from '../../news-scrapper/internal/samsungInternalModel.js';

export const SAMPARK_SAMSUNG_CHANNELS = [
  { id: 'internal', label: 'SRI-D Tech AXis', icon: 'layers' },
  { id: 'global', label: 'Samsung Global', icon: 'globe' },
  { id: 'local', label: 'Samsung Local', icon: 'radar' },
];
const CONTENT_LABELS = {
  leadership: 'Leadership Message', announcement: 'Announcement',
  story: 'Story', document_import: 'Document',
};

export const SAMSUNG_NEW_BADGE_WINDOW_MS = 48 * 60 * 60 * 1000;

// Show NEW only for records actually published within the last 48 hours.
// No marker for a draft, a feed item, a date-only value, or future timestamps.
export function isRecentlyPublishedSamsungItem(item, nowMs = Date.now()) {
  if (!item?._isInternalPublished || !item?._publishedId) return false;
  const value = item.published_at;
  if (typeof value !== 'string' || !/T\d{2}:\d{2}/.test(value)) return false;
  const publishedAt = Date.parse(value);
  if (!Number.isFinite(publishedAt)) return false;
  const elapsed = nowMs - publishedAt;
  return elapsed >= 0 && elapsed < SAMSUNG_NEW_BADGE_WINDOW_MS;
}

function recordContentType(record) {
  return String(record?.contentType ?? record?.content_type ?? '').trim();
}
function recordDisplaySection(record) {
  const value = String(record?.displaySection ?? record?.display_section ?? '').trim().toLowerCase();
  if (value === 'hero' || value === 'srid') return value;
  // Compatibility: leadership historically defaults to Hero.
  return recordContentType(record) === 'leadership' ? 'hero' : 'srid';
}
function signalContentType(item) {
  return String(item?.contentType ?? item?.content_type ?? item?.samsung_internal_kind ?? '').trim().toLowerCase();
}
function recordStamp(record) {
  return record?.publishedAt || record?.published_at || record?.updatedAt || record?.updated_at || '';
}
function itemStamp(item) {
  const value = item?.published_at || item?.first_seen || item?.date || '';
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
export function samsungItemKey(item) {
  return String(item?._publishedId || item?.id || item?.canonical_link ||
    item?.link || item?.url || item?.title || '').trim();
}
function dedupe(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item) return false;
    const key = samsungItemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function newestFirst(items) {
  return [...(items || [])].sort((left, right) => itemStamp(right) - itemStamp(left));
}

export function publishedRecordToSignal(record) {
  if (!record) return null;
  const contentType = recordContentType(record);
  const publishedAt = recordStamp(record);
  const author = record?.author || record?.ownerName || record?.owner_name || 'Samsung Research Institute Delhi';
  const image = coverUrl(record);
  const rawSourceDocument = record?.sourceDocument || record?.source_document || null;
  const sourceDocument = rawSourceDocument ? {
    name: rawSourceDocument.name || '',
    type: rawSourceDocument.type || 'application/pdf',
    size: Number(rawSourceDocument.size) || 0,
    pageCount: rawSourceDocument.pageCount ?? rawSourceDocument.page_count ?? null,
    extractedCharacters: Number(rawSourceDocument.extractedCharacters ?? rawSourceDocument.extracted_characters ?? 0) || 0,
    url: rawSourceDocument.url || `/internal-content/${encodeURIComponent(record.id)}/document`,
  } : null;
  return {
    id: record.id,
    canonical_link: `internal://${record.id}`,
    _publishedId: record.id,
    _isInternalPublished: true,
    samsung_internal_channel: 'internal',
    samsung_internal_kind: contentType,
    contentType,
    title: record.title || 'Samsung Internal Update',
    summary: record.summary || '',
    body: record.body || '',
    category: record.category || CONTENT_LABELS[contentType] || 'Internal',
    source: author,
    src: author,
    author,
    // Keep the real human author separate from the source-label fallback.
    signatureAuthor: record?.author || record?.ownerName || record?.owner_name || '',
    team: record.team || '',
    region: 'SRI-D',
    date: publishedAt ? String(publishedAt).slice(0, 10) : 'Latest',
    // Badge eligibility must use the actual publication time only.
    // Never substitute an edit/creation timestamp.
    published_at: record?.publishedAt || record?.published_at || '',
    source_count: 1,
    image_url: image,
    top_image: image,
    image_focal: record?.cover?.focal || null,
    imageScale: Math.min(1.8, Math.max(0.6, Number(record.imageScale ?? record.image_scale ?? 1) || 1)),
    link: '',
    url: '',
    layout: record?.layout || 'two-column',
    displaySection: recordDisplaySection(record),
    templateData: record?.templateData && typeof record.templateData === 'object'
      ? { desc0: record.templateData.desc0 || '', desc1: record.templateData.desc1 || '' }
      : { desc0: '', desc1: '' },
    cover: record?.cover || null,
    secondaryCover: record?.secondaryCover || null,
    sourceDocument,
    cardImageSource: record?.cardImageSource === 'secondary' ? 'secondary' : 'primary',
    audiences: Array.isArray(record?.audiences) ? record.audiences : ['all'],
  };
}
function normalizeFeedChannel(items, channel) {
  return normalizeList(items || []).map((item) => {
    const image = resolveInternalImage(item);
    return {
      ...item,
      image_url: image || item?.image_url || '',
      samsung_internal_channel: channel,
      region: channel === 'internal' ? 'SRI-D'
        : channel === 'local' ? (item?.region || 'Local') : (item?.region || 'Global'),
    };
  });
}
function buildChannel({ id, label, items, hero, stream }) {
  const cards = newestFirst(dedupe(items));
  const trending = rankTrending(cards);
  return {
    id, label, items: cards,
    hero: hero || trending.slice(0, 5),
    stream: Array.isArray(stream) ? stream : trending.slice(0, 10),
    groups: groupSignalsByDate(cards),
    count: cards.length,
  };
}
export function buildSamparkSamsungModel({ feed, published }) {
  const global = normalizeFeedChannel(feed?.global || [], 'global');
  const local = normalizeFeedChannel(feed?.local || [], 'local');
  const inside = normalizeFeedChannel(feed?.sampark || feed?.inside || [], 'internal');
  // All published Create News records belong exclusively to SRI-D.
  const publishedRecords = (published || []).filter((record) => record?.status === 'published');
  const publishedSignals = publishedRecords.map(publishedRecordToSignal).filter(Boolean);
  // A hero leadership message does not also appear in SRI-D archive or stream.
  const feedPublishedSignals = publishedSignals.filter((item) =>
    !(signalContentType(item) === 'leadership' && item.displaySection === 'hero'));
  const internalItems = newestFirst(dedupe([...inside, ...feedPublishedSignals]));
  const heroLeadershipRecords = publishedRecords.filter((record) =>
    recordContentType(record) === 'leadership' && recordDisplaySection(record) === 'hero');
  const leadershipRecord = activeLeadership(heroLeadershipRecords);
  const leadershipSignal = leadershipRecord ? publishedRecordToSignal(leadershipRecord) : null;
  const internalTrending = rankTrending(internalItems.filter((item) =>
    signalContentType(item) !== 'leadership'));
  const internalHero = dedupe([leadershipSignal, ...internalTrending]).filter(Boolean).slice(0, 5);
  const internalStream = rankTrending(internalItems.filter((item) =>
    signalContentType(item) !== 'leadership')).slice(0, 10);
  return {
    internal: buildChannel({
      id: 'internal', label: 'SRI-D Tech AXis', items: internalItems,
      hero: internalHero, stream: internalStream,
    }),
    global: buildChannel({ id: 'global', label: 'Samsung Global', items: global }),
    local: buildChannel({ id: 'local', label: 'Samsung Local', items: local }),
  };
}
