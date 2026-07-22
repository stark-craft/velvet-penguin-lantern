import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

const groups = [
  { label: 'Intelligence desk', items: [
    ['/home', 'home', 'Morning briefing'],
    ['/scan', 'search', 'Discover & search'],
    ['/selected', 'check2', 'Review queue'],
    ['/approved', 'star', 'Approved briefing'],
  ] },
  { label: 'Operations', items: [
    ['/history', 'archive', 'Briefing archive'],
    ['/gatekeeper-review', 'shield', 'Gatekeeper review'],
    ['/rejected', 'eye', 'Hidden signals'],
    ['/sources', 'rss', 'Source control'],
    ['/scheduler', 'clock', 'Scheduler'],
    ['/trends', 'trend', 'Intelligence trends'],
  ] },
  { label: 'Listen & learn', items: [
    ['/voc', 'note', 'Voice of customer'],
    ['/director-analytics', 'layers', 'Analytics'],
  ] },
];

export default function AppSidebar({ collapsed, onCollapse, profile, onProfile }) {
  const navigate = useNavigate();
  return (
    <aside className={`app-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <button className="brand-mark" onClick={() => navigate('/home')} title="Open morning briefing" type="button"><i /><i /><i /><i /></button>
        {!collapsed && <div className="brand-type"><strong>newsScrapper</strong><span>Intelligence desk</span></div>}
      </div>

      <nav className="sidebar-navigation" aria-label="Primary navigation">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            {!collapsed && <div className="sidebar-group-label">{group.label}</div>}
            {group.items.map(([to, icon, label]) => (
              <NavLink className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`} key={to} title={collapsed ? label : undefined} to={to}>
                <Icon name={icon} size={18} /><span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="profile-switcher" title={collapsed ? `${profile} profile` : undefined}>
          {!collapsed && <span>Developer preview</span>}
          <div className="profile-switch-buttons">
            <button className={profile === 'default' ? 'active' : ''} onClick={() => onProfile('default')} type="button" title="Default intelligence profile"><i />{!collapsed && 'Default'}</button>
            <button className={profile === 'broadcast' ? 'active' : ''} onClick={() => onProfile('broadcast')} type="button" title="Broadcast intelligence profile"><i />{!collapsed && 'Broadcast'}</button>
          </div>
        </div>
        {!collapsed && <button className="sidebar-feedback" onClick={() => navigate('/voc')} type="button"><span className="feedback-icon"><Icon name="note" size={15} /></span><span><strong>Share feedback</strong><small>Tell us what to improve</small></span></button>}
        {!collapsed && <div className="creator-credit"><span>Designed & engineered by</span><strong>Vineet Singh</strong><small>Chief Developer & Engineer</small></div>}
        {!collapsed && <div className="system-health"><i /><div><strong>{profile === 'broadcast' ? 'Broadcast desk live' : 'Default desk live'}</strong><span>All systems ready</span></div></div>}
        <button className="sidebar-collapse" onClick={onCollapse} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} type="button">
          <Icon name={collapsed ? 'chevR' : 'chevL'} size={17} />
          {!collapsed && <span>Collapse navigation</span>}
        </button>
      </div>
    </aside>
  );
}
