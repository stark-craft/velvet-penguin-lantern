import React, { useEffect, useMemo, useState } from 'react';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';
import {
  getJiraNewsJob,
  regenerateJiraInsight,
  publishJiraNewsDrafts,
  startJiraNewsDrafts,
} from '../../news-scrapper/api.js';
import { sanitizeExternalUrl } from './safeLink.js';
import './jira-report.css';

const activeStates = new Set(['queued', 'running', 'paused']);
const dateLabel = (value) => {
  const raw = String(value || '').slice(0, 10).replaceAll('-', '.');
  return raw;
};

export default function CreateJiraAction({
  items = [],
  disabled = false,
  buttonClassName = 'btn-dark-secondary h-9',
}) {
  const signature = useMemo(() => items.map(articleKey).join('|'), [items]);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState('idle');
  const [draftJobId, setDraftJobId] = useState('');
  const [publishJobId, setPublishJobId] = useState('');
  const [insightJobId, setInsightJobId] = useState('');
  const [job, setJob] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setStage('idle');
    setOpen(false);
    setDraftJobId('');
    setPublishJobId('');
    setInsightJobId('');
    setDrafts([]);
    setSelected(new Set());
    setResults([]);
    setJob(null);
    setError('');
  }, [signature]);

  useEffect(() => {
    if (!open) return undefined;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [open]);

  const jobId = stage === 'publishing' ? publishJobId : stage === 'generating' ? draftJobId : stage === 'regenerating' ? insightJobId : '';
  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let pending = false;
    const poll = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        const current = await getJiraNewsJob(jobId);
        if (cancelled) return;
        setJob(current);
        if (current.state === 'done' && current.kind === 'draft') {
          const ready = (current.entries || [])
            .filter(entry => entry.status === 'ready')
            .map(entry => ({ index: entry.index, ...entry.draft }));
          setDrafts(ready);
          setSelected(new Set(ready.map(item => item.index)));
          setStage('preview');
          if (!ready.length) setError('No reports could be generated. Review the errors and regenerate.');
        }
        if (current.state === 'done' && current.kind === 'insight') {
          const changed = current.entries?.[0];
          if (changed?.status === 'ready') {
            setDrafts(previous => previous.map(d =>
              d.index === changed.index ? { ...d, insight: changed.insight } : d
            ));
          } else {
            setError(changed?.error || 'Could not regenerate Our Insights.');
          }
          setStage('preview');
        }
        if (current.state === 'done' && current.kind === 'publish') {
          setResults(current.entries || []);
          setStage('results');
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Unable to retrieve the Jira job.');
      } finally {
        pending = false;
      }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [jobId]);

  const start = async () => {
    if (disabled || !items.length || stage === 'generating' || stage === 'publishing') return;
    setOpen(true);
    setError('');
    if (items.length > 30) {
      setError('Choose at most 30 articles per batch.');
      return;
    }
    setStage('generating');
    setDrafts([]);
    setResults([]);
    setJob(null);
    setPublishJobId('');
    setDraftJobId('');
    try {
      const response = await startJiraNewsDrafts(items);
      setDraftJobId(response.job_id);
    } catch (err) {
      setError(err?.message || 'Could not start Tech Sensing generation.');
      setStage('idle');
    }
  };

  const edit = (index, field, value, factIndex) => {
    setDrafts(current => current.map(draft => {
      if (draft.index !== index) return draft;
      if (field === 'key_facts') {
        const facts = draft.key_facts.slice();
        facts[factIndex] = value;
        return { ...draft, key_facts: facts };
      }
      return { ...draft, [field]: value };
    }));
  };

  const regenerateInsight = async (index) => {
    if (stage !== 'preview') return;
    setStage('regenerating');
    setJob(null);
    setError('');
    setInsightJobId('');
    try {
      const result = await regenerateJiraInsight(draftJobId, index);
      setInsightJobId(result.job_id);
    } catch (err) {
      setError(err?.message || 'Could not start insight regeneration.');
      setStage('preview');
    }
  };

  const publish = async () => {
    if (stage !== 'preview' || !selected.size) return;
    const toPublish = drafts.filter(item => selected.has(item.index));
    if (toPublish.some(item =>
      item.key_facts.length !== 3 ||
      item.key_facts.some(point => point.trim().length < 12) ||
      item.insight.trim().length < 35 ||
      !item.title.trim() || !item.category.trim()
    )) {
      setError('Each selected report needs a title, category, exactly 3 facts, and Our Insights.');
      return;
    }
    setError('');
    setStage('publishing');
    setJob(null);
    try {
      const response = await publishJiraNewsDrafts(draftJobId, toPublish);
      setPublishJobId(response.job_id);
    } catch (err) {
      setError(err?.message || 'Jira publication could not start.');
      setStage('preview');
    }
  };

  const pausedSeconds = job?.retry_at
    ? Math.max(0, Math.ceil(job.retry_at - now / 1000))
    : 0;
  const working = stage === 'generating' || stage === 'publishing' || stage === 'regenerating';
  const failedDrafts = stage === 'preview'
    ? (job?.entries || []).filter(entry => entry.status === 'failed')
    : [];

  return (
    <>
      <button
        className={buttonClassName}
        aria-busy={working}
        disabled={disabled || !items.length || working}
        onClick={stage === 'idle' ? start : () => setOpen(true)}
        type="button"
      >
        {working ? 'Preparing Jira…' : stage === 'idle' ? 'Create Jira' : 'View Jira reports'}
      </button>

      {open && (
        <div className="tsjira-overlay" role="presentation">
          <section className="tsjira-dialog" role="dialog" aria-modal="true" aria-label="Tech Sensing Jira reports">
            <header className="tsjira-header">
              <div>
                <strong>Tech Sensing · Jira reports</strong>
                <p>One Jira issue per article. Review facts and insights before publishing.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close Jira reports">×</button>
            </header>

            {working && (
              <div className="tsjira-progress" role="status">
                <strong>{stage === 'generating' ? 'Generating AI reports' : stage === 'regenerating' ? 'Regenerating Our Insights' : 'Creating Jira issues'}</strong>
                <span>{job?.completed || 0} / {job?.total || items.length} completed</span>
                <progress value={job?.completed || 0} max={job?.total || items.length} />
                <p>{job?.current || 'Waiting for the report queue…'}</p>
                {job?.state === 'paused' && (
                  <p className="tsjira-pause">
                    API limit reached. Resuming automatically in {pausedSeconds}s.
                    Samsung Chat and Web Search each run at a maximum of 3 calls/minute.
                  </p>
                )}
                <small>You can close this panel. Generation continues while the backend remains running.</small>
              </div>
            )}

            {error && <p className="tsjira-error" role="alert">{error}</p>}

            {stage === 'preview' && (
              <div className="tsjira-content">
                {failedDrafts.map(entry => (
                  <p className="tsjira-error" key={'failed-' + entry.index}>
                    Article {entry.index + 1}: {entry.error}
                  </p>
                ))}
                {drafts.map(draft => (
                  <article className="tsjira-draft" key={draft.index}>
                    <label className="tsjira-select">
                      <input
                        type="checkbox"
                        checked={selected.has(draft.index)}
                        onChange={event => setSelected(previous => {
                          const updated = new Set(previous);
                          if (event.target.checked) updated.add(draft.index);
                          else updated.delete(draft.index);
                          return updated;
                        })}
                      />
                      Publish article {draft.index + 1}
                    </label>
                    <label>Jira headline
                      <input value={draft.title} maxLength={500} onChange={event => edit(draft.index, 'title', event.target.value)} />
                    </label>
                    <label>Category (separate tags with /)
                      <input value={draft.category} maxLength={300} onChange={event => edit(draft.index, 'category', event.target.value)} />
                    </label>
                    <strong>Key facts · exactly 3</strong>
                    {draft.key_facts.map((fact, i) => (
                      <label key={i}>Fact {i + 1}
                        <textarea value={fact} maxLength={1200} rows={2} onChange={event => edit(draft.index, 'key_facts', event.target.value, i)} />
                      </label>
                    ))}
                    <strong>Source</strong>
                    {draft.verification === 'summary_only' && (
                      <p className="tsjira-hint">Independent web verification was unavailable; review the three facts against the linked sources.</p>
                    )}
                    <div className="tsjira-sources">
                      {draft.sources?.length
                        ? draft.sources.map((source, i) => (
                          <a href={sanitizeExternalUrl(source.url) || undefined} key={i} target="_blank" rel="noopener noreferrer">
                            {source.name || 'Source'} {dateLabel(source.date) ? '(' + dateLabel(source.date) + ')' : ''}
                          </a>
                        ))
                        : <span>No linked sources in this article</span>}
                    </div>
                    <label>Our Insights
                      <textarea rows={4} value={draft.insight} maxLength={2400} onChange={event => edit(draft.index, 'insight', event.target.value)} />
                    </label>
                    <button type="button" className="tsjira-regen" onClick={() => regenerateInsight(draft.index)}>
                      Regenerate Our Insights only
                    </button>
                    <label>Image caption
                      <input value={draft.image_caption || ''} maxLength={350} onChange={event => edit(draft.index, 'image_caption', event.target.value)} />
                    </label>
                    {sanitizeExternalUrl(draft.image_url) && (
                      <img className="tsjira-image" src={sanitizeExternalUrl(draft.image_url)} alt={draft.image_caption || draft.title} />
                    )}
                  </article>
                ))}
                <footer className="tsjira-actions">
                  <button type="button" onClick={start}>Regenerate drafts</button>
                  <button type="button" className="tsjira-primary" disabled={!selected.size} onClick={publish}>
                    Create {selected.size} Jira {selected.size === 1 ? 'issue' : 'issues'}
                  </button>
                </footer>
              </div>
            )}

            {stage === 'results' && (
              <div className="tsjira-content">
                <h3>Jira publication results</h3>
                {results.map((result) => (
                  <div className="tsjira-result" key={result.index}>
                    <strong>Article {result.index + 1}: {result.status}</strong>
                    {sanitizeExternalUrl(result.url) && (
                      <a href={sanitizeExternalUrl(result.url)} target="_blank" rel="noopener noreferrer">
                        Open {result.key}
                      </a>
                    )}
                    {result.error && <p role="alert">{result.error}</p>}
                    {result.warnings?.length > 0 && <p>{result.warnings.join('; ')}</p>}
                  </div>
                ))}
                <p className="tsjira-hint">Failed or uncertain Jira writes are not retried automatically. Check Jira for an existing issue first.</p>
              </div>
            )}

            {stage === 'idle' && !error && (
              <div className="tsjira-content"><p>Select articles to create an independent Jira draft for each.</p></div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
