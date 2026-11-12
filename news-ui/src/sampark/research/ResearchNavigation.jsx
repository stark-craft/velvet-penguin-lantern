import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../../news-scrapper/components/Icon.jsx';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'sparkle', path: '/research' },
  { id: 'papers', label: 'Papers', icon: 'file', path: '/research/papers' },
  { id: 'repositories', label: 'Repositories', icon: 'terminal', path: '/research/repositories' },
  { id: 'models', label: 'Models', icon: 'layers', path: '/research/models' },
  { id: 'datasets', label: 'Datasets', icon: 'server', path: '/research/datasets' },
  { id: 'patents', label: 'Patents', icon: 'note', path: '/research/patents' },
  { id: 'radar', label: 'Technology Radar', icon: 'radar', path: '/research/radar' },
  { id: 'watchlist', label: 'Watchlist', icon: 'bookmark', path: '/research/watchlist' },
  { id: 'compare', label: 'Compare', icon: 'sort', path: '/research/compare' },
  { id: 'briefs', label: 'Briefs', icon: 'note', path: '/research/briefs' },
  { id: 'archive', label: 'Archive Search', icon: 'archive', path: '/research/archive' },
];

export default function ResearchNavigation() {
  const location = useLocation();
  const current = location.pathname;

  return (
    <nav aria-label="Research sections" className="sampark-research-nav">
      <div className="sampark-research-nav-scroll">
        {NAV_ITEMS.map((item) => {
          const isActive = item.path === '/research' ? current === '/research' : current.startsWith(item.path);
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={`sampark-research-nav-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon name={item.icon} size={14} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
