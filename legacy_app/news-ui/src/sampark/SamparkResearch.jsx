import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import ResearchNavigation from './research/ResearchNavigation.jsx';
import ResearchOverview from './research/ResearchOverview.jsx';
import ResearchArtifactCard from './research/ResearchArtifactCard.jsx';
import ResearchArtifactDetail from './research/ResearchArtifactDetail.jsx';
import ResearchArchiveSearch from './research/ResearchArchiveSearch.jsx';
import { apiRequest } from '../shared/api/client.js';
import { evaluateReloadResult } from './shared/researchHelper.js';
import './research/research.css';

// Light wrappers around venture-lens endpoints — same-origin, no hard-coded host
const getVentureDiscovery = () => apiRequest('/venture-lens/discovery');
const getVentureIntelligence = () => apiRequest('/venture-lens/intelligence');
const getTechnologyDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/technology/${encodeURIComponent(id)}`, opts);
const getRepositoryDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/repository/${String(id).split('/').map(encodeURIComponent).join('/')}`, opts);
const getPaperDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/paper/${encodeURIComponent(id)}`, opts);
const getModelDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/model/${String(id).split('/').map(encodeURIComponent).join('/')}`, opts);
const getDatasetDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/dataset/${String(id).split('/').map(encodeURIComponent).join('/')}`, opts);
const getPatentDossier = (id, opts = {}) => apiRequest(`/venture-lens/dossier/patent/${String(id).split('/').map(encodeURIComponent).join('/')}`, opts);
const compareVentureSignals = (items) => apiRequest('/venture-lens/compare', { method: 'POST', body: JSON.stringify({ items }) });
const toggleVentureWatchlist = (item) => apiRequest('/venture-lens/watchlist/toggle', { method: 'POST', body: JSON.stringify(item) });

const COMPARISON_KEY = 'sampark-research-compare-v1';

function readComparison() {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(COMPARISON_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((i) => i && i.kind && i.id).slice(0, 4) : [];
  } catch { return []; }
}

function currentSection(pathname) {
  const seg = pathname.replace(/^\/research\/?/, '').split('/')[0] || '';
  const allowed = new Set(['papers', 'repositories', 'models', 'datasets', 'patents', 'radar', 'watchlist', 'compare', 'briefs', 'archive']);
  return allowed.has(seg) ? seg : 'overview';
}

function SectionLanes({ title, items, emptyHint, onOpen, onWatch, onCompare, watchMap, compareMap, pendingWatch }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items || [];
    return (items || []).filter((a) => `${a.title} ${a.summary} ${a.category}`.toLowerCase().includes(q));
  }, [items, query]);
  return (
    <section className="sampark-research-lane-page">
      <header className="sampark-research-lane-head">
        <div>
          <h2>{title}</h2>
          <small>{filtered.length} of {(items || []).length} signals</small>
        </div>
        <label className="sampark-research-lane-filter">
          <Icon name="search" size={14} />
          <input aria-label={`Filter ${title}`} placeholder={`Filter ${title.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button aria-label="Clear filter" onClick={() => setQuery('')} type="button"><Icon name="x" size={12} /></button>}
        </label>
      </header>
      {filtered.length ? (
        <div className="sampark-research-discovery-grid">
          {filtered.map((art) => (
            <ResearchArtifactCard key={`${art.kind}:${art.id}`} artifact={art} onOpen={onOpen} onWatch={onWatch} onCompare={onCompare} watched={watchMap?.has(`${art.kind}:${art.id}`)} compared={compareMap?.has(`${art.kind}:${art.id}`)} watchPending={pendingWatch?.has(`${art.kind}:${art.id}`)} />
          ))}
        </div>
      ) : (
        <div className="sampark-workspace-empty"><Icon name="layers" size={20} /><p>{emptyHint || 'No signals match this filter.'}</p></div>
      )}
    </section>
  );
}

