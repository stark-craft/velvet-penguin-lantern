import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import ArticleModal from '../../news-scrapper/components/modals/ArticleModal.jsx';
import LeadershipMessageModal from './LeadershipMessageModal.jsx';
import SriDStoryModal from './SriDStoryModal.jsx';
import SriDInternalModal from './SriDInternalModal.jsx';
import SriDDocumentModal from './SriDDocumentModal.jsx';
import {
  getLatestBriefing, getPublishedInternalContent, getSamsungInternalFeed, getSharedBriefing,
} from '../../news-scrapper/api.js';
import { isSamsungSignal, splitByScope } from '../../news-scrapper/internal/samsungInternalModel.js';
import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import { useArticleEngagement } from '../shared/useArticleEngagement.js';
import SamsungChannelTabs from './SamsungChannelTabs.jsx';
import SamsungChannelContent from './SamsungChannelContent.jsx';
import { buildSamparkSamsungModel, publishedRecordToSignal, samsungItemKey } from './samsungNewsModel.js';
import '../all-news/all-news.css';
import './samsung-news.css';

function publishedRecordsFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.records)) return response.records;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function SamsungDossier({ item, onClose }) {
  const engagement = useArticleEngagement(item || {}, { surface: 'samsung_news' });
  const articleId = item
    ? (item.canonical_link || item.link || item.url || item.id || item.title || '')
    : '';
  useEffect(() => {
    if (item && articleId) engagement.onDossierOpen(item);
    // engagement intentionally follows article identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);
  if (!item) return null;
  function close() {
    engagement.onDossierClose();
    onClose();
  }
  // Published leadership communication: separate MD-message experience.
  if (item._isInternalPublished && item.contentType === 'leadership')
    return <LeadershipMessageModal item={item} onClose={close} />;
  // Published HR/Create News stories retain their authored template.
  if (item._isInternalPublished && item.contentType === 'document_import')
    return <SriDDocumentModal item={item} onClose={close} />;
  if (item._isInternalPublished && item.contentType === 'story')
    return <SriDStoryModal item={item} onClose={close} />;
  // Announcements and SRI-D-only signals use their internal reader.
  if (item.samsung_internal_channel === 'internal' || item.region === 'SRI-D')
    return <SriDInternalModal item={item} onClose={close} />;
  // Global and Local use the shared News Detail reader.
  return <ArticleModal item={item} variant="all-briefings" onClose={close}
    onSourceOpen={() => engagement.onSourceOpen()} />;
}

export default function SamsungNewsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeChannel, setActiveChannel] = useState('internal');
  const [feed, setFeed] = useState({ global: [], local: [], inside: [], sampark: [] });
  const [published, setPublished] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The NEW badge expires while the page remains open, without a refresh.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishedError, setPublishedError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [openArticle, setOpenArticle] = useState(null);
  const [focusMissed, setFocusMissed] = useState('');
  const handledFocusRef = useRef('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPublishedError('');
    Promise.all([
      getSamsungInternalFeed(100).catch(async () => {
        // Preserve existing fallback from shared/latest briefing.
        const briefing = await getSharedBriefing().catch(() => getLatestBriefing());
        const all = normalizeList(
          briefing?.result || briefing?.results || briefing?.articles || briefing || [],
        ).filter(isSamsungSignal);
        const split = splitByScope(all);
        return { global: split.global, local: split.local, inside: split.inside, sampark: split.inside };
      }),
      getPublishedInternalContent().then((response) => ({
        records: publishedRecordsFromResponse(response), error: '',
      })).catch((loadError) => ({
        records: [],
        error: loadError?.message || 'Published internal content could not be verified.',
      })),
    ]).then(([samsungFeed, publishedResult]) => {
      if (cancelled) return;
      setFeed(samsungFeed || { global: [], local: [], inside: [] });
      setPublished(publishedResult.records);
      setPublishedError(publishedResult.error);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError?.message || 'Samsung News could not be loaded.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [retryKey]);

  const model = useMemo(() => buildSamparkSamsungModel({ feed, published }), [feed, published]);
  // Preserve ?focus=<id> deep links. Published records always route to SRI-D.
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(location.search || '');
    const focus = params.get('focus');
    if (!focus || openArticle || handledFocusRef.current === location.search) return;
    const publishedMatch = published.find((record) =>
      record?.status === 'published' && String(record?.id || '') === String(focus));
    if (publishedMatch) {
      setActiveChannel('internal');
      setFocusMissed('');
      setOpenArticle(publishedRecordToSignal(publishedMatch));
      handledFocusRef.current = location.search;
      return;
    }
    for (const channelId of ['internal', 'global', 'local']) {
      const match = model[channelId]?.items?.find((item) =>
        [item?.id, item?.canonical_link, item?.link, item?.url, item?.title]
          .some((value) => String(value || '') === String(focus)));
      if (match) {
        setActiveChannel(channelId);
        setFocusMissed('');
        setOpenArticle(match);
        handledFocusRef.current = location.search;
        return;
      }
    }
    setFocusMissed(focus);
    handledFocusRef.current = location.search;
  }, [loading, location.search, model, openArticle, published]);

  const selectedChannel = model[activeChannel];
  if (loading) return <div className="samsung-news-page">
    <div className="tsan-loading" role="status"><span className="sampark-spinner" /> Opening Samsung News…</div>
  </div>;
  if (error) return <div className="samsung-news-page">
    <div className="tsan-error" role="alert">
      <Icon name="warning" size={20} /><p>{error}</p>
      <button className="btn-primary" onClick={() => setRetryKey((value) => value + 1)}
        type="button">Retry</button>
    </div>
  </div>;
  return (
    <div className="samsung-news-page">
      {publishedError && <div className="samsung-news-notice" role="alert">
        <Icon name="warning" size={14} /><span>{publishedError}</span>
      </div>}
      {focusMissed && <div className="samsung-news-notice" role="status">
        <Icon name="warning" size={14} />
        <span>This item is no longer published or is unavailable.</span>
        <button className="btn-secondary" onClick={() => {
          setFocusMissed(''); navigate('/samsung-news');
        }} type="button">Return to Samsung News</button>
      </div>}
      {/* SRI-D / Samsung Global / Samsung Local */}
      <SamsungChannelTabs activeChannel={activeChannel} model={model} onChange={setActiveChannel} />
      <SamsungChannelContent channel={selectedChannel} onOpen={setOpenArticle} nowMs={nowMs} />
      <SamsungDossier item={openArticle} onClose={() => setOpenArticle(null)} />
    </div>
  );
}
