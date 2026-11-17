import React, {
  useEffect,
} from 'react';

import {
  createPortal,
} from 'react-dom';

import Icon from '../../news-scrapper/components/Icon.jsx';
import useModalFocus from '../../news-scrapper/components/modals/useModalFocus.js';


function typeLabel(item) {
  const type = String(
    item?.contentType ||
    item?.content_type ||
    item?.samsung_internal_kind ||
    '',
  )
    .trim()
    .toLowerCase();

  if (type === 'leadership') {
    return 'Leadership Message';
  }

  if (type === 'announcement') {
    return 'Announcement';
  }

  return 'Story';
}


function imageOf(item) {
  return (
    item?.image_url ||
    item?.top_image ||
    item?.cover?.url ||
    ''
  );
}


export default function SriDInternalModal({
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

  const image =
    imageOf(item);

  const label =
    typeLabel(item);

  const summary =
    String(
      item.summary ||
      '',
    ).trim();

  const body =
    String(
      item.body ||
      item.full_content ||
      item.full_contents ||
      '',
    ).trim();

  const byline =
    [
      item.author,
      item.team,
    ]
      .filter(Boolean)
      .join(' · ');

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <section
        aria-label={
          item.title ||
          label
        }
        aria-modal="true"
        className={
          `sri-internal-modal is-${
            String(
              item.contentType ||
              'story',
            )
          }`
        }
        onClick={
          (event) =>
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

        <div className="sri-internal-modal-scroll">

          {image && (
            <div className="sri-internal-modal-media">
              <img
                alt=""
                src={image}
              />
            </div>
          )}

          <article className="sri-internal-modal-copy">

            <div className="sri-internal-modal-meta">
              <span>
                {label}
              </span>

              {item.date && (
                <small>
                  {item.date}
                </small>
              )}
            </div>

            <h1>
              {item.title}
            </h1>

            {summary && (
              <p className="sri-internal-modal-summary">
                {summary}
              </p>
            )}

            {body &&
              body !== summary && (
                <div className="sri-internal-modal-body">
                  {body}
                </div>
              )}

            {byline && (
              <footer>
                {byline}
              </footer>
            )}

          </article>
        </div>
      </section>
    </div>,
    document.body,
  );
}
