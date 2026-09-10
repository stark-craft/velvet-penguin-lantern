import React, { useEffect, useState } from 'react';
import { getHistoryFile, getHistoryList } from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import Icon from '../news-scrapper/components/Icon.jsx';
import ArticleModal from '../news-scrapper/components/modals/ArticleModal.jsx';

export default function SamparkArchiveScreen() {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);
  const [state, setState] = useState({ loading: true, error: '' });
  useEffect(() => { getHistoryList().then(value => { const list = Array.isArray(value) ? value : []; setRuns(list); if (list[0]) setSelected(list[0].filename); }).catch(error => setState({ loading: false, error: error.message })).finally(() => setState(current => ({ ...current, loading: false }))); }, []);
  useEffect(() => { if (!selected) return; setState({ loading: true, error: '' }); getHistoryFile(selected).then(value => setItems(normalizeList(value?.result || value?.results || value?.articles || value))).catch(error => setState({ loading: false, error: error.message })).finally(() => setState(current => ({ ...current, loading: false }))); }, [selected]);
  return <section className="tab-content active briefing-archive"><header className="archive-search-head"><div><span className="ln-category education">Briefing archive</span><h1>Past briefing editions</h1><p>Open every retained edition in reverse chronological order.</p></div><label className="archive-edition-select">Edition<select value={selected} onChange={event => setSelected(event.target.value)}>{runs.map(run => <option key={run.filename} value={run.filename}>{run.display || run.filename}</option>)}</select></label></header>
    {state.error && <div className="error-banner" role="alert">{state.error}</div>}{state.loading && <p className="sampark-empty" role="status">Opening briefing edition…</p>}{!state.loading && !items.length && <p className="sampark-empty">No saved briefing editions are available.</p>}
    <div className="archive-grid">{items.map(item => <article className="latest-news-card" key={articleKey(item)}><button className="lnc-image" onClick={() => setOpen(item)} style={item.image_url ? { backgroundImage: `url("${item.image_url}")` } : undefined} type="button">{!item.image_url && <Icon name="globe" size={30} />}</button><div className="lnc-tags">{item.src || item.source || 'TechScout'} | {item.category || 'News'}</div><button className="lnc-title" onClick={() => setOpen(item)} type="button">{item.title}</button></article>)}</div><ArticleModal item={open} onClose={() => setOpen(null)} />
  </section>;
}
