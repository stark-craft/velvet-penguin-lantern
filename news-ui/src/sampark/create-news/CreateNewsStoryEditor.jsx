import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { CONTRIBUTION_LIMITS } from '../../news-scrapper/internal/contributionModel.js';
import DocumentImportPanel from './DocumentImportPanel.jsx';
import { STORY_TEMPLATES } from './createNewsModel.js';

function TemplateThumbnail({ layout }) {
  return (
    <span className={`sampark-create-template-thumb is-${layout}`} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export default function CreateNewsStoryEditor({
  contentType,
  coverMeta,
  coverPreview,
  docInputRef,
  fileInputRef,
  form,
  hasCover,
  isEditable,
  onBack,
  onChooseCover,
  onImportDocument,
  onPreview,
  onPreviewDocument,
  onRemoveCover,
  onSave,
  patch,
  processingDocument,
  saving,
  sourceDocument,
}) {
  const isStory = contentType === 'story';
  const isLeadership = contentType === 'leadership';
  const title = isLeadership ? 'Leadership Message' : contentType === 'announcement' ? 'Announcement' : 'Create Story';
  const coverRequired = contentType !== 'announcement';

  return (
    <div className="sampark-create-composer">
      <div className="sampark-create-composer-top">
        <button className="sampark-create-text-back" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Create for SRI-D</button>
        <div><span className="sampark-create-eyebrow">SRI-D publishing</span><h1>{title}</h1></div>
      </div>

      {isStory && (
        <DocumentImportPanel
          disabled={Boolean(form.id)}
          fileInputRef={docInputRef}
          onChoose={onImportDocument}
          onPreview={onPreviewDocument}
          processing={processingDocument}
          sourceDocument={sourceDocument}
        />
      )}

      <div className={`sampark-create-editor-layout${isStory ? '' : ' is-single'}`}>
        {isStory && (
          <aside className="sampark-create-template-rail" aria-label="Choose template">
            <div className="sampark-create-rail-head"><span>Choose Template</span><small>Preview layout</small></div>
            <div className="sampark-create-template-list">
              {STORY_TEMPLATES.map((template) => (
                <button
                  aria-pressed={form.layout === template.id}
                  className={form.layout === template.id ? 'is-active' : ''}
                  disabled={!isEditable}
                  key={template.id}
                  onClick={() => patch({ layout: template.id })}
                  type="button"
                >
                  <TemplateThumbnail layout={template.id} />
                  <span><strong>{template.label}</strong><small>{template.description}</small></span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="sampark-create-form" aria-label={`${title} editor`}>
          <fieldset className="sampark-create-section-choice" disabled={!isEditable || !isStory}>
            <legend>Choose Display Section</legend>
            <p>{isStory ? 'Choose the presentation you want the review desk to consider.' : 'This format uses its established SRI-D placement.'}</p>
            <div>
              <label className={form.displaySection === 'hero' ? 'is-selected' : ''}>
                <input checked={form.displaySection === 'hero'} name="create-display-section" onChange={() => patch({ displaySection: 'hero' })} type="radio" />
                <span><Icon name="star" size={15} /><strong>Hero Banner</strong></span>
              </label>
              <label className={form.displaySection === 'srid' ? 'is-selected' : ''}>
                <input checked={form.displaySection === 'srid'} name="create-display-section" onChange={() => patch({ displaySection: 'srid' })} type="radio" />
                <span><Icon name="layers" size={15} /><strong>SRI-D News</strong></span>
              </label>
            </div>
          </fieldset>

          <label className="sampark-create-field">
            <span>News title <small>{form.title.length}/{CONTRIBUTION_LIMITS.TITLE_MAX}</small></span>
            <input maxLength={CONTRIBUTION_LIMITS.TITLE_MAX} disabled={!isEditable} onChange={(event) => patch({ title: event.target.value })} placeholder={isLeadership ? 'A clear leadership message' : contentType === 'announcement' ? 'What is happening, in one line' : 'Enter a clear, specific headline'} value={form.title} />
          </label>

          <label className="sampark-create-field">
            <span>Short description <small>{form.summary.length}/{CONTRIBUTION_LIMITS.SUMMARY_MAX}</small></span>
            <textarea maxLength={CONTRIBUTION_LIMITS.SUMMARY_MAX} disabled={!isEditable} onChange={(event) => patch({ summary: event.target.value })} placeholder="Give readers the essential context." rows={3} value={form.summary} />
          </label>

          <label className="sampark-create-field">
            <span>{isLeadership ? 'Message' : contentType === 'announcement' ? 'Announcement details' : 'Full story'} <small>{form.body.length.toLocaleString()}/{CONTRIBUTION_LIMITS.BODY_MAX.toLocaleString()}</small></span>
            <textarea maxLength={CONTRIBUTION_LIMITS.BODY_MAX} disabled={!isEditable} onChange={(event) => patch({ body: event.target.value })} placeholder={sourceDocument ? 'Review and edit the extracted copy…' : 'Write the complete story here…'} rows={11} value={form.body} />
          </label>

          <div className="sampark-create-form-row">
            <label className="sampark-create-field"><span>Category</span><select disabled={!isEditable} onChange={(event) => patch({ category: event.target.value })} value={form.category}><option>General</option><option>Leadership</option><option>Announcement</option><option>Technology</option><option>People &amp; Culture</option><option>Business</option><option>Sustainability</option></select></label>
            <label className="sampark-create-field"><span>Author</span><input disabled={!isEditable} onChange={(event) => patch({ author: event.target.value })} placeholder="Author name" value={form.author} /></label>
            <label className="sampark-create-field"><span>Team</span><input disabled={!isEditable} onChange={(event) => patch({ team: event.target.value })} placeholder="Team or function" value={form.team} /></label>
          </div>

          <section className="sampark-create-image-panel">
            <div className="sampark-create-image-heading"><div><strong>Cover image {coverRequired && <em>Required</em>}</strong><p>JPG, PNG or WebP · 10 MB maximum · 16:9 crop</p></div>{hasCover && <span>{coverMeta.width ? `${coverMeta.width} × ${coverMeta.height}` : 'Ready'}</span>}</div>
            <input ref={fileInputRef} accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="sr-only" onChange={(event) => onChooseCover(event.target.files?.[0])} type="file" />
            {hasCover ? (
              <div className="sampark-create-image-preview">
                <img alt="Selected cover preview" src={coverPreview} />
                <div><button className="sampark-create-secondary" disabled={!isEditable} onClick={() => fileInputRef.current?.click()} type="button">Replace image</button><button className="sampark-create-link-danger" disabled={!isEditable} onClick={onRemoveCover} type="button">Remove</button></div>
              </div>
            ) : (
              <button className="sampark-create-image-drop" disabled={!isEditable} onClick={() => fileInputRef.current?.click()} type="button"><Icon name="upload" size={20} /><strong>Choose cover image</strong><small>Use a high-resolution landscape image</small></button>
            )}
          </section>
        </section>
      </div>

      <footer className="sampark-create-sticky-footer">
        <button className="sampark-create-secondary" onClick={onBack} type="button">Cancel</button>
        <span />
        <button className="sampark-create-secondary" disabled={!isEditable || saving} onClick={onSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
        <button className="sampark-create-primary" onClick={onPreview} type="button"><Icon name="eye" size={15} /> Preview</button>
      </footer>
    </div>
  );
}
