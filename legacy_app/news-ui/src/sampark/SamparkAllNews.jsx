import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  getLatestBriefing,
  getPublishedInternalContent,
  getSharedBriefing,
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
import { emptyFilters } from '../news-scrapper/screens/briefingFilters.js';

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || item?.top_image || item?.image || '';
}

function SamparkAllNewsDossier({ item, onClose, saved, onSave, onHide, onReact }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  const image = imageOf(item);
  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  const lead = item.summary_lead || item.summary || item.master_summary || '';
  const points = Array.isArray(item.summary_points) ? item.summary_points : [];
  const whyMatters = item.why_matters || item.why_it_matters || '';
  const sourceLink = item.link || item.url || '';
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-allnews-dossier-title" aria-modal="true" className="sampark-dossier sampark-dossier--large" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'Intelligence'} · {item.src || item.source || 'TechScout'} · {item.date || 'Latest'}</div>
            <div className="sampark-dossier-subtitle">{item.region || 'Global'} · {item.source_count || 1} source{(item.source_count||1)===1?'':'s'} · Score {scoreOf(item)}</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {image ? <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={image} /></div> : <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>}
          <div className="sampark-dossier-body">
            <h2 id="sampark-allnews-dossier-title" className="sampark-dossier-title">{item.title}</h2>
            {lead && <p className="sampark-dossier-summary">{lead}</p>}
            {points.length ? <ul className="sampark-dossier-points">{points.slice(0,5).map((p,i)=><li key={i}>{p}</li>)}</ul> : null}
            {sourceLink ? <a className="sampark-dossier-link" href={sourceLink} rel="noreferrer" target="_blank">Open original source <Icon name="external" size={14} /></a> : null}
            {whyMatters ? <div className="sampark-dossier-insight"><strong>Why this matters</strong><p>{whyMatters}</p></div> : null}
          </div>
        </div>
        <footer className="sampark-dossier-actions">
          <button className={`sampark-action-btn${reactions.viewer_reaction==='like'?' is-active':''}`} onClick={()=>onReact(item,'like')} type="button"><Icon name="thumbsUp" size={16} /> {reactions.like_count||0} Like</button>
          <button className={`sampark-action-btn${reactions.viewer_reaction==='dislike'?' is-active':''}`} onClick={()=>onReact(item,'dislike')} type="button"><Icon name="thumbsDown" size={16} /> {reactions.dislike_count||0}</button>
          <button className={`sampark-action-btn${saved?' is-active':''}`} onClick={()=>onSave(item)} type="button"><Icon name={saved?'check':'bookmark'} size={16} /> {saved?'Following':'Follow'}</button>
          <button className="sampark-action-btn" onClick={()=>onHide(item)} type="button"><Icon name="eye" size={16} /> Hide</button>
          <span className="sampark-dossier-spacer" />
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

function uniqueSorted(values){ return [...new Set(values.filter(Boolean))].sort((a,b)=> String(a).localeCompare(String(b))); }

function NewsTile({ item, vote, saved, disabled, onOpen, onVote, onSave, onHide }){
  const image = imageOf(item);
  const reactions = vote || item.reactions || {};
  return (
    <article className="latest-news-card">
      <button aria-label={`Open dossier for ${item.title}`} className="lnc-image" onClick={()=>onOpen(item)} style={image ? { backgroundImage: `url("${image}")` } : undefined} type="button">{!image && <Icon name="globe" size={30} />}</button>
      <div className="lnc-tags">{item.source_count || 1} Source{(item.source_count||1)===1?'':'s'} | {item.region || 'Global'} | {item.category || 'News'}</div>
      <button className="lnc-title" onClick={()=>onOpen(item)} type="button">{item.title}</button>
      <div className="sampark-card-actions" style={{padding:'8px 12px 12px'}}>
        <button aria-label={`Like ${item.title}`} className={`sampark-card-action${reactions.viewer_reaction==='like'?' is-active':''}`} disabled={disabled} onClick={()=>onVote(item, reactions.viewer_reaction==='like'?'neutral':'like')} type="button"><Icon name="thumbsUp" size={14} /><span>{reactions.like_count||0}</span></button>
        <button aria-label={`Dislike ${item.title}`} className={`sampark-card-action${reactions.viewer_reaction==='dislike'?' is-active':''}`} disabled={disabled} onClick={()=>onVote(item, reactions.viewer_reaction==='dislike'?'neutral':'dislike')} type="button"><Icon name="thumbsDown" size={14} /></button>
        <button aria-label={`${saved?'Unfollow':'Follow'} ${item.title}`} className={`sampark-card-action${saved?' is-active':''}`} disabled={disabled} onClick={()=>onSave(item)} type="button"><Icon name={saved?'check':'bookmark'} size={14} /></button>
        <button aria-label={`Hide ${item.title}`} className="sampark-card-action" disabled={disabled} onClick={()=>onHide(item)} type="button"><Icon name="eye" size={14} /></button>
      </div>
    </article>
  );
}

function FeaturedCarousel({ items, getActions, onOpen }){
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(()=>{ if(paused || items.length<2) return undefined; const t=window.setTimeout(()=> setIndex(v=> (v+1)%items.length), 7000); return ()=> window.clearTimeout(t); }, [index, items.length, paused]);
  useEffect(()=>{ if(index>=items.length) setIndex(0); }, [index, items.length]);
  const item = items[index];
  if(!item) return <div className="featured-carousel sampark-empty">No featured news matches these filters.</div>;
  const image = imageOf(item);
  const actions = getActions(item);
  return (
    <section aria-label="Featured news" className="featured-carousel" onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)}>
      <div className="carousel-slides" style={image ? { backgroundImage: `url("${image}")`, backgroundSize:'cover', backgroundPosition:'center' } : undefined}>
        {!image && <div style={{display:'grid',placeItems:'center',height:'100%',color:'rgba(255,255,255,.6)'}}><Icon name="globe" size={48} /></div>}
        <div className="slide-overlay">
          <span className="slide-source">{item.src || item.source || 'TechScout'} · {item.date || 'Latest'} · Score {scoreOf(item)}</span>
          <button className="featured-story-title" onClick={()=>actions.onOpen(item)} type="button" style={{background:'transparent',textAlign:'left',padding:0}}><h3>{item.title}</h3></button>
          <div className="slide-actions">
            <button className={`action-btn${actions.vote?.viewer_reaction==='like'?' active':''}`} disabled={actions.disabled} onClick={()=>actions.onVote(item, 'like')} type="button"><Icon name="thumbsUp" size={14} /> {actions.vote?.like_count||0}</button>
            <button className={`action-btn${actions.vote?.viewer_reaction==='dislike'?' active':''}`} disabled={actions.disabled} onClick={()=>actions.onVote(item,'dislike')} type="button"><Icon name="thumbsDown" size={14} /></button>
            <button className={`action-btn${actions.saved?' active':''}`} disabled={actions.disabled} onClick={()=>actions.onSave(item)} type="button"><Icon name={actions.saved?'check':'bookmark'} size={14} /></button>
            <button className="action-btn" disabled={actions.disabled} onClick={()=>actions.onHide(item)} type="button"><Icon name="eye" size={14} /></button>
            <button className="action-btn" onClick={()=>onOpen(item)} type="button"><Icon name="file" size={14} /> Open</button>
          </div>
        </div>
      </div>
      {items.length>1 && <>
        <button aria-label="Previous featured story" className="carousel-arrow prev" onClick={()=> setIndex(v=> (v+items.length-1)%items.length)} type="button"><Icon name="chevL" size={17} /></button>
        <button aria-label="Next featured story" className="carousel-arrow next" onClick={()=> setIndex(v=> (v+1)%items.length)} type="button"><Icon name="chevR" size={17} /></button>
        <div className="carousel-dots" role="tablist" aria-label="Featured stories">{items.map((slide,i)=> <button key={articleKey(slide)||i} aria-label={`Show featured story ${i+1}`} aria-selected={i===index} className={`dot${i===index?' active':''}`} onClick={()=>setIndex(i)} role="tab" type="button" />)}</div>
      </>}
    </section>
  );
}

