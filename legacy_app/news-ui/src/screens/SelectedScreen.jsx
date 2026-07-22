import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DirectorKeyModal from '../components/modals/DirectorKeyModal.jsx';
import { approveWorkflow, correctRegion, getWorkflow, removeWorkflow } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { trackAction } from '../utils/tracking.js';
import { cardVariant, groupedByDate, scoreOf } from '../utils/intelligence.js';

function topValue(items, getter) {
  const counts = new Map();
  items.forEach((item) => {
    const value = getter(item);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export default function SelectedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoad] = useState(true);
  const [openArticle, setOpen] = useState(null);
  const [pending, setPending] = useState(null);
  const [lens, setLens] = useState('All');

  const refresh = () => {
    setLoad(true);
    getWorkflow()
      .then((w) => setItems(normalizeList(w?.selected || [])))
      .catch(() => {})
      .finally(() => setLoad(false));
  };

  useEffect(refresh, []);

  const highSignals = items.filter((a) => scoreOf(a) >= 80).length;
  const topSelector = topValue(items, (item) => item.selected_by);
  const topCategory = topValue(items, (item) => item.category);
  const selectedToday = items.filter((item) => String(item.selected_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const visibleItems = useMemo(() => items.filter((item) => {
    if (lens === 'High Signal') return scoreOf(item) >= 80;
    if (lens === 'Selected Today') return String(item.selected_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
    return true;
  }), [items, lens]);
  const groups = useMemo(() => groupedByDate(visibleItems), [visibleItems]);

  const onApprove = (item) => setPending(item);
  const confirmApprove = async (item, key) => {
    setItems((arr) => arr.filter((x) => x.title !== item.title));
    trackAction('approve', item.title?.slice(0, 60));
    try { await approveWorkflow(item.title, key); } catch {}
  };

  const onRemove = async (item) => {
    setItems((arr) => arr.filter((x) => x.title !== item.title));
    trackAction('remove_selected', item.title?.slice(0, 60));
    try { await removeWorkflow(item.title, 'selected'); } catch {}
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setItems((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  return (
    <div className="workflow-page review-page space-y-6">
      <section className="workflow-console review-console">
        <div className="workflow-console-main">
          <div>
            <div className="eyebrow">Review Queue / Approval Workspace</div>
            <h1>Review selected signals.</h1>
            <p>Open dossiers, verify the coverage, and approve the items that belong in the final briefing.</p>
          </div>
          <button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" /> Refresh Queue</button>
        </div>
        <aside className="workflow-status">
          <div className="workflow-status-head"><span className="workflow-beacon review" /> Awaiting Approval</div>
          <div className="workflow-status-grid">
            <div><strong>{items.length}</strong><span>In review</span></div>
            <div><strong>{highSignals}</strong><span>High signal</span></div>
            <div><strong>{selectedToday}</strong><span>Added today</span></div>
          </div>
          <p>Approving an item requires the 4-digit approval key.</p>
        </aside>
      </section>

      <section className="workflow-metric-row">
        <div className="workflow-metric"><Icon name="inbox" /><span>Total in review</span><strong>{items.length}</strong></div>
        <div className="workflow-metric"><Icon name="trend" /><span>High signal</span><strong>{highSignals}</strong></div>
        {topSelector && <div className="workflow-metric"><Icon name="check" /><span>Most active selector</span><strong>{topSelector}</strong></div>}
        {topCategory && <div className="workflow-metric"><Icon name="layers" /><span>Top category</span><strong>{topCategory}</strong></div>}
      </section>

      <div className="workflow-filter-rail">
        <div className="workflow-filter-label"><Icon name="filter" size={14} /> Queue Lens</div>
        {['All', 'High Signal', 'Selected Today'].map((chip) => (
          <button
            key={chip}
            className={lens === chip ? 'workflow-filter-chip active' : 'workflow-filter-chip'}
            onClick={() => setLens(chip)}
            type="button"
          >
            {chip}
          </button>
        ))}
        <span className="workflow-result-count">{visibleItems.length} visible</span>
      </div>

      {loading ? (
        <div className="workflow-empty"><Icon name="refresh" size={24} /><h2>Loading Review Queue</h2></div>
      ) : items.length === 0 ? (
        <div className="workflow-empty">
          <Icon name="inbox" size={26} />
          <h2>No items in review</h2>
          <p>Signals selected from Intelligence Briefing or Deep Search will appear here.</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="workflow-empty">
          <Icon name="filter" size={26} />
          <h2>No signals match this lens</h2>
          <p>Change the queue lens to view other selected signals.</p>
        </div>
      ) : (
        <section className="space-y-8">
          {Object.entries(groups).map(([day, group]) => (
            <div key={day} className="space-y-4">
              <div className="workflow-day-head">
                <h2>{day}</h2>
                <div />
                <span>{group.length} selected</span>
              </div>
              <div className="article-grid grid gap-8 2xl:grid-cols-2">
                {group.map((item) => (
                  <div key={item.id} className="workflow-article-frame review">
                    <ArticleCard
                      item={item}
                      variant={cardVariant(item)}
                      onOpen={setOpen}
                      isSelected
                    />
                    <div className="workflow-article-actions">
                      <span className="signal-chip selected">Selected by {item.selected_by || 'team'}</span>
                      {item.selected_at && <span className="text-sm text-slate-500">{item.selected_at}</span>}
                      <button className="btn-dark-primary h-9" onClick={() => onApprove(item)} type="button">
                        <Icon name="shield" /> Approve Briefing
                      </button>
                      <button className="btn-dark-secondary h-9" onClick={() => setOpen(item)} type="button">Open Dossier</button>
                      <button className="btn-dark-secondary h-9" onClick={() => onRemove(item)} type="button">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <ArticleModal
        item={openArticle}
        onClose={() => setOpen(null)}
        onApprove={onApprove}
        onRemove={onRemove}
        onCorrectRegion={onCorrectRegion}
      />
      <DirectorKeyModal open={!!pending} article={pending} onClose={() => setPending(null)} onConfirm={confirmApprove} />
    </div>
  );
}
