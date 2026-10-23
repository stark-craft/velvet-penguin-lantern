import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createPortal,
} from 'react-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import SriDDocumentCard from './SriDDocumentCard.jsx';

function sourceDocumentOf(item) {
  return (
    item?.sourceDocument ||
    item?.source_document ||
    null
  );
}

function summaryOf(item) {
  return String(
    item?.summary ||
    item?.description ||
    item?.record?.summary ||
    item?.draft?.summary ||
    ''
  ).trim();
}

export default function SriDDocumentModal({
  item,
  onClose,
}) {
  const dialogRef =
    useModalFocus(
      Boolean(item),
      onClose,
    );
  const viewerRef =
    useRef(null);
  // Keep only a retry counter; do not create/revoke temporary blob URLs.
  // The browser can stream the authorized PDF directly, including ranges.
  const [viewerAttempt, setViewerAttempt] =
    useState(0);
  const [viewerFailed, setViewerFailed] =
    useState(false);
  const sourceDocument =
    sourceDocumentOf(item);
  const recordId = item?.id || item?.record?.id || item?.draft?.id;
  const originalUrl =
    sourceDocument?.url ||
    (recordId
      ? '/internal-content/' + encodeURIComponent(recordId) + '/document'
      : '');
  const viewerUrl = originalUrl
    ? originalUrl +
      (originalUrl.includes('?') ? '&' : '?') +
      'inline=1&viewer_retry=' + viewerAttempt
    : '';
  const pdfProblem = !viewerUrl
    ? 'The original PDF is not available.'
    : viewerFailed
      ? 'The PDF could not be displayed. Use Reload PDF to retry the viewer without reloading Samsung News.'
      : '';

  /*
   * Keep the same body-lock / modal behavior
   * as the rest of the SRI-D readers.
   */
  useEffect(() => {
    if (!item) {
      return undefined;
    }
    document.body.classList.add(
      'dossier-open',
    );
    return () => {
      document.body.classList.remove(
        'dossier-open',
      );
    };
  }, [item]);

  /*
   * Give each document/retry a fresh iframe URL; browser PDF renderers
   * can request byte ranges at any time. The backend serves these requests
   * inline and keeps the regular download endpoint unchanged.
   *
   * Crucially, no object URL is revoked on modal close or React rerender.
   * The iframe is removed automatically by React when the modal closes.
   */
  useEffect(() => {
    setViewerFailed(false);
  }, [viewerUrl]);

  function reloadPdfOnly() {
    setViewerFailed(false);
    setViewerAttempt((previous) => previous + 1);
  }

  if (!item) {
    return null;
  }

  function focusDocumentViewer() {
    viewerRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <section
        aria-label={
          item.title ||
          'Internal Document'
        }
        aria-modal="true"
        className="sri-document-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label="Close"
          className="sri-content-modal-close"
          onClick={onClose}
          type="button"
        >
          <Icon
            name="x"
            size={18}
          />
        </button>

        <div className="sri-document-modal-layout">
          {/* -----------------------------------------------
              LEFT
              This is intentionally the EXACT shared card
              used by:
              - Create News Preview
              - live SRI-D Documents
              - this document reader
             ----------------------------------------------- */}
          <aside className="sri-document-modal-sidebar">
            <div className="sri-document-modal-sidebar-head">
              <span>
                SRI-D
              </span>
              <strong>
                Document
              </strong>
            </div>
            <SriDDocumentCard
              item={item}
              onOpen={
                focusDocumentViewer
              }
            />

            <section
              aria-label="Document summary"
              className="sri-document-modal-summary"
            >
              <h2>Summary</h2>
              <p>
                {summaryOf(item) ||
                  'No summary is available for this document.'}
              </p>
            </section>
          </aside>

          {/* -----------------------------------------------
              RIGHT — actual original PDF
             ----------------------------------------------- */}
          <div
            className="sri-document-modal-reader"
            ref={viewerRef}
          >
            <header className="sri-document-modal-reader-head">
              <div>
                <span>
                  Original document
                </span>
                <strong>
                  {sourceDocument?.name ||
                    item.title ||
                    'PDF document'}
                </strong>
              </div>
              <div className="sri-document-modal-reader-actions">
                <button
                  aria-label="Reload the PDF viewer only"
                  className="sri-document-modal-retry"
                  disabled={!viewerUrl}
                  onClick={reloadPdfOnly}
                  title="Reload PDF without reloading Samsung News"
                  type="button"
                >
                  <Icon name="refresh" size={13} />
                  Reload PDF
                </button>
                <span className="sri-document-modal-reader-status">
                  PDF
                </span>
              </div>
            </header>

            <div className="sri-document-modal-viewer">
              {pdfProblem && (
                <div
                  className="sri-document-modal-error"
                  role="alert"
                >
                  <Icon
                    name="warning"
                    size={20}
                  />
                  <div>
                    <strong>
                      Document unavailable
                    </strong>
                    <p>
                      {pdfProblem}
                    </p>
                  </div>
                </div>
              )}
              {viewerUrl && !viewerFailed && (
                <iframe
                  className="sri-document-pdf-frame"
                  key={viewerUrl}
                  onError={() => setViewerFailed(true)}
                  src={viewerUrl}
                  title={
                    item.title ||
                    sourceDocument?.name ||
                    'PDF document'
                  }
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
