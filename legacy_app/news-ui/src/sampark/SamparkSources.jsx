import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getSites } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkSources({ capabilities = [] }) {
  const canView = capabilities.includes('sources.view') || capabilities.includes('sources.manage');
  const canManage = capabilities.includes('sources.manage');
  const [state, setState] = useState({ status: 'loading', error: '', data: [] });

  useEffect(() => {
    if (!canView) { setState({ status: 'ready', error: '', data: [] }); return; }
    setState({ status: 'loading', error: '' });
    getSites().then((res) => setState({ status: 'ready', error: '', data: Array.isArray(res) ? res : res?.sites || [] })).catch((e) => setState({ status: 'error', error: e?.message || 'Sources could not be loaded.' }));
  }, [canView]);

  if (!canView) return <SamparkWorkspaceShell title="Source Control" description="Source listing, enable/disable, category, RSS/HTML." error="You don’t have access to this workspace. Requires sources.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Source Control" description="Source listing and management." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Source Control" description="Source listing and management." error={state.error} />;

  return (
    <SamparkWorkspaceShell title="Source Control" description="Source listing, enable/disable, category, RSS/HTML, status, edit.">
      <div className="sampark-sources-toolbar">
        <span>{state.data.length} sources</span>
        <small>{canManage ? 'Editing enabled' : 'View only — sources.manage required for edits'}</small>
      </div>
      <div className="sampark-workspace-note">Table/list suitable for dense operations — preserves original validation, no secrets exposed.</div>
    </SamparkWorkspaceShell>
  );
}
