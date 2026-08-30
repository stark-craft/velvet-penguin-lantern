import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import NameModal from '../components/modals/NameModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import { correctRegion, getSites, getViewerHidden, getViewerReactions, hideArticleForViewer, selectWorkflow, setViewerReaction } from '../api.js';
import { articleActivityDetail, trackAction } from '../utils/tracking.js';
import { articleKey, cardVariant, groupedByDate, reactionIdentity, scoreOf } from '../utils/intelligence.js';
import './scan-redesign.css';

const fmt = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const DEEP_SCAN_TOUR_KEY = 'local-deep-scan-tour-v1-complete';
const DEEP_SCAN_TOUR_STEPS = [
  {
    title: 'Search the intelligence already collected',
    text: 'Enter a company, product, technology, market, or phrase. Scan checks extracted JSON archives and never opens the web crawler.',
  },
  {
    title: 'Choose the stored date window',
    text: 'The search starts with today. Expand the date range to investigate older articles already retained in the local archive.',
  },
  {
    title: 'Filter by publication',
    text: 'All stored publications are included by default. Select sources to filter the extracted results by their saved source metadata.',
  },
  {
    title: 'Instant local Scan',
    text: 'The result is produced only from scheduler-extracted briefing files. It does not start Scrapy, fetch a URL, or modify the homepage briefing.',
  },
];

const SUGGESTED_QUERIES = [
  'Samsung',
  'OLED',
  'Artificial Intelligence',
  'Broadcast regulation',
];

const RESULT_LENSES = [
  { label: 'All', icon: 'layers' },
  { label: 'High Signal', icon: 'bolt' },
  { label: 'India', icon: 'pin' },
  { label: 'Korea', icon: 'pin' },
  { label: 'AI Models', icon: 'sparkle' },
  { label: 'With Images', icon: 'eye' },
];

function matchesResultLens(item, lens) {
  const category = String(item.category || '').toLowerCase();
  const region = String(item.region || '').toLowerCase();
  if (lens === 'High Signal') return scoreOf(item) >= 80;
  if (lens === 'India') return region.includes('india');
  if (lens === 'Korea') return region.includes('korea');
  if (lens === 'AI Models') return category.includes('ai');
  if (lens === 'With Images') return !!(item.image_url || item.image || item.thumbnail || item.urlToImage);
  return true;
}

function sourceName(source) {
  return source?.name || source?.title || String(source);
}

function sourceCategory(source) {
  const category = source?.category || source?.cat || '';
  return String(category).trim() || 'General Sources';
}

function groupSourcesByCategory(sources) {
  return sources.reduce((acc, source) => {
    const category = sourceCategory(source);
    if (!acc[category]) acc[category] = [];
    acc[category].push(source);
    return acc;
  }, {});
}

function normalizeSiteCollection(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.sites)
      ? payload.sites
      : Array.isArray(payload?.sources)
        ? payload.sources
        : Array.isArray(payload?.data?.sites)
          ? payload.data.sites
          : [];

  const seen = new Set();
  return candidates.reduce((result, source) => {
    const normalized = typeof source === 'string' ? { name: source } : source;
    if (!normalized || typeof normalized !== 'object') return result;
    const name = sourceName(normalized).trim();
    const identity = name.toLowerCase();
    if (!name || seen.has(identity)) return result;
    seen.add(identity);
    result.push({ ...normalized, name });
    return result;
  }, []);
}

function archiveSourcesFromCards(cards) {
  const inferred = [];
  cards.forEach((item) => {
    const entries = Array.isArray(item.sources) && item.sources.length
      ? item.sources
      : [item.src || item.source || item.publisher].filter(Boolean);
    entries.forEach((source) => {
      const sourceObject = typeof source === 'string' ? { name: source } : (source || {});
      const name = sourceName(sourceObject).trim();
      if (!name || name.toLowerCase() === 'unknown') return;
      let origin = sourceObject.url || sourceObject.link || '';
      if (!origin && (item.url || item.link)) {
        try { origin = new URL(item.url || item.link).origin; } catch { origin = item.url || item.link; }
      }
      inferred.push({
        ...sourceObject,
        name,
        url: origin,
        category: 'Sources in current results',
        inferred_from_archive: true,
      });
    });
  });
  return normalizeSiteCollection(inferred);
}

function mergeSourceCollections(configured, inferred) {
  const configuredNames = new Set(configured.map((source) => sourceName(source).trim().toLowerCase()));
  return [...configured, ...inferred.filter((source) => !configuredNames.has(sourceName(source).trim().toLowerCase()))];
}

