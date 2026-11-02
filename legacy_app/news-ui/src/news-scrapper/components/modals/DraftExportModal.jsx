import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Presentation, FileText, Table2, ArrowDownToLine, ShieldAlert, X, LoaderCircle } from 'lucide-react';
import './draft-export-sampark.css';
import Icon from '../Icon.jsx';
import { exportExcel, exportPpt, exportWord } from '../../api.js';
import { trackAction } from '../../utils/tracking.js';
import useModalFocus from './useModalFocus.js';

const exportTypes = [
  { id: 'ppt', label: 'PowerPoint', ext: 'pptx', action: exportPpt },
  { id: 'word', label: 'Word', ext: 'docx', action: exportWord },
  { id: 'excel', label: 'Excel', ext: 'xlsx', action: exportExcel },
];

export default function DraftExportModal({ items, open, onClose, source = 'briefing' }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

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

  // Sampark uses its own contrast-safe dialog. The legacy Sense export modal
  // keeps its original markup and classes to avoid any browser-side regressions.
  if (source.startsWith('sampark')) {
    const selectedCount = items.length;
    const labels = [
      { id: 'ppt', icon: Presentation, title: 'PowerPoint', detail: 'Presentation slides', tone: 'violet' },
      { id: 'word', icon: FileText, title: 'Word', detail: 'Editable document', tone: 'blue' },
      { id: 'excel', icon: Table2, title: 'Excel', detail: 'Structured spreadsheet', tone: 'green' },
    ];

    return createPortal(
      <div className="sde-overlay" onMouseDown={busy ? undefined : onClose}>
        <section
          ref={dialogRef}
          className="sde-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sde-title"
          aria-describedby="sde-description"
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="sde-header">
            <div className="sde-heading">
              <span className="sde-kicker">SAMPARK / DOCUMENT EXPORT</span>
              <div className="sde-title-row">
                <span className="sde-title-icon"><ArrowDownToLine size={23}/></span>
                <div>
                  <h2 id="sde-title">Export draft</h2>
                  <p>Choose a format for your selected articles.</p>
                </div>
              </div>
            </div>
            <button
              className="sde-close"
              type="button"
              onClick={onClose}
              disabled={!!busy}
              aria-label="Close export options"
            ><X size={19}/></button>
          </header>

          <div className="sde-content">
            <div className="sde-summary">
              <span className="sde-count">{selectedCount} {selectedCount === 1 ? 'article' : 'articles'} selected</span>
              <span className="sde-summary-separator" aria-hidden="true"/>
              <span className="sde-draft-label"><span className="sde-draft-dot"/>Working draft</span>
            </div>
            <p id="sde-description" className="sde-description">
              Export the checked articles into a working draft. Official publication exports remain in Approved Briefing.
            </p>

            <div className="sde-format-head">
              <span>AVAILABLE FORMATS</span>
              <span>Choose one</span>
            </div>
            <div className="sde-options">
              {labels.map((choice) => {
                const option = exportTypes.find((entry) => entry.id === choice.id);
                const Glyph = choice.icon;
                const working = busy === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`sde-option sde-option--${choice.tone}${working ? ' is-working' : ''}`}
                    onClick={() => runExport(option)}
                    aria-busy={working}
                    disabled={!!busy || !selectedCount}
                  >
                    <span className="sde-option-icon"><Glyph size={22}/></span>
                    <span className="sde-option-copy">
                      <strong>{choice.title}</strong>
                      <span>{choice.detail} <span aria-hidden="true">·</span> .{option.ext}</span>
                    </span>
                    <span className="sde-option-action">
                      {working ? <LoaderCircle className="sde-spinner" size={16}/> : <ArrowDownToLine size={16}/>}
                      <span>{working ? 'Preparing…' : 'Export'}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {busy && (
              <div className="sde-working" role="status" aria-live="polite">
                <LoaderCircle size={16} className="sde-spinner"/>
                Preparing your {exportTypes.find((option) => option.id === busy)?.label || 'draft'} file…
              </div>
            )}
            {error && (
              <div className="sde-error" role="alert">
                <ShieldAlert size={18}/>
                <span>{error}</span>
              </div>
            )}

            <div className="sde-notice">
              <ShieldAlert size={17}/>
              <span>These files contain unapproved material. Review before sharing or publishing.</span>
            </div>
          </div>
          <footer className="sde-footer">
            <span>TechScout · Draft workspace</span>
            <button type="button" onClick={onClose} disabled={!!busy}>Cancel</button>
          </footer>
        </section>
      </div>,
      document.body,
    );
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <section aria-labelledby="draft-export-title" aria-modal="true" className="modal sm compact-dialog export-modal" onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="head">
          <div>
            <h3 id="draft-export-title">Draft Export</h3>
            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {items.length} selected signals · Unapproved material
            </div>
          </div>
          <button className="x" disabled={!!busy} onClick={onClose} type="button" aria-label="Close export options">
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
                aria-busy={busy === option.id}
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
          {error && <div className="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200" role="alert">{error}</div>}
        </div>
      </section>
    </div>
  );
}
