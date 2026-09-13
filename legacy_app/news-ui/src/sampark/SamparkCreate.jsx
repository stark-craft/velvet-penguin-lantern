import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  createContributionDraft,
  deleteContributionRecord,
  getContributionAccess,
  getMyContributions,
  getOwnedContribution,
  getPublishedInternalContent,
  importContributionDocument,
  submitContributionDraft,
  updateContributionDraft,
  uploadContributionCover,
  withdrawContribution,
} from '../news-scrapper/api.js';
import { getAccessCapabilities } from '../news-scrapper/api.js';
import {
  CONTRIBUTION_LIMITS,
  validateCoverDimensions,
  validateCoverFile,
} from '../news-scrapper/internal/contributionModel.js';
import { EDITABLE_STATUS_SET as EDITABLE_STATUSES, coverReady, isEditableStatus, validateCreateSubmit } from './createModel.js';

const TEMPLATES = [
  { id: 'story', label: 'Story', icon: 'note', desc: 'Write a colleague story for Samsung Internal. One cover, full body.', hint: 'Best for technology or culture stories.' },
  { id: 'leadership', label: 'Leadership Message', icon: 'star', desc: 'Compose the vision live inside the Samsung Internal carousel.', hint: 'Portrait cover appears in the Samsung Focus hero.' },
  { id: 'announcement', label: 'Announcement', icon: 'megaphone', desc: 'Post a notice — HR, town halls, policy updates.', hint: 'Cover optional; text-first notice.' },
];

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be read.')); };
    img.src = url;
  });
}

function previewCoverUrl(coverPreview, recordId, coverVersion) {
  if (coverPreview) return coverPreview;
  if (recordId && coverVersion) return `/internal-content/${recordId}/cover?v=${coverVersion}`;
  if (recordId) return `/internal-content/${recordId}/cover`;
  return '';
}

