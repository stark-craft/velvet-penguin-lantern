import React, { useEffect, useState } from 'react';
import { searchExtractedIntelligence } from '../news-scrapper/api.js';
import { articleKey, groupedByDate } from '../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import Icon from '../news-scrapper/components/Icon.jsx';

function sourceLink(item) {
  const candidate = String(item?.link || item?.url || '').trim();
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

export default function SamparkSearchResults({ query }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ query: '', items: [], total: 0, loading: false, error: '' });

  useEffect(() => {
    const cleanQuery = String(query || '').trim();
    const controller = new AbortController();
    if (!cleanQuery) {
      setState({ query: '', items: [], total: 0, loading: false, error: '' });
      return () => controller.abort();
    }

    setState((current) => ({ ...current, query: cleanQuery, loading: true, error: '' }));
    const timer = window.setTimeout(async () => {
      try {
        let offset = 0;
        let total = 0;
        let items = [];
        do {
          const response = await searchExtractedIntelligence({ query: cleanQuery, sort: 'date_desc', limit: 500, offset }, controller.signal);
          if (response?.status === 'error') throw new Error(response.message || 'Search could not be completed.');
          const batch = normalizeList((response?.results || []).map((item) => ({ ...item, date: item.archive_date || item.date })));
          items = [...items, ...batch];
          total = Number(response?.total ?? items.length);
          offset = items.length;
          if (!response?.has_more || !batch.length) break;
        } while (offset < total);
        if (!controller.signal.aborted) setState({ query: cleanQuery, items, total, loading: false, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: error?.message || 'Search could not be completed.' }));
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  const visibleItems = state.query === String(query || '').trim() ? state.items : [];
  const groups = groupedByDate(visibleItems);

  return <section aria-busy={state.loading} className="search-results-page">
    <header className="search-results-header">
      <div><span>Search the news archive</span><h1>Results for “{String(query || '').trim()}”</h1><p>Every retained matching story, grouped by date and ordered newest first.</p></div>
      <strong>{state.loading ? 'Searching…' : `${state.total} stories`}</strong>
    </header>

    {state.error && <div className="search-state is-error" role="alert"><span>{state.error}</span><button onClick={() => setAttempt((value) => value + 1)} type="button">Try again</button></div>}
    {state.loading && !visibleItems.length && <div className="search-state" role="status"><span className="search-spinner" />Searching every retained briefing…</div>}
    {!state.loading && !state.error && !visibleItems.length && <div className="search-state"><Icon name="search" size={22} /><span>No matching stories. Try another company, technology, or keyword.</span></div>}

    <div className="search-date-groups">
      {Object.entries(groups).map(([date, items]) => <section className="search-date-group" key={date}>
        <header><h2>{date}</h2><span>{items.length} {items.length === 1 ? 'story' : 'stories'}</span></header>
        <div className="search-result-list">
          {items.map((item) => {
            const href = sourceLink(item);
            const title = item.title || 'Untitled news item';
            const content = <><span className="search-result-source">{item.source || item.src || 'TechScout'}<i aria-hidden="true" />{item.category || 'News'}</span><strong>{title}</strong>{item.summary && <p>{item.summary}</p>}</>;
            return href
              ? <a className="search-result-row" href={href} key={articleKey(item)} rel="noreferrer" target="_blank">{content}<Icon name="external" size={16} /></a>
              : <article className="search-result-row" key={articleKey(item)}>{content}</article>;
          })}
        </div>
      </section>)}
    </div>
  </section>;
}
