// Search is explicitly local to the loaded edition; it neither refetches the
// corpus nor changes article identity, ranking, or reaction snapshots.
export function filterFeedItems(items, query) {
  const term = String(query || '').trim().toLocaleLowerCase();
  if (!term) return items;
  return items.filter((item) => [item.title, item.src, item.source, item.category, item.attention_hook]
    .some((value) => String(value || '').toLocaleLowerCase().includes(term)));
}
