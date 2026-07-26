import React, { useEffect, useMemo, useState } from 'react';
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

  const refresh = () => {
    setLoad(true);
    getViewerHidden()
      .then((d) => setItems(normalizeList(d?.items || d || [])))
      .catch(() => {})
      .finally(() => setLoad(false));
  };

  useEffect(refresh, []);

  const groups = useMemo(() => groupedByDate(items), [items]);

  const onRestore = async (item) => {
    setItems((arr) => arr.filter((x) => x.title !== item.title));
    trackAction('restore_personal_hidden', item.title?.slice(0, 60));
    try { await restoreArticleForViewer(item); } catch {}
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setItems((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Hidden Signals</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Review hidden intelligence</h1>
            <p className="mt-3 text-slate-400">{items.length} articles hidden only from your feed. These choices never train the bouncer.</p>
          </div>
          <button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" /> Refresh</button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">Loading Hidden Signals</h2>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
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
              <div className="article-grid grid gap-8 2xl:grid-cols-2">
                {group.map((item) => (
                  <div key={item.id} className="rounded-[22px] border border-white/10 bg-[#101827]/70 p-3 opacity-95 shadow-cockpit">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <span className="signal-chip selected">Hidden only for you</span>
                      <span className="signal-chip">Bouncer not trained</span>
                    </div>
                    <ArticleCard item={{ ...item, rejected_at: item.rejected_at || 'Hidden' }} variant={cardVariant(item)} onOpen={setOpen} />
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      <button className="btn-dark-primary h-9" onClick={() => onRestore(item)} type="button">
                        <Icon name="rotate" /> Restore Signal
                      </button>
                      <button className="btn-dark-secondary h-9" type="button">Keep Hidden</button>
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
