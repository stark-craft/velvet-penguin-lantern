import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { isCompareSupported, isWatchSupported } from './researchCapabilities.js';

const KIND_ICON = {
  repository: 'terminal',
  paper: 'file',
  model: 'layers',
  dataset: 'server',
  patent: 'note',
  technology: 'radar',
  social: 'globe',
};

const KIND_LABEL = {
  repository: 'Repository',
  paper: 'Paper',
  model: 'Model',
  dataset: 'Dataset',
  patent: 'Patent',
  technology: 'Technology',
  social: 'Signal',
};

function formatMetric(kind, metrics) {
  if (!metrics) return '';
  if (kind === 'repository') return `${metrics.stars ?? '—'} ★ · ${metrics.forks ?? '—'} forks`;
  if (kind === 'paper') return `${metrics.citations ?? 0} citations`;
  if (kind === 'model' || kind === 'dataset') return `${metrics.downloads ?? 0} downloads`;
  if (kind === 'patent') return `${metrics.family_count ?? 0} family`;
  if (kind === 'technology') return `${metrics.evidence_count ?? 0} evidence`;
  return '';
}

export default function ResearchArtifactCard({ artifact, onOpen, onWatch, onCompare, watched, compared, watchPending }) {
  const kind = artifact.kind || 'paper';
  const icon = KIND_ICON[kind] || 'file';
  const label = KIND_LABEL[kind] || kind;
  const momentum = artifact.momentum;
  const isStarter = artifact.starter_snapshot;
  const hasImage = false; // Venture artifacts have no real images — use icon block per spec, never stock
  const navigate = useNavigate();
  const canWatch = isWatchSupported(kind);
  const canCompare = isCompareSupported(kind);
  const showWatch = canWatch && Boolean(onWatch);
  const showCompare = canCompare && Boolean(onCompare);

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(String(url || '').trim());
  }
  function isInternalSynthesized(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (isExternalUrl(u)) return false;
    // Synthesized relative URLs like /venturelens/radar?... or /research/radar
    return u.startsWith('/') && (u.includes('/venturelens') || u.includes('/radar') || u.includes('/research'));
  }
  function handleSourceClick(e) {
    const url = artifact.url;
    if (!url) return;
    if (isExternalUrl(url)) return; // let anchor handle external
    if (isInternalSynthesized(url)) {
      e.preventDefault();
      e.stopPropagation();
      // Preserve useful query state, route to /research/radar inside Sampark
      try {
        const urlObj = new URL(url, window.location.origin);
        const search = urlObj.search || '';
        navigate(`/research/radar${search}`);
      } catch {
        navigate('/research/radar');
      }
    }
  }

  return (
    <article className={`sampark-research-artifact is-${kind}`}>
      <button
        type="button"
        className="sampark-research-artifact-visual"
        onClick={() => onOpen?.(artifact)}
        aria-label={`Open ${artifact.title}`}
      >
        <span className={`sampark-research-visual-icon is-${kind}`} aria-hidden="true">
          <Icon name={icon} size={28} />
        </span>
        <span className="sampark-research-source-badge">{artifact.source || label}</span>
        {isStarter && <span className="sampark-research-starter-badge">Starter</span>}
      </button>
      <div className="sampark-research-artifact-body">
        <div className="sampark-research-artifact-kicker">
          <span>{label} · {artifact.category || 'General'}</span>
          {momentum != null && <span className={`sampark-research-momentum${momentum >= 0 ? ' is-up' : ' is-down'}`}>{momentum >= 0 ? '+' : ''}{momentum}%</span>}
          {momentum == null && <span className="sampark-research-momentum is-neutral">first snapshot</span>}
        </div>
        <button type="button" className="sampark-research-artifact-title" onClick={() => onOpen?.(artifact)}>
          <h4>{artifact.title}</h4>
        </button>
        {artifact.summary && <p className="sampark-research-artifact-summary">{artifact.summary}</p>}
        <div className="sampark-research-artifact-meta">
          <span>{formatMetric(kind, artifact.metrics)}</span>
          {artifact.url && isExternalUrl(artifact.url) && (
            <a href={artifact.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
              Source <Icon name="external" size={12} />
            </a>
          )}
          {artifact.url && isInternalSynthesized(artifact.url) && (
            <button
              type="button"
              className="sampark-research-source-internal"
              onClick={(e) => { e.stopPropagation(); handleSourceClick(e); }}
            >
              View in Research <Icon name="external" size={12} />
            </button>
          )}
        </div>
        {(showWatch || showCompare) && (
          <div className="sampark-research-artifact-actions">
            {showWatch && (
              <button
                type="button"
                className={`sampark-research-mini-action${watched ? ' is-active' : ''}`}
                disabled={Boolean(watchPending)}
                onClick={(e) => { e.stopPropagation(); onWatch(artifact); }}
                aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                <Icon name={watched ? 'check' : 'bookmark'} size={14} /> {watched ? 'Watching' : 'Watch'}
              </button>
            )}
            {showCompare && (
              <button
                type="button"
                className={`sampark-research-mini-action${compared ? ' is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onCompare(artifact); }}
              >
                <Icon name="sort" size={14} /> {compared ? 'Selected' : 'Compare'}
              </button>
            )}
            <button type="button" className="sampark-research-mini-action is-primary" onClick={() => onOpen?.(artifact)}>Dossier</button>
          </div>
        )}
      </div>
    </article>
  );
}
