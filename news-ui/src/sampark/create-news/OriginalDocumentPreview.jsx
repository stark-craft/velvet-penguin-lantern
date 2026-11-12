import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { documentIsPdf } from './createNewsModel.js';

export default function OriginalDocumentPreview({ body, onBack, sourceDocument }) {
  if (!sourceDocument) return null;
  const isPdf = documentIsPdf(sourceDocument);
  return (
    <section className="sampark-create-original" aria-label="Original document preview">
      <header>
        <div><span>Original document</span><strong>{sourceDocument.name}</strong></div>
        <button className="sampark-create-secondary" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Back to editor</button>
      </header>
      {isPdf ? (
        <object className="sampark-create-pdf-frame" data={sourceDocument.url} type="application/pdf">
          <p>This browser could not embed the PDF. <a href={sourceDocument.url} rel="noreferrer" target="_blank">Open the original PDF</a>.</p>
        </object>
      ) : (
        <div className="sampark-create-docx-preview">
          <div className="sampark-create-docx-note"><Icon name="file" size={16} /> Word preview uses the extracted text. The original file remains available below.</div>
          <pre>{body || 'No readable text was extracted.'}</pre>
          <a className="sampark-create-secondary" href={sourceDocument.url} rel="noreferrer" target="_blank"><Icon name="download" size={14} /> Open original DOCX</a>
        </div>
      )}
    </section>
  );
}
