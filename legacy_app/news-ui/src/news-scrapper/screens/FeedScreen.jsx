import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import NameModal from '../components/modals/NameModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import Bouncer from '../components/Bouncer.jsx';
import ContinuousSignalStream from '../components/ContinuousSignalStream.jsx';
import useAutoplayState, { autoplayDelay } from '../hooks/useAutoplayState.js';
import { correctRegion, getLatestBriefing, getSharedBriefing, getViewerHidden, getViewerReactions, getViewerSaved, getWorkflow, hideArticleForViewer, rejectArticle, removeSavedArticle, saveArticleForLater, selectWorkflow, setViewerReaction } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { articleActivityDetail, trackAction } from '../utils/tracking.js';
import { articleKey, briefingLensOptions, groupedByDatePreservingOrder, keywordOptions, matchesBriefingLens, matchesKeyword, publishedTime, reactionIdentity, scoreOf } from '../utils/intelligence.js';
import '../styles/home-refinement.css';
const emptyFilters = {
  query: '',
  scope: 'all',
  region: 'all',
  category: 'all',
  source: 'all',
  date: 'all',
  signal: 'all',
  fresh: 'all',
  cluster: 'all',
  image: 'all',
  selected: 'all',
  keyword: 'all'
};
const HERO_FEED_LIMIT = 5;
function resolveArticleImage(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const candidates = [item.image_url, item.imageUrl, item.image, item.thumbnail_url, item.thumbnail, item.og_image, item.article_image_url, item.web_search_image_url, item.image_metadata?.image_url, item.image_metadata?.url, item.media?.image_url, item.media?.url, item.images?.[0]?.image_url, item.images?.[0]?.url, item.images?.[0]];
  const match = candidates.find(value => typeof value === 'string' && value.trim() && value.trim() !== '#');
  return match?.trim() || '';
}
function normalizeArticleImages(items) {
  return items.map(item => ({
    ...item,
    image_url: resolveArticleImage(item)
  }));
}
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
function latestDate(items) {
  return [...items].map(item => item.date).filter(Boolean).sort().pop() || '';
}
function sortByDate(items) {
  return [...items].sort((a, b) => {
    const personal = Number(b.personal_rank_score || 0) - Number(a.personal_rank_score || 0);
    return personal || publishedTime(b) - publishedTime(a);
  });
}
function sortForCarousel(items) {
  return [...items].sort((a, b) => {
    const coverage = (b.source_count || 1) - (a.source_count || 1);
    const signal = scoreOf(b) - scoreOf(a);
    const recency = publishedTime(b) - publishedTime(a);
    const visual = (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0);
    return coverage * 1000 + signal * 10 + visual * 5 + recency / 100000000;
  });
}
function stableSignalKey(item) {
  return articleKey(item) || item.id || item.title || item.url || item.link || '';
}
function followUp(item) {
  return item?.personalization?.follow_up ? item.personalization : null;
}
function getHeroFeed(items) {
  const candidates = items.some(item => (item.source_count || 1) > 1)
    ? items.filter(item => (item.source_count || 1) > 1)
    : items;
  const globalLeaders = sortForCarousel(candidates).slice(0, 3);
  const used = new Set(globalLeaders.map(stableSignalKey));
  const personalLeaders = [...candidates]
    .filter(item => item.personalization?.applied && !used.has(stableSignalKey(item)))
    .sort((a, b) => Number(b.personal_rank_score || 0) - Number(a.personal_rank_score || 0))
    .slice(0, 2);
  personalLeaders.forEach(item => used.add(stableSignalKey(item)));
  const remainder = sortForCarousel(candidates)
    .filter(item => !used.has(stableSignalKey(item)))
    .slice(0, HERO_FEED_LIMIT - globalLeaders.length - personalLeaders.length);
  return [...globalLeaders, ...personalLeaders, ...remainder].slice(0, HERO_FEED_LIMIT);
}
function matchesQuery(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.title, item.summary, item.src, item.source, item.category, item.region, ...(item.keywords_found || []), ...(item.keywords || [])].join(' ').toLowerCase();
  return haystack.includes(q);
}
function articleScopes(item) {
  const values = [
    item.vertical,
    item.legacy_profile,
    item.profile,
    ...(Array.isArray(item.verticals) ? item.verticals : []),
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  const category = String(item.category || '').toLowerCase();
  const scopes = new Set();
  if (values.some(value => value.includes('broadcast')) || /broadcast|cable|dth|television|media distribution/.test(category)) {
    scopes.add('broadcast');
  }
  if (values.some(value => value === 'technology' || value === 'default' || value === 'tech')) {
    scopes.add('technology');
  }
  if (!scopes.size) scopes.add('technology');
  return scopes;
}
function applyFilters(items, filters, selectedIds) {
  return items.filter(item => {
    if (!matchesQuery(item, filters.query)) {
      return false;
    }
    if (filters.scope !== 'all' && !articleScopes(item).has(filters.scope)) {
      return false;
    }
    if (filters.region !== 'all' && item.region !== filters.region) {
      return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) {
      return false;
    }
    if (filters.source !== 'all' && (item.src || item.source) !== filters.source) {
      return false;
    }
    if (filters.date !== 'all' && item.date !== filters.date) {
      return false;
    }
    if (filters.signal === 'high' && scoreOf(item) < 80) {
      return false;
    }
    if (filters.signal === 'normal' && scoreOf(item) >= 80) {
      return false;
    }
    if (filters.fresh === 'fresh' && !item.is_fresh) {
      return false;
    }
    if (filters.cluster === 'multi' && (item.source_count || 1) <= 1) {
      return false;
    }
    if (filters.image === 'with' && !item.image_url) {
      return false;
    }
    if (filters.image === 'without' && item.image_url) {
      return false;
    }
    if (!matchesKeyword(item, filters.keyword)) {
      return false;
    }
    const isSelected = selectedIds.has(item.id) || selectedIds.has(item.title) || item.selected_by;
    if (filters.selected === 'selected' && !isSelected) {
      return false;
    }
    if (filters.selected === 'unselected' && isSelected) {
      return false;
    }
    return true;
  });
}
function topKeywords(items, limit = 5) {
  const map = new Map();
  items.forEach(item => {
    [...(item.keywords_found || []), ...(item.keywords || [])].forEach(keyword => {
      map.set(keyword, (map.get(keyword) || 0) + 1);
    });
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => ({
    k,
    n
  }));
}
function TopClusterCarousel({
  articles,
  onOpen,
  onSelect,
  workflowReady = true
}) {
  const slides = useMemo(() => articles.slice(0, HERO_FEED_LIMIT), [articles]);
  const fallbackMode = slides.every(item => (item.source_count || 1) <= 1);
  const [idx, setIdx] = useState(0);
  const [manualPaused, setManualPaused] = useState(false);
  const { documentVisible, reducedMotion } = useAutoplayState();
  useEffect(() => {
    if (manualPaused || !documentVisible || slides.length <= 1) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setIdx(current => (current + 1) % slides.length);
    }, autoplayDelay(8000, reducedMotion));
    return () => clearTimeout(timer);
  }, [documentVisible, idx, manualPaused, reducedMotion, slides.length]);
  useEffect(() => {
    if (idx >= slides.length) {
      setIdx(0);
    }
  }, [idx, slides.length]);
  const active = slides[idx];
  if (!active) {
    return null;
  }
  const move = delta => {
    setIdx(current => (current + delta + slides.length) % slides.length);
  };
  return <section className="hero-cluster-panel cockpit-top-card group relative overflow-hidden rounded-[22px] border border-sky-300/20 bg-[#101827] shadow-glow">
<button aria-label={`Open dossier for ${active.title}`} className="absolute inset-0 z-0 text-left" onClick={() => onOpen(active)} type="button">
<SignalVisual item={active} className="visual-layer z-0" label={false} />
<div className="absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(5,9,20,0.74)_0%,rgba(5,9,20,0.42)_48%,rgba(5,9,20,0.10)_100%),linear-gradient(0deg,rgba(5,9,20,0.78)_0%,rgba(5,9,20,0.22)_56%,rgba(0,0,0,0.02)_100%)]" />
</button>
<div className="pointer-events-none relative z-20 flex h-full flex-col justify-end p-4 lg:p-5 2xl:p-6">
<div className="hero-carousel-header mb-auto flex items-center justify-between gap-4">
<div className="hero-carousel-kicker text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100">              Top Cluster Carousel            </div>
<div className="hero-carousel-controls pointer-events-auto flex gap-2">
<button className="carousel-control" onClick={() => move(-1)} type="button" aria-label="Previous slide">
<Icon name="chevL" />
</button>
<button className="carousel-control" onClick={() => move(1)} type="button" aria-label="Next slide">
<Icon name="chevR" />
</button>
<button aria-pressed={manualPaused} className="carousel-control" onClick={() => setManualPaused((value) => !value)} type="button" aria-label={manualPaused ? 'Resume carousel' : 'Pause carousel'}><Icon name={manualPaused ? 'play' : 'pause'} /></button>
</div>
</div>
<div className="hero-carousel-content pointer-events-auto max-w-3xl">
<div className="hero-carousel-meta mb-3 flex flex-wrap gap-2">
<span className="source-chip">              {fallbackMode ? 'Single-source signal' : 'Multi-source signal'}            </span>
<span className="source-chip">              {active.source_count || 1} sources            </span>
<span className="source-chip">              {active.category || 'News'}            </span>
<span className="source-chip">              {active.region || 'Global'}            </span>
<span className="source-chip">              Score {scoreOf(active)}            </span>
{followUp(active) && <span className="personal-follow-chip" title={`Related to: ${followUp(active).matched_saved_title || 'a saved signal'}`}><Icon name="bookmark" size={12} /> {followUp(active).follow_label}</span>}
</div>
<button className="hero-carousel-copy text-left" onClick={() => onOpen(active)} type="button">
<h2 className="hero-carousel-title line-clamp-3 text-[clamp(1.65rem,2.2vw,3.05rem)] font-semibold leading-[1.02] text-white">              {active.title}            </h2>
<p className="hero-carousel-summary line-clamp-3 max-w-2xl text-[clamp(0.9rem,0.95vw,1.05rem)] text-slate-300">              {active.summary}            </p>
</button>
<div className="hero-carousel-actions flex flex-wrap items-center gap-3">
<button className="btn-dark-primary" onClick={() => onOpen(active)} type="button">
<Icon name="file" size={15} />              Open Dossier            </button>
</div>
<div className="hero-carousel-dots mt-4 flex gap-2">            {slides.map((slide, dotIdx) => <button key={articleKey(slide) || dotIdx} className={dotIdx === idx ? 'h-2.5 w-8 rounded-full bg-sky-200' : 'h-2.5 w-2.5 rounded-full bg-white/30 hover:bg-white/60'} onClick={() => setIdx(dotIdx)} type="button" aria-label={`Go to slide ${dotIdx + 1}`} />)}          </div>
</div>
</div>
</section>;
}
function TechnologySignalPulse({
  articles,
  filters,
  onFilter
}) {
  const totalSignals = articles.length;
  const highSignalCount = articles.filter(item => scoreOf(item) >= 80).length;
  const freshSignalCount = articles.filter(item => item.is_fresh).length;
  const clusteredSignalCount = articles.filter(item => (item.source_count || 1) > 1).length;
  const uniquePublishers = new Set(articles.map(item => item.source || item.src).filter(Boolean)).size;
  const highSignalPercentage = totalSignals ? Math.round(highSignalCount / totalSignals * 100) : 0;
  const categoryCounts = articles.reduce((counts, item) => {
    const category = item.category || 'Other';
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const leadingCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const largestCategoryCount = Math.max(1, ...leadingCategories.map(([, count]) => count));
  const trendingKeywords = topKeywords(articles, 6);
  const strongestCategory = leadingCategories[0]?.[0] || 'Technology';
  const toggle = (key, value) => onFilter({
    [key]: filters[key] === value ? 'all' : value
  });
  return <aside className="market-panel cockpit-top-card flex flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#101827]/90 p-5 shadow-cockpit backdrop-blur-xl 2xl:p-6">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-200"><Icon name="trend" size={14} /> Technology Signal Pulse</div>
      <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">Live</span>
    </div>
    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="pulse-trending">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Click a trend to filter the feed</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {trendingKeywords.length ? trendingKeywords.map(({
            k,
            n
          }) => <button className={filters.query === k ? 'pulse-keyword active' : 'pulse-keyword'} key={k} onClick={() => onFilter({
            query: filters.query === k ? '' : k
          })} title={`Show ${n} signals matching ${k}`} type="button">
              {k}<span>{n}</span>
            </button>) : <span className="text-sm text-slate-500">Trending keywords will appear after analysis.</span>}
        </div>
      </div>
      <button className={filters.signal === 'high' ? 'pulse-density active' : 'pulse-density'} onClick={() => toggle('signal', 'high')} title="Filter the feed to high-signal intelligence" type="button">
        <div className="flex items-end justify-between gap-4">
          <div><div className="pulse-label">High-signal density</div><div className="mt-2 text-4xl font-semibold text-white">{highSignalPercentage}<span className="ml-1 text-lg text-slate-500">%</span></div></div>
          <div className="text-right"><div className="text-sm font-semibold text-sky-100">{highSignalCount} high signals</div><div className="mt-1 text-xs text-slate-500">From {totalSignals} loaded stories</div></div>
        </div>
        <span className="pulse-progress"><span style={{
            width: `${Math.max(highSignalPercentage, highSignalCount ? 4 : 0)}%`
          }} /></span>
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className={filters.fresh === 'fresh' ? 'signal-stat pulse-control active' : 'signal-stat pulse-control'} onClick={() => toggle('fresh', 'fresh')} type="button"><span>Fresh signals</span><strong>{freshSignalCount}</strong><small>Newly discovered</small></button>
        <button className={filters.cluster === 'multi' ? 'signal-stat pulse-control active' : 'signal-stat pulse-control'} onClick={() => toggle('cluster', 'multi')} type="button"><span>Multi-source</span><strong>{clusteredSignalCount}</strong><small>Clustered stories</small></button>
        <button className="signal-stat pulse-control" onClick={() => onFilter({
          source: 'all'
        })} title="Show signals from every publisher" type="button"><span>Publishers</span><strong>{uniquePublishers}</strong><small>Sources represented</small></button>
        <button className={filters.category === strongestCategory ? 'signal-stat pulse-control active' : 'signal-stat pulse-control'} onClick={() => toggle('category', strongestCategory)} type="button"><span>Leading theme</span><strong className="truncate" title={strongestCategory}>{strongestCategory}</strong><small>Most active category</small></button>
      </div>
      <div className="pulse-momentum">
        <div className="pulse-label">Category momentum</div>
        <div className="mt-4 space-y-2">
          {leadingCategories.map(([category, count]) => {
            const percentage = Math.round(count / largestCategoryCount * 100);
            return <button className={filters.category === category ? 'pulse-category active' : 'pulse-category'} key={category} onClick={() => toggle('category', category)} type="button">
              <span><span title={category}>{category}</span><strong>{count}</strong></span>
              <i><i style={{
                  width: `${percentage}%`
                }} /></i>
            </button>;
          })}
        </div>
      </div>
      <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.17em] text-slate-600">Every tile is an active briefing filter</div>
    </div>
  </aside>;
}
function BriefingStream({
  articles,
  onOpen,
  navigate
}) {
  const stream = sortByDate(articles).slice(0, 10);
  return <aside aria-label="Briefing Stream" className="briefing-stream-panel briefing-wire">
    <header>
      <h2>Live briefing</h2>
      <i aria-hidden="true" />
    </header>
    <div className="briefing-wire-window">
      <ContinuousSignalStream ariaLabel="Briefing Stream" className="briefing-continuous-stream" duration={38} items={stream} renderItem={(item, index, duplicate) => <button
        aria-hidden={duplicate ? 'true' : undefined}
        className="briefing-wire-card"
        key={`${articleKey(item)}-${index}`}
        onClick={() => onOpen(item)}
        tabIndex={duplicate ? -1 : 0}
        type="button"
      >
        <span>{item.category || 'Executive signal'}</span>
        <strong>{item.title}</strong>
        <small>{item.src || item.source || 'Briefing desk'} · {item.date || 'Latest'}</small>
        <b>Score {scoreOf(item)}</b>
      </button>} />
    </div>
    <footer>
      <button onClick={() => navigate('/history')} type="button">Open Briefing Archive <Icon name="chevR" size={14} /></button>
      <span>Shared executive baseline</span>
    </footer>
  </aside>;
}
function BriefingLensRail({ lenses, activeLens, onLens }) {
  const active = lenses.find(lens => lens.id === activeLens);
  return <section className="briefing-lens-rail" aria-label="Intelligence lenses">
    <div className="briefing-lens-heading">
      <span className="briefing-lens-orbit"><Icon name="sparkle" size={14} /></span>
      <span>
        <strong>Intelligence lenses</strong>
        <small>{active ? `${active.label} · ${active.count} signals` : 'Choose a lens to reshape the complete briefing'}</small>
      </span>
    </div>
    <div className="briefing-lens-map" role="group" aria-label="Filter the complete briefing by intelligence lens">
      {lenses.map((lens, index) => <button
        aria-pressed={activeLens === lens.id}
        className={activeLens === lens.id ? 'briefing-lens-key is-active' : 'briefing-lens-key'}
        disabled={lens.count === 0}
        key={lens.id}
        onClick={() => onLens(activeLens === lens.id ? 'all' : lens.id)}
        title={lens.count ? `${lens.description}. Show ${lens.count} matching signals.` : `No ${lens.label} signals in this briefing.`}
        type="button"
      >
        <span className="briefing-lens-index">0{index + 1}</span>
        <span className="briefing-lens-label">{lens.label}</span>
        <strong>{lens.count}</strong>
      </button>)}
    </div>
    {active && <button className="briefing-lens-reset" onClick={() => onLens('all')} type="button">Reset</button>}
  </section>;
}
function LatestDaySignals({
  articles,
  excludeKeys,
  onOpen
}) {
  const [start, setStart] = useState(0);
  const [paused, setPaused] = useState(false);
  const availableArticles = useMemo(() => articles.filter(item => {
    const key = stableSignalKey(item);
    return !key || !excludeKeys.has(key);
  }), [articles, excludeKeys]);
  const latest = latestDate(availableArticles);
  const items = useMemo(() => sortByDate(availableArticles.filter(item => item.date === latest)), [availableArticles, latest]);
  const canMove = items.length > 5;
  const visibleCount = Math.min(5, items.length);
  const visible = canMove ? Array.from({
    length: visibleCount
  }, (_, offset) => items[(start + offset) % items.length]) : items.slice(0, visibleCount);
  useEffect(() => {
    if (start >= items.length) {
      setStart(0);
    }
  }, [items.length, start]);
  useEffect(() => {
    if (!canMove || paused) {
      return undefined;
    }
    const timer = setInterval(() => {
      setStart(position => (position + 1) % items.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [canMove, items.length, paused, start]);
  if (!items.length) {
    return null;
  }
  const move = delta => {
    setStart(position => (position + delta + items.length) % items.length);
  };
  return <section className="latest-day-stage rounded-[22px] border border-white/10 bg-[#101827]/80 p-4 shadow-cockpit 2xl:p-5">
<div className="mb-3 flex items-center justify-between gap-4">
<div>
<div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">            Latest Day Signals          </div>
<div className="mt-1 text-sm text-slate-500">            {latest} · {items.length} signals          </div>
</div>        {canMove && <div className="flex gap-2">
<button className="carousel-control" onClick={() => move(-1)} type="button" aria-label="Previous signals">
<Icon name="chevL" />
</button>
<button className="carousel-control" onClick={() => move(1)} type="button" aria-label="Next signals">
<Icon name="chevR" />
</button>
<button aria-pressed={paused} className="carousel-control" onClick={() => setPaused((value) => !value)} type="button" aria-label={paused ? 'Resume automatic signals' : 'Pause automatic signals'}>
<Icon name={paused ? 'play' : 'pause'} />
</button>
</div>}      </div>
<div className="latest-day-grid grid auto-cols-[minmax(160px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-5 md:overflow-visible md:pb-0">        {visible.map(item => <button key={articleKey(item)} className="latest-signal-card group relative overflow-hidden rounded-2xl border border-white/10 bg-[#101827] text-left transition hover:border-sky-300/25" onClick={() => onOpen(item)} type="button">
<SignalVisual item={item} className="visual-layer z-0" label={false} />
<div className="absolute inset-0 z-10 bg-gradient-to-t from-black via-[#050914]/75 to-transparent" />
<div className="relative z-20 flex h-full min-h-0 flex-col justify-between p-3">
<div className="flex flex-wrap justify-end gap-2">                {followUp(item) && <span className="personal-follow-chip" title={`Related to: ${followUp(item).matched_saved_title || 'a saved signal'}`}><Icon name="bookmark" size={11} /> Story update</span>}                {(scoreOf(item) >= 80 || item.is_fresh) && <span className="signal-chip selected">                    {scoreOf(item) >= 80 ? 'High Signal' : 'New'}                  </span>}              </div>
<div>
<div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.75)]">                  {item.source_count || 1} sources ·{' '}                  {item.region || 'Global'} ·{' '}                  {item.category || 'News'}                </div>
<div className="mt-1 line-clamp-2 min-h-[38px] text-sm font-semibold leading-snug text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.95)] group-hover:text-sky-50" title={item.title}>                  {item.title}                </div>
</div>
</div>
</button>)}      </div>
</section>;
}
function SearchLoadedBriefing({
  filters,
  setFilters,
  options,
  count,
  total
}) {
  const update = (key, value) => {
    setFilters(previous => ({
      ...previous,
      [key]: value
    }));
  };
  const reset = () => {
    setFilters(emptyFilters);
  };
  return <section className="loaded-briefing-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5 shadow-cockpit">
<div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
<div>
<div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">            Filter Briefing          </div>
<div className="mt-1 text-sm text-slate-500">            {count} of {total} signals visible          </div>
</div>
<button className="btn-dark-secondary h-9" onClick={reset} type="button">          Reset filters        </button>
</div>
<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
<select className="dark-input" value={filters.region} onChange={event => update('region', event.target.value)}>
<option value="all">            All Regions          </option>          {options.regions.map(region => <option key={region} value={region}>              {region}            </option>)}        </select>
<select className="dark-input" value={filters.category} onChange={event => update('category', event.target.value)}>
<option value="all">            All Categories          </option>          {options.categories.map(category => <option key={category} value={category}>              {category}            </option>)}        </select>
<select className="dark-input" value={filters.source} onChange={event => update('source', event.target.value)}>
<option value="all">            All Sources          </option>          {options.sources.map(source => <option key={source} value={source}>              {source}            </option>)}        </select>
<select className="dark-input" value={filters.date} onChange={event => update('date', event.target.value)}>
<option value="all">            All Dates          </option>          {options.dates.map(date => <option key={date} value={date}>              {date}            </option>)}        </select>
</div>
</section>;
}
function ImageFeedCard({
  item,
  vote,
  reactionStatus = 'ready',
  onVote,
  onHide,
  onSelect,
  onOpen,
  checked,
  onCheck,
  isSelected,
  isApproved,
  isSaved,
  onSave,
  busyAction = '',
  workflowReady = true,
  savedReady = true,
  canKill = false,
  onKill,
  reviewAllowed = false,
}) {
  const score = scoreOf(item);
  const selected = isSelected || item.selected_by;
  const isHigh = score >= 80;
  return <article aria-busy={Boolean(busyAction)} className="image-feed-card group relative cursor-pointer overflow-hidden rounded-[22px] border border-white/10 bg-[#101827] shadow-cockpit transition hover:border-sky-300/30" onClick={event => {
    if (!event.target.closest('button, input, a')) {
      onOpen(item);
    }
  }}>
<SignalVisual item={item} className="visual-layer z-0" label={false} />
<div className="absolute inset-0 z-10 bg-[linear-gradient(0deg,rgba(5,9,20,0.84)_0%,rgba(5,9,20,0.48)_42%,rgba(5,9,20,0.12)_76%,rgba(0,0,0,0.02)_100%)]" />
<div className="absolute inset-x-0 bottom-0 z-10 h-3/4 bg-gradient-to-t from-[#050914]/92 via-[#050914]/54 to-transparent" />
<div className="relative z-20 flex h-full flex-col p-4">
<div className="flex items-start justify-between gap-3">          {reviewAllowed && onCheck && <input type="checkbox" checked={checked} onChange={event => onCheck(item, event.target.checked)} className="signal-checkbox mt-1" aria-label={`Select ${item.title}`} />}          <div className="ml-auto flex flex-wrap justify-end gap-2">            {followUp(item) && <span className="personal-follow-chip" title={`Related to: ${followUp(item).matched_saved_title || 'a saved signal'}`}><Icon name="bookmark" size={11} /> {followUp(item).follow_label}</span>}            {item.is_fresh && <span className="signal-chip selected">                New              </span>}            {reviewAllowed && isApproved && <span className="signal-chip">                Approved              </span>}            {reviewAllowed && selected && <span className="signal-chip">                Selected              </span>}            {!selected && !isApproved && !item.is_fresh && isHigh && <span className="signal-chip selected">                  High Signal                </span>}          </div>
</div>
<div className="feed-card-copy mt-auto rounded-2xl border border-white/10 bg-[#050914]/55 p-3 backdrop-blur-sm">
<button className="block w-full text-left" onClick={() => onOpen(item)} type="button">
<div className="mb-2 flex flex-wrap gap-2">
<span className="source-chip">                {item.category || 'News'}              </span>
<span className="source-chip">                {item.region || 'Global'}              </span>
</div>
<div className="text-sm font-semibold text-slate-200">              Coverage: {item.source_count || 1} sources · Score {score}            </div>            {selected && <div className="mt-1 text-xs font-semibold text-sky-100">                Selected by {item.selected_by || 'team'}              </div>}            <h3 className="mt-2 line-clamp-3 text-[clamp(1.15rem,1.18vw,1.45rem)] font-semibold leading-tight text-white">              {item.title}            </h3>
</button>
<div className="feed-card-actions mt-4">
<div className="flex flex-wrap items-center gap-2">
<button className="btn-dark-secondary h-9 px-3" onClick={() => onOpen(item)} type="button">                Open Dossier              </button>              {reviewAllowed && (isApproved ? <span className="btn-dark-secondary h-9 px-3 text-sky-100">                  Approved                </span> : selected ? <span className="btn-dark-secondary h-9 px-3 text-sky-100">                  Selected                </span> : <button className="btn-dark-primary h-9 px-3" disabled={Boolean(busyAction) || !workflowReady} onClick={() => onSelect(item)} title={!workflowReady ? 'Review Queue state is unavailable' : undefined} type="button">                  Select for Review                </button>)}              <button className="btn-dark-secondary h-9 px-3" disabled={Boolean(busyAction)} onClick={() => onHide(item)} title="Hide only from your feed" type="button">                {busyAction === 'hide' ? 'Hiding…' : 'Hide'}              </button>{canKill && <button className="article-kill-switch h-9 px-3" disabled={Boolean(busyAction)} onClick={() => onKill(item)} title="Remove this article from the shared briefing for everyone" type="button"><Icon name="trash" size={14} /> {busyAction === 'kill' ? 'Removing…' : 'Remove globally'}</button>}
<button className="btn-dark-secondary h-9 px-3" disabled={Boolean(busyAction) || !savedReady} onClick={() => onSave(item)} title={!savedReady ? 'Following state is unavailable' : isSaved ? 'Unfollow this story' : 'Follow this story'} type="button">
<Icon name={isSaved ? 'check' : 'bookmark'} size={14} /> {busyAction === 'save' ? 'Updating…' : isSaved ? 'Following' : 'Follow'}
</button>
</div>
<Bouncer disabled={Boolean(busyAction) || ['loading', 'error'].includes(reactionStatus)} reactions={vote} status={reactionStatus} onVote={value => onVote(item, value)} />
</div>
</div>
</div>
</article>;
}
export default function FeedScreen({ capabilities = [] }) {
  const capabilitySet = useMemo(() => new Set(capabilities), [capabilities]);
  const reviewAllowed = capabilitySet.has('review.news.submit');
  const workflowVisible = reviewAllowed || capabilitySet.has('review.news.view') || capabilitySet.has('review.news.approve') || capabilitySet.has('approved.view');
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [votes, setVotes] = useState({});
  const [reactionState, setReactionState] = useState({ status: 'loading', error: '' });
  const [reactionLoadAttempt, setReactionLoadAttempt] = useState(0);
  const canKill = capabilitySet.has('gatekeeper.review');
  const [openArticle, setOpen] = useState(null);
  const [pendingSelect, setPendingSelect] = useState(null);
  const [batchSelect, setBatchSelect] = useState(null);
  const [draftExportOpen, setDraftExportOpen] = useState(false);
  const [checked, setChecked] = useState({});
  const [workflow, setWorkflow] = useState({
    selected: [],
    approved: []
  });
  const [hiddenCount, setHiddenCount] = useState(0);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [filters, setFilters] = useState(emptyFilters);
  const [activeLens, setActiveLens] = useState('all');
  const [personalizationMeta, setPersonalizationMeta] = useState(null);
  const [showPersonalizationNotice, setShowPersonalizationNotice] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [busyActions, setBusyActions] = useState({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [supportingState, setSupportingState] = useState({ workflow: workflowVisible ? 'loading' : 'hidden', saved: 'loading', hidden: 'loading' });
  const actionLocks = useRef(new Set());
  const dossierOpenedAt = useRef(0);
  const dossierActiveMs = useRef(0);
  useEffect(() => {
    let cancelled = false;
    setSupportingState({ workflow: workflowVisible ? 'loading' : 'hidden', saved: 'loading', hidden: 'loading' });
    (async () => {
      try {
        const data = await getSharedBriefing().catch(() => getLatestBriefing());
        if (cancelled) {
          return;
        }
        const normalizedItems = normalizeList(data?.result || data?.results || data?.articles || data || []);
        const items = normalizeArticleImages(normalizedItems);
        setArticles(items);
        setPersonalizationMeta(data?.personalization || null);
        setShowPersonalizationNotice(Boolean(data?.personalization?.applied));
        trackAction('briefing_view', { screen: 'briefing', item_count: items.length });
      } catch (error) {
        if (!cancelled) {
          setErr(error.message || String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    if (workflowVisible) getWorkflow().then(result => {
      setWorkflow({
        selected: normalizeList(result?.selected || []),
        approved: normalizeList(result?.approved || [])
      });
      setSupportingState((current) => ({ ...current, workflow: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, workflow: 'error' })));
    getViewerHidden().then(result => {
      setHiddenCount(Number(result?.count ?? result?.items?.length ?? 0));
      setSupportingState((current) => ({ ...current, hidden: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, hidden: 'error' })));
    getViewerSaved().then(result => {
      setSavedKeys(new Set(normalizeList(result?.items || []).map(articleKey)));
      setSupportingState((current) => ({ ...current, saved: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, saved: 'error' })));
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, workflowVisible]);
  const reactionSignature = useMemo(() => articles.map(reactionIdentity).filter(Boolean).join('|'), [articles]);
  useEffect(() => {
    if (!reactionSignature) return undefined;
    let cancelled = false;
    const identities = reactionSignature.split('|');
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await getViewerReactions(identities);
        if (cancelled) return;
        const snapshots = result?.reactions || {};
        setVotes((current) => {
          const next = { ...current };
          articles.forEach((item) => {
            const snapshot = snapshots[reactionIdentity(item)];
            if (snapshot) next[articleKey(item)] = snapshot;
          });
          return next;
        });
        setOpen((current) => current && snapshots[reactionIdentity(current)] ? { ...current, reactions: snapshots[reactionIdentity(current)] } : current);
        setReactionState({ status: 'ready', error: '' });
      } catch (reactionError) {
        if (cancelled) return;
        setReactionState((current) => ({
          status: current.status === 'ready' || current.status === 'stale' ? 'stale' : 'error',
          error: reactionError?.message || 'Reaction totals could not be verified.',
        }));
      }
    };
    setReactionState((current) => ({ status: current.status === 'ready' ? 'stale' : 'loading', error: '' }));
    sync();
    const onVisibility = () => { if (document.visibilityState === 'visible') sync(); };
    const timer = window.setInterval(sync, 12_000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [articles, reactionLoadAttempt, reactionSignature]);
  useEffect(() => {
    if (!showPersonalizationNotice) return undefined;
    const timer = window.setTimeout(() => setShowPersonalizationNotice(false), 6500);
    return () => window.clearTimeout(timer);
  }, [showPersonalizationNotice]);
  const selectedIds = useMemo(() => new Set(workflow.selected.map(article => article.id || article.title)), [workflow.selected]);
  const approvedIds = useMemo(() => new Set(workflow.approved.map(article => article.id || article.title)), [workflow.approved]);
  const lenses = useMemo(() => briefingLensOptions(articles), [articles]);
  const lensArticles = useMemo(() => articles.filter(item => matchesBriefingLens(item, activeLens)), [activeLens, articles]);
  const filteredArticles = useMemo(() => applyFilters(lensArticles, filters, selectedIds), [filters, lensArticles, selectedIds]);
  const heroFeed = useMemo(() => getHeroFeed(lensArticles), [lensArticles]);
  const heroFeedKeys = useMemo(() => new Set(heroFeed.map(stableSignalKey).filter(Boolean)), [heroFeed]);
  const groups = useMemo(() => groupedByDatePreservingOrder(filteredArticles), [filteredArticles]);
  const selectedBatch = useMemo(() => articles.filter(item => checked[articleKey(item)]), [articles, checked]);
  const options = useMemo(() => ({
    regions: uniqueSorted(lensArticles.map(article => article.region)),
    categories: uniqueSorted(lensArticles.map(article => article.category)),
    sources: uniqueSorted(lensArticles.map(article => article.src || article.source)),
    dates: uniqueSorted(lensArticles.map(article => article.date)).reverse(),
    keywords: keywordOptions(lensArticles)
  }), [lensArticles]);
  const selectLens = lens => {
    setActiveLens(lens);
    setFilters(emptyFilters);
  };
  const retrySupportingState = async () => {
    const failed = Object.entries(supportingState).filter(([, value]) => value === 'error').map(([key]) => key);
    if (!failed.length) return;
    setSupportingState((current) => ({ ...current, ...Object.fromEntries(failed.map((key) => [key, 'loading'])) }));
    const tasks = [];
    if (workflowVisible && failed.includes('workflow')) tasks.push(getWorkflow().then((result) => {
      setWorkflow({ selected: normalizeList(result?.selected || []), approved: normalizeList(result?.approved || []) });
      setSupportingState((current) => ({ ...current, workflow: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, workflow: 'error' }))));
    if (failed.includes('saved')) tasks.push(getViewerSaved().then((result) => {
      setSavedKeys(new Set(normalizeList(result?.items || []).map(articleKey)));
      setSupportingState((current) => ({ ...current, saved: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, saved: 'error' }))));
    if (failed.includes('hidden')) tasks.push(getViewerHidden().then((result) => {
      setHiddenCount(Number(result?.count ?? result?.items?.length ?? 0));
      setSupportingState((current) => ({ ...current, hidden: 'ready' }));
    }).catch(() => setSupportingState((current) => ({ ...current, hidden: 'error' }))));
    await Promise.all(tasks);
  };
  const runArticleAction = async (action, item, work) => {
    const key = articleKey(item);
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setBusyActions((current) => ({ ...current, [key]: action }));
    try {
      return await work();
    } finally {
      actionLocks.current.delete(key);
      setBusyActions((current) => { const next = { ...current }; delete next[key]; return next; });
    }
  };
  const refreshPersonalizedOrder = async () => {
    try {
      const data = await getSharedBriefing().catch(() => getLatestBriefing());
      const normalizedItems = normalizeList(data?.result || data?.results || data?.articles || data || []);
      setArticles(normalizeArticleImages(normalizedItems));
      setPersonalizationMeta(data?.personalization || null);
    } catch {
      // The current in-memory briefing remains usable if a background reorder fails.
    }
  };
  const onVote = async (item, voteValue) => {
    const key = articleKey(item);
    const previousVote = votes[key];
    const detail = articleActivityDetail(item, 'feed');
    return runArticleAction('vote', item, async () => {
      try {
      const response = await setViewerReaction(item, voteValue || 'neutral');
      const snapshot = { like_count: response.like_count, dislike_count: response.dislike_count, viewer_reaction: response.viewer_reaction };
      setVotes((previous) => ({ ...previous, [key]: snapshot }));
      setReactionState({ status: 'ready', error: '' });
      setOpen((current) => current && articleKey(current) === key ? { ...current, reactions: snapshot } : current);
      await trackAction(voteValue === 'dislike' ? 'vote_not_interested' : voteValue === 'like' ? 'vote_interested' : 'vote_neutral', detail);
      setActionFeedback({ type: 'success', message: voteValue === 'neutral' ? 'Reaction removed. The story stays in the briefing.' : `Your ${voteValue} was counted. The story stays in the briefing.` });
      } catch (error) {
        setVotes((previous) => {
          const next = { ...previous };
          if (previousVote) next[key] = previousVote; else delete next[key];
          return next;
        });
        setActionFeedback({ type: 'error', message: error?.message || 'Feedback could not be recorded. Please try again.' });
      }
    });
  };
  const killArticle = async (item) => {
    if (!canKill || !window.confirm(`Remove “${item.title}” from the shared briefing for every viewer?`)) return;
    return runArticleAction('kill', item, async () => {
      try {
        await rejectArticle({ ...item, rejected_by: 'authorized kill switch' });
        setArticles((current) => current.filter((article) => articleKey(article) !== articleKey(item)));
        setActionFeedback({ type: 'success', message: 'Article removed globally and queued for shared Gatekeeper learning.' });
      } catch (error) {
        setActionFeedback({ type: 'error', message: error?.message || 'The article could not be removed globally.' });
      }
    });
  };
  const hideArticle = async item => {
    const key = articleKey(item);
    return runArticleAction('hide', item, async () => {
      try {
      await hideArticleForViewer(item);
      setArticles(currentArticles => currentArticles.filter(article => articleKey(article) !== key));
      setHiddenCount(count => count + 1);
      await trackAction('hide_personal', articleActivityDetail(item, 'feed'));
      setActionFeedback({ type: 'success', message: 'Hidden only from your feed. You can restore it from Hidden Signals.', actionLabel: 'Review hidden', action: () => navigate('/rejected') });
    } catch (error) {
      setActionFeedback({ type: 'error', message: error?.message || 'Could not hide this signal. Please try again.' });
      }
    });
  };
  const toggleSave = async item => {
    if (supportingState.saved !== 'ready') {
      setActionFeedback({ type: 'error', message: 'Following state is unavailable. Retry personal state before changing this story.' });
      return;
    }
    const key = articleKey(item);
    const wasSaved = savedKeys.has(key);
    return runArticleAction('save', item, async () => {
      setSavedKeys(current => {
        const next = new Set(current);
        if (wasSaved) next.delete(key);
        else next.add(key);
        return next;
      });
      try {
      if (wasSaved) await removeSavedArticle(item);
      else await saveArticleForLater(item);
      await refreshPersonalizedOrder();
      setActionFeedback({ type: 'success', message: wasSaved ? 'Story unfollowed.' : 'Following privately.' });
      } catch (error) {
      setSavedKeys(current => {
        const next = new Set(current);
        if (wasSaved) next.add(key);
        else next.delete(key);
        return next;
      });
      setActionFeedback({ type: 'error', message: error?.message || 'Following could not be updated. Your previous state was restored.' });
      }
    });
  };
  const openDossier = item => {
    dossierActiveMs.current = 0;
    dossierOpenedAt.current = document.visibilityState === 'visible' ? Date.now() : 0;
    trackAction('article_click', articleActivityDetail(item, 'feed'));
    trackAction('dossier_open', { ...articleActivityDetail(item, 'feed'), dossier_title: item.title })
      .then(refreshPersonalizedOrder);
    setOpen({ ...item, reactions: votes[articleKey(item)] });
  };
  const closeDossier = () => {
    const item = openArticle;
    const activeMs = dossierActiveMs.current + (dossierOpenedAt.current ? Date.now() - dossierOpenedAt.current : 0);
    dossierOpenedAt.current = 0;
    dossierActiveMs.current = 0;
    setOpen(null);
    if (item && activeMs >= 1500) {
      trackAction('dossier_dwell', {
        ...articleActivityDetail(item, 'feed'),
        active_ms: Math.round(activeMs),
      }).then(refreshPersonalizedOrder);
    }
  };
  useEffect(() => {
    if (!openArticle) return undefined;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && dossierOpenedAt.current) {
        dossierActiveMs.current += Date.now() - dossierOpenedAt.current;
        dossierOpenedAt.current = 0;
      } else if (document.visibilityState === 'visible' && !dossierOpenedAt.current) {
        dossierOpenedAt.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [openArticle]);
  const hideFromDossier = async item => {
    closeDossier();
    await hideArticle(item);
  };
  const selectFromDossier = item => {
    closeDossier();
    setPendingSelect(item);
  };
  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = {
      region: result.region,
      region_basis: 'User corrected'
    };
    setArticles(currentArticles => currentArticles.map(article => article.title === item.title ? {
      ...article,
      ...patch
    } : article));
    setWorkflow(state => ({
      selected: state.selected.map(article => article.title === item.title ? {
        ...article,
        ...patch
      } : article),
      approved: state.approved.map(article => article.title === item.title ? {
        ...article,
        ...patch
      } : article)
    }));
    setOpen(article => article?.title === item.title ? {
      ...article,
      ...patch
    } : article);
    return result;
  };
  const confirmSelect = async (item, name) => {
    if (supportingState.workflow !== 'ready') {
      const error = new Error('Review Queue state is unavailable. Retry personal state before selecting this story.');
      setActionFeedback({ type: 'error', message: error.message });
      throw error;
    }
    const payload = {
      ...item,
      selected_by: name,
      selected_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };
    return runArticleAction('select', item, async () => {
      try {
        await selectWorkflow(payload);
        setWorkflow(state => ({
          ...state,
          selected: [payload, ...state.selected.filter(existing => existing.id !== item.id)]
        }));
        setArticles(currentArticles => currentArticles.map(article => article.id === item.id ? {
          ...article,
          selected_by: name
        } : article));
        await trackAction('select', { ...articleActivityDetail(item, 'feed'), selected_by: name });
        await refreshPersonalizedOrder();
        setActionFeedback({ type: 'success', message: 'Signal sent to the shared Review Queue.' });
      } catch (error) {
        setActionFeedback({ type: 'error', message: error?.message || 'Could not send this signal to Review Queue.' });
        throw error;
      }
    });
  };
  const onCheck = (item, isOn) => {
    const key = articleKey(item);
    setChecked(previous => {
      const next = {
        ...previous
      };
      if (isOn) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
  };
  const confirmBatch = async (_item, name) => {
    if (batchBusy || !selectedBatch.length) return;
    setBatchBusy(true);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const payloads = selectedBatch.map(item => ({
      ...item,
      selected_by: name,
      selected_at: stamp
    }));
    try {
      const results = await Promise.allSettled(payloads.map((payload) => selectWorkflow(payload)));
      const succeeded = payloads.filter((_, index) => results[index].status === 'fulfilled');
      const failed = payloads.filter((_, index) => results[index].status === 'rejected');
      if (succeeded.length) {
        const succeededKeys = new Set(succeeded.map(articleKey));
        setWorkflow(state => ({
          ...state,
          selected: [...succeeded, ...state.selected.filter(existing => !succeeded.some(payload => payload.title === existing.title))]
        }));
        setArticles(currentArticles => currentArticles.map(item => succeededKeys.has(articleKey(item)) ? {
          ...item,
          selected_by: name,
          selected_at: stamp
        } : item));
        setChecked((current) => {
          const next = { ...current };
          succeededKeys.forEach((key) => { delete next[key]; });
          return next;
        });
        trackAction('batch_select', {
          item_count: succeeded.length,
          items: succeeded.map((item) => articleActivityDetail(item, 'feed')),
          selected_by: name,
          source: 'feed',
          screen: 'feed'
        });
      }
      if (failed.length) {
        const error = new Error(`${failed.length} of ${payloads.length} signals could not be sent. Failed items remain checked so you can retry.`);
        setActionFeedback({ type: 'error', message: error.message });
        throw error;
      }
      setBatchSelect(null);
      setActionFeedback({ type: 'success', message: `${succeeded.length} signal${succeeded.length === 1 ? '' : 's'} sent to Review Queue.` });
    } finally {
      setBatchBusy(false);
    }
  };
  if (loading) {
    return <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
<div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-200" />
<h2 className="text-xl font-semibold text-white">          Loading Intelligence Briefing        </h2>
<p className="mt-2 text-slate-400">          Crawling context, workflow state, and briefing signals.        </p>
</div>;
  }
  if (err) {
    return <div className="rounded-[24px] border border-red-300/20 bg-red-950/20 p-10 text-center" role="alert">
<h2 className="text-xl font-semibold text-white">          Failed to load briefing        </h2>
<p className="mt-2 text-red-200/80">          {err}        </p>
<button className="btn-dark-secondary mt-4" onClick={() => { setErr(null); setLoading(true); setLoadAttempt((current) => current + 1); }} type="button"><Icon name="refresh" size={14} /> Try again</button>
</div>;
  }
  if (!articles.length) {
    return <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
<h2 className="text-xl font-semibold text-white">          No signals found for this scan        </h2>
<p className="mt-2 text-slate-400">          Try widening the date range, adding sources, or changing keywords.        </p>
<button className="btn-dark-secondary mt-4" onClick={() => { setLoading(true); setLoadAttempt((current) => current + 1); }} type="button"><Icon name="refresh" size={14} /> Check again</button>
</div>;
  }
  return <div className="briefing-home space-y-4 2xl:space-y-5">
{showPersonalizationNotice && <div className="personalization-toast" role="status"><Icon name="sparkle" size={15} /><span><strong>{personalizationMeta?.viewer_name ? `Personalized for ${personalizationMeta.viewer_name}` : 'Your personalized feed'}</strong><small>Recent reading and saved signals shape the order—not what is available.</small></span><button onClick={() => setShowPersonalizationNotice(false)} type="button" aria-label="Dismiss personalization message"><Icon name="x" size={13} /></button></div>}
{actionFeedback && <div className={actionFeedback.type === 'error' ? 'error-banner' : 'personal-notice'} role={actionFeedback.type === 'error' ? 'alert' : 'status'}><span>{actionFeedback.message}</span>{actionFeedback.action && <button className="ml-3 underline" onClick={actionFeedback.action} type="button">{actionFeedback.actionLabel}</button>}<button aria-label="Dismiss message" className="ml-3" onClick={() => setActionFeedback(null)} type="button"><Icon name="x" size={13} /></button></div>}
{Object.values(supportingState).includes('error') && <div className="error-banner" role="status"><span>Some personal state could not be verified. Save or Review Queue actions stay disabled where their current state is unknown.</span><button className="ml-3 underline" onClick={retrySupportingState} type="button">Retry personal state</button></div>}
{['error', 'stale'].includes(reactionState.status) && <div className="error-banner" role="status"><span>{reactionState.status === 'stale' ? 'Showing last-known reaction totals while the count service reconnects.' : `${reactionState.error} Counts are hidden rather than shown as zero.`}</span><button className="ml-3 underline" onClick={() => setReactionLoadAttempt((current) => current + 1)} type="button">Retry reaction totals</button></div>}
<section className="briefing-stage grid gap-4 2xl:gap-5">
<div className="briefing-top-row briefing-hero-row grid min-h-0 gap-4 2xl:gap-5">
<div className="briefing-hero-stack">
<TopClusterCarousel articles={heroFeed} onOpen={openDossier} />
<BriefingLensRail activeLens={activeLens} lenses={lenses} onLens={selectLens} />
</div>
<BriefingStream articles={lensArticles} onOpen={openDossier} navigate={navigate} />
</div>
<LatestDaySignals articles={lensArticles} excludeKeys={heroFeedKeys} onOpen={openDossier} />
</section>
<SearchLoadedBriefing filters={filters} setFilters={setFilters} options={options} count={filteredArticles.length} total={lensArticles.length} />
<section className="space-y-8">        {Object.entries(groups).map(([day, items]) => <div key={day} className="space-y-4">
<div className="flex items-center gap-4">
<h2 className="text-lg font-semibold text-white">                  {day}                </h2>
<div className="h-px flex-1 bg-white/10" />
<span className="text-sm text-slate-500">                  {items.length} signals                </span>
</div>
<div className="home-article-grid grid gap-8">                {items.map(item => <ImageFeedCard busyAction={busyActions[articleKey(item)] || ''} canKill={canKill} key={item.id} item={item} vote={votes[articleKey(item)]} reactionStatus={reactionState.status} onVote={onVote} onKill={killArticle} onHide={hideArticle} onSave={toggleSave} onSelect={setPendingSelect} onOpen={openDossier} onCheck={reviewAllowed ? onCheck : undefined} reviewAllowed={reviewAllowed} checked={!!checked[articleKey(item)]} isSaved={savedKeys.has(articleKey(item))} isSelected={selectedIds.has(item.id) || selectedIds.has(item.title)} isApproved={approvedIds.has(item.id) || approvedIds.has(item.title)} savedReady={supportingState.saved === 'ready'} workflowReady={supportingState.workflow === 'ready'} />)}              </div>
</div>)}        {filteredArticles.length === 0 && <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
<h2 className="text-xl font-semibold text-white">              No loaded briefing signals match these filters            </h2>
<p className="mt-2 text-slate-400">              Try changing region, date, source, or category.            </p>
</div>}      </section>
<button className="hidden-review-link inline-flex w-full max-w-xl items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-sky-300/25 hover:bg-white/[0.055] sm:w-auto sm:min-w-[420px]" onClick={() => navigate('/rejected')} type="button">
<span>
<span className="block text-sm font-semibold text-white">            Review Hidden Signals          </span>
<span className="mt-1 block text-xs text-slate-400">            {hiddenCount} articles hidden only from your feed.          </span>
</span>
<span className="btn-dark-secondary h-9">          Open Hidden Review        </span>
</button>
<ArticleModal item={openArticle} onClose={closeDossier} onSelect={reviewAllowed ? selectFromDossier : undefined} onHide={hideFromDossier} onSave={toggleSave} isSaved={!!openArticle && savedKeys.has(articleKey(openArticle))} onVote={reactionState.status === 'ready' || reactionState.status === 'stale' ? onVote : undefined} onCorrectRegion={capabilitySet.has('region.correct') ? onCorrectRegion : undefined} onSourceOpen={(item) => trackAction('source_open', articleActivityDetail(item, 'dossier'))} onWhyThisStory={(item) => trackAction('why_this_story_open', articleActivityDetail(item, 'dossier'))} />
{reviewAllowed && <NameModal open={!!pendingSelect} article={pendingSelect} onClose={() => setPendingSelect(null)} onConfirm={confirmSelect} />}
{reviewAllowed && <NameModal open={!!batchSelect} article={batchSelect} title={`Send ${selectedBatch.length} articles to Review Queue`} description="Enter your name." confirmLabel="Send to Review Queue" onClose={() => setBatchSelect(null)} onConfirm={confirmBatch} />}
<DraftExportModal items={selectedBatch} open={draftExportOpen} source="briefing" onClose={() => setDraftExportOpen(false)} />      {reviewAllowed && selectedBatch.length > 0 && <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
<div className="batch-action-bar flex flex-wrap items-center justify-center gap-3 rounded-full border border-sky-300/20 bg-[#101827]/95 px-5 py-3 text-sm text-slate-200 shadow-cockpit backdrop-blur-xl">
<strong>              {selectedBatch.length} selected            </strong>
<button className="btn-dark-secondary h-9" disabled={batchBusy} onClick={() => setChecked({})} type="button">              Clear            </button>
<button className="btn-dark-primary h-9" disabled={batchBusy} onClick={() => setBatchSelect({
          title: `${selectedBatch.length} selected signals`
        })} type="button">              Send to Review Queue            </button>
<button className="btn-dark-secondary h-9" disabled={batchBusy} onClick={() => setDraftExportOpen(true)} type="button">              Draft Export            </button>
</div>
</div>}    </div>;
}
