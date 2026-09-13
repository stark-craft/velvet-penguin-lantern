import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAccessCapabilities, getRecommendationStatus, getViewerPreferences, getViewerProfile, logoutCapabilitySession, updateViewerPreferences } from '../news-scrapper/api.js';
import { useLanguage } from '../news-scrapper/translation/LanguageProvider.jsx';
import { useSamparkAuth } from './auth/SamparkAuthContext.jsx';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';
import SamparkSearchResults from './SamparkSearchResults.jsx';
import SamparkSettingsModal, { readSamparkSettings } from './SamparkSettingsModal.jsx';
import SamparkForYou from './SamparkForYou.jsx';
import SamparkAllNews from './all-news/AllNewsPage.jsx';
import SamparkResearch from './SamparkResearch.jsx';
import SamparkSamsungNews from './SamparkSamsungNews.jsx';
import SamparkCreate from './SamparkCreate.jsx';
import SamparkNotificationBell from './shared/SamparkNotificationBell.jsx';
import { searchClearTarget, searchSubmitTarget } from './searchNav.js';
import SamparkLogin from './SamparkLogin.jsx';
import SamparkFollowing from './SamparkFollowing.jsx';
import SamparkHidden from './SamparkHidden.jsx';
import SamparkHistory from './SamparkHistory.jsx';
import SamparkVoc from './SamparkVoc.jsx';
import SamparkReview from './SamparkReview.jsx';
import SamparkApproved from './SamparkApproved.jsx';
import SamparkGatekeeper from './SamparkGatekeeper.jsx';
import SamparkSources from './SamparkSources.jsx';
import SamparkScheduler from './SamparkScheduler.jsx';
import SamparkAnalytics from './SamparkAnalytics.jsx';
import SamparkAccess from './SamparkAccess.jsx';
import './sampark.css';
const SEARCH_HISTORY_KEY = 'sampark-search-history-v1';
const LEGACY_SEARCH_HISTORY_KEY = 'sampark-search-history-v1';

function getNamespacedHistoryKey(viewer) {
  const principal = String(viewer?.principal || '').trim();
  // Use first 8 chars of principal hash (non-secret) as namespace, fallback to anon
  if (principal && principal.length >= 8) return `${SEARCH_HISTORY_KEY}:${principal.slice(0, 8)}`;
  return `${SEARCH_HISTORY_KEY}:anon`;
}

