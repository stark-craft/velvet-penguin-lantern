import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import NameModal from '../components/modals/NameModal.jsx';
import Icon from '../components/Icon.jsx';
import {
  completeViewerPreferences, confirmViewerMigration, getForYou, getRecommendationStatus, getViewerPreferences,
  getViewerSaved, getWorkflow, hideArticleForViewer, pauseViewerPersonalization,
  removeSavedArticle, saveArticleForLater, selectWorkflow, trainVote,
  resetRecommendationProfile,
} from '../api.js';
import { articleKey } from '../utils/intelligence.js';
import { normalizeList } from '../utils/normalize.js';
import ExecutiveScan from './ExecutiveScan.jsx';
import ExplorationRail from './ExplorationRail.jsx';
import FollowedUpdates from './FollowedUpdates.jsx';
import ForYouCard from './ForYouCard.jsx';
import InterestSetup from './InterestSetup.jsx';
import SinceLastVisit from './SinceLastVisit.jsx';
import { recommendationGreeting, timeGreeting } from './recommendationState.js';
import useRecommendationEvents from './useRecommendationEvents.js';
import './for-you.css';

const migrationDismissKey = 'for-you-migration-dismissed';

export default function ForYouScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [feed, setFeed] = useState(null);
  const [items, setItems] = useState([]);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [openArticle, setOpenArticle] = useState(null);
  const [pendingSelect, setPendingSelect] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState(null);
  const [busyActions, setBusyActions] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [controlBusy, setControlBusy] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reviewed, setReviewed] = useState(new Set());
  const [explainOpen, setExplainOpen] = useState(false);
  const dwellStarted = useRef(0);
  const dwellAccumulated = useRef(0);
  const actionLocks = useRef(new Set());
  const controlLocks = useRef(new Set());
  const lessLikeTimers = useRef(new Map());
  const { record, flush } = useRecommendationEvents(
    feed?.feed_request_id,
    status?.event_flush_seconds || 15,
    status?.event_batch_size || 10,
  );

  const loadFeed = useCallback(async () => {
    const result = await getForYou({ limit: 40 });
    const normalized = normalizeList(result?.items || []);
    setFeed({ ...result, items: normalized });
    setItems(normalized);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextStatus = await getRecommendationStatus();
        if (cancelled) return;
        const migrationDismissed = window.sessionStorage.getItem(migrationDismissKey) === 'true';
        setStatus(migrationDismissed ? { ...nextStatus, migration_offer: { ...(nextStatus?.migration_offer || {}), available: false } } : nextStatus);
        const pref = await getViewerPreferences();
        if (cancelled) return;
        setPreferences(pref?.preferences || {});
        setSetupOpen(Boolean(nextStatus?.enabled && !pref?.preferences?.completed_at));
        if (nextStatus?.enabled) await loadFeed();
        const [saved, workflow] = await Promise.all([getViewerSaved(), getWorkflow()]);
        if (cancelled) return;
        setSavedKeys(new Set(normalizeList(saved?.items || []).map(articleKey)));
        setSelectedKeys(new Set(normalizeList([...(workflow?.selected || []), ...(workflow?.approved || [])]).map(articleKey)));
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || 'Could not prepare your intelligence mix.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadAttempt, loadFeed]);

  useEffect(() => () => {
    lessLikeTimers.current.forEach(({ timer, item }) => {
      window.clearTimeout(timer);
      record('less_like_this', item);
    });
    lessLikeTimers.current.clear();
    flush({ keepalive: true });
  }, [flush, record]);

  const runItemAction = async (action, item, work) => {
    const key = articleKey(item);
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setBusyActions((current) => ({ ...current, [key]: action }));
    setError('');
    try {
      return await work();
    } finally {
      actionLocks.current.delete(key);
      setBusyActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const refresh = async () => {
    if (controlLocks.current.has('refresh')) return;
    controlLocks.current.add('refresh');
    setRefreshing(true);
    setError('');
    try { await loadFeed(); } catch (nextError) { setError(nextError?.message || 'Could not refresh For You.'); }
    finally { controlLocks.current.delete('refresh'); setRefreshing(false); }
  };
  const loadMore = async () => {
    if (!feed?.cursor || controlLocks.current.has('load-more')) return;
    controlLocks.current.add('load-more');
    setLoadingMore(true);
    setError('');
    try {
      const result = await getForYou({ cursor: feed.cursor, limit: 20 });
      if (result?.cursor_reset) {
        await loadFeed();
        setActionNotice({ message: 'The edition changed while you were reading, so your mix was refreshed from the beginning.' });
        record('feed_refresh', {}, { section: 'cursor_reset' });
        return;
      }
      const nextItems = normalizeList(result?.items || []);
      setItems((current) => {
        const known = new Set(current.map(articleKey));
        return [...current, ...nextItems.filter((item) => !known.has(articleKey(item)))];
      });
      setFeed((current) => ({
        ...current,
        cursor: result?.cursor || null,
        total: result?.total ?? current?.total,
        sections: {
          ...(current?.sections || {}),
          more: [...(current?.sections?.more || []), ...nextItems],
        },
      }));
      record('feed_refresh', {}, { section: 'more' });
    } catch (nextError) {
      setError(nextError?.message || 'Could not load more intelligence.');
    } finally {
      controlLocks.current.delete('load-more');
      setLoadingMore(false);
    }
  };

  const completeSetup = async (next) => {
    const result = await completeViewerPreferences(next);
    setPreferences(result.preferences);
    setSetupOpen(false);
    record('interest_edit', {}, { section: 'onboarding' });
    await refresh();
  };

  const useStarterMix = async () => {
    const taxonomy = status?.taxonomy || {};
    const topics = (taxonomy.topics || []).slice(0, 3).map((option) => option.id);
    const outcomes = (taxonomy.outcomes || []).slice(0, 3).map((option) => option.id);
    const sourceFamilies = (taxonomy.source_families || []).map((option) => option.id);
    await completeSetup({
      topics: topics.length >= 3 ? topics : ['ai_models', 'devices_displays', 'policy_markets'],
      outcomes: outcomes.length ? outcomes : ['product_launches', 'competitive_moves', 'risks_incidents'],
      source_families: sourceFamilies.length ? sourceFamilies : ['primary', 'research', 'tech_press', 'business_press', 'industry_trade', 'public_sector', 'india_regional'],
      regions: ['balanced'],
      surprise_me: true,
    });
    setActionNotice({ message: 'Balanced starter mix saved. You can tune it at any time.' });
  };

  const openDossier = (item) => {
    dwellAccumulated.current = 0;
    dwellStarted.current = document.visibilityState === 'visible' ? Date.now() : 0;
    setOpenArticle(item);
    setReviewed((current) => new Set(current).add(articleKey(item)));
    record('dossier_open', item, { section: 'for_you' });
  };
  const closeDossier = () => {
    const activeMs = dwellAccumulated.current + (dwellStarted.current ? Date.now() - dwellStarted.current : 0);
    // Ignore accidental opens; meaningful dwell should gently teach the next
    // edition without letting a brief mis-click dominate the viewer profile.
    if (openArticle && activeMs >= 1500) record('dossier_dwell', openArticle, { active_ms: activeMs, section: 'dossier' });
    dwellStarted.current = 0;
    dwellAccumulated.current = 0;
    setOpenArticle(null);
    flush();
  };

  useEffect(() => {
    if (!openArticle) return undefined;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && dwellStarted.current) {
        dwellAccumulated.current += Date.now() - dwellStarted.current;
        dwellStarted.current = 0;
      } else if (document.visibilityState === 'visible' && !dwellStarted.current) {
        dwellStarted.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [openArticle]);

  const acceptMigration = async () => {
    if (controlLocks.current.has('migration')) return;
    controlLocks.current.add('migration');
    setControlBusy('migration');
    try {
      await confirmViewerMigration(true);
      window.sessionStorage.removeItem(migrationDismissKey);
      setStatus((current) => ({ ...current, migration_offer: { available: false } }));
      await refresh();
    } catch (nextError) {
      setError(nextError?.message || 'Could not continue this existing desk.');
    } finally {
      controlLocks.current.delete('migration');
      setControlBusy('');
    }
  };
  const dismissMigration = () => {
    window.sessionStorage.setItem(migrationDismissKey, 'true');
    setStatus((current) => ({ ...current, migration_offer: { ...(current?.migration_offer || {}), available: false } }));
  };

  const resetDesk = async () => {
    if (controlLocks.current.has('reset')) return;
    if (!window.confirm('Reset this browser’s For You preferences and recent recommendation activity? Saved stories and shared workflow items will stay intact.')) return;
    controlLocks.current.add('reset');
    setControlBusy('reset');
    try {
      await resetRecommendationProfile();
      window.location.assign('/for-you');
    } catch (nextError) {
      setError(nextError?.message || 'Could not reset this desk.');
      controlLocks.current.delete('reset');
      setControlBusy('');
    }
  };
  const toggleSave = async (item) => {
    return runItemAction('save', item, async () => {
      try {
      const key = articleKey(item);
      const saved = savedKeys.has(key);
      if (saved) await removeSavedArticle(item); else await saveArticleForLater(item);
      setSavedKeys((current) => { const next = new Set(current); if (saved) next.delete(key); else next.add(key); return next; });
      record(saved ? 'unsave' : 'save', item);
      setActionNotice({ message: saved ? 'Removed from followed stories.' : 'Saved and followed privately.' });
      } catch (nextError) {
        setError(nextError?.message || 'Could not update this followed story.');
      }
    });
  };
  const hide = async (item) => {
    return runItemAction('hide', item, async () => {
      try {
      await hideArticleForViewer(item);
      setItems((current) => current.filter((candidate) => articleKey(candidate) !== articleKey(item)));
      record('hide', item);
      setActionNotice({ message: 'Hidden only from your feed. The shared briefing is unchanged.', label: 'Review hidden', action: () => navigate('/rejected') });
      } catch (nextError) {
        setError(nextError?.message || 'Could not hide this story from your feed.');
      }
    });
  };
  const interested = async (item) => {
    return runItemAction('interested', item, async () => {
      try {
      await trainVote(item.keywords_found || item.keywords || [], item.master_summary || item.summary || item.title, 'interested', item.title);
      record('interested', item);
      setActionNotice({ message: 'Thanks—this will gently influence your future ordering.' });
      } catch (nextError) {
        setError(nextError?.message || 'Could not record this feedback.');
      }
    });
  };
  const lessLikeThis = (item) => {
    const key = articleKey(item);
    if (lessLikeTimers.current.has(key)) return;
    const originalIndex = items.findIndex((candidate) => articleKey(candidate) === key);
    setItems((current) => current.filter((candidate) => articleKey(candidate) !== articleKey(item)));
    const timer = window.setTimeout(() => {
      lessLikeTimers.current.delete(key);
      record('less_like_this', item);
    }, 6000);
    lessLikeTimers.current.set(key, { timer, item });
    setActionNotice({
      message: 'Showing fewer stories like this. This affects only your For You ordering.',
      label: 'Undo',
      action: () => {
        const pending = lessLikeTimers.current.get(key);
        if (pending) window.clearTimeout(pending.timer);
        lessLikeTimers.current.delete(key);
        setItems((current) => {
          if (current.some((candidate) => articleKey(candidate) === key)) return current;
          const next = [...current];
          next.splice(Math.max(0, Math.min(originalIndex, next.length)), 0, item);
          return next;
        });
        setActionNotice(null);
      },
    });
  };
  const confirmSelect = async (item, name) => {
    return runItemAction('select', item, async () => {
      try {
      await selectWorkflow({ ...item, selected_by: name, selected_at: new Date().toISOString() });
      setSelectedKeys((current) => new Set(current).add(articleKey(item)));
      record('select', item);
      setActionNotice({ message: 'Sent to the shared Review Queue.' });
      } catch (nextError) {
        setError(nextError?.message || 'Could not send this story to Review Queue.');
        throw nextError;
      }
    });
  };

  const sections = useMemo(() => {
    const byKey = new Map(items.map((item) => [articleKey(item), item]));
    const hydrate = (values) => normalizeList(values || []).map((item) => byKey.get(articleKey(item)) || item).filter((item) => byKey.has(articleKey(item)));
    const identity = (item) => item.cluster_id || item.cluster_key || articleKey(item);
    const scan = hydrate(feed?.sections?.executive_scan);
    const claimed = new Set(scan.map(identity));
    const takeUnclaimed = (values) => hydrate(values).filter((item) => {
      const key = identity(item);
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    return {
      since: takeUnclaimed(feed?.sections?.since_last_visit),
      scan,
      followed: takeUnclaimed(feed?.sections?.followed_updates),
      exploration: takeUnclaimed(feed?.sections?.exploration),
      more: takeUnclaimed(feed?.sections?.more),
    };
  }, [feed, items]);

  const cardProps = (item, index, section) => ({
    index, section, saved: savedKeys.has(articleKey(item)), selected: selectedKeys.has(articleKey(item)),
    busyAction: busyActions[articleKey(item)] || '',
    onOpen: openDossier, onSave: toggleSave, onSelect: setPendingSelect, onHide: hide,
    onInterested: interested, onLessLikeThis: lessLikeThis,
    onImpression: (target, context) => record('qualified_impression', target, context),
  });

  if (loading) return <div className="fy-state"><span className="fy-loader" /><h1>Preparing your intelligence mix</h1><p>Balancing freshness, evidence, relevance and useful surprise.</p></div>;
  if (error && !feed) return <div className="fy-state is-error" role="alert"><Icon name="warning" size={28} /><h1>We could not tune this edition</h1><p>{error}</p><button onClick={() => { setError(''); setLoading(true); setLoadAttempt((current) => current + 1); }} type="button">Try again</button></div>;
  if (status && !status.enabled) return <div className="fy-state"><Icon name="sparkle" size={28} /><h1>For You is ready for its pilot</h1><p>The recommendation service is installed but disabled by configuration. Your shared Briefing remains unchanged.</p><button onClick={() => navigate('/home')} type="button">Open Briefing</button></div>;

  return (
    <div className="fy-page">
      <section className="fy-hero">
        <div className="fy-hero-copy"><span className="fy-kicker">{recommendationGreeting(feed?.mode, feed?.viewer_name)}</span><h1>{timeGreeting()}, {feed?.viewer_name || 'there'}.</h1><p>Five signals, ranked for you—what changed, why it matters, and what deserves attention next.</p><div className="fy-hero-actions"><button onClick={() => setSetupOpen(true)} type="button"><Icon name="settings" size={15} /> Edit interests</button><button aria-expanded={explainOpen} onClick={() => setExplainOpen((current) => !current)} type="button"><Icon name="sparkle" size={15} /> Why these stories?</button><button disabled={refreshing} onClick={refresh} type="button"><Icon name="refresh" size={15} /> {refreshing ? 'Refreshing…' : 'Refresh mix'}</button></div>{explainOpen && <div className="fy-explain-mix" role="note">Your choices and meaningful actions influence order. Shared editorial importance, evidence quality, source diversity and useful surprise remain part of every mix. Card appearances alone are never treated as interest.</div>}</div>
        <aside aria-label="Today’s personalized mix"><span>Today’s mix</span><strong>{feed?.total || 0}</strong><p>eligible signals</p><div><small><b>{feed?.counts?.follow_up || 0}</b> followed updates</small><small><b>{feed?.counts?.exploration || 0}</b> useful surprises</small></div></aside>
      </section>
      {error && <div className="fy-inline-error" role="alert">{error}</div>}
      {actionNotice && <div className="fy-feedback" role="status"><span>{actionNotice.message}</span><div>{actionNotice.action && <button onClick={actionNotice.action} type="button">{actionNotice.label}</button>}<button aria-label="Dismiss message" onClick={() => setActionNotice(null)} type="button"><Icon name="x" size={13} /></button></div></div>}
      {status?.migration_offer?.available && (
        <section className="fy-migration-offer" aria-label="Existing desk found">
          <div><Icon name="user" size={17} /><span><strong>{status.migration_offer.message}</strong><small>Your legacy data stays intact as rollback history.</small></span></div>
          <div><button disabled={Boolean(controlBusy)} onClick={acceptMigration} type="button">{controlBusy === 'migration' ? 'Continuing…' : 'Continue this desk'}</button><button disabled={Boolean(controlBusy)} onClick={dismissMigration} type="button">Not now</button></div>
        </section>
      )}
      {items.length ? <>
        <SinceLastVisit items={sections.since} cardProps={cardProps} />
        <ExecutiveScan items={sections.scan} reviewed={reviewed.size} cardProps={cardProps} />
        <FollowedUpdates items={sections.followed} cardProps={cardProps} />
        <ExplorationRail items={sections.exploration} cardProps={cardProps} />
        {sections.more.length > 0 && <section className="fy-section"><header><span>More for you</span><h2>Continue when you have time</h2></header><div className="fy-card-grid">{sections.more.map((item, index) => <ForYouCard {...cardProps(item, index, 'more')} item={item} key={item.article_id || item.id} />)}</div></section>}
      </> : <section className="fy-empty-state"><Icon name="sparkle" size={28} /><h2>Your mix is waiting for fresh signals</h2><p>There is nothing eligible in this edition yet. Tune your interests or use the shared Briefing while the next scan is prepared.</p><div><button onClick={() => setSetupOpen(true)} type="button">Tune interests</button><button onClick={() => navigate('/home')} type="button">Open shared Briefing</button></div></section>}
      {feed?.cursor && <div className="fy-load-more"><button disabled={loadingMore} onClick={loadMore} type="button">{loadingMore ? 'Loading…' : 'Load more intelligence'} {!loadingMore && <Icon name="chevR" size={14} />}</button></div>}
      <div className="fy-controls"><button disabled={Boolean(controlBusy)} onClick={async () => { if (controlLocks.current.has('pause')) return; controlLocks.current.add('pause'); setControlBusy('pause'); setError(''); try { await pauseViewerPersonalization(feed?.mode !== 'paused'); await refresh(); setActionNotice({ message: feed?.mode === 'paused' ? 'Personalization resumed.' : 'Personalization paused. Shared editorial order is available.' }); } catch (nextError) { setError(nextError?.message || 'Could not update personalization.'); } finally { controlLocks.current.delete('pause'); setControlBusy(''); } }} type="button"><Icon name={feed?.mode === 'paused' ? 'play' : 'pause'} size={14} /> {controlBusy === 'pause' ? 'Updating…' : feed?.mode === 'paused' ? 'Resume personalization' : 'Pause personalization'}</button><button disabled={Boolean(controlBusy)} onClick={resetDesk} type="button"><Icon name="refresh" size={14} /> {controlBusy === 'reset' ? 'Resetting…' : 'Reset this desk'}</button><button onClick={() => navigate('/home')} type="button">Open shared Briefing</button></div>
      <InterestSetup open={setupOpen} taxonomy={status?.taxonomy} initial={preferences} onClose={() => setSetupOpen(false)} onSkip={useStarterMix} onComplete={completeSetup} />
      <ArticleModal item={openArticle} onClose={closeDossier} onSave={toggleSave} isSaved={openArticle ? savedKeys.has(articleKey(openArticle)) : false} onSelect={(item) => { closeDossier(); setPendingSelect(item); }} onHide={async (item) => { closeDossier(); await hide(item); }} onSourceOpen={(item) => record('source_open', item, { section: 'dossier' })} onWhyThisStory={(item) => record('why_this_story_open', item, { section: 'dossier' })} />
      <NameModal open={Boolean(pendingSelect)} article={pendingSelect} onClose={() => setPendingSelect(null)} onConfirm={confirmSelect} />
    </div>
  );
}
