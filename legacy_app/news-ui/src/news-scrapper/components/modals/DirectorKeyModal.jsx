import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';

export default function DirectorKeyModal({ open, onClose, onConfirm, article }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setKey('');
      setErr('');
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    if (key === '1357') {
      onConfirm(article, key);
      onClose();
    } else {
      setErr('Invalid approval key');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sm compact-dialog approval-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <Icon name="shield" />
          <h3>Approval Required</h3>
          <span className="x" onClick={onClose}><Icon name="x" /></span>
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
              type="password"
              value={key}
              maxLength={4}
              onChange={(e) => { setKey(e.target.value); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="••••"
              autoFocus
            />
            {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
          </div>
        </div>
        <div className="foot">
          <button className="btn-dark-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="btn-dark-primary" onClick={submit} type="button">
            <Icon name="shield" /> Approve Briefing
          </button>
        </div>
      </div>
    </div>
  );
}
