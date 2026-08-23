import React, { useState } from 'react';
import Icon from '../Icon.jsx';
import {
  CATEGORY_SUGGESTIONS,
  CONTRIBUTION_CONTENT_TYPES,
  CONTRIBUTION_LIMITS,
  canSubmitContribution,
} from '../../internal/contributionModel.js';
import { formatBytes } from './CoverImageInput.jsx';
import CoverImageInput from './CoverImageInput.jsx';
import ContributionPreview from './ContributionPreview.jsx';
import LeadershipCarouselPreview from './LeadershipCarouselPreview.jsx';

const CATEGORY_LIST_ID = 'cw-category-suggestions';

export default function ContributionEditor({
  draft,
  onChange,
  onSave,
  onSubmit,
  onBack,
  onCancel,
  saving = false,
  submitting = false,
  busy = false,
}) {
  const [previewing, setPreviewing] = useState(false);
  const [problems, setProblems] = useState([]);
  const gate = canSubmitContribution(draft);

  const update = (patch) => {
    setProblems([]);
    onChange({ ...draft, ...patch });
  };

  const attemptSubmit = () => {
    if (!gate.ok) {
      setProblems(gate.problems);
      return;
    }
    setProblems([]);
    onSubmit();
  };

  return (
    <div className="cw-editor">
      <div className="cw-editor-head">
        <button className="btn-dark-secondary" onClick={onBack} type="button">
          <Icon name="chevL" size={14} /> Your contributions
        </button>
        <div className="cw-editor-viewtoggle" role="group" aria-label="Editor view">
          <button aria-pressed={!previewing} className={previewing ? '' : 'active'} onClick={() => setPreviewing(false)} type="button">
            <Icon name="note" size={14} /> Edit
          </button>
          <button aria-pressed={previewing} className={previewing ? 'active' : ''} onClick={() => setPreviewing(true)} type="button">
            <Icon name="eye" size={14} /> Preview
          </button>
        </div>
      </div>

      {previewing ? (
        draft.contentType === CONTRIBUTION_CONTENT_TYPES.LEADERSHIP ? (
          <LeadershipCarouselPreview draft={draft} onChange={onChange} />
        ) : (
          <ContributionPreview contribution={draft} />
        )
      ) : (
        <>
          {draft.sourceDocument && (
            <p className="cw-source-doc">
              <Icon name="file" size={15} />
              <span><strong>Original document</strong> {draft.sourceDocument.name}</span>
              <small>{formatBytes(draft.sourceDocument.size)} · {draft.sourceDocument.type}
                {draft.sourceDocument.pageCount ? ` · ${draft.sourceDocument.pageCount} pages` : ''}
                {draft.sourceDocument.extractedCharacters ? ` · ${draft.sourceDocument.extractedCharacters.toLocaleString()} characters extracted` : ''}
              </small>
            </p>
          )}

          <CoverImageInput disabled={busy} onChange={(cover) => update({ cover })} value={draft.cover} />

          <label className="cw-field">
            <span>Title <small>{draft.title.length}/{CONTRIBUTION_LIMITS.TITLE_MAX}</small></span>
            <input
              disabled={busy}
              maxLength={CONTRIBUTION_LIMITS.TITLE_MAX}
              onChange={(event) => update({ title: event.target.value })}
              placeholder="A clear headline for the story"
              value={draft.title}
            />
          </label>

          <label className="cw-field">
            <span>Short summary <small>{draft.summary.length}/{CONTRIBUTION_LIMITS.SUMMARY_MAX}</small></span>
            <textarea
              disabled={busy}
              maxLength={CONTRIBUTION_LIMITS.SUMMARY_MAX}
              onChange={(event) => update({ summary: event.target.value })}
              placeholder="Why should a busy colleague open this story?"
              rows={3}
              value={draft.summary}
            />
          </label>

          <label className="cw-field">
            <span>Body <small>{draft.body.length.toLocaleString()}/{CONTRIBUTION_LIMITS.BODY_MAX.toLocaleString()} characters</small></span>
            <textarea
              className="cw-body-input"
              disabled={busy}
              maxLength={CONTRIBUTION_LIMITS.BODY_MAX}
              onChange={(event) => update({ body: event.target.value })}
              placeholder="Write the full story here, or import a document to convert its text into this editable draft."
              rows={16}
              value={draft.body}
            />
            <small className="cw-hint">Paragraph line breaks are preserved. Imported text stays fully editable.</small>
          </label>

          <div className="cw-field-row">
            <label className="cw-field">
              <span>Category <small>optional</small></span>
              <input
                disabled={busy}
                list={CATEGORY_LIST_ID}
                onChange={(event) => update({ category: event.target.value })}
                placeholder="General"
                value={draft.category}
              />
            </label>
            <label className="cw-field">
              <span>Team / department</span>
              <input
                disabled={busy}
                onChange={(event) => update({ team: event.target.value })}
                placeholder="e.g. Display Research"
                value={draft.team}
              />
            </label>
            <label className="cw-field">
              <span>Author</span>
              <input
                disabled={busy}
                onChange={(event) => update({ author: event.target.value })}
                placeholder="Your name"
                value={draft.author}
              />
            </label>
          </div>
          <datalist id={CATEGORY_LIST_ID}>
            {CATEGORY_SUGGESTIONS.map((category) => <option key={category} value={category} />)}
          </datalist>
        </>
      )}

      <div aria-live="assertive">
        {(problems.length > 0 || !gate.ok) && (
          <div className="cw-problems" role="alert">
            <strong>{problems.length ? 'Before this can be submitted:' : 'Submission needs:'}</strong>
            <ul>
              {(problems.length ? problems : gate.problems).map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          </div>
        )}
      </div>

      <footer className="cw-editor-actions">
        {onCancel && (
          <button className="btn-dark-secondary" onClick={onCancel} type="button">Discard</button>
        )}
        <span className="cw-actions-note">Drafts stay in this browser until the internal backend is connected.</span>
        <div className="cw-action-buttons">
          <button className="btn-dark-secondary" disabled={busy || saving} onClick={onSave} type="button">
            <Icon name="check2" size={14} /> {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button className="btn-dark-primary" disabled={busy || submitting} onClick={attemptSubmit} type="button">
            <Icon name="sparkle" size={14} /> {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </footer>
    </div>
  );
}
