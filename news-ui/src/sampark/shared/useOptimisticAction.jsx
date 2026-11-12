import { useState, useCallback, useRef } from 'react';

// Optimistic interactions: Like, Dislike, Follow, Unfollow, Save, Hide
// per-article, per-action pending state, prevent duplicate requests via ref (no stale closure), reconcile with server, rollback on failure
export function useOptimisticAction() {
  const [pending, setPending] = useState({}); // key: `${articleId}::${action}`
  const pendingRef = useRef(new Set());
  const run = useCallback(async (articleId, action, optimisticUpdate, serverRequest, rollback) => {
    const key = `${articleId}::${action}`;
    if (pendingRef.current.has(key)) return; // prevent duplicate via ref, not stale state
    pendingRef.current.add(key);
    setPending((c) => ({ ...c, [key]: true }));
    optimisticUpdate();
    try {
      const res = await serverRequest();
      return res;
    } catch (e) {
      rollback();
      try { window.dispatchEvent(new CustomEvent('sampark-toast', { detail: { message: e?.message || 'Action failed', type: 'error' } })); } catch {}
      throw e;
    } finally {
      pendingRef.current.delete(key);
      setPending((c) => { const n = { ...c }; delete n[key]; return n; });
    }
  }, []);
  return { pending, run, isPending: (id, action) => Boolean(pending[`${id}::${action}`]) };
}
