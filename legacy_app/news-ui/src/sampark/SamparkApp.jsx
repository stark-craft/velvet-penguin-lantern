import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import UserProfileModal from '../news-scrapper/components/UserProfileModal.jsx';
import ForYouScreen from '../news-scrapper/for-you/ForYouScreen.jsx';
import { getAccessCapabilities, getViewerProfile, unlockCapabilitySession, logoutCapabilitySession } from '../news-scrapper/api.js';
import { useLanguage } from '../news-scrapper/translation/LanguageProvider.jsx';
import { useTracking } from '../news-scrapper/utils/tracking.js';
import './design-team.css';
import './sampark.css';

const ArchiveSearchScreen = lazy(() => import('./ArchiveSearchScreen.jsx'));
const SamsungNewsScreen = lazy(() => import('./SamsungNewsScreen.jsx'));
const SamsungInternalReaderScreen = lazy(() => import('../news-scrapper/screens/SamsungInternalReaderScreen.jsx'));
const FeedScreen = lazy(() => import('../news-scrapper/screens/FeedScreen.jsx'));
const FollowingScreen = lazy(() => import('../news-scrapper/for-you/FollowingScreen.jsx'));
const RejectedScreen = lazy(() => import('../news-scrapper/screens/RejectedScreen.jsx'));
const SamparkArchiveScreen = lazy(() => import('./SamparkArchiveScreen.jsx'));
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

