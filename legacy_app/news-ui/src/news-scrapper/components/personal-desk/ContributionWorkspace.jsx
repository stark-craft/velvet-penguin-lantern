import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon.jsx';
import {
  CONTRIBUTION_CONTENT_TYPES,
  CONTRIBUTION_STATUS,
  contentTypeLabel,
  createContribution,
  statusLabel,
} from '../../internal/contributionModel.js';
import { validateDocumentFile } from '../../internal/documentParser.js';
import {
  createContributionDraft,
  deleteContributionDraft,
  importContributionDocument,
  submitContributionDraft,
  updateContributionDraft,
  uploadContributionCover,
} from '../../api.js';
import { useCoverPreviewSrc } from './CoverImageInput.jsx';
import ContributionEditor from './ContributionEditor.jsx';
import ContributionPreview from './ContributionPreview.jsx';
import useContributions, { notifyContributionsChanged } from './useContributions.js';

const SESSION_KEY = 'personal-desk-contribute-session-v1';
const IMPORT_STEPS = ['Validating document', 'Uploading', 'Extracting text', 'Creating editable draft', 'Ready'];
const DOC_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function CoverThumb({ cover }) {
  const src = useCoverPreviewSrc(cover);
  if (!src) return <span className="cw-thumb cw-thumb-empty" aria-hidden="true"><Icon name="note" size={16} /></span>;
  return <img alt="" className="cw-thumb" src={src} />;
}

function ImportProgress({ state }) {
  const activeIndex = Math.max(0, IMPORT_STEPS.indexOf(state.step));
  return (
    <div className="cw-import-progress" role="status">
      <strong>Importing {state.fileName}</strong>
      <ol>
        {IMPORT_STEPS.map((step, index) => (
          <li className={index < activeIndex ? 'done' : index === activeIndex ? 'active' : ''} key={step}>
            {index < activeIndex ? <Icon name="check2" size={13} /> : null} {step}
          </li>
        ))}
      </ol>
      {state.indeterminate && <small className="cw-hint">Large documents can take a moment. The server extracts the text.</small>}
    </div>
  );
}

