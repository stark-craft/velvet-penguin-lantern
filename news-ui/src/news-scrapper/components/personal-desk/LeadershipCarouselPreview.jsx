import React, { useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  CATEGORY_SUGGESTIONS,
  FOCAL_POSITIONS,
  validateCoverDimensions,
  validateCoverFile,
} from '../../internal/contributionModel.js';
import { useCoverPreviewSrc } from './CoverImageInput.jsx';
import '../../styles/samsung-internal.css';

const COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    image.src = url;
  });
}

function focalStyle(cover) {
  if (!cover) return undefined;
  const focalX = Number.isFinite(Number(cover.focalX ?? cover.focal_x))
    ? Number(cover.focalX ?? cover.focal_x)
    : 0.5;
  const focalY = Number.isFinite(Number(cover.focalY ?? cover.focal_y))
    ? Number(cover.focalY ?? cover.focal_y)
    : 0.5;
  return { objectPosition: `${focalX * 100}% ${focalY * 100}%` };
}

// Read-only counterpart to the composer rehearsal. Reviewers see the same
// leadership slide that will be published, rather than a generic story cover.
export function LeadershipCarouselPresentation({
  record,
  imageSrc = '',
  badge = 'Editorial preview',
  className = '',
}) {
  const title = String(record?.title || '').trim() || 'Leadership message';
  const summary = String(record?.summary || '').trim();
  const author = String(record?.author || '').trim();
  const category = String(record?.category || '').trim() || 'Leadership';

  return (
    <div className={`hero-cluster-panel sni-hero sni-hero-demo sni-readonly-hero ${className}`.trim()}>
      <div className="sni-hero-shade absolute inset-0 z-10" />
      <div className="sni-hero-stage sni-hero-stage-leadership">
        <div className="sni-hero-topline">
          <span className="sni-brand">Samsung Internal</span>
          <span className="sni-chip sni-chip-static"><Icon name="eye" size={12} /> {badge}</span>
        </div>

        <div className="sni-leader">
          <div className="sni-leader-copy">
            <div className="sni-kicker-row">
              <span className="sni-kicker">From the MD&rsquo;s desk</span>
            </div>
            <h2 className="sni-leader-title">{title}</h2>
            {summary && <blockquote className="sni-leader-quote">&ldquo;{summary}&rdquo;</blockquote>}
            <div className="sni-leader-meta">
              {author && <span><Icon name="eye" size={13} /> {author}</span>}
              <span className="sni-chip">{category}</span>
            </div>
          </div>

          <figure className={`sni-leader-portrait${imageSrc ? '' : ' is-empty'}`}>
            {imageSrc
              ? <img alt={`${author || 'Leadership'} portrait`} src={imageSrc} style={focalStyle(record?.cover)} />
              : <div className="sni-portrait-static"><Icon name="note" size={24} /><span>Portrait unavailable</span></div>}
          </figure>
        </div>

        <div className="sni-dots" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((dot) => (
            <button className={dot === 0 ? 'is-active' : ''} key={dot} tabIndex={-1} type="button" />
          ))}
        </div>
      </div>
    </div>
  );
}

