import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

function documentDescriptionOf(item) {
  return String(
    item?.summary ||
    item?.description ||
    '',
  ).trim();
}

function documentImageOf(item) {
  const candidate =
    item?.image_url ||
    item?.top_image ||
    item?.imageUrl ||
    '';
  return typeof candidate === 'string'
    ? candidate.trim()
    : '';
}

function categoryOf(item) {
  const category = item?.category;
  if (category && typeof category === 'object') {
    return String(category.value || category.name || '').trim();
  }
  return String(category || '').trim();
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
  const imageUrl = documentImageOf(item);
  const category = categoryOf(item);

  return (
    <article
      className={'samsung-document-card' + (preview ? ' is-preview' : '')}
    >
      {/* Same image-first silhouette as the All News article cards. */}
      <button
        aria-label={'Open ' + (item?.title || 'document')}
        className="samsung-document-card-media"
        onClick={() => onOpen?.(item)}
        type="button"
      >
        {imageUrl ? (
          <img
            alt=""
            loading="lazy"
            src={imageUrl}
          />
        ) : (
          <span
            aria-hidden="true"
            className="samsung-document-card-media-placeholder"
          >
            <Icon name="file" size={36} />
          </span>
        )}
        <span className="samsung-document-card-media-badge">
          <Icon name="file" size={12} />
          Document
        </span>
      </button>

      <div className="samsung-document-card-body">
        <div className="samsung-document-card-kind">
          <span>Internal Document</span>
          {category && <small>{category}</small>}
        </div>

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

        <button
          className="samsung-document-card-action"
          onClick={() => onOpen?.(item)}
          type="button"
        >
          View document
          <Icon name="chevR" size={13} />
        </button>
      </div>
    </article>
  );
}
