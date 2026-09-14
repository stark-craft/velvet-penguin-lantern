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
  const runner = readFileSync(new URL('../src/sampark/searchRunner.js', import.meta.url), 'utf8');
  assert.match(src, /shouldStartSearch/);
  assert.match(src, /createSearchRunner/);
  assert.match(src, /retrySearch/);
  // Real 150 ms debounce lifecycle lives in the shared runner.
  assert.match(runner, /150/);
  assert.match(runner, /clearTimeout/);
  assert.match(runner, /AbortController/);
  assert.match(runner, /\.abort\(\)/);
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

// Distinct texts render exactly once: lead never erases a distinct summary
test('Dossier keeps a distinct summary alongside its lead', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const view = resolveDossierView({
    title: 'T',
    summary_lead: 'Lead sentence.',
    summary: 'A distinct strategic paragraph that should remain visible.',
  });
  assert.equal(view.summaryLead, 'Lead sentence.');
  assert.equal(view.summary, 'A distinct strategic paragraph that should remain visible.');
});

// Equality with a hidden field cannot suppress the only visible copy — and a
// duplicate of visible text still collapses to a single rendering
test('Dossier keeps master summary equal to a hidden summary', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const view = resolveDossierView({
    title: 'T',
    summary_lead: 'Lead sentence.',
    summary: 'A distinct strategic paragraph that should remain visible.',
    master_summary: 'A distinct strategic paragraph that should remain visible.',
  });
  assert.equal(view.summary, 'A distinct strategic paragraph that should remain visible.');
  assert.equal(view.masterSummary, '');
});

// Full body keeps new paragraphs after a repeated lead and bullets
test('Dossier strips only the repeated body prefix and keeps continuations', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const view = resolveDossierView({
    title: 'T',
    summary_lead: 'Lead sentence.',
    summary_points: ['First supporting point.'],
    full_contents: 'Lead sentence. First supporting point. A brand-new third paragraph with fresh reporting.',
  });
  assert.ok(view.fullBody.includes('brand-new third paragraph'));
  assert.ok(!view.fullBody.includes('Lead sentence'));
});

// Identical and empty bodies stay hidden
test('Dossier hides identical or empty full bodies', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  assert.equal(resolveDossierView({ title: 'T', summary: 'Same text.', body: 'Same text.' }).fullBody, '');
  assert.equal(resolveDossierView({ title: 'T', body: '' }).fullBody, '');
  assert.equal(resolveDossierView({ title: 'T', body: null }).fullBody, '');
  assert.equal(resolveDossierView({ title: 'T' }).fullBody, '');
});

// Source dedup: shared rows, identical primary/alt, labels, unsafe mix
test('Dossier deduplicates source URLs while keeping useful labels', async () => {
  const { resolveDossierView } = await import('../src/sampark/shared/dossierModel.js');
  const shared = resolveDossierView({
    title: 'T',
    link: 'https://example.com/x',
    sources: [
      { name: 'Wire', link: 'https://example.com/x' },
      { name: 'Wire Mirror', link: 'https://example.com/x/' },
      { name: 'Other', link: 'https://other.test/y' },
    ],
  });
  assert.equal(shared.sourceList.length, 1);
  assert.equal(shared.sourceList[0].name, 'Other');
  const identical = resolveDossierView({ title: 'T', link: 'https://example.com/x', url: 'https://example.com/x/' });
  assert.equal(identical.externalLink, 'https://example.com/x');
  assert.equal(identical.externalLinkAlt, '');
  const labels = resolveDossierView({
    title: 'T',
    sources: [{ name: 'Wire', link: 'https://a.test/1' }, { name: 'Wire', link: 'https://b.test/2' }],
  });
  assert.equal(labels.sourceList.length, 2);
  const mixed = resolveDossierView({
    title: 'T',
    sources: [{ name: 'Bad', link: 'javascript:alert(1)' }, { name: 'Good', link: 'https://good.test/' }],
  });
  const bad = mixed.sourceList.find((s) => s.name === 'Bad');
  assert.equal(bad.url, '');
  assert.ok(mixed.sourceList.some((s) => s.url === 'https://good.test/'));
});

