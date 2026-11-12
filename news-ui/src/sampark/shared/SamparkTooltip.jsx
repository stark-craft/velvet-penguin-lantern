import React, { useId, useState } from 'react';

export default function SamparkTooltip({ label, children }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const child = React.isValidElement(children) ? React.cloneElement(children, {
    'aria-label': children.props['aria-label'] || label,
    'aria-describedby': visible ? id : children.props['aria-describedby'],
  }) : children;
  return (
    <span
      className="sampark-tooltip-wrapper"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setVisible(false); }}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      {child}
      {visible && (
        <span id={id} role="tooltip" className="sampark-tooltip" style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', background: '#1a1a2e', color: '#fff', padding: '4px 8px', borderRadius: 6, fontSize: 12, zIndex: 10, pointerEvents: 'none' }}>
          {label}
        </span>
      )}
    </span>
  );
}
