import React, { useState } from 'react';
import Icon from './Icon.jsx';
import useAutoplayState from '../hooks/useAutoplayState.js';
import '../styles/continuous-signal-stream.css';

export default function ContinuousSignalStream({
  items = [],
  renderItem,
  ariaLabel = 'Live signal stream',
  duration = 36,
  className = '',
}) {
  const [manualPaused, setManualPaused] = useState(false);
  const { documentVisible, reducedMotion } = useAutoplayState();

  const moving = items.length > 1 && !manualPaused && documentVisible;
  const effectiveDuration = Math.max(12, duration) * (reducedMotion ? 1.75 : 1);
  const renderGroup = (copyIndex) => {
    const duplicate = copyIndex > 0;
    return (
      <div aria-hidden={duplicate ? 'true' : undefined} className="continuous-stream-group" key={`stream-copy-${copyIndex}`}>
        {items.map((item, index) => (
          <React.Fragment key={`${item?.id || item?.link || item?.title || index}-${copyIndex}`}>
            {renderItem(item, index, duplicate)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div aria-label={ariaLabel} className={`continuous-signal-stream ${className}`.trim()}>
      <button
        aria-pressed={manualPaused}
        className="continuous-stream-toggle"
        onClick={() => setManualPaused((value) => !value)}
        title={manualPaused ? 'Resume stream' : `Pause stream${reducedMotion ? ' (slowed for Windows motion preference)' : ''}`}
        type="button"
      >
        <Icon name={manualPaused ? 'play' : 'pause'} size={13} />
        <span>{manualPaused ? 'Resume' : 'Pause'}</span>
      </button>
      <div className="continuous-stream-window">
        <div className={moving ? 'continuous-stream-track is-moving' : 'continuous-stream-track'} style={{ '--stream-duration': `${effectiveDuration}s` }}>
          {[0, 1, 2, 3].map(renderGroup)}
        </div>
      </div>
    </div>
  );
}
