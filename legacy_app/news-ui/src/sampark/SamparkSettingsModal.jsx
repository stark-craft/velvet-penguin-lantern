import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';
import {
  logoutCapabilitySession,
  pauseViewerPersonalization,
  unlockCapabilitySession,
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

function ToggleRow({ checked, children, onChange }) {
  return <div className="settings-row"><span>{children}</span><label className="settings-toggle"><input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span className="toggle-slider" /></label></div>;
}

export default function SamparkSettingsModal({ capabilities, onAccessChanged, onClose, onSaved, open, settings, viewer }) {
  const [draft, setDraft] = useState(settings);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('director');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const dialogRef = useModalFocus(open, onClose);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setName(viewer?.display_name || '');
    setEmail(viewer?.email || '');
    setKey('');
    setMessage('');
    setFieldError('');
  }, [open, settings, viewer]);

  // Do not infer exact role from effective capabilities (union of IP + session)
  const hasPrivilegedSession = Boolean(capabilities?.length);
  const accessStatusLabel = hasPrivilegedSession ? 'Privileged session active' : 'Standard access — IP/network permissions';

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
        } catch (profileError) {
          const status = profileError?.status;
          const msg = profileError?.message || '';
          if (status === 409 || /already in use/i.test(msg)) {
            const inline = `“${cleanName}” is already taken. Choose a different display name.`;
            setFieldError(inline);
            throw new Error(inline);
          }
          throw profileError;
        }
      }
      if (draft.personalizedFeed !== settings.personalizedFeed) await pauseViewerPersonalization(!draft.personalizedFeed);
      // Privacy: when search history is turned OFF, clear existing history immediately
      if (!draft.saveSearchHistory) {
        window.localStorage.removeItem('sampark-search-history-v1');
      }
      window.localStorage.setItem(SAMPARK_SETTINGS_KEY, JSON.stringify(draft));
      onSaved(draft, nextViewer);
      onClose();
    } catch (error) {
      const msg = error?.message || 'Settings could not be saved. Please try again.';
      if (/already taken|at least 2/i.test(msg)) {
        // inline already set, keep modal open
        if (!document.querySelector('.sampark-field-error')) setFieldError(msg);
      } else {
        setMessage(msg);
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

  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-labelledby="settings-title" aria-modal="true" className="settings-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="modal-header"><h2 id="settings-title">Settings</h2><button aria-label="Close settings" onClick={onClose} type="button"><Icon name="x" size={18} /></button></header>
      <div className="modal-body">
        <section className="settings-section"><h3><Icon name="user" size={16} />Profile</h3>
          <label className="settings-field"><span>Display name</span><input aria-describedby={fieldError ? 'display-name-error' : undefined} aria-invalid={Boolean(fieldError)} autoComplete="nickname" maxLength={80} onChange={(event) => { setName(event.target.value); if (fieldError) setFieldError(''); }} value={name} /></label>
          {fieldError && <p className="sampark-field-error" id="display-name-error" role="alert">⚠ {fieldError}</p>}
          <label className="settings-field"><span>Email <small>optional</small></span><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
        </section>
        <section className="settings-section"><h3><Icon name="shield" size={16} />Privacy</h3>
          <ToggleRow checked={draft.saveSearchHistory} onChange={(value) => setOption('saveSearchHistory', value)}>Remember Search History</ToggleRow>
          <p className="settings-note">Save searches on this browser for quicker access later. Stored in this browser only.</p>
          <ToggleRow checked={draft.personalizedFeed} onChange={(value) => setOption('personalizedFeed', value)}>Personalized For You</ToggleRow>
          <p className="settings-note">Allow TechScout to adapt For You from your preferences and activity. Turn off to pause ranking.</p>
          <div className="sampark-privacy-status" role="status"><strong>Privacy status</strong><span>{privacyStatus}</span></div>
        </section>
        <section className="settings-section" data-no-translate><h3><Icon name="key" size={16} />Login & access</h3><p className="settings-note">Network permissions apply automatically. A role key adds protected tools. {accessStatusLabel}.</p><label className="settings-field"><span>Role to unlock</span><select onChange={(event) => setRole(event.target.value)} value={role}><option value="director">Director</option><option value="gatekeeper">Gatekeeper</option><option value="analytics">Analytics</option><option value="editor">Editor</option></select></label><label className="settings-field"><span>Access key</span><input autoComplete="current-password" onChange={(event) => setKey(event.target.value)} type="password" value={key} /></label><div className="settings-inline-actions"><button disabled={busy === 'access' || !key.trim()} onClick={() => changeAccess(false)} type="button">Log in</button><button disabled={busy === 'access'} onClick={() => changeAccess(true)} type="button">Log out role session</button></div><p className="settings-note">{capabilities?.length || 0} permissions active · {hasPrivilegedSession ? 'Privileged session' : 'Standard/network'}</p></section>
        <section className="settings-section"><h3><Icon name="layers" size={16} />Workspaces</h3><div className="settings-links"><a href="/for-you/following">Saved & Following</a><a href="/rejected">Hidden News</a><a href="/history">Briefing Archives</a><a href="/voc">Feedback</a>{capabilities?.includes('review.news.view') && <a href="/selected">Review Queue</a>}{capabilities?.includes('approved.view') && <a href="/approved">Approved Briefing</a>}{capabilities?.includes('sources.view') && <a href="/sources">Source Control</a>}{capabilities?.includes('scheduler.view') && <a href="/scheduler">Scheduler</a>}{capabilities?.includes('analytics.view') && <a href="/director-analytics">Analytics</a>}{capabilities?.includes('access.manage') && <a href="/access-management">Access Management</a>}</div></section>
        {message && <p className="settings-message" role={message.includes('could not') || message.startsWith('Enter') ? 'alert' : 'status'}>{message}</p>}
      </div>
      <footer className="modal-footer"><button className="btn-secondary" disabled={Boolean(busy)} onClick={onClose} type="button">Cancel</button><button className="btn-primary" disabled={Boolean(busy)} onClick={save} type="button">{busy === 'save' ? 'Saving…' : 'Save Settings'}</button></footer>
    </section>
  </div>;
}
