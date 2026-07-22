import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon.jsx';
import Bouncer from '../Bouncer.jsx';
import { getInsight } from '../../api.js';
import { scoreOf, sourceList } from '../../utils/intelligence.js';
import { SignalVisual } from '../ArticleCard.jsx';

function WorkflowBlock({ item, onSelect, onApprove, onRemove, onHide, onRestore, onVote }) {
  const approved = item.approved_at || item.approved_by;
  const hidden = item.rejected_at || item.rejected_by;
  const state = approved
    ? 'Approved for Briefing'
    : item.selected_by
      ? 'In Review Queue'
      : hidden
        ? 'Hidden Signal'
        : 'Discovered Signal';

  return (
    <div className="dossier-tile dossier-workflow rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Workflow</div>
      <div className="mt-2 text-base font-semibold text-white">{state}</div>
      {item.selected_by && <div className="mt-1 text-sm text-slate-400">Selected by {item.selected_by}</div>}
      <div className="mt-4 flex flex-col gap-2">
        {!item.selected_by && !approved && !hidden && onSelect && (
          <button className="btn-dark-primary justify-center" onClick={() => onSelect(item)} type="button">
            Select for Review
          </button>
        )}
        {item.selected_by && !approved && onApprove && (
          <button className="btn-dark-primary justify-center" onClick={() => onApprove(item)} type="button">
            Approve Briefing
          </button>
        )}
        {approved && onRemove && (
          <button className="btn-dark-secondary justify-center" onClick={() => onRemove(item)} type="button">
            Remove Approval
          </button>
        )}
        {item.selected_by && !approved && onRemove && (
          <button className="btn-dark-secondary justify-center" onClick={() => onRemove(item)} type="button">
            Remove from Review
          </button>
        )}
        {hidden && onRestore && (
          <button className="btn-dark-primary justify-center" onClick={() => onRestore(item)} type="button">
            Restore Signal
          </button>
        )}
        {hidden && (
          <span className="btn-dark-secondary justify-center">
            Keep Hidden
          </span>
        )}
        {!hidden && onHide && (
          <button className="btn-dark-secondary justify-center" onClick={() => onHide(item)} type="button">
            Hide Signal
          </button>
        )}
        {!approved && !hidden && onVote && (
          <div className="dossier-feedback rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Relevance Feedback</span>
            <Bouncer onVote={(value) => onVote(item, value)} />
          </div>
        )}
      </div>
    </div>
  );
}

