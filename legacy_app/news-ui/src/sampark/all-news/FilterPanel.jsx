import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

function CustomSelect({ label, value, options, onChange }){
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // close on outside click handled by parent FilterPanel's single handler
  // this component just toggles; parent will control open state via props if needed
  // Instead, we implement local open with document handler inside FilterPanel
  return null;
}

export default function FilterPanel({ options, draft, setDraft, onApply, onReset, filteredCount }){
  const [openKey, setOpenKey] = useState(null);
  const [applied, setApplied] = useState(false);
  const [applyPressed, setApplyPressed] = useState(false);
  const [resetPressed, setResetPressed] = useState(false);
  const panelRef = useRef(null);

  useEffect(()=>{
    const onDown = (e)=>{
      if(!panelRef.current) return;
      if(panelRef.current.contains(e.target)) return;
      setOpenKey(null);
    };
    document.addEventListener('mousedown', onDown);
    return ()=> document.removeEventListener('mousedown', onDown);
  },[]);

  const Field = ({ fieldKey, label, opts })=>{
    const isOpen = openKey===fieldKey;
    const val = draft[fieldKey];
    const display = val==='all' ? `All ${label}` : val;
    const allOpts = ['all', ...opts];
    const [activeIndex, setActiveIndex] = useState(() => Math.max(0, allOpts.indexOf(val)));
    const buttonRef = useRef(null);
    const optionRefs = useRef([]);
    useEffect(()=>{ if (isOpen) {
      const idx = Math.max(0, allOpts.indexOf(val));
      setActiveIndex(idx);
      const t = window.setTimeout(()=> optionRefs.current[idx]?.focus(), 0);
      return ()=> window.clearTimeout(t);
    } else if (document.activeElement && panelRef.current?.contains(document.activeElement)) {
      buttonRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[isOpen]);
    const choose = (opt)=>{ setDraft(c=> ({...c, [fieldKey]:opt})); setOpenKey(null); buttonRef.current?.focus(); };
    const onTriggerKey = (e)=>{
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(fieldKey); }
    };
    const onOptionKey = (e, idx)=>{
      if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.min(allOpts.length - 1, idx + 1); setActiveIndex(n); optionRefs.current[n]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, idx - 1); setActiveIndex(n); optionRefs.current[n]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(0); optionRefs.current[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); setActiveIndex(allOpts.length - 1); optionRefs.current[allOpts.length - 1]?.focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(allOpts[idx]); }
      else if (e.key === 'Escape') { e.preventDefault(); setOpenKey(null); }
    };
    return (
      <div className="tsan-filter-field">
        <span className="tsan-filter-label" id={`tsan-filter-label-${fieldKey}`}>{label}</span>
        <button
          ref={buttonRef}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={`tsan-filter-label-${fieldKey}`}
          className={`tsan-filter-select${isOpen ? ' is-open' : ''}`}
          onClick={()=> setOpenKey(isOpen ? null : fieldKey)}
          onKeyDown={onTriggerKey}
          type="button"
        >
          <span className="tsan-filter-value">{display}</span>
          <Icon name="chevD" size={12} />
        </button>
        {isOpen && (
          <div className="tsan-filter-dropdown" role="listbox" aria-label={label} aria-activedescendant={`tsan-filter-opt-${fieldKey}-${activeIndex}`}>
            {allOpts.map((opt, idx)=>(
              <button
                key={opt === 'all' ? 'all' : opt}
                id={`tsan-filter-opt-${fieldKey}-${idx}`}
                ref={(el)=>{ optionRefs.current[idx] = el; }}
                className={`tsan-filter-option${val===opt ? ' is-active' : ''}`}
                onClick={()=> choose(opt)}
                onKeyDown={(e)=> onOptionKey(e, idx)}
                onMouseEnter={()=> setActiveIndex(idx)}
                role="option"
                aria-selected={val===opt}
                type="button"
              >{opt === 'all' ? `All ${label}s` : opt}</button>
            ))}
            {!opts.length && allOpts.length === 1 && <span className="tsan-filter-empty">No options</span>}
          </div>
        )}
      </div>
    );
  };

  const handleApply = () => {
    setApplyPressed(true);
    onApply();
    setApplied(true);
    setTimeout(() => setApplyPressed(false), 200);
  };
  const handleReset = () => {
    setResetPressed(true);
    onReset();
    setApplied(false);
    setTimeout(() => setResetPressed(false), 200);
  };

  return (
    <section className="tsan-filter-panel" ref={panelRef} aria-label="Apply Filter & Customize View">
      <h3 className="tsan-filter-title">Apply Filter & Customize View</h3>
      <div className="tsan-filter-row">
        <Field fieldKey="region" label="Region" opts={options.regions} />
        <Field fieldKey="category" label="Category" opts={options.categories} />
        <Field fieldKey="source" label="Source" opts={options.sources} />
        <Field fieldKey="date" label="Date" opts={options.dates} />
      </div>
      <div className="tsan-filter-actions">
        <button className={`tsan-filter-apply${applyPressed ? ' is-pressed' : ''}`} aria-pressed={applyPressed} onClick={handleApply} type="button" disabled={applyPressed} style={{ opacity: applyPressed ? 0.7 : 1 }}>Apply</button>
        <button className={`tsan-filter-reset${resetPressed ? ' is-pressed' : ''}`} aria-pressed={resetPressed} onClick={handleReset} type="button" disabled={resetPressed}>Reset</button>
      </div>
      <div role="status" aria-live="polite" className="tsan-filter-status" style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        {applied ? `Filters applied · ${filteredCount ?? 0} stories` : ''}
      </div>
    </section>
  );
}
