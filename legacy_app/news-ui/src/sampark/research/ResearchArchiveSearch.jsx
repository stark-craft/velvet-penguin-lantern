import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import {
  getViewerHidden,
  getViewerReactions,
  getViewerSaved,
  hideArticleForViewer,
  removeSavedArticle,
  saveArticleForLater,
  searchExtractedIntelligence,
  setViewerReaction,
} from '../../news-scrapper/api.js';
import { articleKey, reactionIdentity, scoreOf } from '../../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || item?.top_image || '';
}

function SamparkResearchDossier({ item, onClose, saved, onSave, onHide, onReact }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  const image = imageOf(item);
  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  const lead = item.summary_lead || item.summary || item.master_summary || '';
  const points = Array.isArray(item.summary_points) ? item.summary_points : [];
  const sourceLink = item.link || item.url || '';
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-research-dossier-title" aria-modal="true" className="sampark-dossier sampark-dossier--large" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'Research'} · {item.src || item.source || 'Archive'} · {item.archive_date || item.date || 'Latest'}</div>
            <div className="sampark-dossier-subtitle">{item.region || 'Global'} · Score {scoreOf(item)} {item.search_score ? `· ${item.search_score}% match` : ''}</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          {image ? <div className="sampark-dossier-media"><img alt="" className="sampark-dossier-img" src={image} /></div> : <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>}
          <div className="sampark-dossier-body">
            <h2 id="sampark-research-dossier-title" className="sampark-dossier-title">{item.title}</h2>
            {lead && <p className="sampark-dossier-summary">{lead}</p>}
            {points.length ? <ul className="sampark-dossier-points">{points.slice(0, 5).map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
            {item.matched_terms?.length ? <div className="sampark-dossier-keywords">{item.matched_terms.slice(0, 6).map((kw) => <span key={kw} className="sampark-keyword">{kw}</span>)}</div> : null}
            {sourceLink ? <a className="sampark-dossier-link" href={sourceLink} rel="noreferrer" target="_blank">Open original source <Icon name="external" size={14} /></a> : null}
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

function groupByDate(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(item.archive_date || item.date || 'Undated').slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export default function ResearchArchiveSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const urlQuery = new URLSearchParams(location.search).get('q') || '';
  const [query, setQuery] = useState(urlQuery);
  const [fromDate, setFromDate] = useState(() => new URLSearchParams(location.search).get('from') || '');
  const [toDate, setToDate] = useState(() => new URLSearchParams(location.search).get('to') || '');
  const [targetSites, setTargetSites] = useState(() => new URLSearchParams(location.search).get('sites') || '');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState({ archive_files_searched: 0, articles_searched: 0, has_more: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [openArticle, setOpenArticle] = useState(null);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState('');
  const locks = useRef(new Set());

  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setFromDate(params.get('from') || '');
    setToDate(params.get('to') || '');
    setTargetSites(params.get('sites') || '');
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    getViewerSaved().then((r) => { if (!cancelled) setSavedKeys(new Set(normalizeList(r?.items || []).map(articleKey))); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const reactionSig = useMemo(() => items.map(reactionIdentity).filter(Boolean).join('|'), [items]);
  useEffect(() => {
    if (!reactionSig) return;
    let cancelled = false;
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await getViewerReactions(reactionSig.split('|'));
        if (cancelled) return;
        const snaps = res?.reactions || {};
        const apply = (c) => { const id = reactionIdentity(c); return snaps[id] ? { ...c, reactions: snaps[id] } : c; };
        setItems((cur) => cur.map(apply));
        setOpenArticle((cur) => cur ? apply(cur) : cur);
      } catch {}
    };
    const iv = setInterval(sync, 12000);
    window.addEventListener('focus', sync);
    return () => { clearInterval(iv); window.removeEventListener('focus', sync); };
  }, [reactionSig]);

  const executeSearch = async ({ q, from, to, sites, append = false }) => {
    const clean = String(q || '').trim();
    if (!clean) { setItems([]); setTotal(0); setHasMore(false); setMeta({ archive_files_searched: 0, articles_searched: 0, has_more: false }); return; }
    setLoading(true);
    setError('');
    const nextOffset = append ? offset : 0;
    try {
      const params = { query: clean, limit: 100, offset: nextOffset, sort: 'date_desc' };
      if (from) params.from_date = from;
      if (to) params.to_date = to;
      if (sites) params.target_sites = sites;
      const resp = await searchExtractedIntelligence(params);
      if (resp?.status === 'error') throw new Error(resp.message || 'Search failed.');
      const batch = normalizeList((resp?.results || []).map((it) => ({ ...it, date: it.archive_date || it.date })));
      const totalCount = Number(resp?.total ?? (append ? items.length + batch.length : batch.length));
      setItems((cur) => append ? [...cur, ...batch.filter((it) => !cur.some((c) => articleKey(c) === articleKey(it)))] : batch);
      setTotal(totalCount);
      setMeta({ archive_files_searched: Number(resp?.archive_files_searched || 0), articles_searched: Number(resp?.articles_searched || 0), has_more: Boolean(resp?.has_more) });
      setHasMore(Boolean(resp?.has_more) && batch.length > 0);
      setOffset(append ? nextOffset + batch.length : batch.length);
      if (!append) {
        const next = new URLSearchParams(location.search);
        if (clean) next.set('q', clean); else next.delete('q');
        if (from) next.set('from', from); else next.delete('from');
        if (to) next.set('to', to); else next.delete('to');
        if (sites) next.set('sites', sites); else next.delete('sites');
        const qs = next.toString();
        navigate(`/research/archive${qs ? `?${qs}` : ''}`, { replace: true });
      }
    } catch (e) {
      if (!append) { setItems([]); setTotal(0); }
      setError(e?.message || 'Research search could not be completed.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const clean = urlQuery.trim();
    if (clean && !loading && items.length === 0 && !error) {
      executeSearch({ q: clean, from: fromDate, to: toDate, sites: targetSites, append: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    executeSearch({ q: query, from: fromDate, to: toDate, sites: targetSites, append: false });
  };
  const handleLoadMore = () => executeSearch({ q: query || urlQuery, from: fromDate, to: toDate, sites: targetSites, append: true });

  const runAction = async (key, work) => {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setBusy((c) => ({ ...c, [key]: true }));
    try { return await work(); } finally { locks.current.delete(key); setBusy((c) => { const n = { ...c }; delete n[key]; return n; }); }
  };
  const handleSave = (item) => {
    const key = articleKey(item);
    return runAction(key, async () => {
      const saved = savedKeys.has(key);
      if (saved) await removeSavedArticle(item); else await saveArticleForLater(item);
      setSavedKeys((cur) => { const n = new Set(cur); if (saved) n.delete(key); else n.add(key); return n; });
      setNotice(saved ? 'Removed from followed.' : 'Following privately.');
    });
  };
  const handleHide = (item) => {
    const key = articleKey(item);
    return runAction(key, async () => {
      await hideArticleForViewer(item);
      setItems((cur) => cur.filter((it) => articleKey(it) !== key));
      setNotice('Hidden from your private view.');
    });
  };
  const handleReact = (item, reaction) => {
    const key = articleKey(item);
    return runAction(key, async () => {
      const cur = item.reactions?.viewer_reaction || 'neutral';
      const next = cur === reaction ? 'neutral' : reaction;
      const resp = await setViewerReaction(item, next);
      const snap = { like_count: resp.like_count, dislike_count: resp.dislike_count, viewer_reaction: resp.viewer_reaction };
      setItems((cur) => cur.map((it) => articleKey(it) === key ? { ...it, reactions: snap } : it));
      setOpenArticle((cur) => cur && articleKey(cur) === key ? { ...cur, reactions: snap } : cur);
      setNotice(next === 'neutral' ? 'Reaction removed.' : `Your ${next} was counted.`);
    });
  };

  const grouped = useMemo(() => groupByDate(items), [items]);

  return (
    <div className="sampark-research-archive">
      {notice && <div className="sampark-for-you-feedback" role="status"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice('')} type="button"><Icon name="x" size={14} /></button></div>}

      <header className="sampark-research-archive-intro">
        <div>
          <span className="sampark-research-kicker">Archive Search · retained scheduler briefing evidence</span>
          <h2>Search the retained archive</h2>
          <p>Full-text search across scheduler-extracted briefing files — never the live crawler, never the public web. Discovery is the technical artifact index; this Archive Search is the retained evidence index.</p>
        </div>
        <div className="sampark-research-meta">
          <span><Icon name="archive" size={14} /> {meta.articles_searched || '—'} articles</span>
          <span><Icon name="layers" size={14} /> {meta.archive_files_searched || '—'} files</span>
        </div>
      </header>

      <form className="sampark-research-search" onSubmit={handleSubmit} role="search">
        <div className="sampark-research-query">
          <Icon name="search" size={18} />
          <input aria-label="Research archive query" placeholder="Company, product, technology, market, or exact phrase" value={query} onChange={(e) => setQuery(e.target.value)} type="search" />
          {query && <button aria-label="Clear research query" className="sampark-research-clear" onClick={() => setQuery('')} type="button"><Icon name="x" size={14} /></button>}
        </div>
        <button className="btn-primary" disabled={loading || !query.trim()} type="submit">{loading ? 'Searching…' : 'Search archive'}</button>
      </form>

      <div className="sampark-research-filters">
        <label className="sampark-research-field"><span>From</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label className="sampark-research-field"><span>To</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <label className="sampark-research-field sampark-research-field--grow"><span>Source filter</span><input placeholder="Filter by source, e.g. Samsung, TechCrunch" value={targetSites} onChange={(e) => setTargetSites(e.target.value)} type="search" /></label>
        {(fromDate || toDate || targetSites) && <button className="btn-secondary" onClick={() => { setFromDate(''); setToDate(''); setTargetSites(''); }} type="button">Clear filters</button>}
      </div>

      <div className="sampark-research-status" aria-live="polite">
        {loading && <span className="sampark-research-loading"><span className="sampark-spinner" /> Searching every retained briefing…</span>}
        {!loading && error && <span className="sampark-research-error" role="alert">{error} <button onClick={() => executeSearch({ q: query || urlQuery, from: fromDate, to: toDate, sites: targetSites })} type="button">Retry</button></span>}
        {!loading && !error && !items.length && query.trim() && <span>No matching signals. Widen the date window or try a related phrase.</span>}
        {!loading && !error && !items.length && !query.trim() && <span>Enter a query above to surface ranked archive signals. Results appear grouped by date, newest first. The distinction is clear: Discovery searches Venture Lens providers; this Archive Search searches retained briefing evidence.</span>}
        {!loading && !error && items.length > 0 && <span><strong>{items.length}</strong> of {total} matches shown · {hasMore ? 'more available' : 'all loaded'} · evidence from {meta.archive_files_searched} files</span>}
      </div>

      {items.length > 0 && (
        <div className="sampark-research-results">
          {grouped.map(([date, group]) => (
            <section key={date} className="sampark-research-group">
              <header><h2>{date}</h2><span>{group.length} {group.length === 1 ? 'story' : 'stories'}</span></header>
              <div className="sampark-research-grid">
                {group.map((item) => {
                  const key = articleKey(item);
                  const saved = savedKeys.has(key);
                  const reactions = item.reactions || {};
                  const img = imageOf(item);
                  return (
                    <article key={key} className="sampark-research-card">
                      <button aria-label={`Open dossier for ${item.title}`} className="sampark-research-card-media" onClick={() => setOpenArticle(item)} type="button">
                        {img ? <img alt="" className="sampark-card-img" src={img} loading="lazy" /> : <span className="sampark-card-img-placeholder"><Icon name="globe" size={22} /></span>}
                        <span className="sampark-card-source-badge">{item.source || item.src || 'Archive'}</span>
                      </button>
                      <div className="sampark-research-card-body">
                        <div className="sampark-research-card-kicker">{item.category || 'Intelligence'} · Score {scoreOf(item)} {item.search_score ? `· ${item.search_score}% match` : ''}</div>
                        <button className="sampark-research-card-title" onClick={() => setOpenArticle(item)} type="button"><h4>{item.title}</h4></button>
                        {item.summary && <p className="sampark-research-card-summary">{item.summary}</p>}
                        {item.matched_terms?.length ? <div className="sampark-research-matches">{item.matched_terms.slice(0, 4).map((t) => <em key={t}>{t}</em>)}</div> : null}
                        <div className="sampark-card-footer">
                          <span className="sampark-card-meta"><Icon name="clock" size={12} /> {item.archive_date || item.date || 'Archived'}</span>
                          <div className="sampark-card-actions">
                            <button className={`sampark-card-action${reactions.viewer_reaction === 'like' ? ' is-active' : ''}`} disabled={Boolean(busy[key])} onClick={() => handleReact(item, 'like')} type="button"><Icon name="thumbsUp" size={14} /><span>{reactions.like_count || 0}</span></button>
                            <button className={`sampark-card-action${reactions.viewer_reaction === 'dislike' ? ' is-active' : ''}`} disabled={Boolean(busy[key])} onClick={() => handleReact(item, 'dislike')} type="button"><Icon name="thumbsDown" size={14} /></button>
                            <button className={`sampark-card-action${saved ? ' is-active' : ''}`} disabled={Boolean(busy[key])} onClick={() => handleSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={14} /></button>
                            <button className="sampark-card-action" disabled={Boolean(busy[key])} onClick={() => handleHide(item)} type="button"><Icon name="eye" size={14} /></button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMore && (
            <div className="sampark-all-news-loadmore">
              <button className="btn-primary" disabled={loading} onClick={handleLoadMore} type="button">{loading ? 'Loading…' : 'Load more archive results'}</button>
              <span className="sampark-load-hint">{items.length} of {total} loaded</span>
            </div>
          )}
        </div>
      )}

      <SamparkResearchDossier item={openArticle} onClose={() => setOpenArticle(null)} onHide={async (it) => { setOpenArticle(null); await handleHide(it); }} onReact={handleReact} onSave={handleSave} saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} />
    </div>
  );
}
