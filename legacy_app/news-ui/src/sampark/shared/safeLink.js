// Shared external URL sanitizer for Sampark article/provider links.
// Rejects javascript:, data:, file:, internal:, malformed URLs, empty hostnames.
// Preserves valid http/https. Internal Sampark routes use React Router, never this helper.
export function sanitizeExternalUrl(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  if (/^(javascript|data|file|internal|vbscript):/i.test(raw)) return '';
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return '';
    if (!u.hostname || /\s/.test(u.hostname)) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function isExternalHttpUrl(candidate) {
  return Boolean(sanitizeExternalUrl(candidate));
}
