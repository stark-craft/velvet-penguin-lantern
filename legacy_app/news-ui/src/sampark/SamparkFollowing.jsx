import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getFollowingThreads, removeSavedArticle } from '../news-scrapper/api.js';
import { articleKey } from '../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import SamparkWorkspaceShell, { WorkspaceEmpty } from './shared/SamparkWorkspaceShell.jsx';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';

function ArticleDossier({ item, onClose }) {
  const ref = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sampark-dossier sampark-dossier--large" ref={ref} role="dialog" aria-modal="true">
        <header className="sampark-dossier-header">
          <div className="sampark-dossier-kicker">{item.category || 'Intelligence'} · {item.src || item.source || 'TechScout'}</div>
          <button onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-dossier-scroll">
          <div className="sampark-dossier-body">
            <h2>{item.title}</h2>
            <p className="sampark-dossier-summary">{item.summary || item.master_summary || ''}</p>
            {item.link && <a className="sampark-dossier-link" href={item.link} target="_blank" rel="noreferrer">Open source <Icon name="external" size={14} /></a>}
          </div>
        </div>
        <footer className="sampark-dossier-actions"><button className="btn-secondary" onClick={onClose} type="button">Close</button></footer>
      </section>
    </div>
  );
}

export default function SamparkFollowing() {
  const [threads, setThreads] = useState([]);
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [openArticle, setOpenArticle] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setState({ status: 'loading', error: '' });
    try {
      const res = await getFollowingThreads();
      const norm = (res?.threads || []).map((t, i) => ({
        ...t,
        anchor: normalizeList([t.anchor])[0] || t.anchor,
        updates: (t.updates || []).map((u, idx) => normalizeList([u])[0] || u),
      })).filter(t => t.anchor);
      setThreads(norm);
      setState({ status: 'ready', error: '' });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Could not open following.' });
    }
  };

  useEffect(() => { load(); }, []);

  const unfollow = async (thread) => {
    const key = articleKey(thread.anchor);
    if (busy) return;
    setBusy(key);
    try {
      await removeSavedArticle(thread.anchor);
      setThreads((cur) => cur.filter((t) => t.id !== thread.id));
    } catch (e) {
      setState((cur) => ({ ...cur, error: e?.message || 'Could not unfollow.' }));
    } finally {
      setBusy('');
    }
  };

  if (state.status === 'loading') {
    return <SamparkWorkspaceShell title="Saved & Following" description="Private story watch — closely related updates for 30 days, not every article sharing a name." loading="Opening your story threads…" />;
  }
  if (state.status === 'error') {
    return <SamparkWorkspaceShell title="Saved & Following" description="Private story watch — closely related updates for 30 days." error={state.error} onRetry={load} />;
  }
  if (!threads.length) {
    return <SamparkWorkspaceShell title="Saved & Following" description="Private story watch — closely related updates for 30 days." empty={{ icon: 'bookmark', title: 'No followed stories yet', description: 'Use Follow on a For You card. Closely related updates will collect here for 30 days.' }} />;
  }

  return (
    <SamparkWorkspaceShell title="Saved & Following" description="Private story watch — closely related updates for 30 days, not every article sharing a name.">
      <div className="sampark-thread-list">
        {threads.map((thread) => (
          <section className="sampark-thread" key={thread.id}>
            <article className="sampark-thread-anchor">
              <span className="sampark-thread-label">Following</span>
              <button className="sampark-thread-title" onClick={() => setOpenArticle(thread.anchor)} type="button">{thread.anchor.title}</button>
              <p className="sampark-thread-summary">{thread.anchor.summary_lead || thread.anchor.summary || 'The original story you chose to follow.'}</p>
              <div className="sampark-thread-meta">
                <small>{thread.anchor.src || thread.anchor.source || 'Source'}</small>
                <button className="sampark-thread-unfollow" disabled={busy === articleKey(thread.anchor)} onClick={() => unfollow(thread)} type="button"><Icon name="bookmark" size={14} /> {busy === articleKey(thread.anchor) ? 'Updating…' : 'Unfollow'}</button>
              </div>
            </article>
            <div className="sampark-thread-updates">
              <header><span>{thread.updates.length ? `${thread.update_count} close update${thread.update_count===1?'':'s'}` : 'No close updates yet'}</span><small>Semantic match · 30-day window</small></header>
              {thread.updates.length ? thread.updates.map((item) => (
                <button className="sampark-thread-update" key={articleKey(item)} onClick={() => setOpenArticle(item)} type="button">
                  <span className="sampark-thread-update-source">{item.src || item.source || 'Intelligence'}</span>
                  <strong className="sampark-thread-update-title">{item.title}</strong>
                  <small className="sampark-thread-update-score">{Math.round(Number(item.follow_match?.score||0)*100)}% story match</small>
                </button>
              )) : <p className="sampark-thread-waiting">We will add an update only when its meaning is genuinely close to this story.</p>}
            </div>
          </section>
        ))}
      </div>
      <ArticleDossier item={openArticle} onClose={() => setOpenArticle(null)} />
    </SamparkWorkspaceShell>
  );
}
