import React, { useEffect, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { getWorkflow, getInternalReviewQueue, publishInternalContent, requestInternalContentChanges, rejectInternalContent, unlockInternalReview, lockInternalReview } from '../news-scrapper/api.js';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

function formatDate(v){ try{ return new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}catch{ return ''; } }

export default function SamparkReview({ capabilities = [] }) {
  const hasWorkflowAccess = capabilities.includes('review.news.view') || capabilities.includes('review.contributions.view') || capabilities.includes('review.news.approve');
  const hasInternalView = capabilities.includes('review.contributions.view') || capabilities.includes('review.news.view');
  const hasPublish = capabilities.includes('review.contributions.publish') || capabilities.includes('review.news.approve');
  const [workflowState, setWorkflowState] = useState({ status: 'loading', error: '', data: null });
  const [internalState, setInternalState] = useState({ status: 'probing', error: '', items: [], unlocked: null, keyDraft: '', notice: '' });
  const [busyId, setBusyId] = useState('');
  const [confirmReject, setConfirmReject] = useState('');
  const [noteDraft, setNoteDraft] = useState({}); // id -> note

  const loadWorkflow = async () => {
    if (!hasWorkflowAccess) { setWorkflowState({ status: 'ready', error: '', data: { selected: [] } }); return; }
    setWorkflowState({ status: 'loading', error: '', data: null });
    try {
      const res = await getWorkflow();
      setWorkflowState({ status: 'ready', error: '', data: res });
    } catch (e) {
      setWorkflowState({ status: 'error', error: e?.message || 'Workflow queue could not be loaded.' });
    }
  };

  const loadInternal = async () => {
    setInternalState((s)=>({ ...s, status: 'loading', error: '' }));
    try {
      const data = await getInternalReviewQueue();
      setInternalState((s)=>({ ...s, status: 'ready', items: data?.items||[], unlocked: true, error: '' }));
    } catch (e) {
      if (e?.status===403) setInternalState((s)=>({ ...s, status: 'locked', unlocked: false, error: '' }));
      else setInternalState((s)=>({ ...s, status: 'error', error: e?.message || 'Review desk could not be loaded.' }));
    }
  };

  useEffect(()=>{ loadWorkflow(); }, [hasWorkflowAccess]);
  useEffect(()=>{
    // probe internal queue; if capability suggests access, still probe to determine locked state
    loadInternal();
  }, []);

  const handleUnlock = async (e)=>{
    e.preventDefault();
    if(!internalState.keyDraft.trim()) return;
    setInternalState((s)=>({ ...s, status: 'loading', error: '' }));
    try{
      await unlockInternalReview(internalState.keyDraft.trim());
      setInternalState((s)=>({ ...s, keyDraft: '', error: '' }));
      await loadInternal();
    }catch(err){ setInternalState((s)=>({ ...s, status: 'locked', error: err?.message || 'That key was not accepted.' })); }
  };
  const handleLock = async()=>{
    try{ await lockInternalReview(); }catch{}
    setInternalState((s)=>({ ...s, unlocked:false, items:[], status:'locked', notice:'' }));
  };

  const decide = async (record, action)=>{
    if(busyId) return;
    setBusyId(record.id);
    setInternalState((s)=>({ ...s, error: '', notice: '' }));
    try{
      if(action==='publish') await publishInternalContent(record.id);
      if(action==='changes') await requestInternalContentChanges(record.id, noteDraft[record.id] || '');
      if(action==='reject') await rejectInternalContent(record.id, noteDraft[record.id] || '');
      setInternalState((s)=>({ ...s, items: s.items.filter((it)=>it.id!==record.id), notice: action==='publish' ? `"${record.title}" is live on Samsung Internal.` : action==='changes' ? `Change request sent for "${record.title}".` : `"${record.title}" was archived.` }));
      setConfirmReject('');
    }catch(err){ setInternalState((s)=>({ ...s, error: err?.message || 'Decision could not be recorded.' })); }
    finally{ setBusyId(''); }
  };

  const workflowCount = workflowState.data?.selected?.length || 0;
  const internalCount = internalState.items.length;

  // gate: if no workflow and no internal access and locked, show workspace shell with access error
  const noAccess = !hasWorkflowAccess && internalState.unlocked===false && !capabilities.includes('review.contributions.view');
  // But if we are locked and user can unlock via key, we show unlock form inside shell instead of full denied.

  return (
    <SamparkWorkspaceShell title="Review Center" description="Editorial review and colleague submissions — server remains authoritative.">
      {internalState.notice && <div className="sampark-workspace-note" role="status"><Icon name="check2" size={14} /> {internalState.notice}</div>}
      {internalState.error && workflowState.error && <div className="sampark-workspace-error" role="alert">{internalState.error || workflowState.error}</div>}

      {/* Workflow queue snippet (original briefing review) */}
      {workflowState.status==='loading' && <div className="sampark-workspace-loading"><span className="sampark-spinner" /> Loading review queues…</div>}
      {workflowState.status==='error' && <div className="sampark-workspace-error">{workflowState.error} <button className="btn-secondary" onClick={loadWorkflow} type="button">Retry</button></div>}
      {workflowState.status==='ready' && (
        <div className="sampark-review-section">
          <h3>Briefing Review Queue</h3>
          <div className="sampark-review-summary"><span className="sampark-review-count"><Icon name="layers" size={14} /> {workflowCount} signals awaiting review</span><small>Original workflow — capability <code>review.news.view</code></small></div>
          {workflowCount===0 && <p className="sampark-review-empty">No briefing signals in the review queue.</p>}
          {workflowState.data?.selected?.slice(0,3).map((it)=>(
            <div key={it.title||it.id} className="sampark-hidden-card"><strong>{it.title}</strong><small>{it.source || it.src} · {it.category}</small></div>
          ))}
        </div>
      )}

      {/* Internal contributions review desk */}
      <div className="sampark-review-section sampark-review-internal">
        <div className="sampark-review-internal-head">
          <div>
            <h3>Internal Contributions</h3>
            <p>Colleague stories, leadership messages and announcements awaiting decision. Original contribution workflow — capability <code>review.contributions.view / publish</code> or editor key.</p>
          </div>
          <div className="sampark-review-actions">
            <button className="btn-secondary" disabled={internalState.status==='loading'} onClick={loadInternal} type="button"><Icon name="refresh" size={14} /> Refresh</button>
            {internalState.unlocked && <button className="btn-secondary" onClick={handleLock} type="button"><Icon name="shield" size={14} /> Lock</button>}
          </div>
        </div>

        {internalState.status==='loading' && <div className="sampark-workspace-loading"><span className="sampark-spinner" /> Opening contribution desk…</div>}
        {internalState.status==='locked' && (
          <form className="sampark-review-unlock" onSubmit={handleUnlock}>
            <Icon name="shield" size={18} />
            <div>
              <strong>Editor access required</strong>
              <p>Enter the internal editor key to open contributed drafts. The key stays with the server — nothing is stored in this browser. Privileged session capability will also unlock this desk without a key.</p>
              <div className="sampark-review-unlock-row">
                <input aria-label="Editor key" autoComplete="off" placeholder="Editor key" type="password" value={internalState.keyDraft} onChange={(e)=>setInternalState((s)=>({ ...s, keyDraft: e.target.value }))} />
                <button className="btn-primary" disabled={!internalState.keyDraft.trim() || internalState.status==='loading'} type="submit">{internalState.status==='loading' ? 'Checking…' : 'Unlock'}</button>
              </div>
              {internalState.error && <span className="sampark-review-error" role="alert">{internalState.error}</span>}
              {hasPublish && <small>Your privileged session already has publishing access — if this form appears, try Refresh after signing in via Access.</small>}
            </div>
          </form>
        )}
        {internalState.status==='error' && <div className="sampark-workspace-error" role="alert">{internalState.error} <button className="btn-secondary" onClick={loadInternal} type="button">Retry</button></div>}
        {internalState.status==='ready' && (
          <>
            <div className="sampark-review-count"><Icon name="check2" size={14} /> {internalCount} contribution{internalCount===1?'':'s'} awaiting decision</div>
            {!internalCount && <div className="sampark-workspace-empty"><Icon name="inbox" size={22} /><h3>The contribution shelf is clear</h3><p>Colleague submissions appear here the moment they submit from Create News.</p></div>}
            {!!internalCount && (
              <div className="sampark-review-grid">
                {internalState.items.map((rec)=>(
                  <article key={rec.id} className="sampark-review-card">
                    <div className="sampark-review-card-head">
                      <span className={`sampark-review-badge is-${rec.content_type}`}>{rec.content_type==='leadership' ? 'Leadership' : rec.content_type==='announcement' ? 'Announcement' : 'Story'}</span>
                      {rec.category && <span className="sampark-review-chip">{rec.category}</span>}
                      <time>{formatDate(rec.submitted_at)}</time>
                    </div>
                    <h4>{rec.title}</h4>
                    {rec.summary && <p className="sampark-review-summary-text">{rec.summary}</p>}
                    <p className="sampark-review-excerpt">{String(rec.body||'').slice(0,180)}{String(rec.body||'').length>180?'…':''}</p>
                    <div className="sampark-review-meta"><Icon name="eye" size={12} /> {rec.author || 'Unnamed author'} · {rec.owner_name || ''}</div>
                    {rec.cover && <div className="sampark-review-cover-hint"><Icon name="eye" size={12} /> Cover attached ✓</div>}
                    <div className="sampark-review-note">
                      <label>
                        <span>Note to author (for Send Back)</span>
                        <textarea aria-label={`Note for ${rec.title}`} placeholder="What should change before this can be published?" rows={2} value={noteDraft[rec.id]||''} onChange={(e)=>setNoteDraft((cur)=>({ ...cur, [rec.id]: e.target.value }))} />
                      </label>
                    </div>
                    <div className="sampark-review-card-actions">
                      <button aria-busy={busyId===rec.id} className="btn-primary" disabled={Boolean(busyId)} onClick={()=>decide(rec,'publish')} type="button"><Icon name="check2" size={14} /> Approve & publish</button>
                      <button aria-busy={busyId===rec.id} className="btn-secondary" disabled={Boolean(busyId)} onClick={()=>decide(rec,'changes')} type="button">Send Back</button>
                      {confirmReject===rec.id ? (
                        <button aria-busy={busyId===rec.id} className="btn-secondary" disabled={Boolean(busyId)} onClick={()=>decide(rec,'reject')} type="button">Confirm Reject?</button>
                      ) : (
                        <button className="btn-secondary" disabled={Boolean(busyId)} onClick={()=>setConfirmReject(rec.id)} type="button">Reject</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </SamparkWorkspaceShell>
  );
}
