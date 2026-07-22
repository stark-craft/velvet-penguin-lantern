import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import NameModal from '../components/modals/NameModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import { correctRegion, getSites, getNotInterested, rejectArticle, selectWorkflow, trainVote } from '../api.js';
import { trackAction } from '../utils/tracking.js';
import { articleKey, cardVariant, groupedByDate, scoreOf } from '../utils/intelligence.js';

const fmt = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const DEEP_SCAN_TOUR_KEY = 'deep-scan-tour-complete';
const DEEP_SCAN_TOUR_STEPS = [
  {
    title: 'Enter investigation keywords',
    text: 'Add one or more subjects separated by commas, for example: Samsung, OLED, Nvidia, robotics. The search keeps stories that match at least one keyword.',
  },
  {
    title: 'Start with today',
    text: 'Deep Search now begins with today only. Open Date Range when you need older context or a wider investigation window.',
  },
  {
    title: 'Choose the source scope',
    text: 'All active sources are searched by default. Narrow this control when you want a targeted investigation by publication or category.',
  },
  {
    title: 'Launch the investigation',
    text: 'Run Deep Search crawls your selected sources for the keywords and time window, then streams and clusters the matching stories into this workspace.',
  },
];

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

function SourcePicker({ sites, selected, onApply }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(selected);

  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);

  const allNames = useMemo(() => sites.map(sourceName), [sites]);
  const selectedCount = selected.length || allNames.length;
  const label = selected.length ? `${selected.length} selected` : 'All active';

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

  return (
    <div className="relative">
      <button
        className="source-picker-trigger dark-input flex items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>
          <span className="block text-sm font-semibold text-white">{label}</span>
          <span className="block text-xs text-slate-500">{selectedCount} of {allNames.length || 0} sources</span>
        </span>
        <Icon name="chevD" size={15} />
      </button>

      {open && createPortal((
        <>
          <button
            className="source-picker-scrim fixed inset-0 z-[140]"
            onClick={() => setOpen(false)}
            type="button"
            aria-label="Close source picker"
          />
          <div
            className="source-picker-dialog fixed left-1/2 top-1/2 z-[150] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Source Picker"
          >
          <div className="source-picker-head shrink-0 flex items-center justify-between gap-3 border-b border-white/10 p-4">
            <div>
              <div className="text-sm font-semibold text-white">Source Picker</div>
              <div className="mt-1 text-xs text-slate-500">Grouped by sites.json category</div>
            </div>
            <button
              className="source-picker-manage text-sm font-semibold text-sky-200 hover:text-white"
              onClick={() => navigate('/sources')}
              type="button"
            >
              Manage Sources →
            </button>
          </div>

          <div className="source-picker-tools shrink-0 space-y-3 p-4">
            <input
              className="dark-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sources..."
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn-dark-secondary h-9" onClick={() => setDraft(allNames)} type="button">Select all sources</button>
              <button className="btn-dark-secondary h-9" onClick={() => setDraft([])} type="button">Use all active</button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {Object.entries(grouped).map(([category, group]) => {
              const names = group.map(sourceName);
              const selectedInGroup = names.filter((name) => draftSet.has(name)).length;
              const allSelected = names.length > 0 && selectedInGroup === names.length;
              return (
                <div key={category} className="source-category-card rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <button
                      className="text-left text-sm font-semibold text-slate-100 hover:text-white"
                      onClick={() => setCategory(group, !allSelected)}
                      type="button"
                    >
                      {category}
                    </button>
                    <button
                      className={allSelected ? 'signal-chip selected' : 'source-chip'}
                      onClick={() => setCategory(group, !allSelected)}
                      type="button"
                    >
                      {selectedInGroup}/{names.length}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {group.map((source) => {
                      const name = sourceName(source);
                      return (
                        <label key={name} className="source-option flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.045]">
                          <input
                            type="checkbox"
                            className="signal-checkbox mt-0.5"
                            checked={draftSet.has(name)}
                            onChange={() => toggleSource(name)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-100">{name}</span>
                            <span className="block truncate text-xs text-slate-500">{source.url || source.feed || source.rss || 'No URL configured'}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleSites.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-400">
                No sources match this search.
              </div>
            )}
          </div>

          <div className="source-picker-foot shrink-0 flex items-center justify-between gap-3 border-t border-white/10 p-4">
            <div className="text-sm text-slate-500">
              {draft.length ? `${draft.length} manually selected` : 'All active sources will be used'}
            </div>
            <div className="flex gap-2">
              <button className="btn-dark-secondary h-9" onClick={() => setOpen(false)} type="button">Cancel</button>
              <button
                className="btn-dark-primary h-9"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
                type="button"
              >
                Apply selected sources
              </button>
            </div>
          </div>
          </div>
        </>
      ), document.body)}
    </div>
  );
}

function DeepScanTour({ step, targetRef, onNext, onDismiss }) {
  const [bounds, setBounds] = useState(null);
  const guide = DEEP_SCAN_TOUR_STEPS[step];

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

    updateBounds();
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    return () => {
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [guide, targetRef]);

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
      <button className="scan-tour-scrim fixed inset-0" onClick={onDismiss} type="button" aria-label="Skip Deep Search guide" />
      <div
        className="scan-tour-spotlight fixed"
        style={{ left: `${bounds.left - 5}px`, top: `${bounds.top - 5}px`, width: `${bounds.width + 10}px`, height: `${bounds.height + 10}px` }}
      />
      <aside className="scan-tour-card fixed" style={{ left: `${left}px`, top: `${top}px` }} aria-live="polite">
        <div className="scan-tour-progress">Deep Search Guide · {step + 1} of {DEEP_SCAN_TOUR_STEPS.length}</div>
        <h3>{guide.title}</h3>
        <p>{guide.text}</p>
        <div className="scan-tour-actions">
          <button className="scan-tour-skip" onClick={onDismiss} type="button">Skip</button>
          <button className="scan-tour-next" onClick={onNext} type="button">{isLast ? 'Got it' : 'Next'}</button>
        </div>
      </aside>
    </>
  ), document.body);
}

function ScanActivityPanel({ running, logs, hasBatch }) {
  const [collapsed, setCollapsed] = useState(false);
  const recentLogs = (logs || []).slice(-7);

  return (
    <aside className={`scan-activity-panel ${running ? 'is-running' : ''} ${collapsed ? 'is-collapsed' : ''} ${hasBatch ? 'has-batch' : ''}`} aria-live="polite">
      <div className="scan-activity-head">
        <div>
          <span className={running ? 'scan-beacon active' : 'scan-beacon'} />
          <Icon name="terminal" size={15} />
          <strong>Crawler Activity</strong>
        </div>
        <button onClick={() => setCollapsed((value) => !value)} type="button">
          {collapsed ? 'Expand' : 'Minimize'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="scan-activity-log">
            {recentLogs.map((entry) => (
              <div className={`scan-log-line ${entry.level || 'status'}`} key={entry.id}>
                <time>{entry.time}</time>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
          <div className="scan-activity-foot">
            {running ? 'Live updates from the active crawl' : 'Latest manual search activity'}
          </div>
        </>
      )}
    </aside>
  );
}

export default function ScanScreen({ manualScan, setManualScan, startManualScan, stopManualScan }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialQ = params.get('q') || 'Samsung OLED AI';
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
  const setQuery = (value) => setManualScan({ query: value });
  const setFrom = (value) => setManualScan({ from: value });
  const setTo = (value) => setManualScan({ to: value });
  const setPicked = (value) => setManualScan({ pickedSites: value });
  const setCards = (value) => setManualScan((current) => ({ cards: typeof value === 'function' ? value(current.cards || []) : value }));
  const setChecked = (value) => setManualScan((current) => ({ checked: typeof value === 'function' ? value(current.checked || {}) : value }));
  const [sites, setSites] = useState([]);
  const [votes, setVotes] = useState({});
  const [openArticle, setOpen] = useState(null);
  const [pendingSelect, setPendingSelect] = useState(null);
  const [batchSelect, setBatchSelect] = useState(null);
  const [draftExportOpen, setDraftExportOpen] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [resultFilter, setResultFilter] = useState('All');
  const [tourStep, setTourStep] = useState(null);
  const queryRef = useRef(null);
  const dateRangeRef = useRef(null);
  const sourcesRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    getSites().then((s) => setSites(Array.isArray(s) ? s : (s?.sites || []))).catch(() => {});
    getNotInterested().then((d) => setHiddenCount(Number(d?.count ?? d?.items?.length ?? 0))).catch(() => {});
    if (window.localStorage.getItem(DEEP_SCAN_TOUR_KEY) !== 'true') {
      setTourStep(0);
    }
  }, []);

  const dismissTour = () => {
    window.localStorage.setItem(DEEP_SCAN_TOUR_KEY, 'true');
    setTourStep(null);
  };

  const openTour = (step) => setTourStep(step);

  const nextTourStep = () => {
    if (tourStep >= DEEP_SCAN_TOUR_STEPS.length - 1) {
      dismissTour();
    } else {
      setTourStep((current) => current + 1);
    }
  };

  const selectedBatch = useMemo(
    () => cards.filter((item) => checked[articleKey(item)]),
    [cards, checked]
  );
  const visibleCards = useMemo(() => cards.filter((item) => {
    const category = String(item.category || '').toLowerCase();
    const region = String(item.region || '').toLowerCase();
    if (resultFilter === 'High Signal') return scoreOf(item) >= 80;
    if (resultFilter === 'India') return region.includes('india');
    if (resultFilter === 'Korea') return region.includes('korea');
    if (resultFilter === 'AI Models') return category.includes('ai');
    if (resultFilter === 'With Images') return !!(item.image_url || item.image || item.thumbnail || item.urlToImage);
    return true;
  }), [cards, resultFilter]);
  const groups = useMemo(() => groupedByDate(visibleCards), [visibleCards]);
  const highSignals = cards.filter((a) => scoreOf(a) >= 80).length;
  const scanSourceLabel = pickedSites.length ? `${pickedSites.length} selected` : `${sites.length || 0} active`;
  const scanStateLabel = running ? 'Scanning' : started ? 'Complete' : 'Ready';

  const start = () => {
    const keywords = query.trim();
    if (!keywords || running) return;
    startManualScan({ query, from, to, pickedSites });
  };

  const stop = () => {
    stopManualScan();
  };

  const onVote = async (item, v) => {
    setVotes((p) => ({ ...p, [item.id]: v }));
    trackAction('vote', `${v}:${item.title?.slice(0, 60)}`);
    try {
      if (v === 'down') {
        await rejectArticle(item);
        setCards((c) => c.filter((x) => x.id !== item.id));
        setHiddenCount((n) => n + 1);
      } else if (v === 'up') {
        await trainVote(
          item.keywords_found || item.keywords || query,
          item.master_summary || item.summary || item.title,
          'interested',
          item.title
        );
      }
    } catch {}
  };

  const hideFromDossier = async (item) => {
    setOpen(null);
    await onVote(item, 'down');
  };

  const selectFromDossier = (item) => {
    setOpen(null);
    setPendingSelect(item);
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };
    setCards((arr) => arr.map((article) => (article.title === item.title ? { ...article, ...patch } : article)));
    setOpen((article) => (article?.title === item.title ? { ...article, ...patch } : article));
    return result;
  };

  const confirmSelect = async (item, name) => {
    const payload = { ...item, selected_by: name, selected_at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    setCards((arr) => arr.map((a) => (a.id === item.id ? { ...a, selected_by: name } : a)));
    trackAction('select', item.title?.slice(0, 60));
    try { await selectWorkflow(payload); } catch {}
  };

  const confirmBatch = async (_item, name) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const payloads = selectedBatch.map((item) => ({ ...item, selected_by: name, selected_at: stamp }));
    setCards((arr) => arr.map((item) => (checked[articleKey(item)] ? { ...item, selected_by: name } : item)));
    setChecked({});
    setBatchSelect(null);
    trackAction('batch_select', `${payloads.length} search results`);
    await Promise.all(payloads.map((payload) => selectWorkflow(payload).catch(() => null)));
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
    <div className="scan-page space-y-6">
      <section className="scan-console deep-search-command relative z-[60]">
        <div className="scan-console-header">
          <div className="scan-title">
            <div className="eyebrow">Deep Search / Manual Investigation</div>
            <h1>Search news signals.</h1>
            <p>Choose sources and a time window, then review results without changing the scheduled homepage briefing.</p>
          </div>
          <div className="scan-telemetry" aria-label="Investigation scope">
            <div className="scan-telemetry-head">
              <span className={running ? 'scan-beacon active' : 'scan-beacon'} />
              <span>{scanStateLabel}</span>
              {running && <small>Live crawl in progress</small>}
            </div>
            <div className="scan-telemetry-grid">
              <div><strong>{scanSourceLabel}</strong><span>Source scope</span></div>
              <div><strong>{cards.length}</strong><span>Signals surfaced</span></div>
              <div><strong>{highSignals}</strong><span>High signal</span></div>
            </div>
            <p>Session workspace. Results remain while you navigate this app and reset on browser refresh.</p>
          </div>
        </div>

        <div className="scan-query-console">
          <div className="scan-query-label">
            <Icon name="search" size={15} />
            <span>Investigation query</span>
            <button
              className="scan-field-help"
              title="Enter comma-separated keywords to search for more than one subject."
              aria-label="Help: investigation keywords"
              onClick={() => openTour(0)}
              type="button"
            >
              ?
            </button>
          </div>
          <div className="scan-query-primary">
            <label className="scan-query-capsule" ref={queryRef}>
              <Icon name="search" size={20} />
              <input
                className="scan-query-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
                placeholder="Keywords separated by commas, e.g. Samsung, OLED, Nvidia, robotics"
              />
            </label>
            <div className="scan-search-action" ref={searchRef}>
              <button
                className="scan-field-help scan-search-help"
                title="Start a streamed manual search using this query, date range, and source scope."
                aria-label="Help: run deep search"
                onClick={() => openTour(3)}
                type="button"
              >
                ?
              </button>
              {running ? (
                <button className="scan-run scan-run-primary stop" onClick={stop} type="button"><Icon name="stop" /> Stop Scan</button>
              ) : (
                <button className="scan-run scan-run-primary" onClick={start} type="button"><Icon name="search" /> Run Deep Search</button>
              )}
            </div>
          </div>
          <div className="scan-command-controls">
            <div ref={dateRangeRef}>
              <DateRangePicker
                from={from}
                to={to}
                helpText="Deep Search starts with today only. Choose a broader range when your investigation needs older signals."
                onHelp={() => openTour(1)}
                onChange={({ from: nextFrom, to: nextTo }) => {
                  setFrom(nextFrom);
                  setTo(nextTo);
                }}
              />
            </div>
            <div ref={sourcesRef}>
              <div className="scan-field-label">
                <span>Sources</span>
                <button
                  className="scan-field-help"
                  title="Searches every active source unless you select specific publications here."
                  aria-label="Help: source scope"
                  onClick={() => openTour(2)}
                  type="button"
                >
                  ?
                </button>
              </div>
              <SourcePicker sites={sites} selected={pickedSites} onApply={setPicked} />
            </div>
            <div className="scan-scope-note" aria-label="Manual search session behavior">
              <span>Session Workspace</span>
              <p>Results remain available while you navigate this session.</p>
            </div>
          </div>
        </div>
      </section>

      {tourStep !== null && (
        <DeepScanTour
          step={tourStep}
          targetRef={[queryRef, dateRangeRef, sourcesRef, searchRef][tourStep]}
          onNext={nextTourStep}
          onDismiss={dismissTour}
        />
      )}

      {(started || cards.length > 0) && (
        <section className="scan-summary rounded-[22px] border border-white/10 bg-[#101827]/80 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Search Summary</h2>
              <p className="mt-1 text-sm text-slate-400">
                {cards.length} articles found · {cards.length} clusters · {highSignals} high-signal results
              </p>
              <p className="mt-1 text-sm text-slate-500">Query: {query} · {from} to {to} · {pickedSites.length || 'All'} sources</p>
            </div>
            <span className="text-sm text-slate-400">{status}</span>
          </div>
        </section>
      )}

      <div className="scan-filter-rail">
        <div className="scan-filter-label"><Icon name="filter" size={14} /> Results lens</div>
        {['All', 'High Signal', 'India', 'Korea', 'AI Models', 'With Images'].map((chip) => (
          <button
            key={chip}
            className={resultFilter === chip ? 'scan-filter-chip active' : 'scan-filter-chip'}
            onClick={() => setResultFilter(chip)}
            type="button"
          >
            {chip}
          </button>
        ))}
        {cards.length > 0 && <span className="scan-result-count">{visibleCards.length} of {cards.length} visible</span>}
      </div>

      <section className="scan-result-stage space-y-8">
        {Object.keys(groups).length > 0 ? Object.entries(groups).map(([day, items]) => (
          <div key={day} className="space-y-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-white">{day}</h2>
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-sm text-slate-500">{items.length} results</span>
            </div>
            <div className="article-grid grid gap-8 2xl:grid-cols-2">
              {items.map((item) => (
                <ArticleCard
                  key={item.id}
                  item={item}
                  variant={cardVariant(item)}
                  vote={votes[item.id]}
                  onVote={onVote}
                  onSelect={setPendingSelect}
                  onOpen={setOpen}
                  onHide={(x) => onVote(x, 'down')}
                  onCheck={onCheck}
                  checked={!!checked[articleKey(item)]}
                  isSelected={!!item.selected_by}
                />
              ))}
            </div>
          </div>
        )) : (
          <div className="scan-idle-stage">
            <div className={running ? 'scan-radar active' : 'scan-radar'} aria-hidden="true">
              <span className="radar-ring one" />
              <span className="radar-ring two" />
              <span className="radar-crosshair" />
              <Icon name={running ? 'refresh' : 'search'} size={23} />
            </div>
            <div className="scan-idle-copy">
              <div className="eyebrow">{running ? 'Signal Acquisition Active' : started ? 'Investigation Complete' : 'Awaiting Investigation'}</div>
              <h2>{running ? 'Sweeping selected intelligence sources' : started ? 'No signals matched this lens' : 'Define a target and begin scanning'}</h2>
              <p>
                {running
                  ? 'Crawling sources, filtering candidate articles, and clustering coverage as results arrive.'
                  : started
                    ? 'Widen your date window, choose additional sources, or adjust the query to surface a new trail.'
                    : 'Manual results stay in this workspace while you navigate and do not alter the scheduled homepage briefing.'}
              </p>
            </div>
            {!running && (
              <div className="scan-idle-actions">
                <button className="source-chip" onClick={() => setQuery('Samsung OLED AI')} type="button">Samsung OLED AI</button>
                <button className="source-chip" onClick={() => setQuery('Semiconductor display investment')} type="button">Display investment</button>
              </div>
            )}
          </div>
        )}
      </section>

      {hiddenCount > 0 && (
        <button
          className="hidden-review-link scan-hidden-signals inline-flex w-full max-w-xl items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-sky-300/25 hover:bg-white/[0.055] sm:w-auto sm:min-w-[420px]"
          onClick={() => navigate('/rejected')}
          type="button"
        >
          <span>
            <span className="block text-sm font-semibold text-white">Review Hidden Signals</span>
            <span className="mt-1 block text-xs text-slate-400">{hiddenCount} articles hidden from this search.</span>
          </span>
          <span className="btn-dark-secondary h-9">Open Hidden Review</span>
        </button>
      )}

      {started && <ScanActivityPanel running={running} logs={logs} hasBatch={selectedBatch.length > 0} />}

      <ArticleModal
        item={openArticle}
        onClose={() => setOpen(null)}
        onSelect={selectFromDossier}
        onHide={hideFromDossier}
        onVote={onVote}
        onCorrectRegion={onCorrectRegion}
      />
      <NameModal open={!!pendingSelect} article={pendingSelect} onClose={() => setPendingSelect(null)} onConfirm={confirmSelect} />
      <NameModal
        open={!!batchSelect}
        article={batchSelect}
        title={`Send ${selectedBatch.length} articles to Review Queue`}
        description="Enter your name."
        confirmLabel="Send to Review Queue"
        onClose={() => setBatchSelect(null)}
        onConfirm={confirmBatch}
      />
      <DraftExportModal
        items={selectedBatch}
        open={draftExportOpen}
        source="deep_scan"
        onClose={() => setDraftExportOpen(false)}
      />

      {selectedBatch.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="batch-action-bar flex flex-wrap items-center justify-center gap-3 rounded-full border border-sky-300/20 bg-[#101827]/95 px-5 py-3 text-sm text-slate-200 shadow-cockpit backdrop-blur-xl">
            <strong>{selectedBatch.length} selected</strong>
            <button className="btn-dark-secondary h-9" onClick={() => setChecked({})} type="button">Clear</button>
            <button className="btn-dark-primary h-9" onClick={() => setBatchSelect({ title: `${selectedBatch.length} selected signals` })} type="button">Send to Review Queue</button>
            <button className="btn-dark-secondary h-9" onClick={() => setDraftExportOpen(true)} type="button">Draft Export</button>
          </div>
        </div>
      )}
    </div>
  );
}
