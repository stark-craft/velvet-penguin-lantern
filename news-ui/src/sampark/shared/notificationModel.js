// Pure notification presentation over the canonical backend record shape
// ({id, kind, record_id, title, note, created_at, read}). Tested behaviorally;
// both notification bells render from these.

const KIND_LABEL = { published: 'Published', changes: 'Changes requested', rejected: 'Not published' };

export function notificationTitle(n) {
  if (n?.title) return n.title;
  return KIND_LABEL[n?.kind] || 'Contribution update';
}

export function notificationDetail(n) {
  if (!n) return '';
  const note = String(n.note || '').trim();
  if (n.kind === 'published') return 'Published to Samsung Internal';
  if (n.kind === 'changes') return note ? `Changes requested — ${note}` : 'Changes requested';
  if (n.kind === 'rejected') return note ? `Not published — ${note}` : 'Not published';
  return note;
}

export function notificationDestination(n) {
  const recordId = n?.record_id || '';
  if (n?.kind === 'published' && recordId) return `/samsung-news?focus=${encodeURIComponent(recordId)}`;
  if (recordId) return `/create?open=${encodeURIComponent(recordId)}`;
  return '/create';
}

export function unreadCount(items) {
  return (items || []).filter((n) => !n.read).length;
}
