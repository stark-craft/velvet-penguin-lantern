import { useCallback, useEffect, useRef } from 'react';
import { sendRecommendationEvents } from '../api.js';

function eventId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function useRecommendationEvents(feedRequestId, flushSeconds = 15, batchSize = 10) {
  const queueRef = useRef([]);
  const sendingRef = useRef(false);

  const flush = useCallback(async ({ keepalive = false } = {}) => {
    if (sendingRef.current || !queueRef.current.length) return;
    sendingRef.current = true;
    const requestId = queueRef.current[0].feedRequestId;
    const batch = [];
    const remaining = [];
    queueRef.current.forEach((entry) => {
      if (entry.feedRequestId === requestId && batch.length < batchSize) batch.push(entry);
      else remaining.push(entry);
    });
    queueRef.current = remaining;
    try {
      await sendRecommendationEvents(requestId, batch.map((entry) => entry.event), { keepalive });
    } catch {
      queueRef.current = [...batch, ...queueRef.current].slice(0, 100);
    } finally {
      sendingRef.current = false;
    }
  }, [batchSize]);

  const record = useCallback((action, item, context = {}) => {
    const recommendation = item?.recommendation || {};
    const id = eventId();
    queueRef.current.push({ feedRequestId: feedRequestId || '', event: {
      event_id: id,
      action,
      article_id: item?.article_id || item?.id || item?.link || item?.title || '',
      cluster_id: item?.cluster_id || '',
      surface: 'for_you',
      position: Number.isInteger(context.position) ? context.position : recommendation.position,
      occurred_at: new Date().toISOString(),
      active_ms: Math.max(0, Number(context.active_ms || 0)),
      visible_ratio: Math.max(0, Math.min(1, Number(context.visible_ratio || 0))),
      detail: {
        title: item?.title || '',
        source: item?.src || item?.source || '',
        topics: recommendation.topics || [],
        reasons: recommendation.reason_codes || [],
        section: context.section || '',
      },
    } });
    queueRef.current = queueRef.current.slice(-100);
    if (queueRef.current.length >= batchSize) flush();
    return id;
  }, [batchSize, feedRequestId, flush]);

  const discard = useCallback((id) => {
    queueRef.current = queueRef.current.filter((entry) => entry.event.event_id !== id);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(flush, Math.max(5, flushSeconds) * 1000);
    const finalFlush = () => flush({ keepalive: true });
    window.addEventListener('pagehide', finalFlush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', finalFlush);
      flush({ keepalive: true });
    };
  }, [flush, flushSeconds]);

  return { record, flush, discard };
}
