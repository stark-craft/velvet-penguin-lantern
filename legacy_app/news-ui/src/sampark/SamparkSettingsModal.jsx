import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import { applySamparkTheme, readSamparkTheme, saveSamparkTheme } from './theme.js';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';
import {
  getViewerPreferences,
  logoutCapabilitySession,
  pauseViewerPersonalization,
  unlockCapabilitySession,
  updateViewerPreferences,
  updateViewerProfile,
} from '../news-scrapper/api.js';

export const SAMPARK_SETTINGS_KEY = 'sampark-shell-settings-v1';

export const DEFAULT_SAMPARK_SETTINGS = {
  saveSearchHistory: true,
  personalizedFeed: true,
};

export function readSamparkSettings() {
  try {
    return { ...DEFAULT_SAMPARK_SETTINGS, ...JSON.parse(window.localStorage.getItem(SAMPARK_SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SAMPARK_SETTINGS };
  }
}

function ToggleRow({ checked, children, onChange, focusKey }) {
  return <div className="settings-row" data-focus={focusKey || undefined}><span>{children}</span><label className="settings-toggle"><input aria-label={typeof children === 'string' ? children : undefined} checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span className="toggle-slider" /></label></div>;
}

export default function SamparkSettingsModal({ capabilities, privilegedSessionActive, sessionRole, onAccessChanged, onClose, onSaved, open, settings, viewer }) {
  const [draft, setDraft] = useState(settings);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('director');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [theme, setTheme] = useState(() => { try { return readSamparkTheme(); } catch { return 'light'; } });
  const [openingTheme, setOpeningTheme] = useState('light');
  const themeSavedRef = React.useRef(false);
  const [sectionStatus, setSectionStatus] = useState({ profile: '', feed: '', history: '' });
  // Theme previews immediately but persists only with Save Settings; Cancel,
  // Escape, and overlay close restore the opening theme.
  const cancelWithoutSave = () => {
    if (!themeSavedRef.current) {
      setTheme(openingTheme);
      applySamparkTheme(openingTheme);
      try { window.localStorage.setItem('sampark-theme', openingTheme); } catch {}
    }
    onClose();
  };
  const dialogRef = useModalFocus(open, cancelWithoutSave);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setTheme(readSamparkTheme());
    setOpeningTheme(readSamparkTheme());
    themeSavedRef.current = false;
    setName(viewer?.display_name || '');
    setEmail(viewer?.email || '');
    setKey('');
    setMessage('');
    setFieldError('');
    // sync from server authority on open
    getViewerPreferences().then((r) => {
      const pref = r?.preferences || {};
      const serverRemember = typeof pref.remember_search_history === 'boolean' ? pref.remember_search_history : typeof pref.rememberSearchHistory === 'boolean' ? pref.rememberSearchHistory : null;
      if (serverRemember !== null && serverRemember !== settings.saveSearchHistory) {
        setDraft((c) => ({ ...c, saveSearchHistory: serverRemember }));
      }
    }).catch(() => {});
    // focus requested Remember Search History if flagged
    const focus = (() => { try { return window.localStorage.getItem('sampark-settings-focus'); } catch { return null; }})();
    if (focus === 'remember_search_history') {
      try { window.localStorage.removeItem('sampark-settings-focus'); } catch {}
      setTimeout(() => {
        const el = document.querySelector('[data-focus="remember_search_history"] input');
        if (el) el.focus();
      }, 120);
    }
  }, [open, settings, viewer]);

  // Server-authoritative session truth: capabilities alone never prove a
  // privileged session (network/principal grants also contribute).
  const hasPrivilegedSession = Boolean(privilegedSessionActive);
  const accessStatusLabel = hasPrivilegedSession ? `Privileged session active${sessionRole ? ` · ${sessionRole}` : ''}` : 'Standard access — IP/network permissions';

  if (!open) return null;
  const setOption = (option, value) => setDraft((current) => ({ ...current, [option]: value }));

  const changeAccess = async (logout) => {
    setBusy('access');
    setMessage('');
    try {
      if (logout) await logoutCapabilitySession();
      else await unlockCapabilitySession(role, key);
      setKey('');
      await onAccessChanged();
      setMessage(logout ? 'Role session signed out. Network permissions still apply.' : 'Access updated.');
    } catch (error) {
      setMessage(error?.message || 'Access could not be updated.');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    setMessage('');
    setFieldError('');
    setSectionStatus({ profile: '', feed: '', history: '' });
    const parts = { profile: '', feed: '', history: '' };
    try {
      let nextViewer = viewer;
      const cleanName = name.trim();
      const cleanEmail = email.trim();
      if (cleanName.length < 2) {
        const msg = 'Display name must contain at least 2 characters.';
        setFieldError(msg);
        throw new Error(msg);
      }
      if (cleanName !== String(viewer?.display_name || '').trim() || cleanEmail !== String(viewer?.email || '').trim()) {
        try {
          const response = await updateViewerProfile({ display_name: cleanName, email: cleanEmail });
          if (response?.status !== 'success') throw new Error(response?.detail || response?.message || 'Profile could not be saved.');
          nextViewer = { ...viewer, ...response, display_name: cleanName, email: cleanEmail };
          parts.profile = 'saved';
        } catch (profileError) {
          const status = profileError?.status;
          const msg = profileError?.message || '';
          if (status === 409 || /already in use/i.test(msg)) {
            const inline = `“${cleanName}” is already taken. Choose a different display name.`;
            setFieldError(inline);
            throw new Error(inline);
          }
          parts.profile = `failed: ${msg || 'could not be saved'}`;
          throw profileError;
        }
      } else {
        parts.profile = 'unchanged';
      }
      if (draft.personalizedFeed !== settings.personalizedFeed) {
        try {
          await pauseViewerPersonalization(!draft.personalizedFeed);
          parts.feed = 'saved';
        } catch (feedError) {
          parts.feed = `failed: ${feedError?.message || 'could not be saved'}`;
          throw feedError;
        }
      } else {
        parts.feed = 'unchanged';
      }
      // Server-authoritative Remember Search History: mirror to server, localStorage is cache only; do not pretend success on failure
      if (draft.saveSearchHistory !== settings.saveSearchHistory) {
        let ok = false;
        let lastError = null;
        try {
          await updateViewerPreferences({ remember_search_history: draft.saveSearchHistory });
          ok = true;
        } catch (e) {
          lastError = e;
          try { await updateViewerPreferences({ rememberSearchHistory: draft.saveSearchHistory }); ok = true; lastError = null; } catch (e2) { lastError = e2; }
        }
        if (!ok) {
          parts.history = `failed: ${lastError?.message || 'could not be saved'}`;
          throw lastError || new Error('Could not save search-history preference');
        }
        parts.history = 'saved';
        if (!draft.saveSearchHistory) {
          window.localStorage.removeItem('sampark-search-history-v1');
          try {
            const principal = String(viewer?.principal || '').trim();
            if (principal) window.localStorage.removeItem(`sampark-search-history-v1:${principal.slice(0,8)}`);
          } catch {}
        }
      } else {
        parts.history = 'unchanged';
      }
      setSectionStatus(parts);
      themeSavedRef.current = true;
      saveSamparkTheme(theme);
      window.localStorage.setItem(SAMPARK_SETTINGS_KEY, JSON.stringify(draft));
      // re-read server to ensure authoritative state
      try {
        const refreshed = await getViewerPreferences();
        const pref = refreshed?.preferences || {};
        const serverRemember = typeof pref.remember_search_history === 'boolean' ? pref.remember_search_history : null;
        if (serverRemember !== null && serverRemember !== draft.saveSearchHistory) {
          const corrected = { ...draft, saveSearchHistory: serverRemember };
          window.localStorage.setItem(SAMPARK_SETTINGS_KEY, JSON.stringify(corrected));
          onSaved(corrected, nextViewer);
          onClose();
          return;
        }
      } catch {
        setMessage('Saved, but the verification read failed — please reopen Settings to confirm.');
        onSaved(draft, nextViewer);
        return;
      }
      onSaved(draft, nextViewer);
      onClose();
    } catch (error) {
      setSectionStatus(parts);
      const msg = error?.message || 'Settings could not be saved. Please try again.';
      if (/already taken|at least 2/i.test(msg)) {
        // inline already set, keep modal open
        if (!document.querySelector('.sampark-field-error')) setFieldError(msg);
      } else {
        const saved = Object.entries(parts).filter(([, v]) => v === 'saved').map(([k]) => k).join(', ');
        const failed = Object.entries(parts).filter(([, v]) => String(v).startsWith('failed')).map(([k]) => k).join(', ');
        setMessage(`${msg}${saved ? ` Saved: ${saved}.` : ''}${failed ? ` Failed: ${failed} — retry that section.` : ''}`);
      }
    } finally {
      setBusy('');
    }
  };

  const privacyStatus = !draft.saveSearchHistory && !draft.personalizedFeed
    ? 'Reduced tracking — search history not retained and ranking paused.'
    : !draft.saveSearchHistory
      ? 'Search history not retained — ranking still personalized.'
      : !draft.personalizedFeed
        ? 'Personalized ranking paused — search history still remembered.'
        : 'Personalization active — search history remembered.';

  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelWithoutSave(); }}>
    <section aria-labelledby="settings-title" aria-modal="true" className="settings-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="modal-header"><h2 id="settings-title">Settings</h2><button aria-label="Close settings" onClick={cancelWithoutSave} type="button"><Icon name="x" size={18} /></button></header>
      <div className="modal-body">
        <section className="settings-section"><h3><Icon name="user" size={16} />Profile</h3>
          <label className="settings-field"><span>Display name</span><input aria-describedby={fieldError ? 'display-name-error' : undefined} aria-invalid={Boolean(fieldError)} autoComplete="nickname" maxLength={80} onChange={(event) => { setName(event.target.value); if (fieldError) setFieldError(''); }} value={name} /></label>
          {fieldError && <p className="sampark-field-error" id="display-name-error" role="alert">⚠ {fieldError}</p>}
          <label className="settings-field"><span>Email <small>optional</small></span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
        </section>
        <section className="settings-section"><h3><Icon name="shield" size={16} />Privacy</h3>
          <ToggleRow checked={draft.saveSearchHistory} focusKey="remember_search_history" onChange={(value) => setOption('saveSearchHistory', value)}>Remember Search History</ToggleRow>
          <p className="settings-note">When on, your recent searches (up to 12 unique queries, length-limited and deduplicated) are kept privately for your browser and may lightly tune your For You briefing. Stored per signed viewer, never in shared analytics or global Gatekeeper data.</p>
          <ToggleRow checked={draft.personalizedFeed} onChange={(value) => setOption('personalizedFeed', value)}>Personalized For You</ToggleRow>
          <p className="settings-note">Allow TechScout to adapt For You from your preferences and activity. Turn off to pause ranking.</p>
          <div className="sampark-privacy-status" role="status"><strong>Privacy status</strong><span>{privacyStatus}</span></div>
        </section>
        <section className="settings-section" data-no-translate><h3><Icon name="key" size={16} />Login & access</h3><p className="settings-note">Network permissions apply automatically. A role key adds protected tools. {accessStatusLabel}.</p><label className="settings-field"><span>Role to unlock</span><select onChange={(event) => setRole(event.target.value)} value={role}><option value="director">Director</option><option value="gatekeeper">Gatekeeper</option><option value="analytics">Analytics</option><option value="editor">Editor</option><option value="executive">Executive Control</option></select></label><label className="settings-field"><span>Access key</span><input autoComplete="current-password" onChange={(event) => setKey(event.target.value)} type="password" value={key} /></label><div className="settings-inline-actions"><button disabled={busy === 'access' || !key.trim()} onClick={() => changeAccess(false)} type="button">Log in</button><button disabled={busy === 'access'} onClick={() => changeAccess(true)} type="button">Log out role session</button></div><p className="settings-note">{capabilities?.length || 0} permissions active · {hasPrivilegedSession ? 'Privileged session' : 'Standard/network'}</p></section>
        <section className="settings-section"><h3><Icon name="layers" size={16} />Appearance</h3>
          <label className="settings-field"><span>Theme (preview now, keep with Save Settings)</span><select aria-label="Color theme" onChange={(event) => { const next = event.target.value; setTheme(next); applySamparkTheme(next); }} value={theme}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>
          <p className="settings-note">Applies to dialogs, cards, tables, and controls on this browser. Choosing a theme previews it; Cancel restores the previous theme.</p>
        </section>
        <section className="settings-section"><h3><Icon name="layers" size={16} />Workspaces</h3><div className="settings-links"><Link to="/following" onClick={cancelWithoutSave}>Saved & Following</Link><Link to="/hidden" onClick={cancelWithoutSave}>Hidden News</Link><Link to="/history" onClick={cancelWithoutSave}>Briefing Archives</Link><Link to="/voc" onClick={cancelWithoutSave}>Feedback</Link>{capabilities?.includes('review.news.view') && <Link to="/review" onClick={cancelWithoutSave}>Review Queue</Link>}{capabilities?.includes('approved.view') && <Link to="/approved" onClick={cancelWithoutSave}>Approved Briefing</Link>}{capabilities?.includes('gatekeeper.review') && <Link to="/gatekeeper" onClick={cancelWithoutSave}>Gatekeeper Review</Link>}{capabilities?.includes('sources.view') && <Link to="/sources" onClick={cancelWithoutSave}>Source Control</Link>}{capabilities?.includes('scheduler.view') && <Link to="/scheduler" onClick={cancelWithoutSave}>Scheduler</Link>}{capabilities?.includes('analytics.view') && <Link to="/analytics" onClick={cancelWithoutSave}>Analytics</Link>}{capabilities?.includes('access.manage') && <Link to="/access" onClick={cancelWithoutSave}>Access Management</Link>}</div></section>
        {message && <p className="settings-message" role={message.includes('could not') || message.startsWith('Enter') || message.includes('Failed') ? 'alert' : 'status'}>{message}</p>}
        {(sectionStatus.profile || sectionStatus.feed || sectionStatus.history) && (
          <ul className="settings-section-status" aria-label="Per-section save status">
            {sectionStatus.profile && <li>Profile: {sectionStatus.profile}</li>}
            {sectionStatus.feed && <li>Personalized feed: {sectionStatus.feed}</li>}
            {sectionStatus.history && <li>Search history: {sectionStatus.history}</li>}
          </ul>
        )}
      </div>
      <footer className="modal-footer"><button className="btn-secondary" disabled={Boolean(busy)} onClick={cancelWithoutSave} type="button">Cancel</button><button className="btn-primary" disabled={Boolean(busy)} onClick={save} type="button">{busy === 'save' ? 'Saving…' : 'Save Settings'}</button></footer>
    </section>
  </div>;
}
