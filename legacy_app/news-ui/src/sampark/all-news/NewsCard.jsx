import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import SamparkTooltip from '../shared/SamparkTooltip.jsx';
import { sanitizeExternalUrl } from '../shared/safeLink.js';
import { imageOf } from './allNewsModel.js';

export default function NewsCard({ item, variant='default', onOpen, onLike, onDislike, onFollow, onHide, onSourceOpen, isFollowing, likeActive, dislikeActive, likeCount=0, dislikeCount=0, busy, busyReaction, busySave, busyHide, savedHydrated, reactionsHydrated, reviewAllowed=false, workflowReady=false, checked=false, isSelected=false, isApproved=false, onCheck, onSubmitForReview }){
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const isLatest = variant === 'latest';
  const isDayWise = variant === 'daywise';
  const usesImageTags = isLatest || isDayWise;
  useEffect(() => {
    if(!menuOpen) return undefined;
    const closeOutside = (event) => {
      if(!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if(event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

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
  const regionKey = String(region || '').trim().toLocaleLowerCase();
  const regionClass = regionKey.includes('local') ? 'is-local' : 'is-global';
  const reviewComplete = isSelected || isApproved;
  const reviewMarked = checked || reviewComplete;

  const runMenuAction = (action) => {
    setMenuOpen(false);
    action?.(item);
  };

  return (
    <article className={`tsan-news-card${isLatest ? ' is-latest' : ''}${isDayWise ? ' is-daywise' : ''}${reviewMarked ? ' is-picked' : ''}${menuOpen ? ' is-menu-open' : ''}`} style={{ minWidth: 0 }}>
      {isDayWise && reviewAllowed && onCheck && <input aria-label={reviewComplete ? `${isApproved ? 'Approved' : 'Already in Review Queue'}: ${item?.title || 'article'}` : `Select ${item?.title || 'article'} for review`} checked={reviewMarked} className="tsan-card-review-check" disabled={!workflowReady || reviewComplete} onChange={(event)=> onCheck(item, event.currentTarget.checked)} title={reviewComplete ? (isApproved ? 'Already approved' : 'Already in Review Queue') : 'Select for Review Queue'} type="checkbox" />}
      <button aria-label={`Open ${item?.title || 'article'}`} className="tsan-news-card-media" onClick={()=> onOpen?.(item)} style={image ? { backgroundImage:`url("${image}")`} : undefined} type="button">
        {!image && <span className="tsan-news-card-fallback"><Icon name="globe" size={24} /></span>}
        {usesImageTags ? (
          <>
            <span className="tsan-news-card-image-tags">
              <span className="tsan-news-card-badge">{count} Source{count===1?'':'s'}</span>
              <span className="tsan-news-card-category-badge">{category}</span>
            </span>
            <span className={`tsan-news-card-region-tag ${regionClass}`}>{region}</span>
          </>
        ) : <span className="tsan-news-card-badge">{count} Source{count===1?'':'s'}</span>}
      </button>
      <div className="tsan-news-card-body">
        {!usesImageTags && <div className="tsan-news-card-meta">
          <span>{region}</span>
          <span aria-hidden="true">·</span>
          <span>{category}</span>
        </div>}
        <button className="tsan-news-card-title" onClick={()=> onOpen?.(item)} type="button">{item?.title || ''}</button>
        <div className={`tsan-news-card-footer${isLatest ? ' is-source-only' : ''}${isDayWise ? ' is-compact-actions' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="tsan-news-card-source" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
          {isDayWise && <div className="tsan-news-card-footer-actions">
            <SamparkTooltip label={likeActive ? 'Remove like' : 'Like'}>
              <button aria-label={likeActive ? `Remove like${likeCount > 0 ? `, ${likeCount} likes` : ''}` : `Like${likeCount > 0 ? `, ${likeCount} likes` : ''}`} className={`tsan-card-like${likeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={()=> onLike?.(item)} type="button"><Icon name="thumbsUp" size={13} />{likeCount > 0 && <span>{likeCount}</span>}</button>
            </SamparkTooltip>
            <span className="tsan-news-card-menu-wrap" ref={menuRef}>
              <SamparkTooltip label="More actions"><button aria-expanded={menuOpen} aria-haspopup="menu" aria-label="More actions" className={`tsan-card-more${menuOpen ? ' is-open' : ''}`} onClick={()=>setMenuOpen(value=>!value)} type="button"><Icon name="dots" size={15} /></button></SamparkTooltip>
              {menuOpen && <span className="tsan-card-menu" role="menu">
                <button className="tsan-card-menu-item" onClick={()=>runMenuAction(onOpen)} role="menuitem" type="button"><Icon name="file" size={14} /><span>Open article details</span></button>
                <button className={`tsan-card-menu-item is-like${likeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={()=>runMenuAction(onLike)} role="menuitem" type="button"><Icon name="thumbsUp" size={14} /><span>{likeActive ? 'Remove like' : 'Like'}{likeCount > 0 ? ` (${likeCount})` : ''}</span></button>
                <button className={`tsan-card-menu-item is-dislike${dislikeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={()=>runMenuAction(onDislike)} role="menuitem" type="button"><Icon name="thumbsDown" size={14} /><span>{dislikeActive ? 'Remove dislike' : 'Dislike'}{dislikeCount > 0 ? ` (${dislikeCount})` : ''}</span></button>
                {onFollow && <button className={`tsan-card-menu-item is-follow${isFollowing ? ' is-active' : ''}`} disabled={Boolean(busySave ?? busy) || !savedHydrated} onClick={()=>runMenuAction(onFollow)} role="menuitem" type="button"><Icon name={isFollowing ? 'check' : 'bookmark'} size={14} /><span>{isFollowing ? 'Unfollow' : 'Follow'}</span></button>}
                {onHide && <button className="tsan-card-menu-item" disabled={Boolean(busyHide ?? busy)} onClick={()=>runMenuAction(onHide)} role="menuitem" type="button"><Icon name="eye" size={14} /><span>Hide</span></button>}
                {reviewAllowed && <button className="tsan-card-menu-item is-review" disabled={!workflowReady || reviewComplete} onClick={()=>runMenuAction(onSubmitForReview)} role="menuitem" type="button"><Icon name={reviewComplete ? 'check' : 'check2'} size={14} /><span>{isApproved ? 'Approved' : isSelected ? 'In Review Queue' : 'Submit for review'}</span></button>}
                {hasRealSource && <a className="tsan-card-menu-item" href={safeUrl} onClick={()=>{ setMenuOpen(false); onSourceOpen?.(item); }} rel="noreferrer noopener" role="menuitem" target="_blank"><Icon name="external" size={14} /><span>Open original source</span></a>}
              </span>}
            </span>
          </div>}
          {!isLatest && !isDayWise && <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
            <SamparkTooltip label={likeActive ? 'Remove like' : 'Like'}><button aria-label={likeActive ? 'Remove like' : 'Like'} className={`sampark-card-action${likeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={() => onLike?.(item)} type="button"><Icon name="thumbsUp" size={12} /></button></SamparkTooltip>
            <SamparkTooltip label={dislikeActive ? 'Remove dislike' : 'Dislike'}><button aria-label={dislikeActive ? 'Remove dislike' : 'Dislike'} className={`sampark-card-action${dislikeActive ? ' is-active' : ''}`} disabled={Boolean(busyReaction ?? busy) || !reactionsHydrated} onClick={() => onDislike?.(item)} type="button"><Icon name="thumbsDown" size={12} /></button></SamparkTooltip>
            {onFollow && <SamparkTooltip label={isFollowing ? 'Unfollow' : 'Follow'}><button aria-label={isFollowing ? 'Unfollow' : 'Follow'} className={`sampark-card-action${isFollowing ? ' is-active' : ''}`} disabled={Boolean(busySave ?? busy) || !savedHydrated} onClick={() => onFollow(item)} type="button"><Icon name={isFollowing ? 'check' : 'bookmark'} size={12} /></button></SamparkTooltip>}
            {onHide && <SamparkTooltip label="Hide"><button aria-label="Hide" className="sampark-card-action" disabled={Boolean(busyHide ?? busy)} onClick={() => onHide(item)} type="button"><Icon name="eye" size={12} /></button></SamparkTooltip>}
            {hasRealSource && <SamparkTooltip label="Open original source"><a aria-label="Open original source" href={safeUrl} target="_blank" rel="noreferrer noopener" onClick={() => onSourceOpen?.(item)} className="sampark-card-action" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="external" size={12} /></a></SamparkTooltip>}
          </div>}
        </div>
      </div>
    </article>
  );
}
