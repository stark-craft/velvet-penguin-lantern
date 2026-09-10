import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getSchedulerStatus, runSchedulerNow } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkScheduler({ capabilities = [] }) {
  const canView = capabilities.includes('scheduler.view') || capabilities.includes('scheduler.control');
  const canControl = capabilities.includes('scheduler.control');
  const [state, setState] = useState({ status: 'loading', error: '', data: null });
  const [running, setRunning] = useState(false);

  const load = async () => {
    setState({ status: 'loading', error: '' });
    try {
      const res = await getSchedulerStatus();
      setState({ status: 'ready', error: '', data: res });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Scheduler status could not be loaded.' });
    }
  };

  useEffect(() => { if (canView) load(); else setState({ status: 'ready', error: '' }); }, [canView]);

  const runNow = async () => {
    if (!canControl) return;
    setRunning(true);
    try {
      await runSchedulerNow();
      await load();
    } catch (e) {
      setState((cur) => ({ ...cur, error: e?.message || 'Run failed.' }));
    } finally {
      setRunning(false);
    }
  };

  if (!canView) return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run, job control." error="You don’t have access to this workspace. Requires scheduler.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run." error={state.error} onRetry={load} />;

  return (
    <SamparkWorkspaceShell title="Scheduler" description="Current status, last run, next run, running job." actions={canControl && <button className="btn-primary" disabled={running} onClick={runNow} type="button"><Icon name="play" size={14} /> {running ? 'Running…' : 'Run Now'}</button>}>
      <div className="sampark-scheduler-summary">
        <small>Status: {state.data?.status || 'unknown'} · Last run: {state.data?.last_run || '—'} · Next run: {state.data?.next_run || '—'}</small>
      </div>
      <div className="sampark-workspace-note">Shows coarse backend status only — no frontend timers pretending to know backend progress.</div>
    </SamparkWorkspaceShell>
  );
}
