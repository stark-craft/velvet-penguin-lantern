import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getViewerHidden, restoreArticleForViewer, trackEvent } from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import { sanitizeExternalUrl } from './shared/safeLink.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkHidden() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [busy, setBusy] = useState('');

  const handleSourceOpen = useCallback((item) => {
    try { trackEvent(undefined, 'source_open', item); } catch {}
  }, []);

  const load = async () => {
    setState({ status: 'loading', error: '' });
    try {
      const res = await getViewerHidden();
      const list = normalizeList(res?.items || []);
      setItems(list);
      setState({ status: 'ready', error: '' });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Could not load hidden stories.' });
    }
  };

  useEffect(() => { load(); }, []);

  const restore = async (item) => {
    const key = articleKey(item);
    if (busy) return;
    setBusy(key);
    try {
      await restoreArticleForViewer(item);
      setItems((cur) => cur.filter((it) => articleKey(it) !== key));
    } catch (e) {
      setState((cur) => ({ ...cur, error: e?.message || 'Could not restore.' }));
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'loading') {
    return <SamparkWorkspaceShell title="Hidden News" description="Articles you've hidden from your personal TechScout experience. Private to this browser." loading />;
  }
  if (state.status === 'error') {
    return <SamparkWorkspaceShell title="Hidden News" description="Articles you've hidden from your personal TechScout experience." error={state.error} onRetry={load} />;
  }
  if (!items.length) {
    return <SamparkWorkspaceShell title="Hidden News" description="Articles you've hidden from your personal TechScout experience. Private to this browser." empty={{ icon: 'eye', title: 'No hidden stories', description: 'Use Hide on a For You card to remove it only from your personal feed. The shared briefing is unchanged.' }} />;
  }

  return (
    <SamparkWorkspaceShell title="Hidden News" description="Articles you've hidden from your personal TechScout experience. Private to this browser.">
      <div className="sampark-hidden-list">
        {items.map((item) => (
          <article className="sampark-hidden-card" key={articleKey(item)}>
            <div className="sampark-hidden-meta"><span>{item.src || item.source || 'Intelligence'}</span><span>{item.date || ''}</span><span>{item.category || 'News'}</span></div>
            <h3 className="sampark-hidden-title">{item.title}</h3>
            {item.summary && <p className="sampark-hidden-summary">{item.summary}</p>}
            <div className="sampark-hidden-actions">
              {sanitizeExternalUrl(item.link || item.url) && <a className="btn-secondary" href={sanitizeExternalUrl(item.link || item.url)} target="_blank" rel="noreferrer noopener" onClick={() => handleSourceOpen(item)}>Open source <Icon name="external" size={14} /></a>}
              <button className="btn-primary" disabled={busy === articleKey(item)} onClick={() => restore(item)} type="button">{busy === articleKey(item) ? 'Restoring…' : 'Restore'}</button>
            </div>
          </article>
        ))}
      </div>
    </SamparkWorkspaceShell>
  );
}
