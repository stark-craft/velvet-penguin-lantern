import React from 'react';
import NewsCard from './NewsCard.jsx';

export default function DayWiseNews({ grouped, onOpen }){
  if(!grouped?.length){
    return <p className="tsan-empty">No news matches these filters.</p>;
  }
  return (
    <div className="tsan-daywise">
      {grouped.map(([date, items])=>(
        <section key={date} className="tsan-day-section" aria-label={`News for ${date}`}>
          <header className="tsan-day-header">
            <h3>News</h3>
            <span className="tsan-day-rule" aria-hidden="true" />
            <span className="tsan-day-date">{date}</span>
            <span className="tsan-day-count">({items.length} News)</span>
          </header>
          <div className="tsan-day-grid">
            {items.map(item=> <NewsCard key={item.title + (item.date||'') + (item.link||'')} item={item} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