export default function ContributionWorkspace({ authorSuggestion = '', autoStart = '' }) {
  const navigate = useNavigate();
  const { contributions, loaded, error: loadError } = useContributions();
  const autoStartConsumed = useRef(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [recoveredDraft, setRecoveredDraft] = useState(null);
  const [importState, setImportState] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const docInputRef = useRef(null);
  const alive = useRef(true);
  const sessionTimer = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // The leadership deep link opens the composer directly, once.
  useEffect(() => {
    if (!autoStart) {
      autoStartConsumed.current = false;
      return;
    }
    if (autoStartConsumed.current || !loaded) return;
    if (editing) return;
    autoStartConsumed.current = true;
    setError('');
    setNotice('');
    setEditing(createContribution({
      contentType: CONTRIBUTION_CONTENT_TYPES.LEADERSHIP,
      category: 'Leadership',
      title: 'Vision of the quarter',
      author: authorSuggestion,
    }));
  }, [autoStart, loaded, editing, authorSuggestion]);

  // Recover interrupted work without hijacking the Contribute landing page.
  // Different browsers have different session state, so silently reopening an
  // editor made Chrome and the in-app browser appear to run different builds.
  // The landing page now offers the recovered draft explicitly instead.
  useEffect(() => {
    try {
      const restored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
      if (restored?.draft?.contentType) {
        const draft = createContribution(restored.draft);
        if (draft.cover && !draft.cover.url) draft.cover = null;
        setRecoveredDraft(draft);
      }
    } catch {
      // A damaged session draft is discarded; the landing view stays usable.
    }
    return () => { window.clearTimeout(sessionTimer.current); };
  }, []);

  useEffect(() => {
    window.clearTimeout(sessionTimer.current);
    if (!editing) return undefined;
    sessionTimer.current = window.setTimeout(() => {
      try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ draft: editing, savedAt: Date.now() })); } catch { /* File objects are not serializable; metadata only */ }
    }, 400);
    return () => window.clearTimeout(sessionTimer.current);
  }, [editing]);

  const startStory = () => {
    setRecoveredDraft(null);
    setError('');
    setNotice('');
    setEditing(createContribution({
      contentType: CONTRIBUTION_CONTENT_TYPES.STORY,
      author: authorSuggestion,
    }));
  };

  const startLeadership = () => {
    // This click owns the transition; mark the route-triggered fallback as
    // consumed so the same draft is not opened a second time.
    autoStartConsumed.current = true;
    setRecoveredDraft(null);
    setError('');
    setNotice('');
    setEditing(createContribution({
      contentType: CONTRIBUTION_CONTENT_TYPES.LEADERSHIP,
      category: 'Leadership',
      title: 'Vision of the quarter',
      author: authorSuggestion,
    }));
    navigate('/for-you/contributions/leadership', { replace: true });
  };

  const startAnnouncement = () => {
    setError('');
    setNotice('');
    // Announcements are authored in the dedicated studio, which owns the
    // premium source-to-preview workflow and its optional-cover pipeline.
    navigate('/internal-publishing');
  };

  const importDocument = async (file) => {
    if (!file || importState) return;
    setError('');
    setNotice('');
    // Client-side checks give instant feedback; the server re-validates and
    // performs the real extraction.
    const validation = validateDocumentFile(file);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setImportState({ fileName: file.name, step: IMPORT_STEPS[0], indeterminate: false });
    window.setTimeout(() => {
      if (alive.current) setImportState({ fileName: file.name, step: IMPORT_STEPS[1], indeterminate: false });
    }, 150);
    try {
      const record = await importContributionDocument(file, authorSuggestion);
      if (!alive.current) return;
      setImportState({ fileName: file.name, step: IMPORT_STEPS[3], indeterminate: false });
      setRecoveredDraft(null);
      setEditing(record);
      notifyContributionsChanged();
      setNotice(`${file.name} was converted into an editable draft. Review it before submitting.`);
    } catch (importError) {
      setError(importError?.message || `${file.name} could not be imported.`);
    } finally {
      if (alive.current) setImportState(null);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  // Creates the backend record when needed, then uploads any pending cover.
  // Returns the fully stored record for submit to reuse. A stale id (recovered
  // session from before this record existed, or another viewer identity) heals
  // by creating fresh instead of failing the save.
  const persistEditing = async (draft) => {
    let stored = null;
    if (draft.id) {
      try {
        stored = await updateContributionDraft(draft.id, draft);
      } catch (updateError) {
        if (updateError?.status !== 404) throw updateError;
        stored = null;
      }
    }
    if (!stored) stored = await createContributionDraft(draft);
    if (draft.cover?.pendingFile && stored.id) {
      stored = await uploadContributionCover(
        stored.id,
        draft.cover.pendingFile,
        draft.cover.focalX ?? 0.5,
        draft.cover.focalY ?? 0.5,
      );
    }
    notifyContributionsChanged();
    return stored;
  };

  const saveDraft = async () => {
    if (saving || !editing) return;
    setSaving(true);
    setError('');
    try {
      const stored = await persistEditing(editing);
      setEditing(stored);
      setNotice('Draft saved on the server.');
    } catch (saveError) {
      setError(saveError?.message || 'This draft could not be saved. Your text is still in the editor.');
    } finally {
      setSaving(false);
    }
  };

  const submitContribution = async () => {
    if (submitting || !editing) return;
    setSubmitting(true);
    setError('');
    try {
      const stored = await persistEditing(editing);
      const submitted = await submitContributionDraft(stored.id);
      window.sessionStorage.removeItem(SESSION_KEY);
      setEditing(null);
      notifyContributionsChanged();
      setNotice(`Contribution submitted.${submitted.title ? ` “${submitted.title}”` : ''}`);
    } catch (submitError) {
      setError(submitError?.message || 'The contribution could not be submitted. Your draft is unchanged.');
    } finally {
      setSubmitting(false);
    }
  };

  const removeDraft = async (record) => {
    const confirmed = window.confirm(`Delete the draft “${record.title || 'Untitled'}”? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await deleteContributionDraft(record.id);
      if (viewing?.id === record.id) setViewing(null);
      if (editing?.id === record.id) {
        setEditing(null);
        window.sessionStorage.removeItem(SESSION_KEY);
      }
      notifyContributionsChanged();
      setNotice('Draft deleted.');
    } catch (deleteError) {
      setError(deleteError?.message || 'This record could not be deleted.');
    }
  };

  const backToList = () => {
    // Prevent the still-current leadership address from reopening the
    // composer during the same batched navigation render.
    autoStartConsumed.current = true;
    if (editing) setRecoveredDraft(createContribution(editing));
    setEditing(null);
    setViewing(null);
    setError('');
    setNotice('');
    navigate('/for-you/contributions', { replace: true });
  };

  const resumeRecoveredDraft = () => {
    if (!recoveredDraft) return;
    setError('');
    setNotice('');
    setEditing(createContribution(recoveredDraft));
    setRecoveredDraft(null);
  };

  const discardRecoveredDraft = () => {
    if (!window.confirm('Discard the recovered browser draft? A server-saved copy, if one exists, will stay in Your contributions.')) return;
    setRecoveredDraft(null);
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* no-op */ }
  };

  const draftsCount = contributions.filter((record) => record.status !== CONTRIBUTION_STATUS.SUBMITTED).length;
  const submittedCount = contributions.filter((record) => record.status === CONTRIBUTION_STATUS.SUBMITTED).length;

  if (importState) {
    return (
      <div className="cw-workspace">
        <ImportProgress state={importState} />
      </div>
    );
  }

  if (viewing) {
    return (
      <div className="cw-workspace">
        <div className="cw-editor-head">
          <button className="btn-dark-secondary" onClick={backToList} type="button">
            <Icon name="chevL" size={14} /> Your contributions
          </button>
          <span className={`cw-status-pill is-${viewing.status}`}>{statusLabel(viewing.status)}</span>
        </div>
        {viewing.status !== CONTRIBUTION_STATUS.SUBMITTED && (
          <button
            className="btn-dark-primary"
            onClick={() => { setEditing(createContribution(viewing)); setViewing(null); }}
            type="button"
          >
            <Icon name="note" size={14} /> Continue editing
          </button>
        )}
        <ContributionPreview contribution={viewing} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="cw-workspace">
        {error && <div className="cw-alert" role="alert"><Icon name="warning" size={15} /> {error}</div>}
        {notice && <p className="cw-note" role="status">{notice}</p>}
        <ContributionEditor
          busy={Boolean(importState)}
          draft={editing}
          onBack={backToList}
          onSave={saveDraft}
          onSubmit={submitContribution}
          saving={saving}
          submitting={submitting}
          onChange={setEditing}
        />
      </div>
    );
  }  return (
    <div className="cw-workspace">
      <input
        accept={DOC_ACCEPT}
        className="sr-only"
        disabled={Boolean(importState)}
        id="cw-document-input"
        onChange={(event) => importDocument(event.target.files?.[0])}
        ref={docInputRef}
        type="file"
      />
      {(error || loadError) && <div className="cw-alert" role="alert"><Icon name="warning" size={15} /> {error || loadError}</div>}
      {notice && <p className="cw-note" role="status">{notice}</p>}
      {recoveredDraft && (
        <section className="cw-recovery" aria-label="Recovered contribution draft">
          <span aria-hidden="true"><Icon name="refresh" size={18} /></span>
          <div>
            <strong>A previous draft is waiting</strong>
            <p>{recoveredDraft.title?.trim() || 'Untitled contribution'} · Continue when you are ready.</p>
          </div>
          <button className="btn-dark-primary" onClick={resumeRecoveredDraft} type="button">Resume draft</button>
          <button className="btn-dark-secondary" onClick={discardRecoveredDraft} type="button">Discard recovery</button>
        </section>
      )}

      <section aria-label="Start a contribution" className="cw-choices">
        <div className="cw-choice-copy">
          <span className="eyebrow">Contribute to Samsung Internal</span>
          <h2>Three ways to begin.</h2>
          <p>Write from scratch or bring in a document, then shape everything in one editable story workspace. Your drafts stay visible only to you.</p>
        </div>
        <div
          className="cw-choice"
          onDragEnter={(event) => event.preventDefault()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); importDocument(event.dataTransfer.files?.[0]); }}
        >
          <span aria-hidden="true"><Icon name="note" size={22} /></span>
          <h3>Write a story</h3>
          <p>Begin with your own words, or import a PDF or DOCX and continue in the same editable story draft.</p>
          <div className="cw-choice-actions">
            <button className="btn-dark-primary" onClick={startStory} type="button">Start from blank</button>
            <button className="btn-dark-secondary" disabled={Boolean(importState)} onClick={() => docInputRef.current?.click()} type="button">
              <Icon name="upload" size={14} /> Import PDF / DOCX
            </button>
          </div>
          <small>Up to 25 MB · 100 pages · .doc not supported</small>
        </div>
        <div className="cw-choice">
          <span aria-hidden="true"><Icon name="star" size={22} /></span>
          <h3>Leadership message</h3>
          <p>Rehearse the vision live inside the Samsung Internal carousel, portrait included.</p>
          <button className="btn-dark-secondary" onClick={startLeadership} type="button">Compose the message</button>
        </div>
        <div className="cw-choice">
          <span aria-hidden="true"><Icon name="megaphone" size={22} /></span>
          <h3>Post an announcement</h3>
          <p>HR notices, town halls, policy updates — published announcements land on the Samsung Internal board.</p>
          <button className="btn-dark-secondary" onClick={startAnnouncement} type="button">Write the notice</button>
        </div>
      </section>

      <section aria-label="Your contributions" className="cw-list-section">
        <header className="personal-section-head">
          <div><span className="eyebrow">{draftsCount} drafts · {submittedCount} submitted</span><h2>Your contributions</h2></div>
        </header>
        {!loaded ? (
          <p className="cw-empty-hint">Loading your contributions…</p>
        ) : !contributions.length ? (
          <p className="cw-empty-hint">
            Nothing here yet. Start a story above — blank and imported drafts appear here with their status.
          </p>
        ) : (
          <ul className="cw-list">
            {contributions.map((record) => (
              <li className="cw-item" key={record.id}>
                <CoverThumb cover={record.cover} />
                <div className="cw-item-copy">
                  <span className="cw-item-kind">{contentTypeLabel(record.contentType)}</span>
                  <strong>{record.title?.trim() || 'Untitled contribution'}</strong>
                  <small>
                    Updated {new Date(record.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {record.submittedAt ? ` · Submitted ${new Date(record.submittedAt).toLocaleDateString()}` : ''}
                  </small>
                </div>
                <span className={`cw-status-pill is-${record.status}`}>{statusLabel(record.status)}</span>
                <div className="cw-item-actions">
                  {record.status === CONTRIBUTION_STATUS.SUBMITTED ? (
                    <button className="btn-dark-secondary" onClick={() => { setViewing(record); setNotice(''); setError(''); }} type="button">
                      View
                    </button>
                  ) : (
                    <button className="btn-dark-secondary" onClick={() => { setEditing(createContribution(record)); setNotice(''); setError(''); }} type="button">
                      Continue editing
                    </button>
                  )}
                  {record.status !== CONTRIBUTION_STATUS.SUBMITTED && (
                    <button aria-label={`Delete draft ${record.title || 'Untitled'}`} className="cw-icon-button" onClick={() => removeDraft(record)} type="button">
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
