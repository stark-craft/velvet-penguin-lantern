import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { previewParagraphs, STORY_TEMPLATES } from './createNewsModel.js';

function StoryPreview({ coverUrl, form }) {
  const paragraphs = previewParagraphs(form.body);
  const copy = paragraphs.length ? paragraphs : ['Your complete story will appear here as you write.'];
  return (
    <article className={`sampark-create-rendered is-${form.layout}`}>
      <header className="sampark-create-rendered-title"><span>{form.category || 'SRI-D News'}</span><h2>{form.title || 'Your news title will appear here'}</h2><p>{form.summary || 'Add a short description to introduce the story.'}</p></header>
      {form.layout === 'text-top' && <div className="sampark-create-rendered-copy"><p>{copy.join(' ')}</p></div>}
      <div className="sampark-create-rendered-media">{coverUrl ? <img alt="" src={coverUrl} /> : <span><Icon name="layers" size={40} /> Cover image</span>}</div>
      {form.layout === 'two-column' && <div className="sampark-create-rendered-columns"><p>{copy[0]}</p><p>{copy.slice(1).join(' ') || form.summary || copy[0]}</p></div>}
      {form.layout === 'list-view' && <div className="sampark-create-rendered-list">{copy.map((paragraph, index) => <div key={`${index}-${paragraph.slice(0, 12)}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{paragraph}</p></div>)}</div>}
      {form.layout === 'feature-card' && <div className="sampark-create-rendered-feature"><strong>{form.summary || 'Feature story'}</strong><p>{copy.join(' ')}</p></div>}
      <footer><span>{form.author || 'Samsung colleague'}{form.team ? ` · ${form.team}` : ''}</span><small>{STORY_TEMPLATES.find((entry) => entry.id === form.layout)?.label || 'Story'} · {form.displaySection === 'hero' ? 'Hero Banner' : 'SRI-D News'}</small></footer>
    </article>
  );
}

function MessagePreview({ contentType, coverUrl, form }) {
  return (
    <article className={`sampark-create-rendered-message is-${contentType}`}>
      {coverUrl && <img alt="" src={coverUrl} />}
      <div><span>{contentType === 'leadership' ? 'Leadership message' : 'Announcement'}</span><h2>{form.title || 'Your title will appear here'}</h2><p>{form.summary || form.body || 'Your message will appear here.'}</p><small>{form.author || 'Samsung colleague'}{form.team ? ` · ${form.team}` : ''}</small></div>
    </article>
  );
}

export default function CreateNewsPreview({
  contentType,
  coverUrl,
  form,
  hasCover,
  isEditable,
  onBack,
  onSave,
  onSubmit,
  saving,
  submitting,
}) {
  const coverRequired = contentType !== 'announcement';
  return (
    <div className="sampark-create-preview-screen">
      <header className="sampark-create-preview-head"><div><span className="sampark-create-eyebrow">Live preview</span><h1>Review before submitting</h1><p>This preview updates from the current draft.</p></div><button className="sampark-create-secondary" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Back to editing</button></header>
      <div className="sampark-create-preview-canvas">
        {contentType === 'story' ? <StoryPreview coverUrl={coverUrl} form={form} /> : <MessagePreview contentType={contentType} coverUrl={coverUrl} form={form} />}
      </div>
      <div className="sampark-create-readiness" aria-label="Submission readiness">
        <span className={form.title.trim() ? 'is-ready' : ''}><Icon name={form.title.trim() ? 'check2' : 'clock'} size={14} /> Title</span>
        <span className={form.body.trim().length >= 20 ? 'is-ready' : ''}><Icon name={form.body.trim().length >= 20 ? 'check2' : 'clock'} size={14} /> Full content</span>
        <span className={hasCover || !coverRequired ? 'is-ready' : ''}><Icon name={hasCover || !coverRequired ? 'check2' : 'clock'} size={14} /> {coverRequired ? 'Cover image' : 'Cover optional'}</span>
      </div>
      <footer className="sampark-create-sticky-footer">
        <button className="sampark-create-secondary" onClick={onBack} type="button">Back</button>
        <span />
        <button className="sampark-create-secondary" disabled={!isEditable || saving || submitting} onClick={onSave} type="button">{saving ? 'Saving…' : 'Save draft'}</button>
        <button className="sampark-create-primary" disabled={!isEditable || saving || submitting} onClick={onSubmit} type="button">{submitting ? 'Sending…' : 'Submit for approval'} <Icon name="chevR" size={14} /></button>
      </footer>
    </div>
  );
}
