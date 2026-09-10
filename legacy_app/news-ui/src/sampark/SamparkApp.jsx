import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import TopBar from '../news-scrapper/components/TopBar.jsx';
import UserProfileModal from '../news-scrapper/components/UserProfileModal.jsx';
import ForYouScreen from '../news-scrapper/for-you/ForYouScreen.jsx';
import { getAccessCapabilities, getViewerProfile, unlockCapabilitySession, logoutCapabilitySession } from '../news-scrapper/api.js';
import { useLanguage } from '../news-scrapper/translation/LanguageProvider.jsx';
import { useTracking } from '../news-scrapper/utils/tracking.js';
import '../news-scrapper/for-you/for-you-workspace.css';

const FeedScreen = lazy(() => import('../news-scrapper/screens/FeedScreen.jsx'));
const FollowingScreen = lazy(() => import('../news-scrapper/for-you/FollowingScreen.jsx'));
const RejectedScreen = lazy(() => import('../news-scrapper/screens/RejectedScreen.jsx'));
const HistoryScreen = lazy(() => import('../news-scrapper/screens/HistoryScreen.jsx'));
const VocScreen = lazy(() => import('../news-scrapper/screens/VocScreen.jsx'));
const SelectedScreen = lazy(() => import('../news-scrapper/screens/SelectedScreen.jsx'));
const ApprovedScreen = lazy(() => import('../news-scrapper/screens/ApprovedScreen.jsx'));
const SourcesScreen = lazy(() => import('../news-scrapper/screens/SourcesScreen.jsx'));
const SchedulerScreen = lazy(() => import('../news-scrapper/screens/SchedulerScreen.jsx'));
const AnalyticsScreen = lazy(() => import('../news-scrapper/screens/AnalyticsScreen.jsx'));
const GatekeeperScreen = lazy(() => import('../news-scrapper/screens/GatekeeperCapabilityScreen.jsx'));
const AccessManagementScreen = lazy(() => import('../news-scrapper/screens/AccessManagementScreen.jsx'));

function ExistingScreen({ path }) {
  useEffect(() => { window.location.replace(path); }, [path]);
  return <p role="status">Opening the existing workspace… <a href={path}>Continue</a></p>;
}