function RegionCorrection({ item, onCorrectRegion }) {
  const currentRegion = item.region || 'Global';
  const alternateRegion = currentRegion === 'Local' ? 'Global' : 'Local';
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(alternateRegion);
  const [keywords, setKeywords] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    setEditing(false);
    setTarget((item.region || 'Global') === 'Local' ? 'Global' : 'Local');
    setKeywords('');
    setReason('');
    setError('');
    setConfirmation('');
  }, [item.title]);

  const submit = async (event) => {
    event.preventDefault();
    const learnedKeywords = keywords.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
    if (!learnedKeywords.length) {
      setError('Add at least one keyword for future classification.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await onCorrectRegion(item, { region: target, keywords: learnedKeywords, reason });
      setConfirmation(result?.message || `Region corrected to ${target}.`);
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Could not save region correction.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dossier-tile dossier-region rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Region</div>
          <div className="mt-2 font-semibold text-white">{currentRegion}</div>
          {item.region_basis && <div className="mt-1 text-xs text-sky-200">{item.region_basis}</div>}
        </div>
        {onCorrectRegion && !editing && (
          <button className="btn-dark-secondary h-9 px-3" onClick={() => setEditing(true)} type="button">
            Correct Tag
          </button>
        )}
      </div>
      {confirmation && <div className="mt-3 rounded-xl border border-sky-300/20 bg-sky-400/[0.08] p-3 text-xs text-sky-100">{confirmation}</div>}
      {editing && (
        <form className="mt-4 space-y-3 border-t border-white/10 pt-4" onSubmit={submit}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Change classification to</div>
          <div className="grid grid-cols-2 gap-2">
            {['Local', 'Global'].map((region) => (
              <button
                className={target === region ? 'btn-dark-primary justify-center' : 'btn-dark-secondary justify-center'}
                key={region}
                onClick={() => setTarget(region)}
                type="button"
              >
                {region}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Learning keywords</span>
            <input
              className="dark-input w-full rounded-xl border px-3 py-2.5 text-sm"
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="India, Bengaluru, domestic launch"
              value={keywords}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Why this tag fits</span>
            <textarea
              className="dark-textarea !min-h-[76px] text-sm"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional context for this correction."
              value={reason}
            />
          </label>
          <p className="text-xs leading-5 text-slate-400">Keywords are learned for future scans and can classify similar stories as {target}.</p>
          {error && <div className="text-xs text-red-200">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-dark-secondary flex-1 justify-center" onClick={() => setEditing(false)} type="button">Cancel</button>
            <button className="btn-dark-primary flex-1 justify-center" disabled={busy} type="submit">
              {busy ? 'Saving...' : 'Save Correction'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ArticleModal({
  item,
  onClose,
  onSelect,
  onApprove,
  onRemove,
  onHide,
  onRestore,
  onVote,
  onCorrectRegion,
}) {
  const [expanded, setExpanded] = useState(false);
  const [whyMatters, setWhyMatters] = useState('');
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!item) {
      setWhyMatters('');
      setInsightLoading(false);
      return undefined;
    }

    if (item.why_matters) {
      setWhyMatters(item.why_matters);
      setInsightLoading(false);
      return undefined;
    }

    setWhyMatters('');
    setInsightLoading(true);
    getInsight({
      title: item.title,
      master_summary: item.summary,
      summary: item.summary,
      category: item.category,
      source_count: item.source_count,
    })
      .then((response) => {
        if (!cancelled) setWhyMatters(response?.why_matters || '');
      })
      .catch(() => {
        if (!cancelled) setWhyMatters('');
      })
      .finally(() => {
        if (!cancelled) setInsightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.title, item?.summary, item?.why_matters]);

  useEffect(() => {
    if (!item) return undefined;

    document.body.classList.add('dossier-open');

    return () => {
      document.body.classList.remove('dossier-open');
    };
  }, [item]);

  if (!item) return null;

  const score = scoreOf(item);
  const sources = sourceList(item);
  const visibleSources = expanded ? sources : sources.slice(0, 5);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dossier" onClick={(e) => e.stopPropagation()}>
        <div className="head dossier-head">
          <div>
            <h3>Intelligence Dossier</h3>
            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {score >= 80 ? 'High Signal' : 'Signal'} · {item.source_count || sources.length || 1} sources · {item.date || 'Latest'}
            </div>
          </div>
          <span className="x" onClick={onClose}><Icon name="x" /></span>
        </div>

        <div className="dossier-layout grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="dossier-reading overflow-y-auto p-5 sm:p-6">
            <SignalVisual item={item} className="dossier-hero h-72 rounded-[24px]" />
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="signal-chip">{item.category || 'News'}</span>
              <span className="signal-chip">{item.region || 'Global'}</span>
              <span className="signal-chip">Score {score}</span>
              <span className="signal-chip">{item.source_count || sources.length || 1} sources</span>
            </div>
            <h2 className="dossier-title mt-5 text-3xl font-semibold leading-tight text-white sm:text-4xl">{item.title}</h2>
            <div className="mt-3 text-sm text-slate-500">
              {[item.date, item.time, item.src].filter(Boolean).join(' · ')}
            </div>

            <section className="dossier-section mt-8">
              <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">AI Summary</h4>
              <p className="mt-3 text-base leading-8 text-slate-300">{item.summary || 'No summary available.'}</p>
            </section>

            <section className="dossier-section mt-8">
              <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Why This Matters</h4>
              <p className="mt-3 text-base leading-8 text-slate-300">
                {insightLoading
                  ? 'Generating strategic implication...'
                  : whyMatters || `This signal is ranked at ${score}/100 from ${item.source_count || sources.length || 1} source${(item.source_count || sources.length || 1) === 1 ? '' : 's'}, with category and regional context for briefing review.`}
              </p>
            </section>

            <section className="dossier-section dossier-sources mt-8">
              <div className="flex items-center justify-between gap-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Source Coverage</h4>
                <span className="text-sm text-slate-500">Clustered from {item.source_count || sources.length || 1} sources</span>
              </div>
              <div className="mt-4 space-y-3">
                {visibleSources.length ? visibleSources.map((source, idx) => {
                  const name = source.name || source.source || item.src || `Source ${idx + 1}`;
                  const url = source.url || source.link || item.url;
                  return (
                    <div key={`${name}-${idx}`} className="source-coverage-card rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <div className="font-semibold text-slate-100">{name}</div>
                      <div className="mt-1 text-sm text-slate-400">{source.title || item.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{source.published || source.date || item.date}</div>
                      {url && (
                        <a className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-sky-200 hover:text-white" href={url} target="_blank" rel="noreferrer">
                          Open original article <Icon name="external" size={13} />
                        </a>
                      )}
                    </div>
                  );
                }) : (
                  <div className="source-coverage-card rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-400">No source metadata available.</div>
                )}
              </div>
              {sources.length > 5 && (
                <button className="mt-4 btn-dark-secondary" onClick={() => setExpanded((v) => !v)} type="button">
                  {expanded ? 'Show first 5 sources' : `View all ${sources.length} sources`}
                </button>
              )}
            </section>
          </div>

          <aside className="dossier-rail overflow-y-auto border-t border-white/10 bg-[#0b1220]/80 p-5 lg:border-l lg:border-t-0">
            <div className="sticky top-4 space-y-4">
              <div className="dossier-strength rounded-2xl border border-sky-300/15 bg-sky-400/[0.06] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Signal Strength</div>
                <div className="mt-3 text-4xl font-semibold text-white">{score}<span className="text-lg text-slate-500"> / 100</span></div>
                <div className="mt-1 text-sm text-slate-400">{score >= 80 ? 'High Signal' : score >= 58 ? 'Normal Intelligence' : 'Compact Signal'}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="signal-stat"><span>Coverage</span><strong>{item.source_count || sources.length || 1}</strong></div>
                <div className="signal-stat"><span>Region</span><strong>{item.region || 'Global'}</strong></div>
              </div>
              <RegionCorrection item={item} onCorrectRegion={onCorrectRegion} />
              <div className="dossier-tile rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Category</div>
                <div className="mt-2 font-semibold text-white">{item.category || 'News'}</div>
              </div>
              <div className="dossier-tile rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Keywords</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(item.keywords || []).length
                    ? item.keywords.slice(0, 8).map((k) => <span className="signal-chip" key={k}>{k}</span>)
                    : <span className="text-sm text-slate-500">No keywords</span>}
                </div>
              </div>
              <WorkflowBlock
                item={item}
                onSelect={onSelect}
                onApprove={onApprove}
                onRemove={onRemove}
                onHide={onHide}
                onRestore={onRestore}
                onVote={onVote}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}
