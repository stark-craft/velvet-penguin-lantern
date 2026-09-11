import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';

const KIND_ICON = {
  repository: 'terminal',
  paper: 'file',
  model: 'layers',
  dataset: 'server',
  patent: 'note',
  technology: 'radar',
};

export default function ResearchArtifactDetail({ artifact, detail, loading, error, onClose, onRetry, watched, watchPending, onWatch, onCompare, compared }) {
  const dialogRef = useModalFocus(Boolean(artifact || loading || error), onClose);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCopied(false); }, [artifact?.id]);

  if (!artifact && !loading && !error) return null;

  const data = detail || artifact;
  const kind = data?.kind || artifact?.kind || 'paper';
  const icon = KIND_ICON[kind] || 'file';
  const title = data?.title || artifact?.title || 'Research dossier';
  const displayMetrics = data?.metrics || artifact?.metrics || {};
  const momentum = data?.momentum ?? artifact?.momentum;

  const handleCopy = async () => {
    if (!data?.url) return;
    try { await navigator.clipboard.writeText(data.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sampark-research-detail-title"
        className="sampark-dossier sampark-dossier--large"
        tabIndex={-1}
      >
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{kind} · {data?.source || 'Research'} · {data?.category || 'General'}</div>
            <div className="sampark-dossier-subtitle">
              {data?.published_at || data?.updated_at ? String(data.published_at || data.updated_at).slice(0, 10) : 'Evidence signal'}
              {data?.id ? ` · ${data.id}` : ''}
              {data?.starter_snapshot ? ' · Starter snapshot' : ''}
            </div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>

        <div className="sampark-dossier-scroll">
          {loading ? (
            <div className="sampark-workspace-loading" style={{ minHeight: 220 }}><span className="sampark-spinner" /> Building dossier…</div>
          ) : error ? (
            <div className="sampark-workspace-empty" role="alert" style={{ margin: 16 }}>
              <Icon name="warning" size={20} />
              <h3>Dossier temporarily unavailable</h3>
              <p>{error}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-primary" onClick={onRetry} type="button">Try again</button>
                <button className="btn-secondary" onClick={onClose} type="button">Close</button>
              </div>
            </div>
          ) : (
            <>
              <div className="sampark-research-detail-visual" aria-hidden="true">
                <span className={`sampark-research-visual-icon is-${kind} is-large`}><Icon name={icon} size={40} /></span>
                <div>
                  <strong>{data?.source || kind}</strong>
                  <small>{data?.url ? new URL(data.url).hostname.replace(/^www\./, '') : 'Provider signal'}</small>
                </div>
              </div>

              <div className="sampark-dossier-body">
                <h2 id="sampark-research-detail-title" className="sampark-dossier-title">{title}</h2>

                {data?.assessment && <p className="sampark-dossier-summary"><strong>Assessment:</strong> {data.assessment}</p>}
                {data?.summary && <p className="sampark-dossier-summary">{data.summary}</p>}
                {data?.practical_relevance && <div className="sampark-dossier-insight"><strong>Practical relevance</strong><p>{data.practical_relevance}</p></div>}
                {data?.why_now && <div className="sampark-dossier-insight"><strong>Why now</strong><p>{data.why_now}</p></div>}

                {Object.keys(displayMetrics).length > 0 && (
                  <div className="sampark-research-detail-metrics">
                    <h3>Evidence metrics</h3>
                    <div className="sampark-research-metrics-grid">
                      {Object.entries(displayMetrics).map(([key, value]) => (
                        value != null && <div key={key} className="sampark-research-metric"><span>{key.replace(/_/g, ' ')}</span><strong>{String(value)}</strong></div>
                      ))}
                      <div className="sampark-research-metric"><span>momentum</span><strong>{momentum == null ? 'first snapshot' : `${momentum >= 0 ? '+' : ''}${momentum}%`}</strong></div>
                    </div>
                    <small className="sampark-research-metrics-note">Metrics are compared only with other artifacts of the same type.</small>
                  </div>
                )}

                {Array.isArray(data?.authors) && data.authors.length > 0 && (
                  <div className="sampark-research-detail-block"><h3>Authors</h3><p>{data.authors.join(' · ')}</p></div>
                )}
                {Array.isArray(data?.institutions) && data.institutions.length > 0 && (
                  <div className="sampark-research-detail-block"><h3>Institutions</h3><p>{data.institutions.join(' · ')}</p></div>
                )}
                {Array.isArray(data?.tags) && data.tags.length > 0 && (
                  <div className="sampark-dossier-keywords">{data.tags.slice(0, 8).map((t) => <span key={t} className="sampark-keyword">{t}</span>)}</div>
                )}
                {Array.isArray(data?.topics) && data.topics.length > 0 && (
                  <div className="sampark-dossier-keywords">{data.topics.slice(0, 8).map((t) => <span key={t} className="sampark-keyword">{t}</span>)}</div>
                )}
                {data?.doi && <p className="sampark-research-detail-doi"><strong>DOI:</strong> {data.doi}</p>}
                {data?.arxiv_id && <p className="sampark-research-detail-doi"><strong>arXiv:</strong> {data.arxiv_id}</p>}

                {Array.isArray(data?.limitations) && data.limitations.length > 0 && (
                  <div className="sampark-research-detail-limitations">
                    <h3>Limitations</h3>
                    <ul>{data.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  </div>
                )}

                <div className="sampark-research-detail-links">
                  {data?.url && <a className="sampark-dossier-link" href={data.url} target="_blank" rel="noreferrer">Open original source <Icon name="external" size={14} /></a>}
                  {data?.pdf_url && <a className="sampark-dossier-link" href={data.pdf_url} target="_blank" rel="noreferrer">Open PDF <Icon name="external" size={14} /></a>}
                  {data?.venue && <span className="sampark-research-detail-venue">Venue: {data.venue}{data.open_access ? ' · Open access' : ''}</span>}
                </div>
              </div>
            </>
          )}
        </div>

        {!loading && !error && data && (
          <footer className="sampark-dossier-actions">
            {onWatch && (
              <button className={`sampark-action-btn${watched ? ' is-active' : ''}`} disabled={Boolean(watchPending)} onClick={() => onWatch(data)} type="button">
                <Icon name={watched ? 'check' : 'bookmark'} size={16} /> {watched ? 'Watching' : 'Watch privately'}
              </button>
            )}
            {onCompare && (
              <button className={`sampark-action-btn${compared ? ' is-active' : ''}`} onClick={() => onCompare(data)} type="button">
                <Icon name="sort" size={16} /> {compared ? 'Selected' : 'Add to compare'}
              </button>
            )}
            {data?.url && <button className="sampark-action-btn" onClick={handleCopy} type="button"><Icon name={copied ? 'check' : 'duplicate'} size={16} /> {copied ? 'Copied' : 'Copy link'}</button>}
            <span className="sampark-dossier-spacer" />
            <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
          </footer>
        )}
      </section>
    </div>
  );
}
