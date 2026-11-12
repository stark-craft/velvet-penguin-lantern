// Session ID + device fingerprint, persisted to localStorage.

const SESSION_KEY = 'sense-session-id';
const FP_KEY = 'sense-fingerprint';

function randomHex(n = 16) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getSessionId() {
  let s = localStorage.getItem(SESSION_KEY);
  if (!s) {
    s = randomHex(16);
    localStorage.setItem(SESSION_KEY, s);
  }
  return s;
}

async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function canvasFingerprint() {
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#069';
    ctx.fillText('SENSE-fingerprint-Δ∑', 2, 2);
    ctx.strokeStyle = '#f60';
    ctx.strokeRect(0, 0, 240, 60);
    return c.toDataURL();
  } catch {
    return 'no-canvas';
  }
}

export async function getFingerprint() {
  const cached = localStorage.getItem(FP_KEY);
  if (cached) return cached;
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    canvasFingerprint(),
  ].join('|');
  const fp = (await sha256(raw)).slice(0, 32);
  localStorage.setItem(FP_KEY, fp);
  return fp;
}
