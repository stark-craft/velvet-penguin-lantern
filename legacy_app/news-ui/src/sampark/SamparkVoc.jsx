import React, { useState } from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { TEAM_DIRECTORY } from '../news-scrapper/data/teamDirectory.js';
import { FeedbackForm } from '../components/VocFeedback.jsx';
import SamparkWorkspaceShell from './shared/SamparkWorkspaceShell.jsx';

export default function SamparkVoc() {
  const [complete, setComplete] = useState(false);

  return (
    <SamparkWorkspaceShell title="VOC — Voice of Customer" description="Customer feedback, trend intelligence and sentiment signals. Feedback submission remains private to your workspace.">
      <section className="sampark-voc-team" aria-label="TechScout team">
        <header className="sampark-voc-team-head">
          <span className="sampark-voc-kicker">Team & Feedback</span>
          <h2>Meet the TechScout Team</h2>
          <p>The people shaping a faster, clearer daily intelligence experience.</p>
        </header>
        <div className="sampark-voc-team-grid">
          {TEAM_DIRECTORY.map((member) => (
            <article key={member.id} className="sampark-voc-member">
              <span className="sampark-voc-avatar" aria-hidden="true">{member.initials}</span>
              <div>
                <small>TechScout team</small>
                <h3>{member.name}</h3>
                <strong>{member.role}</strong>
                <p>{member.note}</p>
              </div>
              <Icon name="sparkle" size={18} />
            </article>
          ))}
        </div>
      </section>

      <div className="sampark-voc-grid">
        <div className="sampark-voc-card">
          <span className="sampark-voc-kicker">Voice of Customer</span>
          <h3>Share Feedback</h3>
          <p>Tell the team what makes the intelligence experience stronger or slower. Your feedback is stored via the existing <code>/voc</code> endpoint and remains private where original behavior is private.</p>
          {complete ? (
            <div className="sampark-voc-success" role="status">
              <strong>Feedback captured.</strong>
              <p>Thank you for improving TechScout.</p>
              <button className="btn-secondary" onClick={() => setComplete(false)} type="button">Send another note</button>
            </div>
          ) : (
            <div className="sampark-voc-form">
              <FeedbackForm onComplete={() => setComplete(true)} />
            </div>
          )}
        </div>
        <div className="sampark-voc-card">
          <span className="sampark-voc-kicker">Feedback Themes</span>
          <div className="sampark-voc-themes">
            {['Signal quality and ranking', 'Review and approval flow', 'Search and source coverage', 'Export and archive clarity'].map((topic) => (
              <div className="sampark-voc-theme" key={topic}>{topic}</div>
            ))}
          </div>
          <p className="sampark-voc-note">Themes are static guidance; actual trends are derived from stored feedback where backend aggregation exists. No fake graphs.</p>
        </div>
      </div>
    </SamparkWorkspaceShell>
  );
}
