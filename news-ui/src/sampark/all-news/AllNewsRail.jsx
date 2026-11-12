import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { scoreOf } from '../../news-scrapper/utils/intelligence.js';
import useAutoplayState from '../../news-scrapper/hooks/useAutoplayState.js';
import { advanceRailOffset, normalizeRailOffset, railCopyCount, railLoopDistance } from './railMotion.js';

export default function AllNewsRail({ items=[], onOpen }){
  const safeItems = useMemo(()=> (items || []).filter(Boolean), [items]);
  const [manualPaused, setManualPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  const [copies, setCopies] = useState(2);
  const { documentVisible, reducedMotion } = useAutoplayState();
  const listRef = useRef(null);
  const trackRef = useRef(null);
  const offsetRef = useRef(0);
  const distanceRef = useRef(0);

  const display = Array.from({ length: copies }, ()=> safeItems).flat();
  const itemSig = JSON.stringify(safeItems.map((it)=> [it?.title, it?.date, it?.src || it?.source, it?.category]));
  const hasItems = safeItems.length > 0;
  const shouldAnimate = hasItems && !manualPaused && !hovered && !focused && inView && documentVisible;

  useEffect(()=>{
    if (!hasItems) {
      setHovered(false);
      setFocused(false);
      setInView(true);
    }
    const el = listRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries)=>{ setInView(Boolean(entries[0]?.isIntersecting)); }, { threshold: 0 });
    obs.observe(el);
    return ()=> obs.disconnect();
  }, [hasItems]);

  useEffect(()=>{
    const track = trackRef.current;
    const viewport = listRef.current;
    if (!track || !viewport) return undefined;
    offsetRef.current = 0;
    const measure = ()=> {
      distanceRef.current = railLoopDistance(track, safeItems.length);
      offsetRef.current = normalizeRailOffset(offsetRef.current, distanceRef.current);
      track.style.transform = `translateY(-${offsetRef.current}px)`;
      const needed = railCopyCount(viewport.clientHeight, distanceRef.current);
      setCopies((current)=> current === needed ? current : needed);
    };
    measure();
    // Text wrapping, browser zoom and monitor moves can change either dimension.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    observer?.observe(viewport);
    window.addEventListener('resize', measure);
    return ()=> {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [itemSig, safeItems.length]);

  useEffect(()=>{
    const el = trackRef.current;
    if(!el || !shouldAnimate) return undefined;
    let raf;
    let previousTime = null;
    const step = (now)=>{
      const elapsed = previousTime === null ? 0 : now - previousTime;
      previousTime = now;
      offsetRef.current = advanceRailOffset(offsetRef.current, elapsed, distanceRef.current, reducedMotion);
      el.style.transform = `translateY(-${offsetRef.current}px)`;
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return ()=> window.cancelAnimationFrame(raf);
  },[shouldAnimate, itemSig, reducedMotion]);

  if(!safeItems.length){
    return (
      <aside className="tsan-rail" aria-label="All News">
        <h3 className="tsan-rail-title">All News</h3>
        <p className="tsan-rail-empty">All News will appear after the briefing loads.</p>
      </aside>
    );
  }

  return (
    <aside className="tsan-rail" aria-label="All News">
      <div className="tsan-rail-header">
        <h3 className="tsan-rail-title">All News</h3>
        <button className="tsan-rail-toggle" type="button" aria-pressed={manualPaused}
          aria-label={manualPaused ? 'Resume briefing stream' : 'Pause briefing stream'}
          title={manualPaused ? 'Resume stream' : `Pause stream${reducedMotion ? ' (slowed for Windows motion preference)' : ''}`}
          onClick={()=> setManualPaused((current)=> !current)}>
          <Icon name={manualPaused ? 'play' : 'pause'} size={12} />
          <span>{manualPaused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
      <div className="tsan-rail-window" ref={listRef}
        onMouseEnter={()=> setHovered(true)} onMouseLeave={()=> setHovered(false)}
        onFocus={()=> setFocused(true)}
        onBlur={(event)=> { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="tsan-rail-track" ref={trackRef}>
          {display.map((item, idx)=>(
            <button
              key={`${item?.title || 'item'}-${idx}`}
              aria-hidden={idx >= safeItems.length ? 'true' : undefined}
              tabIndex={idx >= safeItems.length ? -1 : 0}
              className="tsan-rail-item"
              onClick={()=> item && onOpen?.(item)}
              type="button"
            >
              <span className="tsan-rail-category">{item?.category || 'Technology'}</span>
              <strong className="tsan-rail-headline">{item?.title || ''}</strong>
              <span className="tsan-rail-meta">{item?.src || item?.source || 'TechScout'} · {item?.date || 'Latest'} · Score {item ? scoreOf(item) : 0}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
