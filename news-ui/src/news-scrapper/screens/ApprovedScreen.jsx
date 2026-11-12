import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import WorkflowBriefingCard from '../components/WorkflowBriefingCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import useModalFocus from '../components/modals/useModalFocus.js';
import { correctRegion, exportExcel, exportPpt, exportWord, getWorkflow, removeWorkflow } from '../api.js';
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

export default function ApprovedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoad] = useState(true);
  const [openArticle, setOpen] = useState(null);
  const [lens, setLens] = useState('All');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);
  const removalDialogRef = useModalFocus(Boolean(pendingRemoval), () => {
    if (!removing) setPendingRemoval(null);
  });

  const refresh = async () => {
    if (loading && items.length) return;
    setLoad(true);
    setError('');
    try {
      const workflow = await getWorkflow();
      setItems(normalizeList(workflow?.approved || []));
    } catch (err) {
      setError(err?.message || 'Could not load the Approved Briefing.');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const highSignals = items.filter((a) => scoreOf(a) >= 80).length;
  const approvedToday = items.filter((item) => String(item.approved_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const topCategory = topValue(items, (item) => item.category);
  const topSelector = topValue(items, (item) => item.selected_by);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (lens === 'High Signal') return scoreOf(item) >= 80;
    if (lens === 'Approved Today') return String(item.approved_at || item.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
    return true;
  }), [items, lens]);
  const requestRemove = (item) => {
    setError('');
    setNotice('');
    setPendingRemoval(item);
  };
  const confirmRemove = async () => {
    const item = pendingRemoval;
    if (!item || removing) return;
    setRemoving(true);
    setError('');
    try {
      await removeWorkflow(item.title, 'approved');
      setItems((arr) => arr.filter((x) => x.title !== item.title));
      trackAction('remove_approved', item.title?.slice(0, 60));
      setOpen((current) => (current?.title === item.title ? null : current));
      setPendingRemoval(null);
      setNotice('Approval removed. The signal is no longer included in approved exports.');
    } catch (err) {
      setError(err?.message || 'Could not remove this approval.');
    } finally {
      setRemoving(false);
    }
  };
  const openDossier = (item) => {
    trackAction('dossier_open', articleActivityDetail(item, 'approved_briefing'));
    setOpen(item);
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setItems((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  const doExport = async (kind) => {
    if (!visibleItems.length || exporting) return;
    setExporting(kind);
    setError('');
    setNotice('');
    trackAction('export', kind);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (kind === 'ppt') await exportPpt(visibleItems, `approved_briefing_${stamp}.pptx`);
      if (kind === 'word') await exportWord(visibleItems, `approved_briefing_${stamp}.docx`);
      if (kind === 'excel') await exportExcel(visibleItems, `approved_briefing_${stamp}.xlsx`);
      setNotice(`${kind === 'ppt' ? 'PowerPoint' : kind === 'word' ? 'Word' : 'Excel'} export downloaded.`);
    } catch (e) {
      setError(`Export failed: ${e.message || e}`);
    } finally {
      setExporting('');
    }
  };

  const exportPdf = () => {
    if (exporting) return;
    setNotice('Print dialog opened. Choose “Save as PDF” to create the file.');
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
          <button className="btn-dark-secondary" disabled={loading} onClick={refresh} type="button"><Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh Briefing'}</button>
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

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.08] p-4 text-sm text-emerald-100" role="status">{notice}</div>}

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
          <p>Generated files use the {visibleItems.length} approved signal{visibleItems.length === 1 ? '' : 's'} currently visible through this lens.</p>
        </div>
        <div className="export-action-grid">
          <button aria-busy={exporting === 'ppt'} className="export-format" onClick={() => doExport('ppt')} disabled={!visibleItems.length || Boolean(exporting)} type="button"><Icon name="download" /><strong>{exporting === 'ppt' ? 'Exporting…' : 'PowerPoint'}</strong><small>Presentation deck</small></button>
          <button className="export-format" onClick={exportPdf} disabled={!visibleItems.length || Boolean(exporting)} type="button"><Icon name="download" /><strong>PDF</strong><small>Print-ready file</small></button>
          <button aria-busy={exporting === 'word'} className="export-format" onClick={() => doExport('word')} disabled={!visibleItems.length || Boolean(exporting)} type="button"><Icon name="download" /><strong>{exporting === 'word' ? 'Exporting…' : 'Word'}</strong><small>Editorial brief</small></button>
          <button aria-busy={exporting === 'excel'} className="export-format primary" onClick={() => doExport('excel')} disabled={!visibleItems.length || Boolean(exporting)} type="button"><Icon name="download" /><strong>{exporting === 'excel' ? 'Exporting…' : 'Excel'}</strong><small>Signal register</small></button>
        </div>
      </section>

      <div className="workflow-filter-rail">
        <div className="workflow-filter-label"><Icon name="filter" size={14} /> Briefing Lens</div>
        {['All', 'High Signal', 'Approved Today'].map((chip) => (
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
        <div className="workflow-empty"><Icon name="refresh" size={24} /><h2>Loading Approved Briefing</h2></div>
      ) : error && items.length === 0 ? (
        <div className="workflow-empty approved"><Icon name="warning" size={26} /><h2>Approved Briefing could not be loaded</h2><p>Your approvals have not been changed.</p><button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" size={14} /> Try again</button></div>
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
              onOpen={openDossier}
              onRemove={requestRemove}
            />
          ))}
        </section>
      )}

      <ArticleModal item={openArticle} onClose={() => setOpen(null)} onRemove={requestRemove} onCorrectRegion={onCorrectRegion} />

      {pendingRemoval && (
        <div className="modal-overlay" onClick={() => { if (!removing) setPendingRemoval(null); }}>
          <section
            aria-describedby="remove-approval-description"
            aria-labelledby="remove-approval-title"
            aria-modal="true"
            className="modal sm compact-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={removalDialogRef}
            role="alertdialog"
            tabIndex={-1}
          >
            <div className="head">
              <Icon name="warning" />
              <h3 id="remove-approval-title">Remove this approval?</h3>
              <button aria-label="Cancel removing approval" className="x" disabled={removing} onClick={() => setPendingRemoval(null)} type="button"><Icon name="x" /></button>
            </div>
            <div className="body">
              <p id="remove-approval-description" className="text-sm leading-6 text-slate-300">
                This immediately removes the signal from Approved Briefing and every approved-only export. It does not delete the source article.
              </p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-semibold leading-6 text-white">
                {pendingRemoval.title}
              </div>
              {error && <div className="mt-3 text-sm text-red-200" role="alert">{error}</div>}
            </div>
            <div className="foot">
              <button className="btn-dark-secondary" disabled={removing} onClick={() => setPendingRemoval(null)} type="button">Keep approved</button>
              <button className="workflow-brief-remove" disabled={removing} onClick={confirmRemove} type="button">
                {removing ? 'Removing…' : 'Remove approval'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
