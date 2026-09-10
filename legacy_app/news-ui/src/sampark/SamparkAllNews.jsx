import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  getLatestBriefing,
  getPublishedInternalContent,
  getSharedBriefing,
  getViewerHidden,
  getViewerReactions,
  getViewerSaved,
  hideArticleForViewer,
  removeSavedArticle,
  saveArticleForLater,
  setViewerReaction,
} from '../news-scrapper/api.js';
import { articleKey, reactionIdentity, scoreOf } from '../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';

const CATEGORIES = ['All', 'AI', 'Devices', 'Compute', 'Robotics', 'Media'];

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || item?.top_image || '';
}

function resolveImage(item) {
  const candidates = [
    item?.image_url, item?.imageUrl, item?.thumbnail_url, item?.og_image, item?.top_image,
    item?.image, item?.thumbnail, item?.article_image_url,
  ];
  const match = candidates.find((v) => typeof v === 'string' && v.trim() && v.trim() !== '#');
  return match ? match.trim() : '';
}

function SamparkAllNewsDossier({ item, onClose, saved, onSave, onHide, onReact, onSourceOpen }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  const image = imageOf(item);
  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  const lead = item.summary_lead || item.summary || item.master_summary || '';
  const points = Array.isArray(item.summary_points) ? item.summary_points : [];
  const whyMatters = item.why_matters || item.why_it_matters || item.attention_hook || '';
  const sourceLink = item.link || item.url || '';
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-allnews-dossier-title" aria-modal="true" className="sampark-dossier sampark-dossier--large" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'Intelligence'} · {item.src || item.source || 'TechScout'} · {item.date || 'Latest'}</div>
            <div className="sampark-dossier-subtitle">{item.region || 'Global'} · {item.source_count || 1} source{(item.source_count||1)===1?'':'s'} · {item.mins_read || 1} min read</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {image ? (
            <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={image} /></div>
          ) : (
            <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>
          )}
          <div className="sampark-dossier-body">
            <h2 id="sampark-allnews-dossier-title" className="sampark-dossier-title">{item.title}</h2>
            {lead && <p className="sampark-dossier-summary">{lead}</p>}
            {points.length ? <ul className="sampark-dossier-points">{points.slice(0,5).map((p,i)=><li key={i}>{p}</li>)}</ul> : null}
            {sourceLink ? <a className="sampark-dossier-link" href={sourceLink} onClick={() => onSourceOpen?.(item)} rel="noreferrer" target="_blank">Open original source <Icon name="external" size={14} /></a> : null}
            {whyMatters ? <div className="sampark-dossier-insight"><strong>Why this matters</strong><p>{whyMatters}</p></div> : null}
            {item.keywords?.length ? <div className="sampark-dossier-keywords">{item.keywords.slice(0,8).map((kw)=><span key={kw} className="sampark-keyword">{kw}</span>)}</div> : null}
          </div>
        </div>
        <footer className="sampark-dossier-actions">
          <button className={`sampark-action-btn${reactions.viewer_reaction === 'like' ? ' is-active' : ''}`} onClick={() => onReact(item, 'like')} type="button"><Icon name="thumbsUp" size={16} /> {reactions.like_count || 0} Like</button>
          <button className={`sampark-action-btn${reactions.viewer_reaction === 'dislike' ? ' is-active' : ''}`} onClick={() => onReact(item, 'dislike')} type="button"><Icon name="thumbsDown" size={16} /> {reactions.dislike_count || 0}</button>
          <button className={`sampark-action-btn${saved ? ' is-active' : ''}`} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={16} /> {saved ? 'Following' : 'Follow'}</button>
          <button className="sampark-action-btn" onClick={() => onHide(item)} type="button"><Icon name="eye" size={16} /> Hide</button>
          <span className="sampark-dossier-spacer" />
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

function categoryMatches(item, active) {
  if (active === 'All') return true;
  const hay = `${item.category || ''} ${item.region || ''} ${(item.keywords || []).join(' ')} ${item.title || ''}`.toLowerCase();
  const term = active.toLowerCase();
  if (term === 'ai') return hay.includes('ai') || hay.includes('artificial');
  if (term === 'devices') return hay.includes('device') || hay.includes('display') || hay.includes('galaxy') || hay.includes('phone');
  if (term === 'compute') return hay.includes('compute') || hay.includes('chip') || hay.includes('semiconductor') || hay.includes('cloud');
  if (term === 'robotics') return hay.includes('robot');
  if (term === 'media') return hay.includes('media') || hay.includes('broadcast') || hay.includes('content');
  return hay.includes(term);
}

function briefingSort(a, b) {
  const coverage = (b.source_count || 1) - (a.source_count || 1);
  if (coverage) return coverage;
  const score = scoreOf(b) - scoreOf(a);
  if (score) return score;
  return (b.published_at || b.date || '').localeCompare(a.published_at || a.date || '');
}

function SamparkAllNewsCard({ item, featured, saved, busy, onOpen, onSave, onHide, onReact }) {
  const image = resolveImage(item);
  const reactions = item.reactions || {};
  const likeActive = reactions.viewer_reaction === 'like';
  const dislikeActive = reactions.viewer_reaction === 'dislike';
  return (
    <article className={featured ? 'sampark-all-news-featured-card' : 'sampark-all-news-card'}>
      <button aria-label={`Open dossier for ${item.title}`} className={featured ? 'sampark-all-news-media sampark-all-news-media--featured' : 'sampark-all-news-media'} onClick={() => onOpen(item)} type="button">
        {image ? <img alt="" className="sampark-card-img" src={image} loading="lazy" /> : <span className="sampark-card-img-placeholder"><Icon name="globe" size={28} /></span>}
        <span className="sampark-card-source-badge">{item.src || item.source || 'TechScout'}</span>
      </button>
      <div className="sampark-all-news-body">
        <div className="sampark-all-news-kicker">{item.category || 'News'} · {item.region || 'Global'} · {item.source_count || 1} source{(item.source_count||1)===1?'':'s'}</div>
        <button className="sampark-all-news-title-btn" onClick={() => onOpen(item)} type="button"><h4>{item.title}</h4></button>
        <p className="sampark-all-news-summary">{item.summary || item.master_summary || 'Open the dossier for the full summary.'}</p>
        <div className="sampark-all-news-footer">
          <span className="sampark-card-meta"><Icon name="clock" size={12} /> {item.date || 'Latest'}</span>
          <div className="sampark-card-actions">
            <button aria-label={`Like ${item.title}`} className={`sampark-card-action${likeActive ? ' is-active' : ''}`} disabled={Boolean(busy)} onClick={() => onReact(item, 'like')} type="button"><Icon name="thumbsUp" size={14} /><span>{reactions.like_count || 0}</span></button>
            <button aria-label={`Dislike ${item.title}`} className={`sampark-card-action${dislikeActive ? ' is-active' : ''}`} disabled={Boolean(busy)} onClick={() => onReact(item, 'dislike')} type="button"><Icon name="thumbsDown" size={14} /></button>
            <button aria-label={`${saved ? 'Unfollow' : 'Follow'} ${item.title}`} className={`sampark-card-action${saved ? ' is-active' : ''}`} disabled={Boolean(busy)} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={14} /></button>
            <button aria-label={`Hide ${item.title}`} className="sampark-card-action" disabled={Boolean(busy)} onClick={() => onHide(item)} type="button"><Icon name="eye" size={14} /></button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function SamparkAllNews() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [filterQuery, setFilterQuery] = useState('');
  const [articles, setArticles] = useState([]);
  const [publishedHero, setPublishedHero] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [openArticle, setOpenArticle] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [savedReady, setSavedReady] = useState(false);
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const actionLocks = useRef(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSharedBriefing().catch(() => getLatestBriefing());
      const raw = data?.result || data?.results || data?.articles || data || [];
      const normalized = normalizeList(raw).map((it) => ({ ...it, image_url: resolveImage(it) }));
      // try to pull one published record for hero (non-faked, real)
      try {
        const published = await getPublishedInternalContent();
        if (Array.isArray(published) && published.length) {
          // use most recent published as hero supplement, but do NOT duplicate feed
          const latestPub = published[0];
          setPublishedHero(latestPub);
        } else setPublishedHero(null);
      } catch { setPublishedHero(null); }
      setArticles(normalized);
      setVisibleCount(20);
    } catch (e) {
      setError(e?.message || 'Could not load briefing.');
    } finally {
      setLoading(false);
    }
  }, [retryKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    getViewerSaved().then((r) => {
      if (cancelled) return;
      setSavedKeys(new Set(normalizeList(r?.items || []).map(articleKey)));
      setSavedReady(true);
    }).catch(() => { if (!cancelled) setSavedReady(false); });
    return () => { cancelled = true; };
  }, [retryKey]);

  // reactions sync
  const reactionSignature = useMemo(() => articles.map(reactionIdentity).filter(Boolean).join('|'), [articles]);
  useEffect(() => {
    if (!reactionSignature) return;
    let cancelled = false;
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await getViewerReactions(reactionSignature.split('|'));
        if (cancelled) return;
        const snapshots = res?.reactions || {};
        const apply = (c) => {
          const id = reactionIdentity(c);
          return snapshots[id] ? { ...c, reactions: snapshots[id] } : c;
        };
        setArticles((cur) => cur.map(apply));
        setOpenArticle((cur) => cur ? apply(cur) : cur);
      } catch {}
    };
    const iv = setInterval(sync, 12000);
    window.addEventListener('focus', sync);
    return () => { clearInterval(iv); window.removeEventListener('focus', sync); };
  }, [reactionSignature]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return articles.filter((it) => {
      if (!categoryMatches(it, activeCategory)) return false;
      if (q && !`${it.title} ${it.summary || ''} ${(it.keywords || []).join(' ')} ${it.source || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, activeCategory, filterQuery]);

  const hero = useMemo(() => {
    // hero includes published if available as first slide, otherwise briefing sorted
    const sorted = [...filtered].sort(briefingSort);
    if (publishedHero && activeCategory === 'All' && !filterQuery.trim()) {
      // present published as featured if it passes category? keep simple: always show as first hero when no filter
      const pubAsArticle = {
        title: publishedHero.title,
        summary: publishedHero.summary || publishedHero.body || '',
        category: publishedHero.category || 'Internal',
        region: 'Internal',
        source: publishedHero.author || publishedHero.ownerName || 'Samsung Internal',
        src: publishedHero.author || 'Samsung Internal',
        date: publishedHero.publishedAt ? String(publishedHero.publishedAt).slice(0,10) : 'Latest',
        source_count: 1,
        image_url: publishedHero.cover?.url || '',
        top_image: publishedHero.cover?.url || '',
        link: '',
        keywords: [],
        _published: true,
        _id: publishedHero.id,
      };
      // avoid duplicate title
      const withoutDup = sorted.filter((it) => it.title !== pubAsArticle.title);
      return [pubAsArticle, ...withoutDup].slice(0, 5);
    }
    return sorted.slice(0, 5);
  }, [filtered, publishedHero, activeCategory, filterQuery]);

  const stream = useMemo(() => [...filtered].sort((a,b) => (b.published_at || b.date || '').localeCompare(a.published_at || a.date || '')).slice(0, 8), [filtered]);
  const latest = useMemo(() => {
    const sorted = [...filtered].sort((a,b) => (b.date || '').localeCompare(a.date || ''));
    const latestDate = sorted[0]?.date || '';
    return sorted.filter((it) => it.date === latestDate).slice(0, 6);
  }, [filtered]);
  const feed = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleCount;

  const runAction = async (key, work) => {
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setBusy((c) => ({ ...c, [key]: true }));
    try { return await work(); } finally { actionLocks.current.delete(key); setBusy((c) => { const n={...c}; delete n[key]; return n; }); }
  };

  const openDossier = (item) => setOpenArticle(item);
  const closeDossier = () => setOpenArticle(null);

  const handleSave = async (item) => {
    if (item._published) { setNotice('Internal story — already published.'); return; }
    const key = articleKey(item);
    return runAction(key, async () => {
      const saved = savedKeys.has(key);
      if (saved) await removeSavedArticle(item);
      else await saveArticleForLater(item);
      setSavedKeys((cur) => { const n=new Set(cur); if(saved) n.delete(key); else n.add(key); return n; });
      setNotice(saved ? 'Removed from followed.' : 'Following privately.');
    });
  };
  const handleHide = async (item) => {
    if (item._published) { setNotice('Published internal content cannot be hidden.'); return; }
    const key = articleKey(item);
    return runAction(key, async () => {
      await hideArticleForViewer(item);
      setArticles((cur) => cur.filter((it) => articleKey(it) !== key));
      setNotice('Hidden from your feed.');
    });
  };
  const handleReact = async (item, reaction) => {
    if (item._published) { setNotice('Reactions are for briefing signals.'); return; }
    const key = articleKey(item);
    return runAction(key, async () => {
      const curReac = item.reactions?.viewer_reaction || 'neutral';
      const next = curReac === reaction ? 'neutral' : reaction;
      const resp = await setViewerReaction(item, next);
      const snap = { like_count: resp.like_count, dislike_count: resp.dislike_count, viewer_reaction: resp.viewer_reaction };
      setArticles((cur) => cur.map((it) => articleKey(it)===key ? { ...it, reactions: snap } : it));
      setOpenArticle((cur) => cur && articleKey(cur)===key ? { ...cur, reactions: snap } : cur);
      setNotice(next === 'neutral' ? 'Reaction removed.' : `Your ${next} was counted.`);
    });
  };

  if (loading) return <div className="sampark-all-news-page"><div className="sampark-all-news-loading" role="status"><span className="sampark-spinner" /> Loading All News briefing…</div></div>;
  if (error) return <div className="sampark-all-news-page"><div className="sampark-all-news-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="btn-primary" onClick={() => setRetryKey((k)=>k+1)} type="button">Retry</button></div></div>;

  return (
    <div className="sampark-all-news-page">
      {notice && <div className="sampark-for-you-feedback" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice('')} type="button"><Icon name="x" size={14} /></button></div>}
      <nav aria-label="All News categories" className="category-filters">
        {CATEGORIES.map((cat) => (
          <button key={cat} aria-pressed={activeCategory===cat} className={`cat-filter${activeCategory===cat ? ' active' : ''}`} onClick={() => { setActiveCategory(cat); setVisibleCount(20); }} type="button">{cat}</button>
        ))}
      </nav>

      <div className="sampark-all-news-layout">
        <div className="sampark-all-news-primary">
          {/* Featured News */}
          <section aria-labelledby="sampark-featured-title" className="sampark-all-news-featured">
            <header className="sampark-all-news-section-head"><h2 id="sampark-featured-title">Featured News</h2><span className="sampark-all-news-count">{hero.length} stories</span></header>
            {hero.length ? (
              <div className="sampark-all-news-hero-grid">
                {hero[0] && <SamparkAllNewsCard featured busy={busy[articleKey(hero[0])]} item={hero[0]} onHide={handleHide} onOpen={openDossier} onReact={handleReact} onSave={handleSave} saved={savedKeys.has(articleKey(hero[0]))} />}
                <div className="sampark-all-news-hero-side">
                  {hero.slice(1,5).map((it) => (
                    <SamparkAllNewsCard key={articleKey(it)||it.title} busy={busy[articleKey(it)]} item={it} onHide={handleHide} onOpen={openDossier} onReact={handleReact} onSave={handleSave} saved={savedKeys.has(articleKey(it))} />
                  ))}
                </div>
              </div>
            ) : <div className="sampark-all-news-empty"><Icon name="inbox" size={24} /><p>No featured stories match <strong>{activeCategory}</strong>{filterQuery ? ` · “${filterQuery}”` : ''}.</p><button className="btn-secondary" onClick={() => { setActiveCategory('All'); setFilterQuery(''); }} type="button">Clear filters</button></div>}
          </section>

          {/* Briefing Stream */}
          <section aria-labelledby="sampark-stream-title" className="sampark-all-news-stream">
            <header className="sampark-all-news-section-head"><h2 id="sampark-stream-title">Briefing Stream</h2><span className="sampark-all-news-live">Live</span></header>
            {stream.length ? (
              <div className="sampark-all-news-stream-list">
                {stream.map((it) => (
                  <button key={articleKey(it)} className="sampark-all-news-stream-item" onClick={() => openDossier(it)} type="button">
                    <span className="sampark-stream-category">{it.category || 'Intelligence'}</span>
                    <strong className="sampark-stream-title">{it.title}</strong>
                    <small className="sampark-stream-meta">{it.src || it.source || 'Briefing'} · {it.date || 'Latest'} · Score {scoreOf(it)}</small>
                  </button>
                ))}
              </div>
            ) : <p className="sampark-all-news-empty-text">The briefing stream will populate after the next scheduler run.</p>}
          </section>
        </div>

        <aside className="sampark-all-news-sidebar" aria-label="Latest News">
          <section className="sampark-all-news-latest">
            <h2>Latest News</h2>
            {latest.length ? (
              <div className="sampark-all-news-latest-list">
                {latest.map((it) => {
                  const img = resolveImage(it);
                  return (
                    <button key={articleKey(it)} className="sampark-all-news-latest-item" onClick={() => openDossier(it)} type="button">
                      <span className={`sampark-all-news-latest-thumb${img ? '' : ' is-empty'}`}>{img ? <img alt="" src={img} loading="lazy" /> : <Icon name="globe" size={18} />}</span>
                      <span className="sampark-all-news-latest-copy"><strong>{it.title}</strong><small>{it.source || it.src} · {it.date}</small></span>
                    </button>
                  );
                })}
              </div>
            ) : <p className="sampark-all-news-empty-text">No latest stories in this filter.</p>}
          </section>

          <section className="sampark-all-news-filters">
            <h2>Apply Filter & Customize View</h2>
            <label className="sampark-all-news-search"><Icon name="search" size={14} /><input aria-label="Filter All News" placeholder="Filter this briefing" value={filterQuery} onChange={(e)=>{ setFilterQuery(e.target.value); setVisibleCount(20); }} type="search" />{filterQuery && <button aria-label="Clear filter" onClick={()=>setFilterQuery('')} type="button"><Icon name="x" size={12} /></button>}</label>
            <div className="sampark-all-news-filter-meta">
              <span>{filtered.length} of {articles.length} signals visible</span>
              {(activeCategory!=='All' || filterQuery) && <button className="sampark-all-news-clear" onClick={()=>{ setActiveCategory('All'); setFilterQuery(''); }} type="button">Reset</button>}
            </div>
          </section>
        </aside>
      </div>

      {/* All News feed */}
      <section aria-labelledby="sampark-all-news-feed-title" className="sampark-all-news-feed">
        <header className="sampark-all-news-section-head"><h2 id="sampark-all-news-feed-title">All News</h2><span className="sampark-all-news-count">{filtered.length} stories · {visibleCount >= filtered.length ? 'all visible' : `${filtered.length - visibleCount} more`}</span></header>
        {filtered.length ? (
          <>
            <div className="sampark-all-news-grid">
              {feed.map((it) => (
                <SamparkAllNewsCard key={articleKey(it)} busy={busy[articleKey(it)]} item={it} onHide={handleHide} onOpen={openDossier} onReact={handleReact} onSave={handleSave} saved={savedKeys.has(articleKey(it))} />
              ))}
            </div>
            {hasMore && (
              <div className="sampark-all-news-loadmore">
                <button className="btn-primary" onClick={()=>setVisibleCount((c)=>c+20)} type="button">Load more · {filtered.length - visibleCount} remaining</button>
                <span className="sampark-load-hint">{visibleCount} of {filtered.length} shown</span>
              </div>
            )}
            {!hasMore && filtered.length > 20 && <p className="sampark-all-news-footnote">You have reached the end of this briefing. Adjust filters to discover more.</p>}
          </>
        ) : (
          <div className="sampark-all-news-empty"><Icon name="search" size={22} /><p>No stories match this filter. Try another category or clear the search.</p><button className="btn-secondary" onClick={()=>{ setActiveCategory('All'); setFilterQuery(''); }} type="button">Clear filters</button></div>
        )}
      </section>

      <SamparkAllNewsDossier item={openArticle} onClose={closeDossier} onHide={async (it)=>{ closeDossier(); await handleHide(it); }} onReact={handleReact} onSave={handleSave} onSourceOpen={()=>{}} saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} />
    </div>
  );
}
