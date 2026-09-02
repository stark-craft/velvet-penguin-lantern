import React, { lazy, Suspense, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

const SavedScreen = lazy(() => import('../screens/SavedScreen.jsx'));

export default function CreateScreen({ contributionAllowed }) {
  const location = useLocation();
  const navigate = useNavigate();
  const contributions = location.pathname.includes('/contributions');
  const leadership = location.pathname.endsWith('/leadership');
  const switcherRefs = useRef([]);
  const destinations = [
    { id: 'briefing', active: !contributions, label: 'Private Briefing', copy: 'Structure up to 20 article links', icon: 'sparkle', to: '/for-you/create' },
    ...(contributionAllowed ? [{ id: 'contributions', active: contributions, label: 'Contributions', copy: 'Write or import for Samsung Internal', icon: 'note', to: '/for-you/create/contributions' }] : []),
  ];
  return (
    <div className="fy-create-page">
      <div className="fy-create-command">
        <div className="fy-create-command-mark"><Icon name="studio" size={18} /><span>Creation studio</span></div>
        <div aria-label="Create workspace" className="fy-create-switcher" role="tablist">
          {destinations.map((destination, index) => <button
            aria-controls="fy-create-panel"
            aria-selected={destination.active}
            className={destination.active ? 'is-active' : ''}
            id={`fy-create-${destination.id}-tab`}
            key={destination.id}
            onClick={() => navigate(destination.to)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? destinations.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + destinations.length) % destinations.length;
              navigate(destinations[next].to);
              window.requestAnimationFrame(() => switcherRefs.current[next]?.focus());
            }}
            ref={(node) => { switcherRefs.current[index] = node; }}
            role="tab"
            tabIndex={destination.active ? 0 : -1}
            type="button"
          ><Icon name={destination.icon} size={16} /><span><strong>{destination.label}</strong><small>{destination.copy}</small></span></button>)}
        </div>
      </div>
      <div aria-labelledby={`fy-create-${contributions && contributionAllowed ? 'contributions' : 'briefing'}-tab`} id="fy-create-panel" role="tabpanel"><Suspense fallback={<div className="fy-workspace-view-loading"><span /><p>Opening the workspace…</p></div>}><SavedScreen autoStart={leadership ? 'leadership' : ''} view={contributions && contributionAllowed ? 'contribute' : 'briefings'} /></Suspense></div>
    </div>
  );
}