export default function SamparkResearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = currentSection(location.pathname);

  const [discovery, setDiscovery] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState('');
  const [intelligenceError, setIntelligenceError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const [dossier, setDossier] = useState(null);
  const [dossierDetail, setDossierDetail] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState('');
  const [dossierRequest, setDossierRequest] = useState(null);
  const [notice, setNotice] = useState('');

  const [watchlist, setWatchlist] = useState([]);
  const [pendingWatchKeys, setPendingWatchKeys] = useState(() => new Set());
  const [compareItems, setCompareItems] = useState(() => readComparison());
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const dossierRef = useRef({ token: 0, controller: null });

  const load = useCallback(async () => {
    setLoading(true);
    setDiscoveryError('');
    setIntelligenceError('');
    try {
      const [disc, intel] = await Promise.allSettled([getVentureDiscovery(), getVentureIntelligence()]);
      if (disc.status === 'fulfilled') setDiscovery(disc.value);
      else setDiscoveryError(disc.reason?.message || 'Discovery could not be loaded.');
      if (intel.status === 'fulfilled') {
        setIntelligence(intel.value);
        setWatchlist(intel.value?.watchlist || []);
      } else {
        setIntelligenceError(intel.reason?.message || 'Intelligence could not be loaded.');
      }
    } catch (e) {
      setDiscoveryError((cur) => cur || e?.message || 'Research workspace could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  const reloadDiscovery = useCallback(async () => {
    setLoading(true);
    setDiscoveryError('');
    setIntelligenceError('');
    try {
      const [disc, intel] = await Promise.allSettled([getVentureDiscovery(), getVentureIntelligence()]);
      let discoveryError = null;
      let intelligenceError = null;
      if (disc.status === 'fulfilled') {
        setDiscovery(disc.value);
      } else {
        discoveryError = disc.reason;
        setDiscoveryError(disc.reason?.message || 'Discovery reload failed after refresh.');
      }
      if (intel.status === 'fulfilled') {
        setIntelligence(intel.value);
        setWatchlist(intel.value?.watchlist || []);
      } else {
        intelligenceError = intel.reason;
        setIntelligenceError(intel.reason?.message || 'Intelligence reload failed after refresh.');
      }
      const evalRes = evaluateReloadResult(disc.status, intel.status, discoveryError, intelligenceError);
      if (evalRes.status !== 'success') {
        throw discoveryError || intelligenceError || new Error(evalRes.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, retryKey]);
  useEffect(() => { window.sessionStorage.setItem(COMPARISON_KEY, JSON.stringify(compareItems)); }, [compareItems]);
  useEffect(() => () => dossierRef.current.controller?.abort(), []);

  // Sync dossier from ?focus= param inside sampark shell. Kind resolves from
  // the current section so the same focus value opens the correct artifact
  // in overview, radar, papers, repositories, and provider lanes.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focus = params.get('focus');
    if (!focus) return;
    const kindMap = { radar: 'technology', overview: 'technology', repositories: 'repository', papers: 'paper', models: 'model', datasets: 'dataset', patents: 'patent', archive: 'paper', watchlist: '', compare: '', briefs: 'technology' };
    const kind = kindMap[section] || 'technology';
    if (!kind) return;
    // Re-resolve when section or focus changes, not only on first open.
    if (dossierRequest && dossierRequest.id === focus && dossierRequest.kind === kind) return;
    openDossier(kind, focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname]);

  const watchMap = useMemo(() => new Set(watchlist.map((i) => i.key || `${i.kind}:${i.id}`)), [watchlist]);
  const compareMap = useMemo(() => new Set(compareItems.map((i) => `${i.kind}:${i.id}`)), [compareItems]);

  const providersStale = useMemo(() => {
    if (!discovery?.providers) return false;
    return Object.values(discovery.providers).some((p) => p.stale && p.available !== false);
  }, [discovery]);

  const openDossier = async (kind, id) => {
    const loaders = { repository: getRepositoryDossier, paper: getPaperDossier, technology: getTechnologyDossier, model: getModelDossier, dataset: getDatasetDossier, patent: getPatentDossier };
    const loader = loaders[kind] || getTechnologyDossier;
    dossierRef.current.controller?.abort();
    const token = dossierRef.current.token + 1;
    const controller = new AbortController();
    dossierRef.current = { token, controller };
    const artifact = (discovery?.stream || []).find((a) => a.kind === kind && String(a.id) === String(id)) ||
      (discovery?.featured || []).find((a) => a.kind === kind && String(a.id) === String(id)) ||
      Object.values(discovery?.lanes || {}).flat().find((a) => a.kind === kind && String(a.id) === String(id)) ||
      (intelligence?.radar || []).find((r) => kind === 'technology' && String(r.id) === String(id));
    const base = artifact ? { ...artifact } : {};
    if (kind === 'technology' && base && !base.kind) base.kind = 'technology';
    setDossier(artifact ? { ...base, kind, id } : { kind, id, title: id, source: kind });
    setDossierRequest({ kind, id });
    setDossierDetail(null);
    setDossierError('');
    setDossierLoading(true);
    try {
      const result = await loader(id, { signal: controller.signal });
      if (dossierRef.current.token !== token) return;
      setDossierDetail(result);
    } catch (e) {
      if (e?.name === 'AbortError' || dossierRef.current.token !== token) return;
      setDossierError(e?.message || 'This dossier could not be loaded.');
    } finally {
      if (dossierRef.current.token === token) setDossierLoading(false);
    }
  };

  const closeDossier = () => {
    dossierRef.current.controller?.abort();
    dossierRef.current = { token: dossierRef.current.token + 1, controller: null };
    setDossier(null);
    setDossierDetail(null);
    setDossierError('');
    setDossierLoading(false);
    setDossierRequest(null);
  };

  const handleWatch = async (artifact) => {
    const kind = artifact.kind || 'paper';
    const id = artifact.id;
    const label = artifact.title || artifact.label || id;
    const key = `${kind}:${id}`;
    if (pendingWatchKeys.has(key)) return;
    setPendingWatchKeys((cur) => new Set(cur).add(key));
    try {
      const res = await toggleVentureWatchlist({ kind, id, label });
      setWatchlist(res.items || []);
      const intel = await getVentureIntelligence().catch(() => null);
      if (intel) setIntelligence(intel);
    } catch (e) { setNotice(e?.message || 'Watchlist update failed.'); }
    finally { setPendingWatchKeys((cur) => { const n = new Set(cur); n.delete(key); return n; }); }
  };

  const handleCompareToggle = (artifact) => {
    const kind = artifact.kind;
    const id = artifact.id;
    const label = artifact.title || artifact.label || id;
    const key = `${kind}:${id}`;
    setComparison(null);
    setCompareItems((cur) => {
      if (cur.some((i) => `${i.kind}:${i.id}` === key)) return cur.filter((i) => `${i.kind}:${i.id}` !== key);
      if (cur.length && cur[0].kind !== kind) { setNotice(`Compare ${kind} with ${kind} only — clear the current ${cur[0].kind} selection first.`); return cur; }
      if (cur.length >= 4) { setNotice('A comparison can contain at most four signals. Remove one before adding another.'); return cur; }
      setNotice('');
      return [...cur, { kind, id, label }];
    });
  };

  const runComparison = async () => {
    if (compareItems.length < 2) return;
    setComparing(true);
    setNotice('');
    try { setComparison(await compareVentureSignals(compareItems)); } catch (e) { setNotice(e?.message || 'Comparison failed.'); } finally { setComparing(false); }
  };

  const renderSection = () => {
    if (section === 'archive') return <ResearchArchiveSearch />;

    if (loading && !discovery && !intelligence) return <div className="sampark-workspace-loading" role="status"><span className="sampark-spinner" /> Opening Research Intelligence…</div>;
    if (discoveryError && intelligenceError && !discovery && !intelligence) {
      return <div className="sampark-workspace-empty" role="alert"><Icon name="warning" size={20} /><h3>Research unavailable</h3><p>{discoveryError}</p><button className="btn-primary" onClick={() => setRetryKey((k) => k + 1)} type="button">Retry</button></div>;
    }

    const lanes = discovery?.lanes || {};
    const commonProps = { onOpen: (a) => openDossier(a.kind, a.id), onWatch: handleWatch, onCompare: handleCompareToggle, watchMap, compareMap, pendingWatch: pendingWatchKeys };

    if (section === 'papers') return <SectionLanes title="Papers" items={lanes.papers} emptyHint="No paper signals are cached yet. Sync live data." {...commonProps} />;
    if (section === 'repositories') return <SectionLanes title="Repositories" items={lanes.repositories} emptyHint="No repository signals are available." {...commonProps} />;
    if (section === 'models') return <SectionLanes title="Models" items={lanes.models} emptyHint="No model records are cached yet." {...commonProps} />;
    if (section === 'datasets') return <SectionLanes title="Datasets" items={lanes.datasets} emptyHint="No dataset records are cached yet." {...commonProps} />;
    if (section === 'patents') {
      const available = discovery?.providers?.epo?.available !== false;
      if (!available) return <div className="sampark-workspace-empty"><Icon name="note" size={20} /><h3>Patent intelligence unavailable</h3><p>EPO OPS credentials are not configured. Patent discovery remains dormant without credentials.</p></div>;
      return <SectionLanes title="Patents" items={lanes.patents} emptyHint="No patent records are available." {...commonProps} />;
    }
    if (section === 'radar') {
      const radar = intelligence?.radar || [];
      if (!radar.length) return <div className="sampark-workspace-empty"><Icon name="radar" size={20} /><p>Technology radar is building. Refresh discovery to see scored themes.</p></div>;
      return (
        <section className="sampark-research-radar">
          <header className="sampark-research-section-head"><h2>Technology Radar</h2><small>{radar.length} themes · Adopt / Evaluate / Explore / Watch</small></header>
          <div className="sampark-research-discovery-grid">
            {radar.map((item) => (
              <article key={item.id} className={`sampark-research-radar-card stage-${String(item.stage).toLowerCase()}`}>
                <header><span className="sampark-research-radar-score">{item.score}</span><em>{item.stage}</em></header>
                <h3>{item.label}</h3>
                <p>{item.repository_count} repos · {item.paper_count} papers · {item.evidence_count} evidence</p>
                <div className="sampark-research-artifact-actions">
                  <button className={`sampark-research-mini-action${watchMap.has(`technology:${item.id}`) ? ' is-active' : ''}`} onClick={() => handleWatch({ kind: 'technology', id: item.id, title: item.label })} type="button"><Icon name="bookmark" size={12} /> Watch</button>
                  <button className="sampark-research-mini-action is-primary" onClick={() => openDossier('technology', item.id)} type="button">Dossier</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      );
    }
    if (section === 'watchlist') {
      if (!watchlist.length) return <div className="sampark-workspace-empty"><Icon name="bookmark" size={20} /><h3>Your watchlist is ready</h3><p>Use the Watch action on any repository, paper, or technology to monitor it here. Watchlist is private per viewer.</p></div>;
      return (
        <section className="sampark-research-watch-grid">
          {watchlist.map((item) => (
            <div key={item.key} className="sampark-research-watch-item">
              <div><span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)' }}>{item.kind}</span><strong style={{ display: 'block' }}>{item.label}</strong><small>Watching since {String(item.saved_at || '').slice(0, 10)}</small></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => openDossier(item.kind, item.id)} type="button">Open</button>
                <button className="btn-secondary" disabled={pendingWatchKeys.has(item.key)} onClick={() => handleWatch({ kind: item.kind, id: item.id, title: item.label })} type="button">Remove</button>
              </div>
            </div>
          ))}
        </section>
      );
    }
    if (section === 'compare') {
      return (
        <section className="sampark-research-compare">
          <header className="sampark-research-section-head"><h2>Compare · like-for-like only</h2><small>{compareItems.length} selected · comparison stays within one kind</small></header>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Comparison must remain like-for-like; unrelated artifact types are never mixed in the same metric table. Stars, citations, and technology momentum are distinct measures.</p>
          <div className="sampark-research-compare-grid">
            {compareItems.length ? compareItems.map((it, idx) => (
              <article key={`${it.kind}:${it.id}`} className="sampark-research-compare-card"><span>0{idx + 1} · {it.kind}</span><strong>{it.label}</strong><button onClick={() => handleCompareToggle(it)} type="button">Remove</button></article>
            )) : <div className="sampark-workspace-empty"><Icon name="sort" size={20} /><p>No signals selected yet. Use Compare on any card.</p></div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" disabled={compareItems.length < 2 || comparing} onClick={runComparison} type="button">{comparing ? 'Building…' : `Compare ${compareItems.length} ${compareItems[0]?.kind || 'signals'}`}</button>
            {compareItems.length > 0 && <button className="btn-secondary" onClick={() => { setCompareItems([]); setComparison(null); }} type="button">Clear</button>}
          </div>
          {comparison && (
            <div className="sampark-research-comparison-result" style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--surface)' }}>
              <h3>{comparison.kind} decision matrix · {comparison.items.length} signals</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><th style={{ textAlign: 'left', padding: 8 }}>Metric</th>{comparison.items.map((it) => <th key={it.id} style={{ textAlign: 'left', padding: 8 }}>{it.label || it.title || it.full_name}</th>)}</tr></thead>
                  <tbody>
                    {(comparison.metrics || []).map((m) => (
                      <tr key={m.id}><td style={{ padding: 8, fontWeight: 600 }}>{m.label}</td>{comparison.items.map((it) => <td key={`${it.id}-${m.id}`} style={{ padding: 8 }}>{String(it[m.id] ?? it.metrics?.[m.id] ?? '—').slice(0, 40)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn-secondary" onClick={() => setComparison(null)} type="button" style={{ marginTop: 12 }}>Clear result</button>
            </div>
          )}
        </section>
      );
    }
    if (section === 'briefs') {
      const briefs = intelligence?.briefs || [];
      if (!briefs.length) return <div className="sampark-workspace-empty"><Icon name="note" size={20} /><p>No opportunity briefs are available yet. Sync live data to assemble the next set.</p></div>;
      return (
        <section className="sampark-research-briefs">
          <div className="sampark-research-discovery-grid">
            {briefs.map((b, idx) => (
              <article key={b.id} className="sampark-research-artifact">
                <div className="sampark-research-artifact-body">
                  <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700 }}>0{idx + 1} · {b.type}</span>
                  <h4>{b.title}</h4>
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>{b.summary}</p>
                  <ul style={{ margin: '8px 0 8px 18px', color: 'var(--muted)', fontSize: 13 }}>{(b.actions || []).map((a) => <li key={a}>{a}</li>)}</ul>
                  <button className="btn-primary" onClick={() => { if (b.technology_id) openDossier('technology', b.technology_id); else if (b.repository_id) openDossier('repository', b.repository_id); else if (b.paper_id) openDossier('paper', b.paper_id); }} type="button">Open supporting intelligence</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      );
    }

    // overview default — provide one awaited discovery-reload callback, remove unused fresh fallback
    return <ResearchOverview discovery={discovery} discoveryError={discoveryError} discoveryLoading={loading} intelligenceError={intelligenceError} onRetry={() => setRetryKey((k) => k + 1)} onDiscoveryReload={reloadDiscovery} onOpen={(a) => openDossier(a.kind, a.id)} providersStale={providersStale} watchMap={watchMap} pendingWatch={pendingWatchKeys} onWatch={handleWatch} compareMap={compareMap} onCompare={handleCompareToggle} />;
  };

  return (
    <div className="sampark-research-workspace">
      <header className="sampark-research-header">
        <div>
          <span className="sampark-research-kicker">Research · technical artifacts and evidence</span>
          <h1>Research Intelligence</h1>
          <p>Technical artifacts and evidence — papers, repositories, models, datasets, patents, and the technology radar.</p>
        </div>
      </header>

      <ResearchNavigation />

      {notice && <div className="sampark-workspace-note is-warning" role="status"><Icon name="warning" size={14} /> {notice} <button className="btn-secondary" onClick={() => setNotice('')} type="button">Dismiss</button></div>}
      {intelligenceError && intelligence && <div className="sampark-workspace-note is-warning" role="status"><Icon name="warning" size={14} /> Intelligence could not be refreshed: {intelligenceError} <button className="btn-secondary" onClick={() => setRetryKey((k) => k + 1)} type="button">Retry intelligence</button></div>}

      <div className="sampark-research-content">
        {renderSection()}
      </div>

      {(dossier || dossierLoading || dossierError) && (
        <ResearchArtifactDetail
          artifact={dossier}
          detail={dossierDetail}
          loading={dossierLoading}
          error={dossierError}
          onClose={closeDossier}
          onRetry={() => dossierRequest && openDossier(dossierRequest.kind, dossierRequest.id)}
          watched={dossier ? watchMap.has(`${dossier.kind}:${dossier.id}`) : false}
          watchPending={dossier ? pendingWatchKeys.has(`${dossier.kind}:${dossier.id}`) : false}
          onWatch={handleWatch}
          compared={dossier ? compareMap.has(`${dossier.kind}:${dossier.id}`) : false}
          onCompare={handleCompareToggle}
        />
      )}
    </div>
  );
}
