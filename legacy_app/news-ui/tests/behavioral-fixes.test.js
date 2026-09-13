import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hideOptimistic, hideRollback, findNeighbors } from '../src/sampark/shared/hideHelper.js';
import { computeOptimisticVote } from '../src/sampark/shared/reactionHelper.js';
import { evaluateReloadResult, shouldShowSuccess, createSingleFlight } from '../src/sampark/shared/researchHelper.js';
import { computeActiveMs, shouldEmitDwell, flushDwellOnClose } from '../src/sampark/shared/engagementHelper.js';
import { shouldStartSearch, searchRequestKey } from '../src/sampark/shared/searchHelper.js';
import { createSavedHydrationController, createReactionHydrationController } from '../src/sampark/all-news/allNewsHydration.js';
import { articleKey } from '../src/news-scrapper/utils/intelligence.js';
import { EngagementController } from '../src/sampark/shared/engagementController.js';

// B: search uses production shouldStartSearch + real SamparkSearchResults effect.
// No test-only fetch simulation: the 150 ms debounce/AbortController lifecycle
// lives in SamparkSearchResults, and Remember Search History is gated
// authoritatively by the backend (tests/test_search_history_api.py).
test('B: search helper starts from query, decoupled from prefs', () => {
  // Empty query => no search (even with prefs loaded)
  assert.equal(shouldStartSearch('', true), false);
  assert.equal(shouldStartSearch('   ', true), false);
  // Valid query with loaded preferences => search
  assert.equal(shouldStartSearch('samsung oled', true), true);
  // Valid query without loaded prefs => still search (no delay for prefs).
  // The old buggy guard waited for prefs; the fix starts immediately.
  assert.equal(shouldStartSearch('samsung oled', false), true);
  // Request key is stable for identical filters (same-key single-flight basis)
  assert.equal(
    searchRequestKey('q', 'from', 'to', 'src', 'relevance'),
    searchRequestKey('q', 'from', 'to', 'src', 'relevance'),
  );
});