// The leadership Preview mode: a live rehearsal of the Samsung Internal hero
// slide. The headline, quoted line, attribution and portrait edit right
// inside the slide; the Edit toggle returns to the standard form.
export default function LeadershipCarouselPreview({ draft, onChange }) {
  const [coverError, setCoverError] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const [focalOpen, setFocalOpen] = useState(false);
  const portraitInputRef = useRef(null);
  const previewSrc = useCoverPreviewSrc(draft.cover);

  const update = (patch) => onChange({ ...draft, ...patch });

  const handlePortrait = async (file) => {
    if (!file || coverBusy) return;
    const validation = validateCoverFile(file);
    if (!validation.ok) {
      setCoverError(validation.message);
      return;
    }
    setCoverBusy(true);
    setCoverError('');
    try {
      const size = await decodeImage(file);
      const dimensionCheck = validateCoverDimensions(size.width, size.height);
      if (!dimensionCheck.ok) {
        setCoverError(dimensionCheck.message);
        return;
      }
      update({
        cover: {
          pendingFile: file,
          name: file.name,
          type: file.type || 'image/*',
          size: Number(file.size) || 0,
          width: size.width,
          height: size.height,
          focalX: draft.cover?.focalX ?? 0.5,
          focalY: draft.cover?.focalY ?? 0.5,
          url: '',
        },
      });
    } catch {
      setCoverError('This image could not be processed by this browser. Try a different JPG, PNG, or WebP file.');
    } finally {
      setCoverBusy(false);
      if (portraitInputRef.current) portraitInputRef.current.value = '';
    }
  };

  return (
    <div className="le-preview">
      <div aria-label="Live preview of the leadership message in the Samsung Internal carousel" className="hero-cluster-panel sni-hero sni-hero-demo" role="group">
        <div className="sni-hero-shade absolute inset-0 z-10" />
        <div className="sni-hero-stage sni-hero-stage-leadership">
          <div className="sni-hero-topline">
            <span className="sni-brand">Samsung Internal</span>
            <span className="sni-chip sni-chip-static"><Icon name="pin" size={12} /> Live preview</span>
          </div>

          <div className="sni-leader">
            <div className="sni-leader-copy">
              <div className="sni-kicker-row">
                <span className="sni-kicker">From the MD&rsquo;s desk</span>
              </div>
              <label className="sr-only" htmlFor="le-title-input">Leadership message headline</label>
              <input
                className="sni-leader-title sni-editable-title"
                disabled={coverBusy}
                id="le-title-input"
                maxLength={120}
                onChange={(event) => update({ title: event.target.value })}
                placeholder="Vision of the quarter"
                value={draft.title}
              />
              <label className="sr-only" htmlFor="le-quote-input">The quoted line readers will see first</label>
              <textarea
                aria-label="The quoted line readers will see first"
                className="sni-leader-quote sni-editable-quote"
                disabled={coverBusy}
                id="le-quote-input"
                maxLength={300}
                onChange={(event) => update({ summary: event.target.value })}
                placeholder="“Write the line you want every colleague quoting on Monday…”"
                rows={3}
                value={draft.summary}
              />
              <small className="sni-editable-hint">{String(draft.summary || '').length}/300 · edit right here</small>
              <div className="sni-leader-meta">
                <span className="sni-leader-meta-edit">
                  <Icon name="eye" size={13} />
                  <label className="sr-only" htmlFor="le-author-input">Attribution</label>
                  <input
                    disabled={coverBusy}
                    id="le-author-input"
                    maxLength={400}
                    onChange={(event) => update({ author: event.target.value })}
                    placeholder="Attribution — name and office"
                    value={draft.author}
                  />
                </span>
                <select
                  aria-label="Category"
                  className="sni-editable-select"
                  disabled={coverBusy}
                  onChange={(event) => update({ category: event.target.value })}
                  value={draft.category || 'Leadership'}
                >
                  {[...new Set(['Leadership', ...CATEGORY_SUGGESTIONS])].map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </div>
            </div>

            <figure className={`sni-leader-portrait${previewSrc ? '' : ' is-empty'}`}>
              {previewSrc
                ? <img alt="Leader portrait preview" src={previewSrc} style={focalStyle(draft.cover)} />
                : (
                  <button
                    className="sni-portrait-empty"
                    disabled={coverBusy}
                    onClick={() => portraitInputRef.current?.click()}
                    type="button"
                  >
                    <Icon name="upload" size={20} />
                    <strong>Add the MD&rsquo;s portrait</strong>
                    <small>JPG, PNG or WebP · required to publish</small>
                  </button>
                )}
              {previewSrc && (
                <>
                  <input
                    accept={COVER_ACCEPT}
                    className="sr-only"
                    disabled={coverBusy}
                    onChange={(event) => handlePortrait(event.target.files?.[0])}
                    ref={portraitInputRef}
                    type="file"
                  />
                  <div className="sni-portrait-tools">
                    <button disabled={coverBusy} onClick={() => portraitInputRef.current?.click()} type="button">
                      <Icon name="refresh" size={13} /> {coverBusy ? 'Checking…' : 'Replace'}
                    </button>
                    <button disabled={false} onClick={() => update({ cover: null })} type="button">
                      <Icon name="trash" size={13} /> Remove
                    </button>
                    <button
                      aria-expanded={focalOpen}
                      onClick={() => setFocalOpen((open) => !open)}
                      type="button"
                    >
                      <Icon name="pin" size={13} /> Framing
                    </button>
                  </div>
                  {focalOpen && (
                    <div className="sni-focal-picker" role="group" aria-label="Choose which part of the portrait stays visible">
                      {FOCAL_POSITIONS.map((position) => {
                        const active = (draft.cover?.focalX ?? 0.5) === position.x && (draft.cover?.focalY ?? 0.5) === position.y;
                        return (
                          <button
                            aria-label={`Framing ${position.label.toLowerCase()}`}
                            aria-pressed={active}
                            className={active ? 'active' : ''}
                            key={position.id}
                            onClick={() => update({ cover: { ...draft.cover, focalX: position.x, focalY: position.y } })}
                            title={position.label}
                            type="button"
                          >
                            <span aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </figure>
          </div>

          <div className="sni-dots" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((dot) => (
              <button className={dot === 0 ? 'is-active' : ''} key={dot} tabIndex={-1} type="button" />
            ))}
          </div>
        </div>
      </div>

      {coverError && <p className="cw-field-error" role="alert"><Icon name="warning" size={14} /> {coverError}</p>}
      <p className="cw-hint">Edits here apply to the draft instantly — switch to Edit for the full message body.</p>
    </div>
  );
}
