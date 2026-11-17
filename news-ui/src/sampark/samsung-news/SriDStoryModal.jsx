import React, {
  useEffect,
} from 'react';
import {
  createPortal,
} from 'react-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';
import CreateNewsStoryRenderer from '../create-news/CreateNewsStoryRenderer.jsx';
import '../create-news/create-news.css';
export default function SriDStoryModal({
  item,
  onClose,
}) {
  const dialogRef =
    useModalFocus(
      Boolean(item),
      onClose,
    );
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
  if (!item) {
    return null;
  }
  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <section
        aria-label={
          item.title ||
          'SRI-D story'
        }
        aria-modal="true"
        className="sri-story-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label="Close story"
          className="sri-content-modal-close"
          onClick={onClose}
          type="button"
        >
          <Icon
            name="x"
            size={18}
          />
        </button>
        <div className="sri-story-modal-scroll">
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
      </section>
    </div>,
    document.body,
  );
}