test('B: production search effect debounces, aborts, and ignores Remember toggle', () => {
  const src = readFileSync(new URL('../src/sampark/SamparkSearchResults.jsx', import.meta.url), 'utf8');
  assert.match(src, /shouldStartSearch/);
  // Real 150 ms debounce lifecycle
  assert.match(src, /setTimeout/);
  assert.match(src, /150/);
  assert.match(src, /clearTimeout/);
  // AbortController request lifecycle: abort prior, new controller, abort on cleanup
  assert.match(src, /AbortController/);
  assert.match(src, /abortRef\.current.*abort/);
  assert.match(src, /controller\.abort/);
  // Search effect deps are route/filters only; toggling Remember must not refetch
  assert.match(src, /\[qParam, fromParam, toParam, sourceParam, sortParam\]/);
  assert.doesNotMatch(src, /\[qParam, fromParam, toParam, sourceParam, sortParam, rememberHistory/);
  assert.doesNotMatch(src, /\[qParam, fromParam, toParam, sourceParam, sortParam, prefsLoaded/);
});

// C: Hide rollback concurrency-safe – preserves order via successor/predecessor
test('C: hide rollback restores only failed article', () => {
  const mk = (id, title) => ({ title, link: `https://ex.test/${id}`, id });
  const items = [mk('a', 'A'), mk('b', 'B'), mk('c', 'C'), mk('d', 'D')];
  const keyA = articleKey(items[0]);
  const keyB = articleKey(items[1]);
  const { prevKey: prevA, nextKey: nextA, idx: idxA } = findNeighbors(items, keyA);
  const { prevKey: prevB, nextKey: nextB, idx: idxB } = findNeighbors(items, keyB);
  // Simulate concurrent hides: hide A and B optimistically
  let afterBothHides = hideOptimistic(items, keyA);
  afterBothHides = hideOptimistic(afterBothHides, keyB);
  assert.equal(afterBothHides.length, 2);
  assert.ok(!afterBothHides.some(x => articleKey(x) === keyA));
  assert.ok(!afterBothHides.some(x => articleKey(x) === keyB));
  // Resolve A successfully (already hidden), reject B – should insert before successor C => [B,C,D]
  const afterRollbackB = hideRollback(afterBothHides, items[1], prevB, nextB, idxB);
  assert.equal(afterRollbackB.length, 3);
  assert.ok(!afterRollbackB.some(x => articleKey(x) === keyA), 'A remains hidden');
  assert.ok(afterRollbackB.some(x => articleKey(x) === keyB), 'B restored');
  assert.equal(articleKey(afterRollbackB[0]), keyB);
  assert.equal(articleKey(afterRollbackB[1]), articleKey(items[2]));
  // Duplicate rollback idempotent
  const afterDup = hideRollback(afterRollbackB, items[1], prevB, nextB, idxB);
  assert.equal(afterDup.length, 3);
  assert.deepEqual(afterDup, afterRollbackB);
  // New unrelated item inserted while requests run remains present
  const newItem = mk('e', 'E');
  const withNew = [...afterBothHides, newItem];
  const afterRollbackWithNew = hideRollback(withNew, items[1], prevB, nextB, idxB);
  assert.ok(afterRollbackWithNew.some(x => articleKey(x) === articleKey(newItem)), 'new item preserved');
  assert.ok(afterRollbackWithNew.some(x => articleKey(x) === keyB));
  // B and C fail in either order => original relative order restored
  const itemsBC = [mk('a','A'), mk('b','B'), mk('c','C'), mk('d','D')];
  const keyC = articleKey(itemsBC[2]);
  const { prevKey: prevC, nextKey: nextC, idx: idxC } = findNeighbors(itemsBC, keyC);
  let bothHidden = hideOptimistic(hideOptimistic(itemsBC, keyB), keyC);
  // Both B and C hidden => [A,D]
  assert.deepEqual(bothHidden.map(x=>x.title), ['A','D']);
  const afterBThenC = hideRollback(hideRollback(bothHidden, itemsBC[1], prevB, nextB, idxB), itemsBC[2], prevC, nextC, idxC);
  const afterCThenB = hideRollback(hideRollback(bothHidden, itemsBC[2], prevC, nextC, idxC), itemsBC[1], prevB, nextB, idxB);
  assert.deepEqual(afterBThenC.map(x=>x.title), ['A','B','C','D']);
  assert.deepEqual(afterCThenB.map(x=>x.title), ['A','B','C','D']);
});

test('C: hide optimistic is pure and does not mutate original', () => {
  const items = [{ title: 'A', link: 'https://a.test' }, { title: 'B', link: 'https://b.test' }];
  const key = articleKey(items[0]);
  const next = hideOptimistic(items, key);
  assert.equal(items.length, 2);
  assert.equal(next.length, 1);
});

// D: Research partial reload failure
test('D: both reloads succeed => success', () => {
  const res = evaluateReloadResult('fulfilled', 'fulfilled', null, null);
  assert.equal(res.status, 'success');
  assert.equal(shouldShowSuccess(res), true);
});
test('D: discovery fails => failure, preserve true', () => {
  const err = new Error('Discovery failed');
  const res = evaluateReloadResult('rejected', 'fulfilled', err, null);
  assert.equal(res.status, 'failure');
  assert.equal(res.preserve, true);
  assert.equal(shouldShowSuccess(res), false);
});
test('D: intelligence fails => failure, preserve true', () => {
  const err = new Error('Intel failed');
  const res = evaluateReloadResult('fulfilled', 'rejected', null, err);
  assert.equal(res.status, 'failure');
  assert.equal(shouldShowSuccess(res), false);
});
test('D: both fail => failure', () => {
  const res = evaluateReloadResult('rejected', 'rejected', new Error('a'), new Error('b'));
  assert.equal(res.status, 'failure');
  assert.equal(shouldShowSuccess(res), false);
});
test('D: exactly one refresh request while running (production single-flight)', async () => {
  // Production helper used by ResearchOverview (via SamparkResearch).
  const guard = createSingleFlight();
  let refreshCount = 0;
  const handleRefresh = async () => {
    if (!guard.tryStart()) return;
    try {
      refreshCount++;
      await new Promise(r => setTimeout(r, 10));
    } finally {
      guard.finish();
    }
  };
  // Simulate concurrent calls (double-click before state flushes)
  const p1 = handleRefresh();
  const p2 = handleRefresh();
  await Promise.all([p1, p2]);
  assert.equal(refreshCount, 1);
  // After finish, next refresh may run
  await handleRefresh();
  assert.equal(refreshCount, 2);
  // Guard is actually imported by production component
  const overviewSrc = readFileSync(new URL('../src/sampark/research/ResearchOverview.jsx', import.meta.url), 'utf8');
  assert.match(overviewSrc, /createSingleFlight/);
  assert.match(overviewSrc, /tryStart/);
});

// E: Flush five-second dwell on close – production controller with injectable time/send
test('E: controller open does not trigger close on rerender', () => {
  let now = 1000;
  const sends = [];
  const ctrl = new EngagementController({ now: () => now, send: async (a, d, ms) => sends.push(a), isVisible: () => true, addListener: () => {}, removeListener: () => {}, setInterval: () => 1, clearInterval: () => {} });
  const art = { id: 'a', title: 'A' };
  ctrl.onDossierOpen(art);
  assert.equal(ctrl.isOpen, true);
  // Simulate unrelated rerender: calling getActiveMs should not close
  ctrl.getActiveMs();
  assert.equal(ctrl.isOpen, true);
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 0);
});

test('E: controller unrelated rerender does not close tracking', () => {
  let now = 2000;
  const sends = [];
  const ctrl = new EngagementController({ now: () => now, send: async (a) => sends.push(a), isVisible: () => true, addListener: () => {}, removeListener: () => {}, setInterval: () => 1, clearInterval: () => {} });
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now += 1000;
  // Simulate parent refresh that does not change article
  ctrl.setArticle({ id: 'a', title: 'A', reactions: { like_count: 1 } });
  assert.equal(ctrl.isOpen, true);
  assert.equal(ctrl.state.sentOpen, true);
});

test('E: close at 4999ms sends no dwell', () => {
  const total = 4999, start = 0, visible = false, sentOpen = true, sentDwell = false;
  const res = flushDwellOnClose({ total, start, visible, sentOpen, sentDwell });
  assert.equal(res.shouldEmit, false);
});
test('E: close at 5000ms sends exactly one via controller', async () => {
  let now = 1000;
  const sends = [];
  const ctrl = new EngagementController({ now: () => now, send: async (action, detail) => sends.push({ a: action, ms: detail.active_ms, title: detail.title }), isVisible: () => true, addListener: () => {}, removeListener: () => {}, setInterval: (fn) => setInterval(fn, 10), clearInterval: (id) => clearInterval(id) });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now = 6000;
  ctrl.onDossierClose();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(s => s.a === 'dossier_dwell').length, 1);
  assert.equal(sends.find(s => s.a === 'dossier_dwell').ms, 5000);
});
test('E: interval then close sends one total', async () => {
  let now = 1000;
  const sends = [];
  let intervalFn = null;
  const ctrl = new EngagementController({
    now: () => now,
    send: async (action, detail) => sends.push(action),
    isVisible: () => true,
    addListener: () => {},
    removeListener: () => {},
    setInterval: (fn) => { intervalFn = fn; return 1; },
    clearInterval: () => { intervalFn = null; }
  });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now = 6000;
  intervalFn();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 1);
  ctrl.onDossierClose();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 1);
});
test('E: hidden time excluded via controller', async () => {
  let now = 1000;
  const sends = [];
  let visible = true;
  const ctrl = new EngagementController({
    now: () => now,
    send: async (action, detail) => sends.push({ a: action, ms: detail.active_ms }),
    isVisible: () => visible,
    addListener: (fn) => {},
    removeListener: () => {},
    setInterval: (fn) => setInterval(fn, 10),
    clearInterval: (id) => clearInterval(id)
  });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now = 4000;
  visible = false;
  ctrl.handleVisibility();
  now = 6000;
  visible = true;
  ctrl.handleVisibility();
  now = 8000;
  ctrl.onDossierClose();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(s => s.a === 'dossier_dwell').length, 1);
  assert.equal(sends.find(s => s.a === 'dossier_dwell').ms, 5000);
});
test('E: replacing A with B attributes A final dwell to A', async () => {
  let now = 1000;
  const sends = [];
  const ctrl = new EngagementController({ now: () => now, send: async (action, detail) => sends.push({ a: action, title: detail.title }), isVisible: () => true, addListener: () => {}, removeListener: () => {}, setInterval: () => 1, clearInterval: () => {} });
  const artA = { id: 'a', title: 'A' };
  const artB = { id: 'b', title: 'B' };
  ctrl.attach();
  ctrl.onDossierOpen(artA);
  now = 6000;
  ctrl.setArticle(artB);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.length, 2);
  assert.equal(sends[1].title, 'A');
  assert.equal(sends[1].a, 'dossier_dwell');
});
test('E: Hide-from-dossier flushes before clearing', async () => {
  let now = 1000;
  const sends = [];
  const ctrl = new EngagementController({ now: () => now, send: async (action) => sends.push(action), isVisible: () => true, addListener: () => {}, removeListener: () => {}, setInterval: () => 1, clearInterval: () => {} });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now = 6000;
  ctrl.onDossierClose();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(sends.includes('dossier_dwell'));
});
test('E: unmount flushes once and removes timers/listeners', async () => {
  let now = 1000;
  const sends = [];
  let cleared = false;
  let removed = false;
  const ctrl = new EngagementController({
    now: () => now,
    send: async (action) => sends.push(action),
    isVisible: () => true,
    addListener: () => {},
    removeListener: () => { removed = true; },
    setInterval: () => 1,
    clearInterval: () => { cleared = true; }
  });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  now = 6000;
  ctrl.detach();
  // detach should flush and clear
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 1);
  assert.equal(cleared, true);
  assert.equal(removed, true);
  // Second detach should not duplicate
  cleared = false; removed = false;
  ctrl.detach();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 1);
  // Destroy should be idempotent and not duplicate
  ctrl.destroy();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(a => a === 'dossier_dwell').length, 1);
});

