import React from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkGatekeeper({ capabilities = [] }) {
  const hasAccess = capabilities.includes('gatekeeper.review');
  if (!hasAccess) return <SamparkWorkspaceShell title="Gatekeeper Review" description="Distinct privileged workspace for borderline content, model and region correction." error="You don’t have access to this workspace. Requires gatekeeper.review." />;
  return (
    <SamparkWorkspaceShell title="Gatekeeper Review" description="Review rejected/borderline content, model correction and region correction. Global training — stronger confirmation required.">
      <div className="sampark-workspace-note"><Icon name="shield" size={14} /> Gatekeeper actions affect global model training — original safeguards preserved, confirmation required.</div>
    </SamparkWorkspaceShell>
  );
}
