import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getAnalytics, getAnalyticsAccess } from '../api.js';

function isLocalDevHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function StatTile({ label, value, tone = 'sky' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-100'
    : tone === 'amber'
      ? 'border-amber-300/20 bg-amber-400/[0.08] text-amber-100'
      : 'border-sky-300/20 bg-sky-400/[0.08] text-sky-100';

  return (
    <div className={`rounded-[22px] border p-5 ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">{label}</div>
      <div className="mt-3 text-4xl font-semibold text-white">{value}</div>
    </div>
  );
}

function DeviceRow({ device }) {
  const today = device.today || {};
  const totals = device.totals || {};

  return (
    <div className="grid gap-4 rounded-[22px] border border-white/10 bg-[#101827]/76 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={device.known_team_member ? 'signal-chip selected' : 'signal-chip'}>
            {device.owner || 'Unknown'}
          </span>
          <span className="source-chip">{device.profile || 'default'}</span>
        </div>
        <div className="mt-3 font-mono text-sm text-slate-300">{device.ip}</div>
        <div className="mt-1 text-xs text-slate-500">Device {device.device_id}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Loads</div>
          <div className="mt-1 text-lg font-semibold text-white">{totals.page_loads || 0}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Clicks</div>
          <div className="mt-1 text-lg font-semibold text-white">{totals.articles_clicked || 0}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Votes</div>
          <div className="mt-1 text-lg font-semibold text-white">{totals.votes || 0}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Today</div>
          <div className="mt-1 text-lg font-semibold text-white">{today.page_loads || 0}</div>
        </div>
      </div>

      <div className="text-right">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Score</div>
        <div className="mt-1 text-3xl font-semibold text-white">{device.engagement_score || 0}</div>
      </div>
    </div>
  );
}

export default function AnalyticsScreen() {
  const [access, setAccess] = useState(null);
  const [key, setKey] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    getAnalyticsAccess()
      .then((result) => {
        if (!cancelled) setAccess({
          ...result,
          allowed: Boolean(result?.allowed) || isLocalDevHost(),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAccess({
            allowed: isLocalDevHost(),
            ip: window.location.hostname || 'unknown',
            owner: isLocalDevHost() ? 'Local Dev' : 'Unknown',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const devices = data?.devices || [];
    return devices.reduce(
      (acc, device) => {
        const t = device.totals || {};
        acc.loads += t.page_loads || 0;
        acc.clicks += t.articles_clicked || 0;
        acc.votes += t.votes || 0;
        acc.exports += t.exports || 0;
        return acc;
      },
      { loads: 0, clicks: 0, votes: 0, exports: 0 }
    );
  }, [data]);

  const unlock = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const result = await getAnalytics(key.trim());
      setData(result);
    } catch (err) {
      setError('Analytics access failed. Check your network and key.');
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  if (access && !access.allowed) {
    return (
      <div className="mx-auto max-w-3xl rounded-[28px] border border-amber-300/20 bg-amber-400/[0.08] p-8 shadow-cockpit">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-100">Restricted Analytics</div>
        <h1 className="mt-3 text-4xl font-semibold text-white">This network is not allowlisted.</h1>
        <p className="mt-4 text-slate-300">
          Analytics is visible only from approved leadership IP addresses. Current IP: {access.ip || 'unknown'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Director Analytics</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Usage command view</h1>
            <p className="mt-3 max-w-3xl text-slate-400">
              IP allowlist plus analytics key protection for engagement, feedback, and briefing usage.
            </p>
          </div>
          {access && (
            <span className="signal-chip selected">
              {access.owner || 'Allowed'} · {access.ip}
            </span>
          )}
        </div>
      </section>

      {!data && (
        <form className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-5" onSubmit={unlock}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Analytics key
            </span>
            <input
              className="dark-input w-full"
              onChange={(event) => setKey(event.target.value)}
              placeholder="Enter analytics access key"
              type="password"
              value={key}
            />
          </label>
          {error && <div className="mt-3 text-sm text-red-200">{error}</div>}
          <button className="btn-dark-primary mt-4 justify-center" disabled={busy || !key.trim()} type="submit">
            <Icon name="shield" /> {busy ? 'Verifying...' : 'Unlock Analytics'}
          </button>
        </form>
      )}

      {data && (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <StatTile label="Devices" value={data.device_count || 0} />
            <StatTile label="Known Team" value={data.known_team_member_count || 0} tone="emerald" />
            <StatTile label="Page Loads" value={totals.loads} />
            <StatTile label="Engagements" value={totals.clicks + totals.votes + totals.exports} tone="amber" />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">Device Activity</h2>
              <span className="text-sm text-slate-500">{data.date}</span>
            </div>
            {(data.devices || []).length
              ? data.devices.map((device) => <DeviceRow device={device} key={device.device_id} />)
              : (
                <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-5 text-slate-400">
                  No tracked activity yet.
                </div>
              )}
          </section>
        </>
      )}
    </div>
  );
}