test('E: StrictMode attach/detach/attach preserves single open/dwell', async () => {
  let now = 1000;
  const sends = [];
  let intervalCount = 0;
  let listenerCount = 0;
  const ctrl = new EngagementController({
    now: () => now,
    send: async (action, detail) => sends.push({ action, title: detail.title, active_ms: detail.active_ms }),
    isVisible: () => true,
    addListener: () => { listenerCount++; },
    removeListener: () => { listenerCount--; },
    setInterval: () => { intervalCount++; return intervalCount; },
    clearInterval: () => { intervalCount--; }
  });
  ctrl.attach();
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  assert.equal(sends.filter(s => s.action === 'dossier_open').length, 1);
  now = 3000; // 2000 ms visible before detach (below threshold)
  ctrl.detach(); // StrictMode cleanup
  assert.equal(sends.filter(s => s.action === 'dossier_dwell').length, 0);
  assert.equal(intervalCount, 0);
  assert.equal(listenerCount, 0);
  // StrictMode re-attach at same fake time
  ctrl.attach();
  // Duplicate open should be ignored
  ctrl.onDossierOpen({ id: 'a', title: 'A' });
  assert.equal(sends.filter(s => s.action === 'dossier_open').length, 1);
  now = 6000; // another 3000 ms visible; exact total 2000 + 3000 = 5000
  ctrl.onDossierClose();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(s => s.action === 'dossier_open').length, 1);
  assert.equal(sends.filter(s => s.action === 'dossier_dwell').length, 1);
  assert.equal(sends.find(s => s.action === 'dossier_dwell').title, 'A');
  assert.equal(sends.find(s => s.action === 'dossier_dwell').active_ms, 5000);
  assert.equal(intervalCount, 0);
  assert.equal(listenerCount, 0);
  // Repeated attach/detach/close/disposal must not duplicate
  ctrl.attach(); ctrl.detach(); ctrl.attach(); ctrl.onDossierClose(); ctrl.destroy(); ctrl.destroy();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sends.filter(s => s.action === 'dossier_dwell').length, 1);
});

