import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import { emptyFilters } from '../news-scrapper/screens/briefingFilters.js';

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || '';
}

function Meta({ item }) {
  return <>{item.source_count || 1} Source{Number(item.source_count || 1) === 1 ? '' : 's'} | {item.region || 'Global'} | {item.category || 'News'}</>;
}

function Actions({ item, vote = {}, saved, disabled, onOpen, onVote, onSave, onHide }) {
  return <div className="sampark-card-actions">
    <button aria-label={`Open dossier for ${item.title}`} onClick={() => onOpen(item)} type="button"><Icon name="file" size={14} /></button>
    <button aria-label={`Like ${item.title}, ${vote.like_count || 0}`} className={vote.viewer_reaction === 'like' ? 'active' : ''} disabled={disabled} onClick={() => onVote(item, vote.viewer_reaction === 'like' ? 'neutral' : 'like')} type="button"><Icon name="thumbsUp" size={14} /><span>{vote.like_count || 0}</span></button>
    <button aria-label={`Dislike ${item.title}, ${vote.dislike_count || 0}`} className={vote.viewer_reaction === 'dislike' ? 'active' : ''} disabled={disabled} onClick={() => onVote(item, vote.viewer_reaction === 'dislike' ? 'neutral' : 'dislike')} type="button"><Icon name="thumbsDown" size={14} /><span>{vote.dislike_count || 0}</span></button>
    <button aria-label={`${saved ? 'Stop following' : 'Follow'} ${item.title}`} className={saved ? 'active' : ''} disabled={disabled} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={14} /></button>
    <button aria-label={`Hide ${item.title}`} disabled={disabled} onClick={() => onHide(item)} type="button"><Icon name="eye" size={14} /></button>
  </div>;
}

function NewsTile({ item, ...actions }) {
  const image = imageOf(item);
  return <article className="latest-news-card">
    <button aria-label={`Open dossier for ${item.title}`} className="lnc-image" onClick={() => actions.onOpen(item)} style={image ? { backgroundImage: `url("${image}")` } : undefined} type="button">{!image && <Icon name="globe" size={34} />}</button>
    <div className="lnc-tags"><Meta item={item} /></div>
    <button className="lnc-title" onClick={() => actions.onOpen(item)} type="button">{item.title}</button>
    <Actions item={item} {...actions} />
  </article>;
}

function FeaturedCarousel({ items, getActions, onOpen }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || items.length < 2) return undefined;
    const timer = window.setTimeout(() => setIndex(value => (value + 1) % items.length), 7000);
    return () => window.clearTimeout(timer);
  }, [index, items.length, paused]);
  useEffect(() => { if (index >= items.length) setIndex(0); }, [index, items.length]);
  const item = items[index];
  if (!item) return <div className="featured-carousel sampark-empty">No featured news matches these filters.</div>;
  const image = imageOf(item);
  const actions = getActions(item);
  return <section aria-label="Featured news" className="featured-carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <div className="carousel-slides" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
      <div className="slide-overlay"><span className="slide-source">{item.src || item.source || 'TechScout'} · {item.date || 'Latest'}</span><button className="featured-story-title" onClick={() => actions.onOpen(item)} type="button"><h3>{item.title}</h3></button><Actions item={item} {...actions} /></div>
    </div>
    {items.length > 1 && <><button aria-label="Previous featured story" className="carousel-arrow prev" onClick={() => setIndex(value => (value + items.length - 1) % items.length)} type="button"><Icon name="chevL" size={17} /></button><button aria-label="Next featured story" className="carousel-arrow next" onClick={() => setIndex(value => (value + 1) % items.length)} type="button"><Icon name="chevR" size={17} /></button><div className="carousel-dots" role="tablist" aria-label="Featured stories">{items.map((slide, i) => <button aria-label={`Show featured story ${i + 1}`} aria-selected={i === index} className={`dot${i === index ? ' active' : ''}`} key={articleKey(slide)} onClick={() => setIndex(i)} role="tab" type="button" />)}</div></>}
  </section>;
}

