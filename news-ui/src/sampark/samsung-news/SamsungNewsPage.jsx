import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';
import ArticleModal from '../../news-scrapper/components/modals/ArticleModal.jsx';
import LeadershipMessageModal from './LeadershipMessageModal.jsx';
import SriDStoryModal from './SriDStoryModal.jsx';
import SriDInternalModal from './SriDInternalModal.jsx';
import SriDDocumentModal from './SriDDocumentModal.jsx';
import {
  getLatestBriefing, getPublishedInternalContent, getSamsungInternalFeed, getSamsungInternalFeedPage, getSharedBriefing,
} from '../../news-scrapper/api.js';
import { isSamsungSignal, splitByScope } from '../../news-scrapper/internal/samsungInternalModel.js';
import { normalizeList } from '../../news-scrapper/utils/normalize.js';
import { useArticleEngagement } from '../shared/useArticleEngagement.js';
import SamparkWorldExplorer from '../world-explorer/SamparkWorldExplorer.jsx';
import { worldArticleLocation } from '../world-explorer/worldExplorerModel.js';
import SamsungChannelTabs from './SamsungChannelTabs.jsx';
import SamsungChannelContent from './SamsungChannelContent.jsx';
import { buildSamparkSamsungModel, publishedRecordToSignal, samsungItemKey } from './samsungNewsModel.js';
import { SAMSUNG_NEWS_FETCH_BATCH } from './samsungPagination.js';
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

