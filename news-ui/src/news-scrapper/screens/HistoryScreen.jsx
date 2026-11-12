import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { SignalVisual } from '../components/ArticleCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { correctRegion, getHistoryFile, getHistoryList, getHistoryRange, getWorkflow, importWorkflow } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { articleKey, groupedByDate, publishedTime, scoreOf } from '../utils/intelligence.js';
import { addLocalDays, localDateString } from '../utils/localDate.js';
import { articleActivityDetail, trackAction } from '../utils/tracking.js';
import './history-redesign.css';

const TODAY = localDateString();
const ARCHIVE_PAGE_SIZE = 48;

const EMPTY_FILTERS = {
  text: '',
  category: 'all',
  region: 'all',
  source: 'all',
  signal: 'all',
  image: 'all',
  sort: 'date_desc',
};

export function dateAddDays(dateStr, delta) {
  return addLocalDays(dateStr, delta);
}

function parseRun(file) {
  const filename = file.filename || '';
  const match = filename.match(/(\d{4}-\d{2}-\d{2})[_-](\d{2})-(\d{2})/);
  const date = match?.[1] || TODAY;
  const time = match ? `${match[2]}:${match[3]}` : '00:00';
  const d = new Date(`${date}T${time}:00`);

  return {
    ...file,
    date,
    time,
    timestamp: Number.isNaN(d.getTime()) ? 0 : d.getTime(),
    label: Number.isNaN(d.getTime())
      ? file.display || filename
      : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function topKeywords(items, limit = 5) {
  const map = new Map();

  items.forEach((item) => {
    (item.keywords || []).forEach((keyword) => {
      map.set(keyword, (map.get(keyword) || 0) + 1);
    });
  });

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function metricSummary(items) {
  return {
    total: items.length,
    high: items.filter((item) => scoreOf(item) >= 80).length,
    clustered: items.filter((item) => (item.source_count || 1) > 1).length,
    sources: uniqueSorted(items.map((item) => item.src)).length,
  };
}

function friendlyDate(value, options = {}) {
  if (!value) return 'Date unavailable';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

function filterCount(filters) {
  return Object.entries(filters).filter(([key, value]) => (
    key === 'text' ? Boolean(value.trim()) : value !== EMPTY_FILTERS[key]
  )).length;
}

function ArchiveMetric({ icon, label, value, detail }) {
  return (
    <div className="archive-v2-metric">
      <span className="archive-v2-metric-icon" aria-hidden="true"><Icon name={icon} size={17} /></span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function ArchiveStoryCard({ item, checked, inWorkflow, busy, onCheck, onOpen, onImport, reviewAllowed = false }) {
  const score = scoreOf(item);
  const parsedSourceCount = Number(item.source_count || 1);
  const sourceCount = Number.isFinite(parsedSourceCount) && parsedSourceCount > 0 ? parsedSourceCount : 1;
  const keywords = Array.isArray(item.keywords) ? item.keywords.slice(0, 3) : [];

  return (
    <article className={`archive-v2-story ${checked ? 'is-checked' : ''}`}>
      <div className="archive-v2-story-visual">
        <SignalVisual item={item} className="archive-v2-story-image" label={false} />
        <div className="archive-v2-story-shade" aria-hidden="true" />
        {reviewAllowed && <label className="archive-v2-story-check">
          <input
            checked={checked}
            disabled={busy}
            onChange={(event) => onCheck(item, event.target.checked)}
            type="checkbox"
          />
          <span><Icon name="check" size={14} /></span>
          <b>{checked ? 'Selected' : 'Select'}</b>
        </label>}
        <span className={`archive-v2-score ${score >= 80 ? 'is-high' : ''}`}>Signal {score}</span>
      </div>

      <div className="archive-v2-story-body">
        <div className="archive-v2-story-meta">
          <span>{item.category || 'Intelligence'}</span>
          <i aria-hidden="true" />
          <span>{item.region || 'Global'}</span>
          {item.is_fresh && <strong>Fresh</strong>}
        </div>

        <button className="archive-v2-story-title" onClick={() => onOpen(item)} type="button">
          {item.title || 'Untitled archived signal'}
        </button>

        <p>{item.summary || 'No summary was retained for this archived signal.'}</p>

        {keywords.length > 0 && (
          <div className="archive-v2-story-keywords" aria-label="Matched keywords">
            {keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
          </div>
        )}
      </div>

      <footer className="archive-v2-story-footer">
        <div className="archive-v2-story-source">
          <span>{item.src || 'Unknown source'}</span>
          <small>{friendlyDate(item.date)} · {sourceCount} source{sourceCount === 1 ? '' : 's'}</small>
        </div>
        <div className="archive-v2-story-actions">
          <button className="archive-v2-icon-button" onClick={() => onOpen(item)} type="button" aria-label={`Open dossier for ${item.title}`}>
            <Icon name="file" size={16} />
          </button>
          {reviewAllowed && (inWorkflow ? (
            <span className="archive-v2-workflow-state"><Icon name="check2" size={15} /> In review</span>
          ) : (
            <button className="archive-v2-import-one" disabled={busy} onClick={() => onImport(item)} type="button">
              <Icon name="upload" size={15} /> {busy ? 'Working…' : 'Add to review'}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
}

function matchesText(item, text) {
  const q = text.trim().toLowerCase();
  if (!q) return true;

  return [
    item.title,
    item.summary,
    item.src,
    item.category,
    item.region,
    ...(item.keywords || []),
  ].join(' ').toLowerCase().includes(q);
}

function applyArchiveFilters(items, filters) {
  const filtered = items.filter((item) => {
    if (!matchesText(item, filters.text)) return false;
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.region !== 'all' && item.region !== filters.region) return false;
    if (filters.source !== 'all' && item.src !== filters.source) return false;

    if (filters.signal === 'high' && scoreOf(item) < 80) return false;
    if (filters.signal === 'clustered' && (item.source_count || 1) <= 1) return false;
    if (filters.signal === 'single' && (item.source_count || 1) > 1) return false;
    if (filters.signal === 'fresh' && !item.is_fresh) return false;

    if (filters.image === 'with' && !item.image_url) return false;
    if (filters.image === 'without' && item.image_url) return false;

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sort === 'score_desc') return scoreOf(b) - scoreOf(a);
    if (filters.sort === 'sources_desc') return (b.source_count || 1) - (a.source_count || 1);
    if (filters.sort === 'title_asc') return a.title.localeCompare(b.title);
    return publishedTime(b) - publishedTime(a);
  });
}

function ArchiveRunStrip({ runs, activeRunLabel, onOpenRun, disabled }) {
  const [visibleCount, setVisibleCount] = useState(18);
  useEffect(() => setVisibleCount(18), [runs]);
  if (!runs.length) return null;

  return (
    <section className="archive-v2-runs" aria-labelledby="archive-run-heading">
      <div className="archive-v2-section-head">
        <div>
          <span className="archive-v2-kicker"><Icon name="history" size={14} /> Briefing editions</span>
          <h2 id="archive-run-heading">Revisit a single newsroom run</h2>
          <p>Each edition preserves the exact signals available at that moment.</p>
        </div>
        <span className="archive-v2-count-badge">{Math.min(visibleCount, runs.length)} of {runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>

      <div className="archive-v2-run-track">
        {runs.slice(0, visibleCount).map((run) => (
          <button
            key={run.filename}
            className={activeRunLabel === run.label ? 'archive-v2-run is-active' : 'archive-v2-run'}
            disabled={disabled}
            onClick={() => onOpenRun(run)}
            type="button"
            aria-pressed={activeRunLabel === run.label}
          >
            <span className="archive-v2-run-date">{friendlyDate(run.date, { year: undefined })}</span>
            <strong>{run.time}</strong>
            <span>{run.type === 'scheduler' ? 'Scheduled edition' : 'Manual edition'}</span>
            <Icon name="chevR" size={15} />
          </button>
        ))}
      </div>
      {visibleCount < runs.length && <button className="archive-v2-show-runs" onClick={() => setVisibleCount((count) => Math.min(runs.length, count + 18))} type="button"><Icon name="chevD" size={15} /> Show {Math.min(18, runs.length - visibleCount)} more editions</button>}
    </section>
  );
}

export default function HistoryScreen({ reviewAllowed = false }) {
  const [from, setFrom] = useState(dateAddDays(TODAY, -6));
  const [to, setTo] = useState(TODAY);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [articles, setArticles] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [searched, setSearched] = useState(false);
  const [activeRunLabel, setActiveRunLabel] = useState('');
  const [openArticle, setOpenArticle] = useState(null);
  const [checkedKeys, setCheckedKeys] = useState(new Set());
  const [workflowKeys, setWorkflowKeys] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [workflowWarning, setWorkflowWarning] = useState('');
  const [draftExportOpen, setDraftExportOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(ARCHIVE_PAGE_SIZE);

  const updateFilter = (key, value) => {
    setRenderLimit(ARCHIVE_PAGE_SIZE);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => {
    setRenderLimit(ARCHIVE_PAGE_SIZE);
    setFilters({ ...EMPTY_FILTERS });
  };

  const loadArchiveRange = async (nextFrom = from, nextTo = to) => {
    if (!nextFrom || !nextTo || nextFrom > nextTo) {
      setErr('Choose a valid range where the start date is not after the end date.');
      setSearched(true);
      return;
    }
    setLoading(true);
    setErr('');
    setSearched(true);
    setActiveRunLabel('');
    setNotice('');
    setCheckedKeys(new Set());
    setRenderLimit(ARCHIVE_PAGE_SIZE);

    try {
      const [rangeData, runList] = await Promise.all([
        getHistoryRange(nextFrom, nextTo),
        getHistoryList(),
      ]);

      const rangeItems = normalizeList(
        rangeData?.results || rangeData?.articles || rangeData?.result || []
      );

      const archiveRuns = (Array.isArray(runList) ? runList : [])
        .filter((file) => String(file.filename || '').endsWith('.json'))
        .map(parseRun)
        .filter((run) => run.date >= nextFrom && run.date <= nextTo)
        .sort((a, b) => b.timestamp - a.timestamp);

      setArticles(rangeItems);
      setRuns(archiveRuns);
    } catch (error) {
      setErr(error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  const loadWorkflowState = async () => {
    if (!reviewAllowed) return;
    setWorkflowWarning('');
    try {
      const result = await getWorkflow();
      setWorkflowKeys(new Set([
        ...normalizeList(result?.selected || []),
        ...normalizeList(result?.approved || []),
      ].map(articleKey)));
    } catch (error) {
      setWorkflowWarning(error?.message || 'Review Queue status could not be loaded. Archive search and export still work.');
    }
  };

  useEffect(() => {
    loadArchiveRange();
    if (reviewAllowed) loadWorkflowState();
  }, [reviewAllowed]);

  const setPreset = (days) => {
    const nextFrom = dateAddDays(TODAY, -(days - 1));
    const nextTo = TODAY;
    setFrom(nextFrom);
    setTo(nextTo);
    loadArchiveRange(nextFrom, nextTo);
  };

  const openRun = async (run) => {
    setLoading(true);
    setErr('');
    setActiveRunLabel(run.label);
    setNotice('');
    setCheckedKeys(new Set());
    setRenderLimit(ARCHIVE_PAGE_SIZE);

    try {
      const data = await getHistoryFile(run.filename);
      setArticles(normalizeList(data?.results || data?.articles || data || []));
      resetFilters();
    } catch (error) {
      setErr(error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  const onCorrectRegion = async (item, correction) => {
    const result = await correctRegion(item, correction.region, correction.keywords, correction.reason);
    const patch = { region: result.region, region_basis: 'User corrected' };

    setArticles((items) => items.map((article) => (
      article.title === item.title ? { ...article, ...patch } : article
    )));
    setOpenArticle((article) => (article?.title === item.title ? { ...article, ...patch } : article));

    return result;
  };

  const options = useMemo(() => ({
    categories: uniqueSorted(articles.map((item) => item.category)),
    regions: uniqueSorted(articles.map((item) => item.region)),
    sources: uniqueSorted(articles.map((item) => item.src)),
  }), [articles]);

  const filteredArticles = useMemo(
    () => applyArchiveFilters(articles, filters),
    [articles, filters],
  );

  const loadedMetrics = useMemo(() => metricSummary(articles), [articles]);
  const visibleMetrics = useMemo(() => metricSummary(filteredArticles), [filteredArticles]);
  const renderedArticles = useMemo(
    () => filteredArticles.slice(0, renderLimit),
    [filteredArticles, renderLimit],
  );
  const articleGroups = useMemo(() => groupedByDate(renderedArticles), [renderedArticles]);
  const keywords = topKeywords(articles, 6);
  const checkedArticles = useMemo(
    () => articles.filter((item) => checkedKeys.has(articleKey(item))),
    [articles, checkedKeys],
  );
  const activeFilters = filterCount(filters);
  const selectableVisible = renderedArticles.slice(0, 100);
  const allVisibleChecked = Boolean(selectableVisible.length)
    && selectableVisible.every((item) => checkedKeys.has(articleKey(item)));

  const toggleVisible = () => {
    setCheckedKeys((current) => {
      const next = new Set(current);
      selectableVisible.forEach((item) => {
        const key = articleKey(item);
        if (allVisibleChecked) next.delete(key); else next.add(key);
      });
      return next;
    });
    if (!allVisibleChecked && renderedArticles.length > 100) {
      setNotice('The first 100 rendered signals are checked. Import them, then continue with the next group.');
    }
  };

  const importArticles = async (items) => {
    if (!items.length || importing) return;
    if (items.length > 100) {
      setNotice('Import up to 100 archived signals at a time. Narrow the filters or clear some checks.');
      return;
    }
    setImporting(true);
    setErr('');
    setNotice('');
    try {
      const response = await importWorkflow(items);
      const imported = Number(response?.imported || 0);
      const existing = Number(response?.already_present || 0);
      setWorkflowKeys((current) => {
        const next = new Set(current);
        items.forEach((item) => next.add(articleKey(item)));
        return next;
      });
      setCheckedKeys((current) => {
        const next = new Set(current);
        items.forEach((item) => next.delete(articleKey(item)));
        return next;
      });
      setNotice([
        imported ? `${imported} signal${imported === 1 ? '' : 's'} imported to the Review Queue.` : '',
        existing ? `${existing} already existed.` : '',
      ].filter(Boolean).join(' ') || 'The selected signals were already in the workflow.');
    } catch (error) {
      setErr(error?.message || 'Could not import the selected archive signals.');
    } finally {
      setImporting(false);
    }
  };
  const openArchiveArticle = (item) => {
    trackAction('dossier_open', articleActivityDetail(item, 'briefing_archive'));
    setOpenArticle(item);
  };

  return (
    <div className="archive-v2-page">
      <section className="archive-v2-hero is-compact" aria-labelledby="archive-page-title">
        <div className="archive-v2-hero-copy">
          <span className="archive-v2-kicker"><Icon name="archive" size={15} /> Briefing archive</span>
          <h1 id="archive-page-title">Briefing Archive</h1>
          <div className="archive-v2-hero-tags" aria-label="Current archive scope">
            <span><Icon name="calendar" size={14} /> {friendlyDate(from)} — {friendlyDate(to)}</span>
            <span><Icon name="layers" size={14} /> {activeRunLabel || 'Combined range'}</span>
          </div>
        </div>

        <aside className="archive-v2-index" aria-label="Loaded archive index">
          <div className="archive-v2-index-top">
            <span>Archive index</span>
            <Icon name="history" size={18} />
          </div>
          <strong>{String(loadedMetrics.total).padStart(2, '0')}</strong>
          <p>retained signals in this range</p>
          <div className="archive-v2-index-foot">
            <span><b>{loadedMetrics.sources}</b> sources</span>
            <span><b>{runs.length}</b> editions</span>
          </div>
        </aside>
      </section>

      <section className="archive-v2-metrics" aria-label="Archive summary">
        <ArchiveMetric icon="layers" label="Loaded" value={loadedMetrics.total} detail="in workspace" />
        <ArchiveMetric icon="filter" label="Showing" value={visibleMetrics.total} detail={activeFilters ? `${activeFilters} active filters` : 'all signals'} />
        <ArchiveMetric icon="trend" label="High signal" value={visibleMetrics.high} detail="score 80 or above" />
        <ArchiveMetric icon="duplicate" label="Multi-source" value={visibleMetrics.clustered} detail="corroborated stories" />
      </section>

      <form
        className="archive-v2-workbench"
        aria-busy={loading}
        onSubmit={(event) => {
          event.preventDefault();
          loadArchiveRange();
        }}
      >
        <div className="archive-v2-workbench-head">
          <div>
            <span className="archive-v2-kicker"><Icon name="search" size={14} /> Archive scope</span>
            <h2>Build a briefing workspace</h2>
            <p>Choose a retained period first, then refine the loaded intelligence instantly.</p>
          </div>
          {activeFilters > 0 && (
            <button className="archive-v2-text-action" onClick={resetFilters} type="button">
              <Icon name="x" size={14} /> Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
            </button>
          )}
        </div>

        <div className="archive-v2-scope-row">
          <div className="archive-v2-date-field">
            <DateRangePicker
              from={from}
              to={to}
              label="Retained date range"
              helpText="Choose the retained briefing dates to load into this archive workspace."
              onChange={({ from: nextFrom, to: nextTo }) => {
                setFrom(nextFrom);
                setTo(nextTo);
              }}
            />
          </div>

          <div className="archive-v2-presets" aria-label="Archive date presets">
            {[
              [1, 'Today'],
              [7, '7 days'],
              [30, '30 days'],
            ].map(([days, label]) => {
              const selected = from === dateAddDays(TODAY, -(days - 1)) && to === TODAY;
              return (
                <button
                  key={days}
                  className={selected ? 'is-active' : ''}
                  disabled={loading}
                  onClick={() => setPreset(days)}
                  type="button"
                  aria-pressed={selected}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button className="archive-v2-load-button" disabled={loading || !from || !to} type="submit">
            <Icon name={loading ? 'refresh' : 'search'} size={17} />
            {loading ? 'Loading archive…' : 'Load this range'}
          </button>
        </div>

        <div className="archive-v2-search-row">
          <label className="archive-v2-search-field">
            <span className="sr-only">Search the loaded archive</span>
            <Icon name="search" size={19} />
            <input
              value={filters.text}
              onChange={(event) => updateFilter('text', event.target.value)}
              placeholder="Search headlines, summaries, sources, or matched keywords"
              type="search"
            />
            {filters.text && (
              <button onClick={() => updateFilter('text', '')} type="button" aria-label="Clear archive search">
                <Icon name="x" size={15} />
              </button>
            )}
          </label>

          <div className="archive-v2-filter-grid">
            <label>
              <span>Region</span>
              <select value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
                <option value="all">All regions</option>
                {options.regions.map((region) => <option key={region} value={region}>{region}</option>)}
              </select>
            </label>

            <label>
              <span>Category</span>
              <select value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
                <option value="all">All categories</option>
                {options.categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>

            <label>
              <span>Source</span>
              <select value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}>
                <option value="all">All sources</option>
                {options.sources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </label>

          </div>
        </div>
      </form>

      <ArchiveRunStrip
        runs={runs}
        activeRunLabel={activeRunLabel}
        disabled={loading}
        onOpenRun={openRun}
      />

      <section className="archive-v2-results" aria-labelledby="archive-results-title" aria-busy={loading}>
        <header className="archive-v2-results-head">
          <div>
            <span className="archive-v2-kicker"><Icon name="layers" size={14} /> Loaded intelligence</span>
            <h2 id="archive-results-title">{activeRunLabel || 'Combined archive desk'}</h2>
            <p aria-live="polite">
              {filteredArticles.length} of {articles.length} signal{articles.length === 1 ? '' : 's'} visible
              {renderedArticles.length < filteredArticles.length ? ` · ${renderedArticles.length} rendered` : ''}
              {checkedArticles.length ? ` · ${checkedArticles.length} selected` : ''}
            </p>
          </div>

          <div className="archive-v2-bulk-actions" aria-label="Archive bulk actions">
            {reviewAllowed && <button
              className="archive-v2-secondary-button"
              disabled={!filteredArticles.length || loading}
              onClick={toggleVisible}
              type="button"
            >
              <Icon name="check" size={15} />
              {allVisibleChecked ? 'Clear rendered' : renderedArticles.length > 100 ? 'Select first 100' : 'Select rendered'}
            </button>}
            {reviewAllowed && <button
              className="archive-v2-secondary-button"
              disabled={!checkedArticles.length || importing}
              onClick={() => setDraftExportOpen(true)}
              type="button"
            >
              <Icon name="download" size={15} /> Export selected
            </button>}
            {reviewAllowed && <button
              className="archive-v2-primary-button"
              disabled={!checkedArticles.length || importing}
              onClick={() => importArticles(checkedArticles)}
              type="button"
            >
              <Icon name="upload" size={15} />
              {importing ? 'Importing…' : `Send to review${checkedArticles.length ? ` (${checkedArticles.length})` : ''}`}
            </button>}
            {checkedArticles.length > 0 && (
              <button className="archive-v2-clear-button" onClick={() => setCheckedKeys(new Set())} type="button" aria-label="Clear all selected archive signals">
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
        </header>

        {notice && (
          <div className="archive-v2-notice" role="status">
            <Icon name="check2" size={18} />
            <span>{notice}</span>
            <button onClick={() => setNotice('')} type="button" aria-label="Dismiss archive notice"><Icon name="x" size={14} /></button>
          </div>
        )}

        {reviewAllowed && workflowWarning && (
          <div className="archive-v2-notice is-warning" role="status">
            <Icon name="warning" size={18} />
            <span>Review Queue markers are temporarily unavailable. {workflowWarning}</span>
            <button onClick={loadWorkflowState} type="button" aria-label="Retry loading Review Queue status"><Icon name="refresh" size={14} /></button>
          </div>
        )}

        {loading ? (
          <div className="archive-v2-skeleton-grid" role="status" aria-live="polite">
            <span className="sr-only">Loading archive workspace</span>
            {[0, 1, 2, 3].map((item) => <div className="archive-v2-skeleton" key={item}><span /><i /><i /><b /></div>)}
          </div>
        ) : err ? (
          <div className="archive-v2-state is-error" role="alert">
            <span><Icon name="warning" size={25} /></span>
            <small>Archive unavailable</small>
            <h2>We could not load this briefing memory.</h2>
            <p>{err}</p>
            <button className="archive-v2-primary-button" onClick={() => loadArchiveRange()} type="button">
              <Icon name="refresh" size={15} /> Try again
            </button>
          </div>
        ) : !searched || !articles.length ? (
          <div className="archive-v2-state">
            <span><Icon name="archive" size={27} /></span>
            <small>No signals in scope</small>
            <h2>This archive range is quiet.</h2>
            <p>Expand the date range to search more retained briefings, or return to today&apos;s edition.</p>
            <div>
              <button className="archive-v2-primary-button" onClick={() => setPreset(30)} type="button">Explore 30 days</button>
              <button className="archive-v2-secondary-button" onClick={() => setPreset(1)} type="button">Open today</button>
            </div>
          </div>
        ) : !filteredArticles.length ? (
          <div className="archive-v2-state">
            <span><Icon name="filter" size={27} /></span>
            <small>No filter matches</small>
            <h2>Nothing fits this exact lens.</h2>
            <p>Your loaded archive is safe. Clear the filters to reveal all {articles.length} retained signals.</p>
            <button className="archive-v2-primary-button" onClick={resetFilters} type="button">Clear all filters</button>
          </div>
        ) : (
          <div className="archive-v2-groups">
            {Object.entries(articleGroups).map(([day, items]) => (
              <section className="archive-v2-day" key={day} aria-labelledby={`archive-day-${day.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}>
                <div className="archive-v2-day-head">
                  <span>{String(items.length).padStart(2, '0')}</span>
                  <h2 id={`archive-day-${day.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`}>{day}</h2>
                  <i aria-hidden="true" />
                  <small>{items.length} archived signal{items.length === 1 ? '' : 's'}</small>
                </div>
                <div className="archive-v2-story-grid">
                  {items.map((item, index) => (
                    <ArchiveStoryCard
                      busy={importing}
                      checked={checkedKeys.has(articleKey(item))}
                      inWorkflow={workflowKeys.has(articleKey(item))}
                      key={articleKey(item) || `${day}-${index}`}
                      item={item}
                      onCheck={(article, checked) => setCheckedKeys((current) => {
                        const next = new Set(current);
                        if (checked) next.add(articleKey(article)); else next.delete(articleKey(article));
                        return next;
                      })}
                      onOpen={openArchiveArticle}
                      onImport={(article) => importArticles([article])}
                      reviewAllowed={reviewAllowed}
                    />
                  ))}
                </div>
              </section>
            ))}
            {renderedArticles.length < filteredArticles.length && (
              <div className="archive-v2-load-more" role="status">
                <p>
                  Showing {renderedArticles.length} of {filteredArticles.length} matching signals.
                  Load another group when you are ready.
                </p>
                <button
                  className="archive-v2-secondary-button"
                  onClick={() => setRenderLimit((current) => current + ARCHIVE_PAGE_SIZE)}
                  type="button"
                >
                  <Icon name="chevD" size={15} />
                  Show next {Math.min(ARCHIVE_PAGE_SIZE, filteredArticles.length - renderedArticles.length)}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <ArticleModal
        item={openArticle}
        onClose={() => setOpenArticle(null)}
        onCorrectRegion={onCorrectRegion}
        onSelect={reviewAllowed ? (item) => importArticles([item]) : undefined}
      />
      <DraftExportModal
        items={checkedArticles}
        open={draftExportOpen}
        source="archive"
        onClose={() => setDraftExportOpen(false)}
      />
    </div>
  );
}
