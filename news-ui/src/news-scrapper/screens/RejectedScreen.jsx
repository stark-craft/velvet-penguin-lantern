import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import { correctRegion, getViewerHidden, restoreArticleForViewer } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { trackAction } from '../utils/tracking.js';
import { cardVariant, groupedByDate } from '../utils/intelligence.js';

export default function RejectedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoad] = useState(true);
  const [openArticle, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restoring, setRestoring] = useState(new Set());
  const restoreLocks = useRef(new Set());

  const refresh = async () => {
    if (loading && items.length) return;
    setLoad(true);
    setError('');
    try {
      const result = await getViewerHidden();
      setItems(normalizeList(result?.items || result || []));
    } catch (err) {
      setError(err?.message || 'Could not load your hidden signals.');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const groups = useMemo(() => groupedByDate(items), [items]);

  const onRestore = async (item) => {
    const key = item.id || item.title;
    if (restoreLocks.current.has(key)) return;
    restoreLocks.current.add(key);
    setRestoring((current) => new Set(current).add(key));
    setError('');
    setNotice('');
    try {
      await restoreArticleForViewer(item);
      setItems((arr) => arr.filter((x) => x.title !== item.title));
      trackAction('restore_personal_hidden', item.title?.slice(0, 60));
      setOpen((current) => (current?.title === item.title ? null : current));
      setNotice('Signal restored to your feed.');
    } catch (err) {
      setError(err?.message || 'Could not restore this signal.');
    } finally {
      restoreLocks.current.delete(key);
      setRestoring((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setItems((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  return (
    <div className="hidden-page space-y-6">
      <section className="workspace-hero hidden-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Hidden Signals</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Review hidden intelligence</h1>
            <p className="mt-3 text-slate-400">{items.length} articles hidden only from your feed. These choices never train the bouncer.</p>
          </div>
          <button className="btn-dark-secondary" disabled={loading} onClick={refresh} type="button"><Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

      {loading ? (
        <div className="workspace-empty rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">Loading Hidden Signals</h2>
        </div>
      ) : error && items.length === 0 ? (
        <div className="workspace-empty rounded-[24px] border border-red-300/20 bg-red-950/20 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">Hidden Signals could not be loaded</h2>
          <p className="mt-2 text-red-200/80">Your hidden choices are safe. Try the request again.</p>
          <button className="btn-dark-secondary mt-4" onClick={refresh} type="button"><Icon name="refresh" /> Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="workspace-empty rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">No hidden signals right now</h2>
          <p className="mt-2 text-slate-400">Use Hide on any signal to clear it from your own feed without affecting anyone else.</p>
        </div>
      ) : (
        <section className="space-y-8">
          {Object.entries(groups).map(([day, group]) => (
            <div key={day} className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-white">{day}</h2>
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-sm text-slate-500">{group.length} hidden</span>
              </div>
              <div className="article-grid hidden-grid grid gap-8 lg:grid-cols-2">
                {group.map((item) => (
                  <div key={item.id} className="hidden-signal-card rounded-[22px] border border-white/10 bg-[#101827]/70 p-3 opacity-95 shadow-cockpit">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <span className="signal-chip selected">Hidden only for you</span>
                      <span className="signal-chip">Bouncer not trained</span>
                    </div>
                    <ArticleCard item={{ ...item, rejected_at: item.rejected_at || 'Hidden' }} variant={cardVariant(item)} onOpen={setOpen} />
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      <button aria-busy={restoring.has(item.id || item.title)} className="btn-dark-primary h-9" disabled={restoring.has(item.id || item.title)} onClick={() => onRestore(item)} type="button">
                        <Icon name="rotate" /> {restoring.has(item.id || item.title) ? 'Restoring…' : 'Restore Signal'}
                      </button>
                      <span className="hidden-state-label"><Icon name="eye" size={14} /> Remains hidden</span>
                      <button className="btn-dark-secondary h-9" onClick={() => setOpen(item)} type="button">Open Dossier</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <ArticleModal item={openArticle} onClose={() => setOpen(null)} onRestore={onRestore} onCorrectRegion={onCorrectRegion} />
    </div>
  );
}
