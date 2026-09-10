import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAccessPrincipals } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkAccess({ capabilities = [] }) {
  const hasAccess = capabilities.includes('access.manage');
  const [state, setState] = useState({ status: 'loading', error: '', data: [] });

  useEffect(() => {
    if (!hasAccess) { setState({ status: 'ready', error: '' }); return; }
    setState({ status: 'loading', error: '' });
    getAccessPrincipals().then((res) => setState({ status: 'ready', error: '', data: res?.items || [] })).catch((e) => setState({ status: 'error', error: e?.message || 'Access principals could not be loaded.' }));
  }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Access Management" description="Principals, known IPs, granted capabilities — privileged." error="You don’t have access to this workspace. Requires access.manage." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Access Management" description="Principals, known IPs, granted capabilities." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Access Management" description="Principals and capability grants." error={state.error} />;

  return (
    <SamparkWorkspaceShell title="Access Management" description="Principals, known IPs, granted capabilities — privileged. Standalone/development-era access system.">
      <div className="sampark-access-list">
        <small>{state.data.length} principals — capability grants remain server-side, no secrets exposed.</small>
      </div>
      <div className="sampark-workspace-note">Clearly distinguishes user/profile identity, network/IP principal, capability grants. Mutations require access.manage and confirmation.</div>
    </SamparkWorkspaceShell>
  );
}
