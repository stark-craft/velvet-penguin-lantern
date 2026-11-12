import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { SRI_CREATE_OPTIONS } from './createNewsModel.js';

export default function SriCreateOptions({ onBack, onChoose }) {
  return (
    <div className="sampark-create-option-page">
      <button className="sampark-create-text-back" onClick={onBack} type="button"><Icon name="chevL" size={14} /> Create News</button>
      <header className="sampark-create-intro is-compact">
        <span className="sampark-create-eyebrow">Create for SRI-D</span>
        <h1>Choose what you want to publish</h1>
        <p>Every option uses the same private draft and editorial approval workflow.</p>
      </header>
      <div className="sampark-create-type-grid">
        {SRI_CREATE_OPTIONS.map((option) => (
          <button key={option.id} className={`sampark-create-type-card is-${option.id}`} onClick={() => onChoose(option.id)} type="button">
            <span className="sampark-create-type-icon"><Icon name={option.icon} size={22} /></span>
            <strong>{option.label}</strong>
            <p>{option.description}</p>
            <span className="sampark-create-card-action">Continue <Icon name="chevR" size={14} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
