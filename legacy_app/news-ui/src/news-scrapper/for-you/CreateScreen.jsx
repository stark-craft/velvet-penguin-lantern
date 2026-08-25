import React, { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

const SavedScreen = lazy(() => import('../screens/SavedScreen.jsx'));

export default function CreateScreen({ contributionAllowed }) {
  const location = useLocation();
  const navigate = useNavigate();
  const contributions = location.pathname.includes('/contributions');
  const leadership = location.pathname.endsWith('/leadership');
  return (
    <div className="fy-create-page">
      <div className="fy-create-command">
        <div className="fy-create-command-mark"><Icon name="studio" size={18} /><span>Creation studio</span></div>
        <div aria-label="Create workspace" className="fy-create-switcher" role="tablist">
          <button aria-selected={!contributions} className={!contributions ? 'is-active' : ''} onClick={() => navigate('/for-you/create')} role="tab" type="button"><Icon name="sparkle" size={16} /><span><strong>Private Briefing</strong><small>Structure up to 20 article links</small></span></button>
          {contributionAllowed && <button aria-selected={contributions} className={contributions ? 'is-active' : ''} onClick={() => navigate('/for-you/create/contributions')} role="tab" type="button"><Icon name="note" size={16} /><span><strong>Contributions</strong><small>Write or import for Samsung Internal</small></span></button>}
        </div>
      </div>
      <Suspense fallback={<div className="fy-workspace-view-loading"><span /><p>Opening the workspace…</p></div>}><SavedScreen autoStart={leadership ? 'leadership' : ''} view={contributions && contributionAllowed ? 'contribute' : 'briefings'} /></Suspense>
    </div>
  );
}
