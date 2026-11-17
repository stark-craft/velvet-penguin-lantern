export const SAMSUNG_NEWS_PAGE_SIZE = 20;
export const SAMSUNG_NEWS_FETCH_BATCH = 100;

export function samsungPageCount(total, pageSize = SAMSUNG_NEWS_PAGE_SIZE) {
  const count = Math.max(0, Math.trunc(Number(total) || 0));
  const size = Math.max(1, Math.trunc(Number(pageSize) || SAMSUNG_NEWS_PAGE_SIZE));
  return Math.ceil(count / size);
}

export function samsungPageItems(items, page, pageSize = SAMSUNG_NEWS_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.trunc(Number(pageSize) || SAMSUNG_NEWS_PAGE_SIZE));
  const start = (Math.max(1, Math.trunc(Number(page) || 1)) - 1) * size;
  return list.slice(start, start + size);
}
