import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import ResearchArtifactCard from './ResearchArtifactCard.jsx';
import { refreshVentureLens } from '../../venture-lens/api.js';
import { createSingleFlight } from '../shared/researchHelper.js';

function ProviderStatus({ providers }) {
  if (!providers) return null;
  const entries = Object.entries(providers);
  return (
    <div className="sampark-research-providers" aria-label="Provider status">
      {entries.map(([name, state]) => {
        const available = state.available !== false;
        const stale = state.stale;
        const label = name === 'huggingface' ? 'Hugging Face' : name === 'openalex' ? 'OpenAlex' : name === 'epo' ? 'EPO' : name.toUpperCase();
        return (
          <span key={name} className={`sampark-research-provider${!available ? ' is-unavailable' : stale ? ' is-stale' : ' is-live'}`} title={state.reason || (stale ? 'Stale · showing last good snapshot' : 'Live')}>
            <i className="sampark-provider-dot" aria-hidden="true" />
            {label}
            {stale && available && <small> · stale</small>}
            {!available && <small> · unavailable</small>}
          </span>
        );
      })}
    </div>
  );
}

export default function ResearchOverview({ discovery, discoveryError, discoveryLoading, intelligenceError, onRetry, onOpen, providersStale, watchMap, pendingWatch, onWatch, compareMap, onCompare, onDiscoveryReload }) {
  const navigate = useNavigate();
  const featured = discovery?.featured || [];
  const stream = discovery?.stream || [];
  const lanes = discovery?.lanes || {};
  const providers = discovery?.providers || null;

  const hasContent = featured.length > 0 || stream.length > 0;
  const [refreshState, setRefreshState] = useState({ status: 'idle', message: '', providerErrors: null });
  const isRefreshing = refreshState.status === 'starting' || refreshState.status === 'running';
  // Production single-flight guard: prevents duplicate refresh requests when
  // the button is double-clicked before React state flushes.
  const refreshGuardRef = useRef(null);
  if (!refreshGuardRef.current) refreshGuardRef.current = createSingleFlight();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    if (!refreshGuardRef.current.tryStart()) return;
    setRefreshState({ status: 'starting', message: 'Starting refresh…', providerErrors: null });
    try {
      setRefreshState({ status: 'running', message: 'Refreshing providers…', providerErrors: null });
      const result = await refreshVentureLens();
      const errors = result?.provider_errors || result?.errors || null;
      const hasErrors = errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0);
      // One refresh + one reload: await the parent's discovery-reload callback before showing success
      try {
        if (!onDiscoveryReload) throw new Error('Discovery reload unavailable');
        await onDiscoveryReload();
      } catch (reloadError) {
        setRefreshState({ status: 'failure', message: reloadError?.message || 'Discovery reload failed after refresh.', providerErrors: errors });
        return;
      }
      if (hasErrors) {
        setRefreshState({ status: 'partial', message: 'Refresh completed with some provider errors.', providerErrors: errors });
      } else {
        setRefreshState({ status: 'success', message: 'Research refreshed successfully.', providerErrors: null });
        window.setTimeout(() => { if (mountedRef.current) setRefreshState((s) => s.status === 'success' ? { status: 'idle', message: '', providerErrors: null } : s); }, 3000);
      }
    } catch (e) {
      const msg = e?.message || 'Refresh failed.';
      const providerErrors = e?.payload?.provider_errors || e?.provider_errors || null;
      setRefreshState({ status: 'failure', message: msg, providerErrors });
    } finally {
      refreshGuardRef.current.finish();
    }
  };

  if (discoveryLoading && !hasContent) {
    return <div className="sampark-workspace-loading" role="status"><span className="sampark-spinner" /> Opening Research Intelligence…</div>;
  }

  if (discoveryError && !hasContent) {
    return (
      <div className="sampark-workspace-empty" role="alert">
        <Icon name="warning" size={20} />
        <h3>Research Intelligence is temporarily unavailable</h3>
        <p>{discoveryError}</p>
        <button className="btn-primary" onClick={onRetry} type="button">Retry</button>
      </div>
    );
  }

  return (
    <div className="sampark-research-overview">
      <header className="sampark-research-intro">
        <div>
          <span className="sampark-research-kicker">Research Intelligence · technical artifacts and evidence</span>
          <h1>Research Intelligence</h1>
          <p>This space covers technical artifacts and evidence — papers, repositories, models, datasets, patents, and the Technology Radar — not ordinary news. Signals are cached from Venture Lens providers and preserved through provider failures; stale or starter data is labeled where the backend marks it.</p>
          {providers && <ProviderStatus providers={providers} />}
          {providersStale && <small className="sampark-research-freshness-note"><Icon name="clock" size={12} /> Some providers are serving a cached snapshot. Use Refresh Research to update.</small>}
          {intelligenceError && <div className="sampark-workspace-note is-warning" role="status"><Icon name="warning" size={14} /> Watchlist and radar details could not be refreshed. <button className="btn-secondary" onClick={onRetry} type="button" style={{ marginLeft: 8 }}>Retry intelligence</button></div>}
          {refreshState.status !== 'idle' && (
            <div role="status" aria-live="polite" className={`sampark-refresh-status is-${refreshState.status}`}>
              <span>{refreshState.status === 'starting' ? 'Starting…' : refreshState.status === 'running' ? 'Refreshing…' : refreshState.message}</span>
              {refreshState.providerErrors && <small> · {Array.isArray(refreshState.providerErrors) ? refreshState.providerErrors.join(', ') : JSON.stringify(refreshState.providerErrors).slice(0, 120)}</small>}
              {refreshState.status === 'partial' && <button className="btn-secondary" onClick={handleRefresh} type="button" style={{ marginLeft: 8 }}>Retry</button>}
              {refreshState.status === 'failure' && <button className="btn-secondary" onClick={handleRefresh} type="button" style={{ marginLeft: 8 }}>Retry</button>}
            </div>
          )}
        </div>
        <div className="sampark-research-intro-actions">
          <button className="btn-primary" disabled={isRefreshing} onClick={handleRefresh} type="button" aria-busy={isRefreshing}>
            <Icon name="refresh" size={14} /> {isRefreshing ? 'Refreshing…' : 'Refresh Research'}
          </button>
          <button className="btn-secondary" onClick={() => navigate('/research/archive')} type="button"><Icon name="archive" size={14} /> Go to Archive Search</button>
          <small>Discovery = Venture Lens providers · Archive = retained briefing evidence</small>
        </div>
      </header>

      {discoveryError && hasContent && (
        <div className="sampark-workspace-note is-warning" role="status">
          <Icon name="warning" size={14} /> Discovery partially loaded. Some providers failed — use Refresh Research. <button className="btn-secondary" disabled={isRefreshing} onClick={handleRefresh} type="button">{isRefreshing ? 'Refreshing…' : 'Refresh Research'}</button>
        </div>
      )}

      <section className="sampark-research-featured-section" aria-label="Featured artifacts">
        <header className="sampark-research-section-head">
          <h2>Featured artifacts</h2>
          <span className="sampark-research-section-meta">{featured.length} curated across kinds</span>
        </header>
        {featured.length ? (
          <div className="sampark-research-discovery-grid">
            {featured.map((art) => (
              <ResearchArtifactCard
                key={`${art.kind}:${art.id}`}
                artifact={art}
                onOpen={onOpen}
                onWatch={onWatch}
                onCompare={onCompare}
                watched={watchMap?.has(`${art.kind}:${art.id}`)}
                compared={compareMap?.has(`${art.kind}:${art.id}`)}
                watchPending={pendingWatch?.has(`${art.kind}:${art.id}`)}
              />
            ))}
          </div>
        ) : <div className="sampark-workspace-empty"><Icon name="layers" size={20} /><p>No featured artifacts are cached yet. Sync live data to populate discovery.</p></div>}
      </section>

      <section className="sampark-research-stream-section" aria-label="Evidence stream">
        <header className="sampark-research-section-head">
          <h2>Evidence stream</h2>
          <span className="sampark-research-section-meta">{stream.length} signals · interleaved across providers</span>
        </header>
        {stream.length ? (
          <div className="sampark-research-discovery-grid">
            {stream.map((art) => (
              <ResearchArtifactCard
                key={`stream-${art.kind}:${art.id}`}
                artifact={art}
                onOpen={onOpen}
                onWatch={onWatch}
                onCompare={onCompare}
                watched={watchMap?.has(`${art.kind}:${art.id}`)}
                compared={compareMap?.has(`${art.kind}:${art.id}`)}
                watchPending={pendingWatch?.has(`${art.kind}:${art.id}`)}
              />
            ))}
          </div>
        ) : <div className="sampark-workspace-empty"><Icon name="inbox" size={20} /><p>Evidence stream is empty. Providers will populate it on next discovery refresh.</p></div>}
      </section>

      <section className="sampark-research-lanes" aria-label="Research lanes">
        {[
          ['Repositories', lanes.repositories, '/research/repositories'],
          ['Papers', lanes.papers, '/research/papers'],
          ['Models', lanes.models, '/research/models'],
          ['Datasets', lanes.datasets, '/research/datasets'],
          ['Patents', lanes.patents, '/research/patents'],
        ].map(([label, items, path]) => (
          <article key={label} className="sampark-research-lane">
            <header>
              <h3>{label}</h3>
              <small>{(items || []).length} signals</small>
              <button className="btn-secondary" onClick={() => navigate(path)} type="button">Open</button>
            </header>
            {(items || []).length ? (
              <div className="sampark-research-lane-preview">
                {(items || []).slice(0, 2).map((art) => (
                  <button key={`${art.kind}:${art.id}`} className="sampark-research-lane-item" onClick={() => onOpen(art)} type="button">
                    <strong>{art.title}</strong>
                    <small>{art.source} · {art.category}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="sampark-research-lane-empty">{label} lane has no cached signals — retry after provider refresh.</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
