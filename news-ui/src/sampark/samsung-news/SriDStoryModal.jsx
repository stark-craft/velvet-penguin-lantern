import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import CreateNewsStoryRenderer from '../create-news/CreateNewsStoryRenderer.jsx';
import '../create-news/create-news.css';
import './sri-story-reader.css';

// Published stories use the same reading shell as the internal PDF dossier.
// The selected Create News template still owns all authored content/layout.
export default function SriDStoryModal({ item, onClose }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  useEffect(() => {
    if (!item) return undefined;
    document.body.classList.add('dossier-open');
    return () => {
      document.body.classList.remove('dossier-open');
    };
  }, [item]);

  if (!item) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby="sri-story-reader-title"
        aria-modal="true"
        className="modal dossier dossier--for-you sri-story-reader"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="head dossier-head">
          <div>
            <h3 id="sri-story-reader-title">Story Details</h3>
          </div>
          <button aria-label="Close story" className="x" onClick={onClose} type="button">
            <Icon name="x" />
          </button>
        </div>
        <div className="dossier-layout grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="dossier-reading overflow-y-auto p-5 sm:p-6">
            <CreateNewsStoryRenderer
              author={
                item.author
              }
              category={
                item.category
              }
              coverPreview={
                item.cover?.url ||
                ''
              }
              displaySection={
                item.displaySection ||
                'srid'
              }
              layout={
                item.layout ||
                'two-column'
              }
              mode="published"
              secondaryCoverPreview={
                item.secondaryCover
                  ?.url ||
                ''
              }
              summary={
                item.summary
              }
              team={
                item.team
              }
              templateData={
                item.templateData ||
                {}
              }
              title={
                item.title
              }
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
