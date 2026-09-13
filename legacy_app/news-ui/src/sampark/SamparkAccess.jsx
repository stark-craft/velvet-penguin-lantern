import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getAccessCapabilities, getAccessPrincipals, updateAccessPrincipal } from '../news-scrapper/api.js';

const KNOWN_CAPABILITIES = ['review.news.view','review.news.submit','review.news.approve','review.contributions.view','review.contributions.publish','contributions.create','approved.view','sources.view','sources.manage','scheduler.view','scheduler.control','gatekeeper.review','analytics.view','voc.review','region.correct','model.train','crawl.run','system.status.detail','access.manage'];

function RowEditor({ record, busy, error, saved, onSave, onCancel }) {
  const [name, setName] = useState(record.display_name || '');
  const [ips, setIps] = useState((record.known_ips || []).join(', '));
  const [grantByIp, setGrantByIp] = useState(Boolean(record.grant_by_ip));
  const [caps, setCaps] = useState(record.capabilities || []);
  const toggleCap = (c) => setCaps((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Display name<input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Known IPs, exact addresses only (comma-separated)<input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="127.0.0.1" style={{ padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }} /></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input checked={grantByIp} onChange={(e) => setGrantByIp(e.target.checked)} type="checkbox" /> Grant these capabilities by network address</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KNOWN_CAPABILITIES.map((c) => (
          <label key={c} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, border: '1px solid var(--line)', borderRadius: 12, padding: '2px 8px' }}><input checked={caps.includes(c)} onChange={() => toggleCap(c)} type="checkbox" />{c}</label>
        ))}
      </div>
      {error && <div role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      {saved && <div role="status" style={{ color: '#065f46', fontSize: 12 }}>Saved.</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" disabled={busy} onClick={() => onSave(record.principal, { display_name: name, known_ips: ips.split(',').map((s) => s.trim()).filter(Boolean), grant_by_ip: grantByIp, capabilities: caps })} type="button">{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn-secondary" disabled={busy} onClick={onCancel} type="button">Cancel</button>
      </div>
    </div>
  );
}

export default function SamparkAccess({ capabilities = [], onAccessChanged }) {
  const hasAccess = capabilities.includes('access.manage');
  const [state, setState] = useState({ status: 'loading', error: '', data: [] });
  const [editing, setEditing] = useState('');
  const [rowBusy, setRowBusy] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [rowSaved, setRowSaved] = useState({});

  const load = () => {
    if (!hasAccess) { setState({ status: 'ready', error: '', data: [] }); return; }
    setState({ status: 'loading', error: '', data: [] });
    getAccessPrincipals().then((res) => setState({ status: 'ready', error: '', data: res?.items || [] })).catch((e) => setState({ status: 'error', error: e?.message || 'Access principals could not be loaded.', data: [] }));
  };
  useEffect(() => { load(); }, [hasAccess]);

  const saveRow = async (principal, record) => {
    setRowBusy((c) => ({ ...c, [principal]: true }));
    setRowErrors((c) => { const n = { ...c }; delete n[principal]; return n; });
    setRowSaved((c) => { const n = { ...c }; delete n[principal]; return n; });
    try {
      const res = await updateAccessPrincipal(principal, record);
      const updated = res?.item || { principal, ...record };
      setState((prev) => ({ ...prev, data: prev.data.map((r) => (r.principal === principal ? { ...r, ...updated } : r)) }));
      setRowSaved((c) => ({ ...c, [principal]: true }));
      setEditing('');
      // Refresh the parent auth context so edits to the current viewer apply immediately.
      try {
        await onAccessChanged?.();
      } catch {
        setRowErrors((c) => ({ ...c, [principal]: 'Saved, but the access refresh failed — reopen this workspace to confirm.' }));
      }
      try { await getAccessCapabilities(); } catch {}
    } catch (e) {
      setRowErrors((c) => ({ ...c, [principal]: e?.message || 'Update failed.' }));
    } finally {
      setRowBusy((c) => { const n = { ...c }; delete n[principal]; return n; });
    }
  };

  if (!hasAccess) return <SamparkWorkspaceShell title="Access Management" description="Principals, known IPs, granted capabilities — privileged." error="You don’t have access to this workspace. Requires access.manage." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Access Management" description="Principals, known IPs, granted capabilities." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Access Management" description="Principals and capability grants." error={state.error} onRetry={load} />;

  return (
    <SamparkWorkspaceShell title="Access Management" description="Authorized viewers and network grants. Temporary role sessions are short-lived and never listed here; no secret keys are shown.">
      <div className="sampark-access-list">
        <small>{(state.data || []).length} authorized viewers — viewer identity, network access, and temporary sessions are listed separately. No secret keys are shown.</small>
      </div>
      {(state.data || []).map((r) => (
        <article key={r.principal} className="sampark-approved-card" style={{ marginTop: 8 }}>
          <strong>{r.display_name || 'Unnamed viewer'}</strong>
          <small>Viewer: {String(r.principal).slice(0, 12)}… · Network access: {(r.known_ips || []).length ? `${r.known_ips.join(', ')}${r.grant_by_ip ? ' (grants access)' : ' (descriptive only)'}` : 'none'} · Capabilities: {(r.capabilities || []).length ? r.capabilities.join(', ') : 'none'}</small>
          {rowErrors[r.principal] && <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{rowErrors[r.principal]}</div>}
          {editing === r.principal
            ? <RowEditor record={r} busy={Boolean(rowBusy[r.principal])} error={null} saved={rowSaved[r.principal]} onSave={saveRow} onCancel={() => setEditing('')} />
            : <div style={{ marginTop: 6 }}><button className="btn-secondary" onClick={() => setEditing(r.principal)} type="button">Edit</button></div>}
        </article>
      ))}
      <div className="sampark-workspace-note">Edits save per viewer — one failed row never changes another. Saving refreshes the current viewer’s access right away; if that refresh fails you’ll see a warning here.</div>
    </SamparkWorkspaceShell>
  );
}
