import React from 'react';
import Icon from './Icon.jsx';
import '../styles/reactions.css';

export default function Bouncer({ vote, reactions, likeCount, dislikeCount, onVote, disabled = false }) {
  const snapshot = reactions || (vote && typeof vote === 'object' ? vote : null);
  const current = snapshot?.viewer_reaction || (vote === 'up' ? 'like' : vote === 'down' ? 'dislike' : 'neutral');
  const likes = Number(likeCount ?? snapshot?.like_count ?? 0);
  const dislikes = Number(dislikeCount ?? snapshot?.dislike_count ?? 0);
  const choose = (reaction) => onVote(current === reaction ? 'neutral' : reaction);
  return (
    <div aria-label="Story reactions" className="reaction-controls" onClick={(e) => e.stopPropagation()}>
      <button
        aria-pressed={current === 'like'}
        className={'reaction-button is-like' + (current === 'like' ? ' is-active' : '')}
        disabled={disabled}
        data-tooltip={likes ? `Like this story · ${likes} total` : 'Like this story'}
        onClick={() => choose('like')}
        title="Like this story"
        aria-label={`Like this story${likes ? `, ${likes} likes` : ''}`}
        type="button"
      >
        <Icon name="thumbsUp" />
        {likes > 0 && <span>{likes}</span>}
      </button>
      <button
        aria-pressed={current === 'dislike'}
        className={'reaction-button is-dislike' + (current === 'dislike' ? ' is-active' : '')}
        disabled={disabled}
        data-tooltip={dislikes ? `Dislike this story · ${dislikes} total` : 'Dislike this story'}
        onClick={() => choose('dislike')}
        title="Dislike this story"
        aria-label={`Dislike this story${dislikes ? `, ${dislikes} dislikes` : ''}`}
        type="button"
      >
        <Icon name="thumbsDown" />
        {dislikes > 0 && <span>{dislikes}</span>}
      </button>
    </div>
  );
}
