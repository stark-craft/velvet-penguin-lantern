import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import SamparkTooltip from '../shared/SamparkTooltip.jsx';
import { sanitizeExternalUrl } from '../shared/safeLink.js';
import { imageOf } from './allNewsModel.js';

export default function NewsCard({ item, onOpen, onLike, onDislike, onFollow, onHide, onSourceOpen, isFollowing, likeActive, dislikeActive, busy, busyReaction, busySave, busyHide, savedHydrated, reactionsHydrated }){
  if(!item) return null;
  const image = imageOf(item);
  const src = item?.src || item?.source || 'TechScout';
  const regionDisplay = (()=>{
    const r=item?.region;
    if(!r) return 'Global';
    if(typeof r==='string') return r;
    if(typeof r==='object') return r.value||r.name||'Global';
    return String(r);
  })();
  const region = regionDisplay;
  const category = item?.category || 'News';
  const count = item?.source_count || 1;
  const sourceUrl = item?.link || item?.url || '';
  const safeUrl = sanitizeExternalUrl(sourceUrl);
  const hasRealSource = Boolean(safeUrl);

  return (
    <article className="tsan-news-card" style={{ minWidth: 0 }}>
      <button aria-label={`Open ${item?.title || 'article'}`} className="tsan-news-card-media" onClick={()=> onOpen?.(item)} style={image ? { backgroundImage:`url("${image}")`} : undefined} type="button">
        {!image && <span className="tsan-news-card-fallback"><Icon name="globe" size={24} /></span>}
        <span className="tsan-news-card-badge">{count} Source{count===1?'':'s'}</span>
      </button>
      <div className="tsan-news-card-body">
        <div className="tsan-news-card-meta">
          <span>{region}</span>
          <span aria-hidden="true">·</span>
          <span>{category}</span>
        </div>
        <button className="tsan-news-card-title" onClick={()=> onOpen?.(item)} type="button">{item?.title || ''}</button>
        <div className="tsan-news-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="tsan-news-card-source" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
          <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
            <SamparkTooltip label={likeActive ? 'Remove like' : 'Like'}><button aria-label={likeActive ? 'Remove like' : 'Like'} className={`sampark-card-action${likeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={() => onLike?.(item)} type="button"><Icon name="thumbsUp" size={12} /></button></SamparkTooltip>
            <SamparkTooltip label={dislikeActive ? 'Remove dislike' : 'Dislike'}><button aria-label={dislikeActive ? 'Remove dislike' : 'Dislike'} className={`sampark-card-action${dislikeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={() => onDislike?.(item)} type="button"><Icon name="thumbsDown" size={12} /></button></SamparkTooltip>
            {onFollow && <SamparkTooltip label={isFollowing ? 'Unfollow' : 'Follow'}><button aria-label={isFollowing ? 'Unfollow' : 'Follow'} className={`sampark-card-action${isFollowing ? ' is-active' : ''}`} disabled={Boolean(busySave ?? busy) || !savedHydrated} onClick={() => onFollow(item)} type="button"><Icon name={isFollowing ? 'check' : 'bookmark'} size={12} /></button></SamparkTooltip>}
            {onHide && <SamparkTooltip label="Hide"><button aria-label="Hide" className="sampark-card-action" disabled={Boolean(busyHide ?? busy)} onClick={() => onHide(item)} type="button"><Icon name="eye" size={12} /></button></SamparkTooltip>}
            {hasRealSource && <SamparkTooltip label="Open original source"><a aria-label="Open original source" href={safeUrl} target="_blank" rel="noreferrer noopener" onClick={() => onSourceOpen?.(item)} className="sampark-card-action" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="external" size={12} /></a></SamparkTooltip>}
          </div>
        </div>
      </div>
    </article>
  );
}
