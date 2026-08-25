import React, { useEffect, useState } from 'react';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import Icon from '../components/Icon.jsx';
import { getFollowingThreads, removeSavedArticle } from '../api.js';
import { normalizeArticle } from '../utils/normalize.js';
import { articleKey } from '../utils/intelligence.js';

export default function FollowingScreen() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openArticle, setOpenArticle] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await getFollowingThreads();
      setThreads((response?.threads || []).map((thread, index) => ({
        ...thread,
        anchor: normalizeArticle(thread.anchor, index),
        updates: (thread.updates || []).map((item, updateIndex) => normalizeArticle(item, updateIndex)).filter(Boolean),
      })).filter((thread) => thread.anchor));
      setError('');
    } catch (nextError) {
      setError(nextError?.message || 'Could not open your followed stories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const unfollow = async (thread) => {
    const key = articleKey(thread.anchor);
    if (busy) return;
    setBusy(key);
    try {
      await removeSavedArticle(thread.anchor);
      setThreads((current) => current.filter((value) => value.id !== thread.id));
    } catch (nextError) {
      setError(nextError?.message || 'Could not unfollow this story.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="fy-state"><span className="fy-loader" /><h1>Opening your story threads</h1></div>;
  return (
    <div className="fy-following-page">
      <header className="fy-compact-intro">
        <div><span>Private story watch</span><h1>Following</h1></div>
        <p>Each story stays anchored here with only close semantic updates—not every article sharing a company name.</p>
      </header>
      {error && <div className="fy-inline-error" role="alert">{error} <button onClick={load} type="button">Retry</button></div>}
      {!threads.length ? (
        <section className="fy-empty-state"><Icon name="bookmark" size={28} /><h2>No followed stories yet</h2><p>Use Follow on a For You card. Closely related updates will collect here for 30 days.</p></section>
      ) : <div className="fy-thread-list">{threads.map((thread) => (
        <section className="fy-thread" key={thread.id}>
          <article className="fy-thread-anchor">
            <span>Following</span><button onClick={() => setOpenArticle(thread.anchor)} type="button">{thread.anchor.title}</button>
            <p>{thread.anchor.summary_lead || thread.anchor.summary || 'The original story you chose to follow.'}</p>
            <div><small>{thread.anchor.src || thread.anchor.source || 'Source'}</small><button disabled={busy === articleKey(thread.anchor)} onClick={() => unfollow(thread)} type="button"><Icon name="bookmark" size={14} /> {busy === articleKey(thread.anchor) ? 'Updating…' : 'Unfollow'}</button></div>
          </article>
          <div className="fy-thread-updates">
            <header><span>{thread.updates.length ? `${thread.update_count} close update${thread.update_count === 1 ? '' : 's'}` : 'No close updates yet'}</span><small>Semantic match · 30-day window</small></header>
            {thread.updates.length ? thread.updates.map((item) => <button className="fy-thread-update" key={articleKey(item)} onClick={() => setOpenArticle(item)} type="button"><span>{item.src || item.source || 'Intelligence source'}</span><strong>{item.title}</strong><small>{Math.round(Number(item.follow_match?.score || 0) * 100)}% story match</small></button>) : <p className="fy-thread-waiting">We will add an update only when its meaning is genuinely close to this story.</p>}
          </div>
        </section>
      ))}</div>}
      <ArticleModal item={openArticle} onClose={() => setOpenArticle(null)} />
    </div>
  );
}
