import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ArticleCard from '../components/ArticleCard.jsx';
import Icon from '../components/Icon.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import {
  createViewerBriefings,
  clearViewerBriefings,
  getViewerPersonalization,
  getViewerPreferences,
  getViewerBriefings,
  getViewerProfile,
  getViewerSaved,
  removeSavedArticle,
  retryViewerBriefing,
  resetViewerPersonalization,
  pauseViewerPersonalization,
  saveArticleForLater,
  selectWorkflow,
} from '../api.js';
import { normalizeArticle, normalizeList } from '../utils/normalize.js';
import { articleKey } from '../utils/intelligence.js';
import { articleActivityDetail, trackAction } from '../utils/tracking.js';
import { CONTRIBUTION_STATUS } from '../internal/contributionModel.js';
import ContributionWorkspace from '../components/personal-desk/ContributionWorkspace.jsx';
import useContributions from '../components/personal-desk/useContributions.js';
import '../styles/personal-desk.css';
import '../styles/personal-desk-redesign.css';
import '../styles/desk-study.css';
import '../styles/contribution-workspace.css';

const terminalStatuses = new Set(['complete', 'failed']);

// Ordered desk workspaces. Saved Signals leads; Contribute sits between it and
// My Briefing. Keyboard arrows cycle through this array in order.
const DESK_TABS = [
  { id: 'saved', label: 'Following', icon: 'bookmark' },
  { id: 'contribute', label: 'Contribute', icon: 'note' },
  { id: 'briefings', label: 'My Briefing', icon: 'sparkle' },
];
const DESK_TAB_IDS = DESK_TABS.map((entry) => entry.id);
const DEFAULT_DESK_TAB = DESK_TAB_IDS[0];

function initialDeskTab() {
  if (typeof window === 'undefined') return DEFAULT_DESK_TAB;
  const stored = window.sessionStorage.getItem('personal-desk-tab');
  return DESK_TAB_IDS.includes(stored) ? stored : DEFAULT_DESK_TAB;
}

// Deep-linkable desk addresses: /saved/contribute, /saved/briefings and
// /saved/leadership (which opens the contribute tab with the leadership
// composer already open). Plain /saved shows the saved signals ledger.
function tabFromPathname(pathname) {
  if (pathname === '/saved/contribute' || pathname === '/saved/leadership') return 'contribute';
  if (pathname === '/saved/briefings') return 'briefings';
  return '';
}

function initialAuthorSuggestion() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('news-viewer-name') || '';
  } catch {
    return '';
  }
}

function deskGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function deskDateLabel(date = new Date()) {
  if (typeof date.toLocaleDateString !== 'function') return '';
  try {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

// The greeting types itself in, like someone writing it for you. Screen
// readers receive the full sentence immediately; reduced motion skips straight
// to the finished line.
function TypeGreeting({ text }) {
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
    [],
  );
  const [visible, setVisible] = useState(reduceMotion ? text.length : 0);

  useEffect(() => {
    if (reduceMotion) {
      setVisible(text.length);
      return undefined;
    }
    setVisible(0);
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(index);
      if (index >= text.length) window.clearInterval(timer);
    }, 34);
    return () => window.clearInterval(timer);
  }, [text, reduceMotion]);

  const done = visible >= text.length;
  return (
    <h1 aria-label={text} className="desk-greeting">
      <span aria-hidden="true">{text.slice(0, visible)}</span>
      <span aria-hidden="true" className={done ? 'desk-caret is-done' : 'desk-caret'} />
    </h1>
  );
}

function jobLabel(job) {
  const labels = {
    queued: 'Queued',
    extracting: 'Opening article',
    web_search: 'Web Search extraction',
    local_extraction: 'Targeted extraction',
    summarizing: 'AI briefing',
    complete: 'Ready',
    failed: 'Needs attention',
  };
  return labels[job.stage] || labels[job.status] || 'Preparing';
}

