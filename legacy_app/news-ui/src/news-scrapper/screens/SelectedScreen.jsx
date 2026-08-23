import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import WorkflowBriefingCard from '../components/WorkflowBriefingCard.jsx';
import ContributionReviewDesk from '../components/ContributionReviewDesk.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DirectorKeyModal from '../components/modals/DirectorKeyModal.jsx';
import { approveWorkflow, correctRegion, getWorkflow, removeWorkflow } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { articleActivityDetail, trackAction } from '../utils/tracking.js';
import { scoreOf } from '../utils/intelligence.js';

function topValue(items, getter) {
  const counts = new Map();
  items.forEach((item) => {
    const value = getter(item);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

const REVIEW_DESK_VIEWS = ['news', 'contributions'];

function initialReviewDeskView() {
  if (typeof window === 'undefined') return 'news';
  const stored = window.sessionStorage.getItem('review-desk-tab');
  return REVIEW_DESK_VIEWS.includes(stored) ? stored : 'news';
}

export default function SelectedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoad] = useState(true);
  const [openArticle, setOpen] = useState(null);
  const [pending, setPending] = useState(null);
  const [lens, setLens] = useState('All');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyActions, setBusyActions] = useState({});
  const [deskView, setDeskView] = useState(initialReviewDeskView);
  const actionLocks = useRef(new Set());

  useEffect(() => { window.sessionStorage.setItem('review-desk-tab', deskView); }, [deskView]);

  const refresh = async () => {
    if (loading && items.length) return;
    setLoad(true);
    setError('');
    try {
      const workflow = await getWorkflow();
      setItems(normalizeList(workflow?.selected || []));
    } catch (err) {
      setError(err?.message || 'Could not load the Review Queue.');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const highSignals = items.filter((a) => scoreOf(a) >= 80).length;
  const topSelector = topValue(items, (item) => item.selected_by);
  const topCategory = topValue(items, (item) => item.category);
  const selectedToday = items.filter((item) => String(item.selected_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const visibleItems = useMemo(() => items.filter((item) => {
    if (lens === 'High Signal') return scoreOf(item) >= 80;
    if (lens === 'Selected Today') return String(item.selected_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
    return true;
  }), [items, lens]);
  const onApprove = (item) => setPending(item);
  const openDossier = (item) => {
    trackAction('dossier_open', articleActivityDetail(item, 'review_queue'));
    setOpen(item);
  };
  const confirmApprove = async (item, key) => {
    const actionKey = item.id || item.title;
    if (actionLocks.current.has(actionKey)) return;
    actionLocks.current.add(actionKey);
    setBusyActions((current) => ({ ...current, [actionKey]: 'approve' }));
    setError('');
    setNotice('');
    try {
      await approveWorkflow(item.title, key);
      setItems((arr) => arr.filter((x) => x.title !== item.title));
      trackAction('approve', item.title?.slice(0, 60));
      setNotice('Signal approved and moved to Approved Briefing.');
    } catch (err) {
      setError(err?.message || 'Approval failed. The signal remains in Review Queue.');
      throw err;
    } finally {
      actionLocks.current.delete(actionKey);
      setBusyActions((current) => { const next = { ...current }; delete next[actionKey]; return next; });
    }
  };

  const onRemove = async (item) => {
    const actionKey = item.id || item.title;
    if (actionLocks.current.has(actionKey)) return;
    actionLocks.current.add(actionKey);
    setBusyActions((current) => ({ ...current, [actionKey]: 'remove' }));
    setError('');
    setNotice('');
    try {
      await removeWorkflow(item.title, 'selected');
      setItems((arr) => arr.filter((x) => x.title !== item.title));
      trackAction('remove_selected', item.title?.slice(0, 60));
      setNotice('Signal removed from Review Queue.');
    } catch (err) {
      setError(err?.message || 'Could not remove this signal from Review Queue.');
    } finally {
      actionLocks.current.delete(actionKey);
      setBusyActions((current) => { const next = { ...current }; delete next[actionKey]; return next; });
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
    <div className="workflow-page review-page space-y-6">
      <section className="workflow-console review-console">
        <div className="workflow-console-main">
          <div>
            <div className="eyebrow">Review Queue / Approval Workspace</div>
            <h1>Review selected signals.</h1>
            <p>Open dossiers, verify the coverage, and approve the items that belong in the final briefing.</p>
          </div>
          <button className="btn-dark-secondary" disabled={loading} onClick={refresh} type="button"><Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh Queue'}</button>
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

      <div className="review-desk-tabs" role="tablist" aria-label="Review surfaces">
        {[
          { id: 'news', label: 'News signals' },
          { id: 'contributions', label: 'Contributions' },
        ].map((view) => (
          <button
            aria-selected={deskView === view.id}
            className={deskView === view.id ? 'active' : ''}
            key={view.id}
            onClick={() => setDeskView(view.id)}
            role="tab"
            type="button"
          >
            {view.label}
          </button>
        ))}
      </div>

      {deskView === 'contributions' ? (
        <ContributionReviewDesk />
      ) : (
        <>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

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
            aria-pressed={lens === chip}
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
      ) : error && items.length === 0 ? (
        <div className="workflow-empty"><Icon name="warning" size={26} /><h2>Review Queue could not be loaded</h2><p>Your workflow has not been changed.</p><button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" size={14} /> Try again</button></div>
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
        <section className="workflow-card-grid">
          {visibleItems.map((item) => (
            <WorkflowBriefingCard
              key={item.id}
              item={item}
              mode="review"
              busyAction={busyActions[item.id || item.title] || ''}
              onOpen={openDossier}
              onApprove={onApprove}
              onRemove={onRemove}
            />
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
        </>
      )}
    </div>
  );
}
