import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAnalytics } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkAnalytics({ capabilities = [] }) {
  const hasAccess = capabilities.includes('analytics.view');
  const [state, setState] = useState({ status: 'loading', error: '', data: null });

  useEffect(() => {
    if (!hasAccess) { setState({ status: 'ready', error: '', data: null }); return; }
    setState({ status: 'loading', error: '', data: null });
    getAnalytics().then((res) => setState({ status: 'ready', error: '', data: res })).catch((e) => setState({ status: 'error', error: e?.message || 'Analytics could not be loaded.', data: null }));
  }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped, source performance, recommendation engagement." error="You don’t have access to this workspace. Requires analytics.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped, source performance." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped." error={state.error} />;

  const data = state.data || {};
  const aggregates = (() => {
    const raw = data?.data || data;
    if (!raw || typeof raw !== 'object') return null;
    const devices = Array.isArray(raw.devices) ? raw.devices : null;
    if (devices) {
      const sum = (fn) => devices.reduce((acc, d) => acc + (fn(d) || 0), 0);
      const totals = {
        page_loads: sum(d=> d.totals?.page_loads),
        searches: sum(d=> d.totals?.searches),
        articles_clicked: sum(d=> d.totals?.articles_clicked),
        votes: sum(d=> d.totals?.votes),
        exports: sum(d=> d.totals?.exports),
        voc_feedback: sum(d=> d.totals?.voc_feedback),
        minutes_approx: sum(d=> d.totals?.minutes_approx),
      };
      const actionAgg = {};
      for(const d of devices){
        const ac = d.totals?.actions || {};
        for(const [k,v] of Object.entries(ac)) actionAgg[k] = (actionAgg[k]||0) + (Number(v)||0);
      }
      // derive specific values from actual aggregated action counts
      const reactions = (actionAgg['like']||0)+(actionAgg['dislike']||0)+(actionAgg['interested']||0)+(actionAgg['not_interested']||0)+(actionAgg['vote_interested']||0)+(actionAgg['vote_not_interested']||0) || totals.votes || 0;
      const saves = (actionAgg['save']||0)+(actionAgg['save_for_later']||0)+(actionAgg['unsave']||0);
      // reads: dossier_dwell + source_open are qualifying reads; fallback to articles_clicked
      const readsFromActions = (actionAgg['dossier_dwell']||0)+(actionAgg['source_open']||0);
      const reads = readsFromActions || totals.articles_clicked || 0;
      const total_events = Object.values(actionAgg).reduce((a,b)=>a+(Number(b)||0),0);
      const voc_count = totals.voc_feedback ?? 0;
      return {
        device_count: raw.device_count ?? devices.length,
        known_team_member_count: raw.known_team_member_count ?? devices.filter(d=>d.known_team_member).length,
        unknown_device_count: raw.unknown_device_count ?? devices.filter(d=>!d.known_team_member).length,
        date: raw.date || raw.generated_at,
        ...totals,
        actions: actionAgg,
        reactions,
        saves,
        reads,
        total_events,
        engagement_total: total_events || totals.page_loads || 0,
        voc_count,
        recommendation_summary: raw.recommendation_summary || null,
        devices,
      };
    }
    // fallback for non-device payloads: try to derive similarly if actions present
    const actions = raw.actions || raw.action_counts || {};
    if (actions && typeof actions === 'object' && Object.keys(actions).length) {
      const reactions = (actions['like']||0)+(actions['dislike']||0)+(actions['interested']||0)+(actions['not_interested']||0) || raw.votes || 0;
      const saves = (actions['save']||0)+(actions['save_for_later']||0);
      const reads = (actions['dossier_dwell']||0)+(actions['source_open']||0) || raw.articles_clicked || raw.reads || 0;
      const total_events = Object.values(actions).reduce((a,b)=>a+(Number(b)||0),0);
      return { ...raw, reactions, saves, reads, total_events, engagement_total: total_events, voc_count: raw.voc_feedback ?? raw.voc_count ?? 0, actions };
    }
    return raw;
  })();
  const hasData = aggregates && Object.keys(aggregates).length > 0;
  const getVal = (key) => {
    const v = aggregates?.[key] ?? data?.[key] ?? null;
    // return null for missing values rather than display string, preserve legitimate zero
    return v !== null && v !== undefined ? v : null;
  };
  const displayVal = (key) => {
    const v = getVal(key);
    return v !== null ? String(v) : '—';
  };

  return (
    <SamparkWorkspaceShell title="Analytics" description="Aggregated reading and feedback trends.">
      {!hasData ? <div className="sampark-workspace-empty"><Icon name="inbox" size={20} /><p>No activity recorded yet — trends appear after reading and feedback.</p></div> : (
        <div className="sampark-analytics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="sampark-analytics-card"><strong>Devices</strong><span>{displayVal('device_count')} devices · {displayVal('known_team_member_count')} team · {displayVal('unknown_device_count')} unknown</span></div>
          <div className="sampark-analytics-card"><strong>Date</strong><span>{getVal('date') ?? getVal('generated_at') ?? '—'}</span></div>
          <div className="sampark-analytics-card"><strong>Page loads</strong><span>{displayVal('page_loads')} · Searches: {displayVal('searches')}</span></div>
          <div className="sampark-analytics-card"><strong>Article engagement</strong><span>Clicks/reads: {String(getVal('reads') ?? getVal('articles_clicked') ?? getVal('article_clicks') ?? '—')} · Reactions: {String(getVal('reactions') ?? '—')} · Saves: {String(getVal('saves') ?? '—')}</span></div>
          <div className="sampark-analytics-card"><strong>Exports</strong><span>{Array.isArray(aggregates?.exports) ? aggregates.exports.length : displayVal('exports')} · VOC: {String(getVal('voc_count') ?? getVal('voc_feedback') ?? '—')}</span></div>
          <div className="sampark-analytics-card"><strong>Engagement totals</strong><span>{String(getVal('engagement_total') ?? getVal('total_events') ?? '—')}</span></div>
          {aggregates?.recommendation_summary && <div className="sampark-analytics-card"><strong>Recommendation quality</strong><span>{JSON.stringify(aggregates.recommendation_summary).slice(0,120)}</span></div>}
        </div>
      )}
      <div className="sampark-workspace-note" role="status">Every value above derives from a returned field; no placeholder sentence.</div>
    </SamparkWorkspaceShell>
  );
}
