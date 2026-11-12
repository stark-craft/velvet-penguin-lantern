import { matchesKeyword, scoreOf } from '../utils/intelligence.js';

export const emptyFilters = {
  query: '',
  scope: 'all',
  region: 'all',
  category: 'all',
  source: 'all',
  date: 'all',
  signal: 'all',
  fresh: 'all',
  cluster: 'all',
  image: 'all',
  selected: 'all',
  keyword: 'all'
};
function matchesQuery(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.title, item.summary, item.src, item.source, item.category, item.region, ...(item.keywords_found || []), ...(item.keywords || [])].join(' ').toLowerCase();
  return haystack.includes(q);
}
function articleScopes(item) {
  const values = [
    item.vertical,
    item.legacy_profile,
    item.profile,
    ...(Array.isArray(item.verticals) ? item.verticals : []),
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  const category = String(item.category || '').toLowerCase();
  const scopes = new Set();
  if (values.some(value => value.includes('broadcast')) || /broadcast|cable|dth|television|media distribution/.test(category)) {
    scopes.add('broadcast');
  }
  if (values.some(value => value === 'technology' || value === 'default' || value === 'tech')) {
    scopes.add('technology');
  }
  if (!scopes.size) scopes.add('technology');
  return scopes;
}
export function applyFilters(items, filters, selectedIds) {
  return items.filter(item => {
    if (!matchesQuery(item, filters.query)) {
      return false;
    }
    if (filters.scope !== 'all' && !articleScopes(item).has(filters.scope)) {
      return false;
    }
    if (filters.region !== 'all' && item.region !== filters.region) {
      return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) {
      return false;
    }
    if (filters.source !== 'all' && (item.src || item.source) !== filters.source) {
      return false;
    }
    if (filters.date !== 'all' && item.date !== filters.date) {
      return false;
    }
    if (filters.signal === 'high' && scoreOf(item) < 80) {
      return false;
    }
    if (filters.signal === 'normal' && scoreOf(item) >= 80) {
      return false;
    }
    if (filters.fresh === 'fresh' && !item.is_fresh) {
      return false;
    }
    if (filters.cluster === 'multi' && (item.source_count || 1) <= 1) {
      return false;
    }
    if (filters.image === 'with' && !item.image_url) {
      return false;
    }
    if (filters.image === 'without' && item.image_url) {
      return false;
    }
    if (!matchesKeyword(item, filters.keyword)) {
      return false;
    }
    const isSelected = selectedIds.has(item.id) || selectedIds.has(item.title) || item.selected_by;
    if (filters.selected === 'selected' && !isSelected) {
      return false;
    }
    if (filters.selected === 'unselected' && isSelected) {
      return false;
    }
    return true;
  });
}
