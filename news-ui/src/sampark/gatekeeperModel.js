// Pure Gatekeeper list reconciliation. Tested behaviorally; SamparkGatekeeper
// renders from these so background refresh never erases loaded pages.
import { decodeHtmlEntities } from '../news-scrapper/utils/normalize.js';

export function rowId(row, fallback) {
  return String(row?.id || row?.title || `signal-${fallback}`);
}

// Merge one fetched page into the loaded window. Append extends by stable id;
// refresh replaces the whole window (caller sizes limit to the loaded count).
export function mergeGatekeeperItems(current, incoming, { append = false } = {}) {
  const list = Array.isArray(current) ? current : [];
  const fresh = Array.isArray(incoming) ? incoming : [];
  if (!append) return [...fresh];
  const seen = new Set(list.map((d, i) => rowId(d, i)));
  return [...list, ...fresh.filter((d, i) => !seen.has(rowId(d, `new-${i}`)))];
}

// Pagination cursor for the loaded window. Show more always begins after
// the rows on screen; a background refresh re-requests the whole window.
export function pageRequest(loadedLength, { append = false, pageSize = 50 } = {}) {
  const loaded = Math.max(0, Number(loadedLength) || 0);
  const size = Math.max(1, Number(pageSize) || 50);
  if (append) return { offset: loaded, limit: size };
  return { offset: 0, limit: Math.max(size, loaded) };
}

// Stateful page loader with generation-guarded commits. Tested behaviorally;
// SamparkGatekeeper mirrors its state into React. One loader instance owns
// the window, so polling intervals never capture stale offsets or queries.
export function createGatekeeperLoader({
  pageSize = 50,
  fetchDropped,
  fetchQueue,
  onState,
  isMounted = () => true,
} = {}) {
  if (typeof fetchDropped !== 'function') throw new Error('fetchDropped is required');
  if (typeof fetchQueue !== 'function') throw new Error('fetchQueue is required');
  const emit = typeof onState === 'function' ? onState : () => {};
  const state = {
    items: [],
    queue: [],
    counts: { total: 0 },
    total: 0,
    matched: 0,
    hasMore: false,
    profile: 'all',
    status: 'all',
    search: '',
    loading: false,
    refreshing: false,
    error: '',
  };
  let generation = 0;
  // Foreground work (initial load, filter change, retry, pagination) always
  // wins: background polling defers while foreground is active, and a
  // foreground request started mid-poll invalidates the poll result.
  let foregroundActive = false;
  let backgroundPending = false;

  function snapshot() {
    return { ...state, items: [...state.items], queue: [...state.queue] };
  }

  async function request({ append = false, background = false } = {}) {
    // A background tick never starts while foreground work is active, and
    // never overlaps another background request: the user's action keeps
    // priority and exactly one poll is ever in flight.
    if (background && (foregroundActive || backgroundPending)) {
      return { skipped: true };
    }
    const myGeneration = ++generation;
    const { offset, limit } = pageRequest(state.items.length, { append, pageSize });
    const { profile, status, search } = state;
    if (background) {
      backgroundPending = true;
      emit({ refreshing: true });
    } else {
      foregroundActive = true;
      emit({ loading: true, error: '' });
    }
    state.loading = !background;
    state.refreshing = background;
    const settle = (result) => {
      if (background) backgroundPending = false;
      else foregroundActive = false;
      return result;
    };
    try {
      const [droppedRes, queueRes] = await Promise.all([
        fetchDropped({ limit, offset, profile, status, search }),
        fetchQueue({ profile }),
      ]);
      if (!isMounted() || myGeneration !== generation) return settle({ ignored: true, request: { offset, limit, profile, status, search } });
      const drops = Array.isArray(droppedRes?.items) ? droppedRes.items : [];
      const countsRaw = droppedRes?.counts || {};
      const jobs = Array.isArray(queueRes?.jobs) ? queueRes.jobs : [];
      state.items = mergeGatekeeperItems(append ? state.items : [], drops, { append });
      state.queue = jobs;
      state.counts = {
        total: Number(droppedRes?.total ?? countsRaw.all ?? drops.length),
        dropped: countsRaw.dropped ?? 0,
        queued: countsRaw.queued ?? 0,
        counts: countsRaw,
        queueCounts: queueRes?.counts || {},
        worker: queueRes?.worker || {},
      };
      state.total = state.counts.total;
      state.matched = Number(droppedRes?.matched ?? drops.length);
      state.hasMore = Boolean(droppedRes?.has_more ?? drops.length >= (append ? pageSize : limit));
      state.loading = false;
      state.refreshing = false;
      emit({
        items: [...state.items],
        queue: [...state.queue],
        counts: { ...state.counts },
        total: state.total,
        matched: state.matched,
        hasMore: state.hasMore,
        loading: false,
        refreshing: false,
        error: '',
      });
      return settle({ ignored: false, request: { offset, limit, profile, status, search } });
    } catch (error) {
      if (!isMounted() || myGeneration !== generation) return settle({ ignored: true, request: { offset, limit, profile, status, search } });
      state.loading = false;
      state.refreshing = false;
      // A background failure clears its own indicator but never plants a
      // permanent error: the next successful refresh replaces it.
      if (background) emit({ refreshing: false });
      else emit({ loading: false, refreshing: false, error: error?.message || 'Gatekeeper data could not be loaded' });
      return settle({ ignored: false, request: { offset, limit, profile, status, search }, error: error?.message });
    }
  }

  return {
    snapshot,
    getState: snapshot,
    setScope: (scope) => {
      if (scope.profile !== undefined) state.profile = scope.profile;
      if (scope.status !== undefined) state.status = scope.status;
      if (scope.search !== undefined) state.search = scope.search;
    },
    reload: () => request({ append: false, background: false }),
    refresh: () => request({ append: false, background: true }),
    loadMore: () => request({ append: true, background: false }),
  };
}

// Restoration-queue polling authority: queue jobs or dropped records whose
// *restoration status* is queued/processing. Pipeline stages (bouncer_stage,
// stage, state) are never a polling signal.
export function restorationActive(queueJobs, droppedItems) {
  const active = (v) => v === 'queued' || v === 'processing';
  if (Array.isArray(queueJobs) && queueJobs.some((j) => active(j?.status))) return true;
  if (Array.isArray(droppedItems) && droppedItems.some((d) => active(d?.status))) return true;
  return false;
}

// Decode persisted presentation text (titles, reasons, sources, keywords)
// with the shared safe entity decoder — never dangerouslySetInnerHTML.
export function decodedRowText(value) {
  return decodeHtmlEntities(value ?? '');
}

export function decodedKeywords(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return list.map((k) => decodeHtmlEntities(String(k)).trim()).filter(Boolean);
}