function SettingsModal({ open, onClose, viewer, onEditProfile, capabilities, onChanged }) {
  const [role, setRole] = useState('director');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!open) return null;
  const change = async logout => {
    setBusy(true); setMessage('');
    try { if (logout) await logoutCapabilitySession(); else await unlockCapabilitySession(role, key); setKey(''); await onChanged(); setMessage(logout ? 'Role session signed out. Network access still applies.' : 'Access updated.'); }
    catch (error) { setMessage(error?.message || 'Access could not be updated.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-overlay show" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} role="presentation"><section aria-label="Settings" aria-modal="true" className="modal settings-modal" role="dialog"><header className="modal-header"><h2><Icon name="settings" size={18} /> Settings</h2><button aria-label="Close settings" onClick={onClose} type="button"><Icon name="x" size={18} /></button></header><div className="modal-body">
    <div className="settings-section"><h3 className="settings-section-title"><Icon name="user" size={16} /> Profile</h3><div className="settings-row"><span>{viewer?.display_name || 'Set your display name'}</span><button className="settings-link" onClick={onEditProfile} type="button">Edit profile</button></div></div>
    <div className="settings-section" data-no-translate><h3 className="settings-section-title"><Icon name="lock" size={16} /> Login & access</h3><p className="settings-help">Your existing IP permissions apply automatically. A role key can add privileged tools.</p><label className="settings-field">Role<select value={role} onChange={event => setRole(event.target.value)}>{['director','gatekeeper','analytics','editor'].map(value => <option key={value}>{value}</option>)}</select></label><label className="settings-field">Access key<input autoComplete="current-password" type="password" value={key} onChange={event => setKey(event.target.value)} /></label><div className="settings-actions"><button className="create-news-btn" disabled={busy || !key.trim()} onClick={() => change(false)} type="button">Log in</button><button className="settings-link" disabled={busy} onClick={() => change(true)} type="button">Log out role session</button></div>{message && <p role="status">{message}</p>}<p className="settings-help">{capabilities?.length || 0} permissions active</p></div>
    <div className="settings-section"><h3 className="settings-section-title"><Icon name="layers" size={16} /> Your workspace</h3><div className="settings-links"><Link to="/for-you/following" onClick={onClose}>Saved & Following</Link><Link to="/rejected" onClick={onClose}>Hidden News</Link><Link to="/history" onClick={onClose}>Briefing Archives</Link></div></div>
  </div></section></div>;
}

export default function SamparkApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const search = new URLSearchParams(location.search).get('q') || '';
  useTracking(pathname);
  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [capabilities, setCapabilities] = useState(null);
  const [serviceError, setServiceError] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileRequired, setProfileRequired] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const { language, setLanguage, translationState } = useLanguage();
  const has = value => Boolean(capabilities?.includes(value));
  const refreshAccess = async () => { const result = await getAccessCapabilities(); setCapabilities(Array.isArray(result?.capabilities) ? result.capabilities : []); };
  useEffect(() => {
    document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light';
    let cancelled = false;
    Promise.allSettled([getViewerProfile(), getAccessCapabilities()]).then(([profileResult, accessResult]) => {
      if (cancelled) return;
      if (profileResult.status === 'fulfilled') { const value = profileResult.value; setViewer(value); if (!String(value?.display_name || '').trim()) { setProfileRequired(true); setProfileOpen(true); } } else setServiceError(profileResult.reason?.message || 'Your profile could not be loaded.');
      if (accessResult.status === 'fulfilled') setCapabilities(Array.isArray(accessResult.value?.capabilities) ? accessResult.value.capabilities : []); else setServiceError(accessResult.reason?.message || 'Access could not be verified.');
      setViewerLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  const gate = (any, child) => capabilities === null ? <p role="status">Checking access…</p> : any.some(has) ? child : <div className="sampark-empty"><h2>This workspace requires access</h2><p>Open Settings to log in or contact your access administrator.</p></div>;
  const searchChange = value => navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/for-you', { replace: pathname === '/search' });
  return <div className="techscout-app"><a className="skip-link" href="#news-main-content">Skip to news</a>
    <header className="techscout-header"><div className="techscout-brand-row"><Link className="techscout-logo" to="/for-you"><span className="logo-samsung">SAMSUNG</span><span className="logo-techscout">TechScout</span></Link><div className="techscout-greeting"><h2>{viewerLoading ? 'Welcome!' : <>Hi <span data-no-translate>{viewer?.display_name || 'there'}</span>!</>} Your technology briefing</h2></div></div><div className="techscout-actions"><label className="search-bar"><Icon name="search" size={16} /><input aria-label="Search all archived news" placeholder="Search all news" type="search" value={pathname === '/search' ? search : ''} onChange={event => searchChange(event.target.value)} /></label><label className="lang-btn" data-no-translate><Icon name="globe" size={16} /><select aria-label="Interface language" value={language} onChange={event => { if (event.target.value === 'ko') translationState?.prepareBrowser?.(); setLanguage(event.target.value); }}><option value="en">English</option><option value="ko">한국어</option></select></label><button aria-label="Open settings" className="icon-btn settings-btn" onClick={() => setSettingsOpen(true)} type="button"><Icon name="settings" size={18} /></button>{has('contributions.create') && <a className="create-news-btn" href="/for-you/create/contributions"><Icon name="plus" size={16} /> Create News</a>}</div></header>
    {serviceError && <div className="service-error" role="alert">{serviceError}</div>}
    <div className="main-card-container"><nav aria-label="TechScout sections" className="main-tabs"><NavLink className="main-tab" to="/for-you"><Icon name="sparkle" size={16} /> For You</NavLink><NavLink className="main-tab" to="/home"><Icon name="globe" size={16} /> All News</NavLink><a className="main-tab" href="/research"><Icon name="file" size={16} /> Research</a><NavLink className="main-tab" to="/samsung-internal"><Icon name="layers" size={16} /> Samsung News</NavLink></nav><main className="content-area" id="news-main-content" tabIndex={-1}><Suspense fallback={<div className="sampark-empty" role="status">Opening workspace…</div>}><Routes key={revision}>
      <Route path="/" element={<Navigate replace to="/for-you" />} /><Route path="/index.html" element={<Navigate replace to="/for-you" />} /><Route path="/search" element={<ArchiveSearchScreen query={search} />} /><Route path="/for-you" element={<ForYouScreen presentation="sampark" resetPath="/sampark/for-you" />} /><Route path="/home" element={<FeedScreen presentation="sampark" capabilities={capabilities || []} />} />
      <Route path="/samsung-internal" element={<SamsungNewsScreen canManageAnnouncements={has('review.contributions.publish')} contributionAllowed={has('contributions.create')} />} /><Route path="/samsung-internal/leadership/:id" element={<SamsungInternalReaderScreen kind="leadership" />} /><Route path="/samsung-internal/announcement/:id" element={<SamsungInternalReaderScreen kind="announcement" />} /><Route path="/samsung-internal/story/:id" element={<SamsungInternalReaderScreen kind="story" />} />
      <Route path="/for-you/following" element={<FollowingScreen />} /><Route path="/saved/*" element={<Navigate replace to="/for-you/following" />} /><Route path="/rejected" element={<RejectedScreen />} /><Route path="/history" element={<SamparkArchiveScreen />} /><Route path="/voc" element={<VocScreen />} /><Route path="/selected" element={gate(['review.news.view','review.contributions.view'], <SelectedScreen capabilities={capabilities || []} />)} /><Route path="/approved" element={gate(['approved.view','review.news.approve'], <ApprovedScreen />)} /><Route path="/sources" element={gate(['sources.view','sources.manage'], <SourcesScreen canManage={has('sources.manage')} />)} /><Route path="/scheduler" element={gate(['scheduler.view','scheduler.control'], <SchedulerScreen canControl={has('scheduler.control')} />)} /><Route path="/director-analytics" element={gate(['analytics.view'], <AnalyticsScreen />)} /><Route path="/gatekeeper-review" element={gate(['gatekeeper.review'], <GatekeeperScreen />)} /><Route path="/access-management" element={gate(['access.manage'], <AccessManagementScreen />)} />
      {['/research','/scan','/for-you/create','/for-you/create/contributions'].map(path => <Route key={path} path={path} element={<ExistingScreen path={path} />} />)}<Route path="*" element={<div className="sampark-empty"><h1>Page not found</h1><Link to="/for-you">Return to For You</Link></div>} />
    </Routes></Suspense></main></div>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} viewer={viewer} capabilities={capabilities} onChanged={refreshAccess} onEditProfile={() => { setSettingsOpen(false); setProfileRequired(false); setProfileOpen(true); }} /><UserProfileModal open={profileOpen} firstVisit={profileRequired} viewer={viewer} onClose={() => { if (!profileRequired) setProfileOpen(false); }} onSaved={value => { setViewer(value); setProfileRequired(false); setProfileOpen(false); setRevision(current => current + 1); }} />
  </div>;
}
