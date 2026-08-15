import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { addSite, getSites } from '../api.js';
import { trackAction } from '../utils/tracking.js';

const filters = ['All', 'AI', 'Display', 'Broadcast', 'Business', 'Regional'];

function sourceName(source) {
  return source.name || source.title || String(source);
}

function sourceUrl(source) {
  return source.url || source.feed || source.rss || '';
}

function sourceCategory(source) {
  const category = source.category || source.cat || '';
  return String(category).trim() || 'General Sources';
}

function healthFor(source) {
  const url = sourceUrl(source);
  const raw = String(source.status || source.health || source.rss_health || '').toLowerCase();
  if (raw.includes('fail') || raw.includes('error')) return 'Failed';
  if (raw.includes('warn')) return 'Warning';
  if (raw.includes('healthy') || raw === 'ok' || raw.includes('active')) return 'Healthy';
  if (!url) return 'Failed';
  return 'Configured';
}

function groupByCategory(sources) {
  return sources.reduce((acc, source) => {
    const key = sourceCategory(source);
    if (!acc[key]) acc[key] = [];
    acc[key].push(source);
    return acc;
  }, {});
}

export default function SourcesScreen() {
  const [sites, setSites] = useState([]);
  const [loading, setLoad] = useState(true);
  const [form, setForm] = useState({ name: '', url: '', category: '', profile: 'Default' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [addOpen, setAddOpen] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(36);

  const refresh = async () => {
    setLoad(true);
    setLoadError('');
    try {
      const response = await getSites();
      setSites(Array.isArray(response) ? response : (response?.sites || []));
    } catch (error) {
      setLoadError(error?.message || 'Could not load configured sources.');
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const submit = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setFormError('Enter both a source name and a URL.');
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(form.url.trim());
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported URL scheme');
    } catch {
      setFormError('Enter a complete HTTP or HTTPS URL, for example https://example.com/rss.');
      return;
    }
    const normalizedUrl = parsedUrl.href.replace(/\/$/, '').toLowerCase();
    const duplicate = sites.find((source) => sourceUrl(source).trim().replace(/\/$/, '').toLowerCase() === normalizedUrl);
    if (duplicate) {
      setFormError(`This URL is already configured as ${sourceName(duplicate)}.`);
      return;
    }
    setBusy(true);
    setFormError('');
    setNotice('');
    try {
      await addSite({
        name: form.name.trim(),
        url: parsedUrl.href,
        category: form.category.trim() || 'General Tech',
        profile: form.profile,
      });
      trackAction('add_source', form.name);
      setForm({ name: '', url: '', category: '', profile: 'Default' });
      setNotice('Source added successfully. It will be included in future scans.');
      await refresh();
    } catch (e) {
      setFormError(e?.message || 'Could not add this source.');
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((source) => {
      const name = sourceName(source).toLowerCase();
      const category = sourceCategory(source).toLowerCase();
      const url = sourceUrl(source).toLowerCase();
      const matchesQuery = !q || name.includes(q) || category.includes(q) || url.includes(q);
      const matchesFilter = filter === 'All' || category.includes(filter.toLowerCase());
      return matchesQuery && matchesFilter;
    });
  }, [sites, query, filter]);

  useEffect(() => setDisplayLimit(36), [query, filter]);

  const displayed = useMemo(() => visible.slice(0, displayLimit), [visible, displayLimit]);
  const grouped = useMemo(() => groupByCategory(displayed), [displayed]);
  const configured = sites.filter((s) => ['Healthy', 'Configured'].includes(healthFor(s))).length;
  const failed = sites.filter((s) => healthFor(s) === 'Failed').length;
  const warnings = sites.filter((s) => healthFor(s) === 'Warning').length;

  return (
    <div className="source-control-page space-y-6">
      <section className="source-control-hero rounded-[28px] border border-white/10 bg-[#0b1220]/85 p-6 shadow-cockpit">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Source Control</div>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-5xl">Manage intelligence sources</h1>
            <p className="mt-3 text-slate-400">RSS and news sources used by scheduled scans. Sources can be added, not deleted.</p>
          </div>
          <button className="btn-dark-secondary" disabled={loading} onClick={refresh} type="button">
            <Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className="source-control-metrics metric-grid grid gap-4 md:grid-cols-4">
        <div className="signal-stat"><span>Total Sources</span><strong>{sites.length}</strong></div>
        <div className="signal-stat"><span>Configured</span><strong>{configured}</strong></div>
        <div className="signal-stat"><span>Warnings</span><strong>{warnings}</strong></div>
        <div className="signal-stat"><span>Failed</span><strong>{failed}</strong></div>
      </section>

      <section className="source-add-panel workspace-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <Icon name="plus" /> Add Intelligence Source
          </div>
          <button
            aria-controls="source-add-form"
            aria-expanded={addOpen}
            className="btn-dark-secondary h-9"
            disabled={busy}
            onClick={() => setAddOpen((value) => !value)}
            type="button"
          >
            {addOpen ? 'Collapse' : 'Add Source'}
          </button>
        </div>
        {addOpen && (
          <form id="source-add-form" aria-busy={busy} className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source name</span>
              <input autoComplete="off" className="dark-input" disabled={busy} required value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(''); }} placeholder="Samsung Newsroom" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source or RSS URL</span>
              <input autoComplete="url" className="dark-input" disabled={busy} inputMode="url" required type="url" value={form.url} onChange={(e) => { setForm({ ...form, url: e.target.value }); setFormError(''); }} placeholder="https://..." />
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Category</span>
              <input className="dark-input" disabled={busy} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Display Tech" />
            </label>
            <button className="btn-dark-primary h-11 justify-center" disabled={busy} type="submit">
              {busy ? 'Adding...' : 'Add Source'}
            </button>
          </form>
        )}
        {formError && <div className="mt-3 text-sm text-red-300" role="alert">{formError}</div>}
        {notice && <div className="mt-3 text-sm text-emerald-300" role="status">{notice}</div>}
      </section>

      <section className="source-filter-panel rounded-[22px] border border-white/10 bg-white/[0.035] p-4">
        <input className="dark-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources..." />
        <div className="mt-3 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={filter === f ? 'rounded-full border border-sky-300/25 bg-sky-400/12 px-4 py-2 text-sm font-medium text-sky-100' : 'rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-sm font-medium text-slate-400'}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center" aria-live="polite" role="status"><h2 className="text-xl font-semibold text-white">Loading sources…</h2><p className="mt-2 text-slate-400">Reading the configured source catalog.</p></div>
      ) : loadError ? (
        <div className="rounded-[24px] border border-red-300/20 bg-red-950/20 p-10 text-center" role="alert">
          <h2 className="text-xl font-semibold text-white">Source catalog unavailable</h2>
          <p className="mt-2 text-red-200">{loadError}</p>
          <button className="btn-dark-secondary mt-5" onClick={refresh} type="button"><Icon name="refresh" size={15} /> Try again</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">{sites.length ? 'No sources match this filter' : 'No sources configured yet'}</h2>
          <p className="mt-2 text-slate-400">{sites.length ? 'Clear the search or select All to restore the catalog.' : 'Add the first source to include it in a future scan.'}</p>
          {sites.length ? (
            <button className="btn-dark-secondary mt-5" onClick={() => { setQuery(''); setFilter('All'); }} type="button">Clear filters</button>
          ) : (
            <button className="btn-dark-primary mt-5" onClick={() => setAddOpen(true)} type="button"><Icon name="plus" size={15} /> Add first source</button>
          )}
        </div>
      ) : (
        <section className="source-groups space-y-8">
          {Object.entries(grouped).map(([category, group]) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-white">{category} Sources</h2>
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-sm text-slate-500">{group.length} sources</span>
              </div>
              <div className="source-card-grid">
                {group.map((source, i) => {
                  const name = sourceName(source);
                  const url = sourceUrl(source);
                  const health = healthFor(source);
                  return (
                    <article key={`${name}-${i}`} className="source-control-card rounded-[22px] border border-white/10 bg-[#101827]/75 p-5 shadow-cockpit">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className={health === 'Healthy' ? 'text-sm font-semibold text-emerald-300' : health === 'Failed' ? 'text-sm font-semibold text-red-300' : health === 'Warning' ? 'text-sm font-semibold text-amber-300' : 'source-configured text-sm font-semibold text-sky-200'}>
                            ● {health}
                          </div>
                          <h3 className="mt-2 text-lg font-semibold text-white">{name}</h3>
                          <p className="mt-1 line-clamp-1 text-sm text-slate-500">{url || 'No URL configured'}</p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm text-slate-400">
                        Category: {sourceCategory(source)}
                        <br />
                        Health: {health} · Last Checked: {source.last_checked || source.checked_at || 'Not reported'}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {url && (
                          <a className="btn-dark-secondary h-9" href={url} target="_blank" rel="noreferrer">
                            <Icon name="external" size={14} /> Open Site
                          </a>
                        )}
                        <button className="btn-dark-secondary h-9" disabled={!url} onClick={async () => {
                          try {
                            if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
                            await navigator.clipboard.writeText(url);
                            setNotice(`Copied ${name} URL.`);
                          } catch {
                            setFormError('Could not copy this URL. Select and copy it from the address shown on the card.');
                          }
                        }} type="button">
                          Copy URL
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
      {!loading && visible.length > displayed.length && (
        <div className="source-load-more">
          <span>Showing {displayed.length} of {visible.length} matching sources</span>
          <button className="btn-dark-secondary" onClick={() => setDisplayLimit((value) => value + 36)} type="button">
            Load 36 more
          </button>
        </div>
      )}
    </div>
  );
}