export default function SamparkAllNews(){
  const [articles, setArticles] = useState([]);
  const [published, setPublished] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [filters, setFilters] = useState(emptyFilters);
  const [votes, setVotes] = useState({});
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [busy, setBusy] = useState({});
  const [openArticle, setOpenArticle] = useState(null);
  const [notice, setNotice] = useState('');
  const [visibleCount, setVisibleCount] = useState(24);
  const latestRef = useRef(null);
  const locks = useRef(new Set());

  const load = useCallback(async()=>{
    setLoading(true); setError('');
    try{
      const data = await getSharedBriefing().catch(()=> getLatestBriefing());
      const raw = data?.result || data?.results || data?.articles || data || [];
      const normalized = normalizeList(raw).map(it=> ({...it, image_url: imageOf(it)}));
      setArticles(normalized);
      try{
        const pub = await getPublishedInternalContent();
        if(Array.isArray(pub) && pub.length) setPublished(pub[0]); else setPublished(null);
      }catch{ setPublished(null); }
    }catch(e){ setError(e?.message||'Could not load briefing.'); }
    finally{ setLoading(false); }
  },[retryKey]);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{
    let cancelled=false;
    getViewerSaved().then(r=>{
      if(cancelled) return;
      setSavedKeys(new Set(normalizeList(r?.items||[]).map(articleKey)));
    }).catch(()=>{});
    return ()=>{ cancelled=true; };
  },[retryKey]);

  const reactionSig = useMemo(()=> articles.map(reactionIdentity).filter(Boolean).join('|'), [articles]);
  useEffect(()=>{
    if(!reactionSig) return undefined;
    let cancelled=false;
    const sync=async()=>{
      if(document.visibilityState!=='visible') return;
      try{
        const res=await getViewerReactions(reactionSig.split('|'));
        if(cancelled) return;
        const snaps=res?.reactions||{};
        setVotes(prev=>{
          const n={...prev};
          articles.forEach(it=>{
            const s=snaps[reactionIdentity(it)];
            if(s) n[articleKey(it)]=s;
          });
          return n;
        });
        setOpenArticle(cur=> cur && snaps[reactionIdentity(cur)] ? {...cur, reactions: snaps[reactionIdentity(cur)]} : cur);
      }catch{}
    };
    sync();
    const iv=window.setInterval(sync,12000);
    window.addEventListener('focus', sync);
    return ()=>{ window.clearInterval(iv); window.removeEventListener('focus', sync); };
  },[articles, reactionSig]);

  const options = useMemo(()=>{
    const regs = uniqueSorted(articles.map(a=>a.region));
    const cats = uniqueSorted(articles.map(a=>a.category));
    const srcs = uniqueSorted(articles.map(a=>a.src || a.source));
    const dates = uniqueSorted(articles.map(a=>a.date)).reverse();
    return { regions: regs, categories: cats, sources: srcs, dates };
  },[articles]);

  // apply filters like original briefingFilters
  const filtered = useMemo(()=>{
    // published hero insertion when no filter
    const base = articles.filter(it=>{
      if(filters.region!=='all' && it.region!==filters.region) return false;
      if(filters.category!=='all' && it.category!==filters.category) return false;
      if(filters.source!=='all' && (it.src||it.source)!==filters.source) return false;
      if(filters.date!=='all' && it.date!==filters.date) return false;
      if(filters.query && !`${it.title} ${it.summary||''}`.toLowerCase().includes(filters.query.toLowerCase())) return false;
      // extended filters default all, so ignore
      return true;
    });
    // if published and no filter except all, prepend
    const isDefault = filters.region==='all' && filters.category==='all' && filters.source==='all' && filters.date==='all' && !filters.query;
    if(published && isDefault){
      const pubAs = {
        title: published.title,
        summary: published.summary || published.body || '',
        category: published.category || 'Internal',
        region: 'Internal',
        source: published.author || published.ownerName || 'Samsung Internal',
        src: published.author || 'Samsung Internal',
        date: published.publishedAt ? String(published.publishedAt).slice(0,10) : 'Latest',
        source_count: 1,
        image_url: published.cover?.url || '',
        top_image: published.cover?.url || '',
        link: '',
        _published:true,
      };
      if(!base.some(b=>b.title===pubAs.title)) return [pubAs, ...base];
    }
    return base;
  },[articles, filters, published]);

  const hero = useMemo(()=> filtered.slice(0,5), [filtered]);
  const latest = useMemo(()=> filtered.slice(5,17), [filtered]);
  const stream = useMemo(()=> filtered.slice(0,8), [filtered]);
  const visibleFiltered = useMemo(()=> filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleCount;

  const runAction = async(key, work)=>{
    if(locks.current.has(key)) return;
    locks.current.add(key);
    setBusy(c=>({...c,[key]:true}));
    try{ return await work(); } finally{ locks.current.delete(key); setBusy(c=>{const n={...c}; delete n[key]; return n;});}
  };

  const handleSave = (item)=>{
    if(item._published) { setNotice('Internal story — already published.'); return; }
    const key=articleKey(item);
    return runAction(key, async()=>{
      const saved=savedKeys.has(key);
      if(saved) await removeSavedArticle(item); else await saveArticleForLater(item);
      setSavedKeys(cur=>{ const n=new Set(cur); if(saved) n.delete(key); else n.add(key); return n; });
      setNotice(saved?'Removed from followed.':'Following privately.');
    });
  };
  const handleHide = (item)=>{
    if(item._published) { setNotice('Published internal content cannot be hidden.'); return; }
    const key=articleKey(item);
    return runAction(key, async()=>{
      await hideArticleForViewer(item);
      setArticles(cur=> cur.filter(it=> articleKey(it)!==key));
      setNotice('Hidden from your feed.');
    });
  };
  const handleVote = (item, reaction)=>{
    if(item._published) { setNotice('Reactions are for briefing signals.'); return; }
    const key=articleKey(item);
    return runAction(key, async()=>{
      const cur = votes[key]?.viewer_reaction || item.reactions?.viewer_reaction || 'neutral';
      const next = cur===reaction ? 'neutral' : reaction;
      const resp = await setViewerReaction(item, next);
      const snap={ like_count:resp.like_count, dislike_count:resp.dislike_count, viewer_reaction:resp.viewer_reaction };
      setVotes(prev=> ({...prev, [key]: snap}));
      setOpenArticle(cur=> cur && articleKey(cur)===key ? {...cur, reactions:snap} : cur);
      setNotice(next==='neutral'?'Reaction removed.':`Your ${next} was counted.`);
    });
  };

  const update = (key, value)=> {
    setFilters(cur=> ({...cur, [key]: value}));
    setVisibleCount(24);
  };

  if(loading) return <div className="sampark-all-news"><div className="sampark-all-news-loading" role="status"><span className="sampark-spinner" /> Loading All News briefing…</div></div>;
  if(error) return <div className="sampark-all-news"><div className="sampark-all-news-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="btn-primary" onClick={()=>setRetryKey(k=>k+1)} type="button">Retry</button></div></div>;

  const categories = ['all', ...options.categories.slice(0,5)];
  const common = (item)=> ({ vote: votes[articleKey(item)] || item.reactions, saved: savedKeys.has(articleKey(item)), disabled: Boolean(busy[articleKey(item)]), onOpen:setOpenArticle, onVote:handleVote, onSave:handleSave, onHide:handleHide });

  return (
    <div className="tab-content active sampark-all-news">
      {notice && <div className="sampark-for-you-feedback" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice('')} type="button"><Icon name="x" size={14} /></button></div>}
      <nav aria-label="News categories" className="category-filters">
        {categories.map(cat=> <button key={cat} className={`cat-filter${filters.category===cat ? ' active' : ''}`} onClick={()=>update('category', cat)} type="button">{cat==='all'?'All':cat}</button>)}
      </nav>

      <div className="news-layout">
        <div className="carousel-news-container">
          <FeaturedCarousel items={hero} getActions={common} onOpen={setOpenArticle} />
          <aside className="live-news-sidebar">
            <h3 className="sidebar-title">Briefing Stream</h3>
            <div className="live-news-list">
              {stream.map(item=>(
                <button key={articleKey(item)} className="live-news-item" onClick={()=>setOpenArticle(item)} type="button">
                  <span className="ln-category ai">{item.category || 'Technology'}</span>
                  <p className="ln-headline">{item.title}</p>
                  <span className="ln-meta">{item.src || item.source} | {item.date} | Score {item.importance_score || scoreOf(item)}</span>
                </button>
              ))}
              {!stream.length && <p style={{color:'var(--text-light)',fontSize:13}}>The briefing stream will populate after the next scheduler run.</p>}
            </div>
          </aside>
        </div>

        <section className="latest-news-section">
          <div className="latest-news-header">
            <h3>Latest News | {articles[0]?.date || 'Latest'} <span className="news-count">({filtered.length} News)</span></h3>
            <div className="scroll-controls">
              <button aria-label="Scroll latest news left" onClick={()=> latestRef.current?.scrollBy({left:-383, behavior:'smooth'})} type="button"><Icon name="chevL" size={15} /></button>
              <button aria-label="Scroll latest news right" onClick={()=> latestRef.current?.scrollBy({left:383, behavior:'smooth'})} type="button"><Icon name="chevR" size={15} /></button>
            </div>
          </div>
          {latest.length ? (
            <div className="latest-news-scroll" ref={latestRef}>
              {latest.map(item=> <NewsTile key={articleKey(item)} item={item} {...common(item)} />)}
            </div>
          ) : <p className="sampark-empty" style={{padding:12}}>No latest stories for this filter.</p>}
        </section>

        <section className="filter-view-section">
          <div className="filter-view-header"><h3>Apply Filter & Customize View</h3></div>
          <div className="filter-bar">
            <label className="filter-dropdown">Region<select className="filter-select" aria-label="Region" value={filters.region} onChange={e=>update('region', e.target.value)}><option value="all">All Regions</option>{options.regions.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
            <label className="filter-dropdown">Category<select className="filter-select" aria-label="Category" value={filters.category} onChange={e=>update('category', e.target.value)}><option value="all">All Categories</option>{options.categories.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
            <label className="filter-dropdown">Source<select className="filter-select" aria-label="Source" value={filters.source} onChange={e=>update('source', e.target.value)}><option value="all">All Sources</option>{options.sources.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
            <label className="filter-dropdown">Date<select className="filter-select" aria-label="Date" value={filters.date} onChange={e=>update('date', e.target.value)}><option value="all">All Dates</option>{options.dates.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
            <button className="filter-reset-btn" onClick={()=>{ setFilters({...emptyFilters}); setVisibleCount(24); }} type="button"><Icon name="refresh" size={14} /> Reset</button>
          </div>
          <div className="latest-news-header"><h3>News <span className="news-count">({filtered.length} News)</span></h3></div>
          {filtered.length ? (
            <>
              <div className="filtered-news-grid">
                {visibleFiltered.map(item=> <NewsTile key={articleKey(item)} item={item} {...common(item)} />)}
              </div>
              {hasMore && <div style={{display:'flex',gap:12,alignItems:'center',marginTop:14}}><button className="btn-primary" onClick={()=>setVisibleCount(c=>c+24)} type="button">Load more · {filtered.length-visibleCount} remaining</button><span style={{color:'var(--text-light)',fontSize:13}}>{visibleCount} of {filtered.length} shown</span></div>}
              {!hasMore && filtered.length>24 && <p style={{color:'var(--text-light)',fontSize:12,textAlign:'center',marginTop:12}}>You have reached the end of this briefing.</p>}
            </>
          ) : <p className="sampark-empty">No news matches these filters.</p>}
        </section>
      </div>

      <SamparkAllNewsDossier item={openArticle} onClose={()=>setOpenArticle(null)} onHide={async it=>{ setOpenArticle(null); await handleHide(it); }} onReact={handleVote} onSave={handleSave} saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} />
    </div>
  );
}
