import React, { useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';
import { resolveDossierView } from './dossierModel.js';
import { correctRegion } from '../../news-scrapper/api.js';

// Shared Sampark news/article dossier (All News, For You, Search, Following,
// History, Samsung readers). Research artifacts keep their own dossier.
// Field resolution lives in dossierModel.js: every available field renders,
// genuinely absent fields stay hidden — never fabricated.
// Like/Follow/Hide render only when their handlers are provided.
export default function SamparkArticleDossier({
  item,
  onClose,
  saved = false,
  onSave,
  onHide,
  onReact,
  onSourceOpen,
  onWhyOpen,
  trailingMeta = '',
  savedHydrated = true,
  reactionsHydrated = true,
  showHide = true,
  titleId = 'sampark-article-dossier-title',
}) {
  const ref = useModalFocus(Boolean(item), onClose);
  const [correcting, setCorrecting] = useState(false);
  const [regionMsg, setRegionMsg] = useState('');
  const key = item ? articleKey(item) : '';
  // Reset transient correction state when the article changes.
  useEffect(() => { setCorrecting(false); setRegionMsg(''); }, [key]);
  if (!item) return null;

  const view = resolveDossierView(item);
  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  const subtitle = [view.subtitle, trailingMeta].filter(Boolean).join(' · ');
  const showActions = Boolean(onReact || onSave || (onHide && showHide));
  const handleSourceOpen = () => { onSourceOpen?.(item); };
  const handleCorrectRegion = async (regionValue) => {
    if (!view.correction) return;
    setCorrecting(true);
    try {
      await correctRegion(item, regionValue, [], 'user correction');
      setRegionMsg(`Region corrected to ${regionValue}`);
    } catch (e) { setRegionMsg(e?.message || 'Correction failed'); }
    finally { setCorrecting(false); }
  };

  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }} style={{ overflowWrap: 'anywhere' }}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="sampark-dossier sampark-dossier--large" tabIndex={-1} style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        <header className="sampark-dossier-header">
          <div>
            {view.kicker && <div className="sampark-dossier-kicker">{view.kicker}</div>}
            {subtitle && <div className="sampark-dossier-subtitle">{subtitle}</div>}
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {view.image ? <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={view.image} style={{ maxWidth: '100%' }} /></div> : <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>}
          <div className="sampark-dossier-body" style={{ overflowWrap: 'anywhere' }}>
            <h2 id={titleId} className="sampark-dossier-title">{view.title}</h2>
            {view.dateLine && <p style={{ fontSize: 12, color: 'var(--muted)' }}>{view.dateLine}{view.sourceNames ? ` · ${view.sourceNames}` : ''}</p>}
            {view.summaryLead && <p className="sampark-dossier-summary"><strong>{view.summaryLead}</strong></p>}
            {view.summaryPoints.length > 0 && <ul className="sampark-dossier-points">{view.summaryPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            {view.keyPoints.length > 0 && <ul className="sampark-dossier-points">{view.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            {view.summary && <p className="sampark-dossier-summary">{view.summary}</p>}
            {view.summarizedBy && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Summarized by: {view.summarizedBy}</p>}
            {view.masterSummary && <p className="sampark-dossier-summary">{view.masterSummary}</p>}
            {view.snippet && <p className="sampark-dossier-summary">{view.snippet}</p>}
            {view.attentionHook && <div className="sampark-dossier-insight"><strong>Attention hook</strong><p>{view.attentionHook}</p></div>}
            {view.whatChanged && <div className="sampark-dossier-insight"><strong>What changed</strong><p>{view.whatChanged}</p></div>}
            {view.whyNow && <div className="sampark-dossier-insight"><strong>Why now</strong><p>{view.whyNow}</p></div>}
            {view.whyMatters && (
              onWhyOpen ? (
                <button className="sampark-dossier-insight sampark-why-btn" onClick={() => onWhyOpen(item)} type="button">
                  <strong>Why this matters</strong>
                  <p>{view.whyMatters}</p>
                </button>
              ) : (
                <div className="sampark-dossier-insight"><strong>Why this matters</strong><p>{view.whyMatters}</p></div>
              )
            )}
            {view.watchNext && <div className="sampark-dossier-insight"><strong>Watch next</strong><p>{view.watchNext}</p></div>}
            {view.fullBody && <div className="sampark-dossier-insight"><strong>Full article</strong><p style={{ whiteSpace: 'pre-wrap' }}>{view.fullBody}</p></div>}
            {view.keywords.length > 0 && <div className="sampark-dossier-keywords"><span className="sampark-keyword-label">Keywords:</span>{view.keywords.map((k) => <span key={k} className="sampark-keyword">{k}</span>)}</div>}
            {view.entities.length > 0 && <div className="sampark-dossier-keywords"><span className="sampark-keyword-label">Entities:</span>{view.entities.map((k) => <span key={k} className="sampark-keyword">{k}</span>)}</div>}
            {view.correction && <div style={{ marginTop: 8 }}><button disabled={correcting} onClick={() => handleCorrectRegion(view.correction === 'Local' ? 'Local' : 'Global')} type="button" className="btn-secondary">Correct region to {view.correction}</button>{regionMsg && <span style={{ marginLeft: 8, fontSize: 12 }}>{regionMsg}</span>}</div>}
            {view.sourceList.length > 0 && <div style={{ marginTop: 12 }}><strong>Sources ({view.sourceList.length})</strong><ul>{view.sourceList.map((s, i) => <li key={i}>{s.name} {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener" onClick={handleSourceOpen}>open</a> : null}</li>)}</ul></div>}
            {view.externalLink && <a className="sampark-dossier-link" href={view.externalLink} target="_blank" rel="noreferrer noopener" onClick={handleSourceOpen}>Open original source <Icon name="external" size={14} /></a>}
            {view.externalLinkAlt && view.externalLinkAlt !== view.externalLink && <a className="sampark-dossier-link" href={view.externalLinkAlt} target="_blank" rel="noreferrer noopener" onClick={handleSourceOpen} style={{ marginLeft: 8 }}>Open source <Icon name="external" size={14} /></a>}
          </div>
        </div>
        <footer className="sampark-dossier-actions">
          {onReact && (
            <>
              <button className={`sampark-action-btn${reactions.viewer_reaction === 'like' ? ' is-active' : ''}`} disabled={reactionsHydrated === false && !item.reactions} onClick={() => onReact(item, 'like')} type="button"><Icon name="thumbsUp" size={16} /> {reactions.like_count || 0}</button>
              <button className={`sampark-action-btn${reactions.viewer_reaction === 'dislike' ? ' is-active' : ''}`} disabled={reactionsHydrated === false && !item.reactions} onClick={() => onReact(item, 'dislike')} type="button"><Icon name="thumbsDown" size={16} /></button>
            </>
          )}
          {onSave && <button className={`sampark-action-btn${saved ? ' is-active' : ''}`} disabled={savedHydrated === false} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={16} /> {saved ? 'Following' : 'Follow'}</button>}
          {onHide && showHide && <button className="sampark-action-btn" onClick={() => onHide(item)} type="button"><Icon name="eye" size={16} /> Hide</button>}
          {showActions && <span className="sampark-dossier-spacer" />}
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}
