import React from 'react';
import Icon from './Icon.jsx';

export default function Bouncer({ vote, onVote }) {
  return (
    <div className="bouncer" onClick={(e) => e.stopPropagation()}>
      <div className={'b up' + (vote === 'up' ? ' on' : '')}
           onClick={() => onVote(vote === 'up' ? null : 'up')}
           title="Interesting (trains bouncer)">
        <Icon name="thumbsUp" />
        <span>Useful</span>
      </div>
      <div className={'b down' + (vote === 'down' ? ' on' : '')}
           onClick={() => onVote(vote === 'down' ? null : 'down')}
           title="Not interested (trains bouncer + hides)">
        <Icon name="thumbsDown" />
        <span>Not relevant</span>
      </div>
    </div>
  );
}
