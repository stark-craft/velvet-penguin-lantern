import React from 'react';
import Icon from '../Icon.jsx';
import { contentTypeLabel, displayCategory, statusLabel } from '../../internal/contributionModel.js';
import { useCoverPreviewSrc } from './CoverImageInput.jsx';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

export default function ContributionPreview({ contribution, compact = false }) {
  const coverSrc = useCoverPreviewSrc(contribution?.cover);
  const focal = contribution?.cover
    ? { objectPosition: `${(contribution.cover.focalX ?? 0.5) * 100}% ${(contribution.cover.focalY ?? 0.5) * 100}%` }
    : undefined;
  const paragraphs = String(contribution?.body || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <article className={`cw-preview ${compact ? 'is-compact' : ''}`} aria-label="Contribution preview">
      <div className="cw-preview-cover">
        {coverSrc ? (
          <img alt="" src={coverSrc} style={focal} />
        ) : (
          <span aria-hidden="true"><Icon name="note" size={26} /></span>
        )}
      </div>
      <div className="cw-preview-body">
        <div className="cw-preview-meta">
          <span className="cw-preview-category">{displayCategory(contribution)}</span>
          <span className="cw-preview-kind">{contentTypeLabel(contribution?.contentType)}</span>
        </div>
        <h3>{contribution?.title?.trim() || 'Untitled contribution'}</h3>
        {contribution?.summary?.trim() && <p className="cw-preview-summary">{contribution.summary}</p>}
        <footer>
          <span>{contribution?.author?.trim() || 'Internal contributor'}</span>
          {contribution?.team?.trim() && <span> · {contribution.team}</span>}
          <small>
            {contribution?.submittedAt
              ? `Submitted ${formatDate(contribution.submittedAt)}`
              : `Updated ${formatDate(contribution?.updatedAt)}`}
            {' · '}
            {statusLabel(contribution?.status)}
          </small>
        </footer>
      </div>
      {!compact && (
        <div className="cw-preview-article">
          {paragraphs.length ? paragraphs.map((paragraph, index) => (
            <p key={`cw-paragraph-${index}`}>{paragraph}</p>
          )) : (
            <p className="cw-preview-empty">The story body is empty. Imported or written text will appear here as plain reading copy.</p>
          )}
        </div>
      )}
    </article>
  );
}
