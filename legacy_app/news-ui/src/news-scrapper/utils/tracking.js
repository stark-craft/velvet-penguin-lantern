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

export function articleActivityDetail(item, screen = 'unknown') {
  return {
    title: item?.title,
    link: item?.link || item?.canonical_link || item?.url,
    source: item?.source || item?.src,
    category: item?.category,
    region: item?.region,
    keywords: item?.keywords || item?.keywords_found || [],
    entities: item?.entities || [],
    article_intent: item?.article_intent,
    profile: item?.profile,
    article_id: item?.id,
    cluster_id: item?.cluster_id,
    screen,
  };
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
