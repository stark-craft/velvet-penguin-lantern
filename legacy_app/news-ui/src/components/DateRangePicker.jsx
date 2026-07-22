import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseISO = (value) => {
  const date = new Date(`${value || toISO(new Date())}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
const monthLabel = (date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const addMonths = (date, delta) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
const addDays = (date, delta) => {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
};

function buildMonth(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export default function DateRangePicker({
  from,
  to,
  onChange,
  label = 'Date Range',
  helpText = '',
  onHelp,
  shortcuts = true,
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [month, setMonth] = useState(parseISO(from || to));
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const triggerRef = useRef(null);

  const days = useMemo(() => buildMonth(month), [month]);
  const start = draftFrom || draftTo;
  const end = draftTo || draftFrom;

  const syncOpen = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setDraftFrom(from);
    setDraftTo(to);
    setMonth(parseISO(from || to));
    if (rect) {
      setAnchor({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 436)),
        top: Math.min(rect.bottom + 10, window.innerHeight - 620),
      });
    }
    setOpen((value) => !value);
  };

  const pickDay = (iso) => {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(iso);
      setDraftTo('');
      return;
    }
    if (iso < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(iso);
    } else {
      setDraftTo(iso);
    }
  };

  const applyShortcut = (kind) => {
    const today = new Date();
    if (kind === 'today') {
      const value = toISO(today);
      setDraftFrom(value);
      setDraftTo(value);
      setMonth(today);
    }
    if (kind === '24h') {
      setDraftFrom(toISO(addDays(today, -1)));
      setDraftTo(toISO(today));
      setMonth(today);
    }
    if (kind === '7d') {
      setDraftFrom(toISO(addDays(today, -6)));
      setDraftTo(toISO(today));
      setMonth(today);
    }
  };

  const apply = () => {
    onChange?.({
      from: draftFrom || draftTo || '',
      to: draftTo || draftFrom || '',
    });
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="scan-field-label">
        <span>{label}</span>
        {helpText && (
          <button
            className="scan-field-help"
            title={helpText}
            aria-label="Help: date range"
            onClick={onHelp}
            type="button"
          >
            ?
          </button>
        )}
      </div>
      <button
        ref={triggerRef}
        className="date-range-trigger dark-input flex items-center justify-between gap-3 text-left"
        onClick={syncOpen}
        type="button"
      >
        <span className="truncate font-semibold">{from || 'Start'} → {to || 'End'}</span>
        <Icon name="calendar" size={16} />
      </button>

      {open && createPortal((
        <>
          <button
            className="calendar-popover-scrim fixed inset-0 z-[139]"
            onClick={() => setOpen(false)}
            type="button"
            aria-label="Close date range picker"
          />
          <div
            className="date-range-popover fixed z-[150] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-white/10 bg-[#101827]/98 shadow-cockpit backdrop-blur-xl"
            style={{ left: `${anchor.left}px`, top: `${Math.max(16, anchor.top)}px` }}
            role="dialog"
            aria-modal="true"
            aria-label="Select date range"
          >
          <div className="date-range-head flex items-center justify-between border-b border-white/10 p-4">
            <button className="carousel-control h-9 w-9" onClick={() => setMonth(addMonths(month, -1))} type="button" aria-label="Previous month">
              <Icon name="chevL" size={15} />
            </button>
            <div className="text-sm font-semibold text-white">{monthLabel(month)}</div>
            <button className="carousel-control h-9 w-9" onClick={() => setMonth(addMonths(month, 1))} type="button" aria-label="Next month">
              <Icon name="chevR" size={15} />
            </button>
          </div>

          {shortcuts && (
            <div className="date-range-shortcuts flex flex-wrap gap-2 border-b border-white/10 p-3">
              <button className="source-chip" onClick={() => applyShortcut('today')} type="button">Today</button>
              <button className="source-chip" onClick={() => applyShortcut('24h')} type="button">Last 24 Hours</button>
              <button className="source-chip" onClick={() => applyShortcut('7d')} type="button">Last 7 Days</button>
            </div>
          )}

          <div className="date-range-calendar p-4">
            <div className="mb-2 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const iso = toISO(day);
                const selected = iso === draftFrom || iso === draftTo;
                const ranged = start && end && iso >= start && iso <= end;
                const muted = !sameMonth(day, month);
                return (
                  <button
                    key={iso}
                    className={[
                      'date-range-day h-10 rounded-xl text-sm font-semibold transition',
                      selected ? 'selected' : ranged ? 'in-range' : '',
                      selected ? 'bg-sky-400 text-white shadow-glow' : ranged ? 'bg-sky-400/12 text-sky-100' : 'bg-white/[0.035] text-slate-300 hover:bg-white/[0.07]',
                      muted ? 'muted opacity-35' : '',
                    ].join(' ')}
                    onClick={() => pickDay(iso)}
                    type="button"
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="date-range-foot flex items-center justify-between gap-3 border-t border-white/10 p-4">
            <div className="text-xs text-slate-500">{draftFrom || 'Start'} → {draftTo || 'End'}</div>
            <div className="flex gap-2">
              <button className="btn-dark-secondary h-9" onClick={() => setOpen(false)} type="button">Cancel</button>
              <button className="btn-dark-primary h-9" onClick={apply} type="button">Apply</button>
            </div>
          </div>
          </div>
        </>
      ), document.body)}
    </div>
  );
}
