import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import './for-you-workspace.css';

const ForYouScreen = lazy(() => import('./ForYouScreen.jsx'));
const FollowingScreen = lazy(() => import('./FollowingScreen.jsx'));
const CreateScreen = lazy(() => import('./CreateScreen.jsx'));

function sectionFromPath(pathname) {
  if (pathname.startsWith('/for-you/following')) return 'following';
  if (pathname.startsWith('/for-you/create')) return 'create';
  return 'feed';
}

function legacyTarget(pathname) {
  if (pathname.startsWith('/for-you/saved')) return '/for-you/following';
  if (pathname.startsWith('/for-you/contributions/leadership')) return '/for-you/create/contributions/leadership';
  if (pathname.startsWith('/for-you/contributions')) return '/for-you/create/contributions';
  if (pathname.startsWith('/for-you/private-briefings')) return '/for-you/create';
  return '';
}

function WorkspaceFallback() {
  return <div className="fy-workspace-view-loading" role="status"><span /><p>Opening your private workspace…</p></div>;
}

export default function ForYouWorkspaceScreen({ contributionAccess }) {
  const location = useLocation();
  const navigate = useNavigate();
  const refs = useRef([]);
  const lastScroll = useRef(0);
  const [feedMeta, setFeedMeta] = useState({ labels: [] });
  const [railHidden, setRailHidden] = useState(false);
  const section = sectionFromPath(location.pathname);
  const allowed = Boolean(contributionAccess?.allowed);
  const accessLoading = contributionAccess === null;
  const redirect = legacyTarget(location.pathname);
  const tabs = [
    { id: 'feed', label: 'Your Feed', icon: 'sparkle', to: '/for-you' },
    { id: 'following', label: 'Following', icon: 'bookmark', to: '/for-you/following' },
    { id: 'create', label: 'Create', icon: 'note', to: '/for-you/create' },
  ];

  useEffect(() => {
    if (!allowed && !accessLoading && location.pathname.includes('/create/contributions')) navigate('/for-you/create', { replace: true });
  }, [accessLoading, allowed, location.pathname, navigate]);

  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY;
      setRailHidden(current > 150 && current > lastScroll.current + 5);
      if (current < lastScroll.current - 5 || current < 80) setRailHidden(false);
      lastScroll.current = current;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <div className="fy-workspace-shell">
      <div className={`fy-workspace-rail-wrap${railHidden ? ' is-hidden' : ''}`}>
        <div aria-label="For You workspace" className="fy-workspace-switcher" role="tablist">
          <div className="fy-workspace-tabs">
            {tabs.map((tab, index) => <button
              aria-selected={section === tab.id}
              className={section === tab.id ? 'is-active' : ''}
              key={tab.id}
              onClick={() => navigate(tab.to)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                navigate(tabs[next].to);
                window.requestAnimationFrame(() => refs.current[next]?.focus());
              }}
              ref={(node) => { refs.current[index] = node; }}
              role="tab"
              tabIndex={section === tab.id ? 0 : -1}
              type="button"
            ><Icon name={tab.icon} size={15} /> {tab.label}</button>)}
          </div>
          {section === 'feed' && <div className="fy-command-topics" aria-label="Selected interests">{feedMeta.labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}</div>}
          <button className="fy-tune-action" onClick={() => navigate('/for-you?edit=interests')} type="button"><Icon name="settings" size={15} /> Tune interests</button>
        </div>
      </div>
      <section className="fy-workspace-panel" role="tabpanel">
        <Suspense fallback={<WorkspaceFallback />}>
          {section === 'feed' && <ForYouScreen onWorkspaceMeta={setFeedMeta} />}
          {section === 'following' && <FollowingScreen />}
          {section === 'create' && <CreateScreen contributionAllowed={allowed} />}
        </Suspense>
      </section>
    </div>
  );
}
