import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getWorkflow } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkApproved({ capabilities = [] }) {
  const hasAccess = capabilities.includes('approved.view') || capabilities.includes('review.news.approve');
  const [state, setState] = useState({ status: 'loading', error: '' });

  useEffect(() => {
    if (!hasAccess) { setState({ status: 'ready', error: '' }); return; }
    setState({ status: 'loading', error: '' });
    getWorkflow().then(() => setState({ status: 'ready', error: '' })).catch((e) => setState({ status: 'error', error: e?.message || 'Approved briefing could not be loaded.' }));
  }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories for briefing." error="You don’t have access to this workspace." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories for briefing." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories." error={state.error} />;
  return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories — distinct from History Archives (editorial approved vs daily snapshots)."><div className="sampark-workspace-note">Preserves original approved semantics, approval timestamp, source, and dossier access.</div></SamparkWorkspaceShell>;
}
