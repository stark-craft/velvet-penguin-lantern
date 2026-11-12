import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

export function WorkspaceHeader({ title, description, actions }) {
  return (
    <header className="sampark-workspace-header">
      <div>
        <h1 className="sampark-workspace-title">{title}</h1>
        {description && <p className="sampark-workspace-desc">{description}</p>}
      </div>
      {actions && <div className="sampark-workspace-actions">{actions}</div>}
    </header>
  );
}

export function WorkspaceEmpty({ icon = 'layers', title, description, action }) {
  return (
    <div className="sampark-workspace-empty">
      <span className="sampark-workspace-empty-icon"><Icon name={icon} size={28} /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function WorkspaceLoading({ title = 'Loading workspace…' }) {
  return (
    <div className="sampark-workspace-loading" role="status">
      <span className="sampark-spinner" />
      <p>{title}</p>
    </div>
  );
}

export function WorkspaceError({ message, onRetry }) {
  return (
    <div className="sampark-workspace-error" role="alert">
      <Icon name="warning" size={18} />
      <span>{message || 'This workspace could not be loaded.'}</span>
      {onRetry && <button className="btn-secondary" onClick={onRetry} type="button">Retry</button>}
    </div>
  );
}

export default function SamparkWorkspaceShell({ title, description, actions, loading, error, onRetry, empty, children }) {
  if (loading) return <div className="sampark-workspace"><WorkspaceHeader title={title} description={description} actions={actions} /><WorkspaceLoading title={loading === true ? 'Loading workspace…' : loading} /></div>;
  if (error) return <div className="sampark-workspace"><WorkspaceHeader title={title} description={description} actions={actions} /><WorkspaceError message={error} onRetry={onRetry} /></div>;
  if (empty) return <div className="sampark-workspace"><WorkspaceHeader title={title} description={description} actions={actions} /><WorkspaceEmpty {...empty} /></div>;
  return (
    <div className="sampark-workspace">
      <WorkspaceHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}
