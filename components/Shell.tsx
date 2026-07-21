"use client";

import { navigation } from "@/lib/navigation";
import { Icon } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import type { ColorTheme, DeskProfile, ViewerProfile } from "@/types/news";

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
};

const formatDeskDate = (date: Date) => new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Asia/Kolkata",
}).format(date);

export function Sidebar({
  active,
  collapsed,
  onNavigate,
  onToggle,
  profile,
  canSwitchProfile,
  canViewAnalytics,
  onProfileChange,
  onFeedback,
  sourceCount,
  lastBriefingAt,
  droppedCount,
}: {
  active: string;
  collapsed: boolean;
  onNavigate: (id: string) => void;
  onToggle: () => void;
  profile: DeskProfile;
  canSwitchProfile: boolean;
  canViewAnalytics: boolean;
  onProfileChange: (profile: DeskProfile) => void;
  onFeedback: () => void;
  sourceCount: number;
  lastBriefingAt: string | null;
  droppedCount: number;
}) {
  return (
    <aside id="signalroom-navigation" className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`} aria-label="Main navigation">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="brand-type"><strong>{PRODUCT_NAME}</strong><span>INTELLIGENCE DESK</span></div>
      </div>
      <nav className="nav-groups">
        {navigation.map((group) => (
          <div className="nav-group" key={group.group}>
            <span className="nav-label">{group.group}</span>
            {group.items.filter((item) =>
              item.id !== "analytics" || canViewAnalytics,
            ).map((item) => (
              <button
                key={item.id}
                className={active === item.id ? "active" : ""}
                onClick={() => onNavigate(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                aria-label={item.id === "analytics" ? `${item.label}, restricted` : item.id === "gatekeeper" || item.id === "dropped" ? `${item.label}, password protected` : item.label}
              >
                <Icon>{item.icon}</Icon><span className="nav-text">{item.label}</span>
                {item.id === "dropped" && <span className="nav-count">{droppedCount}</span>}
                {item.id === "analytics" && <span className="nav-admin">ADMIN</span>}
                {item.id === "gatekeeper" && <span className="nav-admin">REVIEW</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      {canSwitchProfile && <div className="profile-switcher" role="group" aria-label="Developer desk profile preview">
        <span>Developer preview</span>
        <div>
          <button className={profile === "default" ? "active" : ""} onClick={() => onProfileChange("default")} aria-pressed={profile === "default"}><i />Default</button>
          <button className={profile === "broadcast" ? "active" : ""} onClick={() => onProfileChange("broadcast")} aria-pressed={profile === "broadcast"}><i />Broadcast</button>
        </div>
      </div>}
      <button className="sidebar-feedback" onClick={onFeedback} aria-label="Share product feedback" data-tooltip="Share product feedback">
        <Icon>◉</Icon><span className="nav-text"><strong>Share feedback</strong><small>Tell us what to improve</small></span>
      </button>
      <div className="creator-credit nav-text"><span>Designed & engineered by</span><strong>Vineet Singh</strong><small>Chief Developer & Engineer</small></div>
      <div className="sidebar-health">
        <span className="pulse-dot" /><div><strong>{profile === "broadcast" ? "Broadcast desk live" : "Default desk live"}</strong><span>{sourceCount} enabled sources · {lastBriefingAt ? new Date(lastBriefingAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "no briefing yet"}</span></div>
      </div>
      <button className="sidebar-toggle" onClick={onToggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
        <Icon>{collapsed ? "→" : "←"}</Icon><span className="nav-text">Collapse</span>
      </button>
    </aside>
  );
}

export function Header({
  pageLabel,
  onScan,
  onNotifications,
  onSearch,
  onMenu,
  menuOpen,
  notificationsCount,
  scanRunning,
  profile,
  theme,
  onThemeChange,
  viewer,
  profileOpen,
  onProfile,
  lastBriefingAt,
}: {
  pageLabel: string;
  onScan: () => void;
  onNotifications: () => void;
  onSearch: () => void;
  onMenu: () => void;
  menuOpen: boolean;
  notificationsCount: number;
  scanRunning: boolean;
  profile: DeskProfile;
  theme: ColorTheme;
  onThemeChange: () => void;
  viewer: ViewerProfile;
  profileOpen: boolean;
  onProfile: () => void;
  lastBriefingAt: string | null;
}) {
  return (
    <header className="global-header">
      <button id="signalroom-mobile-menu" className="mobile-menu icon-button" onClick={onMenu} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="signalroom-navigation"><Icon>☰</Icon></button>
      <div className="header-context">
        <span className="eyebrow">{pageLabel}</span>
        <div className="date-line"><strong>{formatDeskDate(new Date())}</strong><span>{lastBriefingAt ? `Briefing ${new Date(lastBriefingAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}` : "Awaiting first briefing"}</span></div>
      </div>
      <button className="command-search" onClick={onSearch} aria-label="Open search">
        <Icon>⌕</Icon><span>Search intelligence</span><kbd>⌘ K</kbd>
      </button>
      <span className={`profile-context-badge profile-${profile}`}><i />{profile === "broadcast" ? "Broadcast desk" : "Default desk"}</span>
      <div className="scan-state" aria-live="polite">
        <span className={scanRunning ? "pulse-dot scanning" : "pulse-dot"} />
        <div><strong>{scanRunning ? "Scan running" : "Desk is live"}</strong><span>{scanRunning ? "Processing sources" : lastBriefingAt ? `Updated ${new Date(lastBriefingAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No completed briefing"}</span></div>
      </div>
      <button className="icon-button notification-button" onClick={onNotifications} aria-label={`${notificationsCount} unread notifications`}>
        <Icon>◌</Icon>{notificationsCount > 0 && <span>{notificationsCount}</span>}
      </button>
      <button className="icon-button theme-toggle" onClick={onThemeChange} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} aria-pressed={theme === "dark"}><Icon>{theme === "light" ? "◐" : "☀"}</Icon></button>
      <button className="primary-button scan-button" onClick={onScan}><Icon>↻</Icon>{scanRunning ? "View scan" : "New scan"}</button>
      <button className="avatar-button" onClick={onProfile} aria-label={`Open ${viewer.displayName} account settings`} aria-haspopup="dialog" aria-expanded={profileOpen} aria-controls="profile-dialog"><span>{getInitials(viewer.displayName)}</span><div><strong>{viewer.displayName}</strong><small>{viewer.roleLabel}</small></div><Icon>⌄</Icon></button>
    </header>
  );
}
