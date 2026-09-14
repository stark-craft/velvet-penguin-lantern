import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getArchiveArticle, getViewerPreferences, searchExtractedIntelligence } from '../news-scrapper/api.js';
import { createSearchRunner } from './searchRunner.js';
import { articleKey, groupedByDate } from '../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import Icon from '../news-scrapper/components/Icon.jsx';
import ArticleModal from '../news-scrapper/components/modals/ArticleModal.jsx';
import { useArticleEngagement } from './shared/useArticleEngagement.js';
import { sanitizeExternalUrl } from './shared/safeLink.js';
import { shouldStartSearch } from './shared/searchHelper.js';

function sourceLink(item) {
  return sanitizeExternalUrl(item?.link || item?.url || '');
}

function normalizeQuery(value) {
  return String(value || '').trim().slice(0, 200);
}

export default function SamparkSearchResults({ query: initialQuery }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const qParam = params.get('q') || initialQuery || '';
  const fromParam = params.get('from') || '';
  const toParam = params.get('to') || '';
  const sourceParam = params.get('source') || '';
  const sortParam = params.get('sort') || 'relevance';

  const [draftQ, setDraftQ] = useState(qParam);
  const [draftFrom, setDraftFrom] = useState(fromParam);
  const [draftTo, setDraftTo] = useState(toParam);
  const [draftSource, setDraftSource] = useState(sourceParam);
  const [draftSort, setDraftSort] = useState(sortParam === 'newest' ? 'newest' : 'relevance');
  const [dateError, setDateError] = useState('');
  const [state, setState] = useState({ items: [], total: 0, loading: false, error: '', has_more: false });
  const [rememberHistory, setRememberHistory] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const hasSearchedRef = useRef(false);
  const runnerRef = useRef(null);
  if (!runnerRef.current) {
    runnerRef.current = createSearchRunner({
      fetchPage: async ({ query, from, to, source, sort }, signal) => {
        const apiSort = sort === 'newest' ? 'date_desc' : 'relevance';
        const response = await searchExtractedIntelligence({ query, from_date: from || undefined, to_date: to || undefined, target_sites: source || undefined, sort: apiSort, limit: 100, offset: 0 }, signal);
        if (response?.status === 'error') throw new Error(response.message || 'Search could not be completed.');
        const batch = normalizeList((response?.results || []).map((item) => ({ ...item, date: item.archive_date || item.date })));
        const total = Number(response?.total ?? batch.length);
        const has_more = Boolean(response?.has_more) || total > batch.length;
        hasSearchedRef.current = true;
        return { items: batch.slice(0, 100), total, has_more };
      },
      onState: (patch) => setState((c) => ({ ...c, ...patch })),
    });
  }
  useEffect(() => {
    // Setup path revives the runner after a StrictMode cleanup replay, so the
    // mounted component always searches with a usable runner. Real unmount
    // stays disposed via the cleanup below.
    runnerRef.current?.activate();
    return () => runnerRef.current?.dispose();
  }, []);

  useEffect(() => {
    setDraftQ(qParam);
    setDraftFrom(fromParam);
    setDraftTo(toParam);
    setDraftSource(sourceParam);
    setDraftSort(sortParam === 'newest' ? 'newest' : 'relevance');
  }, [qParam, fromParam, toParam, sourceParam, sortParam]);

  useEffect(() => {
    let cancelled = false;
    // Fetch preferences concurrently for privacy panel only; must not delay search
    getViewerPreferences().then((r) => {
      if (cancelled) return;
      const pref = r?.preferences || {};
      if (typeof pref.remember_search_history === 'boolean') {
        setRememberHistory(pref.remember_search_history);
      } else if (typeof pref.rememberSearchHistory === 'boolean') {
        setRememberHistory(pref.rememberSearchHistory);
      }
      setPrefsLoaded(true);
    }).catch(() => { if(!cancelled) setPrefsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const validateDates = (from, to) => {
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'From date must be YYYY-MM-DD';
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'To date must be YYYY-MM-DD';
    if (from && to && from > to) return 'From date must be before To date';
    return '';
  };

  useEffect(() => {
    // Search starts immediately from route query/filters; preference loading is concurrent and never delays/cancels/duplicates search (uses production helper)
    const cleanQuery = normalizeQuery(qParam);
    if (!shouldStartSearch(cleanQuery, true)) {
      runnerRef.current?.cancel();
      setState({ items: [], total: 0, loading: false, error: '', has_more: false });
      return;
    }
    const from = fromParam.trim();
    const to = toParam.trim();
    const source = sourceParam.trim();
    const sort = sortParam === 'newest' ? 'newest' : 'relevance';
    const validation = validateDates(from, to);
    if (validation) {
      setDateError(validation);
      setState((c) => ({ ...c, loading: false, error: validation }));
      return;
    }
    setDateError('');
    // One debounced request per navigation/filter application; cleanup via runner.
    runnerRef.current?.run({ query: cleanQuery, from, to, source, sort });
    return () => runnerRef.current?.cancel();
  }, [qParam, fromParam, toParam, sourceParam, sortParam]);

  // Error-state retry performs a real request immediately without changing the URL.
  const retrySearch = () => {
    const cleanQuery = normalizeQuery(qParam);
    if (!shouldStartSearch(cleanQuery, true)) return;
    setDateError('');
    runnerRef.current?.retry({
      query: cleanQuery,
      from: fromParam.trim(),
      to: toParam.trim(),
      source: sourceParam.trim(),
      sort: sortParam === 'newest' ? 'newest' : 'relevance',
    });
  };

  const visibleItems = useMemo(()=>{
    let list = state.items;
    // Date filtering over rendered result space without bypassing backend contract (backend already filtered, this ensures display consistency)
    const from = fromParam.trim();
    const to = toParam.trim();
    if(from || to){
      list = list.filter(it=>{
        const d = String(it.date || it.archive_date || '').slice(0,10);
        if(!d) return true;
        if(from && d < from) return false;
        if(to && d > to) return false;
        return true;
      });
    }
    return list;
  }, [state.items, fromParam, toParam]);
  const groups = groupedByDate(visibleItems);
  const [openArticle, setOpenArticle] = useState(null);
  const [dossierDetail, setDossierDetail] = useState(null);
  const dossierEngagement = useArticleEngagement(dossierDetail || openArticle || {}, { surface: 'search_results' });
  const handleCloseDossier = () => { dossierEngagement.onDossierClose(); setOpenArticle(null); setDossierDetail(null); };
  const openArticleId = openArticle ? articleKey(openArticle) : '';
  useEffect(()=>{ if(openArticle && openArticleId) dossierEngagement.onDossierOpen(openArticle); }, [openArticleId]);
  // On-demand full record: the list payload stays compact; the dossier loads
  // the complete retained article (hidden-filtered, viewer-scoped).
  useEffect(()=>{
    if (!openArticle) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setDossierDetail(null);
    getArchiveArticle({ link: openArticle.link, url: openArticle.url, title: openArticle.title }, controller.signal)
      .then((res)=>{
        if (cancelled || controller.signal.aborted) return;
        setDossierDetail(res?.article || null);
      })
      .catch(()=>{});
    return ()=>{ cancelled = true; controller.abort(); };
  }, [openArticleId]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const clean = normalizeQuery(draftQ);
    const err = validateDates(draftFrom.trim(), draftTo.trim());
    if (err) { setDateError(err); return; }
    if (!clean && !draftFrom && !draftTo && !draftSource) {
      navigate('/search');
      return;
    }
    const next = new URLSearchParams();
    if (clean) next.set('q', clean);
    if (draftFrom.trim()) next.set('from', draftFrom.trim());
    if (draftTo.trim()) next.set('to', draftTo.trim());
    if (draftSource.trim()) next.set('source', draftSource.trim());
    if (draftSort) next.set('sort', draftSort);
    navigate(`/search?${next.toString()}`);
  };

  const handleClear = () => {
    setDraftQ('');
    setDraftFrom('');
    setDraftTo('');
    setDraftSource('');
    setDraftSort('relevance');
    setDateError('');
    navigate('/search');
  };

  const handleManageSettings = () => {
    // dispatch event for SamparkApp to open settings and focus Remember Search History
    window.dispatchEvent(new CustomEvent('sampark-open-settings', { detail: { focus: 'remember_search_history' } }));
    // fallback: try to set flag for settings modal to scroll
    try { window.localStorage.setItem('sampark-settings-focus', 'remember_search_history'); } catch {}
  };

  return <section aria-busy={state.loading} className="search-results-page">
    <header className="search-results-header">
      <div>
        <span>Search the news archive</span>
        <h1>Results for “{normalizeQuery(qParam) || 'archived news'}”</h1>
        <p>This is the retained TechScout news archive — scheduler-extracted briefing stories kept for 30 days. It does not search the current tab, live Venture Lens providers, drafts, private contributions, or the public web. For technical artifacts use Research Discovery; for retained briefing evidence use Archive Search.</p>
        {state.total > 100 && !state.loading && <p>Showing 100 of {state.total} matches — narrow filters to see more.</p>}
      </div>
      <strong>{state.loading ? 'Searching…' : `${state.total} stories`}</strong>
    </header>

    <div className="sampark-search-privacy-panel" role="note" style={{ marginBottom: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface-soft)' }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
        {!prefsLoaded ? 'Loading search preferences…' : rememberHistory ? 'Searches help tune your For You briefing.' : 'Search history is off. This search will not affect For You.'}
        {' '}
        <button type="button" onClick={handleManageSettings} style={{ color: 'var(--primary)', textDecoration: 'underline', background: 'transparent', border: 0, cursor: 'pointer', fontSize: 13 }}>Manage Settings</button>
      </p>
    </div>

    <form className="sampark-search-refinement" onSubmit={handleSubmit} role="search" aria-label="Refine archived news search">
        <div className="sampark-search-field">
          <label htmlFor="sampark-search-q">Query</label>
          <input id="sampark-search-q" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Search all archived news" aria-label="Search all archived news" />
        </div>
        <div className="sampark-search-field">
          <label htmlFor="sampark-search-from">From date</label>
          <input id="sampark-search-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
        </div>
        <div className="sampark-search-field">
          <label htmlFor="sampark-search-to">To date</label>
          <input id="sampark-search-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
        </div>
        <div className="sampark-search-field">
          <label htmlFor="sampark-search-source">Source</label>
          <input id="sampark-search-source" value={draftSource} onChange={(e) => setDraftSource(e.target.value)} placeholder="Source" aria-label="Source" />
        </div>
        <div className="sampark-search-field">
          <label htmlFor="sampark-search-sort">Sort</label>
          <select id="sampark-search-sort" value={draftSort} onChange={(e) => setDraftSort(e.target.value)}>
            <option value="relevance">relevance</option>
            <option value="newest">newest</option>
          </select>
        </div>
        <button className="btn-primary" type="submit">Search</button>
        <button className="btn-secondary" type="button" onClick={handleClear}>Clear</button>
        {dateError && <p role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{dateError}</p>}
      </form>

    {state.error && <div className="search-state is-error" role="alert"><span>{state.error}</span><button onClick={retrySearch} type="button">Try again</button></div>}
    {state.loading && <div className="search-state" role="status"><span className="search-spinner" />{visibleItems.length ? 'Updating results…' : 'Searching every retained briefing…'}</div>}
    {!state.loading && !state.error && !visibleItems.length && !qParam.trim() && !fromParam.trim() && !toParam.trim() && !sourceParam.trim() && <div className="search-state"><Icon name="search" size={22} /><span>Enter a search query above, then choose Search. Filters refine a query.</span></div>}
    {!state.loading && !state.error && !visibleItems.length && !qParam.trim() && (fromParam.trim() || toParam.trim() || sourceParam.trim()) && <div className="search-state"><Icon name="search" size={22} /><span>Archive search needs a query — add one above. Date, source, and sort refine results but cannot run alone.</span></div>}
    {!state.loading && !state.error && !visibleItems.length && qParam.trim() && <div className="search-state"><Icon name="search" size={22} /><span>No matching stories. Try another company, technology, or keyword.</span></div>}

    <div className="search-date-groups">
      {Object.entries(groups).map(([date, items]) => <section className="search-date-group" key={date}>
        <header><h2>{date}</h2><span>{items.length} {items.length === 1 ? 'story' : 'stories'}</span></header>
        <div className="search-result-list">
          {items.map((item) => {
            const href = sourceLink(item);
            const title = item.title || 'Untitled news item';
            const content = <><span className="search-result-source">{item.source || item.src || 'TechScout'}<i aria-hidden="true" />{item.category || 'News'}</span><strong>{title}</strong>{item.summary && <p>{item.summary}</p>}</>;
            // Dossier opens on click, external link inside dossier tracks source_open via same engagement mechanism
            return <button key={articleKey(item)} className="search-result-row" type="button" onClick={()=> setOpenArticle(item)} style={{ textAlign:'left', width:'100%', background:'transparent', border:0, cursor:'pointer' }}>{content}{href && <Icon name="external" size={16} />}</button>;
          })}
        </div>
      </section>)}
    </div>
    {openArticle && <ArticleModal
      item={dossierDetail || openArticle}
      onClose={handleCloseDossier}
      onSourceOpen={() => dossierEngagement.onSourceOpen()}
    />}
  </section>;
}
