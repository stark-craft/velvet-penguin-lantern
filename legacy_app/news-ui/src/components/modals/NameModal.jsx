import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';

export default function NameModal({
  open,
  onClose,
  onConfirm,
  article,
  title = 'Select for Review',
  description = 'Enter your name to continue.',
  confirmLabel = 'Confirm Selection',
}) {
  const [name, setName] = useState(
    localStorage.getItem('news-viewer-name')
    || localStorage.getItem('initiator-name')
    || ''
  );
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setName(
        localStorage.getItem('news-viewer-name')
        || localStorage.getItem('initiator-name')
        || ''
      );
      setErr('');
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const v = name.trim();
    if (!v) {
      setErr('Name is required to send articles to Review Queue.');
      return;
    }
    localStorage.setItem('initiator-name', v);
    onConfirm(article, v);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sm compact-dialog selection-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <Icon name="check" />
          <h3>{title}</h3>
          <span className="x" onClick={onClose}><Icon name="x" /></span>
        </div>
        <div className="body">
          <div className="text-sm text-slate-400">
            {name ? `This action will be attributed to ${name}.` : description}
          </div>
          {article?.title && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{article.src || 'Review Queue'}</div>
              <div className="mt-2 text-sm font-semibold leading-snug text-slate-100">{article.title}</div>
            </div>
          )}
          {name ? (
            <div className="selection-identity mt-5">
              <span>{name.slice(0, 2).toUpperCase()}</span>
              <div>
                <small>Submitting as</small>
                <strong>{name}</strong>
              </div>
              <Icon name="shield" size={16} />
            </div>
          ) : (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Name</div>
              <input
                className="dark-input"
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="Set up your viewer profile"
                autoFocus
              />
            </div>
          )}
          {err && <div className="mt-2 text-sm text-red-300">{err}</div>}
        </div>
        <div className="foot">
          <button className="btn-dark-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="btn-dark-primary" onClick={submit} type="button">
            <Icon name="check" /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
