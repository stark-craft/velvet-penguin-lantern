import React, { useEffect, useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';

export default function ForYouCard({
  item,
  index,
  section,
  saved,
  onOpen,
  onSave,
  onHide,
  onReact,
  onImpression,
  busyAction = '',
  compact = false,
}) {
  const ref = useRef(null);
  const timer = useRef(null);
  const fired = useRef(false);
  const visibleRatio = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || fired.current || !('IntersectionObserver' in window)) return undefined;
    const beginQualification = () => {
      if (fired.current || timer.current || visibleRatio.current < 0.5 || document.visibilityState !== 'visible') return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (document.visibilityState !== 'visible' || visibleRatio.current < 0.5) return;
        fired.current = true;
        onImpression?.(item, { position: index, section, visible_ratio: visibleRatio.current });
      }, 1500);
    };
    const clearQualification = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const observer = new IntersectionObserver(([entry]) => {
      visibleRatio.current = entry.isIntersecting ? entry.intersectionRatio : 0;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !fired.current) {
        beginQualification();
      } else {
        clearQualification();
      }
    }, { threshold: [0.5, 0.75] });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') beginQualification();
      else clearQualification();
    };
    observer.observe(node);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      clearQualification();
    };
  }, [index, item, onImpression, section]);

  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  return (
    <article aria-busy={Boolean(busyAction)} className={`fy-card${compact ? ' is-compact' : ''}`} ref={ref}>
      <button aria-label={`Open dossier for ${item.title}`} className="fy-card-open-layer" onClick={() => onOpen(item)} type="button" />
      <div className="fy-card-visual"><SignalVisual item={item} label={false} /></div>
      <div className="fy-card-body">
        <div className="fy-card-topline">
          <span className="fy-source-chip">{item.category || item.article_intent || 'Intelligence'}</span>
          {item.is_fresh && <span className="fy-new-chip">New</span>}
        </div>
        <div className="fy-card-meta">{item.src || item.source || 'Intelligence source'} · {item.source_count || 1} source{(item.source_count || 1) === 1 ? '' : 's'} · {item.mins_read || 1} min</div>
        <h3 className="fy-card-title">{item.title}</h3>
        {!compact && item.attention_hook && (
          <div className="fy-hook">
            <span>AI context</span>
            <p>{item.attention_hook}</p>
          </div>
        )}
        <div className="fy-card-footer">
          <div className="fy-card-actions">
            <button aria-label={saved ? `Stop following ${item.title}` : `Follow ${item.title}`} className={saved ? 'active' : ''} disabled={Boolean(busyAction)} onClick={() => onSave(item)} title={saved ? 'Unfollow this story' : 'Follow this story privately'} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={15} /> {busyAction === 'save' ? 'Updating…' : saved ? 'Following' : 'Follow'}</button>
            <button aria-label={`Like ${item.title}`} className={reactions.viewer_reaction === 'like' ? 'active' : ''} disabled={Boolean(busyAction)} onClick={() => onReact(item, 'like')} title="Like" type="button"><Icon name="thumbsUp" size={15} /><span>{reactions.like_count}</span></button>
            <button aria-label={`Dislike ${item.title}`} className={reactions.viewer_reaction === 'dislike' ? 'active is-dislike' : ''} disabled={Boolean(busyAction)} onClick={() => onReact(item, 'dislike')} title="Dislike" type="button"><Icon name="thumbsDown" size={15} /><span>{reactions.dislike_count}</span></button>
            <button aria-label={`Hide ${item.title} only from your feed`} disabled={Boolean(busyAction)} onClick={() => onHide(item)} title="Hide only from your feed" type="button"><Icon name="eye" size={15} /></button>
          </div>
        </div>
      </div>
    </article>
  );
}
