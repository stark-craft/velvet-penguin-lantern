// Production hydration controllers for AllNewsPage saved + reaction status.
// Extracted so behavioral tests exercise the same logic the component uses,
// without reproducing component behavior in a test-only fake.
//
// Design goals (per correction pass):
// - Initial mount performs exactly one saved-status request; success does not
//   trigger a second request (hydrated ref, not state, drives focus retries).
// - Retry calls the loader exactly once and starts immediately.
// - Focus/visibility recovery retries only while unhydrated.
// - Stale earlier responses never overwrite newer successful results (token).
// - Unmount prevents state updates and callers remove intervals/listeners.
// - Reaction Retry immediately invokes getViewerReactions and exposes loading.

export function createSavedHydrationController({ loadFn }) {
  if (typeof loadFn !== 'function') throw new Error('loadFn is required');
  let hydrated = false;
  let loading = false;
  let error = '';
  let latestToken = 0;
  let requestCount = 0;
  let disposed = false;
  let inflight = null;
  let inflightToken = 0;

  function load() {
    if (disposed) return Promise.resolve(undefined);
    // Coalesce: StrictMode replay / focus while pending must reuse same promise.
    if (inflight) return inflight;
    const token = ++latestToken;
    requestCount += 1;
    loading = true;
    error = '';
    const promise = (async () => {
      try {
        const result = await loadFn();
        if (disposed || token !== latestToken) return undefined;
        hydrated = true;
        loading = false;
        return result;
      } catch (e) {
        if (disposed || token !== latestToken) return undefined;
        hydrated = false;
        loading = false;
        error = e?.message || 'Saved status unavailable';
        throw e;
      } finally {
        // Clear only when this same request settles; a newer request (after
        // failure+retry) has its own inflight reference.
        if (inflight === promise) {
          inflight = null;
          inflightToken = 0;
        }
      }
    })();
    inflight = promise;
    inflightToken = token;
    // Prevent unhandled rejection warnings when callers only check state;
    // the promise itself still rejects for awaiters.
    promise.catch(() => {});
    return inflight;
  }

  return {
    load,
    retry: () => load(),
    shouldRetryOnFocus: () => !hydrated && !disposed && !loading,
    dispose: () => { disposed = true; },
    isHydrated: () => hydrated,
    isLoading: () => loading,
    getError: () => error,
    getRequestCount: () => requestCount,
    isDisposed: () => disposed,
  };
}

export function createReactionHydrationController({ fetchFn }) {
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');
  let hydrated = false;
  let loading = false;
  let error = '';
  let latestToken = 0;
  let requestCount = 0;
  let disposed = false;
  let lastResult = null;
  let inflight = null;
  let inflightKey = '';
  let inflightToken = 0;

  function normalizeKey(ids) {
    if (Array.isArray(ids)) return ids.join('|');
    return String(ids || '');
  }

  function sync(ids) {
    if (disposed) return Promise.resolve(undefined);
    const key = normalizeKey(ids);
    // Same signature while pending: reuse same in-flight request.
    if (inflight && inflightKey === key) return inflight.promise;
    const token = ++latestToken;
    requestCount += 1;
    loading = true;
    error = '';
    const promise = (async () => {
      try {
        const result = await fetchFn(ids);
        if (disposed || token !== latestToken) return undefined;
        hydrated = true;
        loading = false;
        lastResult = result;
        return result;
      } catch (e) {
        if (disposed || token !== latestToken) return undefined;
        loading = false;
        error = e?.message || 'Reactions unavailable';
        throw e;
      } finally {
        // Clear only when this same request settles; an older completion must
        // not clear a newer pending request.
        if (inflight && inflight.promise === promise) {
          inflight = null;
          inflightKey = '';
          inflightToken = 0;
        }
      }
    })();
    inflight = { promise, key, token };
    inflightKey = key;
    inflightToken = token;
    promise.catch(() => {});
    return promise;
  }

  return {
    sync,
    // Retry must start a new request immediately, not wait for interval/focus.
    retry: (ids) => sync(ids),
    shouldRetryOnFocus: () => !hydrated && !disposed && !loading,
    dispose: () => { disposed = true; },
    isHydrated: () => hydrated,
    isLoading: () => loading,
    getError: () => error,
    getRequestCount: () => requestCount,
    getLastResult: () => lastResult,
    isDisposed: () => disposed,
  };
}
