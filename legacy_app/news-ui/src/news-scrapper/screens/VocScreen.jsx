import React, { useState } from 'react';
import { FeedbackForm } from '../components/VocFeedback.jsx';

export default function VocScreen() {
  const [complete, setComplete] = useState(false);

  return (
    <div className="page-stack voc-page">
      <section className="page-hero workspace-hero voc-hero">
        <div className="eyebrow">Voice Of Customer</div>
        <h1>Feedback Intelligence</h1>
        <p>Capture product insight from analysts and reviewers to improve prioritization, workflow, and briefing quality.</p>
      </section>
      <section className="voc-page-grid">
        <div className="surface-panel workspace-panel voc-submit-panel p-8">
          <h2 className="panel-title">Submit Feedback</h2>
          <p className="panel-copy">Tell the team what makes the intelligence experience stronger or slower.</p>
          {complete ? (
            <div className="success-panel" role="status" aria-live="polite">
              <strong>Feedback captured.</strong>
              <p>Thank you for improving NewsScrapper Intelligence.</p>
              <button className="btn-dark-secondary mt-4" onClick={() => setComplete(false)} type="button">
                Send another note
              </button>
            </div>
          ) : (
            <div className="mt-8">
              <FeedbackForm onComplete={() => setComplete(true)} />
            </div>
          )}
        </div>
        <div className="surface-panel workspace-panel voc-themes-panel p-8">
          <div className="eyebrow">Feedback Themes</div>
          <div className="mt-7 space-y-4">
            {['Signal quality and ranking', 'Review and approval flow', 'Search and source coverage', 'Export and archive clarity'].map((topic) => (
              <div className="voc-theme" key={topic}>{topic}</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
