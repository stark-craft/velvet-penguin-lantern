import React, { useEffect, useMemo, useRef, useState } from 'react';
import ArticleModal from '../../news-scrapper/components/modals/ArticleModal.jsx';
import { getDocumentReactions, setDocumentReaction } from '../../news-scrapper/api.js';
import { documentSignalOf } from './documentPresentation.js';

/**
 * Reuse the exact All News detail modal for internal published PDFs.
 * The original PDF opens in a separate tab ONLY when View Document is used,
 * so the details view is never coupled to browser PDF plugin lifecycle.
 */
export default function SriDDocumentModal({ item, onClose }) {
  const [reactions, setReactions] = useState(null);
  const [reactionError, setReactionError] = useState('');
  const [reactionBusy, setReactionBusy] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [retry, setRetry] = useState(0);
  const voting = useRef(false);
  const docId = item?.id || '';
  const published = item?.status === 'published';

  const signal = useMemo(() => documentSignalOf(item), [item]);

  useEffect(() => {
    let cancelled = false;
    setReactions(null);
    setReactionError('');
    setDocumentError('');
    voting.current = false;
    setReactionBusy(false);
    if (!docId || !published) return undefined;
    getDocumentReactions(docId)
      .then((snapshot) => { if (!cancelled) setReactions(snapshot); })
      .catch((error) => {
        if (!cancelled) setReactionError(error?.message || 'Document reactions unavailable.');
      });
    return () => { cancelled = true; };
  }, [docId, published, retry]);

  async function voteDocument(_signal, nextReaction) {
    if (!docId || !published || !reactions || voting.current) return;
    voting.current = true;
    setReactionBusy(true);
    setReactionError('');
    const previous = reactions;
    const optimistic = {
      ...previous,
      like_count: Math.max(0, Number(previous.like_count || 0) - (previous.viewer_reaction === 'like' ? 1 : 0) + (nextReaction === 'like' ? 1 : 0)),
      dislike_count: Math.max(0, Number(previous.dislike_count || 0) - (previous.viewer_reaction === 'dislike' ? 1 : 0) + (nextReaction === 'dislike' ? 1 : 0)),
      viewer_reaction: nextReaction,
    };
    setReactions(optimistic);
    try {
      const result = await setDocumentReaction(docId, nextReaction);
      setReactions(result);
    } catch (error) {
      setReactions(previous);
      setReactionError(error?.message || 'Your reaction could not be saved.');
    } finally {
      voting.current = false;
      setReactionBusy(false);
    }
  }

  async function viewOriginalDocument() {
    const originalUrl = item?.sourceDocument?.url || item?.source_document?.url ||
      (docId ? '/internal-content/' + encodeURIComponent(docId) + '/document' : '');
    if (!originalUrl || !item?.sourceDocument && !item?.source_document) {
      setDocumentError('No original PDF is attached to this record.');
      return;
    }
    const fullUrl = originalUrl + (originalUrl.includes('?') ? '&' : '?') + 'inline=1';
    // Reserve a new tab synchronously in response to the click (popup-safe).
    const viewer = window.open('about:blank', '_blank');
    if (!viewer) {
      setDocumentError('The browser blocked the document tab. Allow pop-ups for Sampark.');
      return;
    }
    try {
      viewer.opener = null;
      setDocumentError('');
      // Detect missing originals BEFORE sending the user into a JSON 404 page.
      // A range probe avoids downloading the entire PDF for validation.
      const response = await fetch(fullUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Range: 'bytes=0-0' },
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/pdf')) {
        const status = response.status;
        await response.body?.cancel?.();
        throw new Error(status === 404
          ? 'The original PDF file is missing on the server. Restore it in the runtime originals folder.'
          : 'The original PDF could not be opened (HTTP ' + status + ').');
      }
      await response.body?.cancel?.();
      if (!viewer.closed) viewer.location.replace(fullUrl);
    } catch (error) {
      if (!viewer.closed) viewer.close();
      setDocumentError(error?.message || 'The original PDF is unavailable.');
    }
  }

  if (!signal) return null;
  const visibleSignal = {
    ...signal,
    ...(reactions ? { reactions } : {}),
  };

  return (
    <>
      <ArticleModal
        item={visibleSignal}
        onClose={onClose}
        variant="document"
        onVote={published && reactions && !reactionBusy ? voteDocument : undefined}
        onViewDocument={viewOriginalDocument}
        reactionReady={Boolean(reactions)}
        documentNotice={documentError || reactionError}
        onRetryReaction={reactionError && published
          ? () => setRetry((current) => current + 1)
          : undefined}
      />
    </>
  );
}
