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

// For ranked surfaces such as For You, grouping must never silently re-sort the
// server's recommendation order. Object insertion order preserves the first
// appearance of each day, while each bucket preserves the supplied item order.
export function groupedByDatePreservingOrder(items) {
  return [...(items || [])].reduce((acc, item) => {
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

export const BRIEFING_LENSES = Object.freeze([
  {
    id: 'ai',
    label: 'AI',
    description: 'Models, agents and applied intelligence',
    terms: [
      'ai', 'ai agents', 'ai models', 'anthropic', 'artificial intelligence',
      'chatgpt', 'claude', 'gemini', 'generative ai', 'grok', 'llm',
      'machine learning', 'openai',
    ],
  },
  {
    id: 'devices',
    label: 'Devices',
    description: 'Displays, televisions and connected products',
    terms: [
      'display', 'display tech', 'form factor', 'led', 'lg', 'mobile',
      'new product', 'oled', 'qned', 'samsung', 'smart home', 'smartphone',
      'sony', 'tcl', 'television', 'tv',
    ],
  },
  {
    id: 'compute',
    label: 'Compute',
    description: 'Silicon, accelerators and infrastructure',
    terms: [
      'chip', 'chipset', 'cpu', 'foundry', 'gpu', 'hardware & semiconductors',
      'hbm', 'memory', 'npu', 'nvidia', 'processor', 'semiconductor', 'silicon',
      'tpu',
    ],
  },
  {
    id: 'robotics',
    label: 'Robotics',
    description: 'Robots, autonomy and industrial automation',
    terms: [
      'automation', 'autonomous', 'drone', 'humanoid', 'robot', 'robotics',
      'robotics & automation',
    ],
  },
  {
    id: 'media',
    label: 'Media',
    description: 'Distribution, streaming and regulation',
    terms: [
      '5g broadcast', 'broadcast', 'broadcast regulation', 'cable tv',
      'conditional access system', 'connected tv', 'd2m', 'digital rights management',
      'digital terrestrial transmission', 'dth', 'dtt', 'dvb c', 'dvb c2',
      'dvb i', 'dvb s', 'dvb s2', 'dvb t', 'dvb t2', 'fast', 'hbb tv',
      'iptv', 'jio', 'linear ad insertion', 'linear ads', 'media', 'mib',
      'ott', 'set top box', 'streaming', 'trai', 'tuner',
    ],
  },
]);

function normalizedLensValues(item) {
  return [
    ...articleKeywords(item),
    item?.category,
  ]
    .map(value => String(value || '').trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function matchesBriefingLens(item, lensId) {
  if (!lensId || lensId === 'all') return true;
  const lens = BRIEFING_LENSES.find(candidate => candidate.id === lensId);
  if (!lens) return true;
  const terms = new Set(lens.terms);
  return normalizedLensValues(item).some(value => terms.has(value));
}

export function briefingLensOptions(items) {
  return BRIEFING_LENSES.map(lens => ({
    ...lens,
    count: (items || []).filter(item => matchesBriefingLens(item, lens.id)).length,
  }));
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
