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

function greetingForHour(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function ForYouWorkspaceScreen({ contributionAccess, viewer }) {
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
  const firstName = String(viewer?.display_name || viewer?.name || '').trim().split(/\s+/)[0] || 'there';
  const salutation = greetingForHour(new Date().getHours());
  const greeting = `${salutation}, ${firstName}`;
  const tabs = [
    { id: 'feed', label: 'Your Feed', icon: 'sparkle', to: '/for-you' },
    { id: 'following', label: 'Following', icon: 'bookmark', to: '/for-you/following' },
    { id: 'create', label: 'Create', icon: 'studio', to: '/for-you/create' },
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
        <nav aria-label="For You workspace" className="fy-workspace-switcher">
          <div className="fy-command-identity" title={greeting}>
            <span aria-hidden="true" className="fy-command-orbit"><i /><i /></span>
            <span aria-label={greeting} className="fy-command-greeting">
              <small>{salutation}</small>
              <strong>{firstName}</strong>
            </span>
          </div>
          <div aria-label="Personal workspace views" className="fy-workspace-tabs" role="tablist">
            {tabs.map((tab, index) => <button
              aria-controls="fy-workspace-panel"
              aria-selected={section === tab.id}
              className={section === tab.id ? 'is-active' : ''}
              key={tab.id}
              id={`fy-workspace-${tab.id}-tab`}
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
            >
              <span aria-hidden="true" className="fy-workspace-index">{String(index + 1).padStart(2, '0')}</span>
              <Icon name={tab.icon} size={15} />
              <span>{tab.label}</span>
            </button>)}
          </div>
          <div className="fy-workspace-context">
            {section === 'feed' && <div className="fy-interest-disclosure">
              <button aria-describedby="fy-interest-popover" className="fy-interest-summary" type="button">
                <Icon name="radar" size={13} />
                {feedMeta.labels.length ? `${feedMeta.labels.length} interests` : 'Personal feed'}
              </button>
              <div className="fy-interest-popover" id="fy-interest-popover" role="tooltip">
                <span>Your private interests</span>
                <div>
                  {(feedMeta.labels.length ? feedMeta.labels : ['Complete your interests to personalize this feed']).map((label) => <b key={label}>{label}</b>)}
                </div>
                <small>These signals shape ranking only for your desk.</small>
              </div>
            </div>}
            <button className="fy-tune-action" onClick={() => navigate('/for-you?edit=interests')} title="Edit the topics used to rank your feed" type="button"><Icon name="settings" size={15} /><span>Tune interests</span><Icon name="chevR" size={13} /></button>
          </div>
        </nav>
      </div>
      <section aria-labelledby={`fy-workspace-${section}-tab`} className="fy-workspace-panel" id="fy-workspace-panel" role="tabpanel">
        <Suspense fallback={<WorkspaceFallback />}>
          {section === 'feed' && <ForYouScreen onWorkspaceMeta={setFeedMeta} />}
          {section === 'following' && <FollowingScreen />}
          {section === 'create' && <CreateScreen contributionAllowed={allowed} />}
        </Suspense>
      </section>
    </div>
  );
}
