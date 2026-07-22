import React from 'react';
import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

const REVIEW = [
  { to:'/home',     label:'Latest feed',    icon:'inbox',  countKey:'feed', newBadge:true },
  { to:'/scan',     label:'Manual scan',    icon:'search' },
  { to:'/selected', label:'Selected',       icon:'check',  countKey:'selected' },
  { to:'/approved', label:'Approved',       icon:'star',   countKey:'approved' },
  { to:'/rejected', label:'Not interested', icon:'trash',  countKey:'rejected' },
];
const INTEL = [
  { to:'/sources',   label:'Sources',   icon:'globe' },
  { to:'/scheduler', label:'Scheduler', icon:'clock' },
  { to:'/history',   label:'History',   icon:'history' },
  { to:'/trends',    label:'Trends',    icon:'trend' },
];

function Item({ to, label, icon, count, showNew }) {
  return (
    <NavLink to={to}
             className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
      <Icon name={icon} />
      <span>{label}</span>
      {count != null && <span className="count tnum">{count}</span>}
      {showNew && <span className="badge-new">New</span>}
    </NavLink>
  );
}

export default function Sidebar({ counts = {} }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">S</div>
        <div>
          <div className="name">SENSE</div>
          <div className="sub">News intelligence</div>
        </div>
      </div>

      <div className="nav-section">Review</div>
      <div className="col gap-4">
        {REVIEW.map((it) => (
          <Item key={it.to} {...it}
                count={it.countKey ? counts[it.countKey] : null}
                showNew={it.newBadge && counts.newBriefing} />
        ))}
      </div>

      <div className="nav-section">Intelligence</div>
      <div className="col gap-4">
        {INTEL.map((it) => <Item key={it.to} {...it} />)}
      </div>

      <div className="sidebar-foot">
        <div className="crawler-chip">
          <div className="row">
            <span className="label">Autonomous engine</span>
            <span className="status"><span className="pulse"></span>live</span>
          </div>
          <div className="bar"><div className="fill" style={{ width: '62%' }}></div></div>
          <div className="next">Next run · scheduler</div>
        </div>

        <div className="user-chip">
          <div className="avatar">VS</div>
          <div className="col gap-4" style={{ gap: 0 }}>
            <div className="n">Vineet Singh</div>
            <div className="r">Editor</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
