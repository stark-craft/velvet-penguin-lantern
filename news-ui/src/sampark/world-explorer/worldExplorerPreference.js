// Optional Sampark presentation preference, stored locally per viewer.
// News history and privacy preferences continue to use their existing contracts.
const KEY = 'sampark-world-explorer-v1';

export function worldExplorerPreferenceKey(viewer) {
  const principal = String(viewer?.principal || '').trim();
  if (!principal) return KEY + ':anon';
  // Avoid putting the raw identity in localStorage or giving all users with
  // a shared principal prefix the same preference.
  let hash = 2166136261;
  for (let i = 0; i < principal.length; i += 1) {
    hash = Math.imul(hash ^ principal.charCodeAt(i), 16777619) >>> 0;
  }
  return KEY + ':' + hash.toString(16).padStart(8, '0') + '-' + principal.length;
}

export function readWorldExplorerPreference(viewer, storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    return store?.getItem(worldExplorerPreferenceKey(viewer)) === 'true';
  } catch {
    return false; // Classic is the safe default.
  }
}

export function saveWorldExplorerPreference(viewer, enabled, storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return false;
    store.setItem(worldExplorerPreferenceKey(viewer), enabled ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}
