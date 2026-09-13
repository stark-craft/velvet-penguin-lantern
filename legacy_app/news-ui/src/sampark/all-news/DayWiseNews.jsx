import React, { useEffect, useState } from 'react';
import NewsCard from './NewsCard.jsx';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';

const INITIAL_DAYS = 3;
const MORE_DAYS = 5;

export default function DayWiseNews({ grouped, onOpen, onLike, onDislike, onFollow, onHide, onSourceOpen, votes, savedKeys, busyMap, savedHydrated, reactionsHydrated }){
  const safeGrouped = (grouped || []).filter(Boolean).map(([d, its])=> [d, (its||[]).filter(Boolean)]).filter(([,its])=> its.length);
  const [visibleDays, setVisibleDays] = useState(INITIAL_DAYS);
  useEffect(() => { setVisibleDays(INITIAL_DAYS); }, [grouped]);
  if(!safeGrouped.length){
    return <p className="tsan-empty">No news matches these filters.</p>;
  }
  const shown = safeGrouped.slice(0, visibleDays);
  const remaining = safeGrouped.length - shown.length;
  const remainingCards = safeGrouped.slice(visibleDays).reduce((n, [, its]) => n + its.length, 0);
  return (
    <div className="tsan-daywise">
      {shown.map(([date, items])=>(
        <section key={date} className="tsan-day-section" aria-label={`News for ${date}`}>
          <header className="tsan-day-header">
            <h3>News</h3>
            <span className="tsan-day-rule" aria-hidden="true" />
            <span className="tsan-day-date">{date}</span>
            <span className="tsan-day-count">({items.length} News)</span>
          </header>
          <div className="tsan-day-grid">
            {items.map(item=> {
              const key = articleKey(item);
              const v = votes?.[key] || item.reactions || {};
              const busyReaction = Boolean(busyMap?.[`${key}::reaction`]);
              const busySave = Boolean(busyMap?.[`${key}::save`]);
              const busyHide = Boolean(busyMap?.[`${key}::hide`]);
              const reactionReady = Boolean(reactionsHydrated || votes[key] || item.reactions);
              const saveReady = Boolean(savedHydrated);
              return <NewsCard key={key} item={item} onOpen={onOpen} onLike={onLike} onDislike={onDislike} onFollow={onFollow} onHide={onHide} onSourceOpen={onSourceOpen} isFollowing={savedKeys?.has(key)} likeActive={v.viewer_reaction==='like'} dislikeActive={v.viewer_reaction==='dislike'} busyReaction={busyReaction} busySave={busySave} busyHide={busyHide} savedHydrated={saveReady} reactionsHydrated={reactionReady} />;
            })}
          </div>
        </section>
      ))}
      {remaining > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn-secondary" onClick={() => setVisibleDays((d) => d + MORE_DAYS)} type="button">
            Show older days ({remaining} more day{remaining === 1 ? '' : 's'} · {remainingCards} stories)
          </button>
        </div>
      )}
    </div>
  );
}
