import React, { useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

/**
 * The published feed uses image_url while Create News may pass the draft
 * record directly. Keep both paths supported without changing their API.
 */
function documentImageOf(item) {
  const record = item?.record || item?.draft || item;
  const cover = item?.cover || record?.cover;
  const recordId =
    item?.id || record?.id || item?.recordId || item?.draftId;
  const stamp =
    record?.updated_at || record?.updatedAt ||
    item?.updated_at || item?.updatedAt || '';
  const privateCoverUrl =
    cover?.file && recordId
      ? '/internal-content/' + encodeURIComponent(recordId) +
        '/cover?v=' + encodeURIComponent(stamp)
      : '';

  const candidates = [
    item?.previewCoverUrl,
    item?.coverPreviewUrl,
    item?.preview_image_url,
    item?.cover_url,
    item?.image_url,
    item?.top_image,
    item?.imageUrl,
    item?.coverUrl,
    cover?.url,
    typeof cover === 'string' ? cover : '',
    record?.image_url,
    record?.top_image,
    privateCoverUrl,
  ];
  return candidates.find((value) =>
    typeof value === 'string' && value.trim()
  )?.trim() || '';
}

export default function SriDDocumentCard({
  item,
  onOpen,
  preview = false,
  onLike,
  likeActive,
  likeCount = 0,
  busyReaction = false,
}) {
  const [localLiked, setLocalLiked] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = documentImageOf(item);
  const isLiked = typeof likeActive === 'boolean' ? likeActive : localLiked;
  const canOpen = typeof onOpen === 'function';

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);
  useEffect(() => {
    setLocalLiked(false);
  }, [item?.id]);

  if (!item) {
    return null;
  }

  function likeDocument() {
    if (onLike) {
      onLike(item);
    } else {
      // Until the Documents parent supplies persisted reactions, this
      // provides an accessible per-view interaction without fake counts.
      setLocalLiked((previous) => !previous);
    }
  }

  return (
    <article
      className={'samsung-document-card' + (preview ? ' is-preview' : '')}
    >
      <button
        aria-label={'View document: ' + (item?.title || 'Untitled document')}
        className="samsung-document-card-media"
        disabled={!canOpen}
        onClick={() => onOpen?.(item)}
        type="button"
      >
        {imageUrl && !imageFailed ? (
          <img
            alt=""
            loading={preview ? 'eager' : 'lazy'}
            onError={() => setImageFailed(true)}
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
          PDF
        </span>
      </button>

      <div className="samsung-document-card-body">
        <button
          className="samsung-document-card-title"
          disabled={!canOpen}
          onClick={() => onOpen?.(item)}
          type="button"
        >
          {item?.title || 'Untitled document'}
        </button>

        <div className="samsung-document-card-footer">
          <button
            className="samsung-document-card-action"
            disabled={!canOpen}
            onClick={() => onOpen?.(item)}
            type="button"
          >
            View document
            <Icon name="chevR" size={13} />
          </button>

          <button
            aria-label={isLiked ? 'Remove like' : 'Like document'}
            aria-pressed={isLiked}
            className={'samsung-document-card-like' + (isLiked ? ' is-active' : '')}
            disabled={busyReaction}
            onClick={likeDocument}
            title={onLike ? 'Like document' : 'Like (in this view only)'}
            type="button"
          >
            <Icon name="thumbsUp" size={16} />
            {Number(likeCount) > 0 && <span>{likeCount}</span>}
          </button>
        </div>
      </div>
    </article>
  );
}
