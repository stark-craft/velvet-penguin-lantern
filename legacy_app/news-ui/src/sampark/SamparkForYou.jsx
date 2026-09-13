import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  completeViewerPreferences,
  getFollowingThreads,
  getForYou,
  getRecommendationStatus,
  getViewerActivitySummary,
  getViewerPreferences,
  getViewerReactions,
  getViewerSaved,
  hideArticleForViewer,
  removeSavedArticle,
  saveArticleForLater,
  setViewerReaction,
} from '../news-scrapper/api.js';
import { articleKey, reactionIdentity } from '../news-scrapper/utils/intelligence.js';
import { normalizeList } from '../news-scrapper/utils/normalize.js';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';
import useRecommendationEvents from '../news-scrapper/for-you/useRecommendationEvents.js';
import SamparkTooltip from './shared/SamparkTooltip.jsx';
import SamparkArticleDossier from './shared/SamparkArticleDossier.jsx';
import { hideOptimistic, hideRollback, findNeighbors } from './shared/hideHelper.js';
// per-article per-action optimistic with ref-based deduplication (no stale closure)
import { readSamparkSettings } from './SamparkSettingsModal.jsx';

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || item?.top_image || '';
}

function metaLabels(status, preferences) {
  const options = [...(status?.taxonomy?.topics || []), ...(status?.taxonomy?.outcomes || [])];
  const labels = [...(preferences?.topics || []), ...(preferences?.outcomes || [])]
    .slice(0, 5)
    .map((id) => options.find((option) => option.id === id)?.label || String(id).replaceAll('_', ' '));
  return labels.length ? labels : ['Balanced mix'];
}

