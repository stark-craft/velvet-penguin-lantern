// Pure model layer for internal contributions. No DOM or storage access so the
// rules stay testable in Node and reusable by a future backend-backed adapter.

export const CONTRIBUTION_LIMITS = {
  TITLE_MAX: 120,
  SUMMARY_MAX: 300,
  BODY_MAX: 60000,
  COVER_MAX_BYTES: 10 * 1024 * 1024,
  DOCUMENT_MAX_BYTES: 25 * 1024 * 1024,
  PDF_MAX_PAGES: 100,
  EXTRACT_MAX_CHARS: 200000,
  MIN_CROP_WIDTH: 960,
  MIN_CROP_HEIGHT: 540,
};

// The prototype persists these four statuses. A future backend may add
// published / needs_changes / archived; unknown values render through
// statusLabel() without breaking the UI.
export const CONTRIBUTION_STATUS = {
  DRAFT: 'draft',
  PROCESSING: 'processing',
  READY: 'ready',
  SUBMITTED: 'submitted',
};

const STATUS_LABELS = {
  draft: 'Draft',
  processing: 'Processing',
  ready: 'Ready',
  submitted: 'Submitted',
  published: 'Published',
  needs_changes: 'Needs changes',
  archived: 'Archived',
};

export function statusLabel(status) {
  const key = String(status || '').toLowerCase();
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  if (!key) return 'Draft';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export const CONTRIBUTION_CONTENT_TYPES = {
  STORY: 'story',
  DOCUMENT_IMPORT: 'document_import',
  LEADERSHIP: 'leadership',
  ANNOUNCEMENT: 'announcement',
};

const CONTENT_TYPE_LABELS = {
  story: 'Story',
  document_import: 'Document import',
  leadership: 'Leadership message',
  announcement: 'Announcement',
};

export function contentTypeLabel(contentType) {
  return CONTENT_TYPE_LABELS[contentType] || 'Story';
}

export const CATEGORY_SUGGESTIONS = [
  'General',
  'Leadership',
  'Announcement',
  'Technology',
  'People & Culture',
  'Business',
  'Sustainability',
];

// Normalized focal grid for the fixed 16:9 cover crop. Values persist so the
// eventual Samsung Internal card can reproduce the same framing.
export const FOCAL_POSITIONS = [
  { id: 'top-left', label: 'Top left', x: 0, y: 0 },
  { id: 'top', label: 'Top', x: 0.5, y: 0 },
  { id: 'top-right', label: 'Top right', x: 1, y: 0 },
  { id: 'left', label: 'Left', x: 0, y: 0.5 },
  { id: 'center', label: 'Center', x: 0.5, y: 0.5 },
  { id: 'right', label: 'Right', x: 1, y: 0.5 },
  { id: 'bottom-left', label: 'Bottom left', x: 0, y: 1 },
  { id: 'bottom', label: 'Bottom', x: 0.5, y: 1 },
  { id: 'bottom-right', label: 'Bottom right', x: 1, y: 1 },
];

const COVER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const COVER_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

function extensionOf(name = '') {
  const parts = String(name).split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function isSupportedCoverFile(file = {}) {
  const extension = extensionOf(file.name);
  if (COVER_IMAGE_TYPES.has(file.type)) return true;
  return !file.type && COVER_IMAGE_EXTENSIONS.has(extension);
}

export function validateCoverFile(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, message: 'Choose a JPG, PNG, or WebP image for the cover.' };
  }
  if (file.type === 'image/svg+xml' || extensionOf(file.name) === 'svg') {
    return { ok: false, message: 'SVG covers are not accepted. Export the image as JPG, PNG, or WebP and try again.' };
  }
  if (!isSupportedCoverFile(file)) {
    return { ok: false, message: 'Choose a JPG, PNG, or WebP image for the cover. GIF, HEIC, and other formats are not supported yet.' };
  }
  if (Number(file.size) > CONTRIBUTION_LIMITS.COVER_MAX_BYTES) {
    return { ok: false, message: `${file.name} is larger than the 10 MB cover limit. Choose a smaller image.` };
  }
  return { ok: true, message: '' };
}

// Largest 16:9 area that fits inside the source image without stretching.
export function largestSixteenNineCrop(width, height) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const cropWidth = Math.min(safeWidth, (safeHeight * 16) / 9);
  return { width: Math.round(cropWidth), height: Math.round((cropWidth * 9) / 16) };
}

export function coverMeetsResolution(width, height) {
  const crop = largestSixteenNineCrop(width, height);
  return (
    crop.width >= CONTRIBUTION_LIMITS.MIN_CROP_WIDTH &&
    crop.height >= CONTRIBUTION_LIMITS.MIN_CROP_HEIGHT
  );
}

export function coverResolutionMessage(width, height) {
  const crop = largestSixteenNineCrop(width, height);
  return (
    `This image is too small for an internal story card. Its usable 16:9 area is `
    + `${crop.width} × ${crop.height}, but at least ${CONTRIBUTION_LIMITS.MIN_CROP_WIDTH} × `
    + `${CONTRIBUTION_LIMITS.MIN_CROP_HEIGHT} is needed. Choose a larger image — around 1600 × 900 works best.`
  );
}

