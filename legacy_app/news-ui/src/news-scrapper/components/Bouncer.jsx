import React from 'react';
import Icon from './Icon.jsx';
import '../styles/reactions.css';

export default function Bouncer({ vote, reactions, likeCount, dislikeCount, onVote, disabled = false, status = 'ready' }) {
  const snapshot = reactions || (vote && typeof vote === 'object' ? vote : null);
  const current = snapshot?.viewer_reaction || (vote === 'up' ? 'like' : vote === 'down' ? 'dislike' : 'neutral');
  const likes = (snapshot || likeCount != null) ? Number(likeCount ?? snapshot?.like_count ?? 0) : null;
  const dislikes = (snapshot || dislikeCount != null) ? Number(dislikeCount ?? snapshot?.dislike_count ?? 0) : null;
  const totalsUnavailable = status === 'loading' || status === 'error';
  const choose = (reaction) => onVote(current === reaction ? 'neutral' : reaction);
  return (
    <div aria-label="Story reactions" className="reaction-controls" onClick={(e) => e.stopPropagation()}>
      <button
        aria-pressed={current === 'like'}
        className={'reaction-button is-like' + (current === 'like' ? ' is-active' : '')}
        disabled={disabled}
        data-tooltip={totalsUnavailable ? 'Reaction totals unavailable · retry above' : likes ? `Like this story · ${likes} total` : 'Like this story'}
        onClick={() => choose('like')}
        title="Like this story"
        aria-label={`Like this story${Number.isFinite(likes) ? `, ${likes} likes` : ', total unavailable'}`}
        type="button"
      >
        <Icon name="thumbsUp" />
        {Number.isFinite(likes) && likes > 0 && <span>{likes}</span>}
      </button>
      <button
        aria-pressed={current === 'dislike'}
        className={'reaction-button is-dislike' + (current === 'dislike' ? ' is-active' : '')}
        disabled={disabled}
        data-tooltip={totalsUnavailable ? 'Reaction totals unavailable · retry above' : dislikes ? `Dislike this story · ${dislikes} total` : 'Dislike this story'}
        onClick={() => choose('dislike')}
        title="Dislike this story"
        aria-label={`Dislike this story${Number.isFinite(dislikes) ? `, ${dislikes} dislikes` : ', total unavailable'}`}
        type="button"
      >
        <Icon name="thumbsDown" />
        {Number.isFinite(dislikes) && dislikes > 0 && <span>{dislikes}</span>}
      </button>
      {status !== 'ready' && <span aria-label={status === 'stale' ? 'Reaction totals are updating' : 'Reaction totals unavailable'} className={`reaction-state-indicator is-${status}`} role="status" title={status === 'stale' ? 'Showing last-known totals while refreshing' : 'Reaction totals unavailable'}>{status === 'stale' ? '↻' : '—'}</span>}
    </div>
  );
}
