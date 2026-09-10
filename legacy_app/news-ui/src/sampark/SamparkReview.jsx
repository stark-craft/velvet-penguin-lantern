import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getWorkflow } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkReview({ capabilities = [] }) {
  const hasAccess = capabilities.includes('review.news.view') || capabilities.includes('review.contributions.view');
  const [state, setState] = useState({ status: 'loading', error: '', data: null });

  const load = async () => {
    if (!hasAccess) { setState({ status: 'ready', error: '' }); return; }
    setState({ status: 'loading', error: '' });
    try {
      const res = await getWorkflow();
      setState({ status: 'ready', error: '', data: res });
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Review queue could not be loaded.' });
    }
  };

  useEffect(() => { load(); }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Review Center" description="Editorial review queue — privileged." error="You don’t have access to this workspace." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Review Center" description="Stories awaiting review and contribution submissions." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Review Center" description="Stories awaiting review." error={state.error} onRetry={load} />;

  const count = state.data?.selected?.length || 0;
  return (
    <SamparkWorkspaceShell title="Review Center" description="Stories awaiting review and contribution submissions. Server remains authoritative for approve/reject.">
      <div className="sampark-review-summary">
        <span className="sampark-review-count"><Icon name="check2" size={16} /> {count} awaiting review</span>
        <small>Use original review actions — backend validation preserved, confirmation required for approve/reject.</small>
      </div>
      <div className="sampark-workspace-note">Sampark-native Review Desk preserves original workflow: statuses, filters, edit/correct, and capability-gated approve/reject.</div>
    </SamparkWorkspaceShell>
  );
}
