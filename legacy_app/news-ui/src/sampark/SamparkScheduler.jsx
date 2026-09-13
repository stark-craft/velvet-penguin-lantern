import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getSchedulerStatus, runSchedulerNow } from '../news-scrapper/api.js';
import { describeSchedulerStatus, isConflictStatus, isRunDisabled } from './schedulerHelper.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

function formatTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  } catch { return String(value); }
}

export default function SamparkScheduler({ capabilities = [] }) {
  const canView = capabilities.includes('scheduler.view') || capabilities.includes('scheduler.control');
  const canControl = capabilities.includes('scheduler.control');
  const [state, setState] = useState({ status: 'loading', error: '', data: null });
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const mountedRef = useRef(true);
  const pollRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; if (pollRef.current) window.clearInterval(pollRef.current); pollRef.current = null; };
  }, []);

  const load = useCallback(async ({ background = false } = {}) => {
    if (!background) setState({ status: 'loading', error: '', data: null });
    try {
      const res = await getSchedulerStatus();
      if (!mountedRef.current) return res;
      setState({ status: 'ready', error: '', data: res });
      return res;
    } catch (e) {
      if (!mountedRef.current) return null;
      if (!background) setState({ status: 'error', error: e?.message || 'Scheduler status could not be loaded.' });
      else setState((cur) => ({ ...cur, error: e?.message || cur.error }));
      return null;
    }
  }, []);

  useEffect(() => { if (canView) load(); else setState({ status: 'ready', error: '', data: null }); }, [canView, load]);

  const data = state.data || {};
  const view = describeSchedulerStatus(data);
  const isActive = view.isActive;
  const manualActive = view.manualActive;
  const capacityOut = view.capacityOut;

  // Poll while a run is active; stop when idle. Never replace page with loading shell.
  useEffect(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (state.status === 'ready' && (isActive || manualActive)) {
      pollRef.current = window.setInterval(() => { load({ background: true }); }, 5000);
    }
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  }, [state.status, isActive, manualActive, load]);

  const runNow = async () => {
    if (!canControl || running) return;
    setRunning(true);
    setNotice('');
    try {
      await runSchedulerNow();
      setNotice('A scheduler run was queued.');
      await load({ background: true });
    } catch (e) {
      const status = e?.status;
      if (isConflictStatus(status)) {
        setNotice('A scheduler run is already active. Refreshing status.');
        await load({ background: true });
      } else {
        setState((cur) => ({ ...cur, error: e?.message || 'Run failed.' }));
      }
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  if (!canView) return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run, job control." error="You don’t have access to this workspace. Requires scheduler.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run." loading />;
  if (state.status === 'error' && !state.data) return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run." error={state.error} onRetry={() => load()} />;

  const statusLabel = view.label;
  const lastStarted = view.lastStarted;
  const lastCompleted = view.lastCompleted;
  const nextRun = view.nextRun;
  const lastError = view.lastError;
  const failedProfiles = view.failedProfiles;
  const pipeline = data.pipeline || {};
  const degraded = view.degraded;
  const runDisabled = isRunDisabled(data, running);
  const runTitle = isActive ? 'An autonomous run is active' : manualActive ? 'A manual run is active' : capacityOut ? 'No capacity available right now' : running ? 'Run request pending' : 'Start a scheduler run now';

  return (
    <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run, running job." actions={canControl && <button className="btn-primary" disabled={runDisabled} title={runTitle} onClick={runNow} type="button"><Icon name="play" size={14} /> {running ? 'Running…' : 'Run Now'}</button>}>
      {state.error && <div className="sampark-workspace-note is-warning" role="status">{state.error}</div>}
      {notice && <div className="sampark-workspace-note" role="status">{notice}</div>}
      {(isActive || manualActive) && <div className="sampark-workspace-note" role="status"><Icon name="refresh" size={14} /> A run is in progress — status refreshes automatically.</div>}
      <dl className="sampark-scheduler-summary">
        <div><dt>Status</dt><dd>{statusLabel}</dd></div>
        {data.message && <div><dt>Details</dt><dd>{data.message}</dd></div>}
        <div><dt>Last started</dt><dd>{formatTime(lastStarted)}</dd></div>
        <div><dt>Last completed</dt><dd>{formatTime(lastCompleted)}</dd></div>
        <div><dt>Next run</dt><dd>{formatTime(nextRun)}</dd></div>
        <div><dt>Pipeline</dt><dd>{pipeline.mode || '—'}</dd></div>
        {Number.isFinite(Number(data.active_manual_jobs)) && <div><dt>Manual jobs</dt><dd>{String(data.active_manual_jobs)}</dd></div>}
        {data.capacity_remaining !== undefined && <div><dt>Capacity</dt><dd>{String(data.capacity_remaining)}</dd></div>}
        {lastError && <div><dt>Last error</dt><dd>{String(lastError)}</dd></div>}
        {failedProfiles.length > 0 && <div><dt>Failed profiles</dt><dd>{failedProfiles.join(', ')}</dd></div>}
      </dl>
      {degraded && <div className="sampark-workspace-note is-warning" role="status">Some assisted research services are unavailable, so the scheduler is using trusted local models for this run. Your briefing will still complete.</div>}
    </SamparkWorkspaceShell>
  );
}
