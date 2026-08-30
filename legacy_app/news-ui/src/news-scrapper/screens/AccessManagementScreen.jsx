import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getAccessAudit, getAccessPrincipals, updateAccessPrincipal } from '../api.js';
import '../styles/access-management.css';
import '../styles/access-management-additions.css';

const CAPABILITY_GROUPS = [
  { label: 'Editorial review', summary: 'Choose what this person can inspect and decide in the shared news workflow.', items: [
    ['review.news.view', 'Open the review queue', 'See signals waiting for an editorial decision.'],
    ['review.news.submit', 'Send signals for review', 'Move a briefing signal into the shared review queue.'],
    ['review.news.approve', 'Approve or reject signals', 'Make final decisions on reviewed news signals.'],
    ['approved.view', 'Read the approved archive', 'Open the collection of previously approved signals.'],
  ] },
  { label: 'Samsung publishing', summary: 'Control authoring and publication inside Samsung Internal.', items: [
    ['review.contributions.view', 'Review colleague submissions', 'Read stories, leadership messages, and announcements awaiting review.'],
    ['review.contributions.publish', 'Publish and remove content', 'Publish submissions or safely archive live Samsung Internal content.'],
    ['contributions.create', 'Create internal content', 'Write or import Samsung Internal contributions.'],
  ] },
  { label: 'Content operations', summary: 'Grant day-to-day control of sources, schedules, and manual scans.', items: [
    ['sources.view', 'View the source library', 'Inspect the publishers monitored by TechScout.'],
    ['sources.manage', 'Manage the source library', 'Add, edit, enable, or pause monitored publishers.'],
    ['scheduler.view', 'View automation schedules', 'See when the shared intelligence workflow will run.'],
    ['scheduler.control', 'Control scheduled runs', 'Start, stop, or change automation schedules.'],
    ['crawl.run', 'Start a news scan', 'Launch an on-demand collection run.'],
  ] },
  { label: 'Governance and insights', summary: 'High-trust controls for feedback, analytics, model work, and team access.', items: [
    ['gatekeeper.review', 'Review shared feedback', 'Inspect explicit Not Interested feedback before it trains the bouncer.'],
    ['analytics.view', 'View leadership analytics', 'Open aggregate product and recommendation insights.'],
    ['region.correct', 'Correct content regions', 'Repair a signal that was assigned to the wrong region.'],
    ['model.train', 'Start model training', 'Run an approved training cycle using reviewed feedback.'],
    ['system.status.detail', 'View detailed system health', 'See operational diagnostics beyond the public status summary.'],
    ['access.manage', 'Manage team access', 'Grant or change runtime permissions for other people.'],
  ] },
];

const CAPABILITY_DETAILS = new Map(
  CAPABILITY_GROUPS.flatMap((group) => group.items.map(([id, title, description]) => [id, { title, description }])),
);

function readableDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Time unavailable';
}

function normalizePrincipal(item) {
  return {
    principal: String(item?.principal || ''),
    display_name: String(item?.display_name || ''),
    known_ips: Array.isArray(item?.known_ips) ? item.known_ips : [],
    capabilities: Array.isArray(item?.capabilities) ? item.capabilities : [],
  };
}

