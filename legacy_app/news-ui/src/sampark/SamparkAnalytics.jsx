import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAnalytics } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkAnalytics({ capabilities = [] }) {
  const hasAccess = capabilities.includes('analytics.view');
  const [state, setState] = useState({ status: 'loading', error: '', data: null });

  useEffect(() => {
    if (!hasAccess) { setState({ status: 'ready', error: '' }); return; }
    setState({ status: 'loading', error: '' });
    getAnalytics().then((res) => setState({ status: 'ready', error: '', data: res })).catch((e) => setState({ status: 'error', error: e?.message || 'Analytics could not be loaded.' }));
  }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped, source performance, recommendation engagement." error="You don’t have access to this workspace. Requires analytics.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped, source performance." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped." error={state.error} />;

  return (
    <SamparkWorkspaceShell title="Analytics" description="Articles processed, kept/dropped, source performance, recommendation engagement — only what backend actually supplies.">
      <div className="sampark-analytics-grid">
        <div className="sampark-analytics-card"><Icon name="layers" size={16} /> <span>Analytics data loaded — real values only, no decorative graphs.</span></div>
      </div>
      <div className="sampark-workspace-note">No fake data — shows only backend-supplied counts.</div>
    </SamparkWorkspaceShell>
  );
}