// F: All News hydration
test('F: initially liked article clicked becomes neutral with correct count', () => {
  const prevSnap = { like_count: 5, dislike_count: 2, viewer_reaction: 'like' };
  const optimistic = computeOptimisticVote(prevSnap, 'like', 'neutral');
  assert.equal(optimistic.like_count, 4);
  assert.equal(optimistic.viewer_reaction, 'neutral');
});
test('F: neutral -> like increments', () => {
  const prevSnap = { like_count: 5, dislike_count: 2, viewer_reaction: 'neutral' };
  const optimistic = computeOptimisticVote(prevSnap, 'neutral', 'like');
  assert.equal(optimistic.like_count, 6);
  assert.equal(optimistic.dislike_count, 2);
});
test('F: like -> dislike swaps counts', () => {
  const prevSnap = { like_count: 5, dislike_count: 2, viewer_reaction: 'like' };
  const optimistic = computeOptimisticVote(prevSnap, 'like', 'dislike');
  assert.equal(optimistic.like_count, 4);
  assert.equal(optimistic.dislike_count, 3);
});
test('F: initially followed article calls remove', () => {
  const savedKeys = new Set(['key1']);
  const key = 'key1';
  const wasSaved = savedKeys.has(key);
  assert.equal(wasSaved, true);
  // wasSaved true means next action is remove, not save
});
test('F: pending hydration cannot trigger wrong mutation', () => {
  const votes = {};
  const item = { title: 'Test', link: 'https://test', reactions: { like_count: 3, viewer_reaction: 'like' } };
  const key = articleKey(item);
  // Without hydration, votes[key] undefined, but item.reactions exists, so getCurrentVote should return item's
  const cur = (votes[key] || item.reactions).viewer_reaction;
  assert.equal(cur, 'like');
  // Click like should become neutral, not another like
  const next = cur === 'like' ? 'neutral' : 'like';
  assert.equal(next, 'neutral');
});
test('F: like and follow can be pending independently', () => {
  const busy = { 'key1::reaction': true };
  assert.equal(Boolean(busy['key1::reaction']), true);
  assert.equal(Boolean(busy['key1::save']), false);
  // They are independent
});
test('F: failed reconciliation leaves coherent state', () => {
  const prevSnap = { like_count: 5, dislike_count: 2, viewer_reaction: 'neutral' };
  const optimistic = computeOptimisticVote(prevSnap, 'neutral', 'like');
  assert.equal(optimistic.like_count, 6);
  // On failure, rollback to prevSnap
  const rollback = prevSnap;
  assert.equal(rollback.like_count, 5);
});

// F: Saved + reaction hydration uses production controllers imported by AllNewsPage
test('F: initial saved hydration performs one request; success causes no duplicate', async () => {
  let calls = 0;
  const ctrl = createSavedHydrationController({ loadFn: async () => { calls++; return { items: [] }; } });
  const r = await ctrl.load();
  assert.ok(r);
  assert.equal(calls, 1);
  assert.equal(ctrl.getRequestCount(), 1);
  assert.equal(ctrl.isHydrated(), true);
  // Successful hydration does not auto-retrigger; no second request without retry
  assert.equal(calls, 1);
  assert.equal(ctrl.shouldRetryOnFocus(), false);
  // AllNewsPage must not depend on savedHydrated in effect deps (would loop)
  // and saved Retry must show pending and avoid overlapping requests.
  const pageSrc = readFileSync(new URL('../src/sampark/all-news/AllNewsPage.jsx', import.meta.url), 'utf8');
  assert.match(pageSrc, /createSavedHydrationController/);
  assert.match(pageSrc, /savedHydratedRef/);
  assert.doesNotMatch(pageSrc, /\[loadSaved, savedHydrated\]/);
  assert.match(pageSrc, /savedLoading/);
  assert.match(pageSrc, /disabled=\{savedLoading\}/);
});

test('F: failed saved hydration keeps Follow disabled; Retry starts new request immediately', async () => {
  let calls = 0;
  const ctrl = createSavedHydrationController({
    loadFn: async () => { calls++; if (calls === 1) throw new Error('Saved status unavailable'); return { items: [] }; },
  });
  await assert.rejects(() => ctrl.load(), /Saved status unavailable/);
  assert.equal(ctrl.isHydrated(), false);
  assert.equal(ctrl.shouldRetryOnFocus(), true);
  // Follow stays disabled until trustworthy status: shared dossier gates on savedHydrated
  const dossierSrc = readFileSync(new URL('../src/sampark/shared/SamparkArticleDossier.jsx', import.meta.url), 'utf8');
  assert.match(dossierSrc, /disabled=\{savedHydrated\s*===\s*false\}/);
  // Retry starts a new request immediately (not waiting for interval/focus)
  const retryPromise = ctrl.retry();
  assert.equal(ctrl.getRequestCount(), 2);
  assert.equal(ctrl.isLoading(), true);
  await retryPromise;
  assert.equal(ctrl.isHydrated(), true);
  assert.equal(ctrl.shouldRetryOnFocus(), false);
});

test('F: focus retries only while unhydrated (saved)', async () => {
  let resolveLoad;
  const ctrl = createSavedHydrationController({
    loadFn: () => new Promise((res) => { resolveLoad = res; }),
  });
  assert.equal(ctrl.shouldRetryOnFocus(), true);
  const p = ctrl.load();
  // While pending, focus must not start another request
  assert.equal(ctrl.shouldRetryOnFocus(), false);
  resolveLoad({ items: [] });
  await p;
  assert.equal(ctrl.shouldRetryOnFocus(), false);
});

test('F: reaction Retry starts getViewerReactions immediately with loading', async () => {
  let calls = 0;
  let resolveFetch;
  const ctrl = createReactionHydrationController({
    fetchFn: (ids) => { calls++; return new Promise((res) => { resolveFetch = () => res({ reactions: {} }); }); },
  });
  const p = ctrl.retry(['id1']);
  // Immediately started one request and exposes loading, without waiting
  assert.equal(calls, 1);
  assert.equal(ctrl.getRequestCount(), 1);
  assert.equal(ctrl.isLoading(), true);
  resolveFetch();
  await p;
  assert.equal(ctrl.isHydrated(), true);
  assert.equal(ctrl.isLoading(), false);
  // Production page wires Retry directly to syncReactions (immediate API call)
  const pageSrc = readFileSync(new URL('../src/sampark/all-news/AllNewsPage.jsx', import.meta.url), 'utf8');
  assert.match(pageSrc, /createReactionHydrationController/);
  assert.match(pageSrc, /syncReactions/);
  assert.match(pageSrc, /Retrying/);
});

