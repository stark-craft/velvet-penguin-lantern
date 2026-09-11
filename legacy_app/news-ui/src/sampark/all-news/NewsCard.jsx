import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { scoreOf } from '../../news-scrapper/utils/intelligence.js';
import { imageOf } from './allNewsModel.js';

export default function NewsCard({ item, onOpen, onAction }){
  if(!item) return null;
  const image = imageOf(item);
  const src = item?.src || item?.source || 'TechScout';
  const region = item?.region || 'Global';
  const category = item?.category || 'News';
  const count = item?.source_count || 1;
  return (
    <article className="tsan-news-card">
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
        <div className="tsan-news-card-footer">
          <span className="tsan-news-card-source">{src}</span>
          <span className="tsan-news-card-score">Score {scoreOf(item)}</span>
        </div>
      </div>
    </article>
  );
}
