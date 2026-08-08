import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { trackAction } from '../utils/tracking.js';
import useModalFocus from '../news-scrapper/components/modals/useModalFocus.js';

const FEEDBACK_KEY = 'news-voc-submitted';
const DISMISSED_KEY = 'news-voc-checkpoint-seen';
const ACTION_KEY = 'news-voc-action-count';
const STARTED_KEY = 'news-voc-started-at';
const FEEDBACK_EVENT = 'news-voc-completed';
const ACTION_THRESHOLD = 60;
const TIME_THRESHOLD_MS = 60 * 60 * 1000;
const RATING_LABELS = {
  1: 'Very poor',
  2: 'Needs work',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

function getApiBase() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');
  }
  if (['5173', '5174', '3000'].includes(window.location.port)) {
    return 'http://127.0.0.1:8000';
  }
  return '';
}

function feedbackWasHandled() {
  return localStorage.getItem(FEEDBACK_KEY) === 'true'
    || localStorage.getItem(DISMISSED_KEY) === 'true'
    || sessionStorage.getItem(FEEDBACK_KEY) === 'true';
}

export function FeedbackForm({ mandatory = false, onComplete }) {
  const [rating, setRating] = useState('');
  const [focus, setFocus] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!rating || !message.trim()) {
      setError('Rating and feedback are required.');
      return;
    }
    const payload = {
      rating,
      focus,
      message: message.trim(),
      mandatory,
      type: 'voc_feedback',
      page: window.location.pathname || 'dashboard',
    };
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${getApiBase()}/voc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`VOC endpoint returned non-JSON response. HTTP ${response.status}`);
      }
      if (!response.ok || result.status !== 'success') {
        throw new Error(result?.message || result?.detail || 'Failed to save feedback.');
      }
      localStorage.setItem(FEEDBACK_KEY, 'true');
      sessionStorage.setItem(FEEDBACK_KEY, 'true');
      window.dispatchEvent(new Event(FEEDBACK_EVENT));
      try {
        trackAction('voc_feedback', payload);
      } catch (trackError) {
        console.warn('VOC tracking failed after save:', trackError);
      }
      onComplete?.();
    } catch (err) {
      console.error('VOC feedback submit failed:', err);
      setError(err.message || 'Could not save feedback. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="field-label">Experience rating</div>
        <div className="mt-3 flex gap-2" role="group" aria-label="Experience rating">
          {['1', '2', '3', '4', '5'].map((value) => (
            <button
              aria-label={`${value} — ${RATING_LABELS[value]}`}
              aria-pressed={rating === value}
              className={rating === value ? 'rating-button active' : 'rating-button'}
              key={value}
              onClick={() => { setRating(value); setError(''); }}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="field-label">What should improve most?</span>
        <select className="dark-input mt-3" value={focus} onChange={(event) => setFocus(event.target.value)}>
          <option value="">Select an area</option>
          <option value="briefing">Intelligence Briefing</option>
          <option value="search">Scan</option>
          <option value="workflow">Review and Approval Workflow</option>
          <option value="archive">Briefing Archive</option>
          <option value="sources">Source Control</option>
        </select>
      </label>
      <label className="block">
        <span className="field-label">Voice of customer</span>
        <textarea
          className="dark-textarea mt-3"
          value={message}
          onChange={(event) => { setMessage(event.target.value); setError(''); }}
          placeholder="What would make this intelligence experience genuinely better?"
        />
      </label>
      {error && <div className="text-sm font-medium text-rose-300" role="alert">{error}</div>}
      <button className="btn-dark-primary w-full justify-center" disabled={busy} onClick={submit} type="button">
        <Icon name="check" size={15} /> {busy ? 'Sending feedback…' : 'Submit Feedback'}
      </button>
    </div>
  );
}

export default function VocFeedback() {
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState(feedbackWasHandled);
  const dialogRef = useModalFocus(open, () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setHandled(true);
    setOpen(false);
  });

  useEffect(() => {
    if (handled || feedbackWasHandled()) return undefined;
    let actions = Number(sessionStorage.getItem(ACTION_KEY) || 0);
    const startedAt = Number(sessionStorage.getItem(STARTED_KEY) || Date.now());
    sessionStorage.setItem(STARTED_KEY, String(startedAt));
    const registerClick = (event) => {
      if (event.target.closest('[data-voc-panel]')) return;
      if (!event.target.closest('button, a, article')) return;
      actions += 1;
      sessionStorage.setItem(ACTION_KEY, String(actions));
      if (actions >= ACTION_THRESHOLD) setOpen(true);
    };
    const completeFeedback = () => {
      setHandled(true);
      setOpen(false);
    };
    const remaining = Math.max(0, TIME_THRESHOLD_MS - (Date.now() - startedAt));
    const timer = window.setTimeout(() => setOpen(true), remaining);
    document.addEventListener('click', registerClick, true);
    window.addEventListener(FEEDBACK_EVENT, completeFeedback);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', registerClick, true);
      window.removeEventListener(FEEDBACK_EVENT, completeFeedback);
    };
  }, [handled]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setHandled(true);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <div className="modal-overlay voc-overlay" onClick={dismiss}>
      <section
        aria-describedby="voc-checkpoint-description"
        aria-labelledby="voc-checkpoint-title"
        aria-modal="true"
        className="voc-modal"
        data-voc-panel
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="voc-head">
          <div>
            <div className="eyebrow">Voice Of Customer</div>
            <h2 id="voc-checkpoint-title">Help shape the intelligence briefing.</h2>
            <p id="voc-checkpoint-description">A quick check-in after exploring the product. This prompt appears only once.</p>
          </div>
          <div className="voc-required">Quick check-in</div>
        </div>
        <FeedbackForm mandatory onComplete={() => {
          setHandled(true);
          setOpen(false);
        }} />
        <button className="voc-dismiss" onClick={dismiss} type="button">Not now</button>
      </section>
    </div>
  );
}
