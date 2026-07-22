import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { exportExcel, exportPpt, exportWord } from '../../api.js';
import { trackAction } from '../../utils/tracking.js';

const exportTypes = [
  { id: 'ppt', label: 'PowerPoint', ext: 'pptx', action: exportPpt },
  { id: 'word', label: 'Word', ext: 'docx', action: exportWord },
  { id: 'excel', label: 'Excel', ext: 'xlsx', action: exportExcel },
];

export default function DraftExportModal({ items, open, onClose, source = 'briefing' }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setBusy('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const runExport = async (option) => {
    if (!items.length || busy) return;
    setBusy(option.id);
    setError('');
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      await option.action(items, `draft_${source}_${stamp}.${option.ext}`);
      trackAction('draft_export', `${option.id}:${items.length}:${source}`);
      onClose();
    } catch (err) {
      setError(err.message || 'Draft export failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal sm compact-dialog export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="head">
          <div>
            <h3>Draft Export</h3>
            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {items.length} selected signals · Unapproved material
            </div>
          </div>
          <button className="x" onClick={onClose} type="button" aria-label="Close export options">
            <Icon name="x" />
          </button>
        </div>
        <div className="body">
          <p className="mb-5 text-sm leading-6 text-slate-400">
            Create a working draft from the checked signals. Final publication exports remain in Approved Briefing.
          </p>
          <div className="grid gap-3">
            {exportTypes.map((option) => (
              <button
                key={option.id}
                className="export-choice"
                disabled={!!busy}
                onClick={() => runExport(option)}
                type="button"
              >
                <span>
                  <strong>{option.label}</strong>
                  <small>Draft .{option.ext} file</small>
                </span>
                <span className="btn-dark-secondary h-9 px-3">
                  <Icon name="download" size={14} />
                  {busy === option.id ? 'Preparing' : 'Export'}
                </span>
              </button>
            ))}
          </div>
          {error && <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
        </div>
      </section>
    </div>
  );
}
