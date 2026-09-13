import React, { useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { imageOf } from './allNewsModel.js';

export default function FeaturedCarousel({ items=[], onOpen }){
  const safeItems = (items || []).filter(Boolean);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [docHidden, setDocHidden] = useState(() => { try { return document.visibilityState === 'hidden'; } catch { return false; } });

  const prefersReducedMotion = () => {
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  };
  const autoplayBlocked = paused || userPaused || safeItems.length < 2 || prefersReducedMotion() || docHidden;

  useEffect(()=>{
    if(autoplayBlocked) return undefined;
    const t = window.setTimeout(()=> setIndex(v=> (v+1)%safeItems.length), 6000);
    return ()=> window.clearTimeout(t);
  },[index, safeItems.length, autoplayBlocked]);

  useEffect(()=>{ if(index>=safeItems.length) setIndex(0); },[index, safeItems.length]);
  useEffect(()=>{
    const onVis = () => { try { setDocHidden(document.visibilityState === 'hidden'); } catch {} };
    document.addEventListener?.('visibilitychange', onVis);
    return () => document.removeEventListener?.('visibilitychange', onVis);
  },[]);
  if(!safeItems.length){
    return <div className="tsan-featured-empty"><Icon name="inbox" size={24} /><p>No featured stories for this selection.</p></div>;
  }

  const safeIndex = index >= safeItems.length ? 0 : index;
  const item = safeItems[safeIndex];
  if(!item){
    return <div className="tsan-featured-empty"><Icon name="inbox" size={24} /><p>No featured stories for this selection.</p></div>;
  }
  const image = imageOf(item);
  const focal = item?.image_focal || item?.focal || null;
  const focalStyle = focal && typeof focal.x === 'number' && typeof focal.y === 'number'
    ? { objectPosition: `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%` }
    : { objectPosition: 'center 35%' };
  const source = item?.src || item?.source || 'TechScout';
  const time = item?.date || 'Latest';
  const showPauseControl = safeItems.length > 1 && !prefersReducedMotion();

  return (
    <section aria-label="Featured News" aria-roledescription="carousel" className="tsan-featured" onMouseEnter={()=> setPaused(true)} onMouseLeave={()=> setPaused(false)} onFocus={()=> setPaused(true)} onBlur={()=> setPaused(false)}>
      {image ? <img alt="" className="tsan-featured-media" src={image} style={focalStyle} /> : <div className="tsan-featured-fallback"><Icon name="globe" size={48} /></div>}
      <div className="tsan-featured-gradient" aria-hidden="true" />
      <div className="tsan-featured-overlay">
        <span className="tsan-featured-kicker">{source} · {time}</span>
        <button className="tsan-featured-title" onClick={()=> onOpen?.(item)} type="button"><h3>{item.title}</h3></button>
      </div>
      {safeItems.length>1 && (
        <>
          <button aria-label="Previous featured story" className="tsan-featured-arrow is-prev" onClick={()=> setIndex(v=> (v+safeItems.length-1)%safeItems.length)} type="button"><Icon name="chevL" size={18} /></button>
          <button aria-label="Next featured story" className="tsan-featured-arrow is-next" onClick={()=> setIndex(v=> (v+1)%safeItems.length)} type="button"><Icon name="chevR" size={18} /></button>
          {showPauseControl && (
            <button aria-label={userPaused ? 'Resume autoplay' : 'Pause autoplay'} aria-pressed={userPaused} className="tsan-featured-pause" onClick={()=> setUserPaused((v)=>!v)} type="button"><Icon name={userPaused ? 'play' : 'pause'} size={14} /></button>
          )}
          <div className="tsan-featured-dots" role="tablist" aria-label="Featured stories">
            {safeItems.map((_,i)=>(
              <button key={i} aria-label={`Show featured story ${i+1}`} aria-selected={i===safeIndex} className={`tsan-dot${i===safeIndex?' is-active':''}`} onClick={()=> setIndex(i)} onKeyDown={(e)=>{ if(e.key==='ArrowRight') setIndex((i+1)%safeItems.length); if(e.key==='ArrowLeft') setIndex((i+safeItems.length-1)%safeItems.length); }} role="tab" type="button" />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
