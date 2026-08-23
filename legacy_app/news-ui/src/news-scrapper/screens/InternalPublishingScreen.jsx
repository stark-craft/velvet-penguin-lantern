import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import {
  createContributionDraft,
  importContributionDocument,
  submitContributionDraft,
  updateContributionDraft,
  uploadContributionCover,
} from "../api.js";
import { formatFileSize } from "../internal/documentImport.js";
import { validateDocumentFile } from "../internal/documentParser.js";
import {
  CONTRIBUTION_LIMITS,
  validateCoverDimensions,
  validateCoverFile,
} from "../internal/contributionModel.js";
import "../styles/internal-publishing.css";

const SESSION_KEY = "sense-announcement-composer-session-v1";
const MIN_BODY_CHARS = 20;

const emptyForm = {
  id: "",
  title: "",
  summary: "",
  body: "",
  author: "",
  coverName: "",
  coverWidth: 0,
  coverHeight: 0,
  coverVersion: 0,
  sourceMeta: null,
};

function initialForm() {
  if (typeof window === "undefined") return emptyForm;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null");
    return saved?.form ? { ...emptyForm, ...saved.form } : emptyForm;
  } catch { return emptyForm; }
}

function wordCount(value = "") { return value.trim() ? value.trim().split(/\s+/).length : 0; }

function viewerSuggestion() {
  return localStorage.getItem("news-viewer-name") || "";
}

// Reads natural dimensions of a chosen image so weak covers are rejected
// before they ever reach the server's 960 × 540 usable-crop rule.
function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };
    image.src = url;
  });
}