export function validateCoverDimensions(width, height) {
  if (!width || !height) {
    return { ok: false, message: 'This image could not be read. Choose a different JPG, PNG, or WebP file.' };
  }
  if (!coverMeetsResolution(width, height)) {
    return { ok: false, message: coverResolutionMessage(width, height) };
  }
  return { ok: true, message: '' };
}

// A cover is usable once it is either already stored on the server (url) or a
// freshly chosen local file waiting to be uploaded on save (pendingFile).
function sanitizeCoverImage(value) {
  if (!value || typeof value !== 'object') return null;
  // A real File in the browser; tests may pass a stand-in object.
  const pendingFile = value.pendingFile && typeof value.pendingFile === 'object' ? value.pendingFile : null;
  const url = String(value.url || '');
  if (!pendingFile && !url) return null;
  return {
    name: String(value.name || ''),
    type: String(value.type || ''),
    size: Math.max(0, Math.round(Number(value.size) || 0)),
    width: Math.max(0, Math.round(Number(value.width) || 0)),
    height: Math.max(0, Math.round(Number(value.height) || 0)),
    focalX: clampUnit(value.focalX ?? value.focal_x ?? 0.5),
    focalY: clampUnit(value.focalY ?? value.focal_y ?? 0.5),
    url,
    pendingFile,
  };
}

function sanitizeSourceDocument(value) {
  if (!value || typeof value !== 'object' || !value.blobId) return null;
  return {
    blobId: String(value.blobId),
    name: String(value.name || ''),
    type: String(value.type || ''),
    size: Math.max(0, Math.round(Number(value.size) || 0)),
    pageCount: Number.isFinite(Number(value.pageCount)) && value.pageCount ? Math.round(Number(value.pageCount)) : null,
    extractedCharacters: Math.max(0, Math.round(Number(value.extractedCharacters) || 0)),
  };
}

function makeId(prefix) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

// Single factory for contribution records. Missing fields fall back to honest
// defaults instead of undefined leaking into the UI.
export function createContribution(input = {}) {
  const nowIso = new Date().toISOString();
  return {
    id: input.id || makeId('contrib'),
    contentType: input.contentType === CONTRIBUTION_CONTENT_TYPES.DOCUMENT_IMPORT
      ? CONTRIBUTION_CONTENT_TYPES.DOCUMENT_IMPORT
      : input.contentType === CONTRIBUTION_CONTENT_TYPES.LEADERSHIP
        ? CONTRIBUTION_CONTENT_TYPES.LEADERSHIP
        : input.contentType === CONTRIBUTION_CONTENT_TYPES.ANNOUNCEMENT
          ? CONTRIBUTION_CONTENT_TYPES.ANNOUNCEMENT
          : CONTRIBUTION_CONTENT_TYPES.STORY,
    title: String(input.title || '').trim().slice(0, CONTRIBUTION_LIMITS.TITLE_MAX),
    summary: String(input.summary || '').trim().slice(0, CONTRIBUTION_LIMITS.SUMMARY_MAX),
    body: String(input.body || '').slice(0, CONTRIBUTION_LIMITS.BODY_MAX),
    category: String(input.category || '').trim(),
    team: String(input.team || '').trim(),
    author: String(input.author || '').trim(),
    cover: sanitizeCoverImage(input.cover ?? input.coverImage),
    sourceDocument: sanitizeSourceDocument(input.sourceDocument),
    status: Object.values(CONTRIBUTION_STATUS).includes(input.status) ? input.status : CONTRIBUTION_STATUS.DRAFT,
    createdAt: input.createdAt || nowIso,
    updatedAt: input.updatedAt || input.createdAt || nowIso,
    submittedAt: input.submittedAt || null,
  };
}

const MIN_SUBMIT_BODY_CHARS = 20;

// Submission gate: title + usable body, plus a valid cover — except for
// announcements, which are text-first notices where a cover is optional.
export function canSubmitContribution(contribution) {
  const problems = [];
  if (!String(contribution?.title || '').trim()) problems.push('Add a title before submitting.');
  if (String(contribution?.body || '').trim().length < MIN_SUBMIT_BODY_CHARS) {
    problems.push('Add the story body — imported or written text is required before submitting.');
  }
  const cover = contribution?.cover;
  if (!cover || (!cover.url && !cover.pendingFile)) {
    if (contribution?.contentType !== CONTRIBUTION_CONTENT_TYPES.ANNOUNCEMENT) {
      problems.push('Select a cover image before submitting.');
    }
  } else if (
    Number(cover.width) > 0 && Number(cover.height) > 0
    && !coverMeetsResolution(cover.width, cover.height)
  ) {
    problems.push('The selected cover is too small for an internal story card. Replace it with a larger image.');
  }
  return { ok: problems.length === 0, problems };
}

export function displayCategory(contribution) {
  return String(contribution?.category || '').trim() || 'General';
}
