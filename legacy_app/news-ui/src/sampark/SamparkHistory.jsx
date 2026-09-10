import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getHistoryList, getHistoryFile } from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkHistory() {
  const [runs, setRuns] = useState([]);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const load = async () => {
    setState({ status: 'loading', error: '' });
    try {
      const res = await getHistoryList();
      const list = Array.isArray(res?.files) ? res.files : Array.isArray(res) ? res : [];
      setRuns(list.slice(0, 30));
      setState({ status: 'ready', error: '' });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Could not load briefing archives.' });
    }
  };

  useEffect(() => { load(); }, []);

  const openRun = async (run) => {
    setSelected(run);
    setLoadingItems(true);
    try {
      const data = await getHistoryFile(run.filename || run.name || '');
      const list = normalizeList(Array.isArray(data) ? data : data?.items || data?.result || []);
      setItems(list);
    } catch (e) {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  if (state.status === 'loading') return <SamparkWorkspaceShell title="Briefing Archives" description="Daily briefing snapshots and approved feeds. Private to your workspace." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Briefing Archives" description="Daily briefing snapshots and approved feeds." error={state.error} onRetry={load} />;
  if (!runs.length) return <SamparkWorkspaceShell title="Briefing Archives" description="Daily briefing snapshots and approved feeds." empty={{ icon: 'archive', title: 'No archives yet', description: 'Briefing archives appear after the first scheduler run.' }} />;

  return (
    <SamparkWorkspaceShell title="Briefing Archives" description="Daily briefing snapshots and approved feeds. Select a date to view its stories.">
      <div className="sampark-history-layout">
        <div className="sampark-history-list">
          {runs.map((run, idx) => (
            <button key={run.filename || idx} className={`sampark-history-row ${selected?.filename === run.filename ? 'is-active' : ''}`} onClick={() => openRun(run)} type="button">
              <span className="sampark-history-date">{run.display || run.filename || `Archive ${idx + 1}`}</span>
              <small>{run.count ? `${run.count} stories` : ''}</small>
            </button>
          ))}
        </div>
        <div className="sampark-history-detail">
          {!selected ? <p className="sampark-history-hint">Select an archive date to view its briefing.</p> : loadingItems ? <div className="sampark-workspace-loading"><span className="sampark-spinner" /> Loading archive…</div> : !items.length ? <p>No stories in this archive.</p> : (
            <div className="sampark-history-grid">
              {items.slice(0, 30).map((item) => (
                <article key={articleKey(item)} className="sampark-history-card">
                  <small>{item.src || item.source || 'Source'} · {item.date || ''}</small>
                  <strong>{item.title}</strong>
                  {item.link && <a href={item.link} target="_blank" rel="noreferrer">Open <Icon name="external" size={12} /></a>}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </SamparkWorkspaceShell>
  );
}