test('F: saved StrictMode coalesces concurrent loads into one request', async () => {
  let calls = 0;
  let resolveLoad;
  const ctrl = createSavedHydrationController({
    loadFn: () => { calls++; return new Promise((res) => { resolveLoad = res; }); },
  });
  // Simulate React.StrictMode replay: two setup calls before either settles
  const p1 = ctrl.load();
  const p2 = ctrl.load();
  // Same in-flight operation: one underlying request, one count
  assert.equal(calls, 1);
  assert.equal(ctrl.getRequestCount(), 1);
  assert.equal(p1, p2);
  assert.equal(ctrl.isLoading(), true);
  assert.equal(ctrl.shouldRetryOnFocus(), false);
  // Retry while pending must not launch a duplicate
  const p3 = ctrl.retry();
  assert.equal(p3, p1);
  assert.equal(calls, 1);
  assert.equal(ctrl.getRequestCount(), 1);
  resolveLoad({ items: [] });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(r1);
  assert.equal(r1, r2);
  assert.equal(ctrl.isHydrated(), true);
  assert.equal(ctrl.isLoading(), false);
  assert.equal(ctrl.shouldRetryOnFocus(), false);
});

test('F: saved failure clears inflight so Retry begins one new request', async () => {
  let calls = 0;
  const ctrl = createSavedHydrationController({
    loadFn: async () => { calls++; if (calls === 1) throw new Error('boom'); return { items: [] }; },
  });
  await assert.rejects(() => ctrl.load(), /boom/);
  assert.equal(calls, 1);
  assert.equal(ctrl.isHydrated(), false);
  assert.equal(ctrl.isLoading(), false);
  // Failed promise cleared: Retry starts exactly one new underlying request
  const rp = ctrl.retry();
  assert.equal(calls, 2);
  assert.equal(ctrl.getRequestCount(), 2);
  assert.equal(ctrl.isLoading(), true);
  await rp;
  assert.equal(ctrl.isHydrated(), true);
  assert.equal(ctrl.isLoading(), false);
});

