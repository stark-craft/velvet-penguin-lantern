import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Windows exposes its "Animation effects" setting through prefers-reduced-motion.
// TechScout's live streams remain functional in that mode, but run more slowly
// and always expose a pause button. Page visibility still stops background work.
export default function useAutoplayState() {
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const syncMotion = () => setReducedMotion(Boolean(media?.matches));
    const syncVisibility = () => setDocumentVisible(document.visibilityState === 'visible');
    syncMotion();
    syncVisibility();
    media?.addEventListener?.('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      media?.removeEventListener?.('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  return { documentVisible, reducedMotion };
}

export function autoplayDelay(milliseconds, reducedMotion) {
  return Math.round(milliseconds * (reducedMotion ? 1.6 : 1));
}

export function repeatingCycleCount(viewportWidth, itemCount, minimumItemWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const items = Math.max(1, Number(itemCount) || 0);
  const itemWidth = Math.max(1, Number(minimumItemWidth) || 0);
  return Math.max(4, Math.ceil((width * 2) / (items * itemWidth)) + 1);
}