// ========== 3-Step Preferences Wizard — Sampark-native, behavior matches original InterestSetup ==========
function SamparkPreferencesModal({ open, onClose, taxonomy, initial, onSaved }) {
  const dialogRef = useModalFocus(open, onClose);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [value, setValue] = useState(() => ({
    topics: initial?.topics || [],
    outcomes: initial?.outcomes || [],
    source_families: initial?.source_families || [],
    regions: initial?.regions || ['balanced'],
    surprise_me: initial?.surprise_me !== false,
  }));

  const pages = useMemo(() => [
    { key: 'topics', eyebrow: '01 — Intelligence beats', title: 'What deserves your attention?', note: 'Pick 3 to 5 beats. You can tune this anytime.' },
    { key: 'outcomes', eyebrow: '02 — Work outcomes', title: 'What makes a signal useful?', note: 'Choose the developments that influence your work.' },
    { key: 'source_families', eyebrow: '03 — Evidence mix', title: 'Where should your signal come from?', note: 'This changes order — not facts, access, or the shared Briefing.' },
  ], []);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSaving(false);
    setError('');
    setValue({
      topics: initial?.topics || [],
      outcomes: initial?.outcomes || [],
      source_families: initial?.source_families || [],
      regions: initial?.regions || ['balanced'],
      surprise_me: initial?.surprise_me !== false,
    });
  }, [open, initial]);

  const page = pages[step];
  const selectedCount = value[page.key].length;
  const minimum = page.key === 'topics' ? 3 : 1;
  const maximum = page.key === 'topics' ? 5 : Number.POSITIVE_INFINITY;
  const pageIsValid = selectedCount >= minimum && selectedCount <= maximum;
  const options = taxonomy?.[page.key] || [];

  if (!open) return null;

  const toggle = (key, id) => {
    setValue((cur) => ({
      ...cur,
      [key]: cur[key].includes(id) ? cur[key].filter((v) => v !== id) : [...cur[key], id],
    }));
  };

  const complete = async (payload) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await completeViewerPreferences(payload);
      onSaved(result?.preferences || payload);
      onClose();
    } catch (e) {
      setError(e?.message || 'Your mix could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // Skip = starter mix behavior: balanced topics/outcomes/source_families,
  // preserving automatic personalization via behavior rather than explicit choices.
  const handleSkip = async () => {
    const taxonomyTopics = (taxonomy?.topics || []).slice(0, 3).map((o) => o.id);
    const taxonomyOutcomes = (taxonomy?.outcomes || []).slice(0, 3).map((o) => o.id);
    const families = (taxonomy?.source_families || []).map((o) => o.id);
    await complete({
      topics: taxonomyTopics.length >= 3 ? taxonomyTopics : ['ai_models', 'devices_displays', 'policy_markets'],
      outcomes: taxonomyOutcomes.length ? taxonomyOutcomes : ['product_launches', 'competitive_moves', 'risks_incidents'],
      source_families: families.length ? families : ['primary', 'research', 'tech_press', 'business_press', 'industry_trade', 'public_sector', 'india_regional'],
      regions: ['balanced'],
      surprise_me: true,
    });
  };

  const handleSave = () => complete(value);

  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-prefs-title" aria-modal="true" className="sampark-prefs-modal sampark-prefs-wizard" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-prefs-header">
          <div>
            <span className="sampark-prefs-eyebrow">{page.eyebrow}</span>
            <h2 id="sampark-prefs-title">{page.title}</h2>
            <p className="sampark-prefs-subtitle">{page.note}</p>
          </div>
          <button aria-label="Close preferences" disabled={saving} onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>

        <div className="sampark-prefs-progress" role="progressbar" aria-valuemin={1} aria-valuemax={pages.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${pages.length}`}>
          {pages.map((_, i) => <span key={i} className={i === step ? 'is-active' : i < step ? 'is-done' : ''} />)}
        </div>

        <div className="sampark-prefs-body">
          <div className="sampark-prefs-counter" id="sampark-choice-guidance" role="status">
            {page.key === 'topics' ? `${selectedCount} of 3–5 selected` : `${selectedCount} selected · at least ${minimum}`}
          </div>

          <div className="sampark-prefs-grid">
            {options.map((opt) => {
              const active = value[page.key].includes(opt.id);
              const disabled = !active && value[page.key].length >= maximum;
              return (
                <button
                  key={opt.id}
                  aria-pressed={active}
                  className={`sampark-prefs-chip${active ? ' is-active' : ''}`}
                  disabled={disabled}
                  onClick={() => toggle(page.key, opt.id)}
                  type="button"
                >
                  <span className="sampark-chip-mark">{active ? '✓' : '+'}</span> {opt.label}
                </button>
              );
            })}
            {!options.length && <span className="sampark-prefs-empty">No options available</span>}
          </div>

          {step === 2 && (
            <div className="sampark-prefs-extras">
              <div className="sampark-prefs-region">
                <strong>Region balance</strong>
                <div className="sampark-region-choices">
                  {(taxonomy?.regions || []).map((r) => (
                    <button key={r.id} className={value.regions.includes(r.id) ? 'is-active' : ''} onClick={() => setValue((c) => ({ ...c, regions: [r.id] }))} type="button">{r.label}</button>
                  ))}
                </div>
              </div>
              <label className="sampark-surprise">
                <input checked={value.surprise_me} onChange={(e) => setValue((c) => ({ ...c, surprise_me: e.target.checked }))} type="checkbox" />
                <span><strong>Surprise me</strong><small>Keep a small window open to signals outside your usual lane.</small></span>
              </label>
            </div>
          )}

          {error && <div className="sampark-prefs-error" role="alert">{error}</div>}
        </div>

        <footer className="sampark-prefs-footer">
          <button className="sampark-skip-btn" disabled={saving} onClick={handleSkip} type="button">{saving ? 'Saving…' : 'Skip — use starter mix'}</button>
          <div className="sampark-prefs-actions">
            {step > 0 && <button className="btn-secondary" disabled={saving} onClick={() => setStep((s) => s - 1)} type="button">Back</button>}
            {step < 2 ? (
              <button aria-describedby="sampark-choice-guidance" className="btn-primary" disabled={!pageIsValid || saving} onClick={() => setStep((s) => s + 1)} type="button">Continue <Icon name="chevR" size={14} /></button>
            ) : (
              <button aria-describedby="sampark-choice-guidance" className="btn-primary" disabled={!pageIsValid || saving} onClick={handleSave} type="button">{saving ? 'Saving…' : 'Save my mix'} {!saving && <Icon name="sparkle" size={14} />}</button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function ReactionButton({ item, reaction, onReact, disabled }) {
  const state = item.reactions || {};
  const active = state.viewer_reaction === reaction;
  const count = Number(state[`${reaction}_count`] || 0);
  const label = reaction === 'like' ? 'Like' : 'Dislike';
  return (
    <button aria-label={`${label} ${item.title}, ${count}`} className={`sampark-card-action${active ? ' is-active' : ''}`} disabled={disabled} onClick={() => onReact(item, reaction)} type="button">
      <Icon name={reaction === 'like' ? 'thumbsUp' : 'thumbsDown'} size={14} />
      <span>{count}</span>
    </button>
  );
}

// ========== Following — Sampark-native access within For You ==========
function SamparkFollowingModal({ open, onClose, threads, loading, error, onRetry, onOpenArticle, onUnfollow, busy }) {
  const dialogRef = useModalFocus(open, onClose);
  if (!open) return null;
  return (
    <div className="sampark-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-following-title" aria-modal="true" className="sampark-following-modal" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-following-header">
          <div>
            <span className="sampark-following-eyebrow">Private story watch</span>
            <h2 id="sampark-following-title">Following</h2>
            <p>Each followed story stays anchored here with only close semantic updates — not every article sharing a name. 30-day window.</p>
          </div>
          <button aria-label="Close following" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div className="sampark-following-body">
          {loading && <div className="sampark-following-loading" role="status"><span className="sampark-spinner" /> Opening your story threads…</div>}
          {error && <div className="sampark-following-error" role="alert">{error} <button className="btn-secondary" onClick={onRetry} type="button">Retry</button></div>}
          {!loading && !error && !threads.length && <div className="sampark-following-empty"><Icon name="bookmark" size={28} /><h3>No followed stories yet</h3><p>Use Follow on a For You card. Closely related updates will collect here.</p></div>}
          {!loading && threads.length > 0 && (
            <div className="sampark-thread-list">
              {threads.map((thread) => (
                <section className="sampark-thread" key={thread.id}>
                  <article className="sampark-thread-anchor">
                    <span className="sampark-thread-label">Following</span>
                    <button className="sampark-thread-title" onClick={() => onOpenArticle(thread.anchor)} type="button">{thread.anchor.title}</button>
                    <p className="sampark-thread-summary">{thread.anchor.summary_lead || thread.anchor.summary || 'The original story you chose to follow.'}</p>
                    <div className="sampark-thread-meta">
                      <small>{thread.anchor.src || thread.anchor.source || 'Source'}</small>
                      <button className="sampark-thread-unfollow" disabled={busy === articleKey(thread.anchor)} onClick={() => onUnfollow(thread)} type="button"><Icon name="bookmark" size={14} /> {busy === articleKey(thread.anchor) ? 'Updating…' : 'Unfollow'}</button>
                    </div>
                  </article>
                  <div className="sampark-thread-updates">
                    <header>
                      <span>{thread.updates.length ? `${thread.update_count} close update${thread.update_count === 1 ? '' : 's'}` : 'No close updates yet'}</span>
                      <small>Semantic match · 30-day window</small>
                    </header>
                    {thread.updates.length ? thread.updates.map((item) => (
                      <button className="sampark-thread-update" key={articleKey(item)} onClick={() => onOpenArticle(item)} type="button">
                        <span className="sampark-thread-update-source">{item.src || item.source || 'Intelligence'}</span>
                        <strong className="sampark-thread-update-title">{item.title}</strong>
                        <small className="sampark-thread-update-score">{Math.round(Number(item.follow_match?.score || 0) * 100)}% story match</small>
                      </button>
                    )) : <p className="sampark-thread-waiting">We will add an update only when its meaning is genuinely close to this story.</p>}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        <footer className="sampark-following-footer">
          <span className="sampark-following-footnote">{threads.length ? `${threads.length} thread${threads.length===1?'':'s'} · private to this browser` : ''}</span>
          <button className="btn-secondary" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
}

// ========== Card — clean language, image never cropped (contain + letterbox) ==========
function SamparkForYouCard({ item, large, saved, savedReady, busy, isPending, onOpen, onSave, onHide, onReact }) {
  const image = imageOf(item);
  const busyReaction = isPending ? isPending(item, 'reaction') : busy;
  const busySave = isPending ? isPending(item, 'save') : busy;
  const busyHide = isPending ? isPending(item, 'hide') : busy;
  return (
    <article className={large ? 'sampark-news-card-large' : 'sampark-news-card'}>
      <button aria-label={`Open dossier for ${item.title}`} className={large ? 'sampark-card-media' : 'sampark-card-media-sm'} onClick={() => onOpen(item)} type="button">
        {image ? <img alt="" className="sampark-card-img" src={image} loading="lazy" /> : <span className="sampark-card-img-placeholder"><Icon name="globe" size={28} /></span>}
        <span className="sampark-card-source-badge">{item.src || item.source || 'TechScout'}</span>
      </button>
      <div className="sampark-card-body">
        <button className="sampark-card-title-btn" onClick={() => onOpen(item)} type="button"><h4>{item.title}</h4></button>
        <p className="sampark-card-summary">{item.summary || item.master_summary || 'Open the dossier for the full summary.'}</p>
        <div className="sampark-card-footer">
          <span className="sampark-card-meta"><Icon name="clock" size={12} /> {item.date || 'Latest'} · {item.category || 'Intelligence'}</span>
          <div className="sampark-card-actions">
            <SamparkTooltip label="Like"><span><ReactionButton disabled={busyReaction} item={item} onReact={onReact} reaction="like" /></span></SamparkTooltip>
            <SamparkTooltip label="Dislike"><span><ReactionButton disabled={busyReaction} item={item} onReact={onReact} reaction="dislike" /></span></SamparkTooltip>
            <SamparkTooltip label={saved ? 'Unfollow' : 'Follow'}><button aria-label={`${saved ? 'Stop following' : 'Follow'} ${item.title}`} className={`sampark-card-action${saved ? ' is-active' : ''}`} disabled={busySave || !savedReady} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={14} /></button></SamparkTooltip>
            <SamparkTooltip label="Hide"><button aria-label={`Hide ${item.title}`} className="sampark-card-action" disabled={busyHide} onClick={() => onHide(item)} type="button"><Icon name="eye" size={14} /></button></SamparkTooltip>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function SamparkForYou() {
  const [status, setStatus] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [feed, setFeed] = useState(null);
  const [items, setItems] = useState([]);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [savedState, setSavedState] = useState({ status: 'loading', error: '' });
  const [openArticle, setOpenArticle] = useState(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState(null);
  const [busyActions, setBusyActions] = useState({});
  const [reviewed, setReviewed] = useState(() => new Set());
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [followingThreads, setFollowingThreads] = useState([]);
  const [followingState, setFollowingState] = useState({ status: 'idle', error: '' });
  const [followingBusy, setFollowingBusy] = useState('');
  const actionLocks = useRef(new Set());
  const savedRequest = useRef(0);

  const labels = useMemo(() => metaLabels(status, preferences), [status, preferences]);
  const { record, flush } = useRecommendationEvents(
    feed?.feed_request_id,
    status?.event_flush_seconds || 15,
    status?.event_batch_size || 10,
  );
  const dwellStarted = useRef(0);
  const dwellAccumulated = useRef(0);
  const [activity, setActivity] = useState(null);
  const loadActivity = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await getViewerActivitySummary(tz);
      setActivity(res?.activity || null);
    } catch {}
  }, []);

  useEffect(() => () => { flush({ keepalive: true }); }, [flush]);

  const loadFeed = useCallback(async () => {
    const result = await getForYou({ limit: 20 });
    const normalized = normalizeList(result?.items || []);
    setFeed({ ...result, items: normalized });
    setItems(normalized);
    return result;
  }, []);

  const loadMore = useCallback(async () => {
    if (!feed?.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getForYou({ cursor: feed.cursor, limit: 20 });
      if (result?.cursor_reset) {
        const fresh = await getForYou({ limit: 20 });
        const normalized = normalizeList(fresh?.items || []);
        setFeed({ ...fresh, items: normalized });
        setItems(normalized);
        setActionNotice({ message: 'The edition changed — refreshed from the beginning.' });
        return;
      }
      const nextItems = normalizeList(result?.items || []);
      setItems((current) => {
        const known = new Set(current.map(articleKey));
        return [...current, ...nextItems.filter((it) => !known.has(articleKey(it)))];
      });
      setFeed((cur) => ({ ...cur, cursor: result?.cursor || null, total: result?.total ?? cur?.total, items: [...(cur?.items || []), ...nextItems] }));
    } catch (e) {
      setError(e?.message || 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }, [feed?.cursor, loadingMore]);

  const loadSavedState = useCallback(async () => {
    const requestId = savedRequest.current + 1;
    savedRequest.current = requestId;
    setSavedState((current) => ({ status: current.status === 'ready' ? 'stale' : 'loading', error: '' }));
    try {
      const saved = await getViewerSaved();
      if (savedRequest.current !== requestId) return;
      setSavedKeys(new Set(normalizeList(saved?.items || []).map(articleKey)));
      setSavedState({ status: 'ready', error: '' });
    } catch (nextError) {
      if (savedRequest.current !== requestId) return;
      setSavedState((current) => ({
        status: current.status === 'stale' ? 'stale-error' : 'error',
        error: nextError?.message || 'Following status could not be verified.',
      }));
    }
  }, []);

  const loadFollowing = useCallback(async () => {
    setFollowingState({ status: 'loading', error: '' });
    try {
      const response = await getFollowingThreads();
      const threads = (response?.threads || []).map((thread, index) => ({
        ...thread,
        anchor: normalizeList([thread.anchor])[0] || thread.anchor,
        updates: (thread.updates || []).map((item, idx) => normalizeList([item])[0] || item).filter(Boolean),
      })).filter((t) => t.anchor);
      setFollowingThreads(threads);
      setFollowingState({ status: 'ready', error: '' });
    } catch (e) {
      setFollowingState({ status: 'error', error: e?.message || 'Could not open your followed stories.' });
    }
  }, []);

  const openFollowing = () => {
    setFollowingOpen(true);
    loadFollowing();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextStatus = await getRecommendationStatus();
        if (cancelled) return;
        setStatus(nextStatus);
        const pref = await getViewerPreferences();
        if (cancelled) return;
        const prefData = pref?.preferences || {};
        setPreferences(prefData);
        // Fresh viewer onboarding: auto-open 3-step wizard if enabled and not completed
        if (nextStatus?.enabled && !prefData?.completed_at) {
          setPrefsOpen(true);
        }
        if (nextStatus?.enabled) await loadFeed();
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || 'Could not prepare your intelligence mix.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    loadSavedState();
    loadActivity();
    return () => {
      cancelled = true;
      savedRequest.current += 1;
    };
  }, [loadAttempt, loadFeed, loadSavedState, loadActivity]);

  const reactionSignature = useMemo(() => items.map(reactionIdentity).filter(Boolean).join('|'), [items]);
  useEffect(() => {
    if (!reactionSignature) return undefined;
    let cancelled = false;
    const identities = reactionSignature.split('|');
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await getViewerReactions(identities);
        if (cancelled) return;
        const snapshots = result?.reactions || {};
        const apply = (candidate) => {
          const identity = reactionIdentity(candidate);
          return snapshots[identity] ? { ...candidate, reactions: snapshots[identity] } : candidate;
        };
        setItems((current) => current.map(apply));
        setOpenArticle((current) => current ? apply(current) : current);
      } catch {}
    };
    const timer = window.setInterval(sync, 12000);
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
    };
  }, [reactionSignature]);

  const runItemAction = async (action, item, work) => {
    const baseKey = articleKey(item);
    const key = `${baseKey}::${action}`;
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setBusyActions((current) => ({ ...current, [key]: true }));
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
  const isPending = (item, action) => {
    const base = articleKey(item);
    return Boolean(busyActions[`${base}::${action}`]);
  };
  const isBusy = (item) => {
    const base = articleKey(item);
    return Boolean(busyActions[`${base}::reaction`] || busyActions[`${base}::save`] || busyActions[`${base}::hide`]);
  };

  const shouldRecordPassive = () => {
    try {
      const s = readSamparkSettings();
      if (s.personalizedFeed === false) return false;
    } catch {}
    return status?.mode !== 'paused';
  };

  const openDossier = (item) => {
    dwellAccumulated.current = 0;
    dwellStarted.current = document.visibilityState === 'visible' ? Date.now() : 0;
    setOpenArticle(item);
    setReviewed((current) => {
      const next = new Set(current);
      next.add(articleKey(item));
      return next;
    });
    if (shouldRecordPassive()) record('dossier_open', item, { section: 'for_you' });
  };

  const closeDossier = () => {
    const activeMs = dwellAccumulated.current + (dwellStarted.current ? Date.now() - dwellStarted.current : 0);
    const didRecord = openArticle && activeMs >= 5000 && shouldRecordPassive();
    if (didRecord) record('dossier_dwell', openArticle, { active_ms: activeMs, section: 'dossier' });
    dwellStarted.current = 0;
    dwellAccumulated.current = 0;
    setOpenArticle(null);
    flush();
    if (didRecord) setTimeout(() => loadActivity(), 900);
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

  const toggleSave = async (item) => {
    if (savedState.status !== 'ready') {
      setError('Following status must be verified before it can be changed.');
      return;
    }
    const key = articleKey(item);
    if (actionLocks.current.has(`${key}::save`)) return;
    const wasSaved = savedKeys.has(key);
    // optimistic immediate update
    setSavedKeys((current) => {
      const next = new Set(current);
      if (wasSaved) next.delete(key);
      else next.add(key);
      return next;
    });
    setActionNotice({ message: wasSaved ? 'Removed from followed stories.' : 'Saved and followed privately.' });
    return runItemAction('save', item, async () => {
      try {
        if (wasSaved) await removeSavedArticle(item);
        else await saveArticleForLater(item);
        setTimeout(() => loadActivity(), 700);
      } catch (e) {
        // precise rollback
        setSavedKeys((current) => {
          const next = new Set(current);
          if (wasSaved) next.add(key);
          else next.delete(key);
          return next;
        });
        setActionNotice({ message: e?.message || 'Follow action failed' });
        throw e;
      }
    });
  };

  const hide = async (item) => {
    const key = articleKey(item);
    if (actionLocks.current.has(`${key}::hide`)) return;
    const captured = item;
    const { prevKey, nextKey, idx: capturedIndex } = findNeighbors(items, key);
    // optimistic immediate hide via pure helper
    setItems((current) => hideOptimistic(current, key));
    setActionNotice({ message: 'Hidden only from your feed.' });
    return runItemAction('hide', item, async () => {
      try {
        await hideArticleForViewer(item);
        record('hide', item);
        setTimeout(() => loadActivity(), 700);
      } catch (e) {
        setItems((current) => hideRollback(current, captured, prevKey, nextKey, capturedIndex));
        setActionNotice({ message: e?.message || 'Hide failed' });
        throw e;
      }
    });
  };

  const handleSourceOpen = (item) => { if (shouldRecordPassive()) record('source_open', item, { section: 'dossier' }); };
  const handleWhyOpen = (item) => { if (shouldRecordPassive()) record('why_this_story_open', item, { section: 'dossier' }); };

  const unfollowThread = async (thread) => {
    const key = articleKey(thread.anchor);
    if (followingBusy) return;
    setFollowingBusy(key);
    try {
      await removeSavedArticle(thread.anchor);
      setFollowingThreads((cur) => cur.filter((t) => articleKey(t.anchor) !== key));
      setSavedKeys((cur) => {
        const next = new Set(cur);
        next.delete(key);
        return next;
      });
      setActionNotice({ message: 'Unfollowed.' });
    } catch (e) {
      setError(e?.message || 'Could not unfollow.');
    } finally {
      setFollowingBusy('');
    }
  };

  const react = async (item, reaction) => {
    const key = articleKey(item);
    if (actionLocks.current.has(`${key}::reaction`)) return;
    const prevSnap = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
    const cur = prevSnap.viewer_reaction || 'neutral';
    const nextReaction = cur === reaction ? 'neutral' : reaction;
    const optimistic = (() => {
      let lc = Number(prevSnap.like_count || 0);
      let dc = Number(prevSnap.dislike_count || 0);
      if (cur === 'like') lc = Math.max(0, lc - 1);
      if (cur === 'dislike') dc = Math.max(0, dc - 1);
      if (nextReaction === 'like') lc += 1;
      if (nextReaction === 'dislike') dc += 1;
      return { like_count: lc, dislike_count: dc, viewer_reaction: nextReaction };
    })();
    const applyOptimistic = (candidate) => articleKey(candidate) === key ? { ...candidate, reactions: optimistic } : candidate;
    // optimistic immediate update with correct counts for neutral→like, like→neutral, like→dislike, etc.
    setItems((currentItems) => currentItems.map(applyOptimistic));
    setOpenArticle((currentArticle) => currentArticle && articleKey(currentArticle) === key ? applyOptimistic(currentArticle) : currentArticle);
    return runItemAction('reaction', item, async () => {
      try {
        const response = await setViewerReaction(item, nextReaction);
        const snap = { like_count: response.like_count, dislike_count: response.dislike_count, viewer_reaction: response.viewer_reaction };
        const applyServer = (candidate) => articleKey(candidate) === key ? { ...candidate, reactions: snap } : candidate;
        // reconcile with authoritative server response
        setItems((currentItems) => currentItems.map(applyServer));
        setOpenArticle((currentArticle) => currentArticle && articleKey(currentArticle) === key ? applyServer(currentArticle) : currentArticle);
        setActionNotice({ message: nextReaction === 'neutral' ? 'Reaction removed.' : `Your ${nextReaction} was counted.` });
        setTimeout(() => loadActivity(), 700);
      } catch (e) {
        // precise rollback
        const rollback = (candidate) => articleKey(candidate) === key ? { ...candidate, reactions: prevSnap } : candidate;
        setItems((currentItems) => currentItems.map(rollback));
        setOpenArticle((currentArticle) => currentArticle && articleKey(currentArticle) === key ? rollback(currentArticle) : currentArticle);
        setActionNotice({ message: e?.message || 'Reaction failed' });
        throw e;
      }
    });
  };

  // Five is a layout number, not a feed cap. Backend dictates count (limit 20 + cursor).
  // We keep the stable snapshot; pagination can extend far beyond 20 when cursor permits.
  const featured = items.slice(0, 5);
  const remaining = items.slice(5);

  const formatTrend = (current, previous, trend, state) => {
    if (state === 'new') return 'New';
    if (state === 'stable' && current === 0 && previous === 0) return '—';
    if (trend === null || trend === undefined) return '—';
    if (trend === 0) return '—';
    const sign = trend > 0 ? '↑' : '↓';
    return `${sign} ${Math.abs(trend)}%`;
  };
  const newsTrendLabel = activity ? `${formatTrend(activity.news_read.today, activity.news_read.yesterday, activity.news_read.trend_percent, activity.news_read.trend_state)} vs yesterday` : '—';
  const likesTrendLabel = activity ? `${formatTrend(activity.likes.this_week, activity.likes.last_week, activity.likes.trend_percent, activity.likes.trend_state)} vs last week` : '—';

  if (loading) {
    return (
      <div className="sampark-for-you-page">
        <div className="sampark-for-you-loading" role="status"><span className="sampark-spinner" /> Preparing your intelligence mix…</div>
      </div>
    );
  }

  if (error && !feed) {
    return (
      <div className="sampark-for-you-page">
        <div className="sampark-for-you-error" role="alert"><Icon name="warning" size={20} /><p>{error}</p><button className="btn-primary" onClick={() => { setError(''); setLoading(true); setLoadAttempt((c) => c + 1); }} type="button">Try again</button></div>
      </div>
    );
  }

  if (status && !status.enabled) {
    return (
      <div className="sampark-for-you-page">
        <div className="sampark-for-you-disabled" role="status"><Icon name="sparkle" size={22} /><h2>For You is ready for its pilot</h2><p>The recommendation service is installed but disabled by configuration. Your shared Briefing remains unchanged.</p></div>
      </div>
    );
  }

  return (
    <div className="sampark-for-you-page">
      {actionNotice && <div className="sampark-for-you-feedback" role="status"><span>{actionNotice.message}</span><button aria-label="Dismiss" onClick={() => setActionNotice(null)} type="button"><Icon name="x" size={14} /></button></div>}
      {['error', 'stale-error'].includes(savedState.status) && <div className="sampark-for-you-feedback is-error" role="alert"><span>{savedState.error}</span> <button onClick={loadSavedState} type="button">Retry</button></div>}

      <section className="sampark-preferences-bar">
        <span className="sampark-pref-label">Your Preferences:</span>
        <div className="sampark-pref-tags">
          {labels.map((label) => <span className="sampark-pref-tag" key={label}>{label}</span>)}
        </div>
        <button className="sampark-view-prefs-link" onClick={() => setPrefsOpen(true)} type="button">Edit Preferences</button>
      </section>

      <section className="sampark-activity-section" aria-labelledby="sampark-activity-title">
        <div className="sampark-activity-head">
          <h3 className="sampark-section-title" id="sampark-activity-title">Your Activities</h3>
          {savedKeys.size > 0 && (
            <button className="sampark-following-pill" onClick={openFollowing} type="button"><Icon name="bookmark" size={14} /> Following · {savedKeys.size} <Icon name="chevR" size={12} /></button>
          )}
        </div>
        <div className="sampark-metrics-grid">
          <div className="sampark-metric-card">
            <span className="sampark-metric-icon blue"><Icon name="eye" size={18} /></span>
            <div className="sampark-metric-info">
              <div className="sampark-metric-value">{activity ? activity.news_read.today : 0}</div>
              <div className="sampark-metric-label">News read</div>
              <div className="sampark-metric-sub">TODAY · {activity ? newsTrendLabel : '—'}</div>
            </div>
          </div>
          <div className="sampark-metric-card">
            <span className="sampark-metric-icon green"><Icon name="thumbsUp" size={18} /></span>
            <div className="sampark-metric-info">
              <div className="sampark-metric-value">{activity ? activity.likes.this_week : 0}</div>
              <div className="sampark-metric-label">Likes</div>
              <div className="sampark-metric-sub">THIS WEEK · {activity ? likesTrendLabel : '—'}</div>
            </div>
          </div>
          <button className="sampark-metric-card is-interactive" onClick={openFollowing} type="button">
            <span className="sampark-metric-icon purple"><Icon name="bookmark" size={18} /></span>
            <div className="sampark-metric-info">
              <div className="sampark-metric-value">{activity ? activity.following.total : savedKeys.size}</div>
              <div className="sampark-metric-label">Following</div>
              <div className="sampark-metric-sub">TOTAL</div>
            </div>
            <Icon name="chevR" size={14} />
          </button>
        </div>
      </section>

      <section className="sampark-news-for-you" aria-labelledby="sampark-selected-title">
        <div className="sampark-section-head">
          <h3 className="sampark-section-title" id="sampark-selected-title">News Selected For You</h3>
          <button className="sampark-following-inline" onClick={openFollowing} type="button"><Icon name="bookmark" size={14} /> Following ({savedKeys.size})</button>
        </div>
        {featured.length ? (
          <>
            {/* ONE composition: 1 large + 2×2 beside it — five together, no vertical scroll */}
            <div className="sampark-foryou-grid">
              <SamparkForYouCard
                isPending={isPending}
                item={featured[0]}
                large
                onHide={hide}
                onOpen={openDossier}
                onReact={react}
                onSave={toggleSave}
                saved={savedKeys.has(articleKey(featured[0]))}
                savedReady={savedState.status === 'ready'}
              />
              <div className="sampark-news-card-small-grid">
                {featured.slice(1).map((item) => (
                  <SamparkForYouCard
                    isPending={isPending}
                    item={item}
                    key={articleKey(item)}
                    onHide={hide}
                    onOpen={openDossier}
                    onReact={react}
                    onSave={toggleSave}
                    saved={savedKeys.has(articleKey(item))}
                    savedReady={savedState.status === 'ready'}
                  />
                ))}
              </div>
            </div>

            {remaining.length ? (
              <div className="sampark-for-you-remaining">
                <h4 className="sampark-remaining-title">More for you · {remaining.length} of {feed?.total ?? items.length}{feed?.cursor ? '+' : ''}</h4>
                <div className="sampark-for-you-more-grid">
                  {remaining.map((item) => (
                    <SamparkForYouCard
                      isPending={isPending}
                      item={item}
                      key={articleKey(item)}
                      onHide={hide}
                      onOpen={openDossier}
                      onReact={react}
                      onSave={toggleSave}
                      saved={savedKeys.has(articleKey(item))}
                      savedReady={savedState.status === 'ready'}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {feed?.cursor && (
              <div className="sampark-load-more">
                <button className="btn-primary" disabled={loadingMore} onClick={loadMore} type="button">
                  {loadingMore ? 'Loading…' : `Load more · ${feed?.total ? `${Math.max(0, feed.total - items.length)} remaining` : 'more recommendations'}`}
                </button>
                <span className="sampark-load-hint">{items.length} of {feed?.total ?? '—'} ranked for you</span>
              </div>
            )}
          </>
        ) : (
          <div className="sampark-for-you-empty"><Icon name="sparkle" size={22} /><p>Your mix is waiting for fresh signals. Tune your interests or open the shared Briefing.</p><button className="btn-primary" onClick={() => setPrefsOpen(true)} type="button">Tune interests</button></div>
        )}
      </section>

      <SamparkPreferencesModal
        initial={preferences}
        onClose={() => setPrefsOpen(false)}
        onSaved={(next) => { setPreferences(next); setLoadAttempt((c) => c + 1); }}
        open={prefsOpen}
        taxonomy={status?.taxonomy}
      />
      <SamparkFollowingModal
        busy={followingBusy}
        error={followingState.status === 'error' ? followingState.error : ''}
        loading={followingState.status === 'loading'}
        onClose={() => setFollowingOpen(false)}
        onOpenArticle={(item) => { setFollowingOpen(false); openDossier(item); }}
        onRetry={loadFollowing}
        onUnfollow={unfollowThread}
        open={followingOpen}
        threads={followingThreads}
      />
      <SamparkArticleDossier
        item={openArticle}
        onClose={closeDossier}
        onHide={async (item) => { closeDossier(); await hide(item); }}
        onReact={react}
        onSave={toggleSave}
        onSourceOpen={handleSourceOpen}
        onWhyOpen={handleWhyOpen}
        trailingMeta={openArticle && openArticle.mins_read ? `${openArticle.mins_read} min read` : ''}
        saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false}
        savedHydrated={savedState.status === 'ready'}
        reactionsHydrated
        titleId="sampark-dossier-title"
      />
    </div>
  );
}
