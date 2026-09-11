import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { articleKey, reactionIdentity, matchesBriefingLens } from '../../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import {
  getViewerReactions,
  getViewerSaved,
  hideArticleForViewer,
  removeSavedArticle,
  saveArticleForLater,
  setViewerReaction,
} from '../../news-scrapper/api.js';
import useBriefingFeed from './data/useBriefingFeed.js';
import { deriveFilterOptions, selectFeatured, selectAllNewsRail, selectLatestToday } from './allNewsModel.js';
import CategoryTabs from './CategoryTabs.jsx';
import FeaturedCarousel from './FeaturedCarousel.jsx';
import AllNewsRail from './AllNewsRail.jsx';
import LatestNews from './LatestNews.jsx';
import FilterPanel from './FilterPanel.jsx';
import DayWiseNews from './DayWiseNews.jsx';
import './all-news.css';

function AllNewsDossier({ item, onClose, saved, onSave, onHide, onReact }){
  const ref = useModalFocus(Boolean(item), onClose);
  if(!item) return null;
  const img = item.image_url || item.top_image || '';
  const reactions = item.reactions || { like_count:0, dislike_count:0, viewer_reaction:'neutral'};
  return (
    <div className="sampark-modal-overlay" onMouseDown={e=>{ if(e.target===e.currentTarget) onClose();}}>
      <section ref={ref} role="dialog" aria-modal="true" className="sampark-dossier sampark-dossier--large" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'News'} · {item.src || item.source || 'TechScout'} · {item.date || 'Latest'}</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {img ? <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={img} /></div> : <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>}
          <div className="sampark-dossier-body">
            <h2 className="sampark-dossier-title">{item.title}</h2>
            {item.summary && <p className="sampark-dossier-summary">{item.summary}</p>}
            {item.link && <a className="sampark-dossier-link" href={item.link} target="_blank" rel="noreferrer">Open original source <Icon name="external" size={14} /></a>}
          </div>
        </div>
        <footer className="sampark-dossier-actions">
          <button className={`sampark-action-btn${reactions.viewer_reaction==='like'?' is-active':''}`} onClick={()=> onReact(item,'like')} type="button"><Icon name="thumbsUp" size={16} /> {reactions.like_count||0}</button>
          <button className={`sampark-action-btn${reactions.viewer_reaction==='dislike'?' is-active':''}`} onClick={()=> onReact(item,'dislike')} type="button"><Icon name="thumbsDown" size={16} /></button>
          <button className={`sampark-action-btn${saved?' is-active':''}`} onClick={()=> onSave(item)} type="button"><Icon name={saved?'check':'bookmark'} size={16} /> {saved?'Following':'Follow'}</button>
          <button className="sampark-action-btn" onClick={()=> onHide(item)} type="button"><Icon name="eye" size={16} /> Hide</button>
          <span className="sampark-dossier-spacer" />
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

export default function AllNewsPage(){
  const { articles, loading, error, retry } = useBriefingFeed();
  const [activeLens, setActiveLens] = useState('all');
  const [draftFilters, setDraftFilters] = useState({ region:'all', category:'all', source:'all', date:'all' });
  const [appliedFilters, setAppliedFilters] = useState({ region:'all', category:'all', source:'all', date:'all' });
  const [openArticle, setOpenArticle] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [votes, setVotes] = useState({});
  const [busy, setBusy] = useState({});
  const [hiddenKeys, setHiddenKeys] = useState(new Set());
  const [notice, setNotice] = useState('');
  const locks = useRef(new Set());

  const options = useMemo(()=> deriveFilterOptions(articles), [articles]);

  // single briefing dataset -> filtered by lens + applied filters + hidden (no Samsung Internal merge)
  const filtered = useMemo(()=>{
    return articles.filter(it=> {
      if(!it) return false;
      if(hiddenKeys.has(articleKey(it))) return false;
      if(!matchesBriefingLens(it, activeLens)) return false;
      if(appliedFilters.region!=='all' && it.region!==appliedFilters.region) return false;
      if(appliedFilters.category!=='all' && it.category!==appliedFilters.category) return false;
      if(appliedFilters.source!=='all' && (it.src||it.source)!==appliedFilters.source) return false;
      if(appliedFilters.date!=='all' && it.date!==appliedFilters.date) return false;
      return true;
    });
  },[articles, activeLens, appliedFilters, hiddenKeys]);

  const featured = useMemo(()=> selectFeatured(filtered, 5), [filtered]);
  const railItems = useMemo(()=> selectAllNewsRail(filtered, 10), [filtered]);
  const latestToday = useMemo(()=> selectLatestToday(filtered), [filtered]);

  // day-wise grouped preserving order, sorted by date desc
  const grouped = useMemo(()=>{
    const sorted=[...filtered].sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
    const map=new Map();
    for(const it of sorted){
      const key=String(it.date||'Unknown').slice(0,10);
      if(!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()];
  },[filtered]);

  useEffect(()=>{
    let cancelled=false;
    getViewerSaved().then(r=>{
      if(cancelled) return;
      setSavedKeys(new Set(normalizeList(r?.items||[]).map(articleKey)));
    }).catch(()=>{});
    return ()=>{ cancelled=true; };
  },[]);

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

  const runAction = async(key, work)=>{
    if(locks.current.has(key)) return;
    locks.current.add(key);
    setBusy(c=> ({...c, [key]:true}));
    try{ return await work(); } finally{ locks.current.delete(key); setBusy(c=>{const n={...c}; delete n[key]; return n;});}
  };

  const handleSave = (item)=>{
    if(item._published) return;
    const key=articleKey(item);
    return runAction(key, async()=>{
      const saved=savedKeys.has(key);
      if(saved) await removeSavedArticle(item); else await saveArticleForLater(item);
      setSavedKeys(cur=>{ const n=new Set(cur); if(saved) n.delete(key); else n.add(key); return n; });
      setNotice(saved?'Removed from followed.':'Following privately.');
    });
  };
  const handleHide = (item)=>{
    if(item._published) return;
    const key=articleKey(item);
    return runAction(key, async()=>{
      await hideArticleForViewer(item);
      setHiddenKeys(cur=>{ const n=new Set(cur); n.add(key); return n; });
      setNotice('Hidden from your feed.');
    });
  };
  const handleVote = (item, reaction)=>{
    if(item._published) return;
    const key=articleKey(item);
    return runAction(key, async()=>{
      const cur = votes[key]?.viewer_reaction || 'neutral';
      const next = cur===reaction ? 'neutral' : reaction;
      const resp=await setViewerReaction(item, next);
      const snap={ like_count:resp.like_count, dislike_count:resp.dislike_count, viewer_reaction:resp.viewer_reaction };
      setVotes(prev=> ({...prev, [key]:snap}));
      setOpenArticle(cur=> cur && articleKey(cur)===key ? {...cur, reactions:snap}:cur);
    });
  };

  const handleApply = ()=> setAppliedFilters({...draftFilters});
  const handleReset = ()=>{
    setDraftFilters({ region:'all', category:'all', source:'all', date:'all'});
    setAppliedFilters({ region:'all', category:'all', source:'all', date:'all'});
    setActiveLens('all');
  };

  if(loading) return <div className="tsan-page"><div className="tsan-loading" role="status"><span className="sampark-spinner" /> Loading All News briefing…</div></div>;
  if(error) return <div className="tsan-page"><div className="tsan-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="tsan-filter-apply" onClick={retry} type="button">Retry</button></div></div>;

  return (
    <div className="tsan-page">
      {notice && <div className="sampark-for-you-feedback" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice('')} type="button"><Icon name="x" size={14} /></button></div>}
      <CategoryTabs active={activeLens} onSelect={setActiveLens} />

      <div className="tsan-featured-rail">
        <FeaturedCarousel items={featured} onOpen={setOpenArticle} />
        <AllNewsRail items={railItems} onOpen={setOpenArticle} />
      </div>

      <LatestNews items={latestToday} onOpen={setOpenArticle} />

      <FilterPanel options={options} draft={draftFilters} setDraft={setDraftFilters} onApply={handleApply} onReset={handleReset} />

      <DayWiseNews grouped={grouped} onOpen={setOpenArticle} />

      <AllNewsDossier item={openArticle} onClose={()=>setOpenArticle(null)} saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} onSave={handleSave} onHide={async it=>{ setOpenArticle(null); await handleHide(it); }} onReact={handleVote} />
    </div>
  );
}
