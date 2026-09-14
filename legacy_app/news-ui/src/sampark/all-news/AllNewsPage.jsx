import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { articleKey, reactionIdentity, matchesBriefingLens } from '../../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import {
  getViewerReactions,
  getViewerHidden,
  getViewerSaved,
  getWorkflow,
  hideArticleForViewer,
  removeSavedArticle,
  saveArticleForLater,
  selectWorkflow,
  setViewerReaction,
  trackEvent,
} from '../../news-scrapper/api.js';
import ArticleModal from '../../news-scrapper/components/modals/ArticleModal.jsx';
import DraftExportModal from '../../news-scrapper/components/modals/DraftExportModal.jsx';
import NameModal from '../../news-scrapper/components/modals/NameModal.jsx';
import { useArticleEngagement } from '../shared/useArticleEngagement.js';
import { computeOptimisticVote, getCurrentVote } from '../shared/reactionHelper.js';
import useAutoDismiss from '../shared/useAutoDismiss.js';
import { createSavedHydrationController, createReactionHydrationController } from './allNewsHydration.js';
import useBriefingFeed from './data/useBriefingFeed.js';
import { deriveFilterOptions, selectFeatured, selectAllNewsRail, selectLatestToday } from './allNewsModel.js';
import CategoryTabs from './CategoryTabs.jsx';
import FeaturedCarousel from './FeaturedCarousel.jsx';
import AllNewsRail from './AllNewsRail.jsx';
import LatestNews from './LatestNews.jsx';
import FilterPanel from './FilterPanel.jsx';
import DayWiseNews from './DayWiseNews.jsx';
import './all-news.css';

function AllNewsDossier({ item, onClose, saved, onSave, onHide, onReact, savedHydrated, reactionsHydrated }){
  const engagement = useArticleEngagement(item || {}, { surface: 'shared_briefing' });
  const handleClose = () => { engagement.onDossierClose(); onClose(); };
  const articleId = item ? articleKey(item) : '';
  useEffect(()=>{ if(item && articleId) engagement.onDossierOpen(item); }, [articleId]);
  // Hook owns unmount cleanup; do not depend on engagement object
  if(!item) return null;
  const handleHideClick = () => { engagement.onDossierClose(); onHide(item); };
  return (
    <ArticleModal
      item={item}
      variant="all-briefings"
      onClose={handleClose}
      isSaved={saved}
      onSave={savedHydrated ? onSave : undefined}
      onHide={handleHideClick}
      onVote={reactionsHydrated ? onReact : undefined}
      onSourceOpen={() => engagement.onSourceOpen()}
    />
  );
}

