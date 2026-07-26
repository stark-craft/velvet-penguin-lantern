import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { correctRegion, getHistoryFile, getHistoryList, getHistoryRange } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { cardVariant, groupedByDate, publishedTime, scoreOf } from '../utils/intelligence.js';

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FILTERS = {
  text: '',
  category: 'all',
  region: 'all',
  source: 'all',
  signal: 'all',
  image: 'all',
  sort: 'date_desc',
};

function dateAddDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
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

function ArchiveRunStrip({ runs, activeRunLabel, onOpenRun }) {
  if (!runs.length) return null;

  return (
    <section className="archive-run-strip">
      <div className="archive-strip-head">
        <div>
          <div className="eyebrow archive-accent">Run Timeline</div>
          <p>Open a single archived run, or keep the combined range search loaded above.</p>
        </div>
        <span>{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </div>

      <div className="archive-strip-scroll">
        {runs.slice(0, 18).map((run) => (
          <button
            key={run.filename}
            className={activeRunLabel === run.label ? 'archive-run-pill active' : 'archive-run-pill'}
            onClick={() => onOpenRun(run)}
            type="button"
          >
            <span className="archive-run-time">{run.time}</span>
            <span className="archive-run-type">{run.type === 'scheduler' ? 'Scheduler' : 'Manual'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function HistoryScreen() {
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

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => setFilters({ ...EMPTY_FILTERS });

  const loadArchiveRange = async (nextFrom = from, nextTo = to) => {
    setLoading(true);
    setErr('');
    setSearched(true);
    setActiveRunLabel('');

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

  useEffect(() => {
    loadArchiveRange();
  }, []);

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
  const articleGroups = useMemo(() => groupedByDate(filteredArticles), [filteredArticles]);
  const keywords = topKeywords(articles, 6);

  return (
    <div className="workflow-page archive-page archive-search-page space-y-6">
      <form
        className="archive-search-console"
        onSubmit={(event) => {
          event.preventDefault();
          loadArchiveRange();
        }}
      >
        <section className="archive-search-hero">
          <div>
            <div className="eyebrow archive-accent">Briefing Archive / Memory Search</div>
            <h1>Search archived intelligence.</h1>
            <p>
              Load every retained briefing signal in a date range, then filter the loaded archive
              by keyword, category, source, region, score, and image coverage.
            </p>
          </div>

          <div className="archive-memory-meter">
            <span>Loaded Workspace</span>
            <strong>{loadedMetrics.total}</strong>
            <small>{from} &rarr; {to}</small>
          </div>
        </section>

        <section className="archive-query-panel">
          <div className="archive-range-row">
            <DateRangePicker
              from={from}
              to={to}
              label="Archive Date Range"
              helpText="Choose the retained briefing dates to load into this archive workspace."
              onChange={({ from: nextFrom, to: nextTo }) => {
                setFrom(nextFrom);
                setTo(nextTo);
              }}
            />

            <div className="archive-preset-group" aria-label="Archive presets">
              <button className="source-chip" onClick={() => setPreset(1)} type="button">Today</button>
              <button className="source-chip" onClick={() => setPreset(7)} type="button">7 days</button>
              <button className="source-chip" onClick={() => setPreset(30)} type="button">30 days</button>
            </div>

            <button className="btn-dark-primary archive-fetch-button" type="submit">
              <Icon name="search" /> Search Archive
            </button>
          </div>

          <div className="archive-inline-search">
            <Icon name="search" size={18} />
            <input
              value={filters.text}
              onChange={(event) => updateFilter('text', event.target.value)}
              placeholder="Search loaded archive by title, summary, source, keyword..."
            />
            {filters.text && (
              <button
                className="archive-clear-search"
                onClick={() => updateFilter('text', '')}
                type="button"
                aria-label="Clear archive search"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>

          <div className="archive-filter-grid">
            <select className="dark-input" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
              <option value="all">All Regions</option>
              {options.regions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>

            <select className="dark-input" value={filters.category} onChange={(event) => updateFilter('category', event.target.value)}>
              <option value="all">All Categories</option>
              {options.categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>

            <select className="dark-input" value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}>
              <option value="all">All Sources</option>
              {options.sources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>

            <select className="dark-input" value={filters.signal} onChange={(event) => updateFilter('signal', event.target.value)}>
              <option value="all">All Signals</option>
              <option value="high">High Signal</option>
              <option value="clustered">Multi-source</option>
              <option value="single">Single-source</option>
              <option value="fresh">Fresh</option>
            </select>

            <select className="dark-input" value={filters.image} onChange={(event) => updateFilter('image', event.target.value)}>
              <option value="all">Any Image</option>
              <option value="with">With Image</option>
              <option value="without">No Image</option>
            </select>

            <select className="dark-input" value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)}>
              <option value="date_desc">Newest First</option>
              <option value="score_desc">Highest Score</option>
              <option value="sources_desc">Most Sources</option>
              <option value="title_asc">Title A-Z</option>
            </select>
          </div>
        </section>
      </form>

      <section className="workflow-metric-row archive archive-search-metrics">
        <div className="workflow-metric"><Icon name="layers" /><span>Loaded signals</span><strong>{loadedMetrics.total}</strong></div>
        <div className="workflow-metric"><Icon name="filter" /><span>Visible now</span><strong>{visibleMetrics.total}</strong></div>
        <div className="workflow-metric"><Icon name="trend" /><span>High signal</span><strong>{visibleMetrics.high}</strong></div>
        <div className="workflow-metric"><Icon name="archive" /><span>Runs in range</span><strong>{runs.length}</strong></div>
      </section>

      {keywords.length > 0 && (
        <section className="archive-keyword-ribbon">
          <span>Top archive keywords</span>
          <div>
            {keywords.map((keyword) => (
              <button
                key={keyword}
                className="source-chip"
                onClick={() => updateFilter('text', keyword)}
                type="button"
              >
                {keyword}
              </button>
            ))}
          </div>
        </section>
      )}

      <ArchiveRunStrip runs={runs} activeRunLabel={activeRunLabel} onOpenRun={openRun} />

      <section className="archive-results-panel">
        <div className="archive-results-head">
          <div>
            <div className="eyebrow">Loaded Archive Results</div>
            <h2>{activeRunLabel || `${from} to ${to}`}</h2>
          </div>

          <div className="archive-results-actions">
            <button className="btn-dark-secondary" onClick={resetFilters} type="button">
              Reset filters
            </button>
            <span>{filteredArticles.length} visible</span>
          </div>
        </div>

        {loading ? (
          <div className="workflow-empty archive">
            <Icon name="refresh" size={25} />
            <h2>Loading archive workspace</h2>
          </div>
        ) : err ? (
          <div className="rounded-[24px] border border-red-300/20 bg-red-950/20 p-10 text-center">
            <h2 className="text-xl font-semibold text-white">Failed to load archive</h2>
            <p className="mt-2 text-red-200">{err}</p>
          </div>
        ) : !searched || !articles.length ? (
          <div className="workflow-empty archive">
            <Icon name="archive" size={27} />
            <h2>No archive signals loaded for this range.</h2>
            <p>Try a broader date range or open a retained run from the timeline.</p>
          </div>
        ) : !filteredArticles.length ? (
          <div className="workflow-empty archive">
            <Icon name="filter" size={27} />
            <h2>No signals match the active filters.</h2>
            <p>Reset filters or search a different keyword inside the loaded archive.</p>
          </div>
        ) : (
          <div className="archive-result-groups space-y-8">
            {Object.entries(articleGroups).map(([day, items]) => (
              <div key={day} className="space-y-4">
                <div className="workflow-day-head">
                  <h2>{day}</h2>
                  <span>{items.length} archived signal{items.length === 1 ? '' : 's'}</span>
                </div>
                <div className="article-grid grid gap-8 2xl:grid-cols-2">
                  {items.map((item) => (
                    <ArticleCard
                      key={item.id}
                      item={item}
                      variant={cardVariant(item)}
                      onOpen={setOpenArticle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ArticleModal
        item={openArticle}
        onClose={() => setOpenArticle(null)}
        onCorrectRegion={onCorrectRegion}
      />
    </div>
  );
}
