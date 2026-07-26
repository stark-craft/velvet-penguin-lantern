import React, { useState } from 'react';
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

export default function TrendsScreen() {
  const [profile, setProfile] = useState(localStorage.getItem('news-profile') || 'default');
  const [name, setName] = useState(localStorage.getItem('initiator-name') || 'Vineet');
  const [saved, setSaved] = useState(false);

  const chooseProfile = (nextProfile) => {
    setProfile(nextProfile);
    localStorage.setItem('news-profile', nextProfile);
    localStorage.setItem('news-profile-override', nextProfile);
    window.dispatchEvent(new CustomEvent('news-profile-change', { detail: nextProfile }));
  };

  const save = () => {
    localStorage.setItem('initiator-name', name.trim() || 'Vineet');
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Profile Settings</div>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Intelligence profile</h1>
          <p className="mt-3 text-slate-400">Choose the backend intelligence stream and default reviewer identity used across selection flows.</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {profiles.map((p) => {
          const active = profile === p.id;
          return (
            <button
              key={p.id}
              className={[
                'rounded-[24px] border p-5 text-left transition',
                active
                  ? p.id === 'broadcast'
                    ? 'border-amber-300/35 bg-amber-400/[0.08]'
                    : 'border-sky-300/35 bg-sky-400/[0.08]'
                  : 'border-white/10 bg-[#101827]/75 hover:border-white/20',
              ].join(' ')}
              onClick={() => chooseProfile(p.id)}
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
      </section>

      <section className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <h2 className="text-lg font-semibold text-white">Reviewer Identity</h2>
        <p className="mt-1 text-sm text-slate-400">This name pre-fills the Select for Review flow.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input className="dark-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reviewer name" />
          <button className="btn-dark-primary justify-center" onClick={save} type="button">
            <Icon name="check" /> Save Profile
          </button>
        </div>
        {saved && <div className="mt-3 text-sm text-emerald-300">Profile settings saved.</div>}
      </section>

      <section className="rounded-[24px] border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-lg font-semibold text-white">Profile Preview</h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b1220] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={profile === 'broadcast' ? 'signal-chip selected' : 'signal-chip'}>
              {profile === 'broadcast' ? 'Broadcast Signal' : 'Default Signal'}
            </span>
            <span className="source-chip">Score 88</span>
            <span className="source-chip">9 sources</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-white">Executive intelligence cockpit profile is active.</div>
          <p className="mt-2 text-sm text-slate-400">Your active stream now controls sources, history, feedback training, and new searches.</p>
        </div>
      </section>
    </div>
  );
}
