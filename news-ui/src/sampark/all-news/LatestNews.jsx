import React, { useRef } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';
import NewsCard from './NewsCard.jsx';

export default function LatestNews({ items=[], onOpen, onLike, onDislike, onFollow, onHide, onSourceOpen, votes={}, savedKeys, busyMap={}, savedHydrated, reactionsHydrated }){
  const safeItems = (items || []).filter(Boolean);
  const scrollerRef = useRef(null);

  if(!safeItems.length) return null;

  // header date is today's date from first item
  const today = String(safeItems[0]?.date || new Date().toISOString().slice(0,10)).slice(0,10);
  const count = safeItems.length;

  const scroll = (dir)=>{
    const el = scrollerRef.current;
    if(!el) return;
    const card = el.querySelector('.tsan-news-card');
    const gap = 14;
    const step = card ? card.offsetWidth + gap : 314;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  return (
    <section className="tsan-latest" aria-label="Latest News">
      <header className="tsan-latest-header">
        <h3>Latest News | {today} <span className="tsan-latest-count">({count} News)</span></h3>
        <div className="tsan-latest-controls">
          <button aria-label="Scroll latest left" className="tsan-latest-arrow" onClick={()=> scroll(-1)} type="button"><Icon name="chevL" size={16} /></button>
          <button aria-label="Scroll latest right" className="tsan-latest-arrow" onClick={()=> scroll(1)} type="button"><Icon name="chevR" size={16} /></button>
        </div>
      </header>
      <div className="tsan-latest-scroll" ref={scrollerRef}>
        {safeItems.map(item=> {
          const key = articleKey(item);
          const v = (votes && votes[key]) || item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
          const busyReaction = busyMap?.[`${key}::reaction`];
          const busySave = busyMap?.[`${key}::save`];
          const busyHide = busyMap?.[`${key}::hide`];
          const reactionReady = Boolean(reactionsHydrated || (votes && votes[key]) || item.reactions);
          const saveReady = Boolean(savedHydrated);
          return <NewsCard key={key} variant="latest" item={item} onOpen={onOpen} onLike={onLike} onDislike={onDislike} onFollow={onFollow} onHide={onHide} onSourceOpen={onSourceOpen} isFollowing={savedKeys?.has(key)} likeActive={v.viewer_reaction==='like'} dislikeActive={v.viewer_reaction==='dislike'} busyReaction={busyReaction} busySave={busySave} busyHide={busyHide} savedHydrated={saveReady} reactionsHydrated={reactionReady} />;
        })}
      </div>
    </section>
  );
}
