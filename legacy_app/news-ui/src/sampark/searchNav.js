// Pure search-shell navigation targets. Tested behaviorally; SamparkApp
// uses these so Clear/empty-submit stay inside Search when already there.

export function searchClearTarget(pathname, returnPath) {
  if (pathname === '/search') return '/search';
  return returnPath || '/for-you';
}

export function searchSubmitTarget(pathname, query, returnPath) {
  const clean = String(query || '').trim();
  if (!clean) {
    if (pathname === '/search') return '/search';
    return returnPath || '/for-you';
  }
  return `/search?q=${encodeURIComponent(clean)}`;
}
