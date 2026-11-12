import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { createViewerBriefings, getViewerBriefings, retryViewerBriefing } from '../../news-scrapper/api.js';
import { normalizeArticle } from '../../news-scrapper/utils/normalize.js';
import useAutoDismiss from '../shared/useAutoDismiss.js';
import { countEnteredUrls, URL_LIMIT } from './createNewsModel.js';

const TERMINAL = new Set(['complete', 'failed']);

function jobLabel(job) {
  const labels = {
    queued: 'Queued',
    extracting: 'Opening article',
    web_search: 'Reading article',
    local_extraction: 'Extracting story',
    summarizing: 'Creating news card',
    complete: 'Ready',
    failed: 'Needs attention',
  };
  return labels[job.stage] || labels[job.status] || 'Preparing';
}

function sourceHost(value = '') {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
}

export default function UrlStoryImporter({ onBack, onUseArticle }) {
  const [urlText, setUrlText] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.sessionStorage.getItem('sampark-create-url-draft') || '';
  });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(new Set());
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const mounted = useRef(true);
  const urlCount = useMemo(() => countEnteredUrls(urlText), [urlText]);
  const activeJobs = jobs.some((job) => !TERMINAL.has(job.status));
  const readyJobs = jobs.filter((job) => job.status === 'complete' && job.article);

  useAutoDismiss(notice || problem, () => { setNotice(''); setProblem(''); });

  const loadJobs = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await getViewerBriefings();
      if (mounted.current) {
        setJobs(Array.isArray(response?.jobs) ? response.jobs : []);
        setProblem('');
      }
    } catch (error) {
      if (mounted.current) setProblem(error?.message || 'Could not load URL stories.');
    } finally {
      if (mounted.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadJobs();
    return () => { mounted.current = false; };
  }, [loadJobs]);
  useEffect(() => {
    if (!activeJobs) return undefined;
    const timer = window.setInterval(() => loadJobs({ quiet: true }), 1800);
    return () => window.clearInterval(timer);
  }, [activeJobs, loadJobs]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem('sampark-create-url-draft', urlText);
  }, [urlText]);

  const submit = async (event) => {
    event.preventDefault();
    if (!urlCount) { setProblem('Paste at least one complete http:// or https:// article URL.'); return; }
    if (urlCount > URL_LIMIT) { setProblem(`Add no more than ${URL_LIMIT} article URLs at one time.`); return; }
    setSubmitting(true); setProblem(''); setNotice('');
    try {
      const response = await createViewerBriefings(urlText);
      const accepted = response?.accepted?.length || 0;
      const duplicates = response?.duplicates?.length || 0;
      const invalid = response?.invalid?.length || 0;
      const failed = response?.dispatch_failures?.length || 0;
      if (!invalid) setUrlText('');
      setNotice([
        accepted - failed > 0 ? `${accepted - failed} ${accepted - failed === 1 ? 'story is' : 'stories are'} being prepared.` : '',
        duplicates ? `${duplicates} duplicate ${duplicates === 1 ? 'link was' : 'links were'} skipped.` : '',
        invalid ? `${invalid} invalid or unsafe ${invalid === 1 ? 'URL was' : 'URLs were'} skipped.` : '',
      ].filter(Boolean).join(' '));
      if (failed) setProblem(`${failed} background ${failed === 1 ? 'job' : 'jobs'} could not start. Use Retry below.`);
      await loadJobs({ quiet: true });
    } catch (error) {
      setProblem(error?.message || 'Could not start URL story creation.');
    } finally { setSubmitting(false); }
  };

  const retry = async (jobId) => {
    if (retrying.has(jobId)) return;
    setRetrying((current) => new Set(current).add(jobId));
    setProblem('');
    try {
      await retryViewerBriefing(jobId);
      await loadJobs({ quiet: true });
      setNotice('Retry started. Progress will update here.');
    } catch (error) { setProblem(error?.message || 'Could not retry this URL.'); }
    finally { setRetrying((current) => { const next = new Set(current); next.delete(jobId); return next; }); }
  };

  return (
    <section className="sampark-create-url-page">
      <button className="sampark-create-text-back" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Create News</button>
      <header className="sampark-create-intro is-compact"><span className="sampark-create-eyebrow">Create from URL</span><h1>Turn article links into editable stories</h1><p>Add up to 20 news URLs. You can leave this view while the existing briefing service prepares them.</p></header>

      {(notice || problem) && <div className={`sampark-create-feedback${problem ? ' is-error' : ''}`} role={problem ? 'alert' : 'status'}><Icon name={problem ? 'warning' : 'check2'} size={16} /><span>{problem || notice}</span><button aria-label="Dismiss" onClick={() => { setNotice(''); setProblem(''); }} type="button"><Icon name="x" size={14} /></button></div>}

      <form className="sampark-create-url-form" onSubmit={submit}>
        <div className="sampark-create-url-form-head"><label htmlFor="sampark-create-urls">News article URLs</label><span className={urlCount > URL_LIMIT ? 'is-over' : ''}>{urlCount}/{URL_LIMIT} detected</span></div>
        <textarea id="sampark-create-urls" aria-invalid={urlCount > URL_LIMIT} onChange={(event) => setUrlText(event.target.value)} placeholder={'https://example.com/article-one\nhttps://example.com/article-two'} rows={6} value={urlText} />
        <footer><span><Icon name="shield" size={14} /> Private while stories are prepared</span><button className="sampark-create-primary" disabled={submitting || !urlText.trim() || urlCount > URL_LIMIT} type="submit"><Icon name="sparkle" size={15} /> {submitting ? 'Checking links…' : 'Create story cards'}</button></footer>
      </form>

      <section className="sampark-create-url-results" aria-busy={loading}>
        <header><div><span className="sampark-create-eyebrow">Generated cards</span><h2>{readyJobs.length ? `${readyJobs.length} ready to edit` : 'Your generated stories'}</h2></div><button className="sampark-create-secondary" disabled={loading} onClick={() => loadJobs()} type="button"><Icon name="refresh" size={14} /> Refresh</button></header>
        {loading && !jobs.length ? <div className="sampark-create-empty"><span className="sampark-spinner" /><strong>Loading URL stories…</strong></div> : jobs.length ? (
          <div className="sampark-create-url-grid">{jobs.map((job) => {
            const article = job.article ? normalizeArticle(job.article) : null;
            const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
            return (
              <article key={job.id} className={`sampark-create-url-card is-${job.status}`}>
                {article?.image_url ? <img alt="" loading="lazy" referrerPolicy="no-referrer" src={article.image_url} /> : <div className="sampark-create-url-card-art"><Icon name={job.status === 'failed' ? 'warning' : 'globe'} size={24} /></div>}
                <div className="sampark-create-url-card-body">
                  <div className="sampark-create-url-card-meta"><span>{jobLabel(job)}</span><small>{sourceHost(job.url)}</small></div>
                  <h3>{article?.title || sourceHost(job.url) || 'Preparing story'}</h3>
                  <p>{article?.summary || job.message || 'Waiting for the story generator.'}</p>
                  {!TERMINAL.has(job.status) && <div className="sampark-create-job-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>}
                  {job.status === 'complete' && article && <button className="sampark-create-primary" onClick={() => onUseArticle(job.article)} type="button">Edit as SRI-D news <Icon name="chevR" size={14} /></button>}
                  {job.status === 'failed' && <button className="sampark-create-secondary" disabled={retrying.has(job.id)} onClick={() => retry(job.id)} type="button"><Icon name="refresh" size={14} /> {retrying.has(job.id) ? 'Retrying…' : 'Retry'}</button>}
                </div>
              </article>
            );
          })}</div>
        ) : <div className="sampark-create-empty"><Icon name="globe" size={28} /><strong>No URL stories yet</strong><p>Add one or more article links above to begin.</p></div>}
      </section>
    </section>
  );
}
