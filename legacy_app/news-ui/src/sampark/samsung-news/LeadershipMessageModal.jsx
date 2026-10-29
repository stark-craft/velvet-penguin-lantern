import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';

function imageScaleOf(item) {
  return Math.min(1.8, Math.max(0.6, Number(item?.imageScale ?? item?.image_scale ?? 1) || 1));
}

export default function LeadershipMessageModal({ item, onClose }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  useEffect(() => {
    if (!item) return undefined;
    document.body.classList.add('dossier-open');
    return () => document.body.classList.remove('dossier-open');
  }, [item]);
  if (!item) return null;
  const image = item?.cover?.url || item?.image_url || item?.top_image || '';
  const message = item?.body || item?.summary || '';
  // Use the author's published name; do not infer the signature from the viewer.
  const authorName = String(item?.author || item?.ownerName || item?.owner_name || '').trim();
  const signature = authorName ? `— ${authorName} NMEA` : '— NMEA';
  const imageScale = imageScaleOf(item);
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <section aria-labelledby="sri-leadership-title" aria-modal="true" className="sri-leadership-modal"
        onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <button aria-label="Close leadership message" className="sri-content-modal-close"
          onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        <div className="sri-leadership-layout">
          {image && <div className="sri-leadership-portrait">
            <img alt="" src={image} style={{ transform: `scale(${imageScale})` }} />
          </div>}
          <div className="sri-leadership-copy">
            <h1 id="sri-leadership-title">{item.title}</h1>
            <div className="sri-leadership-message">{message}</div>
            <div className="sri-leadership-signature">{signature}</div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
