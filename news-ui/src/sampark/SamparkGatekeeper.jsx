import React, { useEffect, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getGatekeeperDropped, getGatekeeperQueue, queueGatekeeperRestore, retryGatekeeperRestore } from '../news-scrapper/api.js';
import { createGatekeeperLoader, decodedKeywords, decodedRowText, restorationActive } from './gatekeeperModel.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkGatekeeper({ capabilities = [] }) {
  const hasAccess = capabilities.includes('gatekeeper.review');
  const [dropped, setDropped] = useState([]);
  const [queue, setQueue] = useState([]);
  const [counts, setCounts] = useState({ total: 0, rejected: 0 });
  const [matched, setMatched] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [profile, setProfile] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Committed search query: typing stays draft until Apply. Polling and
  // pagination always use the committed value so an old interval can never
  // restore an earlier query.
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [rowBusy, setRowBusy] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const PAGE = 50;

  // One loader owns the pagination window, so polling intervals never capture
  // stale offsets or queries. React state mirrors it for rendering.
  const loaderRef = useRef(null);
  if (!loaderRef.current) {
    loaderRef.current = createGatekeeperLoader({
      pageSize: PAGE,
      fetchDropped: (params) => getGatekeeperDropped(params),
      fetchQueue: (params) => getGatekeeperQueue(params),
      isMounted: () => mountedRef.current,
      onState: (patch) => {
        if (patch.items !== undefined) setDropped(patch.items);
        if (patch.queue !== undefined) setQueue(patch.queue);
        if (patch.counts !== undefined) setCounts(patch.counts);
        if (patch.matched !== undefined) setMatched(patch.matched);
        if (patch.hasMore !== undefined) setHasMore(patch.hasMore);
        if (patch.loading !== undefined) setLoading(patch.loading);
        if (patch.refreshing !== undefined) setRefreshing(patch.refreshing);
        if (patch.error !== undefined) setError(patch.error);
      },
    });
  }
  const load = ({ append = false, background = false } = {}) => {
    if (append) return loaderRef.current.loadMore();
    if (background) return loaderRef.current.refresh();
    return loaderRef.current.reload();
  };
  const syncScope = (scope) => loaderRef.current.setScope(scope);

  // Single initial + filter effect: page resets only when committed filters
  // change (typing alone never reloads), avoiding duplicate mount loads.
  useEffect(() => {
    if (!hasAccess) return;
    syncScope({ profile, status: statusFilter, search: appliedSearch });
    loaderRef.current.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, profile, statusFilter, appliedSearch]);

  useEffect(() => {
    // Polling authority is restoration status only — never pipeline stages.
    const polling = restorationActive(queue, dropped);
    if (!polling) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current=null; } return; }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { loaderRef.current.refresh(); }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current=null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restorationActive(queue, dropped), dropped.length, profile, statusFilter, appliedSearch]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const applySearch = (e) => {
    e?.preventDefault();
    // Commit the draft query: the filter effect reloads page one with it.
    setAppliedSearch(search);
  };

  const handleRestore = async (id) => {
    if (rowBusy[id]) return;
    if (!confirm('Restore this rejected signal? This affects global training.')) return;
    setRowBusy((c) => ({ ...c, [id]: true }));
    setRowErrors((c) => { const n = { ...c }; delete n[id]; return n; });
    try {
      await queueGatekeeperRestore(id);
      await load({ background: true });
    } catch(e){ setRowErrors((c) => ({ ...c, [id]: e?.message || 'Restore failed' })); }
    finally { setRowBusy((c) => { const n = { ...c }; delete n[id]; return n; }); }
  };
  const handleRetry = async (id) => {
    if (rowBusy[id]) return;
    setRowBusy((c) => ({ ...c, [id]: true }));
    setRowErrors((c) => { const n = { ...c }; delete n[id]; return n; });
    try {
      await retryGatekeeperRestore(id);
      await load({ background: true });
    } catch(e){ setRowErrors((c) => ({ ...c, [id]: e?.message || 'Retry failed' })); }
    finally { setRowBusy((c) => { const n = { ...c }; delete n[id]; return n; }); }
  };

  if (!hasAccess) return <SamparkWorkspaceShell title="Gatekeeper Review" description="Distinct privileged workspace for borderline content, model and region correction." error="You don’t have access to this workspace. Requires gatekeeper.review." />;
  if (loading && dropped.length === 0) return <SamparkWorkspaceShell title="Gatekeeper Review" description="Review rejected/borderline content." loading />;
  if (error && dropped.length === 0) return <SamparkWorkspaceShell title="Gatekeeper Review" description="Review rejected/borderline content." error={error} onRetry={() => load()} />;

  return (
    <SamparkWorkspaceShell title="Gatekeeper Review" description="Rejected signals, scores, stages, keywords, queue state. Global action requires confirmation; viewing does not restore.">
      <form onSubmit={applySearch} role="search" aria-label="Filter gatekeeper queue" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Profile filter" value={profile} onChange={(e) => setProfile(e.target.value)}>
          <option value="all">All profiles</option>
          <option value="default">Default</option>
          <option value="broadcast">Broadcast</option>
        </select>
        <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="dropped">Dropped</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
        <input aria-label="Search gatekeeper queue" placeholder="Search title or keyword" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 140, padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Showing {dropped.length} of {matched} matching · {counts.counts?.all ?? counts.total ?? 0} total</span>
        <span>Queue: {counts.queueCounts?.queued ?? 0} queued · {counts.queueCounts?.processing ?? 0} processing</span>
        <span>Worker: {counts.worker?.running ? `running ${counts.worker?.current_article || ''}` : 'idle'}</span>
        {refreshing && <small role="status">Refreshing…</small>}
      </div>
      {error && <div role="alert" style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {dropped.length===0 ? <div className="sampark-workspace-empty"><Icon name="inbox" size={20} /><p>No rejected signals.</p></div> : (
        <div className="sampark-gatekeeper-list" style={{ display: 'grid', gap: 10 }}>
          {dropped.map((d, i)=> (
            <article key={d.id || `${d.title || 'signal'}-${i}`} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ flex: 1, minWidth: 0 }}>{decodedRowText(d.title) || d.id || `Signal ${i+1}`}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)', flex: 'none' }}>Score: {d.score ?? d.bouncer_score ?? '—'} · Stage: {decodedRowText(d.bouncer_stage || d.stage || d.state) || '—'} · Status: {d.status || 'dropped'}</span>
              </div>
              {d.bouncer_reason && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>Reason: {decodedRowText(d.bouncer_reason)}</p>}
              {d.reason && !d.bouncer_reason && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Reason: {decodedRowText(d.reason)}</p>}
              {d.keywords_found && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{decodedKeywords(d.keywords_found).slice(0,6).map(k=> <span key={k} className="sampark-keyword">{k}</span>)}</div>}
              {d.keywords && !d.keywords_found && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{decodedKeywords(d.keywords).slice(0,6).map(k=> <span key={k} className="sampark-keyword">{k}</span>)}</div>}
              {rowErrors[d.id] && <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{rowErrors[d.id]}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-secondary" disabled={Boolean(rowBusy[d.id])} onClick={()=> handleRestore(d.id)} type="button">{rowBusy[d.id] ? 'Working…' : 'Queue restore'}</button>
                {(d.status==='failed' || d.failed) && <button className="btn-secondary" disabled={Boolean(rowBusy[d.id])} onClick={()=> handleRetry(d.id)} type="button">{rowBusy[d.id] ? 'Working…' : 'Retry restore'}</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      {hasMore && <div style={{ marginTop: 12 }}><button className="btn-secondary" disabled={loading} onClick={() => load({ append: true })} type="button">{loading ? 'Loading…' : `Show more (${matched - dropped.length} remaining)`}</button></div>}
      <div className="sampark-workspace-note"><Icon name="shield" size={14} /> Gatekeeper actions affect global model training — confirmation required. Status refreshes automatically while work is queued.</div>
    </SamparkWorkspaceShell>
  );
}
