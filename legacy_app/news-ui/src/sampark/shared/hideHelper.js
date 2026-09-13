// Pure helpers for hide rollback concurrency safety, used in SamparkForYou and tested behaviorally
import { articleKey } from '../../news-scrapper/utils/intelligence.js';

export function hideOptimistic(items, keyToHide) {
  return items.filter((item) => articleKey(item) !== keyToHide);
}

export function findNeighbors(items, key) {
  const idx = items.findIndex((item) => articleKey(item) === key);
  if (idx === -1) return { idx: -1, prevKey: null, nextKey: null };
  const prevKey = idx > 0 ? articleKey(items[idx - 1]) : null;
  const nextKey = idx < items.length - 1 ? articleKey(items[idx + 1]) : null;
  return { idx, prevKey, nextKey };
}

export function hideRollback(currentItems, capturedArticle, prevKey, nextKey, fallbackIndex) {
  const key = articleKey(capturedArticle);
  if (currentItems.some((item) => articleKey(item) === key)) return currentItems;
  const nextIdx = nextKey ? currentItems.findIndex((item) => articleKey(item) === nextKey) : -1;
  if (nextIdx !== -1) {
    const next = [...currentItems];
    next.splice(nextIdx, 0, capturedArticle);
    return next;
  }
  const prevIdx = prevKey ? currentItems.findIndex((item) => articleKey(item) === prevKey) : -1;
  if (prevIdx !== -1) {
    const next = [...currentItems];
    next.splice(prevIdx + 1, 0, capturedArticle);
    return next;
  }
  const insertAt = fallbackIndex >= 0 ? Math.min(fallbackIndex, currentItems.length) : currentItems.length;
  const next = [...currentItems];
  next.splice(insertAt, 0, capturedArticle);
  return next;
}

export function findArticleIndex(items, key) {
  return items.findIndex((item) => articleKey(item) === key);
}
