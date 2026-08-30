import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import '../styles/continuous-signal-stream.css';

export default function ContinuousSignalStream({
  items = [],
  renderItem,
  ariaLabel = 'Live signal stream',
  duration = 36,
  className = '',
}) {
  const rootRef = useRef(null);
  const [manualPaused, setManualPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(Boolean(media?.matches));
    sync();
    media?.addEventListener?.('change', sync);
    return () => media?.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const sync = () => setDocumentVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (!('IntersectionObserver' in window) || !rootRef.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: '120px' });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  const moving = items.length > 1 && !manualPaused && !reduced && visible && documentVisible;
  const renderGroup = (duplicate) => (
    <div aria-hidden={duplicate ? 'true' : undefined} className="continuous-stream-group">
      {items.map((item, index) => (
        <React.Fragment key={`${item?.id || item?.link || item?.title || index}-${duplicate ? 'copy' : 'original'}`}>
          {renderItem(item, index, duplicate)}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div aria-label={ariaLabel} className={`continuous-signal-stream ${className}`.trim()} ref={rootRef}>
      <button
        aria-pressed={manualPaused}
        className="continuous-stream-toggle"
        onClick={() => setManualPaused((value) => !value)}
        title={manualPaused ? 'Resume stream' : 'Pause stream'}
        type="button"
      >
        <Icon name={manualPaused ? 'play' : 'pause'} size={13} />
        <span>{manualPaused ? 'Resume' : 'Pause'}</span>
      </button>
      <div className="continuous-stream-window">
        <div className={moving ? 'continuous-stream-track is-moving' : 'continuous-stream-track'} style={{ '--stream-duration': `${Math.max(12, duration)}s` }}>
          {renderGroup(false)}
          {!reduced && renderGroup(true)}
        </div>
      </div>
    </div>
  );
}
