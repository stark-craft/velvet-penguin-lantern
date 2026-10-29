import React from 'react';
import Icon from '../../news-scrapper/components/Icon.jsx';
import { SAMPARK_SAMSUNG_CHANNELS } from './samsungNewsModel.js';

export default function SamsungChannelTabs({ activeChannel, model, onChange }) {
  return (
    <nav aria-label="Samsung News channels" className="tsan-category-tabs samsung-channel-tabs">
      {SAMPARK_SAMSUNG_CHANNELS.map((channel) => {
        const active = activeChannel === channel.id;
        const count = model?.[channel.id]?.count || 0;
        return (
          <button
            aria-pressed={active}
            className={`tsan-cat-tab samsung-channel-tab${active ? ' is-active' : ''}`}
            key={channel.id}
            onClick={() => onChange(channel.id)}
            type="button"
          >
            <Icon name={channel.icon} size={16} />
            <span>{channel.label}</span>
            <small>{count}</small>
          </button>
        );
      })}
    </nav>
  );
}