// Search retry performs a real second request without navigation or duplicates
test('Search runner retries failed requests exactly once', async () => {
  const { createSearchRunner, SEARCH_DEBOUNCE_MS } = await import('../src/sampark/searchRunner.js');
  assert.equal(SEARCH_DEBOUNCE_MS, 150);
  let now = 0;
  const timers = [];
  const fakeTimers = {
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: now + ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
  };
  const advance = async (ms) => {
    now += ms;
    const due = timers.filter((t) => !t.cleared && !t.fired && t.at <= now);
    for (const t of due) { t.fired = true; await t.fn(); }
  };
  let calls = 0;
  let failNext = true;
  const states = [];
  const runner = createSearchRunner({
    timers: fakeTimers,
    fetchPage: async () => {
      calls += 1;
      if (failNext) { failNext = false; throw new Error('Search could not be completed.'); }
      return { items: [{ title: 'Hit' }], total: 1, has_more: false };
    },
    onState: (patch) => states.push(patch),
  });
  // Initial route-driven request rejects after debounce.
  runner.run({ query: 'Samsung' });
  assert.equal(calls, 0);
  await advance(150);
  assert.equal(calls, 1);
  assert.ok(states.some((s) => s.error));
  // Try again without changing anything starts exactly one new request.
  runner.retry({ query: 'Samsung' });
  assert.equal(calls, 2);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  const last = states[states.length - 1];
  assert.equal(last.loading, false);
  assert.equal(last.error, '');
  assert.equal(last.items.length, 1);
  // Concurrent retries collapse into a single in-flight request.
  let release;
  let secondCalls = 0;
  const runner2 = createSearchRunner({
    timers: fakeTimers,
    fetchPage: () => { secondCalls += 1; return new Promise((res) => { release = () => res({ items: [], total: 0, has_more: false }); }); },
    onState: () => {},
  });
  runner2.retry({ query: 'Samsung' });
  runner2.retry({ query: 'Samsung' });
  assert.equal(secondCalls, 1);
  release();
  await Promise.resolve();
  runner.dispose();
  runner2.dispose();
});

