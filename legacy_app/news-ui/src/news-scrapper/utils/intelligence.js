export function scoreOf(item) {
  const raw = Number(item?.importance ?? item?.conf ?? 0.72);
  if (Number.isNaN(raw)) return 72;
  if (raw <= 1) return Math.round(raw * 100);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function publishedTime(item) {
  const raw = [item?.date, item?.time].filter(Boolean).join('T');
  const value = new Date(raw || item?.date || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function dayKey(item) {
  if (!item?.date) return 'Latest Signals';
  const d = new Date(item.date);
  if (Number.isNaN(d.getTime())) return item.date;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) {
    return `Today · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function groupedByDate(items) {
  const sorted = [...(items || [])].sort((a, b) => publishedTime(b) - publishedTime(a));
  return sorted.reduce((acc, item) => {
    const key = dayKey(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

export function cardVariant(item) {
  const score = scoreOf(item);
  if (score >= 82) return 'high';
  if (score < 58) return 'compact';
  return 'normal';
}

export function sourceList(item) {
  if (Array.isArray(item?.sources) && item.sources.length) return item.sources;
  if (item?.src) return [{ name: item.src, url: item.url, title: item.title, published: item.date }];
  return [];
}

export function articleKey(item) {
  return item?.canonical_link || item?.link || item?.url || item?.id || item?.title || '';
}

export function articleKeywords(item) {
  const values = [
    ...(Array.isArray(item?.keywords) ? item.keywords : []),
    ...(Array.isArray(item?.keywords_found) ? item.keywords_found : []),
  ];
  const seen = new Set();
  return values
    .map(value => String(value || '').trim())
    .filter(value => {
      const key = value.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function keywordOptions(items) {
  const counts = new Map();
  (items || []).forEach(item => {
    articleKeywords(item).forEach(label => {
      const key = label.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, {
        value: current?.value || label,
        count: (current?.count || 0) + 1,
      });
    });
  });
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.value.localeCompare(right.value),
  );
}

export function matchesKeyword(item, selectedKeyword) {
  if (!selectedKeyword || selectedKeyword === 'all') return true;
  const needle = String(selectedKeyword).trim().toLocaleLowerCase();
  return articleKeywords(item).some(keyword => keyword.toLocaleLowerCase() === needle);
}