function SessionControls({ onChanged }) {
  const [role, setRole] = useState('director');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const changeSession = async (event, logout = false) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (logout) await logoutCapabilitySession();
      else await unlockCapabilitySession(role, key);
      setKey('');
      await onChanged();
      setMessage(logout ? 'Role session signed out. Your IP-based access still applies.' : 'Signed in. Your authorized tools are available below.');
    } catch (failure) { setError(failure?.message || 'Could not update your session.'); }
    finally { setBusy(false); }
  };
  return <form className="sp-session" onSubmit={changeSession} data-no-translate>
    <h3>Login & access</h3><p>Your existing network permissions apply automatically. Use a role key for an additional privileged session.</p>
    <div><label>Role<select value={role} onChange={event => setRole(event.target.value)}>{['director','gatekeeper','analytics','editor'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>Access key<input type="password" autoComplete="current-password" value={key} onChange={event => setKey(event.target.value)} /></label></div>
    <div><button disabled={busy || !key.trim()} type="submit">{busy ? 'Updating…' : 'Log in'}</button><button disabled={busy} onClick={event => changeSession(event, true)} type="button">Log out role session</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}

export default function SamparkApp() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useTracking(pathname);
  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [capabilities, setCapabilities] = useState(null);
  const [identityError, setIdentityError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileRequired, setProfileRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  const [meta, setMeta] = useState({ labels: [] });
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('sampark-theme') === 'dark' ? 'dark' : 'light');
  const { language, setLanguage, toggleLanguage, translationState } = useLanguage();
  const isForYou = pathname === '/for-you';
  const isNews = pathname === '/home';
  const has = value => Boolean(capabilities?.includes(value));

  const refreshAccess = async () => {
    setAccessError('');
    try { const result = await getAccessCapabilities(); setCapabilities(Array.isArray(result?.capabilities) ? result.capabilities : []); }
    catch (error) { setCapabilities(null); setAccessError(error?.message || 'Access could not be verified.'); throw error; }
  };
  useEffect(() => {
    let cancelled = false;
    setIdentityError(''); setViewerLoading(true);
    getViewerProfile().then(value => {
      if (cancelled) return;
      setViewer(value);
      if (!String(value?.display_name || '').trim()) { setProfileRequired(true); setProfileOpen(true); }
      else { localStorage.setItem('news-viewer-name', value.display_name); localStorage.setItem('initiator-name', value.display_name); }
    }).catch(error => { if (!cancelled) setIdentityError(error?.message || 'Your profile could not be loaded.'); })
      .finally(() => { if (!cancelled) setViewerLoading(false); });
    getAccessCapabilities().then(value => { if (!cancelled) { setCapabilities(Array.isArray(value?.capabilities) ? value.capabilities : []); setAccessError(''); } })
      .catch(error => { if (!cancelled) { setCapabilities(null); setAccessError(error?.message || 'Access could not be verified.'); } });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('sampark-theme', theme);
  }, [theme]);
  useEffect(() => { setSearch(''); }, [pathname]);
  useEffect(() => {
    const sync = () => { refreshAccess().catch(() => {}); };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);
  const gate = (any, child) => accessError
    ? <div className="fy-state" role="alert"><h2>Access could not be verified</h2><p>{accessError}</p><button onClick={() => refreshAccess().catch(() => {})}>Retry access check</button></div>
    : capabilities === null ? <p role="status">Checking access…</p>
      : any.some(has) ? child : <div className="fy-state"><h2>This workspace requires access</h2><p>Your current network or role does not grant this permission. Open Settings to log in or contact your access administrator.</p></div>;

  return <div className="sp-app">
    <a className="sp-skip" href="#news-main-content">Skip to news</a>
    <header className="sp-header">
      <div className="sp-brand-row"><Link className="sp-brand" to="/for-you" aria-label="Samsung TechScout home"><span>Samsung</span> <strong>TechScout</strong></Link><p>{viewer?.display_name ? <>Hi <span data-no-translate translate="no">{viewer.display_name}</span>! </> : 'Welcome! '}Your technology briefing</p></div>
      <div className="sp-header-actions">
        {isForYou && <label className="sp-search"><Icon name="search" size={17} /><span className="sr-only">Search loaded For You stories</span><input type="search" placeholder="Search your news" value={search} onChange={event => setSearch(event.target.value)} /></label>}
        <label className="sp-language" data-no-translate translate="no"><Icon name="globe" size={17} /><span className="sr-only">Interface language</span><select aria-label="Interface language" value={language} onChange={event => { if (event.target.value === 'ko') translationState?.prepareBrowser?.(); setLanguage(event.target.value); }}><option value="en">English</option><option value="ko">한국어 · Korean</option></select></label>
        <TopBar settingsOnly theme={theme} onToggleTheme={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} language={language} onToggleLanguage={toggleLanguage} translationState={translationState} viewer={viewer} viewerLoading={viewerLoading} onEditProfile={() => { setProfileRequired(false); setProfileOpen(true); }} forYouEnabled profileMode="unified" capabilities={capabilities} settingsExtra={<SessionControls onChanged={refreshAccess} />} />
        {has('contributions.create') && <a className="sp-create" href="/for-you/create/contributions" title="Open the existing contribution editor"><Icon name="plus" size={17} />Create News</a>}
      </div>
    </header>
    {(identityError || accessError) && <div className="sp-service-error" role="alert"><span>{identityError || accessError}</span><button onClick={() => setAttempt(value => value + 1)} type="button">Retry profile and access</button></div>}
    <div className="sp-main-card">
      <nav className="sp-tabs" aria-label="TechScout sections"><NavLink to="/for-you"><Icon name="sparkle" size={18} />For You</NavLink><NavLink to="/home"><Icon name="globe" size={18} />All News</NavLink><a href="/research"><Icon name="file" size={18} />Research</a><a href="/samsung-internal"><Icon name="layers" size={18} />Samsung News</a></nav>
      <main id="news-main-content" className="sp-content" tabIndex={-1}>
        <div className="sp-workspace-bar"><div>{isForYou ? <><strong>Your preferences</strong><div className="sp-preference-tags">{meta.labels.map(label => <span key={label}>{label}</span>)}</div><button onClick={() => navigate('/for-you?edit=interests')}>Edit preferences<Icon name="chevR" size={14} /></button></> : <strong>{isNews ? 'The shared briefing' : 'Your workspace'}</strong>}</div><NavLink to="/for-you/following"><Icon name="bookmark" size={15} />Saved & Following</NavLink></div>
        <Suspense fallback={<div className="fy-state" role="status">Opening workspace…</div>}><Routes key={revision}>
          <Route path="/" element={<Navigate to="/for-you" replace />} /><Route path="/index.html" element={<Navigate to="/for-you" replace />} />
          <Route path="/for-you" element={<ForYouScreen onWorkspaceMeta={setMeta} searchQuery={search} resetPath="/sampark/for-you" />} />
          <Route path="/home" element={<FeedScreen presentation="sampark" capabilities={capabilities || []} />} />
          <Route path="/for-you/following" element={<FollowingScreen />} /><Route path="/saved/*" element={<Navigate to="/for-you/following" replace />} />
          <Route path="/rejected" element={<RejectedScreen />} /><Route path="/history" element={<HistoryScreen reviewAllowed={has('review.news.submit')} />} /><Route path="/voc" element={<VocScreen />} />
          <Route path="/selected" element={gate(['review.news.view','review.contributions.view'], <SelectedScreen capabilities={capabilities || []} />)} />
          <Route path="/approved" element={gate(['approved.view','review.news.approve'], <ApprovedScreen />)} />
          <Route path="/sources" element={gate(['sources.view','sources.manage'], <SourcesScreen canManage={has('sources.manage')} />)} />
          <Route path="/scheduler" element={gate(['scheduler.view','scheduler.control'], <SchedulerScreen canControl={has('scheduler.control')} />)} />
          <Route path="/director-analytics" element={gate(['analytics.view'], <AnalyticsScreen />)} />
          <Route path="/gatekeeper-review" element={gate(['gatekeeper.review'], <GatekeeperScreen />)} />
          <Route path="/access-management" element={gate(['access.manage'], <AccessManagementScreen />)} />
          {['/research','/samsung-internal','/scan','/for-you/create','/for-you/create/contributions'].map(path => <Route key={path} path={path} element={<ExistingScreen path={path} />} />)}
          <Route path="*" element={<div className="sp-not-found"><h1>Page not found</h1><Link to="/for-you">Return to For You</Link></div>} />
        </Routes></Suspense>
      </main>
    </div>
    <UserProfileModal open={profileOpen} firstVisit={profileRequired} viewer={viewer} onClose={() => { if (!profileRequired) setProfileOpen(false); }} onSaved={value => { setViewer(value); setProfileRequired(false); setProfileOpen(false); setRevision(value => value + 1); window.dispatchEvent(new CustomEvent('news-viewer-change', { detail: value })); }} />
    <footer className="sp-footer"><span>Samsung TechScout</span><span>Designed and engineered by Vineet Singh</span><a href="/for-you">Compare with original <Icon name="chevR" size={12} /></a></footer>
  </div>;
}
