import React from 'react';
import Icon from './Icon.jsx';
import Bouncer from './Bouncer.jsx';
import { scoreOf } from '../utils/intelligence.js';

const fallbackLabel = (category = 'General Tech') => {
  const c = String(category).toLowerCase();
  if (c.includes('broadcast')) return 'Broadcast Signal';
  if (c.includes('display') || c.includes('oled') || c.includes('tv')) return 'Display Tech';
  if (c.includes('robot')) return 'Robotics';
  if (c.includes('security')) return 'Security';
  if (c.includes('business') || c.includes('market')) return 'Business';
  if (c.includes('ai') || c.includes('model') || c.includes('agent')) return 'AI Models';
  return 'General Tech';
};

export function SignalVisual({ item, className = '', label = true }) {
  const kind = fallbackLabel(item?.category);
  const img = String(item?.image_url || '').trim();

  return (
    <div
      className={`fallback-visual pointer-events-none relative overflow-hidden ${img ? 'has-image' : ''} ${className}`}
      data-kind={kind}
    >
      {img && (
        <img
          src={img}
          alt=""
          aria-hidden="true"
          className="signal-bg-image absolute inset-0 z-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {!img && <div className="absolute inset-0 z-0 fallback-grid" />}
      {!img && <div className="absolute inset-0 z-0 fallback-glow" />}
      {label && (
        <span className="absolute bottom-3 left-3 z-20 rounded-full border border-white/15 bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
          {kind}
        </span>
      )}
    </div>
  );
}

function Meta({ item, high = false }) {
  const score = scoreOf(item);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
      {high && <span className="text-sky-200">High Signal</span>}
      <span>{item.category || 'News'}</span>
      <span className="h-1 w-1 rounded-full bg-slate-600" />
      <span>{item.region || 'Global'}</span>
      <span className="h-1 w-1 rounded-full bg-slate-600" />
      <span>{item.ago || item.date || 'Latest'}</span>
      <span className="h-1 w-1 rounded-full bg-slate-600" />
      <span>{item.source_count || 1} sources</span>
      <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-100">Score {score}</span>
    </div>
  );
}

function Actions({ item, vote, onVote, onSelect, onOpen, compact = false }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={compact ? 'btn-dark-secondary h-8 px-3' : 'btn-dark-secondary'}
        onClick={() => onOpen && onOpen(item)}
        type="button"
      >
        <Icon name="file" size={14} /> Open Dossier
      </button>
      {onSelect && (
        <button
          className={compact ? 'btn-dark-primary h-8 px-3' : 'btn-dark-primary'}
          onClick={() => onSelect(item)}
          type="button"
        >
          <Icon name="check" size={14} /> Select
        </button>
      )}
      {onVote && <Bouncer vote={vote} onVote={(v) => onVote(item, v)} />}
    </div>
  );
}

function StatusBadges({ item, selected }) {
  const approved = item?.approved_at || item?.approved_by;
  const hidden = item?.rejected_at || item?.rejected_by;
  const score = scoreOf(item);
  return (
    <div className="ml-auto flex flex-wrap justify-end gap-2">
      {item?.is_fresh && <span className="signal-chip selected">New</span>}
      {approved && <span className="signal-chip">Approved</span>}
      {selected && !approved && <span className="signal-chip">Selected</span>}
      {hidden && <span className="signal-chip selected">Hidden</span>}
      {!item?.is_fresh && !approved && !selected && !hidden && score >= 80 && <span className="signal-chip selected">High Signal</span>}
    </div>
  );
}

function OverlayArticleCard({
  item,
  vote,
  onVote,
  onSelect,
  onOpen,
  onHide,
  isSelected,
  checked,
  onCheck,
  variant,
}) {
  const score = scoreOf(item);
  const selected = isSelected || item?.selected_by;
  const approved = item?.approved_at || item?.approved_by;
  const heightClass = variant === 'compact'
    ? 'min-h-[230px]'
    : variant === 'high'
      ? 'min-h-[360px]'
      : 'min-h-[320px]';

  return (
    <article
      className={`group relative cursor-pointer overflow-hidden rounded-[24px] border border-white/10 bg-[#101827] shadow-cockpit transition hover:border-sky-300/30 ${heightClass}`}
      onClick={(event) => {
        if (!event.target.closest('button, input, a, .bouncer')) onOpen?.(item);
      }}
    >
      <SignalVisual item={item} className="visual-layer z-0" label={false} />
      <div className="absolute inset-0 z-10 bg-[linear-gradient(0deg,rgba(8,13,24,0.9)_0%,rgba(8,13,24,0.6)_42%,rgba(8,13,24,0.14)_78%,rgba(8,13,24,0.04)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 z-10 h-4/5 bg-gradient-to-t from-[#08111f]/95 via-[#08111f]/62 to-transparent" />
      <div className="relative z-20 flex min-h-[inherit] flex-col p-4">
        <div className="flex items-start gap-3">
          {onCheck && (
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onCheck(item, e.target.checked)}
              className="signal-checkbox mt-1"
              aria-label={`Select ${item.title}`}
            />
          )}
          <StatusBadges item={item} selected={selected} />
        </div>

        <div className="mt-auto rounded-2xl border border-white/10 bg-[#07111f]/58 p-3 backdrop-blur-sm">
          <button className="block w-full text-left" onClick={() => onOpen && onOpen(item)} type="button">
            <div className="mb-2 flex flex-wrap gap-2">
              <span className="source-chip">{item.category || 'News'}</span>
              <span className="source-chip">{item.region || 'Global'}</span>
              <span className="source-chip">Score {score}</span>
            </div>
            <div className="text-sm font-semibold text-slate-200">{item.source_count || 1} sources</div>
            {selected && <div className="mt-1 text-xs font-semibold text-sky-100">Selected by {item.selected_by || 'team'}</div>}
            {approved && <div className="mt-1 text-xs font-semibold text-emerald-200">Approved for Briefing</div>}
            <h3 className="mt-2 line-clamp-3 text-[clamp(1.15rem,1.2vw,1.55rem)] font-semibold leading-tight text-white">
              {item.title}
            </h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-200">{item.summary || 'No summary available.'}</p>
          </button>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {onOpen && (
              <button className="btn-dark-secondary h-9 px-3" onClick={() => onOpen(item)} type="button">
                <Icon name="file" size={14} /> Open Dossier
              </button>
            )}
            {approved ? (
              <span className="btn-dark-secondary h-9 px-3 text-emerald-200">Approved</span>
            ) : selected ? (
              <span className="btn-dark-secondary h-9 px-3 text-sky-100">Selected</span>
            ) : onSelect && (
              <button className="btn-dark-primary h-9 px-3" onClick={() => onSelect(item)} type="button">
                <Icon name="check" size={14} /> Select for Review
              </button>
            )}
            {onVote && <Bouncer vote={vote} onVote={(v) => onVote(item, v)} />}
            {(onHide || onVote) && (
              <button className="btn-dark-secondary h-9 px-3" onClick={() => (onHide ? onHide(item) : onVote(item, 'down'))} type="button">
                Hide
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ArticleCard({
  item,
  vote,
  onVote,
  onSelect,
  onOpen,
  onHide,
  variant = 'normal',
  isSelected,
  checked = false,
  onCheck,
}) {
  return (
    <OverlayArticleCard
      item={item}
      vote={vote}
      onVote={onVote}
      onSelect={onSelect}
      onOpen={onOpen}
      onHide={onHide}
      variant={variant}
      isSelected={isSelected}
      checked={checked}
      onCheck={onCheck}
    />
  );
}
