import React from 'react';
import Icon from './Icon.jsx';
import { SignalVisual } from './ArticleCard.jsx';
import { scoreOf } from '../utils/intelligence.js';

function displayDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function WorkflowBriefingCard({
  item,
  mode = 'review',
  onOpen,
  onApprove,
  onRemove,
}) {
  const approved = mode === 'approved';
  const score = scoreOf(item);
  const eventDate = approved
    ? (item.approved_at || item.date)
    : (item.selected_at || item.date);

  return (
    <article className={`workflow-brief-card ${mode}`}>
      <button
        className="workflow-brief-visual"
        onClick={() => onOpen(item)}
        type="button"
        aria-label={`Open dossier for ${item.title}`}
      >
        <SignalVisual item={item} label={false} />
        <span className="workflow-brief-visual-shade" />
        <span className={`workflow-brief-status ${mode}`}>
          <Icon name={approved ? 'check2' : 'inbox'} size={13} />
          {approved ? 'Approved' : 'In review'}
        </span>
        <span className="workflow-brief-score">Signal {score}</span>
      </button>

      <div className="workflow-brief-body">
        <div className="workflow-brief-meta">
          <span>{item.category || 'News'}</span>
          <i />
          <span>{item.region || 'Global'}</span>
          <i />
          <span>{item.source_count || 1} source{(item.source_count || 1) === 1 ? '' : 's'}</span>
        </div>

        <button className="workflow-brief-copy" onClick={() => onOpen(item)} type="button">
          <h3>{item.title}</h3>
          <p>{item.summary || 'No summary is available for this signal yet.'}</p>
        </button>

        <div className="workflow-brief-provenance">
          <div>
            <span>{approved ? 'Approved by' : 'Selected by'}</span>
            <strong>
              {approved
                ? (item.approved_by || item.selected_by || 'Briefing team')
                : (item.selected_by || 'Briefing team')}
            </strong>
          </div>
          <time dateTime={eventDate || undefined}>{displayDate(eventDate)}</time>
        </div>
      </div>

      <footer className="workflow-brief-footer">
        <button className="btn-dark-secondary" onClick={() => onOpen(item)} type="button">
          <Icon name="file" size={14} /> Open Dossier
        </button>
        {!approved && (
          <button className="btn-dark-primary" onClick={() => onApprove(item)} type="button">
            <Icon name="shield" size={14} /> Approve
          </button>
        )}
        <button className="workflow-brief-remove" onClick={() => onRemove(item)} type="button">
          {approved ? 'Remove approval' : 'Remove'}
        </button>
      </footer>
    </article>
  );
}
