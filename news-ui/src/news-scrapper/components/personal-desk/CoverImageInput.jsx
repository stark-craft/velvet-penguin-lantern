import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  CONTRIBUTION_LIMITS,
  FOCAL_POSITIONS,
  validateCoverDimensions,
  validateCoverFile,
} from '../../internal/contributionModel.js';

const COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// Resolves the display source for a contribution cover: a freshly chosen file
// previews from a local object URL until it is uploaded; saved covers come
// straight from the server-normalized endpoint.
export function useCoverPreviewSrc(cover) {
  const pendingFile = cover?.pendingFile || null;
  const [objectUrl, setObjectUrl] = useState('');
  useEffect(() => {
    if (!pendingFile) {
      setObjectUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(pendingFile);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);
  if (cover?.url && !cover?.pendingFile) return cover.url;
  return objectUrl;
}

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

// Client-side checks give instant feedback; the server re-validates and is
// authoritative for size, format, resolution, and normalization.
export default function CoverImageInput({ value, onChange, disabled = false }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const previewSrc = useCoverPreviewSrc(value);

  const handleFile = async (file) => {
    if (!file || busy || disabled) return;
    const validation = validateCoverFile(file);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const size = await decodeImage(file);
      const dimensionCheck = validateCoverDimensions(size.width, size.height);
      if (!dimensionCheck.ok) {
        setError(dimensionCheck.message);
        return;
      }
      onChange({
        pendingFile: file,
        name: file.name,
        type: file.type || 'image/*',
        size: Number(file.size) || 0,
        width: size.width,
        height: size.height,
        focalX: 0.5,
        focalY: 0.5,
        url: '',
      });
    } catch (handleError) {
      console.error('[contribution-cover]', handleError);
      setError('This image could not be processed by this browser. Try a different JPG, PNG, or WebP file.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const setFocal = (position) => {
    if (!value) return;
    onChange({ ...value, focalX: position.x, focalY: position.y });
  };

  const focalLabel = value
    ? FOCAL_POSITIONS.find((entry) => entry.x === value.focalX && entry.y === value.focalY)?.label || 'Custom'
    : 'Center';

  return (
    <div className="cw-cover">
      <input
        accept={COVER_ACCEPT}
        className="sr-only"
        disabled={disabled || busy}
        id="cw-cover-input"
        onChange={(event) => handleFile(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      {value ? (
        <>
          <figure className="cw-cover-frame" aria-label={`Cover preview${value.width ? `, ${value.width} × ${value.height} pixels` : ''}`}>
            {previewSrc && <img alt="" src={previewSrc} />}
            <figcaption>
              <span>{value.name}</span>
              {value.pendingFile
                ? <small>Uploads when you save</small>
                : <small>Stored on the server{value.size ? ` · ${formatBytes(value.size)}` : ''}</small>}
            </figcaption>
          </figure>
          <div className="cw-cover-tools">
            <fieldset className="cw-focal" disabled={disabled}>
              <legend>Cover focal point <small>currently {focalLabel.toLowerCase()}</small></legend>
              <div className="cw-focal-grid" role="group" aria-label="Choose which part of the image stays visible">
                {FOCAL_POSITIONS.map((position) => {
                  const active = value.focalX === position.x && value.focalY === position.y;
                  return (
                    <button
                      aria-label={`Focal point ${position.label.toLowerCase()}`}
                      aria-pressed={active}
                      className={active ? 'active' : ''}
                      key={position.id}
                      onClick={() => setFocal(position)}
                      title={position.label}
                      type="button"
                    >
                      <span aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="cw-cover-actions">
              <button className="btn-dark-secondary" disabled={disabled || busy} onClick={() => inputRef.current?.click()} type="button">
                <Icon name="refresh" size={14} /> Replace
              </button>
              <button className="btn-dark-secondary" disabled={disabled} onClick={() => onChange(null)} type="button">
                <Icon name="trash" size={14} /> Remove
              </button>
            </div>
          </div>
        </>
      ) : (
        <div
          className={`cw-dropzone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files?.[0]); }}
        >
          <span aria-hidden="true"><Icon name="upload" size={22} /></span>
          <div>
            <strong>Cover image</strong>
            <p>JPG, PNG, or WebP up to {formatBytes(CONTRIBUTION_LIMITS.COVER_MAX_BYTES)}. Around 1600 × 900 frames best.</p>
          </div>
          <button className="btn-dark-primary" disabled={disabled || busy} onClick={() => inputRef.current?.click()} type="button">
            {busy ? 'Checking…' : 'Choose image'}
          </button>
        </div>
      )}
      <div aria-live="polite">
        {error && <p className="cw-field-error" role="alert"><Icon name="warning" size={14} /> {error}</p>}
      </div>
    </div>
  );
}
