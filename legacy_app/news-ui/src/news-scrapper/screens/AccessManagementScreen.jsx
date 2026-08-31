import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { getAccessAudit, getAccessPrincipals, updateAccessPrincipal } from '../api.js';
import '../styles/access-management.css';
import '../styles/access-management-additions.css';

const CAPABILITY_GROUPS = [
  { label: 'Editorial review', summary: 'Choose what this IP address can inspect and decide in the shared news workflow.', items: [
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
    ['access.manage', 'Manage IP access', 'Grant or change access for other IP addresses.'],
  ] },
];

const CAPABILITY_DETAILS = new Map(
  CAPABILITY_GROUPS.flatMap((group) => group.items.map(([id, title, description]) => [id, { title, description }])),
);
const ALL_CAPABILITIES = CAPABILITY_GROUPS.flatMap((group) => group.items.map(([id]) => id)).sort();
const FULL_ACCESS_ENV_EXAMPLE = 'FULL_ACCESS_ALLOWED_IPS=192.0.2.25';

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
    grant_by_ip: Boolean(item?.grant_by_ip),
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
  const [copied, setCopied] = useState(false);
  const namesByPrincipal = new Map(principals.map((item) => [
    item.principal,
    item.display_name || item.known_ips[0] || 'Unnamed access record',
  ]));

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
    setDraft({
      principal: '',
      display_name: '',
      known_ips: [],
      grant_by_ip: true,
      capabilities: [...ALL_CAPABILITIES],
    });
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

  const setNetworkIp = (value) => {
    const address = value.trim();
    setDraft((current) => ({
      ...current,
      principal: creating ? (address ? `ip:${address}` : '') : current.principal,
      known_ips: address ? [address] : [],
    }));
  };

  const toggleFullAccess = () => {
    setDraft((current) => {
      if (!current) return current;
      const full = ALL_CAPABILITIES.every((capability) => current.capabilities.includes(capability));
      return { ...current, capabilities: full ? [] : [...ALL_CAPABILITIES] };
    });
  };

  const copyEnvExample = async () => {
    try {
      await navigator.clipboard.writeText(FULL_ACCESS_ENV_EXAMPLE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
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
        grant_by_ip: draft.grant_by_ip,
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
      setNotice('Access saved. Ask the user at that IP address to refresh TechScout.');
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
            <div className="eyebrow">Governance / IP permissions</div>
            <h1>Access Management</h1>
            <p>Give an exact IP address full access—or choose only the tools it needs.</p>
          </div>
          <button className="btn-dark-secondary" disabled={loading} onClick={load} type="button"><Icon name="refresh" size={15} /> Refresh</button>
        </div>
      </section>

      <section className="access-env-recipe workspace-panel" aria-labelledby="access-env-title">
        <div className="access-env-copy">
          <span>Full access from .env</span>
          <h2 id="access-env-title">Replace one dummy IP. Save. Restart.</h2>
          <ol>
            <li><b>1</b><p>Replace <code>192.0.2.25</code> with the user's real IP.</p></li>
            <li><b>2</b><p>Add the line to <code>legacy_app/.env</code>.</p></li>
            <li><b>3</b><p>Restart the backend. That exact IP now has full access.</p></li>
          </ol>
        </div>
        <div className="access-env-code">
          <small>Copy-ready example</small>
          <code>{FULL_ACCESS_ENV_EXAMPLE}</code>
          <button className="btn-dark-secondary" onClick={copyEnvExample} type="button">
            <Icon name={copied ? 'check' : 'duplicate'} size={14} /> {copied ? 'Copied' : 'Copy line'}
          </button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

      {loading ? (
        <div className="workflow-empty" role="status"><span className="fy-loader" /><h2>Loading IP access</h2></div>
      ) : (
        <div className="access-management-grid">
          <aside className="access-principal-list" aria-label="IP access">
            <button className="access-add-principal" onClick={startNew} type="button"><span><Icon name="plus" size={16} /></span><div><strong>Add an IP address</strong><small>Full access is selected by default</small></div></button>
            {principals.map((item) => {
              const full = ALL_CAPABILITIES.every((capability) => item.capabilities.includes(capability));
              const address = item.known_ips[0] || '';
              return (
                <button className={active === item.principal ? 'is-active' : ''} key={item.principal} onClick={() => choose(item)} type="button">
                  <span><Icon name={item.grant_by_ip ? 'globe' : 'user'} size={16} /></span>
                  <div><strong>{item.display_name || address || 'Unnamed viewer'}</strong><small>{full ? 'Full access' : `${item.capabilities.length} permission ${item.capabilities.length === 1 ? 'area' : 'areas'}`} · {item.grant_by_ip ? `IP ${address}` : 'browser identity'}</small></div>
                  <Icon name="chevR" size={14} />
                </button>
              );
            })}
            {!principals.length && <p>No IP addresses added here yet. Access from <code>.env</code> still works.</p>}
          </aside>

          {draft ? (
            <section className="access-editor workspace-panel">
              <header><div><span>{creating ? 'New IP access' : 'Access record'}</span><h2>{draft.display_name || draft.known_ips[0] || (creating ? 'Add an IP address' : 'Unnamed viewer')}</h2><small>{draft.grant_by_ip ? 'Access follows this exact IP address' : 'Access follows this browser identity'}</small></div><Icon name={draft.grant_by_ip ? 'globe' : 'shield'} size={22} /></header>
              {draft.grant_by_ip && <label className="access-field"><span>IP address</span><input autoFocus={creating} className="dark-input" inputMode="decimal" value={draft.known_ips[0] || ''} onChange={(event) => setNetworkIp(event.target.value)} placeholder="Example: 192.0.2.25" /><small>Enter one exact IPv4 or IPv6 address. Do not enter a name or a network range.</small></label>}
              <label className="access-field"><span>Label <em>optional</em></span><input className="dark-input" value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} placeholder="Example: Vineet office laptop" /></label>

              <button aria-pressed={ALL_CAPABILITIES.every((capability) => draft.capabilities.includes(capability))} className={`access-full-access ${ALL_CAPABILITIES.every((capability) => draft.capabilities.includes(capability)) ? 'is-active' : ''}`} onClick={toggleFullAccess} type="button">
                <span><Icon name="shield" size={19} /></span>
                <div><strong>Full access</strong><small>Every protected TechScout tool</small></div>
                <b>{ALL_CAPABILITIES.every((capability) => draft.capabilities.includes(capability)) ? 'ON' : 'OFF'}</b>
              </button>

              <details className="access-specific-permissions">
                <summary><span>Choose specific access instead</span><small>{draft.capabilities.length} of {ALL_CAPABILITIES.length} selected</small></summary>
                <div className="access-capability-groups">
                  {CAPABILITY_GROUPS.map((group) => (
                    <fieldset key={group.label}><legend>{group.label}</legend><p>{group.summary}</p>{group.items.map(([capability, title, description]) => <label key={capability}><input checked={draft.capabilities.includes(capability)} onChange={() => toggleCapability(capability)} type="checkbox" /><span><strong>{title}</strong><small>{description}</small></span></label>)}</fieldset>
                  ))}
                </div>
              </details>
              <button className="btn-dark-primary access-save" disabled={busy || !draft.principal} onClick={save} type="button"><Icon name="check" size={15} /> {busy ? 'Saving…' : `Save access for ${draft.known_ips[0] || 'this record'}`}</button>
            </section>
          ) : <section className="workflow-empty"><Icon name="globe" size={25} /><h2>Add an IP address</h2><p>Full access is selected by default. You can narrow it before saving.</p></section>}
        </div>
      )}

      <section className="access-audit workspace-panel">
        <header><div><span>Immutable activity trail</span><h2>Recent access changes</h2></div><strong>{audit.length}</strong></header>
        {audit.length ? <ol>{audit.map((entry, index) => {
          const detail = CAPABILITY_DETAILS.get(entry.capability);
          const target = namesByPrincipal.get(entry.principal || entry.target) || 'IP address';
          return <li key={`${entry.timestamp || ''}-${index}`}><span>{readableDate(entry.timestamp)}</span><strong>{entry.new ? `Granted ${detail?.title || 'workspace access'}` : `Removed ${detail?.title || 'workspace access'}`}</strong><p>Access administrator changed permissions for {target}</p></li>;
        })}</ol> : <p>No runtime access changes have been recorded.</p>}
      </section>
    </div>
  );
}