export default function SamsungNewsPage({ worldExplorerEnabled = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeChannel, setActiveChannel] = useState('internal');
  const [feed, setFeed] = useState({ global: [], local: [], inside: [], sampark: [] });
  const [published, setPublished] = useState([]);
  const [totals, setTotals] = useState({ global: 0, local: 0, sampark: 0 });
  const [pagingSupported, setPagingSupported] = useState(false);
  const [pagingBusy, setPagingBusy] = useState(false);
  const pagingBusyRef = useRef(false);
  const [pagingError, setPagingError] = useState('');
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldProgress, setWorldProgress] = useState(0);
  const [worldError, setWorldError] = useState('');
  const [worldRetry, setWorldRetry] = useState(0);
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
    setPagingError('');
    setWorldError('');
    setPagingSupported(false);
    Promise.all([
      getSamsungInternalFeedPage({ limit: SAMSUNG_NEWS_FETCH_BATCH, order: 'newest' })
        .catch(() => getSamsungInternalFeed(100)).catch(async () => {
        // Preserve existing fallback from shared/latest briefing.
        const briefing = await getSharedBriefing().catch(() => getLatestBriefing());
        const all = normalizeList(
          briefing?.result || briefing?.results || briefing?.articles || briefing || [],
        ).filter((item) => isSamsungSignal(item) || worldArticleLocation(item).kind !== 'worldwide');
        const split = splitByScope(all);
        // Keep newly added official country and business sources in the fallback
        // when the legacy source matcher doesn't recognize their labels.
        const classified = new Set([...split.global, ...split.local, ...split.inside]);
        const additionalGlobal = all.filter((item) =>
          !classified.has(item) && worldArticleLocation(item).kind !== 'worldwide');
        return {
          global: [...split.global, ...additionalGlobal],
          local: split.local,
          inside: split.inside,
          sampark: split.inside,
        };
      }),
      getPublishedInternalContent().then((response) => ({
        records: publishedRecordsFromResponse(response), error: '',
      })).catch((loadError) => ({
        records: [],
        error: loadError?.message || 'Published internal content could not be verified.',
      })),
    ]).then(([samsungFeed, publishedResult]) => {
      if (cancelled) return;
      const nextFeed = samsungFeed || { global: [], local: [], inside: [] };
      setFeed(nextFeed);
      setPagingSupported(Boolean(nextFeed?.total_counts && typeof nextFeed.total_counts.global === 'number'));
      setTotals(nextFeed?.total_counts || {
        global: (nextFeed.global || []).length,
        local: (nextFeed.local || []).length,
        sampark: (nextFeed.sampark || nextFeed.inside || []).length,
      });
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

  // Samsung Global and Local reveal cards continuously and request another
  // bounded batch only when the user scrolls to the end of the loaded archive.
  // The backend's 100-story request limit is not a limit on total stories.
  const loadMoreChannel = async (channelId) => {
    if (!['global', 'local'].includes(channelId) || pagingBusyRef.current) return false;
    const existing = feed[channelId] || [];
    const total = totals[channelId] ?? existing.length;
    if (existing.length >= total) return false;
    if (!pagingSupported) {
      setPagingError('More Samsung stories require the updated Samsung feed endpoint.');
      return false;
    }
    pagingBusyRef.current = true;
    setPagingBusy(true);
    setPagingError('');
    try {
      const response = await getSamsungInternalFeedPage({
        channel: channelId,
        limit: SAMSUNG_NEWS_FETCH_BATCH,
        offset: existing.length,
        order: 'newest',
      });
      const batch = Array.isArray(response?.[channelId]) ? response[channelId] : [];
      if (!batch.length) throw new Error('Could not retrieve more retained Samsung stories.');
      setFeed((current) => ({
        ...current,
        [channelId]: [...(current[channelId] || []), ...batch],
      }));
      return true;
    } catch (loadError) {
      setPagingError(loadError?.message || 'Could not load more Samsung stories.');
      return false;
    } finally {
      pagingBusyRef.current = false;
      setPagingBusy(false);
    }
  };

  // Country/region counts must use the full Global archive, not just its
  // first 100 records. Only fetch the remaining pages on World Explorer entry.
  useEffect(() => {
    if (loading || error || !worldExplorerEnabled || activeChannel !== 'global') return;
    if (!pagingSupported) {
      setWorldError('The Samsung backend must be updated to enable complete World Explorer coverage.');
      return;
    }
    let cancelled = false;
    const loadCompleteWorld = async () => {
      let all = [...(feed.global || [])];
      const total = totals.global || 0;
      setWorldProgress(all.length);
      setWorldError('');
      if (all.length >= total) {
        setWorldLoading(false);
        return;
      }
      setWorldLoading(true);
      try {
        while (all.length < total) {
          const response = await getSamsungInternalFeedPage({
            channel: 'global', offset: all.length,
            limit: SAMSUNG_NEWS_FETCH_BATCH, order: 'newest',
          });
          if (cancelled) return;
          const batch = Array.isArray(response?.global) ? response.global : [];
          if (!batch.length) throw new Error('Not all Global newsroom stories could be loaded.');
          all = [...all, ...batch];
          setWorldProgress(all.length);
        }
        if (!cancelled) setFeed((current) => ({ ...current, global: all }));
      } catch (loadError) {
        if (!cancelled) setWorldError(loadError?.message || 'World coverage could not be loaded.');
      } finally {
        if (!cancelled) setWorldLoading(false);
      }
    };
    loadCompleteWorld();
    return () => { cancelled = true; };
    // feed.global is deliberately captured when opening World Explorer; do not
    // restart the archive walk after each downloaded batch or page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, activeChannel, worldExplorerEnabled, pagingSupported, totals.global, retryKey, worldRetry]);
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
    // A focused item might lie beyond the initially loaded 100 articles.
    // Resolve it against the complete retained archive without loading it all.
    const lookupSearch = location.search;
    handledFocusRef.current = lookupSearch;
    getSamsungInternalFeedPage({ limit: 1, focus, order: 'newest' }).then((result) => {
      if (handledFocusRef.current !== lookupSearch) return;
      const match = result?.focus_match;
      const channel = result?.focus_channel;
      if (match && ['global', 'local', 'sampark'].includes(channel)) {
        setActiveChannel(channel === 'sampark' ? 'internal' : channel);
        setFocusMissed('');
        setOpenArticle(channel === 'sampark'
          ? { ...match, samsung_internal_channel: 'internal', region: 'SRI-D' }
          : match);
      } else {
        setFocusMissed(focus);
      }
    }).catch(() => {
      if (handledFocusRef.current === lookupSearch) setFocusMissed(focus);
    });
  }, [loading, location.search, model, openArticle, published]);

  const selectedChannel = model[activeChannel];
  const showWorldExplorer = activeChannel === 'global' && worldExplorerEnabled;
  const worldIncomplete = pagingSupported && (feed.global || []).length < totals.global;
  const showWorldProgress = showWorldExplorer && !worldError && (worldLoading || worldIncomplete);
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
      <SamsungChannelTabs activeChannel={activeChannel} model={model} totals={totals} onChange={setActiveChannel} />
      {pagingError && <div className="samsung-news-notice" role="alert">
        <Icon name="warning" size={14} /><span>{pagingError}</span>
      </div>}
      {showWorldExplorer ? <>
        {showWorldProgress && <div className="tsan-loading" role="status">
          <span className="sampark-spinner" />
          Loading complete Global archive… {worldProgress} of {totals.global} stories
        </div>}
        {worldError && <div className="samsung-news-notice" role="alert">
          <Icon name="warning" size={14} /><span>{worldError}</span>
          {pagingSupported && <button className="btn-secondary" type="button"
            onClick={() => setWorldRetry((value) => value + 1)}>Retry</button>}
        </div>}
        {!showWorldProgress && <SamparkWorldExplorer
          articles={model.global?.items || []}
          onOpen={setOpenArticle}
          coverageComplete={pagingSupported && !worldIncomplete}
        />}
      </> : <SamsungChannelContent
        channel={selectedChannel}
        onOpen={setOpenArticle}
        nowMs={nowMs}
        continuous={activeChannel === 'global' || activeChannel === 'local'}
        totalCount={activeChannel === 'internal' ? undefined : totals[activeChannel]}
        pagingBusy={pagingBusy}
        onLoadMore={() => loadMoreChannel(activeChannel)}
      />}
      <SamsungDossier item={openArticle} onClose={() => setOpenArticle(null)} />
    </div>
  );
}
