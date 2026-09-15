import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';

export default function CreateNewsLanding({ draftCount = 0, onChooseSri, onChooseUrl, onOpenDrafts }) {
  return (
    <div className="sampark-create-landing">
      <header className="sampark-create-intro">
        <span className="sampark-create-eyebrow">Internal publishing</span>
        <h1>How would you like to create the news?</h1>
        <p>Build an SRI-D story or turn trusted article links into editable news cards.</p>
      </header>

      <div className="sampark-create-paths">
        <button className="sampark-create-path-card is-primary" onClick={onChooseSri} type="button">
          <span className="sampark-create-path-icon"><Icon name="layers" size={24} /></span>
          <span><strong>Create for SRI-D</strong><small>Stories, leadership messages and announcements</small></span>
          <Icon name="chevR" size={18} />
        </button>
        <button className="sampark-create-path-card" onClick={onChooseUrl} type="button">
          <span className="sampark-create-path-icon"><Icon name="globe" size={24} /></span>
          <span><strong>Create from URL</strong><small>Add up to 20 links and generate editable story cards</small></span>
          <Icon name="chevR" size={18} />
        </button>
      </div>

      <button className="sampark-create-drafts-link" onClick={onOpenDrafts} type="button">
        <Icon name="archive" size={16} /> Your drafts and submissions <span>{draftCount}</span>
      </button>
    </div>
  );
}
