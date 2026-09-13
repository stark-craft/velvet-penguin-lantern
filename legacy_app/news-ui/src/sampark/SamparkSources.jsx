import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getSites, updateSite } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';
import { sanitizeExternalUrl } from './shared/safeLink.js';

const PAGE_SIZE = 50;

function sourceKey(s, fallback) {
  if (s.id) return `id:${s.id}`;
  const url = s.rss_url || s.url || '';
  if (url) return `url:${String(url).trim().toLowerCase()}`;
  const name = String(s.name || '').trim().toLowerCase();
  const domain = String(s.domain || '').trim().toLowerCase();
  const kind = String(s.type || s.discovery_mode || s.mode || '').trim().toLowerCase();
  if (name || domain) return `composite:${name}|${domain}|${kind}`;
  return `row:${fallback}`;
}

export default function SamparkSources({ capabilities = [] }) {
  const canView = capabilities.includes('sources.view') || capabilities.includes('sources.manage');
  const canManage = capabilities.includes('sources.manage');
  const [state, setState] = useState({ status: 'loading', error: '', data: [] });
  const [filter, setFilter] = useState('');
  const [toggling, setToggling] = useState('');
  const [actionError, setActionError] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!canView) { setState({ status: 'ready', error: '', data: [] }); return; }
    setState({ status: 'loading', error: '' });
    getSites().then((res) => setState({ status: 'ready', error: '', data: Array.isArray(res) ? res : res?.sites || [] })).catch((e) => setState({ status: 'error', error: e?.message || 'Sources could not be loaded.' }));
  }, [canView]);

  const filtered = useMemo(()=>{
    if(!canView || state.status !== 'ready') return [];
    const q = filter.trim().toLowerCase();
    if(!q) return state.data;
    return state.data.filter(s=> String(s.name||'').toLowerCase().includes(q) || String(s.domain||'').toLowerCase().includes(q) || String(s.category||'').toLowerCase().includes(q));
  }, [canView, state, filter]);

  const safeUrl = (candidate)=> sanitizeExternalUrl(candidate);
  const displayDomain = (s)=>{
    const cand = s.rss_url || s.url || '';
    const href = safeUrl(cand);
    if(href) try{ return new URL(href).hostname; }catch{ return s.domain || '—'; }
    return s.domain || '—';
  };
  const handleToggle = async (s)=>{
    const ident = String(s.id || s.rss_url || s.url || s.domain || '').trim();
    if(!ident) return;
    const nextEnabled = s.enabled === false ? true : false;
    setToggling(ident);
    setActionError('');
    try{
      const res = await updateSite(ident, { enabled: nextEnabled });
      const updated = res?.source || res;
      setState(prev=> ({...prev, data: prev.data.map(x=> {
        const curIdent = String(x.id||x.rss_url||x.url||x.domain);
        if(curIdent === ident) return { ...x, enabled: updated?.enabled ?? nextEnabled };
        return x;
      })}));
    }catch(e){ setActionError(e?.message || 'Update failed — requires sources.manage'); }
    finally{ setToggling(''); }
  };

  if (!canView) return <SamparkWorkspaceShell title="Source Control" description="Source listing, enable/disable, category, RSS/HTML." error="You don’t have access to this workspace. Requires sources.view." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Source Control" description="Source listing and management." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Source Control" description="Source listing and management." error={state.error} />;

  return (
    <SamparkWorkspaceShell title="Source Control" description="Unified source catalog — name, domain, category, enabled, discovery, verticals, family, RSS/website, safe URL.">
      <div className="sampark-sources-toolbar" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span>Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} matching sources ({state.data.length} total)</span>
        <input placeholder="Filter by name, domain, category" aria-label="Filter sources" value={filter} onChange={e=> { setFilter(e.target.value); setVisibleCount(PAGE_SIZE); }} style={{ flex: 1, minWidth: 180, padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
        <small>{canManage ? 'Editing enabled' : 'View only — contact an admin for edits'}</small>
      </div>
      {actionError && <div role="alert" style={{ color:'#b91c1c', fontSize:13, marginBottom:8 }}>{actionError}</div>}
      {filtered.length===0 ? <div className="sampark-workspace-empty"><Icon name="search" size={20} /><p>No sources match filter.</p></div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}><th>Name</th><th>Domain</th><th>Category</th><th>Enabled</th><th>Discovery</th><th>Verticals</th><th>Family</th><th>Type</th><th>URL</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.slice(0,visibleCount).map((s,i)=> {
                const rss = s.rss_url || '';
                const siteUrl = s.url || '';
                const href = safeUrl(rss || siteUrl);
                const ident = String(s.id || rss || siteUrl || s.domain || '');
                const enabled = s.enabled !== false;
                return (
                <tr key={sourceKey(s, i)} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td>{s.name || '—'}</td>
                  <td>{displayDomain(s)}</td>
                  <td>{s.category || '—'}</td>
                  <td>{enabled ? 'enabled' : 'disabled'}</td>
                  <td>{s.discovery_mode || s.mode || '—'}</td>
                  <td>{Array.isArray(s.verticals) ? s.verticals.join(', ') : s.vertical || '—'}</td>
                  <td>{s.source_family || s.family || '—'}</td>
                  <td>{rss ? 'RSS' : siteUrl ? 'Website' : s.type || '—'}</td>
                  <td>{href ? <a href={href} target="_blank" rel="noreferrer noopener">Open</a> : '—'}</td>
                  {canManage && <td><button className="btn-secondary" disabled={toggling===ident} onClick={()=> handleToggle(s)} type="button">{toggling===ident ? 'Updating…' : enabled ? 'Disable' : 'Enable'}</button></td>}
                </tr>
              );})}
            </tbody>
          </table>
          {visibleCount < filtered.length && <div style={{ marginTop: 12 }}><button className="btn-secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)} type="button">Show more ({filtered.length - visibleCount} remaining)</button></div>}
        </div>
      )}
      <div className="sampark-workspace-note">Changes apply immediately and can be reversed. Source status is shared across the team briefing.</div>
    </SamparkWorkspaceShell>
  );
}
