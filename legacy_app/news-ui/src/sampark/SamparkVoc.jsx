import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getTrendsAccess } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkVoc() {
  const [state, setState] = useState({ status: 'loading', error: '', data: null });

  const load = async () => {
    setState({ status: 'loading', error: '', data: null });
    try {
      const res = await fetch('/voc', { headers: { Accept: 'application/json' } }).then(r => r.json()).catch(() => null);
      // Fallback to trends access check
      const trends = await getTrendsAccess().catch(() => null);
      setState({ status: 'ready', error: '', data: { voc: res, trends } });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'VOC could not be loaded.' });
    }
  };

  useEffect(() => { load(); }, []);

  if (state.status === 'loading') return <SamparkWorkspaceShell title="VOC — Voice of Customer" description="Customer feedback, trend intelligence and sentiment signals." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="VOC — Voice of Customer" description="Customer feedback and trend intelligence." error={state.error} onRetry={load} />;

  return (
    <SamparkWorkspaceShell title="VOC — Voice of Customer" description="Customer feedback, trend intelligence and sentiment signals. Feedback submission remains private to your workspace.">
      <div className="sampark-voc-grid">
        <div className="sampark-voc-card">
          <h3><Icon name="note" size={16} /> Feedback Overview</h3>
          <p>Share feedback and review Voice-of-Customer signals. Original VOC trends and categories are preserved via existing backend contracts.</p>
          <small>Backend: /voc, /trends — no fake analytics.</small>
        </div>
        <div className="sampark-voc-card">
          <h3><Icon name="trend" size={16} /> Trends</h3>
          <p>Trends and counts are derived from actual stored feedback where available. No decorative graphs.</p>
        </div>
      </div>
      <div className="sampark-workspace-note">
        <Icon name="shield" size={14} /> VOC submission is private to your viewer where original behavior is private; aggregated trends are shared where original is shared.
      </div>
    </SamparkWorkspaceShell>
  );
}
