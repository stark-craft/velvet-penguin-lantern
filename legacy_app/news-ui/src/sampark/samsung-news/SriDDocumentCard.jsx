import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

function documentDescriptionOf(item) {
  return String(
    item?.summary ||
    item?.description ||
    '',
  ).trim();
}

export default function SriDDocumentCard({
  item,
  onOpen,
  preview = false,
}) {
  if (!item) {
    return null;
  }

  const description = documentDescriptionOf(item);

  return (
    <article
      className={`samsung-document-card${
        preview ? ' is-preview' : ''
      }`}
    >
      {/* Document identity */}
      <div className="samsung-document-card-top">
        <div
          aria-hidden="true"
          className="samsung-document-card-icon"
        >
          <Icon
            name="file"
            size={22}
          />
        </div>
        <div className="samsung-document-card-kind">
          <span>Internal Document</span>
          {item?.category && (
            <small>
              {typeof item.category === 'object'
                ? item.category?.value ||
                  item.category?.name ||
                  ''
                : item.category}
            </small>
          )}
        </div>
      </div>

      {/* Document title and description */}
      <div className="samsung-document-card-copy">
        <button
          className="samsung-document-card-title"
          onClick={() => onOpen?.(item)}
          type="button"
        >
          {item?.title || 'Untitled document'}
        </button>
        <p>
          {description ||
            'A description will appear here once the document details are complete.'}
        </p>
      </div>

      {/* Primary action */}
      <button
        className="samsung-document-card-action"
        onClick={() => onOpen?.(item)}
        type="button"
      >
        View document
        <Icon
          name="chevR"
          size={13}
        />
      </button>
    </article>
  );
}
