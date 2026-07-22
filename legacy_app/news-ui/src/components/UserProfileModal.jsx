import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

const NAME_KEY = 'news-viewer-name';
const EMAIL_KEY = 'news-viewer-email';

export function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return ['Good morning', 'Your intelligence desk is ready.'];
  if (hour < 17) return ['Good afternoon', 'Here is what is moving right now.'];
  return ['Good evening', 'Let’s close the day with the right signals.'];
}

export default function UserProfileModal({ open, firstVisit = false, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [ip, setIp] = useState('Detected by the secure backend');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(localStorage.getItem(NAME_KEY) || '');
    setEmail(localStorage.getItem(EMAIL_KEY) || '');
    setError('');
    fetch('/viewer/profile').then((r) => r.ok ? r.json() : null).then((data) => {
      if (!data) return;
      if (!localStorage.getItem(NAME_KEY) && data.display_name) setName(data.display_name);
      if (!localStorage.getItem(EMAIL_KEY) && data.email) setEmail(data.email);
      if (data.ip) setIp(data.ip);
    }).catch(() => {});
  }, [open]);

  if (!open) return null;
  const save = async () => {
    const clean = name.trim();
    if (clean.length < 2) return setError('Choose a name with at least two characters.');
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/viewer/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: clean, email: email.trim() }) });
      const responseType = response.headers.get('content-type') || '';
      const result = responseType.includes('application/json') ? await response.json() : {};
      if (!response.ok) throw new Error(result?.detail || `Profile service returned ${response.status}.`);
      if (result?.status !== 'success') throw new Error(result?.detail || result?.message || 'The profile service returned an unexpected response.');
      localStorage.setItem(NAME_KEY, clean);
      localStorage.setItem('initiator-name', clean);
      localStorage.setItem(EMAIL_KEY, email.trim());
      window.dispatchEvent(new CustomEvent('news-viewer-change', { detail: { name: clean } }));
      onSaved(clean);
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
      <div className="profile-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="profile-dialog-art"><span>✦</span><div><small>{greeting}</small><strong>{name.trim() || 'Intelligence explorer'}</strong><p>{note}</p></div></div>
        <div className="profile-dialog-content">
          <div className="profile-dialog-head"><div><span className="eyebrow">Make this desk yours</span><h2>What should newsScrapper call you?</h2></div>{!firstVisit && <button onClick={onClose} title="Close profile" type="button"><Icon name="x" /></button>}</div>
          <p>Your display name personalizes greetings and attributes review activity. It does not change the shared feed.</p>
          <label><span>Display name</span><input autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Anything you like" value={name} /></label>
          <label><span>Email <em>optional</em></span><input onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" type="email" value={email} /></label>
          <div className="profile-ip"><Icon name="shield" size={16} /><div><span>Current network identity</span><strong>{ip}</strong><small>Stored activity uses a protected IP hash.</small></div></div>
          {error && <div className="profile-error">{error}</div>}
          <button className="profile-save" disabled={saving} onClick={save} type="button">{saving ? 'Saving…' : 'Save my desk'} <Icon name="chevR" /></button>
        </div>
      </div>
    </div>
  );
}
