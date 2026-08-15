import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import useModalFocus from './useModalFocus.js';

export default function DirectorKeyModal({ open, onClose, onConfirm, article }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, onClose);

  useEffect(() => {
    if (open) {
      setKey('');
      setErr('');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (key === '1357') {
      setBusy(true);
      setErr('');
      try {
        await onConfirm(article, key);
        onClose();
      } catch (error) {
        setErr(error?.message || 'Approval could not be completed. Please try again.');
      } finally {
        setBusy(false);
      }
    } else {
      setErr('Invalid approval key');
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div aria-labelledby="approval-dialog-title" aria-modal="true" className="modal sm compact-dialog approval-dialog" onClick={(e) => e.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="head">
          <Icon name="shield" />
          <h3 id="approval-dialog-title">Approval Required</h3>
          <button aria-label="Close approval dialog" className="x" disabled={busy} onClick={onClose} type="button"><Icon name="x" /></button>
        </div>
        <div className="body">
          <div className="text-sm text-slate-400">Enter 4-digit approval key.</div>
          {article && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{article.src} · {article.ago}</div>
              <div className="mt-2 text-sm font-semibold leading-snug text-slate-100">{article.title}</div>
            </div>
          )}
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Approval key</div>
            <input
              className="dark-input text-center tracking-[0.45em]"
              aria-describedby={err ? 'approval-dialog-error' : undefined}
              aria-invalid={Boolean(err)}
              disabled={busy}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={key}
              maxLength={4}
              onChange={(e) => { setKey(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="••••"
              autoFocus
            />
            {err && <div className="mt-2 text-sm text-red-300" id="approval-dialog-error" role="alert">{err}</div>}
          </div>
        </div>
        <div className="foot">
          <button className="btn-dark-secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button aria-busy={busy} className="btn-dark-primary" disabled={busy} onClick={submit} type="button">
            <Icon name="shield" /> {busy ? 'Approving…' : 'Approve Briefing'}
          </button>
        </div>
      </div>
    </div>
  );
}
