import React, { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import './for-you-workspace.css';

const ForYouScreen = lazy(() => import('./ForYouScreen.jsx'));
const SavedScreen = lazy(() => import('../screens/SavedScreen.jsx'));

const SECTION_COPY = {
  saved: {
    kicker: 'Private signal library',
    title: 'Saved Signals',
    purpose: 'The stories you kept, available only to you and quietly shaping your recommendations for 30 days.',
  },
  contributions: {
    kicker: 'Private publishing desk',
    title: 'Contributions',
    purpose: 'Write, import and submit Samsung Internal stories without exposing an unfinished draft.',
  },
  briefings: {
    kicker: 'Private link studio',
    title: 'Private Briefings',
    purpose: 'Turn article links into structured, exportable intelligence while processing continues in the background.',
  },
};

function firstNameOf(viewer) {
  return String(viewer?.display_name || '').trim().split(/\s+/)[0] || '';
}

function activeSection(pathname) {
  if (pathname.startsWith('/for-you/contributions')) return 'contributions';
  if (pathname.startsWith('/for-you/private-briefings')) return 'briefings';
  if (pathname.startsWith('/for-you/saved')) return 'saved';
  return 'desk';
}

function WorkspaceSkeleton() {
  return (
    <div aria-label="Preparing your private workspace" className="fy-workspace-switcher is-loading" role="status">
      {[0, 1, 2, 3].map((item) => <span aria-hidden="true" className="fy-workspace-skeleton" key={item} />)}
    </div>
  );
}

function WorkspaceViewFallback() {
  return (
    <div aria-live="polite" className="fy-workspace-view-loading" role="status">
      <span aria-hidden="true" />
      <p>Opening your private workspace…</p>
    </div>
  );
}

export default function ForYouWorkspaceScreen({ contributionAccess, viewer }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef([]);
  const pendingFocusIndex = useRef(null);
  const section = activeSection(location.pathname);
  const contributionAllowed = Boolean(contributionAccess?.allowed);
  const accessLoading = contributionAccess === null;
  const firstName = firstNameOf(viewer);

  const tabs = useMemo(() => [
    {
      id: 'desk',
      icon: 'sparkle',
      label: firstName ? `${firstName}'s Desk` : 'Your Desk',
      purpose: 'Your personal intelligence mix',
      to: '/for-you',
    },
    {
      id: 'saved',
      icon: 'bookmark',
      label: 'Saved Signals',
      purpose: 'Stories kept for later',
      to: '/for-you/saved',
    },
    ...(contributionAllowed ? [{
      id: 'contributions',
      icon: 'note',
      label: 'Contributions',
      purpose: 'Private Samsung publishing',
      to: '/for-you/contributions',
    }] : []),
    {
      id: 'briefings',
      icon: 'file',
      label: 'Private Briefings',
      purpose: 'Your link-built dossiers',
      to: '/for-you/private-briefings',
    },
  ], [contributionAllowed, firstName]);

  useEffect(() => {
    if (pendingFocusIndex.current === null) return undefined;
    const index = pendingFocusIndex.current;
    const frame = window.requestAnimationFrame(() => {
      tabRefs.current[index]?.focus();
      pendingFocusIndex.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [section, tabs.length]);

  if (section === 'contributions' && !accessLoading && !contributionAllowed) {
    return <Navigate to="/for-you" replace />;
  }

  const moveFocus = (currentIndex, direction) => {
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    pendingFocusIndex.current = nextIndex;
    navigate(tabs[nextIndex].to);
  };

  const focusTab = (index) => {
    pendingFocusIndex.current = index;
    navigate(tabs[index].to);
  };

  const renderContent = () => {
    if (section === 'desk') return <ForYouScreen />;
    if (section === 'saved') return <SavedScreen key="saved" view="saved" />;
    if (section === 'briefings') return <SavedScreen key="briefings" view="briefings" />;
    if (section === 'contributions' && contributionAllowed) {
      return (
        <SavedScreen
          autoStart={location.pathname.endsWith('/leadership') ? 'leadership' : ''}
          key={location.pathname.endsWith('/leadership') ? 'leadership' : 'contributions'}
          view="contribute"
        />
      );
    }
    return null;
  };

  return (
    <div className="fy-workspace-shell">
      <div className="fy-workspace-rail-wrap">
        {accessLoading ? <WorkspaceSkeleton /> : (
          <div
            aria-label="Your private workspace"
            className="fy-workspace-switcher"
            role="tablist"
            style={{ '--workspace-columns': tabs.length }}
          >
            {tabs.map((tab, index) => (
              <button
                aria-controls="for-you-workspace-panel"
                aria-label={`${tab.label}: ${tab.purpose}`}
                aria-selected={section === tab.id}
                className={section === tab.id ? 'is-active' : ''}
                id={`for-you-workspace-${tab.id}`}
                key={tab.id}
                onClick={() => navigate(tab.to)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    moveFocus(index, -1);
                  }
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    moveFocus(index, 1);
                  }
                  if (event.key === 'Home') {
                    event.preventDefault();
                    focusTab(0);
                  }
                  if (event.key === 'End') {
                    event.preventDefault();
                    focusTab(tabs.length - 1);
                  }
                }}
                ref={(node) => { tabRefs.current[index] = node; }}
                role="tab"
                tabIndex={section === tab.id ? 0 : -1}
                type="button"
              >
                <span className="fy-workspace-icon" aria-hidden="true"><Icon name={tab.icon} size={17} /></span>
                <span className="fy-workspace-copy"><strong>{tab.label}</strong><small>{tab.purpose}</small></span>
                <span className="fy-workspace-indicator" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {section !== 'desk' && SECTION_COPY[section] && (
        <header className="fy-workspace-intro">
          <span>{SECTION_COPY[section].kicker}</span>
          <div><h1>{SECTION_COPY[section].title}</h1><p>{SECTION_COPY[section].purpose}</p></div>
        </header>
      )}

      <section
        aria-labelledby={`for-you-workspace-${section}`}
        className="fy-workspace-panel"
        id="for-you-workspace-panel"
        role="tabpanel"
      >
        {section === 'contributions' && accessLoading
          ? <div className="fy-workspace-access-state"><span /><p>Checking private publishing access…</p></div>
          : <Suspense fallback={<WorkspaceViewFallback />}>{renderContent()}</Suspense>}
      </section>
    </div>
  );
}
