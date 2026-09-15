import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  createContributionDraft,
  deleteContributionCover,
  deleteContributionRecord,
  getAccessCapabilities,
  getContributionAccess,
  getMyContributions,
  getOwnedContribution,
  importContributionDocument,
  submitContributionDraft,
  updateContributionDraft,
  uploadContributionCover,
  withdrawContribution,
} from '../news-scrapper/api.js';
import {
  validateCoverDimensions,
  validateCoverFile,
} from '../news-scrapper/internal/contributionModel.js';
import { validateDocumentFile } from '../news-scrapper/internal/documentParser.js';
import { coverReady, isEditableStatus, validateCreateSubmit } from './createModel.js';
import useAutoDismiss from './shared/useAutoDismiss.js';
import CreateNewsDrafts from './create-news/CreateNewsDrafts.jsx';
import CreateNewsLanding from './create-news/CreateNewsLanding.jsx';
import CreateNewsPreview from './create-news/CreateNewsPreview.jsx';
import CreateNewsStoryEditor from './create-news/CreateNewsStoryEditor.jsx';
import OriginalDocumentPreview from './create-news/OriginalDocumentPreview.jsx';
import SriCreateOptions from './create-news/SriCreateOptions.jsx';
import UrlStoryImporter from './create-news/UrlStoryImporter.jsx';
import {
  blankCreateForm,
  cleanCreateSnapshot,
  contributionFromBriefing,
  formFromContribution,
} from './create-news/createNewsModel.js';
import './create-news/create-news.css';

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
      reject(new Error('This image could not be read.'));
    };
    image.src = url;
  });
}

function contributionType(record) {
  return record?.contentType === 'leadership'
    ? 'leadership'
    : record?.contentType === 'announcement'
      ? 'announcement'
      : 'story';
}

