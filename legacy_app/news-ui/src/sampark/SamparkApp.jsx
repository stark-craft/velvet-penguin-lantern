import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAccessCapabilities, getRecommendationStatus, getViewerProfile, logoutCapabilitySession } from '../news-scrapper/api.js';
import { useLanguage } from '../news-scrapper/translation/LanguageProvider.jsx';
import { useSamparkAuth } from './auth/SamparkAuthContext.jsx';
import SamparkSearchResults from './SamparkSearchResults.jsx';
import SamparkSettingsModal, { readSamparkSettings } from './SamparkSettingsModal.jsx';
import SamparkForYou from './SamparkForYou.jsx';
import SamparkLogin from './SamparkLogin.jsx';
import './sampark.css';

const CATEGORIES = ['All', 'AI', 'Devices', 'Compute', 'Robotics', 'Media'];
const RESEARCH_CATEGORIES = ['All', 'AI', 'Semiconductors', 'Cloud', 'Robotics'];
const SAMSUNG_CHANNELS = ['SRI-D', 'Local', 'Global'];
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

function CategoryBar({ items, label }) {
  const [active, setActive] = useState(items[0]);
  return <nav aria-label={label} className="category-filters">{items.map((item) => <button aria-current={active === item ? 'page' : undefined} className={`cat-filter${active === item ? ' active' : ''}`} key={item} onClick={() => setActive(item)} type="button">{item}</button>)}</nav>;
}

function EmptyRegion({ className = '', heading }) {
  return <section className={`shell-region ${className}`.trim()}><h2>{heading}</h2><div aria-hidden="true" className="shell-region-space" /></section>;
}

function ForYouStructure() {
  return <SamparkForYou />;
}

function AllNewsStructure() {
  return <div className="shell-page"><CategoryBar items={CATEGORIES} label="All News categories" /><div className="news-layout"><div className="primary-news-structure"><EmptyRegion className="feature-structure" heading="Featured News" /><EmptyRegion className="stream-structure" heading="Briefing Stream" /></div><EmptyRegion className="latest-structure" heading="Latest News" /><EmptyRegion className="filters-structure" heading="Apply Filter & Customize View" /><EmptyRegion className="all-news-structure" heading="All News" /></div></div>;
}

function ResearchStructure() {
  return <div className="shell-page"><CategoryBar items={RESEARCH_CATEGORIES} label="Research categories" /><EmptyRegion className="research-structure" heading="Research" /></div>;
}