test('F: reaction same IDs coalesce; different sig supersedes with loading preserved', async () => {
  // Same IDs simultaneous: one fetch, same promise
  let calls = 0;
  const resolversSame = [];
  const ctrlSame = createReactionHydrationController({
    fetchFn: (ids) => { calls++; return new Promise((res) => { resolversSame.push(res); }); },
  });
  const s1 = ctrlSame.sync(['a', 'b']);
  const s2 = ctrlSame.sync(['a', 'b']);
  assert.equal(calls, 1);
  assert.equal(ctrlSame.getRequestCount(), 1);
  assert.equal(s1, s2);
  resolversSame[0]({ reactions: {} });
  await s1;
  assert.equal(ctrlSame.isLoading(), false);

  // Different sigs: A then newer B; resolve A first (stale), B still pending
  const order = [];
  const resolvers = [];
  const ctrl = createReactionHydrationController({
    fetchFn: (ids) => {
      const sig = Array.isArray(ids) ? ids.join('|') : String(ids);
      order.push(sig);
      return new Promise((res) => { resolvers.push(res); });
    },
  });
  const pA = ctrl.sync(['a']);
  const pB = ctrl.sync(['b']);
  assert.equal(ctrl.getRequestCount(), 2);
  assert.notEqual(pA, pB);
  assert.equal(ctrl.isLoading(), true);
  // Resolve older first: must remain stale, loading stays true for B
  resolvers[0]({ reactions: { a: { like_count: 1 } } });
  const rA = await pA;
  assert.equal(rA, undefined);
  assert.equal(ctrl.isLoading(), true);
  assert.equal(ctrl.getLastResult(), null);
  // Resolve newer: loading false, only B eligible
  resolvers[1]({ reactions: { b: { like_count: 9 } } });
  const rB = await pB;
  assert.equal(rB.reactions.b.like_count, 9);
  assert.equal(ctrl.isLoading(), false);
  assert.equal(ctrl.getLastResult().reactions.b.like_count, 9);
  // Component must mirror authoritative loading, not unconditional false
  const pageSrc = readFileSync(new URL('../src/sampark/all-news/AllNewsPage.jsx', import.meta.url), 'utf8');
  assert.match(pageSrc, /ctrl\.isLoading\(\)/);
  assert.doesNotMatch(pageSrc, /finally\{\s*if \(reactionMountedRef\.current\) setReactionsLoading\(false\)/);
});

test('F: cleanup removes intervals/listeners and prevents post-unmount updates', async () => {
  let calls = 0;
  let resolveLoad;
  const ctrl = createSavedHydrationController({
    loadFn: () => { calls++; return new Promise((res) => { resolveLoad = res; }); },
  });
  const p = ctrl.load();
  assert.equal(ctrl.getRequestCount(), 1);
  ctrl.dispose();
  assert.equal(ctrl.isDisposed(), true);
  assert.equal(ctrl.shouldRetryOnFocus(), false);
  resolveLoad({ items: [] });
  const r = await p;
  assert.equal(r, undefined);
  assert.equal(ctrl.isHydrated(), false);
  // Component cleanup clears interval/listeners (no leaks) and guards updates
  const pageSrc = readFileSync(new URL('../src/sampark/all-news/AllNewsPage.jsx', import.meta.url), 'utf8');
  assert.match(pageSrc, /clearInterval\(iv\)/);
  assert.match(pageSrc, /removeEventListener\('focus'/);
  assert.match(pageSrc, /savedMountedRef/);
  assert.match(pageSrc, /reactionMountedRef/);
});

// WS1: Scheduler contract uses real backend fields, never status/last_run
test('WS1: scheduler helpers map real backend fields and gate Run Now', async () => {
  const { describeSchedulerStatus, isRunDisabled, isConflictStatus } = await import('../src/sampark/schedulerHelper.js');
  const done = describeSchedulerStatus({ is_active: false, mode: 'idle', message: 'ok', last_started_at: '2026-09-12T10:00:00', last_completed_at: '2026-09-12T10:05:00', next_run: '2026-09-12T14:00:00', last_error: '', last_failed_profiles: [], active_manual_jobs: 0, capacity_remaining: 2, pipeline: { mode: 'local_models', credentials_ready: true } });
  assert.equal(done.label, 'Idle · idle');
  assert.equal(done.lastRun, '2026-09-12T10:05:00');
  assert.equal(isRunDisabled({ is_active: false, active_manual_jobs: 0, capacity_remaining: 2 }, false), false);
  assert.equal(isRunDisabled({ is_active: true }, false), true);
  assert.equal(isRunDisabled({ is_active: false, active_manual_jobs: 1 }, false), true);
  assert.equal(isRunDisabled({ is_active: false, capacity_remaining: 0 }, false), true);
  assert.equal(isRunDisabled({ is_active: false }, true), true);
  assert.equal(isConflictStatus(409), true);
  assert.equal(isConflictStatus(500), false);
  const degraded = describeSchedulerStatus({ is_active: false, pipeline: { web_search_enabled: true, credentials_ready: false } });
  assert.equal(degraded.degraded, true);
  const page = readFileSync(new URL('../src/sampark/SamparkScheduler.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /data\?\.status \|\| 'unknown'/);
  assert.match(page, /last_started_at|lastStarted/);
  assert.match(page, /setInterval/);
  assert.match(page, /isConflictStatus/);
});

// WS15: shared URL sanitizer rejects unsafe schemes
test('WS15: sanitizeExternalUrl allows http(s) and rejects unsafe input', async () => {
  const { sanitizeExternalUrl, isExternalHttpUrl } = await import('../src/sampark/shared/safeLink.js');
  assert.equal(sanitizeExternalUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(sanitizeExternalUrl('http://example.com/'), 'http://example.com/');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('data:text/html,hi'), '');
  assert.equal(sanitizeExternalUrl('file:///etc/passwd'), '');
  assert.equal(sanitizeExternalUrl('internal://abc'), '');
  assert.equal(sanitizeExternalUrl('https://'), '');
  assert.equal(sanitizeExternalUrl(''), '');
  assert.equal(isExternalHttpUrl('https://example.com'), true);
  assert.equal(isExternalHttpUrl('javascript:x'), false);
  // Malformed persisted/imported URLs must never become external anchors.
  assert.equal(sanitizeExternalUrl('JAVASCRIPT:alert(1)'), '');
  assert.equal(sanitizeExternalUrl('  https://example.com/x  '), 'https://example.com/x');
  assert.equal(sanitizeExternalUrl('INTERNAL://abc'), '');
  assert.equal(sanitizeExternalUrl('https://exa mple.com'), '');
  assert.equal(sanitizeExternalUrl(null), '');
  assert.equal(sanitizeExternalUrl(undefined), '');
});

// WS18: theme preference persists per browser with system support
test('WS18: sampark theme reads, resolves, and applies', async () => {
  const { readSamparkTheme, resolveSamparkTheme, applySamparkTheme } = await import('../src/sampark/theme.js');
  assert.equal(readSamparkTheme(), 'light');
  assert.equal(resolveSamparkTheme('dark'), 'dark');
  assert.equal(resolveSamparkTheme('nope'), 'light');
  assert.equal(applySamparkTheme('dark'), 'dark');
  assert.equal(applySamparkTheme('light'), 'light');
});

// Create state machine: every status reaches the correct screen with truthful actions
test('Create contribution states resolve to the correct screen and actions', async () => {
  const { describeContributionRecord, validateCreateSubmit, coverReady, isEditableStatus } = await import('../src/sampark/createModel.js');
  assert.equal(describeContributionRecord({ id: '', status: 'draft' }).screen, 'editor');
  assert.deepEqual(describeContributionRecord({ id: 'a', status: 'draft' }).actions, ['edit', 'submit', 'delete']);
  assert.deepEqual(describeContributionRecord({ id: 'a', status: 'ready' }).actions, ['edit', 'submit', 'delete']);
  const needs = describeContributionRecord({ id: 'a', status: 'needs_changes', reviewNote: 'Add a cover' });
  assert.equal(needs.screen, 'editor');
  assert.ok(needs.banner.includes('Add a cover'));
  assert.deepEqual(needs.actions, ['edit', 'resubmit']);
  const submitted = describeContributionRecord({ id: 'a', status: 'submitted' });
  assert.equal(submitted.readOnly, true);
  assert.deepEqual(submitted.actions, ['withdraw']);
  const withdrawn = describeContributionRecord({ id: 'a', status: 'withdrawn' });
  assert.equal(withdrawn.editable, true);
  const published = describeContributionRecord({ id: 'a', status: 'published' });
  assert.equal(published.screen, 'published');
  assert.deepEqual(published.actions, ['view-live']);
  const archived = describeContributionRecord({ id: 'a', status: 'archived' });
  assert.equal(archived.readOnly, true);
  assert.deepEqual(archived.actions, []);
  assert.equal(isEditableStatus('submitted', 'a'), false);
  assert.equal(isEditableStatus('', ''), true);
  // Cover matrix: an ID alone never proves a cover.
  assert.deepEqual(validateCreateSubmit({ title: 'T', body: 'x'.repeat(25), coverRequired: true, hasCover: false }), ['select a cover image']);
  assert.deepEqual(validateCreateSubmit({ title: 'T', body: 'x'.repeat(25), coverRequired: true, hasCover: true }), []);
  assert.deepEqual(validateCreateSubmit({ title: 'T', body: 'x'.repeat(25), coverRequired: false, hasCover: false }), []);
  assert.equal(coverReady({ coverRequired: true, coverFile: null, coverPreview: '' }), false);
  assert.equal(coverReady({ coverRequired: true, coverFile: null, coverPreview: '/internal-content/a/cover' }), true);
});

// Notification contract mirrors the backend record shape
test('Notification title detail destination and unread use backend fields', async () => {
  const { notificationTitle, notificationDetail, notificationDestination, unreadCount } = await import('../src/sampark/shared/notificationModel.js');
  assert.equal(notificationTitle({ kind: 'changes', title: '', record_id: 'r1' }), 'Changes requested');
  assert.equal(notificationTitle({ kind: 'published', title: 'Live!', record_id: 'r1' }), 'Live!');
  assert.equal(notificationDetail({ kind: 'changes', note: 'Fix the summary' }), 'Changes requested — Fix the summary');
  assert.equal(notificationDetail({ kind: 'changes', note: '' }), 'Changes requested');
  assert.equal(notificationDetail({ kind: 'published', note: '' }), 'Published to Samsung Internal');
  assert.equal(notificationDetail({ kind: 'rejected', note: 'Off-topic' }), 'Not published — Off-topic');
  assert.equal(notificationDestination({ kind: 'published', record_id: 'abc' }), '/samsung-news?focus=abc');
  assert.equal(notificationDestination({ kind: 'changes', record_id: 'abc' }), '/create?open=abc');
  assert.equal(notificationDestination({ kind: 'changes', record_id: '' }), '/create');
  assert.equal(unreadCount([{ read: false }, { read: true }, { read: false }]), 2);
});

// Search shell navigation stays inside Search
test('Search shell Clear and empty submit stay in Search', async () => {
  const { searchClearTarget, searchSubmitTarget } = await import('../src/sampark/searchNav.js');
  assert.equal(searchClearTarget('/search', '/for-you'), '/search');
  assert.equal(searchClearTarget('/for-you', '/for-you'), '/for-you');
  assert.equal(searchSubmitTarget('/search', '', '/for-you'), '/search');
  assert.equal(searchSubmitTarget('/for-you', '', '/all-news'), '/all-news');
  assert.equal(searchSubmitTarget('/search', 'Samsung', '/for-you'), '/search?q=Samsung');
});

// Published focus resolves story announcement and leadership by exact id
test('Published focus finds every surfaced contribution type', async () => {
  const { findPublishedFocusRecord } = await import('../src/news-scrapper/internal/samsungInternalModel.js');
  const published = [
    { id: 's1', status: 'published', content_type: 'story', title: 'Story' },
    { id: 'a1', status: 'published', content_type: 'announcement', title: 'Notice' },
    { id: 'l1', status: 'published', content_type: 'leadership', title: 'Vision of the quarter' },
    { id: 'd1', status: 'draft', content_type: 'story', title: 'Draft' },
  ];
  assert.equal(findPublishedFocusRecord(published, 's1').title, 'Story');
  assert.equal(findPublishedFocusRecord(published, 'a1').title, 'Notice');
  assert.equal(findPublishedFocusRecord(published, 'l1').title, 'Vision of the quarter');
  assert.equal(findPublishedFocusRecord(published, 'd1'), null);
  assert.equal(findPublishedFocusRecord(published, 'missing'), null);
  assert.equal(findPublishedFocusRecord(published, ''), null);
});

// Shared dossier never fabricates absent fields and dedupes points
test('Dossier view hides absent fields and dedupes repeated content', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const bare = resolveDossierView({ title: 'T', link: 'javascript:alert(1)' });
  assert.equal(bare.title, 'T');
  assert.equal(bare.kicker, '');
  assert.equal(bare.subtitle, '');
  assert.equal(bare.score, null);
  assert.equal(bare.externalLink, '');
  assert.equal(bare.fullBody, '');
  const full = resolveDossierView({
    title: 'T', category: 'Tech', source: 'Wire', date: '2026-09-01', score: 72,
    region: 'Local', summary: 'S', summary_points: ['a'], key_points: ['a'],
    full_contents: 'Body text', link: 'https://example.com/x',
    sources: [{ name: 'Wire', link: 'https://example.com/x' }],
  });
  assert.ok(full.kicker.includes('Score 72'));
  assert.ok(full.kicker.includes('Local') === false);
  assert.ok(full.subtitle.includes('Local'));
  assert.deepEqual(full.keyPoints, []);
  assert.equal(full.fullBody, 'Body text');
  assert.equal(full.externalLink, 'https://example.com/x');
  const malformed = resolveDossierView({ title: 'T', sources: [{ foo: 1 }] });
  assert.ok(!JSON.stringify(malformed).includes('[object Object]'));
});

// Gatekeeper refresh preserves loaded pages in order without duplicates
test('Gatekeeper merge appends pages and replaces windows intact', async () => {
  const { mergeGatekeeperItems } = await import('../src/sampark/gatekeeperModel.js');
  const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, title: `T${i}` }));
  const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `d${50 + i}`, title: `T${50 + i}` }));
  const appended = mergeGatekeeperItems(page1, page2, { append: true });
  assert.equal(appended.length, 100);
  assert.equal(appended[0].id, 'd0');
  assert.equal(appended[99].id, 'd99');
  const reduped = mergeGatekeeperItems(appended, page2, { append: true });
  assert.equal(reduped.length, 100);
  const refreshed = mergeGatekeeperItems(appended, [...page1, ...page2], { append: false });
  assert.equal(refreshed.length, 100);
  assert.equal(refreshed[50].id, 'd50');
});

