import React, { useState } from 'react';
import { FeedbackForm } from '../components/VocFeedback.jsx';
import Icon from '../components/Icon.jsx';
import { TEAM_DIRECTORY } from '../data/teamDirectory.js';

export default function VocScreen() {
  const [complete, setComplete] = useState(false);

  return (
    <div className="page-stack voc-page">
      <section className="page-hero workspace-hero voc-hero">
        <div className="eyebrow">Team &amp; Feedback</div>
        <h1>Meet the TechScout Team</h1>
        <p>The people shaping a faster, clearer daily intelligence experience.</p>
      </section>
      <section className="team-directory" aria-label="TechScout team">
        {TEAM_DIRECTORY.map((member) => <article key={member.id}><span aria-hidden="true">{member.initials}</span><div><small>TechScout team</small><h2>{member.name}</h2><strong>{member.role}</strong><p>{member.note}</p></div><Icon name="sparkle" size={18} /></article>)}
      </section>
      <section className="voc-page-grid">
        <div className="surface-panel workspace-panel voc-submit-panel p-8">
          <div className="eyebrow">Voice of Customer</div>
          <h2 className="panel-title">Share Feedback</h2>
          <p className="panel-copy">Tell the team what makes the intelligence experience stronger or slower.</p>
          {complete ? (
            <div className="success-panel" role="status" aria-live="polite">
              <strong>Feedback captured.</strong>
              <p>Thank you for improving TechScout.</p>
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
