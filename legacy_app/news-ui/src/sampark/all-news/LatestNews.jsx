import React, { useRef } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import NewsCard from './NewsCard.jsx';

export default function LatestNews({ items=[], onOpen }){
  const scrollerRef = useRef(null);

  if(!items.length) return null;

  // header date is today's date from first item
  const today = String(items[0]?.date || new Date().toISOString().slice(0,10)).slice(0,10);
  const count = items.length;

  const scroll = (dir)=>{
    const el = scrollerRef.current;
    if(!el) return;
    el.scrollBy({ left: dir * 383, behavior: 'smooth' });
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
        {items.map(item=> <NewsCard key={item.title + item.date} item={item} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
