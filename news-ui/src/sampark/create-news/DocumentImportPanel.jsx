import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

export default function DocumentImportPanel({
  disabled = false,
  fileInputRef,
  onChoose,
  onPreview,
  processing = false,
  sourceDocument = null,
}) {
  return (
    <section className="sampark-create-document-panel">
      <div className="sampark-create-document-copy">
        <span className="sampark-create-document-icon"><Icon name="file" size={20} /></span>
        <div>
          <strong>{sourceDocument ? sourceDocument.name : 'Start from a document'}</strong>
          <p>{sourceDocument ? 'The extracted copy is editable below. You can also preview the original.' : 'Upload a PDF or Word document and we will open it in this editor.'}</p>
        </div>
      </div>
      <div className="sampark-create-document-actions">
        <input
          ref={fileInputRef}
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(event) => onChoose(event.target.files?.[0])}
          type="file"
        />
        {sourceDocument && <button className="sampark-create-secondary" onClick={onPreview} type="button"><Icon name="eye" size={14} /> Preview original</button>}
        <button className="sampark-create-secondary" disabled={disabled || processing} onClick={() => fileInputRef.current?.click()} type="button">
          <Icon name={sourceDocument ? 'check2' : 'upload'} size={14} /> {processing ? 'Extracting…' : sourceDocument ? 'Document imported' : 'Import PDF/DOCX'}
        </button>
      </div>
      {disabled && !sourceDocument && <small>Start a new story to import a document.</small>}
    </section>
  );
}
