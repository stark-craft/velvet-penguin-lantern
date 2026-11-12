// Sampark theme preference: light, dark, or system. Persisted per browser.
const KEY = 'sampark-theme';

export function readSamparkTheme() {
  try {
    const raw = String(window.localStorage.getItem(KEY) || 'light').toLowerCase();
    if (raw === 'dark' || raw === 'system') return raw;
  } catch {}
  return 'light';
}

export function resolveSamparkTheme(pref) {
  if (pref === 'system') {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  }
  return pref === 'dark' ? 'dark' : 'light';
}

export function applySamparkTheme(pref) {
  const resolved = resolveSamparkTheme(pref || readSamparkTheme());
  try {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch {}
  return resolved;
}

export function saveSamparkTheme(pref) {
  const clean = pref === 'dark' || pref === 'system' ? pref : 'light';
  try { window.localStorage.setItem(KEY, clean); } catch {}
  return applySamparkTheme(clean);
}
