import React, { useEffect, useState } from 'react';
import { searchExtractedIntelligence } from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import { groupedByDate, articleKey } from '../news-scrapper/utils/intelligence.js';
import Icon from '../news-scrapper/components/Icon.jsx';
import ArticleModal from '../news-scrapper/components/modals/ArticleModal.jsx';

export default function ArchiveSearchScreen({ query }) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ query: '', items: [], total: 0, more: false, loading: true, error: '' });
  const [article, setArticle] = useState(null);
  useEffect(() => { setArticle(null); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        if (!query.trim()) { setState({ query, items: [], total: 0, more: false, loading: false, error: '' }); return; }
        let offset = 0;
        let all = [];
        let total = 0;
        do {
          const data = await searchExtractedIntelligence({ query, sort: 'date_desc', limit: 500, offset }, controller.signal);
          if (controller.signal.aborted) return;
          if (data.status === 'error') throw new Error(data.message);
          const batch = normalizeList((data.results || []).map(item => ({ ...item, date: item.archive_date || item.date })));
          all = [...all, ...batch]; total = data.total ?? all.length; offset = all.length;
          if (!data.has_more || !batch.length) break;
        } while (offset < total);
        setState({ query, items: all, total, more: false, loading: false, error: '' });
      } catch (error) { if (!controller.signal.aborted) setState(current => ({ ...current, loading: false, error: error.message || 'Search could not load.' })); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry]);
  const items = state.query === query ? state.items : [];
  return <section className="tab-content active archive-search" aria-busy={state.loading}>
    <header className="archive-search-head"><div><span className="ln-category education">Search the news archive</span><h1>{query.trim() ? `Results for “${query.trim()}”` : 'Search all news'}</h1><p>All retained news, grouped by date · newest first</p></div><strong>{state.loading ? 'Searching…' : `${state.total} stories`}</strong></header>
    {state.error && <div className="error-banner" role="alert"><p>{state.error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!state.loading && !state.error && !items.length && <p>No matching stories. Try another company, topic or keyword.</p>}
    <div className="archive-groups">{Object.entries(groupedByDate(items)).map(([day, stories]) => <section className="archive-day" key={day}><h2>{day} <span className="news-count">({stories.length} News)</span></h2><div className="archive-grid">{stories.map(item => <article className="latest-news-card" key={articleKey(item)}><button aria-label={`Open dossier for ${item.title}`} className="lnc-image" onClick={() => setArticle(item)} style={item.image_url ? { backgroundImage: `url("${item.image_url}")` } : undefined} type="button">{!item.image_url && <Icon name="globe" size={30} />}</button><div className="lnc-tags">{item.src || item.source} | {item.category || 'News'}</div><button className="lnc-title" onClick={() => setArticle(item)} type="button">{item.title}</button></article>)}</div></section>)}</div>
    <ArticleModal item={article} onClose={() => setArticle(null)} />
  </section>;
}
