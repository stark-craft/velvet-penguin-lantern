// Optional Sampark presentation preference, stored locally per viewer.
// News history and privacy preferences continue to use their existing contracts.
const KEY = 'sampark-world-explorer-v1';

export function worldExplorerPreferenceKey(viewer) {
  const principal = String(viewer?.principal || '').trim();
  return KEY + ':' + (principal ? principal.slice(0, 8) : 'anon');
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
