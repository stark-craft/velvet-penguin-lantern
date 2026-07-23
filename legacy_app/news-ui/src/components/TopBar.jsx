import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { getAnalyticsAccess, getGatekeeperAccess, getProfile } from "../api.js";
const mainNav = [
  { to: "/scan", label: "Scan" },
  { to: "/selected", label: "Review Queue" },
  { to: "/approved", label: "Approved Briefing" },
];
const baseSettingsNav = [
  { to: "/home", label: "Intelligence Briefing" },
  { to: "/history", label: "Briefing Archive" },
  { to: "/rejected", label: "Hidden Signals" },
  { to: "/sources", label: "Source Control" },
  { to: "/voc", label: "Voice of Customer" },
];
function isLocalDevHost() {
  if (typeof window === "undefined") {
    return false;
  }
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}
function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "ME").toUpperCase();
}

export default function TopBar({
  manualScan,
  theme,
  onToggleTheme,
  viewer,
  viewerLoading,
  onEditProfile,
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(
    localStorage.getItem("news-profile") || "default",
  );
  const [analyticsAllowed, setAnalyticsAllowed] = useState(isLocalDevHost());
  const [gatekeeperAllowed, setGatekeeperAllowed] = useState(isLocalDevHost());
  useEffect(() => {
    async function syncProfileFromBackend() {
      try {
        const response = await getProfile();
        const backendProfile = response?.profile || "default";
        const currentLocalStorageProfile =
          localStorage.getItem("news-profile") || "default";
        if (backendProfile !== currentLocalStorageProfile) {
          localStorage.setItem("news-profile", backendProfile);
          setProfile(backendProfile);
          window.dispatchEvent(
            new CustomEvent("news-profile-change", { detail: backendProfile }),
          );
          console.log(
            `[TopBar] Profile synced to ${backendProfile} from backend (was ${currentLocalStorageProfile})`,
          );
        } else {
          console.log(
            `[TopBar] Profile already matches backend: ${backendProfile}`,
          );
        }
      } catch (err) {
        console.warn("[TopBar] Could not sync profile from backend:", err);
      }
    }
    syncProfileFromBackend();
  }, []);
  useEffect(() => {
    const onProfile = () => {
      setProfile(localStorage.getItem("news-profile") || "default");
    };
    window.addEventListener("news-profile-change", onProfile);
    window.addEventListener("storage", onProfile);
    return () => {
      window.removeEventListener("news-profile-change", onProfile);
      window.removeEventListener("storage", onProfile);
    };
  }, []);
  useEffect(() => {
    if (!open && !profileOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, profileOpen]);
  useEffect(() => {
    let cancelled = false;
    async function checkPrivateAccess() {
      const [analyticsResult, gatekeeperResult] = await Promise.allSettled([
        getAnalyticsAccess(),
        getGatekeeperAccess(),
      ]);
      if (cancelled) {
        return;
      }
      const localDevelopment = isLocalDevHost();
      if (analyticsResult.status === "fulfilled") {
        setAnalyticsAllowed(
          Boolean(analyticsResult.value?.allowed) || localDevelopment,
        );
      } else {
        setAnalyticsAllowed(localDevelopment);
      }
      if (gatekeeperResult.status === "fulfilled") {
        setGatekeeperAllowed(
          Boolean(gatekeeperResult.value?.allowed) || localDevelopment,
        );
      } else {
        setGatekeeperAllowed(localDevelopment);
      }
    }
    checkPrivateAccess();
    return () => {
      cancelled = true;
    };
  }, []);
  const isBroadcast = profile === "broadcast";
  const settingsNav = [
    ...baseSettingsNav,
    ...(gatekeeperAllowed
      ? [{ to: "/gatekeeper-review", label: "Gatekeeper Review" }]
      : []),
    ...(analyticsAllowed
      ? [{ to: "/director-analytics", label: "Analytics" }]
      : []),
  ];
  return (
    <header
      className={[
        "design-header",
        isBroadcast ? "is-broadcast" : "is-default",
        "fixed inset-x-0 top-0 z-40 w-full",
      ].join(" ")}
    >
      {" "}
      <div className="command-header-inner flex items-center">
        {" "}
        <div className="header-identity flex items-center">
          {" "}
          <button
            className="news-wordmark"
            onClick={() => navigate("/home")}
            type="button"
          >
            {" "}
            <span className="news-word"> Samsung </span>{" "}
            <span className="scrapper-word"> TechScout </span>{" "}
          </button>{" "}
          <span className="profile-badge">
            {" "}
            {isBroadcast
              ? "Broadcast Intelligence"
              : "Default Intelligence"}{" "}
          </span>{" "}
        </div>{" "}
        <nav className="command-nav ml-auto flex items-center gap-1">
          {" "}
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                ["command-nav-link", isActive ? "active" : ""].join(" ")
              }
            >
              {" "}
              {item.label}{" "}
              {item.to === "/scan" && manualScan?.running && (
                <span
                  className="deep-scan-dot"
                  aria-label="Scan running"
                />
              )}{" "}
            </NavLink>
          ))}{" "}
        </nav>{" "}
        <div className="header-actions">
          {" "}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <div className="viewer-control">
            <button
              aria-expanded={profileOpen}
              aria-haspopup="dialog"
              className="viewer-trigger"
              onClick={() => {
                setOpen(false);
                setProfileOpen((current) => !current);
              }}
              title="Open your profile"
              type="button"
            >
              <span className="viewer-avatar" aria-hidden="true">
                {initialsFor(viewer?.display_name)}
              </span>
              <span className="viewer-trigger-copy">
                <span>{viewerLoading ? "Loading profile" : viewer?.display_name || "Set up profile"}</span>
                <small>Your desk</small>
              </span>
              <Icon name="chevD" size={14} />
            </button>
            {profileOpen && (
              <div className="viewer-popover" role="dialog" aria-label="Your profile summary">
                <div className="viewer-popover-head">
                  <span className="viewer-avatar large" aria-hidden="true">
                    {initialsFor(viewer?.display_name)}
                  </span>
                  <div>
                    <strong>{viewer?.display_name || "Intelligence explorer"}</strong>
                    <span>{viewer?.email || "No email added"}</span>
                  </div>
                </div>
                <dl>
                  <div><dt>Current IP</dt><dd>{viewer?.ip || "Detected by backend"}</dd></div>
                  <div><dt>Active profile</dt><dd>{isBroadcast ? "Broadcast Intelligence" : "Default Intelligence"}</dd></div>
                  <div><dt>Stored identity</dt><dd>Protected hash</dd></div>
                </dl>
                <button
                  className="viewer-edit"
                  onClick={() => {
                    setProfileOpen(false);
                    onEditProfile?.();
                  }}
                  type="button"
                >
                  <Icon name="shield" size={15} /> Edit profile
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            {" "}
            <button
              className="command-settings-trigger"
              onClick={() => {
                setProfileOpen(false);
                setOpen((current) => !current);
              }}
              title="Settings"
              type="button"
            >
              {" "}
              <Icon name="settings" />{" "}
            </button>{" "}
            {open && (
              <div className="command-settings-menu absolute right-0 mt-4 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#101827] p-3 shadow-cockpit">
                {" "}
                {settingsNav.map((item) => (
                  <button
                    key={item.to}
                    className="command-settings-item flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
                    onClick={() => {
                      setOpen(false);
                      navigate(item.to);
                    }}
                    type="button"
                  >
                    {" "}
                    {item.label} <Icon name="chevR" size={14} />{" "}
                  </button>
                ))}{" "}
                <div className="settings-language-divider" aria-hidden="true" />{" "}
                <button
                  aria-label="English to Korean translation, coming soon in beta"
                  className="settings-language-preview"
                  title="Korean interface translation is coming soon"
                  type="button"
                >
                  {" "}
                  <span className="settings-language-orbit" aria-hidden="true">
                    {" "}
                    <Icon name="refresh" size={18} />{" "}
                  </span>{" "}
                  <span className="settings-language-copy">
                    {" "}
                    <span className="settings-language-title">
                      {" "}
                      English <span aria-hidden="true">
                        {" "}
                        -&gt;{" "}
                      </span> 한국어{" "}
                    </span>{" "}
                    <span className="settings-language-note">
                      {" "}
                      Interface translation{" "}
                    </span>{" "}
                  </span>{" "}
                  <span className="settings-language-beta">
                    {" "}
                    Beta soon{" "}
                  </span>{" "}
                </button>{" "}
              </div>
            )}{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </header>
  );
}
