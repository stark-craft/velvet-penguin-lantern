import React, { useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { imageOf } from './allNewsModel.js';

export default function FeaturedCarousel({ items=[], onOpen }){
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(()=>{
    if(paused || items.length<2) return undefined;
    const t = window.setTimeout(()=> setIndex(v=> (v+1)%items.length), 6000);
    return ()=> window.clearTimeout(t);
  },[index, items.length, paused]);

  useEffect(()=>{ if(index>=items.length) setIndex(0); },[index, items.length]);

  if(!items.length){
    return <div className="tsan-featured-empty"><Icon name="inbox" size={24} /><p>No featured stories for this selection.</p></div>;
  }

  const item = items[index];
  const image = imageOf(item);
  const source = item.src || item.source || 'TechScout';
  const time = item.date || 'Latest';

  return (
    <section aria-label="Featured News" className="tsan-featured" onMouseEnter={()=> setPaused(true)} onMouseLeave={()=> setPaused(false)}>
      <div className="tsan-featured-media" style={image ? { backgroundImage:`url("${image}")`} : undefined}>
        {!image && <div className="tsan-featured-fallback"><Icon name="globe" size={48} /></div>}
        <div className="tsan-featured-gradient" aria-hidden="true" />
        <div className="tsan-featured-overlay">
          <span className="tsan-featured-kicker">{source} · {time}</span>
          <button className="tsan-featured-title" onClick={()=> onOpen?.(item)} type="button"><h3>{item.title}</h3></button>
        </div>
      </div>
      {items.length>1 && (
        <>
          <button aria-label="Previous featured story" className="tsan-featured-arrow is-prev" onClick={()=> setIndex(v=> (v+items.length-1)%items.length)} type="button"><Icon name="chevL" size={18} /></button>
          <button aria-label="Next featured story" className="tsan-featured-arrow is-next" onClick={()=> setIndex(v=> (v+1)%items.length)} type="button"><Icon name="chevR" size={18} /></button>
          <div className="tsan-featured-dots" role="tablist" aria-label="Featured stories">
            {items.map((_,i)=>(
              <button key={i} aria-label={`Show featured story ${i+1}`} aria-selected={i===index} className={`tsan-dot${i===index?' is-active':''}`} onClick={()=> setIndex(i)} role="tab" type="button" />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