function BriefingJob({ job, index, onOpen, onRetry, retrying = false }) {
  let host = job.url;
  try { host = new URL(job.url).hostname.replace(/^www\./, ''); } catch {}
  return (
    <article
      className={`personal-job ${job.status}`}
      id={`personal-job-${job.id}`}
      style={{ '--job-index': index }}
    >
      <div className="personal-job-top">
        <span className="personal-job-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="personal-job-state">{jobLabel(job)}</span>
        <strong>{Math.max(0, Math.min(100, Number(job.progress) || 0))}%</strong>
      </div>
      <div className="personal-job-host">{host}</div>
      <div className="personal-job-url">{job.url}</div>
      <div className="personal-job-track" aria-label={`${job.progress || 0}% complete`}>
        <span style={{ width: `${job.progress || 0}%` }} />
      </div>
      <p>{job.message || 'Preparing your private briefing.'}</p>
      {job.status === 'complete' && job.article && (
        <button className="btn-dark-primary" onClick={() => onOpen(job.article)} type="button">
          <Icon name="file" size={14} /> Open briefing
        </button>
      )}
      {job.status === 'failed' && (
        <>
          <div className="personal-job-error">
            {String(job.error || 'The article could not be processed.').replace(/^[A-Za-z]+Error:\s*/, '')}
          </div>
          <button aria-busy={retrying} className="btn-dark-secondary" disabled={retrying} onClick={() => onRetry(job.id)} type="button">
            <Icon name="refresh" size={14} /> {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </>
      )}
    </article>
  );
}

export default function SavedScreen({ view = '', autoStart: requestedAutoStart = '' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const embedded = Boolean(view);
  const [tab, setTab] = useState(() => view || tabFromPathname(location.pathname) || initialDeskTab());
  const [autoStart, setAutoStart] = useState(() => requestedAutoStart || (location.pathname === '/saved/leadership' ? 'leadership' : ''));
  const [savedItems, setSavedItems] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [openArticle, setOpenArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorRecovery, setErrorRecovery] = useState('');
  const [notice, setNotice] = useState('');
  const [urlText, setUrlText] = useState(() => (typeof window === 'undefined' ? '' : window.sessionStorage.getItem('personal-desk-url-draft') || ''));
  const [submitting, setSubmitting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [clearing, setClearing] = useState(false);
  const [personalization, setPersonalization] = useState(null);
  const [recommendationPreferences, setRecommendationPreferences] = useState(null);
  const [busyActions, setBusyActions] = useState({});
  const [retryingJobs, setRetryingJobs] = useState(new Set());
  const [resetting, setResetting] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [authorSuggestion] = useState(initialAuthorSuggestion);
  const [viewerName, setViewerName] = useState(initialAuthorSuggestion);
  const loadInFlight = useRef(false);
  const refreshPending = useRef(false);
  const mounted = useRef(true);
  const actionLocks = useRef(new Set());
  const submitInFlight = useRef(false);
  const retryLocks = useRef(new Set());
  const controlLocks = useRef(new Set());
  const activeTabRef = useRef(tab);
  const urlInputRef = useRef(null);

  const briefingItems = useMemo(
    () => jobs
      .filter((job) => job.status === 'complete' && job.article)
      .map((job, index) => normalizeArticle(job.article, index))
      .filter(Boolean),
    [jobs],
  );
  const { contributions } = useContributions(tab === 'contribute');
  const contributionDrafts = contributions.filter((record) => record.status !== CONTRIBUTION_STATUS.SUBMITTED).length;
  const contributionSubmitted = contributions.filter((record) => record.status === CONTRIBUTION_STATUS.SUBMITTED).length;
  const savedKeys = useMemo(
    () => new Set(savedItems.map(articleKey)),
    [savedItems],
  );
  const activeJobs = jobs.some((job) => !terminalStatuses.has(job.status));
  const finishedJobs = jobs.filter((job) => terminalStatuses.has(job.status)).length;
  const exportItems = briefingItems.filter((item) => selectedKeys.has(articleKey(item)));
  const enteredUrlCount = useMemo(
    () => urlText.split(/[\s,]+/).filter((value) => /^https?:\/\//i.test(value)).length,
    [urlText],
  );

  useEffect(() => {
    if (embedded) return undefined;
    let alive = true;
    getViewerProfile()
      .then((profile) => {
        if (!alive) return;
        const name = String(profile?.display_name || '').trim();
        if (name) setViewerName(name);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [embedded]);

  // One honest sentence about the desk, composed from live data. Ordered by
  // urgency: work in progress beats finished work beats quiet filing.
  const deskStatusLine = useMemo(() => {
    if (loading) return 'Opening your desk…';
    if (error) return "The desk couldn't reach everything just now.";
    const preparing = jobs.filter((job) => !terminalStatuses.has(job.status)).length;
    const ready = briefingItems.length;
    const saved = savedItems.length;
    if (preparing > 0) {
      return preparing === 1
        ? 'One briefing is still preparing — it will be waiting here when you return.'
        : `${preparing} briefings are still preparing — they will be waiting here when you return.`;
    }
    if (ready > 0) {
      return ready === 1
        ? 'Your private briefing is ready below.'
        : `${ready} finished briefings are filed below.`;
    }
    if (saved > 0) {
      return `${saved} signal${saved === 1 ? '' : 's'} filed. Everything else is quiet.`;
    }
    return 'Everything is filed. Nothing needs you right now.';
  }, [loading, error, jobs, briefingItems, savedItems]);

  useEffect(() => {
    activeTabRef.current = tab;
    setError('');
    setErrorRecovery('');
    setNotice('');
    window.sessionStorage.setItem('personal-desk-tab', tab);
  }, [tab]);
  useEffect(() => { window.sessionStorage.setItem('personal-desk-url-draft', urlText); }, [urlText]);

  // React Router keeps this screen mounted while moving between /saved/*
  // addresses. Mirror the address into screen state so client-side deep links
  // behave the same way as a fresh page load.
  useEffect(() => {
    if (view) {
      setTab(view);
      setAutoStart(requestedAutoStart);
      return;
    }
    const routedTab = tabFromPathname(location.pathname);
    if (routedTab) setTab(routedTab);
    else if (location.pathname === '/saved') {
      setTab((current) => (DESK_TAB_IDS.includes(current) ? current : initialDeskTab()));
    }
    setAutoStart(location.pathname === '/saved/leadership' ? 'leadership' : '');
  }, [location.pathname, requestedAutoStart, view]);

  // The URL mirrors the desk tab so every desk surface has a stable,
  // professional address. /saved/leadership additionally opens the leadership
  // composer; once consumed, it degrades to the plain contribute address.
  const deskPathFor = (nextTab, compose = '') => {
    if (compose === 'leadership') return '/saved/leadership';
    if (nextTab === 'contribute') return '/saved/contribute';
    if (nextTab === 'briefings') return '/saved/briefings';
    return '/saved';
  };
  const goToTab = (nextTab) => {
    // Invalidate work from the old view synchronously. Waiting for the tab
    // effect leaves a small window where a late request can paint feedback in
    // the destination view.
    activeTabRef.current = nextTab;
    setAutoStart('');
    setError('');
    setErrorRecovery('');
    setNotice('');
    setTab(nextTab);
    navigate(deskPathFor(nextTab), { replace: location.pathname !== '/' && location.pathname.startsWith('/saved') });
  };

  const cycleDeskTab = (direction) => {
    const index = Math.max(0, DESK_TAB_IDS.indexOf(tab));
    goToTab(DESK_TAB_IDS[(index + direction + DESK_TAB_IDS.length) % DESK_TAB_IDS.length]);
  };
  const deskTabCount = (id) => {
    if (id === 'saved') return savedItems.length;
    if (id === 'contribute') return contributions.length;
    if (id === 'briefings') return briefingItems.length;
    return 0;
  };

  const loadAll = async ({ quiet = false } = {}) => {
    if (loadInFlight.current) {
      // A submit/retry can finish while a poll is still reading the previous
      // snapshot. Queue one follow-up read so the new active job is never
      // missed and background polling always starts.
      refreshPending.current = true;
      return;
    }
    loadInFlight.current = true;
    const requestedTab = tab;
    if (!quiet && mounted.current) setLoading(true);
    try {
      do {
        refreshPending.current = false;
        try {
          let savedResponse = null;
          let briefingResponse = null;
          let personalizationResponse = null;
          let recommendationResponse = null;
          if (tab === 'saved') {
            [savedResponse, personalizationResponse] = await Promise.all([
              getViewerSaved(),
              getViewerPersonalization().catch(() => null),
            ]);
          } else if (tab === 'briefings') {
            briefingResponse = await getViewerBriefings();
          } else if (!embedded) {
            recommendationResponse = await getViewerPreferences().catch(() => null);
          }
          if (!mounted.current || activeTabRef.current !== requestedTab) return;
          if (savedResponse) setSavedItems(normalizeList(savedResponse?.items || []));
          if (briefingResponse) setJobs(Array.isArray(briefingResponse?.jobs) ? briefingResponse.jobs : []);
          if (personalizationResponse) setPersonalization(personalizationResponse);
          if (recommendationResponse) setRecommendationPreferences(recommendationResponse);
          setError('');
          setErrorRecovery('');
        } catch (requestError) {
          if (mounted.current && activeTabRef.current === requestedTab) {
            setError(requestError?.message || 'Could not load your personal desk.');
            setErrorRecovery('reload');
          }
        }
      } while (refreshPending.current && mounted.current);
    } finally {
      loadInFlight.current = false;
      if (!quiet && mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { loadAll(); }, [tab]);
  useEffect(() => {
    if (tab !== 'briefings' || !activeJobs) return undefined;
    const timer = window.setInterval(() => loadAll({ quiet: true }), 1800);
    return () => window.clearInterval(timer);
  }, [activeJobs, tab]);

  const runItemAction = async (action, item, work) => {
    const key = articleKey(item);
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setBusyActions((current) => ({ ...current, [key]: action }));
    setError('');
    setErrorRecovery('');
    setNotice('');
    try {
      return await work();
    } finally {
      actionLocks.current.delete(key);
      setBusyActions((current) => { const next = { ...current }; delete next[key]; return next; });
    }
  };

  const submitUrls = async (event) => {
    event.preventDefault();
    const originTab = tab;
    if (submitInFlight.current) return;
    if (!enteredUrlCount) {
      setError('Paste at least one complete http:// or https:// article URL.');
      setErrorRecovery('urls');
      return;
    }
    if (enteredUrlCount > 20) {
      setError('A private briefing can contain at most 20 article URLs. Remove a few links and try again.');
      setErrorRecovery('urls');
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setError('');
    setErrorRecovery('');
    setNotice('');
    try {
      const response = await createViewerBriefings(urlText);
      if (activeTabRef.current !== originTab) return;
      const accepted = response?.accepted?.length || 0;
      const duplicates = response?.duplicates || [];
      const invalid = response?.invalid || [];
      const dispatchFailures = response?.dispatch_failures || [];
      if (!invalid.length) setUrlText('');
      await loadAll({ quiet: true });
      if (activeTabRef.current !== originTab) return;
      const started = Math.max(0, accepted - dispatchFailures.length);
      setNotice([
        started ? `${started} private briefing${started === 1 ? '' : 's'} started.` : '',
        duplicates.length ? `${duplicates.length} already existed—nothing was processed twice.` : '',
        invalid.length ? `${invalid.length} invalid or unsafe URL${invalid.length === 1 ? '' : 's'} skipped.` : '',
      ].filter(Boolean).join(' '));
      if (dispatchFailures.length) {
        setError(
          `${dispatchFailures.length} briefing worker${dispatchFailures.length === 1 ? '' : 's'} could not start. `
          + 'The links are saved below; use Retry when the service is ready.',
        );
        setErrorRecovery('');
      }
      if (duplicates[0]?.job_id) {
        window.setTimeout(() => {
          document.getElementById(`personal-job-${duplicates[0].job_id}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);
      }
    } catch (requestError) {
      if (activeTabRef.current === originTab) {
        setError(requestError?.message || 'Could not start your private briefing.');
        setErrorRecovery('urls');
      }
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const remove = async (item) => {
    return runItemAction('remove', item, async () => {
      try {
        await removeSavedArticle(item);
        setSavedItems((current) => current.filter((entry) => articleKey(entry) !== articleKey(item)));
        setNotice('Story unfollowed.');
      } catch (requestError) {
        setError(requestError?.message || 'Could not unfollow this story.');
      }
    });
  };
  const toggleSave = async (item) => {
    if (savedKeys.has(articleKey(item))) return remove(item);
    return runItemAction('save', item, async () => {
      try {
        await saveArticleForLater(item);
        setSavedItems((current) => [item, ...current]);
        setNotice('Saved privately to your desk.');
      } catch (requestError) {
        setError(requestError?.message || 'Could not save this signal.');
      }
    });
  };
  const selectForReview = async (item) => {
    return runItemAction('select', item, async () => {
      try {
        await selectWorkflow(item);
        trackAction('select', `personal_briefing:${item.title}`);
        setOpenArticle((current) => current ? { ...current, selected_by: 'you' } : current);
        setNotice('Selected for the shared Review Queue.');
      } catch (requestError) {
        setError(requestError?.message || 'Could not send this briefing to Review Queue.');
      }
    });
  };
  const retry = async (jobId) => {
    if (retryLocks.current.has(jobId)) return;
    retryLocks.current.add(jobId);
    setRetryingJobs((current) => new Set(current).add(jobId));
    setError('');
    setErrorRecovery('');
    try {
      await retryViewerBriefing(jobId);
      await loadAll({ quiet: true });
      setNotice('Retry started. This page will keep updating in the background.');
    } catch (requestError) {
      setError(requestError?.message || 'Could not retry this briefing.');
    } finally {
      retryLocks.current.delete(jobId);
      setRetryingJobs((current) => { const next = new Set(current); next.delete(jobId); return next; });
    }
  };
  const openBriefing = (item) => {
    trackAction('personal_briefing_open', articleActivityDetail(item, 'my_briefing'));
    setOpenArticle(item);
  };
  const openSaved = (item) => {
    trackAction('dossier_open', articleActivityDetail(item, 'saved_signals'));
    setOpenArticle(item);
  };
  const clearFinished = async () => {
    if (!finishedJobs || controlLocks.current.has('clear')) return;
    const confirmed = window.confirm(
      `Clear ${finishedJobs} finished private briefing record${finishedJobs === 1 ? '' : 's'}? Active jobs will stay running.`,
    );
    if (!confirmed) return;
    controlLocks.current.add('clear');
    setClearing(true);
    setError('');
    setErrorRecovery('');
    try {
      const response = await clearViewerBriefings('finished');
      setNotice(`${response?.removed || 0} finished record${response?.removed === 1 ? '' : 's'} cleared. Active work was preserved.`);
      setSelectedKeys(new Set());
      await loadAll({ quiet: true });
    } catch (requestError) {
      setError(requestError?.message || 'Could not clear finished briefing records.');
    } finally {
      controlLocks.current.delete('clear');
      setClearing(false);
    }
  };
  const resetLearning = async () => {
    if (controlLocks.current.has('reset')) return;
    const confirmed = window.confirm(
      'Reset your recent viewing preferences for this profile? Followed stories will stay followed.',
    );
    if (!confirmed) return;
    controlLocks.current.add('reset');
    setResetting(true);
    setError('');
    setErrorRecovery('');
    try {
      const response = await resetViewerPersonalization();
      setPersonalization((current) => ({ ...(current || {}), active: false, event_count: 0, top_interests: [] }));
      setNotice(`${response?.removed_events || 0} recent preference event${response?.removed_events === 1 ? '' : 's'} cleared. Followed stories were preserved.`);
    } catch (requestError) {
      setError(requestError?.message || 'Could not reset your viewing preferences.');
    } finally {
      controlLocks.current.delete('reset');
      setResetting(false);
    }
  };
  const openExport = () => {
    trackAction('personal_briefing_export', `${exportItems.length} private briefing item(s)`);
    setExportOpen(true);
  };
  const togglePersonalization = async () => {
    if (controlLocks.current.has('pause')) return;
    controlLocks.current.add('pause');
    setPauseBusy(true);
    setError('');
    setErrorRecovery('');
    try {
      const paused = !recommendationPreferences.personalization_paused;
      await pauseViewerPersonalization(paused);
      setRecommendationPreferences((current) => ({ ...current, personalization_paused: paused }));
      setNotice(paused ? 'For You personalization paused.' : 'For You personalization resumed.');
    } catch (requestError) {
      setError(requestError?.message || 'Could not update personalization.');
    } finally {
      controlLocks.current.delete('pause');
      setPauseBusy(false);
    }
  };

  return (
    <div className="page-stack personal-desk">
      {!embedded && (
      <>
      <section className="desk-hero">
        <div className="desk-hero-copy">
          <div className="desk-kicker-row">
            <span className="desk-kicker">Private intelligence workspace</span>
            <span className="desk-kicker-date">{deskDateLabel()}</span>
          </div>
          <TypeGreeting text={viewerName ? `${deskGreeting()}, ${viewerName}.` : `${deskGreeting()}.`} />
          <p className="desk-status" aria-live="polite">{deskStatusLine}</p>
          <div className="desk-trust-row">
            <span><Icon name="shield" size={13} /> Private by default</span>
            <span><Icon name="sparkle" size={13} /> AI structured</span>
            <span><Icon name="check" size={13} /> Shared only by you</span>
          </div>
        </div>
        <div className="personal-desk-snapshot" aria-label="Personal desk summary">
          <button onClick={() => goToTab('saved')} type="button">
            <strong className={!loading && !savedItems.length ? 'is-zero' : ''}>{loading ? '—' : savedItems.length}</strong>
            <small>saved</small>
          </button>
          <button onClick={() => goToTab('contribute')} type="button">
            <strong className={!loading && !contributionDrafts ? 'is-zero' : ''}>{loading ? '—' : contributionDrafts}</strong>
            <small>drafts</small>
          </button>
          <button onClick={() => goToTab('contribute')} type="button">
            <strong className={!loading && !contributionSubmitted ? 'is-zero' : ''}>{loading ? '—' : contributionSubmitted}</strong>
            <small>submitted</small>
          </button>
        </div>
      </section>

      <div className="desk-rule">
        <div
          className="desk-tabs"
          role="tablist"
          aria-label="Personal desk sections"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); cycleDeskTab(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); cycleDeskTab(1); }
          }}
        >
          {DESK_TABS.map((entry) => (
            <button
              aria-controls="personal-desk-panel"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? 'active' : ''}
              id={`personal-desk-${entry.id}-tab`}
              key={entry.id}
              onClick={() => goToTab(entry.id)}
              role="tab"
              tabIndex={tab === entry.id ? 0 : -1}
              type="button"
            >
              <Icon name={entry.icon} size={15} /> {entry.label} <span className="desk-tab-count">{deskTabCount(entry.id)}</span>
            </button>
          ))}
        </div>
        {recommendationPreferences && (
          <div className="desk-fineprint" aria-label="For You controls">
            <span>Saved stories tune For You privately.</span>
            <button onClick={() => navigate('/for-you')} type="button">Tune For You</button>
            <button aria-busy={pauseBusy} disabled={pauseBusy} onClick={togglePersonalization} type="button">
              {pauseBusy ? 'Updating…' : recommendationPreferences.personalization_paused ? 'Resume personalization' : 'Pause personalization'}
            </button>
          </div>
        )}
      </div>
      </>
      )}

      {error && <div className="error-banner" role="alert"><span>{error}</span>{errorRecovery === 'reload' && <button className="ml-3 underline" disabled={loading} onClick={() => loadAll()} type="button">Retry this view</button>}{errorRecovery === 'urls' && <button className="ml-3 underline" onClick={() => urlInputRef.current?.focus()} type="button">Return to URL input</button>}</div>}
      {notice && <div className="personal-notice" role="status">{notice}</div>}

      <div
        aria-label={embedded ? (tab === 'saved' ? 'Following' : tab === 'contribute' ? 'Contributions' : 'Private Briefings') : undefined}
        aria-labelledby={embedded ? undefined : `personal-desk-${tab}-tab`}
        id="personal-desk-panel"
        role={embedded ? 'region' : 'tabpanel'}
      >
      {tab === 'contribute' && <ContributionWorkspace authorSuggestion={authorSuggestion} autoStart={autoStart} />}
      {tab === 'briefings' && (
        <>
          <section className="personal-url-studio">
            <div className="personal-url-copy">
              <span className="eyebrow">Private link studio</span>
              <h2>Drop the links.<br />We’ll shape the briefing.</h2>
              <p>Paste up to 20 news article URLs. Leave this page whenever you like—the preparation continues quietly in the background.</p>
              <div className="personal-studio-steps" aria-label="Briefing process">
                <span><b>01</b><small>Validate each article</small></span>
                <span><b>02</b><small>Extract and structure</small></span>
                <span><b>03</b><small>Return a private dossier</small></span>
              </div>
            </div>
            <form className="personal-url-composer" onSubmit={submitUrls}>
              <div className="personal-composer-head">
                <span>Article URLs</span>
                <span>{enteredUrlCount}/20 detected</span>
              </div>
              <textarea
                aria-label="News article URLs"
                aria-describedby="personal-url-help"
                aria-invalid={enteredUrlCount > 20}
                onChange={(event) => setUrlText(event.target.value)}
                ref={urlInputRef}
                placeholder={'https://example.com/article-one\nhttps://example.com/article-two'}
                value={urlText}
              />
              <span className="sr-only" id="personal-url-help">Enter between one and twenty complete news article URLs. Your draft is kept in this browser if you leave the page.</span>
              <div className="personal-url-actions">
                <span><Icon name="shield" size={14} /> Private to your identity</span>
                <button aria-busy={submitting} className="btn-dark-primary" disabled={submitting || !urlText.trim() || enteredUrlCount > 20} type="submit">
                  <Icon name="sparkle" size={15} /> {submitting ? 'Checking links…' : 'Create my briefing'}
                </button>
              </div>
            </form>
          </section>

          {!!jobs.length && (
            <section className="personal-workstream personal-live-workstream">
              <div className="personal-section-head">
                <div><span className="eyebrow">Live preparation</span><h2>Link studio</h2></div>
                <div className="personal-section-actions">
                  <button className="btn-dark-secondary" disabled={!finishedJobs || clearing} onClick={clearFinished} type="button"><Icon name="trash" size={14} /> {clearing ? 'Clearing…' : `Clear finished (${finishedJobs})`}</button>
                  <button className="btn-dark-secondary" disabled={loading} onClick={() => loadAll()} type="button"><Icon name="refresh" size={14} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
                </div>
              </div>
              <div className="personal-job-grid">
                {jobs.map((job, index) => (
                  <BriefingJob key={job.id} job={job} index={index} onOpen={openBriefing} onRetry={retry} retrying={retryingJobs.has(job.id)} />
                ))}
              </div>
            </section>
          )}

          {!!briefingItems.length && (
            <section className="personal-workstream personal-ready-workstream">
              <div className="personal-section-head">
                <div><span className="eyebrow">Prepared for you</span><h2>Private briefing cards</h2></div>
                <button className="btn-dark-secondary" disabled={!exportItems.length} onClick={openExport} type="button">
                  <Icon name="download" size={14} /> Export checked ({exportItems.length})
                </button>
              </div>
              <div className="home-article-grid personal-card-grid grid gap-8">
                {briefingItems.map((item) => (
                  <ArticleCard
                    checked={selectedKeys.has(articleKey(item))}
                    isSelected={Boolean(item.selected_by)}
                    item={item}
                    key={articleKey(item)}
                    onCheck={(article, checked) => setSelectedKeys((current) => {
                      const next = new Set(current);
                      if (checked) next.add(articleKey(article)); else next.delete(articleKey(article));
                      return next;
                    })}
                    onOpen={openBriefing}
                    onSelect={selectForReview}
                  />
                ))}
              </div>
            </section>
          )}

          {!loading && !jobs.length && (
            <div className="workflow-empty">
              <Icon name="sparkle" size={26} />
              <h2>Your private briefing starts with a link</h2>
              <p>Submit an article above. You can leave this page while it is being prepared.</p>
            </div>
          )}
        </>
      )}
      {tab === 'saved' && (
        loading ? (
          <div className="workflow-empty"><Icon name="refresh" size={24} /><h2>Loading followed stories</h2></div>
        ) : savedItems.length === 0 ? (
        <>
          <div className="personal-learning-strip">
            <div><Icon name="sparkle" size={16} /><span><strong>Private preference learning</strong><small>{personalization?.event_count || 0} recent interaction signals · 30-day window</small></span></div>
            <button className="btn-dark-secondary" disabled={!personalization?.event_count || resetting} onClick={resetLearning} type="button">{resetting ? 'Resetting…' : 'Reset viewing preferences'}</button>
          </div>
          <div className="workflow-empty"><Icon name="bookmark" size={26} /><h2>Nothing saved yet</h2><p>Use Save on a shared or private briefing card.</p></div>
        </>
      ) : (
        <>
          <div className="personal-learning-strip">
            <div><Icon name="sparkle" size={16} /><span><strong>Saved stories guide your feed for 30 days</strong><small>Related updates receive a private “Update to a story you saved” tag.</small></span></div>
            <button className="btn-dark-secondary" disabled={!personalization?.event_count || resetting} onClick={resetLearning} type="button">{resetting ? 'Resetting…' : 'Reset viewing preferences'}</button>
          </div>
          <div className="home-article-grid personal-card-grid grid gap-8">
            {savedItems.map((item) => (
              <div key={articleKey(item)} className="flex min-h-0 flex-col gap-2">
                <ArticleCard item={item} onOpen={openSaved} />
                <button aria-busy={busyActions[articleKey(item)] === 'remove'} className="btn-dark-secondary w-full justify-center" disabled={Boolean(busyActions[articleKey(item)])} onClick={() => remove(item)} type="button">
                  <Icon name="trash" size={14} /> {busyActions[articleKey(item)] === 'remove' ? 'Updating…' : 'Unfollow'}
                </button>
              </div>
            ))}
          </div>
        </>
        )
      )}
      </div>

      <ArticleModal
        isSaved={Boolean(openArticle && savedKeys.has(articleKey(openArticle)))}
        item={openArticle}
        onClose={() => setOpenArticle(null)}
        onSave={toggleSave}
        onSelect={selectForReview}
      />
      <DraftExportModal
        items={exportItems}
        onClose={() => setExportOpen(false)}
        open={exportOpen}
        source="personal_briefing"
      />
    </div>
  );
}
