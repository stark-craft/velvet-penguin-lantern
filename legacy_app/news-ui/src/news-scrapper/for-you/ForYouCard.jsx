import React, { useEffect, useRef } from 'react';
import Icon from '../components/Icon.jsx';
import Bouncer from '../components/Bouncer.jsx';
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
  executiveVariant = '',
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
    <article aria-busy={Boolean(busyAction)} className={`fy-card${compact ? ' is-compact' : ''}${executiveVariant ? ` is-executive-${executiveVariant}` : ''}`} ref={ref}>
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
            <button aria-label={saved ? `Stop following ${item.title}` : `Follow ${item.title}`} className={`fy-follow-action${saved ? ' active' : ''}`} data-tooltip={saved ? 'Stop following this story' : 'Follow this story for closely related updates'} disabled={Boolean(busyAction)} onClick={() => onSave(item)} title={busyAction === 'save' ? 'Updating follow state' : saved ? 'Unfollow this story' : 'Follow this story privately'} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={15} /><span>{saved ? 'Following' : 'Follow'}</span></button>
            <Bouncer disabled={Boolean(busyAction)} dislikeCount={reactions.dislike_count} likeCount={reactions.like_count} reactions={reactions} onVote={(value) => onReact(item, value)} />
            <button aria-label={`Hide ${item.title} only from your feed`} className="fy-hide-action" data-tooltip="Hide this article only from your private feed" disabled={Boolean(busyAction)} onClick={() => onHide(item)} title="Hide only from your feed" type="button"><Icon name="eye" size={15} /></button>
          </div>
        </div>
      </div>
    </article>
  );
}
