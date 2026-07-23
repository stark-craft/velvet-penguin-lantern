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
  if (!url) return 'Failed';
  if (String(url).startsWith('http')) return 'Healthy';
  return 'Warning';
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
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [addOpen, setAddOpen] = useState(false);

  const refresh = () => {
    setLoad(true);
    getSites()
      .then((s) => setSites(Array.isArray(s) ? s : (s?.sites || [])))
      .catch(() => {})
      .finally(() => setLoad(false));
  };

  useEffect(refresh, []);

  const submit = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setErr('Name and URL required');
      return;
    }
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      await addSite({
        name: form.name.trim(),
        url: form.url.trim(),
        category: form.category.trim() || 'General Tech',
        profile: form.profile,
      });
      trackAction('add_source', form.name);
      setForm({ name: '', url: '', category: '', profile: 'Default' });
      setNotice('Source added successfully. It will be included in future scans.');
      refresh();
    } catch (e) {
      setErr(e.message || String(e));
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

  const grouped = useMemo(() => groupByCategory(visible), [visible]);
  const healthy = sites.filter((s) => healthFor(s) === 'Healthy').length;
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
          <button className="btn-dark-secondary" onClick={refresh} type="button"><Icon name="refresh" /> Refresh</button>
        </div>
      </section>

      <section className="source-control-metrics metric-grid grid gap-4 md:grid-cols-4">
        <div className="signal-stat"><span>Total Sources</span><strong>{sites.length}</strong></div>
        <div className="signal-stat"><span>Active</span><strong>{healthy}</strong></div>
        <div className="signal-stat"><span>Warnings</span><strong>{warnings}</strong></div>
        <div className="signal-stat"><span>Failed</span><strong>{failed}</strong></div>
      </section>

      <section className="source-add-panel rounded-[24px] border border-white/10 bg-[#101827]/80 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <Icon name="plus" /> Add Intelligence Source
          </div>
          <button className="btn-dark-secondary h-9" onClick={() => setAddOpen((value) => !value)} type="button">
            {addOpen ? 'Collapse' : 'Add Source'}
          </button>
        </div>
        {addOpen && (
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr_160px_auto] lg:items-end">
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source name</span>
              <input className="dark-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Samsung Newsroom" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">RSS URL</span>
              <input className="dark-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." />
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Category</span>
              <input className="dark-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Display Tech" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile</span>
              <select className="dark-input" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                <option>Default</option>
                <option>Broadcast</option>
              </select>
            </label>
            <button className="btn-dark-primary h-11 justify-center" onClick={submit} disabled={busy} type="button">
              {busy ? 'Adding...' : 'Add Source'}
            </button>
          </div>
        )}
        {err && <div className="mt-3 text-sm text-red-300">{err}</div>}
        {notice && <div className="mt-3 text-sm text-emerald-300">{notice}</div>}
      </section>

      <section className="source-filter-panel rounded-[22px] border border-white/10 bg-white/[0.035] p-4">
        <input className="dark-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources..." />
        <div className="mt-3 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f}
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
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center"><h2 className="text-xl font-semibold text-white">Loading sources</h2></div>
      ) : visible.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-[#101827]/80 p-10 text-center">
          <h2 className="text-xl font-semibold text-white">No sources match this filter</h2>
          <p className="mt-2 text-slate-400">Try clearing search or selecting All.</p>
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
                          <div className={health === 'Healthy' ? 'text-sm font-semibold text-emerald-300' : health === 'Failed' ? 'text-sm font-semibold text-red-300' : 'text-sm font-semibold text-amber-300'}>
                            ● {health}
                          </div>
                          <h3 className="mt-2 text-lg font-semibold text-white">{name}</h3>
                          <p className="mt-1 line-clamp-1 text-sm text-slate-500">{url || 'No URL configured'}</p>
                        </div>
                        <span className="signal-chip">{source.profile || form.profile || 'Default'}</span>
                      </div>
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm text-slate-400">
                        Category: {sourceCategory(source)} · Profile: {source.profile || 'Default'}
                        <br />
                        RSS Health: {health === 'Healthy' ? 'OK' : health === 'Failed' ? 'Failed / missing URL' : 'Warning'} · Last Checked: Current session
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {url && (
                          <a className="btn-dark-secondary h-9" href={url} target="_blank" rel="noreferrer">
                            <Icon name="external" size={14} /> Open Site
                          </a>
                        )}
                        <button className="btn-dark-secondary h-9" onClick={() => navigator.clipboard?.writeText(url)} type="button">
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
    </div>
  );
}
