// Pure helper for search decoupling, tested behaviorally
// Network search starts from route query/filters only; preference loading is
// concurrent and never delays, cancels, or duplicates the network request.
// prefsLoaded is accepted for API compatibility but intentionally ignored for
// starting the network search (decoupling fix). Remember Search History is
// gated authoritatively by the backend; its real endpoint tests verify it.

export function shouldStartSearch(qParam, prefsLoaded) {
  void prefsLoaded;
  return Boolean(qParam && String(qParam).trim());
}

export function searchRequestKey(q, from, to, source, sort) {
  return `${q}|${from}|${to}|${source}|${sort}`;
}
