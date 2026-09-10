import React, { useEffect, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  createContributionDraft,
  getContributionAccess,
  getMyContributions,
  getPublishedInternalContent,
  importContributionDocument,
  submitContributionDraft,
  updateContributionDraft,
  uploadContributionCover,
} from '../news-scrapper/api.js';
import { getAccessCapabilities } from '../news-scrapper/api.js';
import {
  CONTRIBUTION_LIMITS,
  validateCoverDimensions,
  validateCoverFile,
} from '../news-scrapper/internal/contributionModel.js';

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

export default function SamparkCreate() {
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
  const [access, setAccess] = useState(null); // null loading, {allowed}
  const [capabilities, setCapabilities] = useState([]);
  const [myCount, setMyCount] = useState(null);
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const [processingDoc, setProcessingDoc] = useState(false);

  useEffect(()=>{
    let cancelled=false;
    getContributionAccess().then((r)=>{ if(!cancelled) setAccess(r); }).catch(()=>{ if(!cancelled) setAccess({ allowed: false }); });
    getAccessCapabilities().then((r)=>{ if(!cancelled) setCapabilities(r?.capabilities||[]); }).catch(()=>{});
    getMyContributions().then((items)=>{ if(!cancelled) setMyCount(items.length); }).catch(()=>{ if(!cancelled) setMyCount(0); });
    return ()=>{ cancelled=true; };
  }, []);

  const hasCreate = access?.allowed || capabilities.includes('contributions.create');
  const contentType = template === 'leadership' ? 'leadership' : template === 'announcement' ? 'announcement' : 'story';
  const coverRequired = contentType !== 'announcement';

  const patch = (p) => setForm((c)=>({ ...c, ...p }));

  const handleCover = async (file) => {
    if (!file) return;
    const check = validateCoverFile(file);
    if (!check.ok) { setProblem(check.message); return; }
    try {
      const { width, height } = await readImageDimensions(file);
      const dim = validateCoverDimensions(width, height);
      if (!dim.ok) { setProblem(dim.message); return; }
      setCoverFile(file);
      setCoverMeta({ width, height });
      const url = URL.createObjectURL(file);
      setCoverPreview(url);
      setProblem('');
      setNotice(`${file.name} ready as cover (${width}×${height}).`);
    } catch (e) { setProblem(e?.message || 'Cover could not be read.'); }
  };

  const handleDocImport = async (file) => {
    if (!file || processingDoc) return;
    setProcessingDoc(true);
    setProblem(''); setNotice('');
    try {
      const rec = await importContributionDocument(file, form.author || localStorage.getItem('news-viewer-name') || '', contentType);
      // populate form from imported record
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
      // keep preview, bust cache
      patch({ coverVersion: Date.now() });
    }
    return recordId;
  };

  const handleSave = async () => {
    if (saving || submitting) return;
    if (!form.title.trim()) { setProblem('Add a clear title before saving.'); return; }
    setSaving(true); setProblem(''); setNotice('');
    try {
      await persistDraft();
      setNotice('Draft saved on the server. Only you and the review desk can see it.');
    } catch (e) { setProblem(e?.message || 'Draft could not be saved.'); }
    finally { setSaving(false); }
  };

  const handleSubmit = async () => {
    if (submitting || saving) return;
    const problems=[];
    if (!form.title.trim()) problems.push('add a title');
    if (form.body.trim().length < 20) problems.push('write the body');
    if (coverRequired && !coverFile && !coverPreview && !form.id) problems.push('select a cover image');
    // also validate cover dimensions if present
    if (problems.length) { setProblem(`Before sending for approval: ${problems.join(' and ')}.`); return; }
    setSubmitting(true); setProblem(''); setNotice('');
    try {
      const recordId = await persistDraft();
      // re-validate after persist if cover still missing for non-announcement
      if (coverRequired && !coverFile && !coverPreview) {
        // check if draft has cover via fetch? we attempt submit and backend will reject if missing
      }
      await submitContributionDraft(recordId);
      setForm({ id: '', title: '', summary: '', body: '', category: 'General', author: '', team: '' });
      setCoverFile(null); setCoverPreview(''); setCoverMeta({width:0,height:0});
      setPreviewOpen(false);
      setTemplate('');
      setNotice('Sent to the editorial review desk. It appears on Samsung Internal once an editor approves it.');
    } catch (e) { setProblem(e?.message || 'Could not be submitted. Your draft is unchanged.'); }
    finally { setSubmitting(false); }
  };

  if (access===null) return <div className="sampark-create-page"><div className="sampark-create-loading" role="status"><span className="sampark-spinner" /> Checking publishing access…</div></div>;
  if (!hasCreate) {
    return (
      <div className="sampark-create-page">
        <div className="sampark-create-denied" role="alert">
          <Icon name="shield" size={24} />
          <h2>Publishing access is required</h2>
          <p>Your briefing and private workspaces are unchanged. Ask an access administrator if internal publishing is part of your role.</p>
          <small>Requires <code>contributions.create</code> · your capabilities: {capabilities.length ? capabilities.join(', ') : 'none'}</small>
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

        <div className="sampark-create-templates">
          {TEMPLATES.map((t)=>(
            <button key={t.id} className="sampark-create-template" onClick={()=>setTemplate(t.id)} type="button">
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
            <li>Create → fill content → Preview → Submit for Approval</li>
            <li>Approver in <strong>Review Center</strong> may <em>Send Back</em> for revision or <em>Approve</em></li>
            <li>Approved item appears in the Samsung News hero / SRI-D surface</li>
          </ol>
          <p className="sampark-create-footnote">Existing drafts remain under Your contributions in the original app until fully migrated. Sampark Create uses the same backend.</p>
        </div>
      </div>
    );
  }

  const coverUrl = previewCoverUrl(coverPreview, form.id, form.coverVersion);
  const hasCover = Boolean(coverUrl);

  return (
    <div className="sampark-create-page">
      <button className="sampark-create-back" onClick={()=>{ setTemplate(''); setPreviewOpen(false); }} type="button"><Icon name="chevL" size={14} /> Choose another template</button>
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

      <div className="sampark-create-workbench">
        {!previewOpen ? (
          <section className="sampark-create-editor" aria-label="Create editor">
            <div className="sampark-create-import">
              <h3>Import (optional)</h3>
              <div className="sampark-create-drop">
                <button className="btn-secondary" disabled={processingDoc} onClick={()=>docInputRef.current?.click()} type="button"><Icon name="upload" size={14} /> Import PDF / DOCX</button>
                <input ref={docInputRef} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e)=>handleDocImport(e.target.files?.[0])} type="file" />
                {processingDoc && <span><span className="sampark-spinner" style={{width:14,height:14,borderWidth:2}} /> Extracting…</span>}
              </div>
              <small>PDF up to 25 MB · 100 pages · .doc not supported — server extracts editable copy.</small>
            </div>

            <label className="sampark-create-field"><span>Headline · {form.title.length}/{CONTRIBUTION_LIMITS.TITLE_MAX}</span><input maxLength={CONTRIBUTION_LIMITS.TITLE_MAX} onChange={(e)=>patch({ title: e.target.value })} placeholder={template==='announcement' ? 'What is happening, in one line' : 'Clear, specific title'} value={form.title} /><small>Required · keep it precise</small></label>
            <label className="sampark-create-field"><span>Key details · {form.summary.length}/{CONTRIBUTION_LIMITS.SUMMARY_MAX}</span><textarea maxLength={CONTRIBUTION_LIMITS.SUMMARY_MAX} onChange={(e)=>patch({ summary: e.target.value })} placeholder="Dates, places, actions needed — what a busy reader must know?" rows={3} value={form.summary} /><small>{template==='announcement' ? 'Optional but recommended' : 'Shown in card and preview'}</small></label>
            <label className="sampark-create-field"><span>Full story</span><textarea onChange={(e)=>patch({ body: e.target.value })} placeholder={template==='announcement' ? 'Write the full notice…' : 'Write here or import a document above…'} rows={10} value={form.body} /><small>{form.body.length ? `${form.body.trim().split(/\s+/).filter(Boolean).length} words · at least 20 characters required` : 'At least 20 characters before submitting'}</small></label>
            <div className="sampark-create-row">
              <label className="sampark-create-field"><span>Category</span><select onChange={(e)=>patch({ category: e.target.value })} value={form.category}><option>General</option><option>Leadership</option><option>Announcement</option><option>Technology</option><option>People & Culture</option><option>Business</option></select></label>
              <label className="sampark-create-field"><span>Author / Team</span><input onChange={(e)=>patch({ author: e.target.value })} placeholder="Team, function or author" value={form.author} /></label>
            </div>

            <div className="sampark-create-cover">
              <h4>Cover image {coverRequired ? <em>required</em> : <small>(optional for announcements)</small>}</h4>
              <input ref={fileInputRef} accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(e)=>handleCover(e.target.files?.[0])} type="file" />
              <div className="sampark-create-cover-actions">
                <button className="btn-secondary" onClick={()=>fileInputRef.current?.click()} type="button"><Icon name="upload" size={14} /> {hasCover ? 'Replace cover' : 'Choose cover'}</button>
                {hasCover && <button className="btn-secondary" onClick={()=>{ setCoverFile(null); setCoverPreview(''); setCoverMeta({width:0,height:0}); }} type="button">Remove cover</button>}
              </div>
              {hasCover && <div className="sampark-create-cover-meta"><Icon name="eye" size={14} /> {coverPreview ? 'Local preview' : 'Stored cover'} {coverMeta.width ? `· ${coverMeta.width}×${coverMeta.height}` : ''}</div>}
              <small>JPG/PNG/WebP ≤10 MB · usable 16:9 ≥960×540 · ~1600×900 recommended</small>
            </div>

            <footer className="sampark-create-footer">
              <button className="btn-secondary" disabled={saving||submitting} onClick={handleSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
              <button className="btn-primary" disabled={saving||submitting} onClick={handleSubmit} type="button">{submitting ? 'Sending…' : 'Submit for approval'} <Icon name="chevR" size={14} /></button>
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
              <button className="btn-secondary" disabled={saving||submitting} onClick={handleSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
              <button className="btn-primary" disabled={saving||submitting} onClick={handleSubmit} type="button">{submitting ? 'Sending…' : 'Submit for approval'}</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
