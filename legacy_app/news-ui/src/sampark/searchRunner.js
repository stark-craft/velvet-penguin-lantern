// Reusable archive-search operation with debounce, cancellation, and an
// explicit retry generation. Tested behaviorally; SamparkSearchResults routes
// both navigation-driven searches and the error-state Try again button
// through one operation so retry always performs a real request.
//
// StrictMode safety: the component owns one runner in a ref that survives the
// development setup-cleanup-setup replay. The unmount effect calls dispose()
// (cancelling timers and aborting fetches); the setup path calls activate(),
// so a StrictMode replay leaves a usable runner while a real unmount stays
// permanently settled with no post-unmount emissions.
export const SEARCH_DEBOUNCE_MS = 150;

export function createSearchRunner({
  wait = SEARCH_DEBOUNCE_MS,
  fetchPage,
  onState,
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('fetchPage is required');
  const emit = typeof onState === 'function' ? onState : () => {};
  let timer = null;
  let timerResolve = null;
  let controller = null;
  let generation = 0;
  let disposed = false;
  // Identical concurrent requests share one in-flight fetch; a different
  // request supersedes via generation so stale completions never apply.
  let inflight = null;

  function requestKey(request) {
    return JSON.stringify([request?.query, request?.from, request?.to, request?.source, request?.sort]);
  }

  // Clearing the timer always settles its waiter so no awaited Promise is
  // left permanently unresolved after cancel/dispose/replacement.
  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    if (timerResolve) {
      const resolve = timerResolve;
      timerResolve = null;
      resolve();
    }
  }

  function cancelPending() {
    clearTimer();
    if (controller) {
      controller.abort();
      controller = null;
    }
    inflight = null;
  }

  function start(request) {
    if (disposed) return Promise.resolve();
    const key = requestKey(request);
    if (inflight && inflight.key === key) return inflight.promise;
    const myGeneration = ++generation;
    cancelPending();
    const next = new AbortController();
    controller = next;
    emit({ loading: true, error: '' });
    const promise = (async () => {
      if (!request.immediate) {
        await new Promise((resolve) => {
          timerResolve = resolve;
          timer = timers.setTimeout(() => { timer = null; timerResolve = null; resolve(); }, wait);
        });
        if (disposed || myGeneration !== generation || next.signal.aborted) return;
      }
      try {
        const page = await fetchPage(request, next.signal);
        if (disposed || myGeneration !== generation || next.signal.aborted) return;
        emit({ ...page, loading: false, error: '' });
      } catch (error) {
        if (disposed || myGeneration !== generation || next.signal.aborted) return;
        emit({ items: [], total: 0, loading: false, error: error?.message || 'Search could not be completed.', has_more: false });
      } finally {
        if (inflight && inflight.promise === promise) inflight = null;
      }
    })();
    inflight = { key, promise, generation: myGeneration };
    return promise;
  }

  return {
    // Effect-setup path. Revives the runner after a StrictMode cleanup so the
    // mounted component always has a usable runner; harmless when active.
    activate: () => {
      disposed = false;
    },
    // Route-driven search: debounced so one navigation/filter application
    // produces exactly one request.
    run: (request) => start({ ...request, immediate: false }),
    // Error-state retry: starts a real request immediately without changing URL.
    retry: (request) => start({ ...request, immediate: true }),
    cancel: () => {
      generation += 1;
      cancelPending();
    },
    // Effect-cleanup path. Permanently settles this cycle: timers resolve
    // (never orphaned), fetches abort, and late completions stay silent.
    dispose: () => {
      disposed = true;
      generation += 1;
      cancelPending();
    },
  };
}
