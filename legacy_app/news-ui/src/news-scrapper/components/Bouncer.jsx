import React from 'react';
import Icon from './Icon.jsx';

export default function Bouncer({ vote, onVote }) {
  return (
    <div className="bouncer" onClick={(e) => e.stopPropagation()}>
      <button
        className={'b up' + (vote === 'up' ? ' on' : '')}
        onClick={() => onVote(vote === 'up' ? null : 'up')}
        title="Interested — trains the bouncer"
        aria-label="Interested — trains the bouncer"
        data-tooltip="Interested"
        type="button"
      >
        <Icon name="thumbsUp" />
        <span>Useful</span>
      </button>
      <button
        className={'b down' + (vote === 'down' ? ' on' : '')}
        onClick={() => onVote(vote === 'down' ? null : 'down')}
        title="Not interested — removes for everyone and trains the bouncer"
        aria-label="Not interested — removes for everyone and trains the bouncer"
        data-tooltip="Not interested"
        type="button"
      >
        <Icon name="thumbsDown" />
        <span>Not relevant</span>
      </button>
    </div>
  );
}
