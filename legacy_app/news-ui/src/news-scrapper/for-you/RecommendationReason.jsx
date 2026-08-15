import React, { useState } from 'react';
import Icon from '../components/Icon.jsx';

export default function RecommendationReason({ recommendation }) {
  const [open, setOpen] = useState(false);
  const reasons = recommendation?.reasons || [];
  if (!reasons.length) return null;
  return (
    <div className="fy-reason">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button">
        <Icon name="sparkle" size={13} /> Why this story?
      </button>
      {open && (
        <div className="fy-reason-popover" role="note">
          <strong>Why you’re seeing this</strong>
          <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
