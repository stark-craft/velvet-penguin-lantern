import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';

const profiles = [
  {
    id: 'default',
    label: 'Default Intelligence',
    accent: 'Blue',
    description: 'General executive AI news intelligence with blue signal highlights.',
  },
  {
    id: 'broadcast',
    label: 'Broadcast Intelligence',
    accent: 'Amber',
    description: 'Broadcast and media operations profile with amber signal highlights.',
  },
];

function readLocalValue(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export default function TrendsScreen() {
  const developerProfileToolsEnabled = import.meta.env.DEV
    && import.meta.env.VITE_ENABLE_PROFILE_SWITCHER === 'true';
  const [profile, setProfile] = useState(() => readLocalValue('news-profile', 'default'));
  const [name, setName] = useState(() => readLocalValue('initiator-name', 'Vineet'));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const savedTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(savedTimerRef.current), []);

  const chooseProfile = (nextProfile) => {
    setError('');
    try {
      localStorage.setItem('news-profile', nextProfile);
      localStorage.setItem('news-profile-override', nextProfile);
      setProfile(nextProfile);
      window.dispatchEvent(new CustomEvent('news-profile-change', { detail: nextProfile }));
    } catch {
      setError('This browser blocked profile storage. Allow local site data, then try again.');
    }
  };

  const save = (event) => {
    event?.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError('Enter a reviewer name before saving.');
      return;
    }
    setError('');
    try {
      localStorage.setItem('initiator-name', nextName);
      setName(nextName);
      setSaved(true);
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setError('This browser blocked reviewer-name storage. Allow local site data, then try again.');
    }
  };

  return (
    <div className="profile-page space-y-6">
      <section className="workspace-hero profile-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Workspace Settings</div>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Review preferences</h1>
          <p className="mt-3 text-slate-400">Set the reviewer identity used across selection flows on this browser.</p>
        </div>
      </section>

      {developerProfileToolsEnabled && <section className="profile-choice-grid grid gap-4 md:grid-cols-2" aria-label="Developer intelligence profile override">
        {profiles.map((p) => {
          const active = profile === p.id;
          return (
            <button
              key={p.id}
              className={[
                'profile-choice-card rounded-[24px] border p-5 text-left transition',
                active
                  ? p.id === 'broadcast'
                    ? 'border-amber-300/35 bg-amber-400/[0.08]'
                    : 'border-sky-300/35 bg-sky-400/[0.08]'
                  : 'border-white/10 bg-[#101827]/75 hover:border-white/20',
              ].join(' ')}
              onClick={() => chooseProfile(p.id)}
              aria-pressed={active}
              type="button"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="text-xl font-semibold text-white">{p.label}</div>
                {active && <span className={p.id === 'broadcast' ? 'signal-chip selected' : 'signal-chip'}>Active</span>}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{p.description}</p>
              <div className="mt-5 flex items-center gap-2">
                <span className={p.id === 'broadcast' ? 'h-4 w-4 rounded-full bg-amber-400' : 'h-4 w-4 rounded-full bg-sky-400'} />
                <span className="text-sm text-slate-400">{p.accent} accent system</span>
              </div>
            </button>
          );
        })}
      </section>}

      <section className="workspace-panel profile-identity-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <h2 className="text-lg font-semibold text-white">Reviewer Identity</h2>
        <p className="mt-1 text-sm text-slate-400">This name pre-fills the Select for Review flow.</p>
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={save}>
          <label>
            <span className="sr-only">Reviewer name</span>
            <input autoComplete="name" className="dark-input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Reviewer name" />
          </label>
          <button className="btn-dark-primary justify-center" disabled={!name.trim()} type="submit">
            <Icon name="check" /> Save reviewer
          </button>
        </form>
        {saved && <div className="mt-3 text-sm text-emerald-300" role="status">Reviewer preference saved on this browser.</div>}
        {error && <div className="mt-3 text-sm text-red-300" role="alert">{error}</div>}
      </section>

      {developerProfileToolsEnabled && <section className="workspace-panel profile-preview-panel rounded-[24px] border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-lg font-semibold text-white">Profile Preview</h2>
        <div className="profile-preview-card mt-4 rounded-2xl border border-white/10 bg-[#0b1220] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={profile === 'broadcast' ? 'signal-chip selected' : 'signal-chip'}>
              {profile === 'broadcast' ? 'Broadcast Signal' : 'Default Signal'}
            </span>
            <span className="source-chip">Score 88</span>
            <span className="source-chip">9 sources</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white">
            {profile === 'broadcast'
              ? 'Broadcast intelligence operations profile is active.'
              : 'Executive intelligence cockpit profile is active.'}
          </div>
          <p className="mt-2 text-sm text-slate-400">Your active stream now controls sources, history, feedback training, and new searches.</p>
        </div>
      </section>}
    </div>
  );
}
