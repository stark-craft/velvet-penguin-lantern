import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { scoreOf } from '../../news-scrapper/utils/intelligence.js';

export default function AllNewsRail({ items=[], onOpen }){
  const [paused, setPaused] = useState(false);
  const listRef = useRef(null);
  const trackRef = useRef(null);

  // duplicate content for seamless loop if enough items
  const display = items.length ? [...items, ...items] : [];

  useEffect(()=>{
    const el = trackRef.current;
    if(!el || paused || !items.length) return undefined;
    let raf;
    let offset = 0;
    const speed = 0.3; // px per frame ~18px/s
    const step = ()=>{
      offset += speed;
      if(el){
        // when first copy scrolled fully, reset
        const half = el.scrollHeight / 2;
        if(offset >= half) offset = 0;
        el.style.transform = `translateY(-${offset}px)`;
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return ()=> window.cancelAnimationFrame(raf);
  },[paused, items.length]);

  if(!items.length){
    return (
      <aside className="tsan-rail" aria-label="All News">
        <h3 className="tsan-rail-title">All News</h3>
        <p className="tsan-rail-empty">All News will appear after the briefing loads.</p>
      </aside>
    );
  }

  return (
    <aside className="tsan-rail" aria-label="All News" onMouseEnter={()=> setPaused(true)} onMouseLeave={()=> setPaused(false)}>
      <h3 className="tsan-rail-title">All News</h3>
      <div className="tsan-rail-window" ref={listRef}>
        <div className="tsan-rail-track" ref={trackRef}>
          {display.map((item, idx)=>(
            <button
              key={`${item.title}-${idx}`}
              aria-hidden={idx >= items.length ? 'true' : undefined}
              tabIndex={idx >= items.length ? -1 : 0}
              className="tsan-rail-item"
              onClick={()=> onOpen?.(item)}
              type="button"
            >
              <span className="tsan-rail-category">{item.category || 'Technology'}</span>
              <strong className="tsan-rail-headline">{item.title}</strong>
              <span className="tsan-rail-meta">{item.src || item.source || 'TechScout'} · {item.date || 'Latest'} · Score {scoreOf(item)}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
