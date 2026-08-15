import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getAnalytics, getAnalyticsAccess, getRecommendationAnalytics, getViewerProfile } from '../api.js';

function isLocalDevHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function resolvedViewerName(accessResult, viewerResult) {
  const accessOwner = String(accessResult?.owner || '').trim();
  if (accessOwner && accessOwner.toLowerCase() !== 'unknown') return accessOwner;
  const backendName = String(viewerResult?.display_name || viewerResult?.name || '').trim();
  if (backendName) return backendName;
  try {
    const browserName = String(localStorage.getItem('news-viewer-name') || localStorage.getItem('initiator-name') || '').trim();
    if (browserName) return browserName;
  } catch {
    // Storage can be unavailable in hardened browser modes.
  }
  return 'Current viewer';
}

function StatTile({ label, value, tone = 'sky' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-100'
    : tone === 'amber'
      ? 'border-amber-300/20 bg-amber-400/[0.08] text-amber-100'
      : 'border-sky-300/20 bg-sky-400/[0.08] text-sky-100';

  return (
    <div className={`analytics-stat rounded-[22px] border p-5 ${toneClass}`}>
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
  const [recommendationData, setRecommendationData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [recommendationWarning, setRecommendationWarning] = useState('');

  const checkAccess = async () => {
    setAccess(null);
    setAccessError('');
    const viewerPromise = getViewerProfile().catch(() => null);
    try {
      const result = await getAnalyticsAccess();
      const viewerResult = await viewerPromise;
      setAccess({
          ...result,
          owner: resolvedViewerName(result, viewerResult),
          allowed: Boolean(result?.allowed) || isLocalDevHost(),
      });
    } catch (err) {
      const viewerResult = await viewerPromise;
      setAccessError(err?.message || 'Could not verify analytics network access.');
      setAccess({
        allowed: isLocalDevHost(),
        ip: window.location.hostname || 'unknown',
        owner: resolvedViewerName(null, viewerResult),
      });
    }
  };

  useEffect(() => { checkAccess(); }, []);

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
      const [result, recommendationResult] = await Promise.all([
        getAnalytics(key.trim()),
        getRecommendationAnalytics(key.trim()).catch((recommendationError) => ({
          _loadError: recommendationError?.message || 'Recommendation quality metrics are unavailable.',
        })),
      ]);
      setData(result);
      if (recommendationResult?._loadError) {
        setRecommendationData(null);
        setRecommendationWarning(recommendationResult._loadError);
      } else {
        setRecommendationData(recommendationResult);
        setRecommendationWarning('');
      }
    } catch (err) {
      setError(err?.message || 'Analytics access failed. Check your network and key.');
    } finally {
      setBusy(false);
    }
  };

  if (!access) {
    return (
      <div className="analytics-page">
        <div className="workspace-empty analytics-access-loading rounded-[28px] p-10 text-center" aria-busy="true" role="status">
          <Icon name="shield" size={28} />
          <h1 className="mt-4 text-2xl font-semibold text-white">Checking analytics access</h1>
          <p className="mt-2 text-slate-400">Verifying this network before showing protected controls.</p>
        </div>
      </div>
    );
  }

  if (access && !access.allowed) {
    return (
      <div className="analytics-restricted mx-auto max-w-3xl rounded-[28px] border border-amber-300/20 bg-amber-400/[0.08] p-8 shadow-cockpit">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-100">Restricted Analytics</div>
        <h1 className="mt-3 text-4xl font-semibold text-white">This network is not allowlisted.</h1>
        <p className="mt-4 text-slate-300">
          Analytics is visible only from approved leadership IP addresses. Current IP: {access.ip || 'unknown'}.
        </p>
        {accessError && <p className="mt-3 text-sm text-amber-100" role="alert">Access check failed: {accessError}</p>}
        <button className="btn-dark-secondary mt-5" onClick={checkAccess} type="button"><Icon name="refresh" size={15} /> Check access again</button>
      </div>
    );
  }

  return (
    <div className="analytics-page space-y-6">
      <section className="workspace-hero analytics-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit" aria-busy={busy}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Director Analytics</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Usage command view</h1>
            <p className="mt-3 max-w-3xl text-slate-400">
              IP allowlist plus analytics key protection for engagement, feedback, and briefing usage.
            </p>
          </div>
          {access && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="signal-chip selected">{access.owner || 'Current viewer'} · {access.ip}</span>
              {data && (
                <button className="btn-dark-secondary" disabled={busy} onClick={unlock} type="button">
                  <Icon name="refresh" size={15} /> {busy ? 'Refreshing…' : 'Refresh data'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {accessError && access?.allowed && (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.08] p-4 text-sm text-amber-100" role="status">
          The network access check could not reach the backend, so local development access is being used. {accessError}
        </div>
      )}

      {error && data && <div className="rounded-2xl border border-red-300/20 bg-red-950/20 p-4 text-sm text-red-200" role="alert">{error}</div>}

      {!data && (
        <form className="workspace-panel analytics-access-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5" onSubmit={unlock}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Analytics key
            </span>
            <input
              className="dark-input w-full"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Enter analytics access key"
              type="password"
              value={key}
            />
          </label>
          {error && <div className="mt-3 text-sm text-red-200" role="alert">{error}</div>}
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

          {recommendationData && (
            <section className="workspace-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">For You quality</div><h2 className="mt-2 text-xl font-semibold text-white">Useful actions, aggregated—not employee performance</h2></div>
                <span className="text-xs text-slate-500">No viewer identities are returned</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Configured desks" value={recommendationData.configured_viewers || 0} tone="emerald" />
                <StatTile label="Open rate" value={`${Math.round((recommendationData.quality?.impression_to_dossier_open || 0) * 100)}%`} />
                <StatTile label="Useful action rate" value={`${Math.round((recommendationData.quality?.impression_to_useful_action || 0) * 100)}%`} tone="emerald" />
                <StatTile label="Negative feedback" value={`${Math.round((recommendationData.quality?.negative_feedback_rate || 0) * 100)}%`} tone="amber" />
              </div>
            </section>
          )}

          {recommendationWarning && (
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.07] p-4 text-sm text-amber-100" role="status">
              Core usage analytics loaded, but For You quality metrics did not: {recommendationWarning}
            </div>
          )}

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