function SamsungStructure() {
  return <div className="shell-page"><CategoryBar items={SAMSUNG_CHANNELS} label="Samsung News channels" /><div className="news-layout"><div className="primary-news-structure"><EmptyRegion className="feature-structure" heading="SRI-D Highlights" /><EmptyRegion className="stream-structure" heading="Briefing Stream" /></div><EmptyRegion className="latest-structure" heading="SRI-D News" /></div></div>;
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

  // Recommendation status remains viewer-specific, fetched once
  useEffect(() => {
    let cancelled = false;
    getRecommendationStatus().then((result) => {
      if (cancelled) return;
      setSettings((current) => ({ ...current, personalizedFeed: result?.mode !== 'paused' }));
    }).catch(() => {});
    return () => { cancelled = true; };
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
      navigate(returnPath.current || '/for-you');
      return;
    }
    if (settings.saveSearchHistory) {
      const next = [clean, ...searchHistory.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 12);
      setSearchHistory(next);
      window.localStorage.setItem(getNamespacedHistoryKey(viewer), JSON.stringify(next));
    }
    navigate(`/search?q=${encodeURIComponent(clean)}`);
  };

  const clearSearch = () => {
    setSearchDraft('');
    navigate(returnPath.current || '/for-you');
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
  const isAuthed = capabilities.length > 0;
  // Do not infer exact role from capabilities — effective_capabilities is a union of IP + session
  // Backend does not currently expose the privileged session role, so we only state privileged vs standard
  const activeRoleLabel = isAuthed ? 'Privileged access' : 'Standard access';

  return <div className="techscout-app">
    <a className="skip-link" href="#news-main-content">Skip to news</a>
    <header className="techscout-header">
      <div className="techscout-brand-row"><NavLink className="techscout-logo" to="/for-you"><span className="logo-samsung">Samsung</span><span className="logo-techscout">TechScout</span></NavLink><div className="techscout-greeting"><p>{hasName ? <>Hi <span data-no-translate>{displayName}</span>! Your Personalized Technology briefing</> : 'Your Personalized Technology briefing'}</p></div></div>
      <div className="techscout-actions">
        <form className="search-bar" onSubmit={submitSearch} role="search"><button aria-label="Search Technologies News" className="search-submit" type="submit"><Icon name="search" size={16} /></button><input aria-label="Search Technologies News" list="sampark-search-history" onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search Technologies News" type="search" value={searchDraft} />{searchDraft && <button aria-label="Clear search" className="search-clear" onClick={clearSearch} type="button"><Icon name="x" size={14} /></button>}<datalist id="sampark-search-history">{searchHistory.map((item) => <option key={item} value={item} />)}</datalist></form>
        <label className="lang-btn" data-no-translate><Icon name="globe" size={16} /><select aria-label="Language" onChange={(event) => changeLanguage(event.target.value)} value={language}><option value="en">English</option><option value="ko">한국어</option></select></label>
        <button aria-label="Open settings" className="icon-btn settings-btn" onClick={() => setSettingsOpen(true)} type="button"><Icon name="settings" size={18} /></button>
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
        <button className="create-news-btn" type="button" title="Create News — not implemented in this phase"><Icon name="plus" size={16} />Create News</button>
      </div>
    </header>
    {serviceError && <div className="shell-status is-error" role="alert">{serviceError}</div>}
    {language === 'ko' && (translationState.translating || translationState.error) && <div className={`shell-status${translationState.error ? ' is-error' : ''}`} data-no-translate role={translationState.error ? 'alert' : 'status'}>{translationState.error ? <><span>{translationState.error}</span><button onClick={translationState.retry} type="button">Retry</button></> : <span>{translationState.phase === 'downloading' ? `한국어 번역 준비 중${translationState.downloadProgress === null ? '' : ` · ${translationState.downloadProgress}%`}` : `한국어로 번역 중 · ${translationState.completed}/${translationState.total}`}</span>}</div>}
    <div className="main-card-container">
      <nav aria-label="TechScout sections" className="main-tabs"><NavLink className={tabClass('/for-you')} to="/for-you"><Icon name="sparkle" size={16} />For You</NavLink><NavLink className={tabClass('/all-news')} to="/all-news"><Icon name="globe" size={16} />All News</NavLink><NavLink className={tabClass('/research')} to="/research"><Icon name="file" size={16} />Research</NavLink><NavLink className={tabClass('/samsung-news')} to="/samsung-news"><Icon name="layers" size={16} />Samsung News</NavLink></nav>
      <main className="content-area" id="news-main-content" tabIndex={-1}><Routes><Route path="/" element={<Navigate replace to="/for-you" />} /><Route path="/index.html" element={<Navigate replace to="/for-you" />} /><Route path="/for-you" element={<ForYouStructure />} /><Route path="/all-news" element={<AllNewsStructure />} /><Route path="/home" element={<Navigate replace to="/all-news" />} /><Route path="/research" element={<ResearchStructure />} /><Route path="/samsung-news" element={<SamsungStructure />} /><Route path="/samsung-internal" element={<Navigate replace to="/samsung-news" />} /><Route path="/login" element={<SamparkLogin />} /><Route path="/search" element={query.trim() ? <SamparkSearchResults query={query} /> : <Navigate replace to="/for-you" />} /><Route path="*" element={<Navigate replace to="/for-you" />} /></Routes></main>
    </div>
    <SamparkSettingsModal capabilities={capabilities} onAccessChanged={refreshAccess} onClose={() => setSettingsOpen(false)} onSaved={async (nextSettings, nextViewer) => { setSettings(nextSettings); setViewer(nextViewer); if (auth?.refresh) await auth.refresh(); if (!nextSettings.saveSearchHistory) { setSearchHistory([]); window.localStorage.removeItem(getNamespacedHistoryKey(nextViewer || viewer)); window.localStorage.removeItem(SEARCH_HISTORY_KEY); } else if (nextViewer?.principal) { // refresh namespaced history after viewer change
        setSearchHistory(readSearchHistoryForViewer(nextViewer));
      } }} open={settingsOpen} settings={settings} viewer={viewer} />
  </div>;
}