export default function SamparkCreate({
  initialAccess = null,
  initialItems = null,
  initialView = 'landing',
  onDirtyChange,
}) {
  const location = useLocation();
  const [view, setView] = useState(initialView);
  const [contentType, setContentType] = useState('story');
  const [form, setForm] = useState(() => blankCreateForm('story'));
  const [cleanSnapshot, setCleanSnapshot] = useState(() => cleanCreateSnapshot(blankCreateForm('story')));
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [coverMeta, setCoverMeta] = useState({ width: 0, height: 0 });
  const [sourceDocument, setSourceDocument] = useState(null);
  const [recordStatus, setRecordStatus] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processingDocument, setProcessingDocument] = useState(false);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [access, setAccess] = useState(initialAccess);
  const [capabilities, setCapabilities] = useState([]);
  const [myItems, setMyItems] = useState(initialItems || []);
  const [myCount, setMyCount] = useState(initialItems ? initialItems.length : null);
  const [visibleContributions, setVisibleContributions] = useState(10);
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [actingId, setActingId] = useState('');
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const coverPreviewRef = useRef('');
  const pageRef = useRef(null);

  useAutoDismiss(notice || problem, () => { setNotice(''); setProblem(''); });

  useEffect(() => { coverPreviewRef.current = coverPreview; }, [coverPreview]);
  useEffect(() => {
    pageRef.current?.closest('.sampark-create-modal-body')?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => () => {
    if (coverPreviewRef.current.startsWith('blob:')) URL.revokeObjectURL(coverPreviewRef.current);
  }, []);

  const refreshMyItems = async () => {
    try {
      const items = await getMyContributions();
      setMyItems(items);
      setMyCount(items.length);
    } catch {
      setMyItems([]);
      setMyCount(0);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (initialAccess === null) {
      getContributionAccess()
        .then((result) => { if (!cancelled) setAccess(result); })
        .catch(() => { if (!cancelled) setAccess({ allowed: false }); });
    }
    getAccessCapabilities()
      .then((result) => { if (!cancelled) setCapabilities(result?.capabilities || []); })
      .catch(() => {});
    if (initialItems === null) refreshMyItems();
    return () => { cancelled = true; };
    // Initial server reads only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetEditor = (nextType = 'story') => {
    const nextForm = blankCreateForm(nextType);
    if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    setContentType(nextType);
    setForm(nextForm);
    setCleanSnapshot(cleanCreateSnapshot(nextForm));
    setCoverFile(null);
    setCoverPreview('');
    setCoverMeta({ width: 0, height: 0 });
    setSourceDocument(null);
    setRecordStatus('');
    setReviewNote('');
    setProblem('');
  };

  const openRecord = (record) => {
    const nextType = contributionType(record);
    const nextForm = formFromContribution(record);
    const nextCover = record.cover?.url || '';
    if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    setContentType(nextType);
    setForm(nextForm);
    setCleanSnapshot(cleanCreateSnapshot(nextForm, nextCover));
    setCoverFile(null);
    setCoverPreview(nextCover);
    setCoverMeta({ width: record.cover?.width || 0, height: record.cover?.height || 0 });
    setSourceDocument(record.sourceDocument || null);
    setRecordStatus(record.status || 'draft');
    setReviewNote(record.reviewNote || '');
    setProblem('');
    setNotice(record.status === 'needs_changes' && record.reviewNote ? `Reviewer feedback: ${record.reviewNote}` : '');
    setView('composer');
  };

  useEffect(() => {
    const openId = new URLSearchParams(location.search || '').get('open');
    if (!openId) return;
    getOwnedContribution(openId)
      .then(openRecord)
      .catch((error) => setProblem(error?.message || 'That draft could not be opened.'));
    // React to deep-link changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const currentSnapshot = useMemo(
    () => cleanCreateSnapshot(form, coverPreview),
    [form, coverPreview],
  );
  const isDirty = Boolean(coverFile) || JSON.stringify(currentSnapshot) !== JSON.stringify(cleanSnapshot);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const hasCreate = access?.allowed || capabilities.includes('contributions.create');
  const isEditable = isEditableStatus(recordStatus, form.id);
  const hasCover = Boolean(coverFile || coverPreview);
  const coverRequired = contentType !== 'announcement';
  const patch = (next) => setForm((current) => ({ ...current, ...next }));

  const beginComposer = (nextType) => {
    resetEditor(nextType);
    setNotice('');
    setView('composer');
  };

  const confirmLeaveEditor = () => !isDirty || window.confirm('Discard the unsaved changes in this story?');
  const leaveEditor = () => {
    if (!confirmLeaveEditor()) return;
    resetEditor('story');
    refreshMyItems();
    setView('sri-options');
  };

  const handleCover = async (file) => {
    if (!file || !isEditable) return;
    const fileCheck = validateCoverFile(file);
    if (!fileCheck.ok) { setProblem(fileCheck.message); return; }
    try {
      const dimensions = await readImageDimensions(file);
      const dimensionCheck = validateCoverDimensions(dimensions.width, dimensions.height);
      if (!dimensionCheck.ok) { setProblem(dimensionCheck.message); return; }
      if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverFile(file);
      setCoverMeta(dimensions);
      setCoverPreview(URL.createObjectURL(file));
      setProblem('');
      setNotice(`${file.name} is ready as the cover image.`);
    } catch (error) {
      setProblem(error?.message || 'The cover image could not be read.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDocumentImport = async (file) => {
    if (!file || processingDocument || !isEditable || form.id) return;
    const check = validateDocumentFile(file);
    if (!check.ok) { setProblem(check.message); return; }
    setProcessingDocument(true);
    setProblem('');
    setNotice('');
    try {
      const record = await importContributionDocument(
        file,
        form.author || window.localStorage.getItem('news-viewer-name') || '',
        'story',
      );
      const imported = {
        ...formFromContribution(record),
        summary: form.summary || record.summary || '',
        category: record.category || form.category || 'General',
        layout: form.layout,
        displaySection: form.displaySection,
      };
      setForm(imported);
      setCleanSnapshot(cleanCreateSnapshot(imported, record.cover?.url || ''));
      setCoverPreview(record.cover?.url || '');
      setCoverMeta({ width: record.cover?.width || 0, height: record.cover?.height || 0 });
      setSourceDocument(record.sourceDocument || null);
      setRecordStatus(record.status || 'draft');
      setNotice(`${file.name} is now editable. Review the extracted copy before submitting.`);
    } catch (error) {
      setProblem(error?.message || `${file.name} could not be imported.`);
    } finally {
      setProcessingDocument(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  };

  const persistDraft = async () => {
    if (!isEditable) throw new Error('This record is read-only in its current state.');
    const fields = { ...form, contentType };
    let record;
    if (form.id) {
      try {
        record = await updateContributionDraft(form.id, fields);
      } catch (error) {
        if (error?.status !== 404) throw error;
        record = await createContributionDraft({ ...fields, id: '' });
      }
    } else {
      record = await createContributionDraft(fields);
    }
    if (coverFile) record = await uploadContributionCover(record.id, coverFile, 0.5, 0.5);
    const savedForm = { ...formFromContribution(record), layout: form.layout, displaySection: form.displaySection };
    const savedCover = record.cover?.url || (coverFile ? coverPreview : '');
    setForm(savedForm);
    setRecordStatus(record.status || 'draft');
    setReviewNote(record.reviewNote || '');
    setSourceDocument(record.sourceDocument || sourceDocument);
    setCoverFile(null);
    setCoverPreview(savedCover);
    setCoverMeta({ width: record.cover?.width || coverMeta.width, height: record.cover?.height || coverMeta.height });
    return { record, savedCover, savedForm };
  };

  const handleSave = async () => {
    if (saving || submitting || !isEditable) return;
    if (!form.title.trim()) { setProblem('Add a clear title before saving.'); return; }
    setSaving(true);
    setProblem('');
    setNotice('');
    try {
      const saved = await persistDraft();
      setCleanSnapshot(cleanCreateSnapshot(saved.savedForm, saved.savedCover));
      await refreshMyItems();
      setNotice('Draft saved. It remains private until you submit it for approval.');
    } catch (error) {
      setProblem(error?.message || 'The draft could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCover = async () => {
    if (!isEditable) return;
    if (coverFile) {
      if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
      setCoverFile(null);
      setCoverPreview('');
      setCoverMeta({ width: 0, height: 0 });
      setNotice('Cover image removed.');
      return;
    }
    if (!form.id || !coverPreview) return;
    try {
      await deleteContributionCover(form.id);
      setCoverPreview('');
      setCoverMeta({ width: 0, height: 0 });
      setCleanSnapshot((current) => ({ ...current, coverPreview: '' }));
      setNotice('Cover image removed.');
      await refreshMyItems();
    } catch (error) {
      setProblem(error?.message || 'The cover image could not be removed.');
    }
  };

  const handleSubmit = async () => {
    if (submitting || saving || !isEditable) return;
    const issues = validateCreateSubmit({
      title: form.title,
      body: form.body,
      coverRequired,
      hasCover: coverReady({ coverRequired, coverFile, coverPreview }),
    });
    if (issues.length) { setProblem(`Before submitting: ${issues.join(' and ')}.`); return; }
    setSubmitting(true);
    setProblem('');
    setNotice('');
    try {
      const saved = await persistDraft();
      await submitContributionDraft(saved.record.id);
      resetEditor('story');
      await refreshMyItems();
      setView('drafts');
      setNotice('Sent to the editorial review desk. You can track it below.');
    } catch (error) {
      setProblem(error?.message || 'The story could not be submitted. Your draft is unchanged.');
    } finally {
      setSubmitting(false);
    }
  };

  const dashboardWithdraw = async (id) => {
    setActingId(id);
    setProblem('');
    setNotice('');
    try {
      await withdrawContribution(id);
      await refreshMyItems();
      setNotice('Submission withdrawn. You can edit it again.');
    } catch (error) {
      setProblem(error?.message || 'The submission could not be withdrawn.');
    } finally {
      setActingId('');
    }
  };

  const dashboardDelete = async (id) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setActingId(id);
    setProblem('');
    setNotice('');
    try {
      await deleteContributionRecord(id);
      setConfirmDeleteId('');
      await refreshMyItems();
      setNotice('Draft deleted.');
    } catch (error) {
      setProblem(error?.message || 'The draft could not be deleted.');
    } finally {
      setActingId('');
    }
  };

  const useGeneratedArticle = (article) => {
    resetEditor('story');
    const imported = contributionFromBriefing(article);
    setForm(imported);
    setCleanSnapshot(cleanCreateSnapshot(blankCreateForm('story')));
    setView('composer');
    setNotice('The generated card is now an editable SRI-D story. Add a cover image before submitting.');
  };

  if (access === null) {
    return <div className="sampark-create-page"><div className="sampark-create-loading" role="status"><span className="sampark-spinner" /> Checking publishing access…</div></div>;
  }
  if (!hasCreate) {
    return <div className="sampark-create-page"><div className="sampark-create-denied" role="alert"><Icon name="shield" size={24} /><h2>Publishing access is required</h2><p>Ask an access administrator if creating SRI-D news is part of your role.</p></div></div>;
  }

  const feedback = (notice || problem) && view !== 'url' ? (
    <div className={`sampark-create-feedback${problem ? ' is-error' : ''}`} role={problem ? 'alert' : 'status'}>
      <Icon name={problem ? 'warning' : 'check2'} size={16} /><span>{problem || notice}</span>
      <button aria-label="Dismiss" onClick={() => { setNotice(''); setProblem(''); }} type="button"><Icon name="x" size={14} /></button>
    </div>
  ) : null;

  const statusBanner = form.id && recordStatus && ['submitted', 'published', 'archived'].includes(recordStatus) ? (
    <div className="sampark-create-feedback" role="status"><Icon name="clock" size={16} /><span>This item is {recordStatus} and read-only here.</span>{recordStatus === 'submitted' && <button className="sampark-create-secondary" onClick={() => dashboardWithdraw(form.id)} type="button">Withdraw</button>}</div>
  ) : null;

  let content;
  if (view === 'sri-options') {
    content = <SriCreateOptions onBack={() => setView('landing')} onChoose={beginComposer} />;
  } else if (view === 'url') {
    content = <UrlStoryImporter onBack={() => setView('landing')} onUseArticle={useGeneratedArticle} />;
  } else if (view === 'drafts') {
    content = <CreateNewsDrafts actingId={actingId} confirmDeleteId={confirmDeleteId} items={myItems.slice(0, visibleContributions)} onBack={() => setView('landing')} onDelete={dashboardDelete} onEdit={openRecord} onMore={() => setVisibleContributions((current) => current + 10)} onWithdraw={dashboardWithdraw} remaining={Math.max(0, myItems.length - visibleContributions)} />;
  } else if (view === 'composer') {
    content = <CreateNewsStoryEditor contentType={contentType} coverMeta={coverMeta} coverPreview={coverPreview} docInputRef={docInputRef} fileInputRef={fileInputRef} form={form} hasCover={hasCover} isEditable={isEditable} onBack={leaveEditor} onChooseCover={handleCover} onImportDocument={handleDocumentImport} onPreview={() => setView('preview')} onPreviewDocument={() => setView('document-preview')} onRemoveCover={handleRemoveCover} onSave={handleSave} patch={patch} processingDocument={processingDocument} saving={saving} sourceDocument={sourceDocument} />;
  } else if (view === 'preview') {
    content = <CreateNewsPreview contentType={contentType} coverUrl={coverPreview} form={form} hasCover={hasCover} isEditable={isEditable} onBack={() => setView('composer')} onSave={handleSave} onSubmit={handleSubmit} saving={saving} submitting={submitting} />;
  } else if (view === 'document-preview') {
    content = <OriginalDocumentPreview body={form.body} onBack={() => setView('composer')} sourceDocument={sourceDocument} />;
  } else {
    content = <CreateNewsLanding draftCount={myCount ?? myItems.length} onChooseSri={() => setView('sri-options')} onChooseUrl={() => setView('url')} onOpenDrafts={() => setView('drafts')} />;
  }

  return <div className="sampark-create-page" ref={pageRef}>{feedback}{statusBanner}{content}</div>;
}
