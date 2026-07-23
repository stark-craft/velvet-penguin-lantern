import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { getViewerProfile, updateViewerProfile } from '../api.js';

const NAME_KEY = 'news-viewer-name';
const EMAIL_KEY = 'news-viewer-email';

export function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return ['Good morning', 'Your intelligence desk is ready.'];
  if (hour < 17) return ['Good afternoon', 'Here is what is moving right now.'];
  return ['Good evening', 'Let’s close the day with the right signals.'];
}

export default function UserProfileModal({ open, firstVisit = false, viewer, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [ip, setIp] = useState('Detected by the secure backend');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(viewer?.display_name || localStorage.getItem(NAME_KEY) || '');
    setEmail(viewer?.email || localStorage.getItem(EMAIL_KEY) || '');
    setError('');
    getViewerProfile().then((data) => {
      if (!data) return;
      if (!localStorage.getItem(NAME_KEY) && data.display_name) setName(data.display_name);
      if (!localStorage.getItem(EMAIL_KEY) && data.email) setEmail(data.email);
      if (data.ip) setIp(data.ip);
    }).catch(() => {});
  }, [open, viewer]);

  useEffect(() => {
    if (!open || firstVisit) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [firstVisit, onClose, open]);

  if (!open) return null;
  const save = async () => {
    const clean = name.trim();
    if (clean.length < 2) return setError('Choose a name with at least two characters.');
    setSaving(true);
    setError('');
    try {
      const result = await updateViewerProfile({
        display_name: clean,
        email: email.trim(),
      });
      if (result?.status !== 'success') throw new Error(result?.detail || result?.message || 'The profile service returned an unexpected response.');
      localStorage.setItem(NAME_KEY, clean);
      localStorage.setItem('initiator-name', clean);
      localStorage.setItem(EMAIL_KEY, email.trim());
      const savedProfile = {
        ...viewer,
        ...result,
        display_name: clean,
        email: email.trim(),
        ip: result?.ip || ip,
      };
      onSaved(savedProfile);
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };
  const [greeting, note] = greetingFor();
  return (
    <div className="modal-overlay profile-overlay" onClick={firstVisit ? undefined : onClose}>
      <div aria-describedby="viewer-profile-description" aria-labelledby="viewer-profile-title" aria-modal="true" className="profile-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="profile-dialog-art"><span>✦</span><div><small>{greeting}</small><strong>{name.trim() || 'Intelligence explorer'}</strong><p>{note}</p></div></div>
        <div className="profile-dialog-content">
          <div className="profile-dialog-head"><div><span className="eyebrow">Make this desk yours</span><h2 id="viewer-profile-title">What should TechScout call you?</h2></div>{!firstVisit && <button aria-label="Close profile" onClick={onClose} title="Close profile" type="button"><Icon name="x" /></button>}</div>
          <p id="viewer-profile-description">Your display name personalizes greetings and attributes review activity. It does not change the shared feed.</p>
          <label><span>Display name</span><input autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Anything you like" value={name} /></label>
          <label><span>Email <em>optional</em></span><input onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email" value={email} /></label>
          <div className="profile-ip"><Icon name="shield" size={16} /><div><span>Current network identity</span><strong>{ip}</strong><small>Stored activity uses a protected IP hash.</small></div></div>
          {error && <div className="profile-error">{error}</div>}
          <button className="profile-save" disabled={saving} onClick={save} type="button">{saving ? 'Saving…' : firstVisit ? 'Enter my intelligence desk' : 'Save profile'} <Icon name="chevR" /></button>
        </div>
      </div>
    </div>
  );
}
