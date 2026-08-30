import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import {
  getGatekeeperDropped,
  getGatekeeperQueue,
  queueGatekeeperRestore,
  retryGatekeeperRestore,
} from '../api.js';
import '../styles/gatekeeper-review.css';

const STATUS_FILTERS = ['all', 'dropped', 'queued', 'processing', 'restored', 'failed'];

function formatTime(value) {
  if (!value) return 'Time unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function Status({ value = 'dropped' }) {
  return <span className={`gk-status is-${value}`}>{value}</span>;
}

function QueueSummary({ data }) {
  const counts = data?.counts || {};
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return (
    <aside className="gk-queue">
      <header>
        <div><span>Restore worker</span><h2>Recovery queue</h2></div>
        <b className={data?.worker?.running ? 'is-running' : ''}>{data?.worker?.running ? 'Working' : 'Idle'}</b>
      </header>
      <div className="gk-queue-metrics">
        {['queued', 'processing', 'completed', 'failed'].map((key) => <div key={key}><strong>{counts[key] || 0}</strong><small>{key}</small></div>)}
      </div>
      <ol>
        {jobs.slice(0, 7).map((job) => (
          <li key={job.id}>
            <Status value={job.status === 'completed' ? 'restored' : job.status} />
            <strong>{job.title || 'Untitled recovery'}</strong>
            <small>{formatTime(job.updated_at || job.created_at)}</small>
          </li>
        ))}
        {!jobs.length && <li className="is-empty">No recovery jobs yet.</li>}
      </ol>
    </aside>
  );
}

function SignalCard({ item, busy, onRestore, onRetry }) {
  const state = item?.status || 'dropped';
  const canRestore = state === 'dropped' && item?.restore_eligible && !item?.legacy;
  const canRetry = state === 'failed' && item?.restore_eligible && !item?.legacy;
  return (
    <article className="gk-card">
      <header>
        <div><Status value={state} />{item?.source && <span>{item.source}</span>}</div>
        <time>{formatTime(item?.updated_at || item?.timestamp)}</time>
      </header>
      <h2>{item?.title || 'Untitled rejected signal'}</h2>
      <p>{item?.summary || 'No discovery summary was preserved for this signal.'}</p>
      <dl>
        <div><dt>Gatekeeper reason</dt><dd>{item?.bouncer_reason || 'No reason recorded'}</dd></div>
        <div><dt>Pipeline stage</dt><dd>{item?.bouncer_stage || item?.pipeline_stage || 'Unknown'}</dd></div>
      </dl>
      {item?.restore_error && <div className="gk-card-error" role="alert">{item.restore_error}</div>}
      <footer>
        {item?.link && <a className="btn-dark-secondary" href={item.link} rel="noreferrer" target="_blank">Open source</a>}
        {canRestore && <button className="btn-dark-primary" disabled={busy} onClick={() => onRestore(item)} type="button">{busy ? 'Queuing…' : 'Restore to Briefing'}</button>}
        {canRetry && <button className="btn-dark-primary" disabled={busy} onClick={() => onRetry(item)} type="button">{busy ? 'Queuing…' : 'Retry recovery'}</button>}
        {!canRestore && !canRetry && <span className="gk-card-note">{item?.legacy ? 'Audit-only legacy record' : state === 'restored' ? 'Already restored' : state === 'failed' ? 'Recovery unavailable' : 'Recovery in progress'}</span>}
      </footer>
    </article>
  );
}

export default function GatekeeperCapabilityScreen() {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [dropped, setDropped] = useState(null);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [records, jobs] = await Promise.all([
        getGatekeeperDropped({ profile: 'all', status, search: query, limit: 200 }),
        getGatekeeperQueue({ profile: 'all' }),
      ]);
      setDropped(records);
      setQueue(jobs);
    } catch (requestError) {
      setError(requestError?.message || 'Gatekeeper decisions could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, status]);

  useEffect(() => { load(); }, [load]);

  const queueActive = Boolean(queue?.worker?.running || Number(queue?.counts?.queued || 0) || Number(queue?.counts?.processing || 0));
  useEffect(() => {
    if (!queueActive) return undefined;
    const timer = window.setInterval(() => load({ quiet: true }), 4000);
    return () => window.clearInterval(timer);
  }, [load, queueActive]);

  const act = async (item, retry = false) => {
    setBusyId(item.id);
    setError('');
    try {
      if (retry) await retryGatekeeperRestore(item.id); else await queueGatekeeperRestore(item.id);
      await load({ quiet: true });
    } catch (requestError) {
      setError(requestError?.message || 'The recovery request failed.');
    } finally {
      setBusyId('');
    }
  };

  const counts = dropped?.counts || {};
  const items = useMemo(() => Array.isArray(dropped?.items) ? dropped.items : [], [dropped]);

  return (
    <div className="gk-page">
      <section className="gk-hero">
        <div><span>Model governance</span><h1>Gatekeeper Review</h1><p>Inspect rejected intelligence and recover false negatives without exposing operational keys in the browser.</p></div>
        <button className="btn-dark-secondary" disabled={loading} onClick={() => load()} type="button"><Icon name="refresh" size={15} /> Refresh</button>
      </section>
      <section className="gk-metrics" aria-label="Gatekeeper summary">
        {['all', 'eligible', 'restored', 'failed'].map((key) => <div key={key}><strong>{counts[key] || 0}</strong><span>{key === 'all' ? 'review records' : key}</span></div>)}
      </section>
      <section className="gk-controls">
        <div role="tablist" aria-label="Gatekeeper status">
          {STATUS_FILTERS.map((value) => <button aria-selected={status === value} className={status === value ? 'is-active' : ''} key={value} onClick={() => setStatus(value)} role="tab" type="button">{value}</button>)}
        </div>
        <label><Icon name="search" size={15} /><input aria-label="Search rejected signals" onChange={(event) => setSearch(event.target.value)} placeholder="Search title, source, or reason" value={search} /></label>
      </section>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="gk-layout">
        <section className="gk-results" aria-live="polite">
          {loading && !dropped ? <div className="workflow-empty"><span className="fy-loader" /><h2>Loading Gatekeeper decisions</h2></div> : items.map((item) => <SignalCard busy={busyId === item.id} item={item} key={item.id} onRestore={(value) => act(value)} onRetry={(value) => act(value, true)} />)}
          {!loading && !items.length && <div className="workflow-empty"><Icon name="shield" size={24} /><h2>No matching rejected signals</h2><p>Adjust the status or search filter.</p></div>}
        </section>
        <QueueSummary data={queue} />
      </div>
    </div>
  );
}
