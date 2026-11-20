import React, { useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';

// IT4U's landing page is the location shown in the internal reference image.
// It is not a deep link to the Unblock Web Request form.
export const IT4U_EXCEPTION_PORTAL = 'https://it4u.sec.samsung.net/itvoc/jsp/new/common/menu/frame.jsp';

// Match only known Hugging Face web hosts. Do not redirect other providers
// (or lookalike domains containing the words "huggingface").
export function isHuggingFaceResearchUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'huggingface.co' || host.endsWith('.huggingface.co') || host === 'hf.co';
  } catch {
    return false;
  }
}

export default function ResearchHuggingFaceNotice({ url, onClose }) {
  const dialogRef = useModalFocus(Boolean(url), onClose);
  const [copyStatus, setCopyStatus] = useState('');
  if (!url) return null;

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('Link copied. Paste this URL in your unblock request.');
    } catch {
      setCopyStatus('Select and copy the link below to include it in your request.');
    }
  };

  return (
    <div className="sampark-modal-overlay research-hf-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="research-hf-notice" role="dialog" aria-modal="true"
        aria-labelledby="research-hf-title" aria-describedby="research-hf-description" tabIndex={-1}>
        <div className="research-hf-header">
          <span className="research-hf-icon" aria-hidden="true"><Icon name="shield" size={22} /></span>
          <button aria-label="Close Hugging Face access notice" className="research-hf-close"
            type="button" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <span className="research-hf-eyebrow">EXTERNAL RESEARCH ACCESS</span>
        <h2 id="research-hf-title">Before opening Hugging Face</h2>
        <p id="research-hf-description">
          Hugging Face may be restricted under your company's network access policy.
          If you have not already received an approved proxy exception, please request
          access through the IT4U portal before opening this source.
        </p>
        <div className="research-hf-link-block">
          <div className="research-hf-link-header">
            <strong>Hugging Face URL to include in your request</strong>
            <button type="button" onClick={copySource}><Icon name="duplicate" size={13} /> Copy URL</button>
          </div>
          <code className="research-hf-url">{url}</code>
          {copyStatus && <span className="research-hf-copy-status" role="status">{copyStatus}</span>}
        </div>
        <div className="research-hf-steps">
          <strong>How to request access</strong>
          <ol>
            <li>Open the internal <strong>IT4U</strong> portal.</li>
            <li>Go to <strong>IT Service → ESCORT Exception → Proxy Exception Request</strong>.</li>
            <li>Select <strong>Unblock Web Request</strong> and submit the Hugging Face URL above for approval.</li>
          </ol>
          <small>Approval and access are managed by your company's IT team; this notice does not grant an exception.</small>
        </div>
        <div className="research-hf-actions">
          <a className="research-hf-action is-secondary" href={IT4U_EXCEPTION_PORTAL}
            target="_blank" rel="noopener noreferrer" onClick={onClose}>
            <Icon name="external" size={15} /> Request proxy exception
          </a>
          <a className="research-hf-action is-primary" href={url}
            target="_blank" rel="noopener noreferrer" onClick={onClose}>
            I already have an exception <Icon name="external" size={15} />
          </a>
        </div>
      </section>
    </div>
  );
}