export default function SamparkCreate({ onDirtyChange, initialAccess = null, initialItems = null }) {
  const location = useLocation();
  const [template, setTemplate] = useState('');
  const [form, setForm] = useState({ id: '', title: '', summary: '', body: '', category: 'General', author: '', team: '' });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [coverMeta, setCoverMeta] = useState({ width: 0, height: 0 });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [access, setAccess] = useState(initialAccess); // null loading, {allowed}
  const [capabilities, setCapabilities] = useState([]);
  const [myCount, setMyCount] = useState(initialItems ? initialItems.length : null);
  const [myItems, setMyItems] = useState(initialItems || []);
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const coverPreviewRef = useRef('');
  useEffect(() => { coverPreviewRef.current = coverPreview; }, [coverPreview]);
  useEffect(() => () => { if (coverPreviewRef.current && coverPreviewRef.current.startsWith('blob:')) URL.revokeObjectURL(coverPreviewRef.current); }, []);
  const [processingDoc, setProcessingDoc] = useState(false);
  const [cleanSnapshot, setCleanSnapshot] = useState({ title: '', summary: '', body: '', category: 'General', author: '', team: '', coverPreview: '' });
  const [recordStatus, setRecordStatus] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [actingId, setActingId] = useState('');
  const [visibleContributions, setVisibleContributions] = useState(10);

  const openRecord = (rec) => {
    const tpl = rec.contentType === 'leadership' ? 'leadership' : rec.contentType === 'announcement' ? 'announcement' : 'story';
    setTemplate(tpl);
    setForm({ id: rec.id, title: rec.title || '', summary: rec.summary || '', body: rec.body || '', category: rec.category || 'General', author: rec.author || '', team: rec.team || '' });
    setCoverFile(null);
    setCoverPreview(rec.cover?.url || '');
    setCoverMeta({ width: rec.cover?.width || 0, height: rec.cover?.height || 0 });
    setRecordStatus(rec.status || '');
    setReviewNote(rec.reviewNote || '');
    setCleanSnapshot({ title: rec.title || '', summary: rec.summary || '', body: rec.body || '', category: rec.category || 'General', author: rec.author || '', team: rec.team || '', coverPreview: rec.cover?.url || '' });
    setPreviewOpen(false);
    setProblem('');
    setNotice(rec.status === 'needs_changes' && rec.reviewNote ? `Reviewer feedback: ${rec.reviewNote}` : '');
  };

  const openRecordById = async (id) => {
    setProblem(''); setNotice('');
    try {
      const rec = await getOwnedContribution(id);
      openRecord(rec);
    } catch (e) {
      setProblem(e?.message || 'That draft could not be opened. It may have been removed.');
    }
  };

  const backToList = () => {
    setTemplate('');
    setForm({ id: '', title: '', summary: '', body: '', category: 'General', author: '', team: '' });
    setCoverFile(null); setCoverPreview(''); setCoverMeta({ width: 0, height: 0 });
    setRecordStatus(''); setReviewNote(''); setPreviewOpen(false);
    setCleanSnapshot({ title: '', summary: '', body: '', category: 'General', author: '', team: '', coverPreview: '' });
    refreshMyItems();
  };

  const dashboardWithdraw = async (id) => {
    setActingId(id); setProblem(''); setNotice('');
    try {
      await withdrawContribution(id);
      setNotice('Submission withdrawn. You can edit and resubmit.');
      await refreshMyItems();
    } catch (e) { setProblem(e?.message || 'Could not withdraw this item.'); }
    finally { setActingId(''); }
  };

  const dashboardDelete = async (id) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setActingId(id); setProblem(''); setNotice('');
    try {
      await deleteContributionRecord(id);
      setConfirmDeleteId('');
      setNotice('Draft permanently deleted.');
      await refreshMyItems();
    } catch (e) { setProblem(e?.message || 'Could not delete this draft.'); }
    finally { setActingId(''); }
  };

  const refreshMyItems = async ()=>{
    try{ const items = await getMyContributions(); setMyCount(items.length); setMyItems(items); }catch{ setMyCount(0); setMyItems([]); }
  };
  useEffect(()=>{
    let cancelled=false;
    if (initialAccess === null) {
      getContributionAccess().then((r)=>{ if(!cancelled) setAccess(r); }).catch(()=>{ if(!cancelled) setAccess({ allowed: false }); });
    }
    getAccessCapabilities().then((r)=>{ if(!cancelled) setCapabilities(r?.capabilities||[]); }).catch(()=>{});
    if (initialItems === null) refreshMyItems();
    return ()=>{ cancelled=true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link from author notifications: /create?open=<recordId>
  useEffect(()=>{
    const params = new URLSearchParams(location.search || '');
    const openId = params.get('open');
    if (!openId) return;
    openRecordById(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // explicit dirty state communicated to parent (replaces DOM polling)
  const isDirty = (() => {
    if (!template) return false;
    if (coverFile) return true;
    if (coverPreview !== cleanSnapshot.coverPreview) return true;
    if (form.title !== cleanSnapshot.title) return true;
    if (form.summary !== cleanSnapshot.summary) return true;
    if (form.body !== cleanSnapshot.body) return true;
    if (form.category !== cleanSnapshot.category) return true;
    if (form.author !== cleanSnapshot.author) return true;
    if (form.team !== cleanSnapshot.team) return true;
    return false;
  })();
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const hasCreate = access?.allowed || capabilities.includes('contributions.create');
  const contentType = template === 'leadership' ? 'leadership' : template === 'announcement' ? 'announcement' : 'story';
  const coverRequired = contentType !== 'announcement';

  // Derived record status must precede every early-return branch: the
  // template-picker landing page also renders record banners.
  const coverUrl = previewCoverUrl(coverPreview, form.id, form.coverVersion);
  const hasCover = Boolean(coverFile || coverPreview);
  const isEditableRecord = isEditableStatus(recordStatus, form.id);
  const isSubmittedView = Boolean(form.id) && recordStatus === 'submitted';
  const readOnlyNow = Boolean(form.id) && Boolean(recordStatus) && !isEditableStatus(recordStatus, form.id);

  const patch = (p) => setForm((c)=>({ ...c, ...p }));

  const handleCover = async (file) => {
    if (!file || readOnlyNow) return;
    const check = validateCoverFile(file);
    if (!check.ok) { setProblem(check.message); return; }
    try {
      const { width, height } = await readImageDimensions(file);
      const dim = validateCoverDimensions(width, height);
      if (!dim.ok) { setProblem(dim.message); return; }
      if (coverPreview && coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverFile(file);
      setCoverMeta({ width, height });
      const url = URL.createObjectURL(file);
      setCoverPreview(url);
      setProblem('');
      setNotice(`${file.name} ready as cover (${width}×${height}).`);
    } catch (e) { setProblem(e?.message || 'Cover could not be read.'); }
  };

  const handleDocImport = async (file) => {
    if (!file || processingDoc || readOnlyNow) return;
    setProcessingDoc(true);
    setProblem(''); setNotice('');
    try {
      const rec = await importContributionDocument(file, form.author || localStorage.getItem('news-viewer-name') || '', contentType);
      patch({ id: rec.id, title: form.title || rec.title, summary: form.summary || rec.summary, body: form.body ? `${form.body}\n\n${rec.body}` : rec.body, category: rec.category || form.category, author: rec.author || form.author });
      if (rec.cover?.url) {
        setCoverPreview(rec.cover.url);
        setCoverMeta({ width: rec.cover.width||0, height: rec.cover.height||0 });
      }
      setNotice(`${file.name} converted into editable draft. Review before submitting.`);
    } catch (e) { setProblem(e?.message || `${file.name} could not be imported.`); }
    finally { setProcessingDoc(false); if (docInputRef.current) docInputRef.current.value=''; }
  };

  const persistDraft = async () => {
    if (readOnlyNow) throw new Error('This record is read-only in its current state.');
    let recordId = form.id || '';
    const fields = { title: form.title, summary: form.summary, body: form.body, category: form.category, team: form.team, author: form.author, contentType };
    if (recordId) {
      try { await updateContributionDraft(recordId, fields); }
      catch (e) { if (e?.status!==404) throw e; recordId=''; }
    }
    if (!recordId) {
      const created = await createContributionDraft(fields);
      recordId = created.id;
      patch({ id: recordId });
    }
    if (coverFile && recordId) {
      await uploadContributionCover(recordId, coverFile, 0.5, 0.5);
      setCoverFile(null);
      patch({ coverVersion: Date.now() });
    }
    return recordId;
  };

  const handleSave = async () => {
    if (saving || submitting || readOnlyNow) return;
    if (!form.title.trim()) { setProblem('Add a clear title before saving.'); return; }
    setSaving(true); setProblem(''); setNotice('');
    try {
      await persistDraft();
      await refreshMyItems();
      // successfully saved draft must become clean
      setCleanSnapshot({ title: form.title, summary: form.summary, body: form.body, category: form.category, author: form.author, team: form.team, coverPreview });
      setNotice('Draft saved on the server. Only you and the review desk can see it.');
    } catch (e) { setProblem(e?.message || 'Draft could not be saved.'); }
    finally { setSaving(false); }
  };

  const handleRemoveCover = async () => {
    if (readOnlyNow) return;
    if (coverFile) {
      if (coverPreview && coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverFile(null); setCoverPreview(''); setCoverMeta({width:0,height:0}); setNotice('Cover removed (local).');
      return;
    }
    if (form.id && coverPreview) {
      try{
        const res = await fetch(`/internal-content/${encodeURIComponent(form.id)}/cover`, { method: 'DELETE' });
        if(!res.ok){ const body=await res.json().catch(()=>({})); throw new Error(body.detail||body.message||'Could not delete cover'); }
        setCoverPreview(''); setCoverMeta({width:0,height:0}); setNotice('Cover deleted from server.');
        setCleanSnapshot((c)=> ({ ...c, coverPreview: '' }));
        await refreshMyItems();
      }catch(e){ setProblem(e?.message||'Cover could not be deleted.'); }
      return;
    }
    setCoverPreview(''); setCoverMeta({width:0,height:0});
  };
  const handleSubmit = async () => {
    if (submitting || saving || readOnlyNow) return;
    // Cover presence comes from a pending file or a stored cover — never the record ID alone.
    const problems = validateCreateSubmit({
      title: form.title,
      body: form.body,
      coverRequired,
      hasCover: coverReady({ coverRequired, coverFile, coverPreview }),
    });
    if (problems.length) { setProblem(`Before sending for approval: ${problems.join(' and ')}.`); return; }
    setSubmitting(true); setProblem(''); setNotice('');
    try {
      const recordId = await persistDraft();
      await submitContributionDraft(recordId);
      setForm({ id: '', title: '', summary: '', body: '', category: 'General', author: '', team: '' });
      setCoverFile(null); setCoverPreview(''); setCoverMeta({width:0,height:0});
      setPreviewOpen(false);
      setTemplate('');
      setCleanSnapshot({ title: '', summary: '', body: '', category: 'General', author: '', team: '', coverPreview: '' });
      await refreshMyItems();
      setNotice('Sent to the editorial review desk. It appears on Samsung Internal once an editor approves it. Check Review Center for placement.');
    } catch (e) { setProblem(e?.message || 'Could not be submitted. Your draft is unchanged.'); }
    finally { setSubmitting(false); }
  };

  const handleTemplateSelect = (id) => {
    setTemplate(id);
    // reset clean snapshot for new template (category default should not mark dirty)
    setCleanSnapshot({ title: '', summary: '', body: '', category: 'General', author: '', team: '', coverPreview: '' });
    setForm({ id: '', title: '', summary: '', body: '', category: 'General', author: '', team: '' });
    setCoverFile(null); setCoverPreview(''); setCoverMeta({width:0,height:0});
  };

  if (access===null) return <div className="sampark-create-page"><div className="sampark-create-loading" role="status"><span className="sampark-spinner" /> Checking publishing access…</div></div>;
  if (!hasCreate) {
    return (
      <div className="sampark-create-page">
        <div className="sampark-create-denied" role="alert">
          <Icon name="shield" size={24} />
          <h2>Publishing access is required</h2>
          <p>Your briefing and private workspaces are unchanged. Ask an access administrator if internal publishing is part of your role.</p>
        </div>
      </div>
    );
  }

  // template picker
  if (!template) {
    return (
      <div className="sampark-create-page">
        <header className="sampark-create-header">
          <div>
            <span className="sampark-create-kicker">Create News · Internal Publishing</span>
            <h1>What will you publish today?</h1>
            <p>Choose a template. Every template maps to the same approved review workflow — your draft stays private until an editor approves it.</p>
          </div>
          <div className="sampark-create-meta"><span><Icon name="shield" size={14} /> Private until approved</span><span>{myCount ?? '—'} drafts</span></div>
        </header>

      {(notice||problem) && <div className={`sampark-create-feedback ${problem ? 'is-error' : ''}`} role={problem ? 'alert' : 'status'}><Icon name={problem ? 'warning' : 'check2'} size={16} /><span>{problem||notice}</span><button aria-label="Dismiss" onClick={()=>{ setNotice(''); setProblem(''); }} type="button"><Icon name="x" size={14} /></button></div>}
      {form.id && recordStatus && <div className="sampark-create-feedback" role="status"><Icon name="note" size={16} /><span>Status: {recordStatus}{reviewNote && (recordStatus==='needs_changes') ? ` — Reviewer feedback: ${reviewNote}` : ''}</span></div>}
      {isSubmittedView && <div className="sampark-create-feedback" role="status"><Icon name="clock" size={16} /><span>Submitted — read-only while editors review.</span><button className="btn-secondary" onClick={()=>dashboardWithdraw(form.id)} type="button">Withdraw</button></div>}

        <div className="sampark-create-templates">
          {TEMPLATES.map((t)=>(
            <button key={t.id} className="sampark-create-template" onClick={()=>handleTemplateSelect(t.id)} type="button">
              <span className="sampark-create-template-icon"><Icon name={t.icon} size={22} /></span>
              <strong>{t.label}</strong>
              <p>{t.desc}</p>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>

        <div className="sampark-create-help">
          <h3>Workflow</h3>
          <ol>
            <li>Create → fill content → Preview → Submit for Approval. Your draft stays private until approved.</li>
            <li>An approver in <strong>Review Center</strong> may <em>Send Back</em> for revision or <em>Approve</em>.</li>
            <li>Approved items appear in Samsung News automatically.</li>
          </ol>
        </div>
        {myItems.length>0 && (
          <section className="sampark-create-dashboard" aria-label="Your contributions">
            <h3>Your contributions ({myCount ?? myItems.length})</h3>
            <p>Drafts and recent submissions, most recent first. Reopen anything editable to continue where you left off.</p>
            <ul style={{ display:'grid', gap:8, marginTop:8 }}>
              {myItems.slice(0, visibleContributions).map(it=>{
                const editable = ['draft','ready','needs_changes','withdrawn'].includes(it.status);
                const submitted = it.status === 'submitted';
                const published = it.status === 'published';
                const busy = actingId === it.id;
                return (
                <li key={it.id} style={{ padding:'8px 12px', border:'1px solid var(--line)', borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <div><strong>{it.title||'Untitled'}</strong> <small>· {it.status} · {it.contentType} · {it.category||'General'}</small>{it.status==='needs_changes' && it.reviewNote && <div style={{ fontSize:12, color:'#92400e' }}>Reviewer: {it.reviewNote}</div>}<div><small>{it.updatedAt ? String(it.updatedAt).slice(0,10) : ''}</small></div></div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {editable && <button className="btn-secondary" disabled={busy} onClick={()=>openRecord(it)} type="button">Edit</button>}
                    {it.status==='needs_changes' && <button className="btn-primary" disabled={busy} onClick={()=>openRecord(it)} type="button">Revise &amp; resubmit</button>}
                    {submitted && <button className="btn-secondary" disabled={busy} onClick={()=>dashboardWithdraw(it.id)} type="button">{busy ? 'Working…' : 'Withdraw'}</button>}
                    {it.status==='withdrawn' && <button className="btn-secondary" disabled={busy} onClick={()=>openRecord(it)} type="button">Edit &amp; resubmit</button>}
                    {published && <Link className="btn-secondary" to={`/samsung-news?focus=${encodeURIComponent(it.id)}`}>View live</Link>}
                    {(it.status==='draft'||it.status==='ready'||it.status==='withdrawn') && (
                      <button className="btn-secondary" disabled={busy} onClick={()=>dashboardDelete(it.id)} type="button">{confirmDeleteId===it.id ? 'Confirm delete' : 'Delete'}</button>
                    )}
                  </div>
                </li>
              );})}
            </ul>
            {visibleContributions < myItems.length && (
              <div style={{ marginTop: 8 }}>
                <button className="btn-secondary" onClick={() => setVisibleContributions((c) => c + 10)} type="button">
                  Show more ({myItems.length - visibleContributions} remaining)
                </button>
              </div>
            )}
            {confirmDeleteId && <p style={{ fontSize:12, color:'#b91c1c' }}>Choose Delete again to permanently remove that draft. This cannot be undone.</p>}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="sampark-create-page">
      <button className="sampark-create-back" onClick={()=>{ backToList(); }} type="button"><Icon name="chevL" size={14} /> Back to contributions</button>
      <header className="sampark-create-header">
        <div>
          <span className="sampark-create-kicker">Create News · {TEMPLATES.find((t)=>t.id===template)?.label}</span>
          <h1>{template==='announcement' ? 'Post the notice everyone actually reads.' : template==='leadership' ? 'Compose the vision of the quarter.' : 'Tell a story your colleagues will save.'}</h1>
          <p>{template==='announcement' ? 'Write directly or import a document — cover is optional. Announcements go live after editor approval.' : template==='leadership' ? 'Rehearse the vision inside the Samsung Internal carousel. Portrait cover strongly recommended (16:9, ≥960×540).' : 'One cover (16:9, ≥960×540) plus title, key details and full body. Your draft stays private until approved.'}</p>
        </div>
        <div className="sampark-create-actions-top">
          <button className="btn-secondary" onClick={()=>setPreviewOpen((v)=>!v)} type="button"><Icon name={previewOpen ? 'eye' : 'eye'} size={14} /> {previewOpen ? 'Edit' : 'Preview'}</button>
        </div>
      </header>

      {(notice||problem) && <div className={`sampark-create-feedback ${problem ? 'is-error' : ''}`} role={problem ? 'alert' : 'status'}><Icon name={problem ? 'warning' : 'check2'} size={16} /><span>{problem||notice}</span><button aria-label="Dismiss" onClick={()=>{ setNotice(''); setProblem(''); }} type="button"><Icon name="x" size={14} /></button></div>}
      {form.id && recordStatus && <div className="sampark-create-feedback" role="status"><Icon name="note" size={16} /><span>Status: {recordStatus}{reviewNote && recordStatus==='needs_changes' ? ` — Reviewer feedback: ${reviewNote}` : ''}</span></div>}
      {isSubmittedView && <div className="sampark-create-feedback" role="status"><Icon name="clock" size={16} /><span>Submitted — read-only while editors review.</span><button className="btn-secondary" onClick={()=>dashboardWithdraw(form.id)} type="button">Withdraw</button></div>}

      <div className="sampark-create-workbench">
        {!previewOpen ? (
          <section className="sampark-create-editor" aria-label="Create editor">
            <div className="sampark-create-import">
              <h3>Import (optional)</h3>
              <div className="sampark-create-drop">
                <button className="btn-secondary" disabled={processingDoc || !isEditableRecord} onClick={()=>docInputRef.current?.click()} type="button"><Icon name="upload" size={14} /> Import PDF / DOCX</button>
                <input ref={docInputRef} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e)=>handleDocImport(e.target.files?.[0])} type="file" />
                {processingDoc && <span><span className="sampark-spinner" style={{width:14,height:14,borderWidth:2}} /> Extracting…</span>}
              </div>
              <small>PDF up to 25 MB · 100 pages · .doc not supported — server extracts editable copy.</small>
            </div>

            <label className="sampark-create-field"><span>Headline · {form.title.length}/{CONTRIBUTION_LIMITS.TITLE_MAX}</span><input maxLength={CONTRIBUTION_LIMITS.TITLE_MAX} disabled={!isEditableRecord} onChange={(e)=>patch({ title: e.target.value })} placeholder={template==='announcement' ? 'What is happening, in one line' : 'Clear, specific title'} value={form.title} /><small>Required · keep it precise</small></label>
            <label className="sampark-create-field"><span>Key details · {form.summary.length}/{CONTRIBUTION_LIMITS.SUMMARY_MAX}</span><textarea maxLength={CONTRIBUTION_LIMITS.SUMMARY_MAX} disabled={!isEditableRecord} onChange={(e)=>patch({ summary: e.target.value })} placeholder="Dates, places, actions needed — what a busy reader must know?" rows={3} value={form.summary} /><small>{template==='announcement' ? 'Optional but recommended' : 'Shown in card and preview'}</small></label>
            <label className="sampark-create-field"><span>Full story</span><textarea disabled={!isEditableRecord} onChange={(e)=>patch({ body: e.target.value })} placeholder={template==='announcement' ? 'Write the full notice…' : 'Write here or import a document above…'} rows={10} value={form.body} /><small>{form.body.length ? `${form.body.trim().split(/\s+/).filter(Boolean).length} words · at least 20 characters required` : 'At least 20 characters before submitting'}</small></label>
            <div className="sampark-create-row">
              <label className="sampark-create-field"><span>Category</span><select disabled={!isEditableRecord} onChange={(e)=>patch({ category: e.target.value })} value={form.category}><option>General</option><option>Leadership</option><option>Announcement</option><option>Technology</option><option>People & Culture</option><option>Business</option></select></label>
              <label className="sampark-create-field"><span>Author / Team</span><input disabled={!isEditableRecord} onChange={(e)=>patch({ author: e.target.value })} placeholder="Team, function or author" value={form.author} /></label>
            </div>

            <div className="sampark-create-cover">
              <h4>Cover image {coverRequired ? <em>required</em> : <small>(optional for announcements)</small>}</h4>
              <input ref={fileInputRef} accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(e)=>handleCover(e.target.files?.[0])} type="file" />
              <div className="sampark-create-cover-actions">
                <button className="btn-secondary" disabled={!isEditableRecord} onClick={()=>fileInputRef.current?.click()} type="button"><Icon name="upload" size={14} /> {hasCover ? 'Replace cover' : 'Choose cover'}</button>
                {hasCover && <button className="btn-secondary" disabled={!isEditableRecord} onClick={handleRemoveCover} type="button">Remove cover</button>}
              </div>
              {hasCover && <div className="sampark-create-cover-meta"><Icon name="eye" size={14} /> {coverPreview ? 'Local preview' : 'Stored cover'} {coverMeta.width ? `· ${coverMeta.width}×${coverMeta.height}` : ''}</div>}
              <small>JPG/PNG/WebP ≤10 MB · usable 16:9 ≥960×540 · ~1600×900 recommended</small>
            </div>

            <footer className="sampark-create-footer">
              <button className="btn-secondary" disabled={saving||submitting||!isEditableRecord} onClick={handleSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
              <button className="btn-primary" disabled={saving||submitting||!isEditableRecord} onClick={handleSubmit} type="button">{submitting ? 'Sending…' : 'Submit for approval'} <Icon name="chevR" size={14} /></button>
            </footer>
            <p className="sampark-create-footnote">Drafts are private to you and the review desk. Submitting locks the draft until an editor acts.</p>
          </section>
        ) : (
          <section className="sampark-create-preview" aria-label="Live preview">
            <header><div><span>Preview</span><strong>{TEMPLATES.find((t)=>t.id===template)?.label} · Samsung Internal card</strong></div><span className="sampark-create-preview-live">Live</span></header>
            <article className={hasCover ? 'has-image' : 'is-placeholder'}>
              {hasCover ? <img alt="Cover preview" src={coverUrl} /> : <div className="sampark-create-preview-art"><span>S</span><i /><i /></div>}
              <div className="sampark-create-preview-copy">
                <span>{form.category || 'General'}</span>
                <h2>{form.title || 'Your headline will appear here'}</h2>
                <p>{form.summary || 'Add key details — dates, places and action needed.'}</p>
                {form.body && <div className="sampark-create-preview-body">{form.body.slice(0, 400)}{form.body.length>400?'…':''}</div>}
                <footer><small>{form.author || 'Samsung colleague'}</small><button tabIndex={-1} type="button">Read story <Icon name="chevR" size={12} /></button></footer>
              </div>
            </article>
            <div className="sampark-create-readiness">
              <strong>Readiness</strong>
              <span className={form.title ? 'done' : ''}><Icon name={form.title ? 'check2' : 'clock'} size={14} /> Clear headline</span>
              <span className={form.summary ? 'done' : ''}><Icon name={form.summary ? 'check2' : 'clock'} size={14} /> Key details</span>
              <span className={form.body.trim().length>=20 ? 'done' : ''}><Icon name={form.body.trim().length>=20 ? 'check2' : 'clock'} size={14} /> Full story</span>
              <span className={hasCover || !coverRequired ? 'done' : ''}><Icon name={hasCover || !coverRequired ? 'check2' : 'clock'} size={14} /> Cover {coverRequired ? '' : <small>optional</small>}</span>
            </div>
            <footer className="sampark-create-footer">
              <button className="btn-secondary" onClick={()=>setPreviewOpen(false)} type="button">Edit</button>
              <button className="btn-secondary" disabled={saving||submitting||!isEditableRecord} onClick={handleSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
              <button className="btn-primary" disabled={saving||submitting||!isEditableRecord} onClick={handleSubmit} type="button">{submitting ? 'Sending…' : 'Submit for approval'}</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
