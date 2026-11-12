import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getWorkflow, getPublishedInternalContent } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';
import { coverUrl } from '../news-scrapper/internal/samsungInternalModel.js';

export default function SamparkApproved({ capabilities = [] }) {
  const hasAccess = capabilities.includes('approved.view') || capabilities.includes('review.news.approve') || capabilities.includes('review.contributions.view');
  const [state, setState] = useState({ status: 'loading', error: '', workflow: null, published: [] });

  const load = async ()=>{
    setState({ status: 'loading', error: '', workflow: null, published: [] });
    try{
      const [wf, pub] = await Promise.all([
        getWorkflow().catch((e)=>{ throw e; }),
        getPublishedInternalContent().catch(()=>[]),
      ]);
      setState({ status: 'ready', error: '', workflow: wf, published: Array.isArray(pub) ? pub : [] });
    }catch(e){
      setState({ status: 'error', error: e?.message || 'Approved content could not be loaded.', workflow: null, published: [] });
    }
  };

  useEffect(() => {
    if (!hasAccess) { setState({ status: 'ready', error: '', workflow: null, published: [] }); return; }
    load();
  }, [hasAccess]);

  if (!hasAccess) return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories for briefing." error="You don’t have access to this workspace." />;
  if (state.status === 'loading') return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories for briefing." loading />;
  if (state.status === 'error') return <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories." error={state.error} onRetry={load} />;

  const approvedWorkflow = state.workflow?.approved || [];
  const published = state.published || [];

  return (
    <SamparkWorkspaceShell title="Approved Briefing" description="Approved stories — editorial approved and published internal contributions.">
      <div className="sampark-approval-grid">
        <section>
          <h3>Briefing Approved <small>· {approvedWorkflow.length}</small></h3>
          {approvedWorkflow.length ? (
            <div className="sampark-approved-list">
              {approvedWorkflow.slice(0,12).map((it, idx)=>(
                <div key={it.title||idx} className="sampark-approved-card">
                  <strong>{it.title}</strong>
                  <small>{it.source || it.src} · {it.category} · {it.date || ''}</small>
                </div>
              ))}
            </div>
          ) : <p className="sampark-workspace-empty-text">No briefing stories approved in this window.</p>}
        </section>
        <section>
          <h3>Published Internal <small>· {published.length}</small></h3>
          <p className="sampark-workspace-note">Approved Create News contributions appear here and on Samsung News hero.</p>
          {published.length ? (
            <div className="sampark-approved-list">
              {published.map((rec)=>(
                <div key={rec.id} className="sampark-approved-card is-published">
                  <span className="sampark-approved-badge">{rec.contentType==='leadership'?'Leadership': rec.contentType==='announcement'?'Announcement':'Story'} · {rec.category||'General'}</span>
                  <strong>{rec.title}</strong>
                  <small>{rec.author || rec.ownerName} · {rec.publishedAt ? String(rec.publishedAt).slice(0,10) : ''}</small>
                  {rec.cover?.url && <small>Cover: {rec.cover.name || 'attached'} ✓</small>}
                </div>
              ))}
            </div>
          ) : <p className="sampark-workspace-empty-text">No internal contributions have been published yet.</p>}
        </section>
      </div>
      <div className="sampark-workspace-note">Preserves original approved semantics. Published items surface in Samsung News hero and All News featured when category matches.</div>
    </SamparkWorkspaceShell>
  );
}