export default function AllNewsPage({ capabilities=[] }){
  const { articles, loading, error, retry } = useBriefingFeed();
  const reviewAllowed = capabilities.includes('review.news.submit');
  const [activeLens, setActiveLens] = useState('all');
  const [draftFilters, setDraftFilters] = useState({ region:'all', category:'all', source:'all', date:'all' });
  const [appliedFilters, setAppliedFilters] = useState({ region:'all', category:'all', source:'all', date:'all' });
  const [openArticle, setOpenArticle] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [savedHydrated, setSavedHydrated] = useState(false);
  const [votes, setVotes] = useState({});
  const [reactionsHydrated, setReactionsHydrated] = useState(false);
  const [busy, setBusy] = useState({});
  const [hiddenKeys, setHiddenKeys] = useState(new Set());
  const [notice, setNotice] = useState('');
  const [workflow, setWorkflow] = useState({ selected: [], approved: [] });
  const [workflowStatus, setWorkflowStatus] = useState(reviewAllowed ? 'loading' : 'hidden');
  const [checked, setChecked] = useState({});
  const [pendingSelect, setPendingSelect] = useState(null);
  const [batchSelect, setBatchSelect] = useState(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [draftExportOpen, setDraftExportOpen] = useState(false);
  const locks = useRef(new Set());

  useAutoDismiss(notice, () => setNotice(''));

  useEffect(()=>{
    if(!reviewAllowed){
      setWorkflow({ selected: [], approved: [] });
      setWorkflowStatus('hidden');
      setChecked({});
      setPendingSelect(null);
      setBatchSelect(null);
      setDraftExportOpen(false);
      return undefined;
    }
    let cancelled = false;
    setWorkflowStatus('loading');
    getWorkflow().then((result)=>{
      if(cancelled) return;
      setWorkflow({
        selected: normalizeList(result?.selected || []),
        approved: normalizeList(result?.approved || []),
      });
      setWorkflowStatus('ready');
    }).catch(()=>{
      if(!cancelled) setWorkflowStatus('error');
    });
    return ()=>{ cancelled = true; };
  },[reviewAllowed]);

  useEffect(() => {
    let cancelled = false;
    getViewerHidden()
      .then((result) => {
        if (!cancelled) setHiddenKeys(new Set(normalizeList(result?.items || []).map(articleKey)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  const selectedIds = useMemo(()=> new Set(workflow.selected.map(articleKey).filter(Boolean)), [workflow.selected]);
  const approvedIds = useMemo(()=> new Set(workflow.approved.map(articleKey).filter(Boolean)), [workflow.approved]);
  const selectedBatch = useMemo(()=> articles.filter((item)=> checked[articleKey(item)]), [articles, checked]);

  const [savedError, setSavedError] = useState('');
  const [savedLoading, setSavedLoading] = useState(false);
  // Production hydration controllers (also exercised by behavioral tests).
  const savedControllerRef = useRef(null);
  if (!savedControllerRef.current) {
    savedControllerRef.current = createSavedHydrationController({ loadFn: () => getViewerSaved() });
  }
  const reactionControllerRef = useRef(null);
  if (!reactionControllerRef.current) {
    reactionControllerRef.current = createReactionHydrationController({ fetchFn: (ids) => getViewerReactions(ids) });
  }
  // Refs hold latest hydrated state so focus listeners do not need
  // savedHydrated/reactionsHydrated in effect deps (avoids duplicate requests).
  const savedHydratedRef = useRef(false);
  useEffect(() => { savedHydratedRef.current = savedHydrated; }, [savedHydrated]);
  const savedMountedRef = useRef(true);
  useEffect(() => {
    savedMountedRef.current = true;
    return () => { savedMountedRef.current = false; };
  }, []);
  const loadSaved = useCallback(async ()=>{
    const ctrl = savedControllerRef.current;
    // If a hydration request is already pending, reuse it (no overlapping fetch).
    if (ctrl.isLoading()) {
      try { await ctrl.load(); } catch {}
      if (savedMountedRef.current) setSavedLoading(ctrl.isLoading());
      return;
    }
    setSavedLoading(true);
    setSavedError('');
    try {
      // Single request per call via controller (tracks count/stale for tests).
      const r = await ctrl.load();
      if (!savedMountedRef.current) return;
      if (!r) return; // stale/disposed: do not overwrite newer results
      setSavedKeys(new Set(normalizeList(r?.items||[]).map(articleKey)));
      setSavedHydrated(true);
    } catch(e){
      if (!savedMountedRef.current) return;
      // Controller throws only for the latest failure (stale returns undefined).
      setSavedError(e?.message || ctrl.getError() || 'Saved status unavailable');
      setSavedHydrated(false);
    } finally {
      if (savedMountedRef.current) setSavedLoading(ctrl.isLoading());
    }
  }, []);
  useEffect(()=>{
    // Initial mount performs exactly one saved-status request; success does
    // not retrigger (no savedHydrated dep). Focus/visibility retries only
    // while saved status is unavailable via ref.
    loadSaved();
    const retryOnFocus = ()=>{
      if (document.visibilityState !== 'visible') return;
      if (!savedHydratedRef.current && savedControllerRef.current.shouldRetryOnFocus()) loadSaved();
    };
    window.addEventListener('focus', retryOnFocus);
    document.addEventListener('visibilitychange', retryOnFocus);
    return ()=>{ window.removeEventListener('focus', retryOnFocus); document.removeEventListener('visibilitychange', retryOnFocus); };
  },[loadSaved]);

  // Initialize reaction state from trustworthy item.reactions immediately
  useEffect(()=>{
    setVotes(prev=>{
      const next = { ...prev };
      let changed = false;
      for (const it of articles) {
        const k = articleKey(it);
        if (!k || next[k]) continue;
        const r = it.reactions;
        if (r && (r.viewer_reaction !== undefined || r.like_count !== undefined || r.dislike_count !== undefined)) {
          next[k] = {
            like_count: Number(r.like_count || 0),
            dislike_count: Number(r.dislike_count || 0),
            viewer_reaction: r.viewer_reaction || 'neutral',
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [articles]);

  const [reactionsError, setReactionsError] = useState('');
  const [reactionsLoading, setReactionsLoading] = useState(false);
  const reactionSig = useMemo(()=> articles.map(reactionIdentity).filter(Boolean).join('|'), [articles]);
  const reactionsHydratedRef = useRef(false);
  useEffect(() => { reactionsHydratedRef.current = reactionsHydrated; }, [reactionsHydrated]);
  const reactionMountedRef = useRef(true);
  useEffect(() => {
    reactionMountedRef.current = true;
    return () => { reactionMountedRef.current = false; };
  }, []);
  // Stable reaction sync usable by initial load, Retry, focus, and interval.
  // Retry starts one request immediately and exposes loading; stale earlier
  // responses never overwrite newer state. Loading mirrors the controller's
  // authoritative value so an older completion cannot clear a newer pending
  // request.
  const syncReactions = useCallback(async ()=>{
    if(!reactionSig) return;
    if(typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const ctrl = reactionControllerRef.current;
    const ids = reactionSig.split('|');
    if (reactionMountedRef.current) setReactionsLoading(true);
    try {
      const res = await ctrl.sync(ids);
      if (!reactionMountedRef.current) return;
      if (!res) {
        // Stale (older sig superseded): refresh loading from controller, do not
        // touch votes/errors/hydrated.
        if (reactionMountedRef.current) setReactionsLoading(ctrl.isLoading());
        return;
      }
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
      setReactionsHydrated(true);
      setReactionsError('');
    }catch(e){
      if (!reactionMountedRef.current) return;
      // Controller throws only for latest failure; stale returns undefined.
      setReactionsError(e?.message || ctrl.getError() || 'Reactions unavailable');
    }finally{
      if (reactionMountedRef.current) setReactionsLoading(ctrl.isLoading());
    }
  },[articles, reactionSig]);
  useEffect(()=>{
    if(!reactionSig) return undefined;
    syncReactions();
    const iv=window.setInterval(syncReactions,12000);
    window.addEventListener('focus', syncReactions);
    return ()=>{ window.clearInterval(iv); window.removeEventListener('focus', syncReactions); };
  },[syncReactions, reactionSig]);

  const runAction = async(articleKeyValue, action, work)=>{
    const lockKey = `${articleKeyValue}::${action}`;
    if(locks.current.has(lockKey)) return;
    locks.current.add(lockKey);
    setBusy(c=> ({...c, [lockKey]:true}));
    try{ return await work(); } finally{ locks.current.delete(lockKey); setBusy(c=>{const n={...c}; delete n[lockKey]; return n;});}
  };
  const isPending = (item, action) => {
    const k = articleKey(item);
    return Boolean(busy[`${k}::${action}`]);
  };

  const handleSave = (item)=>{
    if(item._published) return;
    const key=articleKey(item);
    if(locks.current.has(`${key}::save`)) return;
    if (!savedHydrated) {
      setNotice('Follow status still loading — please wait.');
      return;
    }
    const wasSaved=savedKeys.has(key);
    // optimistic immediate update
    setSavedKeys(cur=>{ const n=new Set(cur); if(wasSaved) n.delete(key); else n.add(key); return n; });
    setNotice(wasSaved?'Removed from followed.':'Following privately.');
    return runAction(key, 'save', async()=>{
      try{
        const resp = wasSaved ? await removeSavedArticle(item) : await saveArticleForLater(item);
        return resp;
      }catch(e){
        // rollback on failure
        setSavedKeys(cur=>{ const n=new Set(cur); if(wasSaved) n.add(key); else n.delete(key); return n; });
        setNotice(e?.message || 'Follow action failed');
        throw e;
      }
    });
  };
  const handleHide = (item)=>{
    if(item._published) return;
    const key=articleKey(item);
    if(locks.current.has(`${key}::hide`)) return;
    // optimistic hide
    setHiddenKeys(cur=>{ const n=new Set(cur); n.add(key); return n; });
    setNotice('Hidden from your feed.');
    return runAction(key, 'hide', async()=>{
      try{ await hideArticleForViewer(item); }
      catch(e){
        setHiddenKeys(cur=>{ const n=new Set(cur); n.delete(key); return n; });
        setNotice(e?.message || 'Hide failed');
        throw e;
      }
    });
  };
  const handleVote = (item, reaction)=>{
    if(item._published) return;
    const key=articleKey(item);
    if(locks.current.has(`${key}::reaction`)) return;
    const currentSnap = votes[key] || getCurrentVote(votes, item, reactionsHydrated) || (item.reactions ? { like_count: item.reactions.like_count||0, dislike_count: item.reactions.dislike_count||0, viewer_reaction: item.reactions.viewer_reaction||'neutral' } : null);
    if (!currentSnap && !reactionsHydrated) {
      setNotice('Reaction status still loading — please wait.');
      return;
    }
    const cur = currentSnap?.viewer_reaction || 'neutral';
    const next = cur===reaction ? 'neutral' : reaction;
    const prevSnap = currentSnap || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
    const optimistic = computeOptimisticVote(prevSnap, cur, next);
    setVotes(prev=> ({...prev, [key]:optimistic}));
    setOpenArticle(cur=> cur && articleKey(cur)===key ? {...cur, reactions:optimistic}:cur);
    return runAction(key, 'reaction', async()=>{
      try{
        const resp=await setViewerReaction(item, next);
        const snap={ like_count:resp.like_count, dislike_count:resp.dislike_count, viewer_reaction:resp.viewer_reaction };
        setVotes(prev=> ({...prev, [key]:snap}));
        setOpenArticle(cur=> cur && articleKey(cur)===key ? {...cur, reactions:snap}:cur);
      }catch(e){
        // rollback
        setVotes(prev=> ({...prev, [key]:prevSnap}));
        setOpenArticle(cur=> cur && articleKey(cur)===key ? {...cur, reactions:prevSnap}:cur);
        setNotice(e?.message || 'Reaction failed');
        throw e;
      }
    });
  };

  const handleReviewCheck = (item, isChecked)=>{
    if(!reviewAllowed || workflowStatus !== 'ready') return;
    const key = articleKey(item);
    if(!key || selectedIds.has(key) || approvedIds.has(key)) return;
    setChecked((current)=>{
      const next = { ...current };
      if(isChecked) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const requestReviewSubmission = (item)=>{
    if(!reviewAllowed) return;
    if(workflowStatus !== 'ready'){
      setNotice(workflowStatus === 'error' ? 'Review Queue is unavailable right now.' : 'Review Queue is still loading.');
      return;
    }
    const key = articleKey(item);
    if(selectedIds.has(key) || approvedIds.has(key)) return;
    setPendingSelect(item);
  };

  const confirmReviewSubmission = async(item, name)=>{
    if(workflowStatus !== 'ready') throw new Error('Review Queue is unavailable right now.');
    const key = articleKey(item);
    const payload = {
      ...item,
      selected_by: name,
      selected_at: new Date().toISOString().slice(0,16).replace('T',' '),
    };
    return runAction(key, 'review', async()=>{
      try{
        await selectWorkflow(payload);
        setWorkflow((current)=>({
          ...current,
          selected: [payload, ...current.selected.filter((entry)=>articleKey(entry)!==key)],
        }));
        setChecked((current)=>{ const next={...current}; delete next[key]; return next; });
        setNotice('Article sent to the shared Review Queue.');
      }catch(reviewError){
        setNotice(reviewError?.message || 'The article could not be sent to Review Queue.');
        throw reviewError;
      }
    });
  };

  const confirmBatchSubmission = async(_item, name)=>{
    if(batchBusy || !selectedBatch.length) return;
    if(workflowStatus !== 'ready') throw new Error('Review Queue is unavailable right now.');
    setBatchBusy(true);
    const stamp = new Date().toISOString().slice(0,16).replace('T',' ');
    const payloads = selectedBatch.map((item)=>({ ...item, selected_by:name, selected_at:stamp }));
    try{
      const results = await Promise.allSettled(payloads.map((payload)=>selectWorkflow(payload)));
      const succeeded = payloads.filter((_,index)=>results[index].status==='fulfilled');
      const failed = payloads.filter((_,index)=>results[index].status==='rejected');
      if(succeeded.length){
        const succeededKeys = new Set(succeeded.map(articleKey));
        setWorkflow((current)=>({
          ...current,
          selected: [...succeeded, ...current.selected.filter((entry)=>!succeededKeys.has(articleKey(entry)))],
        }));
        setChecked((current)=>{
          const next={...current};
          succeededKeys.forEach((key)=>{ delete next[key]; });
          return next;
        });
      }
      if(failed.length){
        const batchError = new Error(`${failed.length} of ${payloads.length} articles could not be sent. Failed articles remain selected so you can retry.`);
        setNotice(batchError.message);
        throw batchError;
      }
      setBatchSelect(null);
      setNotice(`${succeeded.length} article${succeeded.length===1?'':'s'} sent to the shared Review Queue.`);
    }finally{
      setBatchBusy(false);
    }
  };

  const handleApply = ()=> setAppliedFilters({...draftFilters});
  const handleReset = ()=>{
    setDraftFilters({ region:'all', category:'all', source:'all', date:'all'});
    setAppliedFilters({ region:'all', category:'all', source:'all', date:'all'});
    setActiveLens('all');
  };

  // Direct source opens from cards: record source_open without blocking navigation.
  const handleCardSourceOpen = useCallback((item)=>{
    try { trackEvent(undefined, 'source_open', item); } catch {}
  }, []);

  if(loading) return <div className="tsan-page"><div className="tsan-loading" role="status"><span className="sampark-spinner" /> Loading All News briefing…</div></div>;
  if(error) return <div className="tsan-page"><div className="tsan-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="tsan-filter-apply" onClick={retry} type="button">Retry</button></div></div>;

  return (
    <div className="tsan-page">
      {notice && <div className="sampark-for-you-feedback" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={()=>setNotice('')} type="button"><Icon name="x" size={14} /></button></div>}
      {savedError && !savedHydrated && <div className="sampark-for-you-feedback is-error" role="alert"><span>Follow status unavailable: {savedError}</span> <button onClick={loadSaved} disabled={savedLoading} type="button">{savedLoading ? 'Retrying…' : 'Retry'}</button></div>}
      {reactionsError && !reactionsHydrated && <div className="sampark-for-you-feedback is-error" role="alert"><span>Reactions unavailable: {reactionsError}</span> <button onClick={()=>{ setReactionsError(''); syncReactions(); }} disabled={reactionsLoading} type="button">{reactionsLoading ? 'Retrying…' : 'Retry'}</button></div>}
      <CategoryTabs active={activeLens} onSelect={setActiveLens} />

      <div className="tsan-featured-rail">
        <FeaturedCarousel items={featured} onOpen={setOpenArticle} />
        <AllNewsRail items={railItems} onOpen={setOpenArticle} />
      </div>

      <LatestNews items={latestToday} onOpen={setOpenArticle} onLike={(it)=> handleVote(it,'like')} onDislike={(it)=> handleVote(it,'dislike')} onFollow={handleSave} onHide={handleHide} onSourceOpen={handleCardSourceOpen} votes={votes} savedKeys={savedKeys} busyMap={busy} savedHydrated={savedHydrated} reactionsHydrated={reactionsHydrated} />

      <FilterPanel options={options} draft={draftFilters} setDraft={setDraftFilters} onApply={handleApply} onReset={handleReset} filteredCount={filtered.length} />

      <DayWiseNews grouped={grouped} onOpen={setOpenArticle} onLike={(it)=> handleVote(it,'like')} onDislike={(it)=> handleVote(it,'dislike')} onFollow={handleSave} onHide={handleHide} onSourceOpen={handleCardSourceOpen} votes={votes} savedKeys={savedKeys} busyMap={busy} savedHydrated={savedHydrated} reactionsHydrated={reactionsHydrated} reviewAllowed={reviewAllowed} workflowReady={workflowStatus==='ready'} checkedMap={checked} selectedIds={selectedIds} approvedIds={approvedIds} onCheck={handleReviewCheck} onSubmitForReview={requestReviewSubmission} />

      <AllNewsDossier item={openArticle} onClose={()=>setOpenArticle(null)} saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} onSave={handleSave} onHide={async it=>{ setOpenArticle(null); await handleHide(it); }} onReact={handleVote} savedHydrated={savedHydrated} reactionsHydrated={reactionsHydrated} />
      {reviewAllowed && <NameModal article={pendingSelect} open={Boolean(pendingSelect)} onClose={()=>setPendingSelect(null)} onConfirm={confirmReviewSubmission} />}
      {reviewAllowed && <NameModal article={batchSelect} confirmLabel="Send to Review Queue" description="Enter your name." open={Boolean(batchSelect)} onClose={()=>setBatchSelect(null)} onConfirm={confirmBatchSubmission} title={`Send ${selectedBatch.length} articles to Review Queue`} />}
      <DraftExportModal items={selectedBatch} open={draftExportOpen} source="sampark-all-news" onClose={()=>setDraftExportOpen(false)} />
      {reviewAllowed && selectedBatch.length > 0 && <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        <div className="batch-action-bar flex flex-wrap items-center justify-center gap-3 rounded-full border border-sky-300/20 bg-[#101827]/95 px-5 py-3 text-sm text-slate-200 shadow-cockpit backdrop-blur-xl">
          <strong>{selectedBatch.length} selected</strong>
          <button className="btn-dark-secondary h-9" disabled={batchBusy} onClick={()=>setChecked({})} type="button">Clear</button>
          <button className="btn-dark-primary h-9" disabled={batchBusy} onClick={()=>setBatchSelect({ title:`${selectedBatch.length} selected articles` })} type="button">Send to Review Queue</button>
          <button className="btn-dark-secondary h-9" disabled={batchBusy} onClick={()=>setDraftExportOpen(true)} type="button">Draft Export</button>
        </div>
      </div>}
    </div>
  );
}
