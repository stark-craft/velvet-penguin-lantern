import {
  articleKey,
  matchesBriefingLens,
  publishedTime,
  scoreOf,
} from '../../news-scrapper/utils/intelligence.js';

export function imageOf(item) {
  const cands = [
    item?.image_url,
    item?.imageUrl,
    item?.thumbnail_url,
    item?.og_image,
    item?.top_image,
    item?.image,
    item?.thumbnail,
  ];
  const m = cands.find((v) => typeof v === 'string' && v.trim() && v.trim() !== '#');
  return m ? m.trim() : '';
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(
    (a, b) => String(a).localeCompare(String(b)),
  );
}

export function deriveFilterOptions(articles) {
  const safe = (articles || []).filter(Boolean);
  const regions = uniqueSorted(safe.map((a) => a?.region));
  const categories = uniqueSorted(safe.map((a) => a?.category));
  const sources = uniqueSorted(safe.map((a) => a?.src || a?.source));
  const dates = uniqueSorted(safe.map((a) => a?.date)).sort().reverse();
  return { regions, categories, sources, dates };
}

export function matchesCategoryLens(item, lens) {
  return matchesBriefingLens(item, lens);
}

// Hero ranking: prefer strong/multi-source stories, score, images, then recency.
export function selectFeatured(articles, limit = 5) {
  const safe = (articles || []).filter(Boolean);
  if (!safe.length) return [];

  // Same ordering as the original FeedScreen sortForCarousel.
  const sorted = [...safe].sort((a, b) => {
    const cov = (b?.source_count || 1) - (a?.source_count || 1);
    if (cov) return cov;
    const sc = scoreOf(b) - scoreOf(a);
    if (sc) return sc;
    const img = (b?.image_url ? 1 : 0) - (a?.image_url ? 1 : 0);
    if (img) return img;
    return publishedTime(b) - publishedTime(a);
  });

  // Personalization, when applicable, is already reflected in backend ordering.
  return sorted.slice(0, limit);
}

export function selectAllNewsRail(articles, limit = 10) {
  const safe = (articles || []).filter(Boolean);
  // Same briefing data, ranked by recency and score.
  const sorted = [...safe].sort(
    (a, b) => publishedTime(b) - publishedTime(a) || scoreOf(b) - scoreOf(a),
  );
  return sorted.slice(0, limit);
}

// Latest = newest valid publication/archive date in the filtered results.
export function selectLatestToday(articles, todayISO) {
  const safe = (articles || []).filter(Boolean);
  if (!safe.length) return [];

  const valid = [];
  const invalid = [];
  for (const a of safe) {
    const raw = String(a?.date || a?.archive_date || '').trim();
    const iso = raw.slice(0, 10);
    const parsed = iso ? new Date(iso) : null;
    const isValid = iso
      && /^\d{4}-\d{2}-\d{2}$/.test(iso)
      && parsed
      && !isNaN(parsed.getTime());
    if (isValid) valid.push({ item: a, iso });
    else invalid.push(a);
  }
  if (!valid.length) {
    // Latest shows only the newest valid date; otherwise no section.
    return [];
  }

  valid.sort((a, b) => b.iso.localeCompare(a.iso));
  const latestISO = valid[0].iso;
  const latest = valid.filter((v) => v.iso === latestISO).map((v) => v.item);

  // todayISO does not override the latest date from the briefing itself.
  return latest;
}

export function applyArticleFilters(articles, filters) {
  const safe = (articles || []).filter(Boolean);
  // Category is a briefing lens; other filters match exact values.
  return safe.filter((item) => {
    if (!item) return false;
    if (
      filters.category
      && filters.category !== 'all'
      && !matchesCategoryLens(item, filters.category)
    ) return false;
    if (filters.region && filters.region !== 'all' && item.region !== filters.region) return false;
    if (
      filters.source
      && filters.source !== 'all'
      && (item.src || item.source) !== filters.source
    ) return false;
    if (filters.date && filters.date !== 'all' && item.date !== filters.date) return false;
    return true;
  });
}

// Day-wise grouping preserves input order (expected to be newest first).
export function groupByDatePreservingOrder(articles) {
  const safe = (articles || []).filter(Boolean);
  const map = new Map();
  for (const it of safe) {
    if (!it) continue;
    const key = String(it.date || 'Unknown').slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.entries()];
}

/**
 * Select important stories using independent source coverage and community likes.
 *
 * Eligibility:
 *   - At least 2 sources, OR
 *   - At least 2 likes
 *
 * Ranking:
 *   - Each additional source: 4 points
 *   - Each like: 2 points
 *
 * Excludes every item selected for the featured hero.
 */
export function selectImportantNews(
  articles,
  {
    featured = [],
    votes = {},
    limit = 12,
    minimumLikes = 2,
  } = {},
) {
  const featuredKeys = new Set(
    featured.map(articleKey).filter(Boolean),
  );
  const featuredReferences = new Set(featured);

  const sourceCountOf = (item) => {
    const reported = Number(item?.source_count);
    if (Number.isFinite(reported) && reported > 0) {
      return Math.floor(reported);
    }
    if (Array.isArray(item?.sources) && item.sources.length) {
      return item.sources.length;
    }
    return 1;
  };

  const ranked = (articles || [])
    .filter(Boolean)
    .map((item, index) => {
      const key = articleKey(item);
      if (
        featuredReferences.has(item)
        || (key && featuredKeys.has(key))
      ) {
        return null;
      }

      const sourceCount = sourceCountOf(item);
      // Live reaction state takes precedence over feed data.
      const reaction = votes?.[key] || item?.reactions || {};
      const likeValue = Number(
        reaction.like_count ?? item?.like_count ?? 0,
      );
      const likeCount = Number.isFinite(likeValue)
        ? Math.max(0, likeValue)
        : 0;

      // A story must demonstrate coverage or engagement.
      if (sourceCount < 2 && likeCount < minimumLikes) {
        return null;
      }

      const coverageScore = Math.max(0, sourceCount - 1) * 4;
      const engagementScore = likeCount * 2;
      return {
        item,
        key,
        index,
        sourceCount,
        likeCount,
        importanceScore: coverageScore + engagementScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (
      b.importanceScore - a.importanceScore
      || b.sourceCount - a.sourceCount
      || b.likeCount - a.likeCount
      || (Number(publishedTime(b.item)) || 0) - (Number(publishedTime(a.item)) || 0)
      || a.index - b.index
    ));

  // Prevent duplicate stories with the same article identity.
  const seenKeys = new Set();
  return ranked
    .filter(({ key }) => {
      if (!key) return true;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}
