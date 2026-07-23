import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import WorkflowBriefingCard from '../components/WorkflowBriefingCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import { correctRegion, exportExcel, exportPpt, exportWord, getWorkflow, removeWorkflow } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { trackAction } from '../utils/tracking.js';
import { scoreOf } from '../utils/intelligence.js';

function topValue(items, getter) {
  const counts = new Map();
  items.forEach((item) => {
    const value = getter(item);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export default function ApprovedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoad] = useState(true);
  const [openArticle, setOpen] = useState(null);
  const [lens, setLens] = useState('All');

  const refresh = () => {
    setLoad(true);
    getWorkflow()
      .then((w) => setItems(normalizeList(w?.approved || [])))
      .catch(() => {})
      .finally(() => setLoad(false));
  };

  useEffect(refresh, []);

  const highSignals = items.filter((a) => scoreOf(a) >= 80).length;
  const approvedToday = items.filter((item) => String(item.approved_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const topCategory = topValue(items, (item) => item.category);
  const topSelector = topValue(items, (item) => item.selected_by);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (lens === 'High Signal') return scoreOf(item) >= 80;
    if (lens === 'Approved Today') return String(item.approved_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
    return true;
  }), [items, lens]);
  const onRemove = async (item) => {
    setItems((arr) => arr.filter((x) => x.title !== item.title));
    trackAction('remove_approved', item.title?.slice(0, 60));
    try { await removeWorkflow(item.title, 'approved'); } catch {}
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setItems((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  const doExport = async (kind) => {
    if (!items.length) return;
    trackAction('export', kind);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (kind === 'ppt') await exportPpt(items, `approved_briefing_${stamp}.pptx`);
      if (kind === 'word') await exportWord(items, `approved_briefing_${stamp}.docx`);
      if (kind === 'excel') await exportExcel(items, `approved_briefing_${stamp}.xlsx`);
    } catch (e) {
      alert('Export failed: ' + (e.message || e));
    }
  };

  const exportPdf = () => {
    window.print();
  };

  return (
    <div className="workflow-page approved-page space-y-6">
      <section className="workflow-console approved-console">
        <div className="workflow-console-main">
          <div>
            <div className="eyebrow">Approved Briefing / Export Workspace</div>
            <h1>Prepare the final briefing.</h1>
            <p>Approved signals are ready for packaging and export. Draft items remain outside this workspace.</p>
          </div>
          <button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" /> Refresh Briefing</button>
        </div>
        <aside className="workflow-status approved">
          <div className="workflow-status-head"><span className="workflow-beacon approved" /> Ready for Export</div>
          <div className="workflow-status-grid">
            <div><strong>{items.length}</strong><span>Approved</span></div>
            <div><strong>{approvedToday}</strong><span>Today</span></div>
            <div><strong>{highSignals}</strong><span>High signal</span></div>
          </div>
          <p>Exports include approved briefing material only.</p>
        </aside>
      </section>

      <section className="workflow-metric-row approved">
        <div className="workflow-metric"><Icon name="check2" /><span>Total approved</span><strong>{items.length}</strong></div>
        <div className="workflow-metric"><Icon name="download" /><span>Export ready</span><strong>{items.length}</strong></div>
        <div className="workflow-metric"><Icon name="trend" /><span>High signal</span><strong>{highSignals}</strong></div>
        {topCategory && <div className="workflow-metric"><Icon name="layers" /><span>Top category</span><strong>{topCategory}</strong></div>}
        {topSelector && <div className="workflow-metric"><Icon name="check" /><span>Most active selector</span><strong>{topSelector}</strong></div>}
      </section>

      <section className="export-workspace">
        <div>
          <div className="eyebrow">Export Briefing</div>
          <h2>Choose a final delivery format</h2>
          <p>All generated files use the approved set currently shown in this briefing.</p>
        </div>
        <div className="export-action-grid">
          <button className="export-format" onClick={() => doExport('ppt')} disabled={!items.length} type="button"><Icon name="download" /><strong>PowerPoint</strong><small>Presentation deck</small></button>
          <button className="export-format" onClick={exportPdf} disabled={!items.length} type="button"><Icon name="download" /><strong>PDF</strong><small>Print-ready file</small></button>
          <button className="export-format" onClick={() => doExport('word')} disabled={!items.length} type="button"><Icon name="download" /><strong>Word</strong><small>Editorial brief</small></button>
          <button className="export-format primary" onClick={() => doExport('excel')} disabled={!items.length} type="button"><Icon name="download" /><strong>Excel</strong><small>Signal register</small></button>
        </div>
      </section>

      <div className="workflow-filter-rail">
        <div className="workflow-filter-label"><Icon name="filter" size={14} /> Briefing Lens</div>
        {['All', 'High Signal', 'Approved Today'].map((chip) => (
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
        <div className="workflow-empty"><Icon name="refresh" size={24} /><h2>Loading Approved Briefing</h2></div>
      ) : items.length === 0 ? (
        <div className="workflow-empty approved">
          <Icon name="check2" size={28} />
          <h2>No approved signals yet</h2>
          <p>Approve items in Review Queue before creating a final export.</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="workflow-empty approved">
          <Icon name="filter" size={26} />
          <h2>No approved signals match this lens</h2>
          <p>Choose a different briefing lens to see other approved items.</p>
        </div>
      ) : (
        <section className="workflow-card-grid">
          {visibleItems.map((item) => (
            <WorkflowBriefingCard
              key={item.id}
              item={{ ...item, approved_at: item.approved_at || 'Approved' }}
              mode="approved"
              onOpen={setOpen}
              onRemove={onRemove}
            />
          ))}
        </section>
      )}

      <ArticleModal item={openArticle} onClose={() => setOpen(null)} onRemove={onRemove} onCorrectRegion={onCorrectRegion} />
    </div>
  );
}
