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

export default function FilterPanel({ options, draft, setDraft, onApply, onReset }){
  const [openKey, setOpenKey] = useState(null);
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
    return (
      <div className="tsan-filter-field">
        <span className="tsan-filter-label">{label}</span>
        <button
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`tsan-filter-select${isOpen ? ' is-open' : ''}`}
          onClick={()=> setOpenKey(isOpen ? null : fieldKey)}
          type="button"
        >
          <span className="tsan-filter-value">{display}</span>
          <Icon name="chevD" size={12} />
        </button>
        {isOpen && (
          <div className="tsan-filter-dropdown" role="listbox" aria-label={label}>
            <button className={`tsan-filter-option${val==='all' ? ' is-active' : ''}`} onClick={()=>{ setDraft(c=> ({...c, [fieldKey]:'all'})); setOpenKey(null); }} role="option" aria-selected={val==='all'} type="button">All {label}s</button>
            {opts.map(opt=>(
              <button key={opt} className={`tsan-filter-option${val===opt ? ' is-active' : ''}`} onClick={()=>{ setDraft(c=> ({...c, [fieldKey]:opt})); setOpenKey(null); }} role="option" aria-selected={val===opt} type="button">{opt}</button>
            ))}
            {!opts.length && <span className="tsan-filter-empty">No options</span>}
          </div>
        )}
      </div>
    );
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
        <button className="tsan-filter-apply" onClick={onApply} type="button">Apply</button>
        <button className="tsan-filter-reset" onClick={onReset} type="button">Reset</button>
      </div>
    </section>
  );
}
