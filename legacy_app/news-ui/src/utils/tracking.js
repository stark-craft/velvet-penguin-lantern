import { useEffect, useRef } from 'react';
import { getFingerprint } from './session.js';
import { trackEvent } from '../api.js';

let _fp = null;
async function fp() {
  if (!_fp) _fp = await getFingerprint();
  return _fp;
}

export async function trackAction(action, detail = '') {
  try {
    const f = await fp();
    await trackEvent(f, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
  } catch {
    /* swallow — tracking is best-effort */
  }
}

// Hook: page_load on mount + 60s heartbeat
export function useTracking(pageName) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackAction('page_load', pageName);
    const t = setInterval(() => trackAction('heartbeat', pageName), 60_000);
    return () => clearInterval(t);
  }, [pageName]);
}
