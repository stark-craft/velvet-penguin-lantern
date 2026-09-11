import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import ResearchArtifactCard from './ResearchArtifactCard.jsx';

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

export default function ResearchOverview({ discovery, discoveryError, discoveryLoading, onRetry, onOpen, providersStale, watchMap, pendingWatch, onWatch, compareMap, onCompare }) {
  const navigate = useNavigate();
  const featured = discovery?.featured || [];
  const stream = discovery?.stream || [];
  const lanes = discovery?.lanes || {};
  const providers = discovery?.providers || null;

  const hasContent = featured.length > 0 || stream.length > 0;

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
          {providersStale && <small className="sampark-research-freshness-note"><Icon name="clock" size={12} /> Some providers are serving a cached snapshot. Use Retry on the affected lane to refresh.</small>}
        </div>
        <div className="sampark-research-intro-actions">
          <button className="btn-primary" onClick={() => navigate('/research/archive')} type="button"><Icon name="archive" size={14} /> Go to Archive Search</button>
          <small>Discovery = Venture Lens providers · Archive = retained briefing evidence</small>
        </div>
      </header>

      {discoveryError && hasContent && (
        <div className="sampark-workspace-note is-warning" role="status">
          <Icon name="warning" size={14} /> Discovery partially loaded. Some providers failed — retry the affected lane. <button className="btn-secondary" onClick={onRetry} type="button">Retry discovery</button>
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
