let fallbackSequence = 0;

// Request deduplication identifiers, not authentication secrets. Server-hosted
// HTTP pages may expose getRandomValues without secure-context randomUUID.
export function createRequestId(crypto = globalThis.crypto) {
  if (typeof crypto?.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* Try the non-secure-context API. */ }
  }
  if (typeof crypto?.getRandomValues === 'function') {
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return `report-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
    } catch { /* Older hosts can lack usable Web Crypto entirely. */ }
  }
  const randomPart = () => Math.random().toString(36).slice(2).padEnd(10, '0');
  return `report-${Date.now().toString(36)}-${randomPart()}-${randomPart()}-${(++fallbackSequence).toString(36)}`.slice(0, 64);
}
