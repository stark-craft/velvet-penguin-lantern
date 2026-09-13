// Pure contribution state machine for Sampark Create. Tested behaviorally;
// SamparkCreate renders from these so every status reaches the correct screen.

export const EDITABLE_STATUSES = ['draft', 'ready', 'needs_changes', 'withdrawn'];

export const EDITABLE_STATUS_SET = new Set(EDITABLE_STATUSES);

export function isEditableStatus(status, recordId) {
  if (!recordId) return true;
  return EDITABLE_STATUSES.includes(status || 'draft');
}

// Which screen a record belongs on, and which actions it offers.
export function describeContributionRecord(rec) {
  const status = rec?.status || 'draft';
  const editable = isEditableStatus(status, rec?.id);
  const base = { status, editable, readOnly: !editable, reviewNote: rec?.reviewNote || '' };
  switch (status) {
    case 'draft':
    case 'ready':
      return { ...base, screen: 'editor', actions: ['edit', 'submit', 'delete'], banner: '' };
    case 'needs_changes':
      return {
        ...base,
        screen: 'editor',
        actions: ['edit', 'resubmit'],
        banner: base.reviewNote ? `Reviewer feedback: ${base.reviewNote}` : 'Changes were requested.',
      };
    case 'submitted':
      return { ...base, screen: 'editor', actions: ['withdraw'], banner: 'Submitted — read-only while editors review.' };
    case 'withdrawn':
      return { ...base, screen: 'editor', actions: ['edit', 'resubmit', 'delete'], banner: 'Withdrawn — edit and resubmit when ready.' };
    case 'published':
      return { ...base, screen: 'published', actions: ['view-live'], banner: 'Published on Samsung Internal.' };
    case 'archived':
    case 'rejected':
      return { ...base, screen: 'readonly', actions: [], banner: 'This record is closed to further edits.' };
    default:
      return { ...base, screen: 'editor', actions: ['edit'], banner: '' };
  }
}

// Submission readiness: cover presence is a pending file or a persisted
// server cover — never the record ID alone.
export function validateCreateSubmit({ title, body, coverRequired, hasCover }) {
  const problems = [];
  if (!String(title || '').trim()) problems.push('add a title');
  if (String(body || '').trim().length < 20) problems.push('write the body');
  if (coverRequired && !hasCover) problems.push('select a cover image');
  return problems;
}

export function coverReady({ coverRequired, coverFile, coverPreview }) {
  if (!coverRequired) return true;
  return Boolean(coverFile || coverPreview);
}
