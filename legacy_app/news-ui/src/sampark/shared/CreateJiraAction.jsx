import React, { useEffect, useMemo, useState } from 'react';
import { articleKey } from '../../news-scrapper/utils/intelligence.js';
import {
  createJiraNewsDrafts,
  getJiraNewsJob,
  publishJiraNewsDrafts,
  regenerateJiraNewsInsight,
} from '../../news-scrapper/api.js';
import { sanitizeExternalUrl } from './safeLink.js';
import './jira-report.css';

const wordCount = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).length;

function makePreview(entry) {
  return {
    index: entry.index,
    selected: entry.status === 'ready',
    error: entry.error || '',
    warning: entry.warning || '',
    ...(entry.draft || {}),
    sources: (entry.draft?.sources || []).map((source) => ({ ...source })),
    key_facts: [...(entry.draft?.key_facts || ['', '', ''])],
  };
}

export default function CreateJiraAction({
  items = [],
  disabled = false,
  buttonClassName = 'btn-dark-secondary h-9',
}) {
  const [open, setOpen] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [job, setJob] = useState(null);
  const [draftJobId, setDraftJobId] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [results, setResults] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [regenIndex, setRegenIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectionSignature = useMemo(
    () => items.map(articleKey).join('|'),
    [items],
  );

  useEffect(() => {
    // An edited selection starts a fresh, independent draft session.
    setOpen(false);
    setActiveJob(null);
    setJob(null);
    setDraftJobId('');
    setDrafts([]);
    setResults([]);
    setPhase('idle');
    setError('');
  }, [selectionSignature]);

  useEffect(() => {
    if (!activeJob?.id) return undefined;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await getJiraNewsJob(activeJob.id);
        if (cancelled) return;
        setJob(response);
        if (response.state !== 'done') return;

        if (activeJob.kind === 'draft') {
          setDrafts((response.entries || [])
            .slice()
            .sort((a, b) => a.index - b.index)
            .map(makePreview));
          setPhase('preview');
        } else if (activeJob.kind === 'insight') {
          const entry = response.entries?.[0];
          if (entry?.status === 'ready') {
            setDrafts((current) => current.map((draft) => (
              draft.index === entry.index ? { ...draft, insight: entry.insight } : draft
            )));
          } else {
            setError(entry?.error || 'Insight regeneration failed. Your other edits are preserved.');
          }
          setRegenIndex(null);
          setPhase('preview');
        } else if (activeJob.kind === 'publish') {
          setResults(response.entries || []);
          setPhase('published');
        }
        setActiveJob(null);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Unable to load Jira progress.');
        if (err?.status === 404 || err?.status === 403) {
          setActiveJob(null);
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeJob?.id, activeJob?.kind]);

  const start = async () => {
    if (busy || disabled || !items.length) return;
    if (items.length > 30) {
      setError('Select no more than 30 news articles.');
      setOpen(true);
      return;
    }

    setOpen(true);
    setBusy(true);
    setPhase('generating');
    setDrafts([]);
    setResults([]);
    setJob(null);
    setError('');

    try {
      const response = await createJiraNewsDrafts(items);
      setDraftJobId(response.job_id);
      setActiveJob({ id: response.job_id, kind: 'draft' });
    } catch (err) {
      setError(err?.message || 'Cannot start Jira draft generation.');
      setPhase('idle');
    } finally {
      setBusy(false);
    }
  };

  const update = (index, field, value) => {
    setDrafts((current) => current.map((draft) => (
      draft.index === index ? { ...draft, [field]: value } : draft
    )));
  };

  const updateFact = (index, factIndex, value) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.index !== index) return draft;
      const facts = [...draft.key_facts];
      facts[factIndex] = value;
      return { ...draft, key_facts: facts };
    }));
  };

  const updateSource = (index, sourceIndex, field, value) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.index !== index) return draft;
      const sources = draft.sources.map((source, i) => (
        i === sourceIndex ? { ...source, [field]: value } : source
      ));
      return { ...draft, sources };
    }));
  };

  const regenerate = async (draft) => {
    if (busy || activeJob || regenIndex !== null) return;
    setBusy(true);
    setRegenIndex(draft.index);
    setError('');
    try {
      const response = await regenerateJiraNewsInsight(
        draftJobId,
        draft.index,
        {
          title: draft.title,
          category: draft.category,
          key_facts: draft.key_facts,
          insight: draft.insight,
        },
      );
      setActiveJob({ id: response.job_id, kind: 'insight' });
    } catch (err) {
      setError(err?.message || 'Unable to regenerate Our Insights.');
      setRegenIndex(null);
    } finally {
      setBusy(false);
    }
  };

  const selected = drafts.filter((draft) => draft.selected && !draft.error);
  const invalid = selected.some((draft) => (
    !String(draft.title || '').trim()
    || !String(draft.category || '').trim()
    || draft.key_facts?.length !== 3
    || draft.key_facts.some((fact) => String(fact || '').trim().length < 12)
    || wordCount(draft.insight) < 60
    || wordCount(draft.insight) > 100
  ));

  const publish = async () => {
    if (busy || activeJob || !selected.length || invalid) return;
    setBusy(true);
    setError('');
    try {
      const response = await publishJiraNewsDrafts(
        draftJobId,
        selected.map(({ index, title, category, key_facts, sources, insight, image_caption }) => ({
          index,
          title,
          category,
          key_facts,
          sources,
          insight,
          image_caption,
        })),
      );
      setPhase('publishing');
      setJob(null);
      setActiveJob({ id: response.job_id, kind: 'publish' });
    } catch (err) {
      setError(err?.message || 'Unable to submit Jira issues.');
    } finally {
      setBusy(false);
    }
  };

  const isWorking = phase === 'generating' || phase === 'publishing';
  const close = () => setOpen(false);

  return (
    <>
      <button
        className={buttonClassName}
        disabled={!items.length || disabled || busy}
        onClick={() => {
          if (phase === 'idle') start();
          else setOpen(true);
        }}
        type="button"
      >
        {phase === 'published' ? 'View Jira results'
          : phase === 'preview' ? 'Review Jira drafts'
          : isWorking ? 'View Jira progress'
          : 'Create Jira'}
      </button>

      {open && (
        <div className="tsjira-overlay" role="presentation">
          <section className="tsjira-dialog" role="dialog" aria-modal="true" aria-label="Tech Sensing Jira reports">
            <header className="tsjira-header">
              <div>
                <strong>Tech Sensing · Jira reports</strong>
                <p>One Jira issue per selected article, with an editable preview.</p>
              </div>
              <button onClick={close} type="button" aria-label="Close Jira reports">×</button>
            </header>

            {error && <div role="alert" className="tsjira-error">{error}</div>}

            <main className="tsjira-content">
              {(isWorking || activeJob) && (
                <div className="tsjira-progress" role="status">
                  <strong>{job?.current || (phase === 'publishing' ? 'Creating individual Jira issues…' : 'Preparing verified article drafts…')}</strong>
                  <progress value={job?.completed || 0} max={Math.max(1, job?.total || items.length)} />
                  <p>{job?.completed || 0} of {job?.total || items.length} complete</p>
                  {job?.state === 'paused' && (
                    <small className="tsjira-pause">
                      Samsung API quota reached. Retrying automatically
                      {job.retry_at ? ' after the required wait.' : '.'}
                    </small>
                  )}
                </div>
              )}

              {phase === 'idle' && <p>Could not prepare the drafts. Close and try again.</p>}

              {phase === 'preview' && (
                <>
                  <p className="tsjira-hint">
                    Review each draft before publishing. All three key facts must be supported by its original article.
                    Our Insights must contain 60–100 words.
                  </p>
                  {drafts.map((draft) => (
                    <article className="tsjira-draft" key={draft.index}>
                      {draft.error ? (
                        <>
                          <strong>Article {draft.index + 1}: Draft unavailable</strong>
                          <p role="alert">{draft.error}</p>
                        </>
                      ) : (
                        <>
                          {draft.warning && <p className="tsjira-hint" role="status">{draft.warning}</p>}
                          <label className="tsjira-select">
                            <input
                              type="checkbox"
                              checked={draft.selected}
                              onChange={(event) => update(draft.index, 'selected', event.target.checked)}
                            />
                            Publish article {draft.index + 1} as an independent Jira issue
                          </label>
                          <label>Report headline
                            <input
                              value={draft.title || ''}
                              onChange={(event) => update(draft.index, 'title', event.target.value)}
                              maxLength={500}
                            />
                          </label>
                          <label>Category
                            <input
                              value={draft.category || ''}
                              onChange={(event) => update(draft.index, 'category', event.target.value)}
                              maxLength={300}
                            />
                          </label>
                          <strong>Key Facts · exactly three</strong>
                          {(draft.key_facts || []).map((fact, index) => (
                            <label key={index}>Fact {index + 1}
                              <textarea
                                rows={2}
                                value={fact}
                                onChange={(event) => updateFact(draft.index, index, event.target.value)}
                                maxLength={1200}
                              />
                            </label>
                          ))}
                          <strong>Original publisher sources</strong>
                          {(draft.sources || []).map((source, index) => (
                            <div className="tsjira-source" key={index}>
                              <label>Publisher
                                <input
                                  value={source.name || ''}
                                  onChange={(event) => updateSource(draft.index, index, 'name', event.target.value)}
                                />
                              </label>
                              <label>Original link
                                <input
                                  type="url"
                                  value={source.url || ''}
                                  onChange={(event) => updateSource(draft.index, index, 'url', event.target.value)}
                                />
                              </label>
                              <label>Publication date
                                <input
                                  value={source.date || ''}
                                  onChange={(event) => updateSource(draft.index, index, 'date', event.target.value)}
                                />
                              </label>
                              {sanitizeExternalUrl(source.url) && (
                                <a href={sanitizeExternalUrl(source.url)} target="_blank" rel="noopener noreferrer">
                                  Verify source
                                </a>
                              )}
                            </div>
                          ))}
                          <strong>Our Insights</strong>
                          <label>Samsung strategic implications
                            <textarea
                              rows={5}
                              value={draft.insight || ''}
                              onChange={(event) => update(draft.index, 'insight', event.target.value)}
                            />
                          </label>
                          <div className="tsjira-insight-tools">
                            <small>{wordCount(draft.insight)} / 60–100 words</small>
                            <button
                              className="tsjira-regen"
                              onClick={() => regenerate(draft)}
                              disabled={busy || Boolean(activeJob)}
                              type="button"
                            >
                              {regenIndex === draft.index ? 'Regenerating…' : 'Regenerate only Our Insights'}
                            </button>
                          </div>
                          {draft.image_url && (
                            <img className="tsjira-image" src={draft.image_url} alt={draft.image_caption || draft.title || ''} />
                          )}
                          <label>Image caption
                            <input
                              value={draft.image_caption || ''}
                              onChange={(event) => update(draft.index, 'image_caption', event.target.value)}
                              maxLength={350}
                            />
                          </label>
                        </>
                      )}
                    </article>
                  ))}
                  <div className="tsjira-actions">
                    <button onClick={close} type="button">Cancel</button>
                    <button
                      className="tsjira-primary"
                      disabled={busy || Boolean(activeJob) || invalid || !selected.length}
                      onClick={publish}
                      type="button"
                    >
                      Create {selected.length} Jira issue{selected.length === 1 ? '' : 's'}
                    </button>
                  </div>
                  {invalid && <p className="tsjira-hint" role="alert">Finish the title, category, three facts and 60–100-word insight for each selected report.</p>}
                </>
              )}

              {phase === 'published' && (
                <div>
                  <h3>Jira publication results</h3>
                  {(results || []).map((result) => (
                    <div className="tsjira-result" key={result.index}>
                      <strong>{result.title || ('Article ' + (result.index + 1))}</strong>
                      {sanitizeExternalUrl(result.url) && result.key ? (
                        <a href={sanitizeExternalUrl(result.url)} target="_blank" rel="noopener noreferrer">
                          {result.status === 'existing' ? 'Existing Jira issue: ' : 'Open Jira issue: '}
                          {result.key}
                        </a>
                      ) : <p role="alert">{result.error || 'Jira did not confirm creation.'}</p>}
                      {result.warnings?.length > 0 && <small>{result.warnings.join('; ')}</small>}
                    </div>
                  ))}
                  <div className="tsjira-actions">
                    <button className="tsjira-primary" onClick={close} type="button">Close</button>
                  </div>
                </div>
              )}
            </main>
          </section>
        </div>
      )}
    </>
  );
}
