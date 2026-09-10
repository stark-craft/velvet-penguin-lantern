import React from 'react';
import Icon from '../news-scrapper/components/Icon.jsx';
import { articleKey } from '../news-scrapper/utils/intelligence.js';

function imageOf(item) {
  return item?.image_url || item?.imageUrl || item?.thumbnail_url || item?.og_image || '';
}

function ReactionButton({ item, reaction, onReact, disabled }) {
  const state = item.reactions || {};
  const active = state.viewer_reaction === reaction;
  const count = Number(state[`${reaction}_count`] || 0);
  return <button aria-label={`${reaction === 'like' ? 'Like' : 'Dislike'} ${item.title}, ${count}`} className={`action-btn${active ? ' active' : ''}`} disabled={disabled} onClick={() => onReact(item, reaction)} type="button"><Icon name={reaction === 'like' ? 'thumbsUp' : 'thumbsDown'} size={15} /><span>{count}</span></button>;
}

function StoryCard({ item, large, saved, savedReady, busy, onOpen, onSave, onHide, onReact }) {
  const image = imageOf(item);
  return <article className={large ? 'news-card-large' : 'news-card-small'}>
    <button aria-label={`Open dossier for ${item.title}`} className={large ? 'card-image' : 'card-image-sm'} onClick={() => onOpen(item)} style={image ? { backgroundImage: `linear-gradient(0deg,rgba(5,10,28,.28),rgba(5,10,28,.05)),url("${image}")` } : undefined} type="button">
      {!image && <Icon name="globe" size={38} />}
      <span className="card-source-badge">{item.src || item.source || 'TechScout'}</span>
    </button>
    <div className="card-body">
      <button className="sampark-story-title" onClick={() => onOpen(item)} type="button"><h4>{item.title}</h4></button>
      <p>{item.summary || item.master_summary || 'Open the intelligence dossier for the full summary.'}</p>
      <div className="card-footer">
        <span className="card-meta"><Icon name="clock" size={13} /> {item.date || 'Latest'}</span>
        <div className="card-actions">
          <ReactionButton disabled={busy} item={item} onReact={onReact} reaction="like" />
          <ReactionButton disabled={busy} item={item} onReact={onReact} reaction="dislike" />
          <button aria-label={`${saved ? 'Stop following' : 'Follow'} ${item.title}`} className={`action-btn${saved ? ' active' : ''}`} disabled={busy || !savedReady} onClick={() => onSave(item)} title={saved ? 'Stop following' : 'Follow and save'} type="button"><Icon name={saved ? 'check' : 'bookmark'} size={15} /></button>
          <button aria-label={`Hide ${item.title}`} className="action-btn" disabled={busy} onClick={() => onHide(item)} title="Hide from your feed" type="button"><Icon name="eye" size={15} /></button>
        </div>
      </div>
    </div>
  </article>;
}

export default function SamparkForYouView({ items, labels, reviewedCount, savedKeys, savedReady, busyActions, onEditPreferences, onOpen, onSave, onHide, onReact }) {
  const stories = items.slice(0, 5);
  const liked = items.filter(item => item.reactions?.viewer_reaction === 'like').length;
  return <div className="tab-content active sampark-for-you">
    <div className="preferences-bar">
      <div className="pref-label">Your Preferences:</div>
      <div className="pref-tags">{labels.map(label => <span className="pref-tag" key={label}>{label}</span>)}</div>
      <button className="view-prefs-link" onClick={onEditPreferences} type="button">Edit Preferences</button>
    </div>
    <section className="activity-section" aria-labelledby="sampark-activity-title">
      <h3 className="section-title" id="sampark-activity-title">Your Activities</h3>
      <div className="metrics-grid">
        <div className="metric-card"><span className="metric-icon blue"><Icon name="eye" size={18} /></span><div className="metric-info"><div className="metric-value">{reviewedCount}</div><div className="metric-label">News read</div></div></div>
        <div className="metric-card"><span className="metric-icon green"><Icon name="thumbsUp" size={18} /></span><div className="metric-info"><div className="metric-value">{liked}</div><div className="metric-label">Likes</div></div></div>
        <div className="metric-card"><span className="metric-icon purple"><Icon name="bookmark" size={18} /></span><div className="metric-info"><div className="metric-value">{savedKeys.size}</div><div className="metric-label">Follows</div></div></div>
      </div>
    </section>
    <section className="news-for-you" aria-labelledby="sampark-selected-title">
      <h3 className="section-title" id="sampark-selected-title">News Selected For You</h3>
      {stories.length ? <div className="foryou-grid">
        <StoryCard busy={Boolean(busyActions[articleKey(stories[0])])} item={stories[0]} large onHide={onHide} onOpen={onOpen} onReact={onReact} onSave={onSave} saved={savedKeys.has(articleKey(stories[0]))} savedReady={savedReady} />
        <div className="news-card-small-grid">{stories.slice(1).map(item => <StoryCard busy={Boolean(busyActions[articleKey(item)])} item={item} key={articleKey(item)} onHide={onHide} onOpen={onOpen} onReact={onReact} onSave={onSave} saved={savedKeys.has(articleKey(item))} savedReady={savedReady} />)}</div>
      </div> : <p className="sampark-empty">Your mix is waiting for fresh signals.</p>}
    </section>
  </div>;
}
