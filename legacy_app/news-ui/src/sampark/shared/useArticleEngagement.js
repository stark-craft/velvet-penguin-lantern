import { useCallback, useEffect, useRef, useMemo } from 'react';
import { trackEvent } from '../../news-scrapper/api.js';
import { EngagementController } from './engagementController.js';

export function useArticleEngagement(article, options = {}) {
  const { surface = 'shared_briefing' } = options;
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new EngagementController({
      surface,
      now: () => Date.now(),
      send: async (action, detail, activeMs) => {
        try {
          await trackEvent(undefined, action, detail);
        } catch {}
      },
      isVisible: () => typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
      addListener: (fn) => typeof document !== 'undefined' && document.addEventListener('visibilitychange', fn),
      removeListener: (fn) => typeof document !== 'undefined' && document.removeEventListener('visibilitychange', fn),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    });
  }
  const controller = controllerRef.current;

  // Keep surface updated
  useEffect(() => {
    controller.surface = surface;
  }, [surface, controller]);

  // Update article – preserves exact previous article until its final dwell is flushed
  const articleId = article?.article_id || article?.id || article?.canonical_link || article?.link || article?.url || article?.title || '';
  const prevArticleIdRef = useRef(articleId);
  useEffect(() => {
    if (prevArticleIdRef.current !== articleId) {
      controller.setArticle(article);
      prevArticleIdRef.current = articleId;
    } else {
      // Same ID but article object may have updated (e.g., reactions) – keep reference
      controller.currentArticle = article;
    }
  }, [article, articleId, controller]);

  // Reversible StrictMode lifecycle: attach on setup, detach on cleanup (not destroy)
  useEffect(() => {
    controller.attach();
    return () => {
      controller.detach();
    };
  }, [controller]);

  const onDossierOpen = useCallback((explicitArticle) => {
    const target = explicitArticle || article;
    controller.onDossierOpen(target);
  }, [controller, article]);

  const onSourceOpen = useCallback((explicitArticle) => {
    const target = explicitArticle || article;
    controller.onSourceOpen(target);
  }, [controller, article]);

  const onDossierClose = useCallback(() => {
    controller.onDossierClose();
  }, [controller]);

  const getActiveMs = useCallback(() => controller.getActiveMs(), [controller]);

  // Stable object – opening rerenders without closing
  return useMemo(() => ({
    onDossierOpen,
    onSourceOpen,
    onDossierClose,
    getActiveMs,
    isOpen: controller.isOpen,
    onDwell: () => {},
  }), [onDossierOpen, onSourceOpen, onDossierClose, getActiveMs, controller]);
}
