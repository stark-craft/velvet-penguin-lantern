import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getHistoryList, getHistoryFile } from '../news-scrapper/api.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';
import { useArticleEngagement } from './shared/useArticleEngagement.js';
import SamparkArticleDossier from './shared/SamparkArticleDossier.jsx';

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

  const [detailError, setDetailError] = useState('');
  const [openArticle, setOpenArticle] = useState(null);
  const engagement = useArticleEngagement(openArticle || {}, { surface: 'history_archive' });
  const handleCloseDossier = () => { engagement.onDossierClose(); setOpenArticle(null); };
  const openArticleId = openArticle ? articleKey(openArticle) : '';
  useEffect(()=>{ if(openArticle && openArticleId) engagement.onDossierOpen(openArticle); }, [openArticleId]);
  const openRun = async (run) => {
    setSelected(run);
    setLoadingItems(true);
    setDetailError('');
    try {
      const data = await getHistoryFile(run.filename || run.name || '');
      // Backend contract: { status: "success", results: [...] } ; keep compat with items/result for legacy
      const raw = data?.results ?? data?.items ?? data?.result ?? (Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length === 0 && data?.status === 'success') {
        // empty success
      }
      if (data?.status === 'error' || data?.detail) throw new Error(data?.detail || data?.message || 'Archive could not be loaded');
      const list = normalizeList(Array.isArray(raw) ? raw : []);
      setItems(list);
      if (!list.length && data?.status === 'success') {
        // genuine empty
        setDetailError('');
      }
    } catch (e) {
      const status = e?.status;
      if (status === 404) setDetailError('Archive not found (404).');
      else if (status === 403) setDetailError('Permission denied.');
      else if (e?.message?.includes('malformed') || e?.message?.includes('JSON')) setDetailError('Malformed archive.');
      else if (e?.message?.includes('Network') || status === 0) setDetailError('Network failure.');
      else setDetailError(e?.message || 'Archive could not be loaded.');
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
          {!selected ? <p className="sampark-history-hint">Select an archive date to view its briefing.</p> : loadingItems ? <div className="sampark-workspace-loading"><span className="sampark-spinner" /> Loading archive…</div> : detailError ? <div role="alert" className="sampark-workspace-empty is-error"><Icon name="warning" size={20} /><p>{detailError}</p><button className="btn-secondary" onClick={()=> selected && openRun(selected)} type="button">Retry</button></div> : !items.length ? <p>No stories</p> : (
            <div className="sampark-history-grid">
              {items.slice(0, 30).map((item) => (
                <button key={articleKey(item)} className="sampark-history-card" type="button" onClick={()=> setOpenArticle(item)} style={{ textAlign:'left', cursor:'pointer' }}>
                  <small>{item.src || item.source || 'Source'} · {item.date || ''}</small>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>
          )}
          {openArticle && (
            <SamparkArticleDossier
              item={openArticle}
              onClose={handleCloseDossier}
              onSourceOpen={() => engagement.onSourceOpen()}
              titleId="history-dossier-title"
            />
          )}
        </div>
      </div>
    </SamparkWorkspaceShell>
  );
}