export default function SamparkBriefingView({ articles, filteredArticles, filters, setFilters, options, votes, savedKeys, busyActions, onOpen, onVote, onSave, onHide }) {
  const latestRef = useRef(null);
  const categories = useMemo(() => ['all', ...options.categories.slice(0, 5)], [options.categories]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const hero = filteredArticles.slice(0, 5);
  const latest = filteredArticles.slice(5, 17);
  const common = item => ({ vote: votes[articleKey(item)] || item.reactions || {}, saved: savedKeys.has(articleKey(item)), disabled: Boolean(busyActions[articleKey(item)]), onOpen, onVote, onSave, onHide });
  return <div className="tab-content active sampark-all-news">
    <nav aria-label="News categories" className="category-filters">{categories.map(category => <button className={`cat-filter${filters.category === category ? ' active' : ''}`} key={category} onClick={() => update('category', category)} type="button">{category === 'all' ? 'All' : category}</button>)}</nav>
    <div className="news-layout">
      <div className="carousel-news-container">
        <FeaturedCarousel items={hero} getActions={common} onOpen={onOpen} />
        <aside className="live-news-sidebar"><h3 className="sidebar-title">Briefing Stream</h3><div className="live-news-list">{filteredArticles.slice(0, 8).map(item => <button className="live-news-item" key={articleKey(item)} onClick={() => onOpen(item)} type="button"><span className="ln-category ai">{item.category || 'Technology'}</span><p className="ln-headline">{item.title}</p><span className="ln-meta">{item.src || item.source} | {item.date} | Score {item.importance_score || 0}</span></button>)}</div></aside>
      </div>
      <section className="latest-news-section"><div className="latest-news-header"><h3>Latest News | {articles[0]?.date || 'Latest'} <span className="news-count">({filteredArticles.length} News)</span></h3><div className="scroll-controls"><button aria-label="Scroll latest news left" onClick={() => latestRef.current?.scrollBy({ left: -383, behavior: 'smooth' })}><Icon name="chevL" size={15} /></button><button aria-label="Scroll latest news right" onClick={() => latestRef.current?.scrollBy({ left: 383, behavior: 'smooth' })}><Icon name="chevR" size={15} /></button></div></div><div className="latest-news-scroll" ref={latestRef}>{latest.map(item => <NewsTile item={item} key={articleKey(item)} {...common(item)} />)}</div></section>
      <section className="filter-view-section"><div className="filter-view-header"><h3>Apply Filter & Customize View</h3></div><div className="filter-bar">
        <label className="filter-dropdown">Region<select className="filter-select" aria-label="Region" value={filters.region} onChange={event => update('region', event.target.value)}><option value="all">All Regions</option>{options.regions.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-dropdown">Category<select className="filter-select" aria-label="Category" value={filters.category} onChange={event => update('category', event.target.value)}><option value="all">All Categories</option>{options.categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-dropdown">Source<select className="filter-select" aria-label="Source" value={filters.source} onChange={event => update('source', event.target.value)}><option value="all">All Sources</option>{options.sources.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-dropdown">Date<select className="filter-select" aria-label="Date" value={filters.date} onChange={event => update('date', event.target.value)}><option value="all">All Dates</option>{options.dates.map(value => <option key={value}>{value}</option>)}</select></label>
        <button className="filter-reset-btn" onClick={() => setFilters({ ...emptyFilters })} type="button"><Icon name="refresh" size={14} /> Reset</button>
      </div><div className="latest-news-header"><h3>News <span className="news-count">({filteredArticles.length} News)</span></h3></div><div className="filtered-news-grid">{filteredArticles.map(item => <NewsTile item={item} key={articleKey(item)} {...common(item)} />)}</div>{!filteredArticles.length && <p className="sampark-empty">No news matches these filters.</p>}</section>
    </div>
  </div>;
}