function SourcePicker({ sites, selected, onApply, loading = false, loadError = '', canManageSources = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(selected);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setDraft(selected);
    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, selected]);

  const allNames = useMemo(() => sites.map(sourceName), [sites]);
  const label = selected.length ? `${selected.length} selected` : 'All stored sources';

  const visibleSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((source) => {
      const name = sourceName(source).toLowerCase();
      const category = sourceCategory(source).toLowerCase();
      const url = String(source.url || source.feed || source.rss || '').toLowerCase();
      return !q || name.includes(q) || category.includes(q) || url.includes(q);
    });
  }, [sites, query]);

  const grouped = useMemo(() => groupSourcesByCategory(visibleSites), [visibleSites]);
  const draftSet = useMemo(() => new Set(draft), [draft]);
  const toggleSource = (name) => {
    setDraft((current) => (
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    ));
  };
  const setCategory = (group, isOn) => {
    const names = group.map(sourceName);
    setDraft((current) => {
      const next = new Set(current);
      names.forEach((name) => {
        if (isOn) next.add(name);
        else next.delete(name);
      });
      return [...next];
    });
  };

  const closePicker = () => {
    setOpen(false);
    setQuery('');
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const keepFocusInside = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="scan-source-picker relative">
      <button
        ref={triggerRef}
        className="source-picker-trigger scan-scope-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="scan-source-picker-dialog"
        type="button"
      >
        <span className="scan-scope-trigger-icon" aria-hidden="true"><Icon name="rss" size={18} /></span>
        <span className="scan-scope-trigger-copy">
          <strong>{label}</strong>
          <small>
            {selected.length ? `${selected.length} of ${allNames.length || 0} source filters` : `${allNames.length || 0} source filters available`}
          </small>
        </span>
        <Icon className="scan-scope-chevron" name="chevD" size={16} />
      </button>

      {open && createPortal((
        <>
          <button
            className="source-picker-scrim scan-source-picker-scrim fixed inset-0 z-[140]"
            onClick={closePicker}
            tabIndex={-1}
            type="button"
            aria-label="Close source picker"
          />
          <div
            ref={dialogRef}
            id="scan-source-picker-dialog"
            className="source-picker-dialog scan-source-picker-dialog fixed left-1/2 top-1/2 z-[150] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
            onKeyDown={keepFocusInside}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-source-picker-title"
            aria-describedby="scan-source-picker-description"
          >
            <header className="source-picker-head scan-source-picker-head">
              <div className="scan-source-picker-heading">
                <span className="scan-modal-icon" aria-hidden="true"><Icon name="rss" size={20} /></span>
                <div>
                  <span className="scan-modal-kicker">Search scope</span>
                  <h2 id="scan-source-picker-title">Choose stored publications</h2>
                  <p id="scan-source-picker-description">Limit this search by source metadata already attached to extracted articles.</p>
                </div>
              </div>
              <div className="scan-source-picker-head-actions">
                {canManageSources && <button
                  className="source-picker-manage"
                  onClick={() => {
                    setOpen(false);
                    navigate('/sources');
                  }}
                  type="button"
                >
                  Manage sources <Icon name="external" size={14} />
                </button>}
                <button className="scan-modal-close" onClick={closePicker} type="button" aria-label="Close source picker">
                  <Icon name="x" size={17} />
                </button>
              </div>
            </header>

            <div className="source-picker-tools scan-source-picker-tools">
              <label className="scan-source-search">
                <Icon name="search" size={17} />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a publication, category, or domain"
                  aria-label="Search stored sources"
                />
                {query && (
                  <button onClick={() => setQuery('')} type="button" aria-label="Clear source search">
                    <Icon name="x" size={15} />
                  </button>
                )}
              </label>
              <div className="scan-source-picker-quick-actions">
                <button onClick={() => setDraft(allNames)} type="button"><Icon name="check2" size={14} /> Select every source</button>
                <button onClick={() => setDraft([])} type="button"><Icon name="globe" size={14} /> Search all without filtering</button>
              </div>
              <div className="scan-source-picker-count" aria-live="polite">
                <strong>{draft.length || allNames.length}</strong>
                <span>{draft.length ? 'explicit source filters' : 'sources in open scope'}</span>
              </div>
            </div>

            <div className="scan-source-picker-list">
              {Object.entries(grouped).map(([category, group]) => {
                const names = group.map(sourceName);
                const selectedInGroup = names.filter((name) => draftSet.has(name)).length;
                const allSelected = names.length > 0 && selectedInGroup === names.length;
                return (
                  <section key={category} className="source-category-card scan-source-category">
                    <div className="scan-source-category-head">
                      <div>
                        <h3>{category}</h3>
                        <span>{names.length} stored source{names.length === 1 ? '' : 's'}</span>
                      </div>
                      <button
                        className={allSelected ? 'is-selected' : ''}
                        onClick={() => setCategory(group, !allSelected)}
                        type="button"
                        aria-pressed={allSelected}
                      >
                        {allSelected ? 'Clear category' : 'Select category'}
                        <span>{selectedInGroup}/{names.length}</span>
                      </button>
                    </div>
                    <div className="scan-source-options">
                      {group.map((source) => {
                        const name = sourceName(source);
                        return (
                          <label key={name} className="source-option scan-source-option">
                            <input
                              type="checkbox"
                              className="signal-checkbox"
                              checked={draftSet.has(name)}
                              onChange={() => toggleSource(name)}
                            />
                            <span className="scan-source-option-copy">
                              <strong>{name}</strong>
                              <small>{source.url || source.feed || source.rss || 'No URL configured'}</small>
                            </span>
                            <span className="scan-source-option-state" aria-hidden="true"><Icon name="check" size={13} /></span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {visibleSites.length === 0 && (
                <div className="scan-source-empty" role="status">
                  <span aria-hidden="true"><Icon name={loading ? 'refresh' : query ? 'search' : 'rss'} size={21} /></span>
                  <div>
                    <strong>
                      {loading
                        ? 'Loading stored source metadata…'
                        : query
                          ? `No sources match “${query}”`
                          : 'No source metadata is available yet'}
                    </strong>
                    <p>
                      {loading
                        ? 'The local archive remains searchable while this list loads.'
                        : query
                          ? 'Try a publication name, category, or domain.'
                          : loadError || 'Search without a source filter, or run a query to surface sources found in retained archive items.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <footer className="source-picker-foot scan-source-picker-foot">
              <div>
                <span className="scan-beacon active" aria-hidden="true" />
                <p>{draft.length ? `${draft.length} sources will filter the local results` : 'Every stored source remains in scope'}</p>
              </div>
              <div className="scan-source-picker-footer-actions">
                <button className="scan-secondary-action" onClick={closePicker} type="button">Cancel</button>
                <button
                  className="scan-primary-action"
                  onClick={() => {
                    onApply(draft);
                    closePicker();
                  }}
                  type="button"
                >
                  Apply scope <Icon name="check" size={15} />
                </button>
              </div>
            </footer>
          </div>
        </>
      ), document.body)}
    </div>
  );
}

function ScanTour({ step, targetRef, onNext, onDismiss }) {
  const [bounds, setBounds] = useState(null);
  const guide = DEEP_SCAN_TOUR_STEPS[step];
  const nextButtonRef = useRef(null);

  useEffect(() => {
    if (!guide) return undefined;

    const updateBounds = () => {
      const rect = targetRef.current?.getBoundingClientRect();
      if (!rect) return;
      setBounds({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      });
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    updateBounds();
    window.setTimeout(() => nextButtonRef.current?.focus(), 0);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [guide, onDismiss, targetRef]);

  if (!guide || !bounds) return null;

  const popoverWidth = 372;
  const left = Math.min(
    Math.max(16, bounds.left),
    Math.max(16, window.innerWidth - popoverWidth - 16),
  );
  const hasRoomBelow = bounds.bottom + 188 < window.innerHeight;
  const top = hasRoomBelow ? bounds.bottom + 14 : Math.max(16, bounds.top - 178);
  const isLast = step === DEEP_SCAN_TOUR_STEPS.length - 1;

  return createPortal((
    <>
      <button className="scan-tour-scrim fixed inset-0" onClick={onDismiss} type="button" aria-label="Skip local Scan guide" />
      <div
        className="scan-tour-spotlight fixed"
        style={{ left: `${bounds.left - 5}px`, top: `${bounds.top - 5}px`, width: `${bounds.width + 10}px`, height: `${bounds.height + 10}px` }}
      />
      <aside
        className="scan-tour-card scan-guide-card fixed"
        style={{ left: `${left}px`, top: `${top}px` }}
        aria-describedby="scan-guide-description"
        aria-labelledby="scan-guide-title"
        aria-modal="true"
        role="dialog"
      >
        <div className="scan-tour-progress">
          <span>Local Scan Guide</span>
          <span>{step + 1} / {DEEP_SCAN_TOUR_STEPS.length}</span>
        </div>
        <div className="scan-guide-dots" aria-hidden="true">
          {DEEP_SCAN_TOUR_STEPS.map((_, index) => <span className={index <= step ? 'is-active' : ''} key={index} />)}
        </div>
        <h3 id="scan-guide-title">{guide.title}</h3>
        <p id="scan-guide-description">{guide.text}</p>
        <div className="scan-tour-actions">
          <button className="scan-tour-skip" onClick={onDismiss} type="button">Skip</button>
          <button ref={nextButtonRef} className="scan-tour-next" onClick={onNext} type="button">{isLast ? 'Got it' : 'Next'}</button>
        </div>
      </aside>
    </>
  ), document.body);
}

function ScanActivityPanel({ running, logs, hasBatch }) {
  const [collapsed, setCollapsed] = useState(false);
  const recentLogs = (logs || []).slice(-7);

  useEffect(() => {
    if (!running && recentLogs.length > 0) setCollapsed(true);
  }, [running]);

  return (
    <aside className={`scan-activity-panel scan-live-trace ${running ? 'is-running' : ''} ${collapsed ? 'is-collapsed' : ''} ${hasBatch ? 'has-batch' : ''}`} aria-label="Archive search activity">
      <div className="scan-activity-head">
        <div>
          <span className={running ? 'scan-beacon active' : 'scan-beacon'} aria-hidden="true" />
          <span>
            <strong>{running ? 'Local search in motion' : 'Search trace'}</strong>
            <small>{running ? 'Reading extracted files' : 'Latest archive activity'}</small>
          </span>
        </div>
        <button
          onClick={() => setCollapsed((value) => !value)}
          type="button"
          aria-controls="scan-activity-log"
          aria-expanded={!collapsed}
        >
          <span>{collapsed ? 'Expand' : 'Minimize'}</span>
          <Icon name={collapsed ? 'chevD' : 'up'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="scan-activity-log" id="scan-activity-log" role="log" aria-live="polite" aria-relevant="additions">
            {recentLogs.map((entry) => (
              <div className={`scan-log-line ${entry.level || 'status'}`} key={entry.id}>
                <time>{entry.time}</time>
                <span className="scan-log-marker" aria-hidden="true" />
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
          <div className="scan-activity-foot">
            <Icon name="shield" size={13} />
            {running ? 'Local files only · safe to keep navigating' : 'No crawler or public web request was used'}
          </div>
        </>
      )}
    </aside>
  );
}

export default function ScanScreen({ manualScan, setManualScan, startManualScan, stopManualScan, capabilities = [] }) {
  const capabilitySet = useMemo(() => new Set(capabilities), [capabilities]);
  const canViewSources = capabilitySet.has('sources.view') || capabilitySet.has('sources.manage');
  const canManageSources = capabilitySet.has('sources.manage');
  const canSubmitReview = capabilitySet.has('review.news.submit');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const today = new Date();

  const query = manualScan?.query ?? initialQ;
  const from = manualScan?.from || fmt(today);
  const to = manualScan?.to || fmt(today);
  const pickedSites = manualScan?.pickedSites || [];
  const running = !!manualScan?.running;
  const started = !!manualScan?.started;
  const status = manualScan?.status || 'Ready for investigation.';
  const cards = manualScan?.cards || [];
  const checked = manualScan?.checked || {};
  const logs = manualScan?.logs || [];
  const archiveFiles = Number(manualScan?.archiveFiles || 0);
  const articlesSearched = Number(manualScan?.articlesSearched || 0);
  const setQuery = (value) => setManualScan({ query: value });
  const setFrom = (value) => setManualScan({ from: value });
  const setTo = (value) => setManualScan({ to: value });
  const setPicked = (value) => setManualScan({ pickedSites: value });
  const setCards = (value) => setManualScan((current) => ({ cards: typeof value === 'function' ? value(current.cards || []) : value }));
  const setChecked = (value) => setManualScan((current) => ({ checked: typeof value === 'function' ? value(current.checked || {}) : value }));
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState('');
  const [votes, setVotes] = useState({});
  const [openArticle, setOpen] = useState(null);
  const [pendingSelect, setPendingSelect] = useState(null);
  const [batchSelect, setBatchSelect] = useState(null);
  const [draftExportOpen, setDraftExportOpen] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [resultFilter, setResultFilter] = useState('All');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [actionBusy, setActionBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const queryRef = useRef(null);
  const dateRangeRef = useRef(null);
  const sourcesRef = useRef(null);
  const searchRef = useRef(null);

  const reactionSignature = useMemo(() => cards.map(reactionIdentity).filter(Boolean).join('|'), [cards]);
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
        setVotes((current) => {
          const next = { ...current };
          cards.forEach((item) => {
            const snapshot = snapshots[reactionIdentity(item)];
            if (snapshot) next[articleKey(item)] = snapshot;
          });
          return next;
        });
        setOpen((current) => current && snapshots[reactionIdentity(current)] ? { ...current, reactions: snapshots[reactionIdentity(current)] } : current);
      } catch {
        // Search results remain usable while shared counts retry in background.
      }
    };
    sync();
    const onVisibility = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cards, reactionSignature]);

  useEffect(() => {
    let active = true;
    setSitesLoading(canViewSources);
    if (canViewSources) getSites()
      .then((response) => {
        if (!active) return;
        const loadedSites = normalizeSiteCollection(response);
        setSites(loadedSites);
        setSitesError(loadedSites.length ? '' : 'The configured source list is empty for this profile.');
      })
      .catch(() => {
        if (!active) return;
        setSites([]);
        setSitesError('The configured source list could not be loaded. Search can still use all retained archive items.');
      })
      .finally(() => {
        if (active) setSitesLoading(false);
      });
    else setSitesLoading(false);
    getViewerHidden().then((d) => setHiddenCount(Number(d?.count ?? d?.items?.length ?? 0))).catch(() => {});
    return () => { active = false; };
  }, [canViewSources]);

  const selectedBatch = useMemo(
    () => cards.filter((item) => checked[articleKey(item)]),
    [cards, checked]
  );
  const visibleCards = useMemo(
    () => cards.filter((item) => matchesResultLens(item, resultFilter)),
    [cards, resultFilter],
  );
  useEffect(() => setPage(1), [cards, resultFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleCards.length / PAGE_SIZE));
  const pagedCards = useMemo(() => visibleCards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, visibleCards]);
  const resultLensCounts = useMemo(() => Object.fromEntries(
    RESULT_LENSES.map(({ label }) => [label, cards.filter((item) => matchesResultLens(item, label)).length]),
  ), [cards]);
  const availableSites = useMemo(
    () => mergeSourceCollections(sites, archiveSourcesFromCards(cards)),
    [sites, cards],
  );
  const groups = useMemo(() => groupedByDate(pagedCards), [pagedCards]);
  const highSignals = cards.filter((a) => scoreOf(a) >= 80).length;
  const scanSourceLabel = pickedSites.length ? `${pickedSites.length} selected` : 'All stored';
  const scanFailed = !running && logs[logs.length - 1]?.level === 'error';
  const scanStateLabel = running ? 'Searching archive' : scanFailed ? 'Search unavailable' : started ? 'Search complete' : 'Ready';
  const hasFilteredOut = cards.length > 0 && visibleCards.length === 0;
  const milestones = [
    { label: 'Query captured', state: query.trim() ? 'complete' : 'waiting' },
    { label: 'Scope mapped', state: query.trim() ? 'complete' : 'waiting' },
    { label: 'Archive read', state: running ? 'active' : started ? 'complete' : 'waiting' },
    { label: 'Signals ranked', state: started && !running ? 'complete' : running ? 'active' : 'waiting' },
  ];

  const start = () => {
    const keywords = query.trim();
    if (!keywords) return;
    startManualScan({ query, from, to, pickedSites });
  };

  const stop = () => {
    stopManualScan();
  };

  const onVote = async (item, v) => {
    const operationKey = `vote:${articleKey(item)}`;
    if (actionBusy) return;
    setActionBusy(operationKey);
    setActionError('');
    setActionNotice('');
    try {
      const response = await setViewerReaction(item, v || 'neutral');
      setVotes((previous) => ({ ...previous, [articleKey(item)]: { like_count: response.like_count, dislike_count: response.dislike_count, viewer_reaction: response.viewer_reaction } }));
      trackAction(v === 'dislike' ? 'vote_not_interested' : v === 'like' ? 'vote_interested' : 'vote_neutral', articleActivityDetail(item, 'scan'));
      setActionNotice(v === 'neutral' ? 'Reaction removed. The result stays visible.' : `Your ${v} was counted. The result stays visible.`);
    } catch (error) {
      setActionError(error?.message || 'Could not save this feedback. Nothing was changed; try again.');
    } finally {
      setActionBusy('');
    }
  };

  const hideArticle = async (item) => {
    const operationKey = `hide:${articleKey(item)}`;
    if (actionBusy) return;
    setActionBusy(operationKey);
    setActionError('');
    setActionNotice('');
    try {
      await hideArticleForViewer(item);
      setCards((current) => current.filter((article) => articleKey(article) !== articleKey(item)));
      setHiddenCount((count) => count + 1);
      trackAction('hide_personal', articleActivityDetail(item, 'scan'));
      setActionNotice('Signal hidden from your private view. Other viewers are unaffected.');
    } catch (error) {
      setActionError(error?.message || 'Could not hide this signal. It remains in your results; try again.');
    } finally {
      setActionBusy('');
    }
  };

  const hideFromDossier = async (item) => {
    setOpen(null);
    await hideArticle(item);
  };

  const selectFromDossier = (item) => {
    setOpen(null);
    setPendingSelect(item);
  };
  const openDossier = (item) => {
    trackAction('dossier_open', articleActivityDetail(item, 'scan'));
    setOpen(item);
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setCards((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  const confirmSelect = async (item, name) => {
    if (actionBusy) return;
    const payload = { ...item, selected_by: name, selected_at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    setActionBusy(`select:${articleKey(item)}`);
    setActionError('');
    setActionNotice('');
    try {
      await selectWorkflow(payload);
      setCards((arr) => arr.map((a) => (articleKey(a) === articleKey(item) ? { ...a, selected_by: name } : a)));
      trackAction('select', articleActivityDetail(item, 'scan'));
      setActionNotice('Signal sent to the Review Queue.');
    } catch (error) {
      setActionError(error?.message || 'Could not send this signal to the Review Queue. Try again.');
    } finally {
      setActionBusy('');
    }
  };

  const confirmBatch = async (_item, name) => {
    if (actionBusy || !selectedBatch.length) return;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const payloads = selectedBatch.map((item) => ({ ...item, selected_by: name, selected_at: stamp }));
    setActionBusy('batch-select');
    setActionError('');
    setActionNotice('');
    setBatchSelect(null);
    try {
      const results = await Promise.allSettled(payloads.map((payload) => selectWorkflow(payload)));
      const accepted = payloads.filter((_payload, index) => results[index].status === 'fulfilled');
      const acceptedKeys = new Set(accepted.map(articleKey));
      setCards((items) => items.map((item) => (acceptedKeys.has(articleKey(item)) ? { ...item, selected_by: name } : item)));
      setChecked((current) => {
        const next = { ...current };
        acceptedKeys.forEach((key) => { delete next[key]; });
        return next;
      });
      if (accepted.length) {
        trackAction('batch_select', {
          item_count: accepted.length,
          items: accepted.map((item) => articleActivityDetail(item, 'scan')),
          screen: 'scan',
        });
      }
      const failedCount = payloads.length - accepted.length;
      if (failedCount) {
        setActionError(`${failedCount} of ${payloads.length} signals could not be sent. They remain selected so you can retry.`);
      } else {
        setActionNotice(`${accepted.length} signal${accepted.length === 1 ? '' : 's'} sent to the Review Queue.`);
      }
    } catch (error) {
      setActionError(error?.message || 'Could not send the selected signals. They remain selected so you can retry.');
    } finally {
      setActionBusy('');
    }
  };

  const onCheck = (item, isOn) => {
    const key = articleKey(item);
    setChecked((prev) => {
      const next = { ...prev };
      if (isOn) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  return (
    <div className={`scan-page scan-studio ${running ? 'is-scanning' : ''}`}>
      <section className="scan-command-center" aria-labelledby="scan-command-title">
        <div className="scan-command-grid" aria-hidden="true" />
        <div className="scan-command-glow" aria-hidden="true" />

        <header className="scan-command-header">
          <div className="scan-command-copy">
            <div className="scan-kicker-line"><span className="scan-kicker"><Icon name="archive" size={14} /> Local Intelligence Scan</span></div>
            <h1 id="scan-command-title">What are you investigating?</h1>
            <p>
              Type a company, product, market, or phrase. Scan reads the extracted intelligence archive in real time—without waking the crawler or touching the public web.
            </p>
            <div className="scan-trust-rail" role="note" aria-label="Local search safeguards">
              <span className="is-primary"><Icon name="shield" size={14} /> Local only</span>
              <span><Icon name="archive" size={13} /> Read-only archive</span>
              <span><Icon name="server" size={13} /> Session persists across tabs</span>
            </div>
          </div>

          <aside className="scan-live-readout" aria-label="Current search scope" aria-live="polite">
            <div className="scan-readout-head">
              <div className={`scan-orbit ${running ? 'is-live' : ''}`} aria-hidden="true">
                <span className="scan-orbit-ring" />
                <span className="scan-orbit-core"><Icon name={running ? 'refresh' : scanFailed ? 'warning' : started ? 'check2' : 'search'} size={18} /></span>
              </div>
              <div>
                <span className="scan-readout-label">Workspace status</span>
                <strong>{scanStateLabel}</strong>
                <small>{running ? 'Reading local files now' : scanFailed ? 'Retry when the archive is available' : started ? 'Ready for your next query' : 'Waiting for a query'}</small>
              </div>
            </div>
            <dl className="scan-readout-metrics">
              <div><dt>Sources</dt><dd>{scanSourceLabel}</dd></div>
              <div><dt>Matches</dt><dd>{cards.length}</dd></div>
              <div><dt>Files</dt><dd>{archiveFiles || '—'}</dd></div>
            </dl>
            <p><Icon name="history" size={13} /> Results remain available while you move through this app.</p>
          </aside>
        </header>

        <div className="scan-query-deck">
          <div className="scan-query-deck-head">
            <div>
              <span>01 · Query</span>
              <strong>Search extracted news</strong>
            </div>
            <span className="scan-live-hint"><span className={running ? 'scan-beacon active' : 'scan-beacon'} aria-hidden="true" /> Search runs only when requested</span>
          </div>

          <div className="scan-query-primary scan-query-row">
            <label className="scan-query-capsule scan-query-field" ref={queryRef}>
              <span className="scan-query-icon" aria-hidden="true"><Icon name="search" size={21} /></span>
              <span className="sr-only">Search extracted intelligence</span>
              <input
                className="scan-query-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }}
                placeholder="Try “Samsung OLED”, “AI regulation”, or a specific phrase"
                aria-describedby="scan-query-boundary"
                aria-invalid={scanFailed}
              />
              {query && (
                <button className="scan-query-clear" onClick={() => setQuery('')} type="button" aria-label="Clear search query">
                  <Icon name="x" size={16} />
                </button>
              )}
              <kbd>Enter</kbd>
            </label>
            <div className="scan-search-action" ref={searchRef}>
              {running ? (
                <button className="scan-run scan-run-primary stop" onClick={stop} type="button">
                  <Icon name="stop" /><span>Stop search</span><small>Cancel safely</small>
                </button>
              ) : (
                <button className="scan-run scan-run-primary" onClick={start} type="button" disabled={!query.trim()}>
                  <Icon name="bolt" /><span>Search archive</span><small>Local files only</small>
                </button>
              )}
            </div>
          </div>

          <div className="scan-suggestions" aria-label="Suggested searches">
            <span>Starting points</span>
            {SUGGESTED_QUERIES.map((suggestion) => (
              <button key={suggestion} onClick={() => setQuery(suggestion)} type="button">
                {suggestion}<Icon name="chevR" size={12} />
              </button>
            ))}
          </div>

          <div className="scan-scope-heading">
            <div><span>02 · Scope</span><strong>Define where Scan should look</strong></div>
            <p id="scan-query-boundary"><Icon name="shield" size={13} /> The scheduler, shared briefing, and crawler remain untouched.</p>
          </div>
          <div className="scan-command-controls scan-scope-grid">
            <div className="scan-scope-cell" ref={dateRangeRef}>
              <DateRangePicker
                from={from}
                to={to}
                helpText="Local Scan starts with today. Choose a broader range to search older extracted briefing files."
                onChange={({ from: nextFrom, to: nextTo }) => {
                  setFrom(nextFrom);
                  setTo(nextTo);
                }}
              />
              <span className="scan-scope-caption">Only retained briefings inside this window</span>
            </div>
            <div className="scan-scope-cell" ref={sourcesRef}>
              <div className="scan-field-label">
                <span>Source scope</span>
                <span className="scan-field-help" title="Filters stored articles by source metadata. Publishers are never contacted." aria-hidden="true">?</span>
              </div>
              <SourcePicker
                sites={availableSites}
                selected={pickedSites}
                onApply={setPicked}
                loading={sitesLoading}
                loadError={sitesError}
                canManageSources={canManageSources}
              />
              <span className="scan-scope-caption">Filtering metadata, never contacting a publisher</span>
            </div>
            <aside className="scan-integrity-note" aria-label="Search integrity">
              <span className="scan-integrity-icon" aria-hidden="true"><Icon name="shield" size={18} /></span>
              <div><strong>Private working scope</strong><p>Your filters affect this search session only.</p></div>
              <span className="scan-integrity-state">Protected</span>
            </aside>
          </div>
        </div>

        <div className="scan-milestone-strip" aria-live="polite">
          <div className="scan-milestone-status">
            <span className={running ? 'scan-beacon active' : 'scan-beacon'} aria-hidden="true" />
            <div><strong>{status}</strong><small>{running ? 'You can navigate away; this search continues in the background.' : 'Local archive workflow'}</small></div>
          </div>
          <ol className="scan-milestones" aria-label="Search progress">
            {milestones.map((milestone, index) => (
              <li className={milestone.state} key={milestone.label}>
                <span>{milestone.state === 'complete' ? <Icon name="check" size={12} /> : index + 1}</span>
                <strong>{milestone.label}</strong>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {(actionBusy || actionError || actionNotice) && (
        <div
          className={actionError
            ? 'my-4 flex flex-col gap-3 rounded-2xl border border-red-300/20 bg-red-950/20 p-4 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between'
            : 'my-4 flex flex-col gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between'}
          role={actionError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>{actionBusy ? 'Saving your change…' : actionError || actionNotice}</span>
          {!actionBusy && (
            <button className="scan-secondary-action" onClick={() => { setActionError(''); setActionNotice(''); }} type="button">
              Dismiss
            </button>
          )}
        </div>
      )}

      <section className="scan-results-workspace" aria-busy={running || Boolean(actionBusy)} aria-labelledby="scan-results-title">
        <header className="scan-results-header">
          <div>
            <span className="scan-results-kicker">03 · Intelligence return</span>
            <h2 id="scan-results-title">
              {running ? 'Scanning the retained archive' : scanFailed ? 'The archive search needs attention' : started ? `${cards.length} signals surfaced` : 'Your local results will land here'}
            </h2>
            <p>
              {scanFailed
                ? status
                : started
                ? `${articlesSearched} stored articles checked across ${archiveFiles} archive file${archiveFiles === 1 ? '' : 's'} · ${highSignals} high-signal result${highSignals === 1 ? '' : 's'}`
                : 'Results are ranked from extracted titles, summaries, keywords, sources, categories, and regions.'}
            </p>
          </div>
          <div className={`scan-result-state ${running ? 'is-live' : ''}`}>
            <span className={running ? 'scan-beacon active' : 'scan-beacon'} aria-hidden="true" />
            <div><strong>{running ? 'Live local search' : scanFailed ? 'Search failed' : started ? 'Search complete' : 'Standing by'}</strong><small>{from} → {to}</small></div>
          </div>
        </header>

        {(started || cards.length > 0) && (
          <div className="scan-query-receipt" aria-label="Current query summary">
            <span><Icon name="search" size={14} /> <strong>{query}</strong></span>
            <span><Icon name="rss" size={14} /> {pickedSites.length || 'All'} source{pickedSites.length === 1 ? '' : 's'}</span>
            <span><Icon name="archive" size={14} /> {archiveFiles} file{archiveFiles === 1 ? '' : 's'}</span>
            <span><Icon name="layers" size={14} /> {selectedBatch.length} selected</span>
          </div>
        )}

        {cards.length > 0 && (
          <nav className="scan-facet-bar" aria-label="Filter scan results">
            <div className="scan-facet-heading"><Icon name="filter" size={15} /><span>Results lens</span></div>
            <div className="scan-facet-scroll">
              {RESULT_LENSES.map(({ label, icon }) => (
                <button
                  key={label}
                  className={resultFilter === label ? 'scan-filter-chip active' : 'scan-filter-chip'}
                  onClick={() => setResultFilter(label)}
                  type="button"
                  aria-pressed={resultFilter === label}
                >
                  <Icon name={icon} size={13} /><span>{label}</span><strong>{resultLensCounts[label]}</strong>
                </button>
              ))}
            </div>
            <span className="scan-result-count">{visibleCards.length} visible</span>
          </nav>
        )}

        <div className="scan-result-stage">
          {Object.keys(groups).length > 0 ? Object.entries(groups).map(([day, items]) => (
            <section key={day} className="scan-result-day" aria-labelledby={`scan-day-${day}`}>
              <header className="scan-result-day-head">
                <div><span className="scan-day-marker" aria-hidden="true" /><h3 id={`scan-day-${day}`}>{day}</h3></div>
                <span>{items.length} result{items.length === 1 ? '' : 's'}</span>
              </header>
              <div className="article-grid scan-results-grid">
                {items.map((item) => (
                  <div className="archive-result-item scan-result-card-shell" key={item.id}>
                    <div className="archive-match-strip scan-match-ribbon">
                      <span className="archive-match-label"><Icon name="search" size={12} /> Match</span>
                      <span className="archive-match-terms">
                        {(item.matched_terms || []).slice(0, 4).map((term) => <em key={term}>{term}</em>)}
                      </span>
                      <span className="archive-match-score">{item.search_score ? `${item.search_score}%` : 'Ranked'}</span>
                    </div>
                    <ArticleCard
                      item={item}
                      variant={cardVariant(item)}
                      vote={votes[articleKey(item)]}
                      onVote={onVote}
                      onSelect={canSubmitReview ? setPendingSelect : undefined}
                      onOpen={openDossier}
                      onHide={hideArticle}
                      onCheck={canSubmitReview ? onCheck : undefined}
                      checked={!!checked[articleKey(item)]}
                      isSelected={!!item.selected_by}
                    />
                  </div>
                ))}
              </div>
            </section>
          )) : (
            <div className={`scan-idle-stage ${running ? 'is-running' : ''}`}>
              <div className={running ? 'scan-radar active' : 'scan-radar'} aria-hidden="true">
                <span className="radar-ring one" />
                <span className="radar-ring two" />
                <span className="radar-crosshair" />
                <span className="scan-radar-sweep" />
                <Icon name={running ? 'refresh' : scanFailed ? 'warning' : hasFilteredOut ? 'filter' : started ? 'search' : 'archive'} size={24} />
              </div>
              <div className="scan-idle-copy">
                <span className="scan-idle-kicker">{running ? 'Local search active' : scanFailed ? 'Search interrupted' : hasFilteredOut ? 'Lens applied' : started ? 'Archive search complete' : 'Extracted intelligence ready'}</span>
                <h3>{running ? 'Reading and ranking your stored signals' : scanFailed ? 'The retained archive could not be searched' : hasFilteredOut ? `No results match the ${resultFilter} lens` : started ? 'No stored signals matched this search' : 'Begin with one useful question'}</h3>
                <p>
                  {running
                    ? 'Scan is checking extracted briefing files locally. Keep working elsewhere—the search state will stay here.'
                    : scanFailed
                      ? `${status} Check that the backend is running, then retry this same query.`
                    : hasFilteredOut
                      ? 'The full result set is still available. Reset the lens to see every matching signal.'
                      : started
                        ? 'Widen the date window, remove a source filter, or try a related subject.'
                        : 'Search any company, product, technology, market, or exact phrase from the retained briefing archive.'}
                </p>
                {!running && (
                  <div className="scan-idle-actions">
                    {scanFailed ? (
                      <button onClick={start} type="button"><Icon name="refresh" size={14} /> Retry this search</button>
                    ) : hasFilteredOut ? (
                      <button onClick={() => setResultFilter('All')} type="button"><Icon name="rotate" size={14} /> Show every result</button>
                    ) : (
                      <>
                        <button onClick={() => setQuery('Samsung OLED')} type="button">Samsung OLED <Icon name="chevR" size={12} /></button>
                        <button onClick={() => setQuery('Broadcast regulation')} type="button">Broadcast regulation <Icon name="chevR" size={12} /></button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="scan-idle-proof" aria-label="Search coverage">
                <div><Icon name="file" size={15} /><span><strong>Titles + summaries</strong><small>Full-text matching</small></span></div>
                <div><Icon name="sparkle" size={15} /><span><strong>Keywords + regions</strong><small>Structured intelligence</small></span></div>
                <div><Icon name="shield" size={15} /><span><strong>Zero web traffic</strong><small>Local archive boundary</small></span></div>
              </div>
            </div>
          )}
        </div>

        {visibleCards.length > PAGE_SIZE && (
          <nav className="scan-pagination" aria-label="Scan result pages">
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><Icon name="chevL" size={14} /> Previous</button>
            <span>Page <strong>{page}</strong> of {pageCount} · {visibleCards.length} matches</span>
            <button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next <Icon name="chevR" size={14} /></button>
          </nav>
        )}

        {hiddenCount > 0 && (
          <footer className="scan-hidden-footer">
            <button className="hidden-review-link scan-hidden-signals" onClick={() => navigate('/rejected')} type="button">
              <span className="scan-hidden-icon" aria-hidden="true"><Icon name="eye" size={17} /></span>
              <span><strong>Review your hidden signals</strong><small>{hiddenCount} article{hiddenCount === 1 ? '' : 's'} hidden only for you</small></span>
              <span>Open review <Icon name="chevR" size={13} /></span>
            </button>
          </footer>
        )}
      </section>

      {started && <ScanActivityPanel running={running} logs={logs} hasBatch={selectedBatch.length > 0} />}

      <ArticleModal
        item={openArticle}
        onClose={() => setOpen(null)}
        onSelect={canSubmitReview ? selectFromDossier : undefined}
        onHide={hideFromDossier}
        onVote={onVote}
        onCorrectRegion={capabilitySet.has('region.correct') ? onCorrectRegion : undefined}
      />
      {canSubmitReview && <NameModal open={!!pendingSelect} article={pendingSelect} onClose={() => setPendingSelect(null)} onConfirm={confirmSelect} />}
      {canSubmitReview && <NameModal
        open={!!batchSelect}
        article={batchSelect}
        title={`Send ${selectedBatch.length} articles to Review Queue`}
        description="Enter your name."
        confirmLabel="Send to Review Queue"
        onClose={() => setBatchSelect(null)}
        onConfirm={confirmBatch}
      />}
      <DraftExportModal
        items={selectedBatch}
        open={draftExportOpen}
        source="deep_scan"
        onClose={() => setDraftExportOpen(false)}
      />

      {canSubmitReview && selectedBatch.length > 0 && (
        <div className="scan-batch-dock" role="region" aria-label="Selected scan results">
          <div className="batch-action-bar scan-batch-bar">
            <div className="scan-batch-count"><span>{selectedBatch.length}</span><strong>signal{selectedBatch.length === 1 ? '' : 's'} selected</strong></div>
            <div className="scan-batch-actions">
              <button className="scan-secondary-action" disabled={Boolean(actionBusy)} onClick={() => setChecked({})} type="button">Clear</button>
              <button className="scan-primary-action" disabled={Boolean(actionBusy)} onClick={() => setBatchSelect({ title: `${selectedBatch.length} selected signals` })} type="button"><Icon name="check2" size={15} /> {actionBusy === 'batch-select' ? 'Sending…' : 'Send to review'}</button>
              <button className="scan-secondary-action" disabled={Boolean(actionBusy)} onClick={() => setDraftExportOpen(true)} type="button"><Icon name="download" size={15} /> Draft export</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