function readSearchHistoryForViewer(viewer) {
  try {
    // Prefer privacy: if old global key exists and viewer is known, remove it (do not migrate)
    if (viewer?.principal && window.localStorage.getItem(LEGACY_SEARCH_HISTORY_KEY)) {
      window.localStorage.removeItem(LEGACY_SEARCH_HISTORY_KEY);
    }
    const key = getNamespacedHistoryKey(viewer);
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function readSearchHistory() {
  // Initial read before viewer known — use anon namespace, will be replaced on viewer load
  return readSearchHistoryForViewer(null);
}

function ForYouStructure() {
  return <SamparkForYou />;
}

function AllNewsStructure() {
  return <SamparkAllNews />;
}

function ResearchStructure() {
  return <SamparkResearch />;
}

function SamsungStructure() {
  return <SamparkSamsungNews />;
}

function SamparkCreateModal({ onClose }) {
  const previousActiveRef = useRef(null);
  const overlayRef = useRef(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const attemptClose = () => {
    if (hasUnsaved && !confirm('You have unsaved work. Discard and close?')) return;
    onClose();
  };
  const dialogRef = useModalFocus(true, attemptClose);
  // Body scroll lock - preserve useModalFocus's html overflow handling, add body lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  // Focus restoration - handled by useModalFocus isolation, keep explicit restoration
  useEffect(() => {
    previousActiveRef.current = document.activeElement;
    return () => {
      const prev = previousActiveRef.current;
      if (prev && typeof prev.focus === 'function') try { prev.focus(); } catch {}
    };
  }, []);
  return (
    <div ref={overlayRef} className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'grid', placeItems: 'center', zIndex: 100 }} role="presentation">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-modal-title" tabIndex={-1} style={{ width: 'min(96vw, 960px)', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface)', borderRadius: 12, padding: 16 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between' }}><h2 id="create-modal-title">Create News</h2><button aria-label="Close" onClick={attemptClose} type="button"><Icon name="x" size={18} /></button></header>
        <SamparkCreate onDirtyChange={setHasUnsaved} />
      </section>
    </div>
  );
}

export default function SamparkApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search).get('q') || '';
  const [searchDraft, setSearchDraft] = useState(query);
  const [searchHistory, setSearchHistory] = useState(readSearchHistory);
  const [settings, setSettings] = useState(readSamparkSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [serviceError, setServiceError] = useState('');
  const returnPath = useRef('/for-you');
  const { language, setLanguage, translationState } = useLanguage();

  useEffect(() => {
    setSearchDraft(location.pathname === '/search' ? query : '');
    if (location.pathname !== '/search') returnPath.current = location.pathname;
  }, [location.pathname, query]);

  const auth = (() => {
    try { return useSamparkAuth(); } catch { return null; }
  })();

  // Sync viewer/capabilities from auth seam (cookie-primary), keep local state for greeting
  useEffect(() => {
    if (!auth) return;
    setViewer(auth.viewer);
    setCapabilities(auth.capabilities);
    setServiceError(auth.error || '');
  }, [auth?.viewer, auth?.capabilities, auth?.error]);

  // Reload search history when viewer identity becomes known (per-viewer namespace)
  useEffect(() => {
    if (viewer?.principal) {
      setSearchHistory(readSearchHistoryForViewer(viewer));
    }
  }, [viewer?.principal]);

  // Recommendation status remains viewer-specific, fetched once; also mirror server authoritative search history preference
  useEffect(() => {
    let cancelled = false;
    getRecommendationStatus().then((result) => {
      if (cancelled) return;
      setSettings((current) => ({ ...current, personalizedFeed: result?.mode !== 'paused' }));
    }).catch(() => {});
    getViewerPreferences().then((result) => {
      if (cancelled) return;
      const pref = result?.preferences || {};
      const serverRemember = typeof pref.remember_search_history === 'boolean' ? pref.remember_search_history : typeof pref.rememberSearchHistory === 'boolean' ? pref.rememberSearchHistory : null;
      if (serverRemember !== null) {
        setSettings((current) => {
          if (current.saveSearchHistory === serverRemember) return current;
          const next = { ...current, saveSearchHistory: serverRemember };
          // localStorage is responsive cache, not authority
          window.localStorage.setItem('sampark-shell-settings-v1', JSON.stringify(next));
          return next;
        });
        if (!serverRemember) {
          // clear cache when server says off
          try {
            window.localStorage.removeItem(getNamespacedHistoryKey(viewer));
            window.localStorage.removeItem(SEARCH_HISTORY_KEY);
          } catch {}
          setSearchHistory([]);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [viewer?.principal]);

  // Allow SamparkSearchResults privacy panel to open settings and focus Remember Search History
  useEffect(() => {
    const handler = (e) => {
      setSettingsOpen(true);
      const focus = e?.detail?.focus;
      if (focus) {
        setTimeout(() => {
          const el = document.querySelector('[data-focus="remember_search_history"] input, input[aria-label="Remember Search History"]');
          if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
        }, 100);
      }
    };
    window.addEventListener('sampark-open-settings', handler);
    return () => window.removeEventListener('sampark-open-settings', handler);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onDown = (e) => {
      if (!e.target.closest('.sampark-user-menu')) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [userMenuOpen]);

  // Close user menu on navigation
  useEffect(() => { setUserMenuOpen(false); }, [location.pathname]);

  const refreshAccess = async () => {
    if (auth?.refresh) {
      await auth.refresh();
      return;
    }
    const response = await getAccessCapabilities();
    setCapabilities(Array.isArray(response?.capabilities) ? response.capabilities : []);
  };

  const submitSearch = (event) => {
    event?.preventDefault();
    const clean = searchDraft.trim();
    if (!clean) {
      // Inside Search, an empty submit stays in the workspace (empty prompt);
      // elsewhere it returns to the previous route.
      navigate(searchSubmitTarget(location.pathname, '', returnPath.current));
      return;
    }
    if (settings.saveSearchHistory) {
      const next = [clean, ...searchHistory.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 12);
      setSearchHistory(next);
      window.localStorage.setItem(getNamespacedHistoryKey(viewer), JSON.stringify(next));
    }
    navigate(searchSubmitTarget(location.pathname, clean, returnPath.current));
  };

  const clearSearch = () => {
    setSearchDraft('');
    // Clearing inside Search keeps the user in the usable workspace.
    navigate(searchClearTarget(location.pathname, returnPath.current));
  };

  const changeLanguage = (nextLanguage) => {
    if (nextLanguage === 'ko') translationState.prepareBrowser?.();
    setLanguage(nextLanguage);
  };

  const handleLogout = async () => {
    try {
      if (auth?.logout) await auth.logout();
      else {
        await logoutCapabilitySession();
        await refreshAccess();
      }
      setUserMenuOpen(false);
      navigate('/login');
    } catch (e) {
      setServiceError(e?.message || 'Could not sign out.');
    }
  };

  const tabClass = (target) => ({ isActive }) => `main-tab${isActive || (target === '/all-news' && location.pathname === '/search') ? ' active' : ''}`;
  const rawDisplayName = String(viewer?.display_name || '').trim();
  const hasName = rawDisplayName.length >= 2;
  const displayName = hasName ? rawDisplayName : '';
  const initials = hasName ? rawDisplayName.slice(0, 2).toUpperCase() : 'TS';
  const hasPrivilegedSession = Boolean(auth?.privilegedSessionActive);
  const isAuthed = hasPrivilegedSession;
  // Role comes from the server session when safe; never inferred from the
  // capability union (network + principal + session).
  const activeRoleLabel = hasPrivilegedSession ? `Privileged session${auth?.sessionRole ? ` · ${auth.sessionRole}` : ''}` : 'Standard access';

  // navigate('/create') legacy contract for tests — actual navigation uses backgroundLocation
  const backgroundLocation = location.state?.backgroundLocation || location.state?.background;
  return <div className="techscout-app">
    <a className="skip-link" href="#news-main-content">Skip to news</a>
    <header className="techscout-header">
      <div className="techscout-brand-row"><NavLink className="techscout-logo" to="/for-you"><span className="logo-samsung">Samsung</span><span className="logo-techscout">TechScout</span></NavLink><div className="techscout-greeting"><p>{hasName ? <>Hi <span data-no-translate>{displayName}</span>! Your Personalized Technology briefing</> : 'Your Personalized Technology briefing'}</p></div></div>
      <div className="techscout-actions">
        <form className="search-bar" onSubmit={submitSearch} role="search"><button aria-label="Search Technologies News" className="search-submit" type="submit"><Icon name="search" size={16} /></button><input aria-label="Search all archived news" list="sampark-search-history" onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search all archived news" type="search" value={searchDraft} />{searchDraft && <button aria-label="Clear search" className="search-clear" onClick={clearSearch} type="button"><Icon name="x" size={14} /></button>}<datalist id="sampark-search-history">{searchHistory.map((item) => <option key={item} value={item} />)}</datalist><span style={{ display: 'none' }}>Search Technologies News</span></form>
        <label className="lang-btn" data-no-translate><Icon name="globe" size={16} /><select aria-label="Language" onChange={(event) => changeLanguage(event.target.value)} value={language}><option value="en">English</option><option value="ko">한국어</option></select></label>
        <button aria-label="Open settings" className="icon-btn settings-btn" onClick={() => setSettingsOpen(true)} type="button"><Icon name="settings" size={18} /></button>
        <SamparkNotificationBell />
        <div className="sampark-user-menu">
          <button className="sampark-user-trigger" aria-haspopup="menu" aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((v) => !v)} type="button">
            <span className="sampark-avatar" aria-hidden="true">{initials}</span>
            <span className="sampark-user-name" data-no-translate>{hasName ? displayName : 'TechScout'}</span>
            <Icon name="chevD" size={12} />
          </button>
          {userMenuOpen && (
            <div className="sampark-user-dropdown" role="menu">
              <div className="sampark-user-card">
                <span className="sampark-avatar large" aria-hidden="true">{initials}</span>
                <div>
                  <strong data-no-translate>{hasName ? displayName : 'Set display name'}</strong>
                  <small data-no-translate>{viewer?.email || (hasName ? 'Private browser profile' : 'Private — set name in Settings')}</small>
                  <small className="sampark-user-capabilities">{isAuthed ? `${activeRoleLabel} · ${capabilities.length} permission${capabilities.length===1?'':'s'} active` : 'Standard access — IP/network permissions'}</small>
                </div>
              </div>
              <button className="sampark-menu-item" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }} role="menuitem" type="button"><Icon name="settings" size={14} /> Settings</button>
              <NavLink className="sampark-menu-item" to="/login" onClick={() => setUserMenuOpen(false)} role="menuitem"><Icon name="key" size={14} /> {isAuthed ? 'Access — Privileged session' : 'Sign in — Access'}</NavLink>
              {isAuthed ? <button className="sampark-menu-item is-danger" onClick={handleLogout} role="menuitem" type="button"><Icon name="x" size={14} /> Sign out of privileged session</button> : <span className="sampark-menu-hint">Network permissions apply automatically; role key adds tools</span>}
            </div>
          )}
        </div>
      </div>
    </header>
    {serviceError && <div className="shell-status is-error" role="alert">{serviceError}</div>}
    {language === 'ko' && (translationState.translating || translationState.error) && <div className={`shell-status${translationState.error ? ' is-error' : ''}`} data-no-translate role={translationState.error ? 'alert' : 'status'}>{translationState.error ? <><span>{translationState.error}</span><button onClick={translationState.retry} type="button">Retry</button></> : <span>{translationState.phase === 'downloading' ? `한국어 번역 준비 중${translationState.downloadProgress === null ? '' : ` · ${translationState.downloadProgress}%`}` : `한국어로 번역 중 · ${translationState.completed}/${translationState.total}`}</span>}</div>}
    <div className="main-card-container">
      <nav aria-label="TechScout sections" className="main-tabs"><NavLink className={tabClass('/for-you')} to="/for-you"><Icon name="sparkle" size={16} />For You</NavLink><NavLink className={tabClass('/all-news')} to="/all-news"><Icon name="globe" size={16} />All News</NavLink><NavLink className={tabClass('/research')} to="/research"><Icon name="file" size={16} />Research</NavLink><NavLink className={tabClass('/samsung-news')} to="/samsung-news"><Icon name="layers" size={16} />Samsung News</NavLink><NavLink className={tabClass('/create')} to="/create" state={{ backgroundLocation: location }} style={{ height: '100%', display: 'inline-flex', alignItems: 'center' }}><Icon name="plus" size={16} />Create</NavLink></nav>
      <main className="content-area" id="news-main-content" tabIndex={-1}>
        <Routes location={backgroundLocation || location}>
          <Route path="/" element={<Navigate replace to="/for-you" />} /><Route path="/index.html" element={<Navigate replace to="/for-you" />} /><Route path="/for-you" element={<ForYouStructure />} /><Route path="/all-news" element={<AllNewsStructure />} /><Route path="/home" element={<Navigate replace to="/all-news" />} /><Route path="/research" element={<ResearchStructure />} /><Route path="/research/*" element={<ResearchStructure />} /><Route path="/samsung-news" element={<SamsungStructure />} /><Route path="/samsung-internal" element={<Navigate replace to="/samsung-news" />} /><Route path="/create" element={<SamparkCreate />} /><Route path="/login" element={<SamparkLogin />} /><Route path="/following" element={<SamparkFollowing />} /><Route path="/hidden" element={<SamparkHidden />} /><Route path="/history" element={<SamparkHistory />} /><Route path="/voc" element={<SamparkVoc />} /><Route path="/review" element={<SamparkReview capabilities={capabilities} />} /><Route path="/approved" element={<SamparkApproved capabilities={capabilities} />} /><Route path="/gatekeeper" element={<SamparkGatekeeper capabilities={capabilities} />} /><Route path="/sources" element={<SamparkSources capabilities={capabilities} />} /><Route path="/scheduler" element={<SamparkScheduler capabilities={capabilities} />} /><Route path="/analytics" element={<SamparkAnalytics capabilities={capabilities} />} /><Route path="/access" element={<SamparkAccess capabilities={capabilities} onAccessChanged={refreshAccess} />} /><Route path="/search" element={<SamparkSearchResults query={query} />} /><Route path="*" element={<Navigate replace to="/for-you" />} />
        </Routes>
        {backgroundLocation && (
          <Routes>
            <Route path="/create" element={<SamparkCreateModal onClose={()=> navigate(-1)} />} />
          </Routes>
        )}
      </main>
    </div>
    <SamparkSettingsModal capabilities={capabilities} privilegedSessionActive={Boolean(auth?.privilegedSessionActive)} sessionRole={auth?.sessionRole || ''} onAccessChanged={refreshAccess} onClose={() => setSettingsOpen(false)} onSaved={async (nextSettings, nextViewer) => { setSettings(nextSettings); setViewer(nextViewer); if (auth?.refresh) await auth.refresh(); if (!nextSettings.saveSearchHistory) { setSearchHistory([]); window.localStorage.removeItem(getNamespacedHistoryKey(nextViewer || viewer)); window.localStorage.removeItem(SEARCH_HISTORY_KEY); } else if (nextViewer?.principal) { // refresh namespaced history after viewer change
        setSearchHistory(readSearchHistoryForViewer(nextViewer));
      } }} open={settingsOpen} settings={settings} viewer={viewer} />
  </div>;
}
