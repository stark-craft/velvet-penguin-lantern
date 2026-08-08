import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getStatus } from '../api.js';

export default function SchedulerScreen() {
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const s = await getStatus();
        if (!cancel) {
          setStatus(s);
          setErr(null);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (e) {
        if (!cancel) setErr(e.message || String(e));
      }
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const activeJobs = Number(status?.active_manual_jobs ?? status?.active_jobs?.length ?? 0);
  const capacity = Number(status?.capacity_remaining ?? 0);
  const isActive = Boolean(status?.is_active);
  const loading = !status && !err;
  const systemState = err ? 'Offline' : loading ? 'Checking' : isActive ? 'Running' : 'Ready';
  const threshold = status?.bouncer_threshold ?? status?.drop_threshold ?? '—';

  const checks = useMemo(() => [
    { label: 'FastAPI backend', value: err ? 'Offline' : status ? 'Online' : 'Checking', tone: status ? 'ok' : 'warn' },
    { label: 'Scheduler mode', value: status?.mode || (loading ? 'checking' : 'unavailable'), tone: isActive ? 'warn' : status ? 'ok' : 'warn' },
    { label: 'Manual capacity', value: `${capacity} slots`, tone: capacity > 0 ? 'ok' : 'warn' },
    { label: 'Bouncer threshold', value: String(threshold), tone: threshold === '—' ? 'warn' : 'ok' },
    { label: 'Polling interval', value: '10s', tone: 'ok' },
  ], [status, err, loading, isActive, capacity, threshold]);

  return (
    <div className="system-page scheduler-page space-y-6">
      <section className="workspace-hero scheduler-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">System Status</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Autonomous intelligence engine</h1>
            <p className="mt-3 text-slate-400">{status?.message || 'Checking backend status'}{lastUpdated && ` · updated ${lastUpdated}`}</p>
          </div>
          <span className={isActive ? 'signal-chip selected' : err ? 'signal-chip system-offline' : 'signal-chip'}>{systemState}</span>
        </div>
      </section>

      {err && (
        <section className="rounded-[22px] border border-red-300/20 bg-red-950/20 p-5 text-red-200">
          Status unavailable: {err}
        </section>
      )}

      <section className="workspace-metrics scheduler-metrics grid gap-4 md:grid-cols-4">
        <div className="signal-stat"><span>Scheduler State</span><strong>{systemState}</strong></div>
        <div className="signal-stat"><span>Active Jobs</span><strong>{activeJobs}</strong></div>
        <div className="signal-stat"><span>Capacity</span><strong>{capacity}</strong></div>
        <div className="signal-stat"><span>Threshold</span><strong>{threshold}</strong></div>
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
