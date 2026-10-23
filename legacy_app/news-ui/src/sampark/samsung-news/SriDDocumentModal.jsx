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
  const [pdfUrl, setPdfUrl] =
    useState('');
  const [loadingPdf, setLoadingPdf] =
    useState(false);
  const [pdfProblem, setPdfProblem] =
    useState('');
  const sourceDocument =
    sourceDocumentOf(item);
  const originalUrl =
    sourceDocument?.url ||
    '';

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
   * Fetch the original PDF and convert it to a local
   * application/pdf blob URL.
   *
   * This prevents Content-Disposition: attachment
   * from forcing a browser download.
   */
  useEffect(() => {
    if (
      !item ||
      !originalUrl
    ) {
      setPdfUrl('');
      setLoadingPdf(false);
      if (item) {
        setPdfProblem(
          'The original PDF is not available.',
        );
      }
      return undefined;
    }

    let cancelled = false;
    let localUrl = '';

    setPdfUrl('');
    setPdfProblem('');
    setLoadingPdf(true);

    fetch(
      originalUrl,
      {
        credentials:
          'same-origin',
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `PDF request failed (${response.status}).`,
          );
        }
        const sourceBlob =
          await response.blob();
        const pdfBlob =
          sourceBlob.type ===
          'application/pdf'
            ? sourceBlob
            : sourceBlob.slice(
                0,
                sourceBlob.size,
                'application/pdf',
              );
        if (cancelled) {
          return;
        }
        localUrl =
          URL.createObjectURL(
            pdfBlob,
          );
        setPdfUrl(
          localUrl,
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPdfProblem(
          error?.message ||
            'The original PDF could not be opened.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPdf(false);
        }
      });

    return () => {
      cancelled = true;
      if (localUrl) {
        URL.revokeObjectURL(
          localUrl,
        );
      }
    };
  }, [
    item,
    originalUrl,
  ]);

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
              <span className="sri-document-modal-reader-status">
                PDF
              </span>
            </header>

            <div className="sri-document-modal-viewer">
              {loadingPdf && (
                <div
                  className="sri-document-modal-loading"
                  role="status"
                >
                  <span className="sampark-spinner" />
                  <span>
                    Opening document…
                  </span>
                </div>
              )}
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
              {!loadingPdf &&
                !pdfProblem &&
                pdfUrl && (
                  <object
                    className="sri-document-pdf-frame"
                    data={pdfUrl}
                    type="application/pdf"
                  >
                    <iframe
                      className="sri-document-pdf-frame"
                      src={pdfUrl}
                      title={
                        item.title ||
                        sourceDocument?.name ||
                        'PDF document'
                      }
                    />
                  </object>
                )}
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