export default function AccessManagementScreen() {
  const [principals, setPrincipals] = useState([]);
  const [audit, setAudit] = useState([]);
  const [active, setActive] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const namesByPrincipal = new Map(principals.map((item) => [item.principal, item.display_name || 'Unnamed viewer']));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [principalResult, auditResult] = await Promise.all([getAccessPrincipals(), getAccessAudit(100)]);
      const items = (principalResult?.items || []).map(normalizePrincipal);
      setPrincipals(items);
      setAudit(auditResult?.items || []);
      const selected = items.find((item) => item.principal === active) || items[0] || null;
      setActive(selected?.principal || '');
      setDraft(selected);
    } catch (requestError) {
      setError(requestError?.message || 'Access records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => { load(); }, []);

  const choose = (item) => {
    setCreating(false);
    setActive(item.principal);
    setDraft({ ...item, capabilities: [...item.capabilities], known_ips: [...item.known_ips] });
    setError('');
    setNotice('');
  };

  const startNew = () => {
    setCreating(true);
    setActive('');
    setDraft({ principal: '', display_name: '', known_ips: [], capabilities: [] });
    setError('');
    setNotice('');
  };

  const toggleCapability = (capability) => {
    setDraft((current) => {
      if (!current) return current;
      const values = new Set(current.capabilities);
      if (values.has(capability)) values.delete(capability); else values.add(capability);
      return { ...current, capabilities: [...values].sort() };
    });
  };

  const save = async () => {
    if (!draft?.principal || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await updateAccessPrincipal(draft.principal, {
        display_name: draft.display_name,
        known_ips: draft.known_ips,
        capabilities: draft.capabilities,
      });
      const next = normalizePrincipal(result?.item);
      setPrincipals((items) => {
        const exists = items.some((item) => item.principal === next.principal);
        return (exists ? items.map((item) => item.principal === next.principal ? next : item) : [...items, next])
          .sort((a, b) => (a.display_name || a.principal).localeCompare(b.display_name || b.principal));
      });
      setActive(next.principal);
      setCreating(false);
      setDraft(next);
      setNotice('Access updated immediately. No backend restart is required.');
      const auditResult = await getAccessAudit(100);
      setAudit(auditResult?.items || []);
    } catch (requestError) {
      setError(requestError?.message || 'Access changes were not saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="access-management-page workflow-page space-y-6">
      <section className="workflow-console">
        <div className="workflow-console-main">
          <div>
            <div className="eyebrow">Governance / Team permissions</div>
            <h1>Access Management</h1>
            <p>Give each person only the tools their role requires. Changes take effect immediately without restarting TechScout.</p>
          </div>
          <button className="btn-dark-secondary" disabled={loading} onClick={load} type="button"><Icon name="refresh" size={15} /> Refresh</button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

      {loading ? (
        <div className="workflow-empty" role="status"><span className="fy-loader" /><h2>Loading authorized principals</h2></div>
      ) : (
        <div className="access-management-grid">
          <aside className="access-principal-list" aria-label="Authorized principals">
            <button className="access-add-principal" onClick={startNew} type="button"><span><Icon name="plus" size={16} /></span><div><strong>Add a person</strong><small>Grant only the tools their role requires</small></div></button>
            {principals.map((item) => (
              <button className={active === item.principal ? 'is-active' : ''} key={item.principal} onClick={() => choose(item)} type="button">
                <span><Icon name="user" size={16} /></span>
                <div><strong>{item.display_name || 'Unnamed viewer'}</strong><small>{item.capabilities.length} permission {item.capabilities.length === 1 ? 'area' : 'areas'} · {item.known_ips.length ? `${item.known_ips.length} trusted ${item.known_ips.length === 1 ? 'network' : 'networks'}` : 'identity verified'}</small></div>
                <Icon name="chevR" size={14} />
              </button>
            ))}
            {!principals.length && <p>No runtime grants yet. Deployment allowlists continue to apply.</p>}
          </aside>

          {draft ? (
            <section className="access-editor workspace-panel">
              <header><div><span>{creating ? 'New person' : 'Team access'}</span><h2>{draft.display_name || (creating ? 'Add a person' : 'Unnamed viewer')}</h2>{!creating && <small>Signed viewer identity verified</small>}</div><Icon name="shield" size={22} /></header>
              {creating && <label className="access-field"><span>Viewer identity token</span><input className="dark-input" value={draft.principal} onChange={(event) => setDraft((current) => ({ ...current, principal: event.target.value.trim() }))} placeholder="Paste the identity token" /><small>This is the stable private identity shown by that person’s browser. It is not their IP address.</small></label>}
              <label className="access-field"><span>Name shown in this workspace</span><input className="dark-input" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
              <label className="access-field"><span>Trusted network addresses <em>optional</em></span><input className="dark-input" value={draft.known_ips.join(', ')} onChange={(event) => setDraft((current) => ({ ...current, known_ips: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) }))} placeholder="Office or VPN addresses" /><small>Use these only to help recognize the person on an approved office or VPN network.</small></label>
              <div className="access-capability-groups">
                {CAPABILITY_GROUPS.map((group) => (
                  <fieldset key={group.label}><legend>{group.label}</legend><p>{group.summary}</p>{group.items.map(([capability, title, description]) => <label key={capability}><input checked={draft.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} type="checkbox" /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
                ))}
              </div>
              <button className="btn-dark-primary" disabled={busy || !draft.principal} onClick={save} type="button"><Icon name="check" size={15} /> {busy ? 'Saving…' : 'Save access'}</button>
            </section>
          ) : <section className="workflow-empty"><Icon name="shield" size={25} /><h2>Select a person</h2><p>Review existing access or add a new team member.</p></section>}
        </div>
      )}

      <section className="access-audit workspace-panel">
        <header><div><span>Immutable activity trail</span><h2>Recent access changes</h2></div><strong>{audit.length}</strong></header>
        {audit.length ? <ol>{audit.map((entry, index) => {
          const detail = CAPABILITY_DETAILS.get(entry.capability);
          const target = namesByPrincipal.get(entry.principal || entry.target) || 'Team member';
          return <li key={`${entry.timestamp || ''}-${index}`}><span>{readableDate(entry.timestamp)}</span><strong>{entry.new ? `Granted ${detail?.title || 'workspace access'}` : `Removed ${detail?.title || 'workspace access'}`}</strong><p>Access administrator changed permissions for {target}</p></li>;
        })}</ol> : <p>No runtime access changes have been recorded.</p>}
      </section>
    </div>
  );
}
