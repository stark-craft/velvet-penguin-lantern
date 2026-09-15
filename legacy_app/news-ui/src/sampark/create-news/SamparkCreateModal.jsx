import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import SamparkCreate from '../SamparkCreate.jsx';
import './create-news.css';

export default function SamparkCreateModal({ onClose }) {
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const attemptClose = useCallback(() => {
    if (hasUnsaved && !window.confirm('You have unsaved work. Discard and close?')) return;
    onClose();
  }, [hasUnsaved, onClose]);
  const dialogRef = useModalFocus(true, attemptClose);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="sampark-create-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) attemptClose(); }} role="presentation">
      <section aria-labelledby="sampark-create-modal-title" aria-modal="true" className="sampark-create-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-create-modal-head"><div><h2 id="sampark-create-modal-title">Create News</h2><p>Samsung Research Institute Delhi</p></div><button aria-label="Close Create News" onClick={attemptClose} type="button"><Icon name="x" size={18} /></button></header>
        <div className="sampark-create-modal-body"><SamparkCreate isModal onDirtyChange={setHasUnsaved} onRequestClose={attemptClose} /></div>
      </section>
    </div>
  );
}
