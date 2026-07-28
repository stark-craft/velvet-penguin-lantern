import React, { useEffect, useMemo, useState } from 'react';
import ArticleCard from '../components/ArticleCard.jsx';
import Icon from '../components/Icon.jsx';
import ArticleModal from '../components/modals/ArticleModal.jsx';
import DraftExportModal from '../components/modals/DraftExportModal.jsx';
import {
  createViewerBriefings,
  getViewerBriefings,
  getViewerSaved,
  removeSavedArticle,
  retryViewerBriefing,
  saveArticleForLater,
  selectWorkflow,
} from '../api.js';
import { normalizeArticle, normalizeList } from '../utils/normalize.js';
import { articleKey } from '../utils/intelligence.js';
import { trackAction } from '../utils/tracking.js';
import '../styles/personal-desk.css';

const terminalStatuses = new Set(['complete', 'failed']);

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

function BriefingJob({ job, index, onOpen, onRetry }) {
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
          <button className="btn-dark-secondary" onClick={() => onRetry(job.id)} type="button">
            <Icon name="refresh" size={14} /> Retry
          </button>
        </>
      )}
    </article>
  );
}

export default function SavedScreen() {
  const [tab, setTab] = useState('briefings');
  const [savedItems, setSavedItems] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [openArticle, setOpenArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [urlText, setUrlText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  const briefingItems = useMemo(
    () => jobs
      .filter((job) => job.status === 'complete' && job.article)
      .map((job, index) => normalizeArticle(job.article, index))
      .filter(Boolean),
    [jobs],
  );
  const savedKeys = useMemo(
    () => new Set(savedItems.map(articleKey)),
    [savedItems],
  );
  const activeJobs = jobs.some((job) => !terminalStatuses.has(job.status));
  const exportItems = briefingItems.filter((item) => selectedKeys.has(articleKey(item)));

  const loadAll = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [savedResponse, briefingResponse] = await Promise.all([
        getViewerSaved(),
        getViewerBriefings(),
      ]);
      setSavedItems(normalizeList(savedResponse?.items || []));
      setJobs(Array.isArray(briefingResponse?.jobs) ? briefingResponse.jobs : []);
      setError('');
    } catch (requestError) {
      setError(requestError?.message || 'Could not load your personal desk.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    if (!activeJobs) return undefined;
    const timer = window.setInterval(() => loadAll({ quiet: true }), 1800);
    return () => window.clearInterval(timer);
  }, [activeJobs]);

  const submitUrls = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const response = await createViewerBriefings(urlText);
      const accepted = response?.accepted?.length || 0;
      const duplicates = response?.duplicates || [];
      const invalid = response?.invalid || [];
      setUrlText('');
      await loadAll({ quiet: true });
      setNotice([
        accepted ? `${accepted} private briefing${accepted === 1 ? '' : 's'} started.` : '',
        duplicates.length ? `${duplicates.length} already existed—nothing was processed twice.` : '',
        invalid.length ? `${invalid.length} invalid or unsafe URL${invalid.length === 1 ? '' : 's'} skipped.` : '',
      ].filter(Boolean).join(' '));
      if (duplicates[0]?.job_id) {
        window.setTimeout(() => {
          document.getElementById(`personal-job-${duplicates[0].job_id}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);
      }
    } catch (requestError) {
      setError(requestError?.message || 'Could not start your private briefing.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (item) => {
    await removeSavedArticle(item);
    setSavedItems((current) => current.filter((entry) => articleKey(entry) !== articleKey(item)));
  };
  const toggleSave = async (item) => {
    if (savedKeys.has(articleKey(item))) {
      await remove(item);
      setNotice('Removed from Saved Signals.');
    } else {
      await saveArticleForLater(item);
      setSavedItems((current) => [item, ...current]);
      setNotice('Saved privately to your desk.');
    }
  };
  const selectForReview = async (item) => {
    await selectWorkflow(item);
    trackAction('select', `personal_briefing:${item.title}`);
    setOpenArticle((current) => current ? { ...current, selected_by: 'you' } : current);
    setNotice('Selected for the shared Review Queue.');
  };
  const retry = async (jobId) => {
    await retryViewerBriefing(jobId);
    await loadAll({ quiet: true });
  };
  const openBriefing = (item) => {
    trackAction('personal_briefing_open', item?.title || item?.url || 'private briefing');
    setOpenArticle(item);
  };
  const openExport = () => {
    trackAction('personal_briefing_export', `${exportItems.length} private briefing item(s)`);
    setExportOpen(true);
  };

  return (
    <div className="page-stack personal-desk">
      <section className="page-hero personal-desk-hero">
        <div>
          <div className="eyebrow">Private intelligence workspace</div>
          <h1>Your desk, shaped by you.</h1>
          <p>Save signals from the shared feed or turn article links into a private, AI-structured briefing.</p>
        </div>
        <div className="personal-desk-tabs" role="tablist" aria-label="Personal desk sections">
          <button className={tab === 'briefings' ? 'active' : ''} onClick={() => setTab('briefings')} type="button">
            <Icon name="sparkle" size={15} /> My Briefing <span>{briefingItems.length}</span>
          </button>
          <button className={tab === 'saved' ? 'active' : ''} onClick={() => setTab('saved')} type="button">
            <Icon name="bookmark" size={15} /> Saved Signals <span>{savedItems.length}</span>
          </button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="personal-notice">{notice}</div>}

      {tab === 'briefings' ? (
        <>
          <section className="personal-url-studio">
            <div className="personal-url-copy">
              <span className="eyebrow">Bring your own intelligence</span>
              <h2>Drop the links. We’ll shape the briefing.</h2>
              <p>Paste up to 20 news article URLs, separated by spaces, commas, or new lines. These remain private until you select one for review.</p>
            </div>
            <form onSubmit={submitUrls}>
              <textarea
                aria-label="News article URLs"
                onChange={(event) => setUrlText(event.target.value)}
                placeholder={'https://example.com/article-one\nhttps://example.com/article-two'}
                value={urlText}
              />
              <div className="personal-url-actions">
                <span><Icon name="shield" size={14} /> Private to your identity</span>
                <button className="btn-dark-primary" disabled={submitting || !urlText.trim()} type="submit">
                  <Icon name="sparkle" size={15} /> {submitting ? 'Checking links…' : 'Create my briefing'}
                </button>
              </div>
            </form>
          </section>

          {!!jobs.length && (
            <section>
              <div className="personal-section-head">
                <div><span className="eyebrow">Live preparation</span><h2>Link studio</h2></div>
                <button className="btn-dark-secondary" onClick={() => loadAll()} type="button"><Icon name="refresh" size={14} /> Refresh</button>
              </div>
              <div className="personal-job-grid">
                {jobs.map((job, index) => (
                  <BriefingJob key={job.id} job={job} index={index} onOpen={openBriefing} onRetry={retry} />
                ))}
              </div>
            </section>
          )}

          {!!briefingItems.length && (
            <section>
              <div className="personal-section-head">
                <div><span className="eyebrow">Prepared for you</span><h2>Private briefing cards</h2></div>
                <button className="btn-dark-secondary" disabled={!exportItems.length} onClick={openExport} type="button">
                  <Icon name="download" size={14} /> Export checked ({exportItems.length})
                </button>
              </div>
              <div className="home-article-grid grid gap-8">
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
      ) : loading ? (
        <div className="workflow-empty"><Icon name="refresh" size={24} /><h2>Loading Saved Signals</h2></div>
      ) : savedItems.length === 0 ? (
        <div className="workflow-empty"><Icon name="bookmark" size={26} /><h2>Nothing saved yet</h2><p>Use Save on a shared or private briefing card.</p></div>
      ) : (
        <div className="home-article-grid grid gap-8">
          {savedItems.map((item) => (
            <div key={articleKey(item)} className="flex min-h-0 flex-col gap-2">
              <ArticleCard item={item} onOpen={setOpenArticle} />
              <button className="btn-dark-secondary w-full justify-center" onClick={() => remove(item)} type="button">
                <Icon name="trash" size={14} /> Remove from Saved Signals
              </button>
            </div>
          ))}
        </div>
      )}

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
