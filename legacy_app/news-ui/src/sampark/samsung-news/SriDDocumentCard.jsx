import React, { useEffect, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { isRecentlyPublishedSamsungItem } from './samsungNewsModel.js';

/**
 * Published documents receive a mapped image_url. Draft previews can receive
 * the private saved record instead, so support both without changing the API.
 */
function documentImageOf(item) {
  const record = item?.record || item?.draft || item;
  const cover = item?.cover || record?.cover;
  const recordId = item?.id || record?.id || item?.recordId || item?.draftId;
  const stamp = record?.updated_at || record?.updatedAt || item?.updated_at || item?.updatedAt || '';
  const privateCoverUrl = cover?.file && recordId
    ? '/internal-content/' + encodeURIComponent(recordId) + '/cover?v=' + encodeURIComponent(stamp)
    : '';
  const candidates = [
    item?.previewCoverUrl, item?.coverPreviewUrl, item?.preview_image_url,
    item?.cover_url, item?.image_url, item?.top_image, item?.imageUrl,
    item?.coverUrl, cover?.url, typeof cover === 'string' ? cover : '',
    record?.image_url, record?.top_image, privateCoverUrl,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

/**
 * Use details actually supplied with the document. In Create News this is
 * typically owner_name; published records may use author or ownerName.
 * Avoid exposing the viewer's internal owner_id.
 */
function documentContributorOf(item) {
  const record = item?.record || item?.draft || item;
  const name = [
    item?.owner_name, item?.ownerName, item?.author,
    record?.owner_name, record?.ownerName, record?.author,
  ].find((value) => typeof value === 'string' && value.trim());
  if (name) return 'By ' + name.trim();
  const count = record?.source_document?.page_count ?? record?.sourceDocument?.pageCount
    ?? item?.source_document?.page_count ?? item?.sourceDocument?.pageCount;
  if (Number.isInteger(Number(count)) && Number(count) > 0)
    return Number(count) + (Number(count) === 1 ? ' page' : ' pages');
  return 'SRI-D document';
}

export default function SriDDocumentCard({ item, onOpen, preview = false, nowMs }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = documentImageOf(item);
  const canOpen = typeof onOpen === 'function';
  useEffect(() => { setImageFailed(false); }, [imageUrl]);
  if (!item) return null;
  return (
    <article className={'samsung-document-card' + (preview ? ' is-preview' : '')}>
      <div className="samsung-document-card-media">
        {imageUrl && !imageFailed ? (
          <img alt="" loading={preview ? 'eager' : 'lazy'} onError={() => setImageFailed(true)} src={imageUrl} />
        ) : (
          <span aria-hidden="true" className="samsung-document-card-media-placeholder">
            <Icon name="file" size={36} />
          </span>
        )}
        <span className="samsung-document-card-media-badge">
          <Icon name="file" size={12} /> PDF
        </span>
        {!preview && isRecentlyPublishedSamsungItem(item, nowMs) && (
          <span className="samsung-published-new-badge is-document">NEW</span>
        )}
      </div>
      <div className="samsung-document-card-body">
        <h3 className="samsung-document-card-title">{item?.title || 'Untitled document'}</h3>
        <div className="samsung-document-card-footer">
          <span className="samsung-document-card-contributor" title={documentContributorOf(item)}>
            {documentContributorOf(item)}
          </span>
          <span className="samsung-document-card-action">View details <Icon name="chevR" size={13} /></span>
        </div>
      </div>
      {/* Single keyboard-accessible hit target, without nested buttons. */}
      <button aria-label={'View document: ' + (item?.title || 'Untitled document')}
        className="samsung-document-card-open-hitarea" disabled={!canOpen}
        onClick={() => onOpen?.(item)} type="button" />
    </article>
  );
}
