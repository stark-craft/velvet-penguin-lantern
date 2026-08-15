import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getStatus } from '../api.js';

export default function SchedulerScreen() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);

  const refreshStatus = useCallback(async ({ quiet = false } = {}) => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    if (!quiet && mountedRef.current) setRefreshing(true);
    try {
      const nextStatus = await getStatus();
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setErr(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      if (mountedRef.current) setErr(error?.message || 'The scheduler status endpoint did not respond.');
    } finally {
      requestInFlightRef.current = false;
      if (!quiet && mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshStatus();
    const tick = () => {
      if (document.visibilityState === 'visible') refreshStatus({ quiet: true });
    };
    const intervalId = window.setInterval(tick, 10_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshStatus]);

  const activeJobs = Number(status?.active_manual_jobs ?? status?.active_jobs?.length ?? 0);
  const capacityValue = status?.capacity_remaining;
  const capacity = capacityValue === undefined || capacityValue === null ? null : Number(capacityValue);
  const isActive = Boolean(status?.is_active);
  const loading = !status && !err;
  const systemState = err ? 'Offline' : loading ? 'Checking' : isActive ? 'Running' : 'Ready';
  const threshold = status?.bouncer_threshold ?? status?.drop_threshold ?? 'Not reported';
  const rawMessage = String(status?.message || 'Checking backend status');
  const statusMessage = /morning briefing complete/i.test(rawMessage)
    ? 'Latest scheduled briefing complete'
    : rawMessage;

  const checks = useMemo(() => [
    { label: 'FastAPI backend', value: err ? 'Offline' : status ? 'Online' : 'Checking', tone: !err && status ? 'ok' : 'warn' },
    { label: 'Scheduler mode', value: status?.mode || (loading ? 'checking' : 'unavailable'), tone: isActive ? 'warn' : status ? 'ok' : 'warn' },
    { label: 'Manual capacity', value: capacity === null ? 'Not reported' : `${capacity} slots`, tone: capacity > 0 ? 'ok' : 'warn' },
    { label: 'Bouncer threshold', value: String(threshold), tone: threshold === 'Not reported' ? 'warn' : 'ok' },
    { label: 'Polling interval', value: '10s', tone: 'ok' },
  ], [status, err, loading, isActive, capacity, threshold]);

  return (
    <div className="system-page scheduler-page space-y-6">
      <section className="workspace-hero scheduler-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit" aria-busy={loading || refreshing}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">System Status</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Autonomous intelligence engine</h1>
            <p className="mt-3 text-slate-400">{statusMessage}{lastUpdated && ` · updated ${lastUpdated}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={isActive ? 'signal-chip selected' : err ? 'signal-chip system-offline' : 'signal-chip'} aria-live="polite">{systemState}</span>
            <button className="btn-dark-secondary" disabled={refreshing} onClick={() => refreshStatus()} type="button">
              <Icon name="refresh" size={15} /> {refreshing ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      </section>

      {err && (
        <section className="flex flex-col gap-3 rounded-[22px] border border-red-300/20 bg-red-950/20 p-5 text-red-200 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div><strong>Status unavailable.</strong> {err}{status && ' The metrics below show the last successful response.'}</div>
          <button className="btn-dark-secondary shrink-0" disabled={refreshing} onClick={() => refreshStatus()} type="button">
            <Icon name="refresh" size={15} /> Retry
          </button>
        </section>
      )}

      <section className="workspace-metrics scheduler-metrics grid gap-4 md:grid-cols-4">
        <div className="signal-stat"><span>Scheduler State</span><strong>{systemState}</strong></div>
        <div className="signal-stat"><span>Active Jobs</span><strong>{activeJobs}</strong></div>
        <div className="signal-stat"><span>Capacity</span><strong>{capacity ?? 'Not reported'}</strong></div>
        <div className="signal-stat" title={threshold === 'Not reported' ? 'The backend status response did not include a bouncer threshold.' : 'Current bouncer drop threshold'}><span>Threshold</span><strong>{threshold}</strong></div>
      </section>

      <section className="workspace-panel scheduler-health rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <h2 className="text-lg font-semibold text-white">Health Checks</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {checks.map((check) => (
            <div key={check.label} className="health-check-card flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div>
                <div className="text-sm font-semibold text-slate-100">{check.label}</div>
                <div className="mt-1 text-xs text-slate-500">Live operational signal</div>
              </div>
              <span className={check.tone === 'ok' ? 'text-sm font-semibold text-emerald-300' : 'text-sm font-semibold text-amber-300'}>
                ● {check.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="workspace-panel scheduler-brief rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <h2 className="text-lg font-semibold text-white">Scheduler Brief</h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Autonomous scan cadence</div>
              <p className="mt-1 text-sm text-slate-400">Scheduler scans every 4 hours and archives each briefing snapshot.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="signal-chip">Spider</span>
              <span className="signal-chip">Bouncer</span>
              <span className="signal-chip">Fusion</span>
              <span className="signal-chip">Archive</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
