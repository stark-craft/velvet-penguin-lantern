import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import { isCompareSupported, isWatchSupported } from './researchCapabilities.js';

const KIND_ICON = {
  repository: 'terminal',
  paper: 'file',
  model: 'layers',
  dataset: 'server',
  patent: 'note',
  technology: 'radar',
};

function isSafeHttpUrl(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw, window.location.origin);
    return /^https?:$/.test(u.protocol) && Boolean(u.hostname);
  } catch {
    return false;
  }
}
function isExternalHttpUrl(candidate) {
  const raw = String(candidate || '').trim();
  return /^https?:\/\//i.test(raw) && isSafeHttpUrl(raw);
}
function safeHostname(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return 'Provider signal';
  try {
    const u = new URL(raw, window.location.origin);
    if (!/^https?:$/.test(u.protocol)) return 'Provider signal';
    return u.hostname.replace(/^www\./, '') || 'Provider signal';
  } catch {
    return 'Provider signal';
  }
}
function isInternalSynthesized(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (isExternalHttpUrl(u)) return false;
  return u.startsWith('/') && (u.includes('/venturelens') || u.includes('/radar') || u.includes('/research'));
}

export default function ResearchArtifactDetail({ artifact, detail, loading, error, onClose, onRetry, watched, watchPending, onWatch, onCompare, compared }) {
  const dialogRef = useModalFocus(Boolean(artifact || loading || error), onClose);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { setCopied(false); }, [artifact?.id]);

  if (!artifact && !loading && !error) return null;

  const data = detail || artifact;
  const kind = data?.kind || artifact?.kind || 'paper';
  const icon = KIND_ICON[kind] || 'file';
  const title = data?.title || data?.label || artifact?.title || 'Research dossier';
  const displayMetrics = data?.metrics || artifact?.metrics || {};
  const momentum = data?.momentum ?? data?.momentum_score ?? artifact?.momentum ?? artifact?.momentum_score;
  const canWatch = isWatchSupported(kind);
  const canCompare = isCompareSupported(kind);

  const handleCopy = async () => {
    const candidate = String(data?.url || '').trim();
    if (!isExternalHttpUrl(candidate)) return;
    try { await navigator.clipboard.writeText(candidate); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const handleInternalNavigate = (url) => {
    if (!url || !isInternalSynthesized(url)) return;
    try {
      const urlObj = new URL(url, window.location.origin);
      const search = urlObj.search || '';
      navigate(`/research/radar${search}`);
    } catch {
      navigate('/research/radar');
    }
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
                  <small>{safeHostname(data?.url)}</small>
                </div>
              </div>

              <div className="sampark-dossier-body" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                <h2 id="sampark-research-detail-title" className="sampark-dossier-title" style={{ overflowWrap: 'anywhere' }}>{title}</h2>

                {/* Decision hierarchy: assessment -> recommendation -> summary */}
                {data?.assessment && (
                  <section className="sampark-dossier-section">
                    <h3>Assessment</h3>
                    <p className="sampark-dossier-summary">{data.assessment}</p>
                  </section>
                )}
                {data?.recommendation && (
                  <section className="sampark-dossier-section">
                    <h3>Recommendation</h3>
                    <p className="sampark-dossier-summary">{data.recommendation}</p>
                  </section>
                )}
                {data?.executive_summary && (
                  <section className="sampark-dossier-section">
                    <h3>Executive summary</h3>
                    <p className="sampark-dossier-summary">{data.executive_summary}</p>
                  </section>
                )}
                {data?.summary && (
                  <section className="sampark-dossier-section">
                    <h3>Summary</h3>
                    <p className="sampark-dossier-summary">{data.summary}</p>
                  </section>
                )}
                {data?.contribution && (
                  <section className="sampark-dossier-section">
                    <h3>Contribution</h3>
                    <p className="sampark-dossier-summary">{data.contribution}</p>
                  </section>
                )}
                {data?.practical_relevance && (
                  <section className="sampark-dossier-section">
                    <h3>Practical relevance</h3>
                    <p>{data.practical_relevance}</p>
                  </section>
                )}
                {data?.why_now && (
                  <section className="sampark-dossier-section">
                    <h3>Why now</h3>
                    <p>{data.why_now}</p>
                  </section>
                )}
                {data?.why_matters && (
                  <section className="sampark-dossier-section">
                    <h3>Why this matters</h3>
                    <p>{data.why_matters}</p>
                  </section>
                )}

                {Array.isArray(data?.strengths) && data.strengths.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Strengths</h3>
                    <ul>{data.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </section>
                )}
                {Array.isArray(data?.risks) && data.risks.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Risks</h3>
                    <ul>{data.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </section>
                )}
                {Array.isArray(data?.limitations) && data.limitations.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>{kind === 'paper' ? 'Risks / Limitations' : 'Limitations'}</h3>
                    <ul>{data.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  </section>
                )}
                {Array.isArray(data?.risks) && data.risks.length === 0 && Array.isArray(data?.limitations) && data.limitations.length > 0 && null}

                {Object.keys(displayMetrics).length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Evidence metrics</h3>
                    <div className="sampark-research-metrics-grid">
                      {Object.entries(displayMetrics).map(([key, value]) => (
                        value != null && <div key={key} className="sampark-research-metric"><span>{key.replace(/_/g, ' ')}</span><strong>{String(value)}</strong></div>
                      ))}
                      <div className="sampark-research-metric"><span>momentum</span><strong>{momentum == null ? 'first snapshot' : `${momentum >= 0 ? '+' : ''}${momentum}%`}</strong></div>
                    </div>
                    <small className="sampark-research-metrics-note">Metrics are compared only with other artifacts of the same type.</small>
                  </section>
                )}

                {/* Repository metadata */}
                {(data?.language || data?.stars != null || data?.forks != null || data?.open_issues != null || data?.license || data?.updated_at) && (
                  <section className="sampark-dossier-section">
                    <h3>Repository metadata</h3>
                    <div className="sampark-research-metrics-grid">
                      {data?.language && <div className="sampark-research-metric"><span>language</span><strong>{data.language}</strong></div>}
                      {data?.stars != null && <div className="sampark-research-metric"><span>stars</span><strong>{String(data.stars)}</strong></div>}
                      {data?.forks != null && <div className="sampark-research-metric"><span>forks</span><strong>{String(data.forks)}</strong></div>}
                      {data?.open_issues != null && <div className="sampark-research-metric"><span>open issues</span><strong>{String(data.open_issues)}</strong></div>}
                      {data?.license && <div className="sampark-research-metric"><span>license</span><strong>{String(data.license)}</strong></div>}
                      {data?.updated_at && <div className="sampark-research-metric"><span>updated</span><strong>{String(data.updated_at).slice(0, 10)}</strong></div>}
                    </div>
                  </section>
                )}

                {/* Topics / tags */}
                {Array.isArray(data?.topics) && data.topics.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Topics</h3>
                    <div className="sampark-dossier-keywords">{data.topics.slice(0, 12).map((t) => <span key={t} className="sampark-keyword">{t}</span>)}</div>
                  </section>
                )}
                {Array.isArray(data?.tags) && data.tags.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Tags</h3>
                    <div className="sampark-dossier-keywords">{data.tags.slice(0, 12).map((t) => <span key={t} className="sampark-keyword">{t}</span>)}</div>
                  </section>
                )}
                {(Array.isArray(data?.keywords) && data.keywords.length > 0) && (
                  <section className="sampark-dossier-section">
                    <h3>Keywords</h3>
                    <div className="sampark-dossier-keywords">{data.keywords.slice(0, 12).map((t) => <span key={String(t)} className="sampark-keyword">{String(t)}</span>)}</div>
                  </section>
                )}

                {Array.isArray(data?.authors) && data.authors.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Authors</h3>
                    <p style={{ overflowWrap: 'anywhere' }}>{data.authors.join(' · ')}</p>
                  </section>
                )}
                {Array.isArray(data?.institutions) && data.institutions.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Institutions</h3>
                    <p style={{ overflowWrap: 'anywhere' }}>{data.institutions.join(' · ')}</p>
                  </section>
                )}
                {(data?.doi || data?.arxiv_id || data?.arxivId) && (
                  <section className="sampark-dossier-section">
                    <h3>Identifiers</h3>
                    {data?.doi && <p className="sampark-research-detail-doi" style={{ overflowWrap: 'anywhere' }}><strong>DOI:</strong> {data.doi}</p>}
                    {(data?.arxiv_id || data?.arxivId) && <p className="sampark-research-detail-doi" style={{ overflowWrap: 'anywhere' }}><strong>arXiv:</strong> {data.arxiv_id || data.arxivId}</p>}
                  </section>
                )}

                {/* Connected repositories / papers - validated external URLs only */}
                {Array.isArray(data?.repositories) && data.repositories.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Connected repositories</h3>
                    <ul>
                      {data.repositories.slice(0, 6).map((repo) => {
                        const href = repo.url || repo.html_url || '';
                        const safe = isExternalHttpUrl(href) ? href : '';
                        const internal = !safe && isInternalSynthesized(href) ? href : '';
                        return (
                          <li key={repo.id || repo.full_name} style={{ overflowWrap: 'anywhere' }}>
                            <strong>{repo.full_name || repo.name || repo.id}</strong> · {repo.momentum_score != null ? `${repo.momentum_score} momentum` : ''} {repo.stars != null ? `· ${repo.stars} ★` : ''} {safe ? <a href={safe} target="_blank" rel="noreferrer noopener"> — open</a> : internal ? <button type="button" onClick={() => handleInternalNavigate(internal)} style={{ color: 'var(--primary)', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}> — view in Research</button> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {Array.isArray(data?.papers) && data.papers.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Connected papers</h3>
                    <ul>
                      {data.papers.slice(0, 6).map((p) => {
                        const href = p.url || '';
                        const safe = isExternalHttpUrl(href) ? href : '';
                        const internal = !safe && isInternalSynthesized(href) ? href : '';
                        return (
                          <li key={p.id} style={{ overflowWrap: 'anywhere' }}>
                            <strong>{p.title || p.id}</strong> {safe ? <a href={safe} target="_blank" rel="noreferrer noopener"> — open</a> : internal ? <button type="button" onClick={() => handleInternalNavigate(internal)} style={{ color: 'var(--primary)', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }}> — view in Research</button> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {Array.isArray(data?.related_papers) && data.related_papers.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Related papers</h3>
                    <ul>
                      {data.related_papers.slice(0, 5).map((p) => {
                        const href = p.url || '';
                        const safe = isExternalHttpUrl(href) ? href : '';
                        return (
                          <li key={p.id} style={{ overflowWrap: 'anywhere' }}><strong>{p.title || p.id}</strong> {safe ? <a href={safe} target="_blank" rel="noreferrer noopener"> — open</a> : null}</li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {Array.isArray(data?.related_repositories) && data.related_repositories.length > 0 && (
                  <section className="sampark-dossier-section">
                    <h3>Related repositories</h3>
                    <ul>
                      {data.related_repositories.slice(0, 5).map((r) => {
                        const href = r.url || r.html_url || '';
                        const safe = isExternalHttpUrl(href) ? href : '';
                        return (
                          <li key={r.id} style={{ overflowWrap: 'anywhere' }}><strong>{r.full_name || r.name || r.id}</strong> {safe ? <a href={safe} target="_blank" rel="noreferrer noopener"> — open</a> : null}</li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                <section className="sampark-dossier-section">
                  <h3>Provider links</h3>
                  <div className="sampark-research-detail-links" style={{ flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
                    {isExternalHttpUrl(data?.url) && <a className="sampark-dossier-link" href={data.url} target="_blank" rel="noreferrer noopener">Open original source <Icon name="external" size={14} /></a>}
                    {isExternalHttpUrl(data?.html_url) && !isExternalHttpUrl(data?.url) && <a className="sampark-dossier-link" href={data.html_url} target="_blank" rel="noreferrer noopener">Open repository <Icon name="external" size={14} /></a>}
                    {isExternalHttpUrl(data?.html_url) && isExternalHttpUrl(data?.url) && <a className="sampark-dossier-link" href={data.html_url} target="_blank" rel="noreferrer noopener">Open repository <Icon name="external" size={14} /></a>}
                    {isExternalHttpUrl(data?.pdf_url) && <a className="sampark-dossier-link" href={data.pdf_url} target="_blank" rel="noreferrer noopener">Open PDF <Icon name="external" size={14} /></a>}
                    {data?.url && isInternalSynthesized(data.url) && <button type="button" className="sampark-dossier-link" onClick={() => handleInternalNavigate(data.url)} style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--primary)', textDecoration: 'underline' }}>View in Research <Icon name="external" size={14} /></button>}
                    {data?.venue && <span className="sampark-research-detail-venue">Venue: {data.venue}{data.open_access ? ' · Open access' : ''}</span>}
                    {!isExternalHttpUrl(data?.url) && !isExternalHttpUrl(data?.html_url) && !isExternalHttpUrl(data?.pdf_url) && !isInternalSynthesized(data?.url) && <span style={{ color: 'var(--muted)', fontSize: 12 }}>No external provider link available.</span>}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        {!loading && !error && data && (
          <footer className="sampark-dossier-actions">
            {onWatch && canWatch && (
              <button className={`sampark-action-btn${watched ? ' is-active' : ''}`} disabled={Boolean(watchPending)} onClick={() => onWatch(data)} type="button">
                <Icon name={watched ? 'check' : 'bookmark'} size={16} /> {watched ? 'Watching' : 'Watch privately'}
              </button>
            )}
            {onCompare && canCompare && (
              <button className={`sampark-action-btn${compared ? ' is-active' : ''}`} onClick={() => onCompare(data)} type="button">
                <Icon name="sort" size={16} /> {compared ? 'Selected' : 'Add to compare'}
              </button>
            )}
            {isExternalHttpUrl(data?.url) && <button className="sampark-action-btn" onClick={handleCopy} type="button"><Icon name={copied ? 'check' : 'duplicate'} size={16} /> {copied ? 'Copied' : 'Copy link'}</button>}
            <span className="sampark-dossier-spacer" />
            <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
          </footer>
        )}
      </section>
    </div>
  );
}
