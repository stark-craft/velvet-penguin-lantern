import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';

function ChoiceGrid({ values, selected, onToggle, maximum }) {
  return <div className="fy-choice-grid">{values.map((option) => (
    <button
      aria-pressed={selected.includes(option.id)}
      className={selected.includes(option.id) ? 'active' : ''}
      disabled={!selected.includes(option.id) && selected.length >= maximum}
      key={option.id}
      onClick={() => onToggle(option.id)}
      type="button"
    >
      <span>{selected.includes(option.id) ? '✓' : '+'}</span>{option.label}
    </button>
  ))}</div>;
}

export default function InterestSetup({ open, taxonomy, initial, onClose, onComplete, onSkip }) {
  const dialogRef = useRef(null);
  const submittingRef = useRef(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [value, setValue] = useState(() => ({
    topics: initial?.topics || [], outcomes: initial?.outcomes || [],
    source_families: initial?.source_families || [], regions: initial?.regions || ['balanced'],
    surprise_me: initial?.surprise_me !== false,
  }));
  const pages = useMemo(() => [
    { key: 'topics', eyebrow: '01 · Intelligence beats', title: 'What deserves your attention?', note: 'Pick three to five. You can change this whenever you want.' },
    { key: 'outcomes', eyebrow: '02 · Work outcomes', title: 'What makes a signal useful?', note: 'Choose the developments that influence your work.' },
    { key: 'source_families', eyebrow: '03 · Evidence mix', title: 'Where should your signal come from?', note: 'This changes order—not facts, access, or the shared Briefing.' },
  ], []);
  useEffect(() => { submittingRef.current = submitting; }, [submitting]);
  useEffect(() => {
    if (!open) return undefined;
    setStep(0);
    setSubmitting(false);
    setSubmitError('');
    setValue({
      topics: initial?.topics || [], outcomes: initial?.outcomes || [],
      source_families: initial?.source_families || [], regions: initial?.regions || ['balanced'],
      surprise_me: initial?.surprise_me !== false,
    });
    const previous = document.activeElement;
    window.setTimeout(() => dialogRef.current?.querySelector('button')?.focus(), 0);
    const handleKey = (event) => {
      if (event.key === 'Escape' && !submittingRef.current) onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus?.(); };
  // Reinitialize only when the sheet opens; parent callback identities may
  // change during ordinary feed renders and must not reset an in-progress step.
  }, [open]);
  if (!open) return null;
  const page = pages[step];
  const selectedCount = value[page.key].length;
  const minimum = page.key === 'topics' ? 3 : 1;
  const maximum = page.key === 'topics' ? 5 : Number.POSITIVE_INFINITY;
  const pageIsValid = selectedCount >= minimum && selectedCount <= maximum;
  const toggle = (key, option) => setValue((current) => ({
    ...current,
    [key]: current[key].includes(option) ? current[key].filter((item) => item !== option) : [...current[key], option],
  }));
  const submit = async (handler) => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await handler();
    } catch (error) {
      setSubmitError(error?.message || 'Your mix could not be saved. Your choices are still here—please try again.');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fy-setup-backdrop" role="presentation">
      <section aria-labelledby="fy-setup-title" aria-modal="true" className="fy-setup" ref={dialogRef} role="dialog">
        <header>
          <div><span>{page.eyebrow}</span><h2 id="fy-setup-title">{page.title}</h2><p>{page.note}</p></div>
          <button aria-label="Close interest setup" disabled={submitting} onClick={onClose} type="button"><Icon name="x" size={18} /></button>
        </header>
        <div aria-label={`Step ${step + 1} of ${pages.length}`} aria-valuemax={pages.length} aria-valuemin="1" aria-valuenow={step + 1} className="fy-setup-progress" role="progressbar">{pages.map((_, index) => <span className={index <= step ? 'active' : ''} key={index} />)}</div>
        <div className="fy-choice-counter" id="fy-choice-guidance" role="status">
          {page.key === 'topics' ? `${selectedCount} of 3–5 topics selected` : `${selectedCount} selected · choose at least one`}
        </div>
        <ChoiceGrid maximum={maximum} values={taxonomy?.[page.key] || []} selected={value[page.key]} onToggle={(id) => toggle(page.key, id)} />
        {step === 2 && (
          <div className="fy-setup-extras">
            <div><strong>Region balance</strong><div className="fy-region-choices">{(taxonomy?.regions || []).map((region) => <button className={value.regions.includes(region.id) ? 'active' : ''} key={region.id} onClick={() => setValue((current) => ({ ...current, regions: [region.id] }))} type="button">{region.label}</button>)}</div></div>
            <label><input checked={value.surprise_me} onChange={(event) => setValue((current) => ({ ...current, surprise_me: event.target.checked }))} type="checkbox" /> <span><strong>Surprise me</strong><small>Keep a small window open to important intelligence outside your usual lane.</small></span></label>
          </div>
        )}
        {submitError && <div className="fy-setup-error" role="alert">{submitError}</div>}
        <footer>
          <button className="fy-quiet-button" disabled={submitting} onClick={() => submit(onSkip)} type="button">{submitting ? 'Saving…' : 'Use a balanced starter mix'}</button>
          <div>
            {step > 0 && <button className="fy-secondary-button" disabled={submitting} onClick={() => setStep((current) => current - 1)} type="button">Back</button>}
            {step < 2
              ? <button aria-describedby="fy-choice-guidance" className="fy-primary-button" disabled={!pageIsValid || submitting} onClick={() => setStep((current) => current + 1)} type="button">Continue <Icon name="chevR" size={15} /></button>
              : <button aria-describedby="fy-choice-guidance" className="fy-primary-button" disabled={!pageIsValid || submitting} onClick={() => submit(() => onComplete(value))} type="button">{submitting ? 'Saving your mix…' : 'Save my mix'} {!submitting && <Icon name="sparkle" size={15} />}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