export default function InternalPublishingScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const pendingCoverRef = useRef(null);
  const coverPreviewRef = useRef("");
  const fileInputRef = useRef(null);

  const totalWords = wordCount(`${form.summary} ${form.body}`);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ form, savedAt: Date.now() })); } catch { /* File objects are not serializable; metadata only. */ }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [form]);

  const patchForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const resetComposer = () => {
    pendingCoverRef.current = null;
    coverPreviewRef.current = "";
    setForm(emptyForm); setProblem(""); setNotice("");
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* no-op */ }
  };

  // Creates the announcement record when needed, then uploads any pending
  // cover. A stale id (for example from a recovered session of a deleted
  // draft) heals by creating fresh instead of failing the save.
  const persistDraft = async () => {
    let recordId = form.id || "";
    const fields = {
      title: form.title,
      summary: form.summary,
      body: form.body,
      author: form.author,
      category: "Announcement",
      contentType: "announcement",
    };
    if (recordId) {
      try {
        await updateContributionDraft(recordId, fields);
      } catch (error) {
        if (error?.status !== 404) throw error;
        recordId = "";
      }
    }
    if (!recordId) {
      const created = await createContributionDraft(fields);
      recordId = created.id;
    }
    if (pendingCoverRef.current && recordId) {
      const cover = pendingCoverRef.current;
      await uploadContributionCover(recordId, cover.file, 0.5, 0.5);
      pendingCoverRef.current = null;
      patchForm({ id: recordId, coverName: cover.name, coverWidth: cover.width, coverHeight: cover.height, coverVersion: Date.now() });
    } else if (recordId !== form.id) {
      patchForm({ id: recordId });
    }
    return recordId;
  };

  const saveDraft = async () => {
    if (saving) return;
    if (!form.title.trim()) { setProblem("Add a clear title before saving this announcement."); return; }
    setSaving(true); setProblem(""); setNotice("");
    try {
      await persistDraft();
      setNotice("Announcement draft saved on the server. Only you can see it.");
    } catch (error) {
      setProblem(error?.message || "This draft could not be saved. Your text is still in the editor.");
    } finally {
      setSaving(false);
    }
  };

  const sendForApproval = async () => {
    if (sending) return;
    const problems = [];
    if (!form.title.trim()) problems.push("add a clear title");
    if (form.body.trim().length < MIN_BODY_CHARS) problems.push("write the notice body");
    if (problems.length) { setProblem(`Before sending for approval: ${problems.join(" and ")}.`); return; }
    setSending(true); setProblem(""); setNotice("");
    try {
      const recordId = await persistDraft();
      await submitContributionDraft(recordId);
      resetComposer();
      setNotice("Sent to the editorial review desk. It appears on Samsung Internal once an editor approves it.");
    } catch (error) {
      setProblem(error?.message || "The announcement could not be submitted. Your draft is unchanged.");
    } finally {
      setSending(false);
    }
  };

  const ingestFiles = async (incoming) => {
    const selected = [...incoming];
    if (!selected.length || processing) return;
    setProblem(""); setNotice(""); setDragging(false);
    for (const file of selected) {
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name || "");
      try {
        if (isImage) {
          const coverCheck = validateCoverFile(file);
          if (!coverCheck.ok) { setProblem(coverCheck.message); continue; }
          setProcessing({ name: file.name, progress: 40, label: "Checking cover" });
          const { width, height } = await readImageDimensions(file);
          const dimensionCheck = validateCoverDimensions(width, height);
          if (!dimensionCheck.ok) { setProblem(dimensionCheck.message); continue; }
          pendingCoverRef.current = { file, name: file.name, width, height };
          coverPreviewRef.current = URL.createObjectURL(file);
          patchForm({ coverName: file.name, coverWidth: width, coverHeight: height });
          setNotice(`${file.name} is ready as the cover. Covers are optional for announcements.`);
        } else {
          const validation = validateDocumentFile(file);
          if (!validation.ok) { setProblem(validation.message); continue; }
          setProcessing({ name: file.name, progress: 30, label: "Uploading for extraction" });
          const record = await importContributionDocument(file, viewerSuggestion(), "announcement");
          setProcessing({ name: file.name, progress: 90, label: "Preparing editable copy" });
          pendingCoverRef.current = null;
          setForm((current) => ({
            ...current,
            id: record.id,
            title: current.title || record.title,
            summary: current.summary || record.summary,
            body: current.body ? `${current.body}\n\n${record.body}` : record.body,
            sourceMeta: record.sourceDocument
              ? { name: record.sourceDocument.name, size: record.sourceDocument.size, pageCount: record.sourceDocument.pageCount }
              : current.sourceMeta,
            coverName: record.cover?.name || current.coverName,
            coverWidth: record.cover?.width || current.coverWidth,
            coverHeight: record.cover?.height || current.coverHeight,
          }));
          setNotice(`${file.name} was converted into editable copy. Review it before sending for approval.`);
        }
      } catch (error) { setProblem(error?.message || `${file.name} could not be imported.`); }
      finally { setProcessing(null); }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasPendingOrStoredCover = Boolean(form.coverName);

  return (
    <div className="publishing-studio">
      <button className="publishing-back" onClick={() => navigate('/saved/contribute')} type="button">
        <Icon name="chevL" size={15} /> Back to contributions
      </button>
      <header className="publishing-studio-head">
        <div><span className="sense-kicker">Samsung Internal · Announcement desk</span><h1>Post the notice everyone actually reads.</h1><p>Write directly or drop in a PDF or Word memo — extracted copy stays fully editable. Announcements go live on Samsung Internal after an editor approves them.</p></div>
        <div className="publishing-local-note"><Icon name="shield" size={18} /><span><strong>Private until approved</strong>Drafts live on the internal server, visible only to you and the review desk.</span></div>
      </header>

      {(notice || problem) && <div className={`publishing-feedback ${problem ? "is-error" : ""}`} role={problem ? "alert" : "status"}><Icon name={problem ? "warning" : "check2"} size={17} /><span>{problem || notice}</span><button aria-label="Dismiss message" onClick={() => { setNotice(""); setProblem(""); }} type="button"><Icon name="x" size={14} /></button></div>}

      <div className="publishing-workbench">
        <section className="publishing-editor" aria-labelledby="announcement-editor-title">
          <div className="publishing-editor-heading"><div><span>01 · Source</span><h2 id="announcement-editor-title">Bring in the raw material</h2></div><small>{processing ? "Processing" : "Ready"}</small></div>
          <div className={`publishing-dropzone ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); ingestFiles(event.dataTransfer.files); }}>
            <input accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" onChange={(event) => ingestFiles(event.target.files)} ref={fileInputRef} type="file" />
            <span className="publishing-drop-icon"><Icon name="upload" size={23} /></span>
            <div><strong>Drop source files here</strong><p>PDF and Word become editable notice copy. Images become an optional cover.</p></div>
            <button onClick={() => fileInputRef.current?.click()} type="button">Choose files</button>
            <small>PDF up to 25 MB · DOCX, TXT or MD · JPG, PNG or WebP up to 10 MB</small>
          </div>
          {processing && <div className="publishing-progress" aria-live="polite"><div><span>{processing.label}</span><strong>{processing.progress}%</strong></div><i><b style={{ width: `${processing.progress}%` }} /></i><small>{processing.name}</small></div>}
          {(form.sourceMeta || form.coverName) && <div className="publishing-imports" aria-label="Imported material">
            {form.sourceMeta && <span><Icon name="file" size={14} /><b>{form.sourceMeta.name}</b><small>{formatFileSize(form.sourceMeta.size)}{form.sourceMeta.pageCount ? ` · ${form.sourceMeta.pageCount} pages` : ""}</small><button aria-label={`Remove ${form.sourceMeta.name}`} onClick={() => patchForm({ sourceMeta: null })} type="button"><Icon name="x" size={12} /></button></span>}
            {form.coverName && <span><Icon name="eye" size={14} /><b>{form.coverName}</b><small>Cover · optional</small><button aria-label={`Remove ${form.coverName}`} onClick={() => { pendingCoverRef.current = null; coverPreviewRef.current = ""; patchForm({ coverName: "", coverWidth: 0, coverHeight: 0 }); }} type="button"><Icon name="x" size={12} /></button></span>}
          </div>}
          <div className="publishing-editor-heading is-copy"><div><span>02 · Shape</span><h2>Make it clear and useful</h2></div><small>{totalWords} words</small></div>
          <label className="publishing-field"><span>Headline</span><input maxLength={CONTRIBUTION_LIMITS.TITLE_MAX} onChange={(event) => patchForm({ title: event.target.value })} placeholder="What is happening, in one line" value={form.title} /><small>{form.title.length}/{CONTRIBUTION_LIMITS.TITLE_MAX}</small></label>
          <label className="publishing-field"><span>Key details</span><textarea maxLength={CONTRIBUTION_LIMITS.SUMMARY_MAX} onChange={(event) => patchForm({ summary: event.target.value })} placeholder="Dates, places, actions needed — what a busy reader must know?" rows={4} value={form.summary} /><small>{form.summary.length}/{CONTRIBUTION_LIMITS.SUMMARY_MAX}</small></label>
          <label className="publishing-field"><span>Full notice</span><textarea onChange={(event) => patchForm({ body: event.target.value })} placeholder="Write here or import a document above…" rows={13} value={form.body} /></label>
          <label className="publishing-field"><span>Issued by</span><input onChange={(event) => patchForm({ author: event.target.value })} placeholder="Team, function or author" value={form.author} /></label>
          <footer className="publishing-editor-actions"><button disabled={saving || sending} onClick={resetComposer} type="button">Clear</button><span>Work is recovered during this browser session.</span><button disabled={saving || sending || Boolean(processing)} onClick={saveDraft} type="button">{saving ? "Saving…" : "Save draft"}</button><button disabled={saving || sending || Boolean(processing)} onClick={sendForApproval} type="button">{sending ? "Sending…" : "Send for approval"} <Icon name="chevR" size={14} /></button></footer>
        </section>

        <aside className="publishing-live-preview" aria-label="Live Samsung Internal preview">
          <header><div><span>03 · Preview</span><strong>Samsung Internal card</strong></div><i>Live</i></header>
          <article className={hasPendingOrStoredCover ? "has-image" : ""}>
            {hasPendingOrStoredCover && coverPreviewRef.current
              ? <img alt="Selected announcement cover preview" src={coverPreviewRef.current} />
              : hasPendingOrStoredCover && form.id
                ? <img alt="Announcement cover" src={`/internal-content/${form.id}/cover?v=${form.coverVersion || 0}`} />
                : <div className="publishing-preview-art"><span>S</span><i /><i /></div>}
            <div className="publishing-preview-copy"><span>Announcement</span><h2>{form.title || "Your headline will appear here"}</h2><p>{form.summary || "Add the key details readers need — dates, places and the action they should take."}</p><footer><small>{form.author || "Internal announcements"}</small><button tabIndex={-1} type="button">Read notice <Icon name="chevR" size={13} /></button></footer></div>
          </article>
          <div className="publishing-readiness"><strong>Publishing readiness</strong><span className={form.title ? "done" : ""}><Icon name={form.title ? "check2" : "clock"} size={14} /> Clear headline</span><span className={form.summary ? "done" : ""}><Icon name={form.summary ? "check2" : "clock"} size={14} /> Key details</span><span className={form.body.trim().length >= MIN_BODY_CHARS ? "done" : ""}><Icon name={form.body.trim().length >= MIN_BODY_CHARS ? "check2" : "clock"} size={14} /> Full notice</span><span><Icon name="clock" size={14} /> Cover visual <small>optional</small></span></div>
        </aside>
      </div>
    </div>
  );
}
