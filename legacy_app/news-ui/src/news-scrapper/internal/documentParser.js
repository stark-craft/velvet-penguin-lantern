// Instant client-side validation for contribution document picks.
//
// Production extraction happens on the backend (pypdf / python-docx inside
// legacy_app/news_scrapper/internal_content/). This module no longer parses
// documents in the browser; it only gives quick feedback on obvious problems
// so users never wait for an upload that cannot succeed.

import { CONTRIBUTION_LIMITS } from './contributionModel.js';

const WORD_DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BLOCKED_EXTENSIONS = new Set(['docm', 'xls', 'xlsx', 'ppt', 'pptx']);

export function validateDocumentFile(file) {
  const name = String(file?.name || '');
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const isPdf = file?.type === 'application/pdf' || extension === 'pdf';
  const isDocx = extension === 'docx' || file?.type === WORD_DOCX_TYPE;

  if (extension === 'doc') {
    return { ok: false, isPdf: false, isDocx: false, message: 'This Word format is not supported yet. Save the document as .docx and try again.' };
  }
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return { ok: false, isPdf: false, isDocx: false, message: `${name} is not a supported format. Choose a PDF or Word (.docx) document.` };
  }
  if (!isPdf && !isDocx) {
    return { ok: false, isPdf: false, isDocx: false, message: 'Choose a PDF or Word (.docx) document to import.' };
  }
  if (Number(file?.size) > CONTRIBUTION_LIMITS.DOCUMENT_MAX_BYTES) {
    return { ok: false, isPdf: false, isDocx: false, message: `${name} is larger than the 25 MB document limit. Split it or export a smaller copy.` };
  }
  return { ok: true, isPdf, isDocx, message: '' };
}

export function splitParagraphs(text = '') {
  return String(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// Mirrors the backend's deterministic title rule: first meaningful line when
// short enough, otherwise the cleaned filename.
export function detectTitle(text = '', fallbackName = '') {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => line.length >= 3 && line.length <= CONTRIBUTION_LIMITS.TITLE_MAX);
  if (candidate) return candidate;
  const base = fallbackName.replace(/\.(pdf|docx)$/i, '').replace(/[_-]+/g, ' ').trim();
  return base.slice(0, CONTRIBUTION_LIMITS.TITLE_MAX);
}
