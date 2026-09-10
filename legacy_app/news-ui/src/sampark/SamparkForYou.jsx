import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import {
  completeViewerPreferences,
  getFollowingThreads,
  getForYou,
  getRecommendationStatus,
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

// ========== Article Dossier Modal — premium, full-image, no crop ==========
function SamparkArticleModal({ item, onClose, saved, onSave, onHide, onReact, onSourceOpen, onWhyOpen }) {
  const dialogRef = useModalFocus(Boolean(item), onClose);
  if (!item) return null;
  const image = imageOf(item);
  const reactions = item.reactions || { like_count: 0, dislike_count: 0, viewer_reaction: 'neutral' };
  // Authoritative dossier fields already produced by the backend pipeline
  // (BART/Samsung Chat summary + FLAN-T5 why_matters). Sampark consumes them;
  // it does not generate its own summary/points.
  const lead = item.summary_lead || item.summary || item.master_summary || '';
  const points = Array.isArray(item.summary_points) ? item.summary_points : [];
  const whyMatters = item.why_matters || item.why_it_matters || item.attention_hook || '';
  const sourceLink = item.link || item.url || '';

  return (
    <div className="sampark-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="sampark-dossier-title" aria-modal="true" className="sampark-dossier sampark-dossier--large" ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="sampark-dossier-header">
          <div>
            <div className="sampark-dossier-kicker">{item.category || 'Intelligence'} · {item.src || item.source || 'TechScout'} · {item.date || 'Latest'}</div>
            <div className="sampark-dossier-subtitle">{item.region || 'Global'} · {item.source_count || 1} source{(item.source_count||1)===1?'':'s'} · {item.mins_read || 1} min read</div>
          </div>
          <button aria-label="Close dossier" className="sampark-dossier-close" onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>

        <div className="sampark-dossier-scroll">
          {image ? (
            <div className="sampark-dossier-media">
              {/* object-fit: contain, neutral letterbox, never cropped */}
              <img alt="" className="sampark-dossier-img" src={image} />
            </div>
          ) : (
            <div className="sampark-dossier-media is-placeholder"><Icon name="globe" size={42} /></div>
          )}

          <div className="sampark-dossier-body">
            <h2 id="sampark-dossier-title" className="sampark-dossier-title">{item.title}</h2>
            {lead && <p className="sampark-dossier-summary">{lead}</p>}
            {points.length ? (
              <ul className="sampark-dossier-points">
                {points.slice(0, 5).map((point, idx) => <li key={idx}>{point}</li>)}
              </ul>
            ) : null}
            {sourceLink ? <a className="sampark-dossier-link" href={sourceLink} onClick={() => onSourceOpen?.(item)} rel="noreferrer" target="_blank">Open original source <Icon name="external" size={14} /></a> : null}
            {whyMatters ? (
              <button className="sampark-dossier-insight sampark-why-btn" onClick={() => onWhyOpen?.(item)} type="button">
                <strong>Why this matters</strong>
                <p>{whyMatters}</p>
              </button>
            ) : null}
            {item.keywords?.length ? (
              <div className="sampark-dossier-keywords">
                {item.keywords.slice(0, 8).map((kw) => <span key={kw} className="sampark-keyword">{kw}</span>)}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="sampark-dossier-actions">
          <button className={`sampark-action-btn${reactions.viewer_reaction === 'like' ? ' is-active' : ''}`} onClick={() => onReact(item, 'like')} type="button"><Icon name="thumbsUp" size={16} /> {reactions.like_count || 0} Like</button>
          <button className={`sampark-action-btn${reactions.viewer_reaction === 'dislike' ? ' is-active' : ''}`} onClick={() => onReact(item, 'dislike')} type="button"><Icon name="thumbsDown" size={16} /> {reactions.dislike_count || 0}</button>
          <button className={`sampark-action-btn${saved ? ' is-active' : ''}`} onClick={() => onSave(item)} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={16} /> {saved ? 'Following' : 'Follow'}</button>
          <button className="sampark-action-btn" onClick={() => onHide(item)} type="button"><Icon name="eye" size={16} /> Hide</button>
          <span className="sampark-dossier-spacer" />
          <button className="sampark-action-btn sampark-action-close" onClick={onClose} type="button">Close</button>
        </footer>
      </section>
    </div>
  );
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
function SamparkForYouCard({ item, large, saved, savedReady, busy, onOpen, onSave, onHide, onReact }) {
  const image = imageOf(item);
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
            <ReactionButton disabled={busy} item={item} onReact={onReact} reaction="like" />
            <ReactionButton disabled={busy} item={item} onReact={onReact} reaction="dislike" />
            <button aria-label={`${saved ? 'Stop following' : 'Follow'} ${item.title}`} className={`sampark-card-action${saved ? ' is-active' : ''}`} disabled={busy || !savedReady} onClick={() => onSave(item)} title={saved ? 'Stop following' : 'Follow and save'} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={14} /></button>
            <button aria-label={`Hide ${item.title}`} className="sampark-card-action" disabled={busy} onClick={() => onHide(item)} title="Hide from your feed" type="button"><Icon name="eye" size={14} /></button>
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
        setPreferences(pref?.preferences || {});
        if (nextStatus?.enabled) await loadFeed();
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || 'Could not prepare your intelligence mix.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    loadSavedState();
    return () => {
      cancelled = true;
      savedRequest.current += 1;
    };
  }, [loadAttempt, loadFeed, loadSavedState]);

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

  const openDossier = (item) => {
    dwellAccumulated.current = 0;
    dwellStarted.current = document.visibilityState === 'visible' ? Date.now() : 0;
    setOpenArticle(item);
    setReviewed((current) => {
      const next = new Set(current);
      next.add(articleKey(item));
      return next;
    });
    record('dossier_open', item, { section: 'for_you' });
  };

  const closeDossier = () => {
    const activeMs = dwellAccumulated.current + (dwellStarted.current ? Date.now() - dwellStarted.current : 0);
    if (openArticle && activeMs >= 5000) record('dossier_dwell', openArticle, { active_ms: activeMs, section: 'dossier' });
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

  const toggleSave = async (item) => {
    if (savedState.status !== 'ready') {
      setError('Following status must be verified before it can be changed.');
      return;
    }
    return runItemAction('save', item, async () => {
      const key = articleKey(item);
      const saved = savedKeys.has(key);
      if (saved) await removeSavedArticle(item);
      else await saveArticleForLater(item);
      setSavedKeys((current) => {
        const next = new Set(current);
        if (saved) next.delete(key);
        else next.add(key);
        return next;
      });
      setActionNotice({ message: saved ? 'Removed from followed stories.' : 'Saved and followed privately.' });
    });
  };

  const hide = async (item) => runItemAction('hide', item, async () => {
    await hideArticleForViewer(item);
    setItems((current) => current.filter((candidate) => articleKey(candidate) !== articleKey(item)));
    record('hide', item);
    setActionNotice({ message: 'Hidden only from your feed.' });
  });

  const handleSourceOpen = (item) => record('source_open', item, { section: 'dossier' });
  const handleWhyOpen = (item) => record('why_this_story_open', item, { section: 'dossier' });

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

  const react = async (item, reaction) => runItemAction('reaction', item, async () => {
    const current = item.reactions?.viewer_reaction || 'neutral';
    const nextReaction = current === reaction ? 'neutral' : reaction;
    const response = await setViewerReaction(item, nextReaction);
    const apply = (candidate) => articleKey(candidate) === articleKey(item)
      ? { ...candidate, reactions: { like_count: response.like_count, dislike_count: response.dislike_count, viewer_reaction: response.viewer_reaction } }
      : candidate;
    setItems((currentItems) => currentItems.map(apply));
    setOpenArticle((currentArticle) => currentArticle && articleKey(currentArticle) === articleKey(item) ? apply(currentArticle) : currentArticle);
    setActionNotice({ message: nextReaction === 'neutral' ? 'Reaction removed.' : `Your ${nextReaction} was counted.` });
  });

  // Five is a layout number, not a feed cap. Backend dictates count (limit 20 + cursor).
  // We keep the stable snapshot; pagination can extend far beyond 20 when cursor permits.
  const featured = items.slice(0, 5);
  const remaining = items.slice(5);
  const likedCount = items.filter((i) => i.reactions?.viewer_reaction === 'like').length;

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
          <div className="sampark-metric-card"><span className="sampark-metric-icon blue"><Icon name="eye" size={18} /></span><div className="sampark-metric-info"><div className="sampark-metric-value">{reviewed.size}</div><div className="sampark-metric-label">News read</div></div></div>
          <div className="sampark-metric-card"><span className="sampark-metric-icon green"><Icon name="thumbsUp" size={18} /></span><div className="sampark-metric-info"><div className="sampark-metric-value">{likedCount}</div><div className="sampark-metric-label">Likes</div></div></div>
          <button className="sampark-metric-card is-interactive" onClick={openFollowing} type="button"><span className="sampark-metric-icon purple"><Icon name="bookmark" size={18} /></span><div className="sampark-metric-info"><div className="sampark-metric-value">{savedKeys.size}</div><div className="sampark-metric-label">Follows · View</div></div><Icon name="chevR" size={14} /></button>
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
                busy={Boolean(busyActions[articleKey(featured[0])])}
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
                    busy={Boolean(busyActions[articleKey(item)])}
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
                      busy={Boolean(busyActions[articleKey(item)])}
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
      <SamparkArticleModal
        item={openArticle}
        onClose={closeDossier}
        onHide={async (item) => { closeDossier(); await hide(item); }}
        onReact={react}
        onSave={toggleSave}
        onSourceOpen={handleSourceOpen}
        onWhyOpen={handleWhyOpen}
        saved={openArticle ? savedKeys.has(articleKey(openArticle)) : false}
      />
    </div>
  );
}