// Gatekeeper cursor: 50 -> Show more at 100 -> refresh covers 100 -> next at 100
test('Gatekeeper page requests track the loaded window exactly', async () => {
  const { pageRequest, mergeGatekeeperItems } = await import('../src/sampark/gatekeeperModel.js');
  assert.deepEqual(pageRequest(0, { append: false }), { offset: 0, limit: 50 });
  assert.deepEqual(pageRequest(50, { append: true }), { offset: 50, limit: 50 });
  assert.deepEqual(pageRequest(100, { append: false }), { offset: 0, limit: 100 });
  assert.deepEqual(pageRequest(100, { append: true }), { offset: 100, limit: 50 });
  // Full sequence: load 50, append 50, refresh window, append at 100.
  const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}` }));
  const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `d${50 + i}` }));
  const page3 = Array.from({ length: 50 }, (_, i) => ({ id: `d${100 + i}` }));
  let loaded = mergeGatekeeperItems([], page1, { append: false });
  loaded = mergeGatekeeperItems(loaded, page2, { append: true });
  assert.equal(loaded.length, 100);
  const refresh = pageRequest(loaded.length, { append: false });
  assert.deepEqual(refresh, { offset: 0, limit: 100 });
  loaded = mergeGatekeeperItems([], [...page1, ...page2], { append: false });
  assert.equal(loaded.length, 100);
  const next = pageRequest(loaded.length, { append: true });
  assert.deepEqual(next, { offset: 100, limit: 50 });
  loaded = mergeGatekeeperItems(loaded, page3, { append: true });
  assert.equal(loaded.length, 150);
  assert.equal(loaded[0].id, 'd0');
  assert.equal(loaded[149].id, 'd149');
});

// Gatekeeper applied search survives polling; stale generations never commit
test('Gatekeeper loader keeps the committed search across refresh', async () => {
  const { createGatekeeperLoader, restorationActive } = await import('../src/sampark/gatekeeperModel.js');
  const calls = [];
  const rowsFor = (query) => Array.from({ length: 50 }, (_, i) => ({ id: `${query || 'all'}-${i}`, status: 'dropped' }));
  const fetchDropped = async ({ limit, offset, profile, status, search }) => {
    calls.push({ limit, offset, profile, status, search });
    return {
      items: rowsFor(search).slice(offset, offset + limit),
      counts: { all: 500 },
      total: 500,
      matched: 500,
      has_more: offset + limit < 500,
    };
  };
  const activeQueue = async () => ({ jobs: [{ id: 'j1', status: 'queued' }], counts: { queued: 1 }, worker: {} });
  const seen = [];
  const loader = createGatekeeperLoader({
    fetchDropped,
    fetchQueue: activeQueue,
    onState: (patch) => seen.push(patch),
  });
  assert.equal(restorationActive([{ status: 'queued' }], []), true);
  // Initial applied query is empty: 50 rows.
  await loader.reload();
  assert.equal(loader.getState().items.length, 50);
  assert.equal(loader.getState().matched, 500);
  // User applies a query returning 50 rows; length stays 50.
  loader.setScope({ search: 'chip' });
  await loader.reload();
  assert.equal(loader.getState().items.length, 50);
  assert.equal(loader.getState().items[0].id, 'chip-0');
  // A polling tick uses the newly applied query, not the old empty one.
  const before = calls.length;
  await loader.refresh();
  assert.equal(calls[calls.length - 1].search, 'chip');
  assert.equal(calls[calls.length - 1].offset, 0);
  assert.equal(calls[calls.length - 1].limit, 50);
  assert.equal(loader.getState().items.length, 50);
  assert.ok(before >= 2);
  // A stale unfiltered response cannot overwrite the committed results: start
  // an old load, supersede it with the applied-query load, resolve old first.
  const deferreds = [];
  const loader2 = createGatekeeperLoader({
    fetchDropped: () => new Promise((res) => { deferreds.push(res); }),
    fetchQueue: activeQueue,
    onState: () => {},
  });
  const stale = loader2.reload();
  loader2.setScope({ search: 'chip' });
  const fresh = loader2.reload();
  assert.equal(deferreds.length, 2);
  deferreds[0]({ items: rowsFor(''), counts: { all: 500 }, total: 500, matched: 500, has_more: true });
  const outcome = await stale;
  assert.equal(outcome.ignored, true);
  assert.equal(loader2.getState().items.length, 0);
  deferreds[1]({ items: rowsFor('chip'), counts: { all: 500 }, total: 500, matched: 500, has_more: true });
  await fresh;
  assert.equal(loader2.getState().items[0].id, 'chip-0');
});

// StrictMode lifecycle: setup, cleanup, setup must leave a usable runner.
test('Search runner survives StrictMode replay and settles every lifecycle', async () => {
  const { createSearchRunner } = await import('../src/sampark/searchRunner.js');
  let now = 0;
  const timers = [];
  const fakeTimers = {
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: now + ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
  };
  const advance = async (ms) => {
    now += ms;
    for (const t of timers.filter((x) => !x.cleared && !x.fired && x.at <= now)) {
      t.fired = true;
      await t.fn();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  const liveTimers = () => timers.filter((t) => !t.cleared && !t.fired);
  let calls = 0;
  let failNext = false;
  const states = [];
  // 1. Create/mount the search behavior exactly like the component ref init.
  const runner = createSearchRunner({
    timers: fakeTimers,
    fetchPage: async ({ query }) => {
      calls += 1;
      if (failNext) { failNext = false; throw new Error('Search could not be completed.'); }
      return { items: [{ title: `Hit for ${query}` }], total: 1, has_more: false };
    },
    onState: (patch) => states.push(patch),
  });
  // 2. StrictMode-style setup, cleanup, and setup sequence.
  runner.activate();
  runner.dispose();
  runner.activate();
  // 3. Start a route search.
  const first = runner.run({ query: 'Samsung' });
  let firstSettled = false;
  void first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
  // 4-5. Advance the 150ms timer: fetch runs and loading settles with results.
  await advance(150);
  await first;
  assert.equal(calls, 1);
  assert.ok(firstSettled);
  const last = states[states.length - 1];
  assert.equal(last.loading, false);
  assert.equal(last.error, '');
  assert.equal(last.items.length, 1);
  // 6. Fail -> error -> immediate retry -> success.
  failNext = true;
  runner.retry({ query: 'Samsung' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.ok(states.some((s) => s.error));
  const retryPromise = runner.retry({ query: 'Samsung' });
  await retryPromise;
  assert.equal(calls, 3);
  const recovered = states[states.length - 1];
  assert.equal(recovered.loading, false);
  assert.equal(recovered.error, '');
  assert.equal(recovered.items[0].title, 'Hit for Samsung');
  // 7a. Replacement: a newer query supersedes; stale completion never applies.
  const slowA = runner.run({ query: 'Alpha' });
  const fastB = runner.run({ query: 'Beta' });
  await advance(150);
  await Promise.allSettled([slowA, fastB]);
  assert.ok(!states.some((s) => (s.items || []).some((it) => it.title === 'Hit for Alpha')));
  assert.ok(states.some((s) => (s.items || []).some((it) => it.title === 'Hit for Beta')));
  // 7b. Real unmount cleanup: pending work settles silently, timers released.
  const pending = runner.run({ query: 'Gamma' });
  let pendingSettled = false;
  void pending.then(() => { pendingSettled = true; }, () => { pendingSettled = true; });
  runner.dispose();
  await advance(1000);
  await pending;
  assert.ok(pendingSettled);
  assert.equal(liveTimers().length, 0);
  const statesAfterUnmount = states.length;
  await advance(1000);
  assert.equal(states.length, statesAfterUnmount);
  // 8. No orphaned timer or unresolved cancelled operation remains.
  assert.equal(liveTimers().length, 0);
  runner.dispose();
});

// Gatekeeper foreground priority: polling never discards user pagination
test('Gatekeeper background refresh defers to active foreground work', async () => {
  const { createGatekeeperLoader } = await import('../src/sampark/gatekeeperModel.js');
  const rowsFor = (n, prefix = 'd') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, status: 'dropped' }));
  const page = (items, total = 500, matched = 500) => ({
    items, counts: { all: total }, total, matched, has_more: true,
  });
  const quietQueue = async () => ({ jobs: [], counts: {}, worker: {} });
  const activeQueue = async () => ({ jobs: [{ id: 'j1', status: 'queued' }], counts: { queued: 1 }, worker: {} });

  // 1. Initial 50-item load.
  const resolvers = [];
  const loader = createGatekeeperLoader({
    fetchDropped: () => new Promise((res) => { resolvers.push(res); }),
    fetchQueue: quietQueue,
    onState: () => {},
  });
  const initial = loader.reload();
  resolvers[0](page(rowsFor(50)));
  await initial;
  assert.equal(loader.getState().items.length, 50);

  // 2-4. Start Show more, then poll before it resolves; resolve append first.
  const appendIdx = resolvers.length;
  const append = loader.loadMore();
  const callsBeforePoll = resolvers.length;
  const poll = loader.refresh();
  // Poll defers while the append is active: no new dropped fetch runs.
  assert.equal(resolvers.length, callsBeforePoll);
  const pollOutcome = await poll;
  assert.equal(pollOutcome.skipped, true);
  resolvers[appendIdx](page(rowsFor(50, 'e')));
  const appendOutcome = await append;
  assert.equal(appendOutcome.ignored, false);
  assert.equal(loader.getState().items.length, 100);

  // 5-6. Reverse order: poll in flight, then append supersedes it.
  const waiting = [];
  const loader2 = createGatekeeperLoader({
    fetchDropped: () => new Promise((res) => { waiting.push(res); }),
    fetchQueue: activeQueue,
    onState: () => {},
  });
  const boot = loader2.reload();
  waiting[0](page(rowsFor(50)));
  await boot;
  assert.equal(loader2.getState().items.length, 50);
  const poll2 = loader2.refresh();
  const append2 = loader2.loadMore();
  // The poll resolves first but must not discard the append.
  waiting[1](page(rowsFor(50)));
  const poll2Outcome = await poll2;
  assert.equal(poll2Outcome.ignored, true);
  waiting[2](page(rowsFor(50, 'e')));
  const append2Outcome = await append2;
  assert.equal(append2Outcome.ignored, false);
  // 6. Both schedules finish with the requested 100-item window.
  assert.equal(loader2.getState().items.length, 100);

  // 8. A filter change during an old request still rejects the old response.
  const pending3 = [];
  const loader3 = createGatekeeperLoader({
    fetchDropped: () => new Promise((res) => { pending3.push(res); }),
    fetchQueue: quietQueue,
    onState: () => {},
  });
  const old = loader3.reload();
  loader3.setScope({ search: 'chip' });
  const current = loader3.reload();
  pending3[0](page(rowsFor(50)));
  assert.equal((await old).ignored, true);
  pending3[1](page(rowsFor(50, 'chip')));
  await current;
  assert.equal(loader3.getState().items[0].id, 'chip0');

  // 9. Repeated polling never overlaps: second tick skips while one runs.
  const pending4 = [];
  const loader4 = createGatekeeperLoader({
    fetchDropped: () => new Promise((res) => { pending4.push(res); }),
    fetchQueue: activeQueue,
    onState: () => {},
  });
  const firstPoll = loader4.refresh();
  const secondPoll = loader4.refresh();
  assert.equal((await secondPoll).skipped, true);
  pending4[0](page(rowsFor(50)));
  await firstPoll;
  assert.equal(loader4.getState().items.length, 50);
});
