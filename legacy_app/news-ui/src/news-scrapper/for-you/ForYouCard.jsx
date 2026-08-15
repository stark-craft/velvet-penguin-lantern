import React, { useEffect, useRef } from 'react';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';
import RecommendationReason from './RecommendationReason.jsx';

export default function ForYouCard({
  item,
  index,
  section,
  saved,
  selected,
  onOpen,
  onSave,
  onSelect,
  onHide,
  onInterested,
  onLessLikeThis,
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

  const recommendation = item.recommendation || {};
  const primaryReason = recommendation.reasons?.[0] || 'Selected from today’s trusted briefing';
  return (
    <article aria-busy={Boolean(busyAction)} className={`fy-card${compact ? ' is-compact' : ''}`} ref={ref}>
      <div className="fy-card-visual"><SignalVisual item={item} label={false} /></div>
      <div className="fy-card-body">
        <div className="fy-card-topline">
          <span className={recommendation.exploration ? 'fy-reason-chip is-exploration' : 'fy-reason-chip'}>
            <Icon name={recommendation.exploration ? 'globe' : 'sparkle'} size={12} /> {primaryReason}
          </span>
          {item.is_fresh && <span className="fy-new-chip">New</span>}
        </div>
        <div className="fy-card-meta">{item.src || item.source || 'Intelligence source'} · {item.source_count || 1} source{(item.source_count || 1) === 1 ? '' : 's'} · {item.mins_read || 1} min</div>
        <button className="fy-card-title" onClick={() => onOpen(item)} type="button">{item.title}</button>
        {item.attention_hook && (
          <div className="fy-hook">
            <span>AI context</span>
            <p>{item.attention_hook}</p>
          </div>
        )}
        {item.why_now && <p className="fy-why-now"><strong>Why now:</strong> {item.why_now}</p>}
        <div className="fy-card-footer">
          <RecommendationReason recommendation={recommendation} />
          <div className="fy-card-actions">
            <button onClick={() => onOpen(item)} title="Open 30-second intelligence dossier" type="button"><Icon name="file" size={15} /> Open</button>
            <button aria-label={saved ? `Stop following ${item.title}` : `Follow ${item.title}`} className={saved ? 'active' : ''} disabled={Boolean(busyAction)} onClick={() => onSave(item)} title={saved ? 'Remove from saved stories' : 'Save and follow this story'} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={15} /> {busyAction === 'save' ? 'Saving…' : saved ? 'Following' : 'Follow'}</button>
            {!selected && <button disabled={Boolean(busyAction)} onClick={() => onSelect(item)} title="Send to the shared review queue" type="button"><Icon name="check2" size={15} /> Select</button>}
            <button aria-label={`Show more intelligence like ${item.title}`} disabled={Boolean(busyAction)} onClick={() => onInterested(item)} title="More intelligence like this" type="button"><Icon name="thumbsUp" size={15} /></button>
            <button aria-label={`Show fewer stories like ${item.title}`} disabled={Boolean(busyAction)} onClick={() => onLessLikeThis(item)} title="Privately show fewer stories like this" type="button"><Icon name="thumbsDown" size={15} /></button>
            <button aria-label={`Hide ${item.title} only from your feed`} disabled={Boolean(busyAction)} onClick={() => onHide(item)} title="Hide only from your feed" type="button"><Icon name="eye" size={15} /></button>
          </div>
        </div>
      </div>
    </article>
  );
}