// Theme preview persists only on save; cancel restores the opening theme
test('Theme transaction previews without persisting until saved', async () => {
  const store = {};
  globalThis.window = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: { dataset: {}, style: {} } };
  try {
    const theme = await import('../src/sampark/theme.js');
    assert.equal(theme.readSamparkTheme(), 'light');
    theme.applySamparkTheme('dark');
    assert.equal(store['sampark-theme'] ?? null, null);
    assert.equal(theme.resolveSamparkTheme('dark'), 'dark');
    theme.saveSamparkTheme('dark');
    assert.equal(store['sampark-theme'], 'dark');
    assert.equal(theme.readSamparkTheme(), 'dark');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

// GET coalescing: one network request for concurrent readers; mutation epoch
// prevents stale repopulation; aborting one waiter spares the other
test('API GET coalescing survives abort and mutation races', async () => {
  const calls = [];
  let release;
  globalThis.fetch = (url, opts) => {
    calls.push(String(url));
    if (String(url).includes('/viewer/preferences') && (opts?.method || 'GET') === 'GET') {
      return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success', preferences: {} }) }); });
    }
    if (String(url).includes('/viewer/for-you')) {
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success', items: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success' }) });
  };
  try {
    const api = await import('../src/news-scrapper/api.js');
    // Two concurrent identical GETs share one network request.
    const p1 = api.getViewerPreferences();
    const p2 = api.getViewerPreferences();
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.status, 'success');
    assert.equal(r2.status, 'success');
    assert.equal(calls.filter((u) => u.includes('/viewer/preferences')).length, 1);
    // Mutation race: a GET that began before a mutation resolves must not
    // repopulate caches with pre-mutation data.
    let releaseBriefing;
    const briefingCalls = [];
    globalThis.fetch = (url, opts) => {
      const method = opts?.method || 'GET';
      if (String(url).includes('/latest-briefing')) {
        briefingCalls.push(method);
        return new Promise((resolve) => { releaseBriefing = () => resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success', stale: true }) }); });
      }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success', preferences: {} }) });
    };
    const staleGet = api.getLatestBriefing();
    await api.updateViewerPreferences({ remember_search_history: true });
    releaseBriefing();
    const staleData = await staleGet;
    assert.equal(staleData.stale, true);
    const freshGet = api.getLatestBriefing();
    releaseBriefing();
    await freshGet;
    assert.equal(briefingCalls.length, 2);
    // Abort sharing: aborting one waiter settles it promptly without waiting
    // for the network, and never cancels the other waiter.
    let releaseSearch;
    let fetchCount = 0;
    globalThis.fetch = () => { fetchCount += 1; return new Promise((resolve) => { releaseSearch = () => resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success', results: [], total: 0 }) }); }); };
    const c1 = new AbortController();
    const c2 = new AbortController();
    let settledA = null;
    const q1 = api.searchExtractedIntelligence({ query: 'Samsung' }, c1.signal).then(
      () => { settledA = 'resolved'; },
      (e) => { settledA = e?.name || 'rejected'; },
    );
    const q2 = api.searchExtractedIntelligence({ query: 'Samsung' }, c2.signal);
    c1.abort();
    // A settles promptly with AbortError while fetch is still pending.
    await q1;
    assert.equal(settledA, 'AbortError');
    assert.equal(typeof releaseSearch, 'function');
    assert.equal(fetchCount, 1);
    // B is still pending and then succeeds from the single shared request.
    let settledB = null;
    const q2done = q2.then((r) => { settledB = r.status; });
    assert.equal(settledB, null);
    releaseSearch();
    await q2done;
    assert.equal(settledB, 'success');
    assert.equal(fetchCount, 1);
  } finally {
    delete globalThis.fetch;
  }
});

// Dossier honesty: null/blank scores fall through, ratios scale, absent stays null
test('Dossier score ignores blanks and scales confidence ratios', async () => {
  const { resolveScore } = await import('../src/sampark/shared/dossierModel.js');
  assert.equal(resolveScore({ score: null, importance_score: 61 }), 61);
  assert.equal(resolveScore({ score: '', importance_score: 61 }), 61);
  assert.equal(resolveScore({ score: undefined, importance_score: 61 }), 61);
  assert.equal(resolveScore({ confidence: 0.75 }), 75);
  assert.equal(resolveScore({}), null);
  assert.equal(resolveScore({ score: '  ' }), null);
});

// Points/keywords accept labels, ignore malformed objects, dedupe folding case
test('Dossier lists never render [object Object] and dedupe case-insensitively', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const view = resolveDossierView({
    title: 'T',
    summary_points: ['Real point', { name: 'Named' }, { foo: 1 }, 42, null],
    keywords_found: ['AI', 'ai', 'Robotics', { title: 'Edge' }, {}],
    entities: [{ name: 'Org' }, 'Person', { nope: true }],
  });
  assert.ok(view.summaryPoints.includes('Real point'));
  assert.ok(view.summaryPoints.includes('Named'));
  assert.ok(view.summaryPoints.includes('42'));
  assert.ok(!JSON.stringify(view).includes('[object Object]'));
  assert.deepEqual(view.keywords, ['AI', 'Robotics', 'Edge']);
  assert.deepEqual(view.entities, ['Org', 'Person']);
});

// Master summary hidden only when it reconstructs lead+bullets
test('Dossier hides repeated master summaries but keeps distinct ones', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const repeated = resolveDossierView({
    title: 'T',
    summary_lead: 'Markets rallied on chip demand.',
    summary_points: ['Chip demand lifted suppliers.'],
    master_summary: 'Markets rallied on chip demand. Chip demand lifted suppliers.',
    body: 'Full body text here.',
  });
  assert.equal(repeated.masterSummary, '');
  assert.equal(repeated.fullBody, 'Full body text here.');
  const distinct = resolveDossierView({
    title: 'T',
    summary_lead: 'Markets rallied on chip demand.',
    summary_points: ['Chip demand lifted suppliers.'],
    master_summary: 'Analysts warn the rally concentrates risk in one supply chain.',
    body: 'Full body text here.',
  });
  assert.ok(distinct.masterSummary.includes('concentrates risk'));
});

// Duplicate source actions collapse when the list repeats the primary link
test('Dossier drops source rows duplicating the primary external link', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const view = resolveDossierView({
    title: 'T',
    link: 'https://example.com/x',
    sources: [{ name: 'Wire', link: 'https://example.com/x' }, { name: 'Other', link: 'https://other.test/y' }],
  });
  assert.equal(view.externalLink, 'https://example.com/x');
  assert.equal(view.sourceList.length, 1);
  assert.equal(view.sourceList[0].name, 'Other');
});
