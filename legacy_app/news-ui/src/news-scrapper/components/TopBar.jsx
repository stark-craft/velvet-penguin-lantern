import React, { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import {
  getAnalyticsAccess,
  getGatekeeperAccess,
  getProfile,
  getTrendsAccess,
} from "../api.js";
import "./premium-navigation.css";

const mainNav = [
  { to: "/home", label: "Briefing", labelKo: "브리핑", icon: "home" },
  { to: "/scan", label: "Scan", labelKo: "스캔", icon: "search" },
  { to: "/saved", label: "Saved", labelKo: "나의 데스크", icon: "bookmark" },
  { to: "/selected", label: "Review Queue", labelKo: "검토 대기열", icon: "check2" },
  { to: "/approved", label: "Approved Briefing", labelKo: "승인된 브리핑", icon: "star" },
];

const baseSettingsNav = [
  { to: "/history", label: "Briefing Archive", labelKo: "브리핑 아카이브", icon: "archive" },
  { to: "/rejected", label: "Hidden Signals", labelKo: "숨긴 시그널", icon: "eye" },
  {
    to: "/sources",
    label: "Source Control",
    labelKo: "소스 관리",
    icon: "rss",
    matches: ["/sources", "/manage-sources"],
  },
  { to: "/scheduler", label: "Scheduler", labelKo: "스케줄러", icon: "clock" },
  { to: "/voc", label: "Voice of Customer", labelKo: "고객 의견", icon: "note" },
];

const protectedSettingsNav = [
  { to: "/trends", label: "Profile Switcher", labelKo: "프로필 전환", icon: "trend", access: "trends" },
  {
    to: "/gatekeeper-review",
    label: "Gatekeeper Review",
    labelKo: "게이트키퍼 검토",
    icon: "shield",
    access: "gatekeeper",
  },
  {
    to: "/director-analytics",
    label: "Analytics",
    labelKo: "분석",
    icon: "layers",
    access: "analytics",
  },
];

const copy = {
  en: {
    primaryNavigation: "Primary navigation",
    profileDefault: "Default Intelligence",
    profileBroadcast: "Broadcast Intelligence",
    loadingProfile: "Loading profile",
    setupProfile: "Set up profile",
    yourDesk: "Your desk",
    openProfile: "Open your profile",
    profileSummary: "Your profile summary",
    explorer: "Intelligence explorer",
    noEmail: "No email added",
    currentIp: "Current IP",
    detectedBackend: "Detected by backend",
    activeProfile: "Active profile",
    storedIdentity: "Stored identity",
    protectedHash: "Protected hash",
    privacyNote: "Your activity is linked privately on this device.",
    editProfile: "Edit profile",
    settings: "Settings",
    openSettings: "Open navigation and settings",
    settingsTitle: "Navigation & preferences",
    settingsEyebrow: "Command center",
    closeSettings: "Close settings",
    deskSection: "Your desk",
    workspaceSection: "Workspace",
    adminSection: "Privileged tools",
    ventureEyebrow: "Explore beyond the news",
    ventureTitle: "Venture Lens",
    ventureNote: "Research papers, repositories and emerging technology.",
    openVenture: "Open Venture Lens",
    language: "Language",
    currentInterface: "Current interface",
    english: "English",
    korean: "Korean",
    translating: "Translating interface…",
    translationReady: "Language changes apply only to your browser.",
    translationError: "Some dynamic content could not be translated. Check the local Korean model.",
    scanRunning: "Scan running",
  },
  ko: {
    primaryNavigation: "기본 탐색",
    profileDefault: "기본 인텔리전스",
    profileBroadcast: "방송 인텔리전스",
    loadingProfile: "프로필 불러오는 중",
    setupProfile: "프로필 설정",
    yourDesk: "나의 데스크",
    openProfile: "내 프로필 열기",
    profileSummary: "내 프로필 요약",
    explorer: "인텔리전스 탐색자",
    noEmail: "이메일 없음",
    currentIp: "현재 IP",
    detectedBackend: "백엔드에서 감지됨",
    activeProfile: "활성 프로필",
    storedIdentity: "저장된 식별 정보",
    protectedHash: "보호된 해시",
    privacyNote: "활동 정보는 이 기기에서 비공개로 연결됩니다.",
    editProfile: "프로필 편집",
    settings: "설정",
    openSettings: "탐색 및 설정 열기",
    settingsTitle: "탐색 및 환경 설정",
    settingsEyebrow: "명령 센터",
    closeSettings: "설정 닫기",
    deskSection: "나의 데스크",
    workspaceSection: "워크스페이스",
    adminSection: "관리자 도구",
    ventureEyebrow: "뉴스 너머를 탐색하세요",
    ventureTitle: "벤처 렌즈",
    ventureNote: "연구 논문, 저장소 및 신흥 기술을 살펴보세요.",
    openVenture: "벤처 렌즈 열기",
    language: "언어",
    currentInterface: "현재 인터페이스",
    english: "영어",
    korean: "한국어",
    translating: "인터페이스 번역 중…",
    translationReady: "언어 변경은 현재 브라우저에만 적용됩니다.",
    translationError: "일부 동적 콘텐츠를 번역할 수 없습니다. 로컬 한국어 모델을 확인하세요.",
    scanRunning: "스캔 실행 중",
  },
};

function routeMatches(pathname, item) {
  const candidates = item.matches || [item.to];
  return candidates.some(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
}

function isLocalDevHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0]?.slice(0, 2) || "ME"
  ).toUpperCase();
}

function personalDeskLabel(name, language) {
  const first = String(name || "").trim().split(/\s+/)[0];
  if (language === "ko") return `${first || "나"}의 데스크`;
  return first ? `${first}'s Desk` : "For Me";
}

function navLabel(item, language, viewer) {
  if (item.to === "/saved") return personalDeskLabel(viewer?.display_name, language);
  return language === "ko" ? item.labelKo : item.label;
}

function SettingsLink({ item, language, pathname, onNavigate, viewer }) {
  const active = routeMatches(pathname, item);
  return (
    <NavLink
      aria-current={active ? "page" : undefined}
      className={["premium-settings-link", active ? "active" : ""].filter(Boolean).join(" ")}
      onClick={onNavigate}
      to={item.to}
    >
      <span className="premium-settings-link-icon" aria-hidden="true">
        <Icon name={item.icon} size={16} />
      </span>
      <span>{navLabel(item, language, viewer)}</span>
      <Icon className="premium-settings-chevron" name="chevR" size={14} />
    </NavLink>
  );
}

export default function TopBar({
  manualScan,
  theme,
  onToggleTheme,
  viewer,
  viewerLoading,
  onEditProfile,
  language,
  onToggleLanguage,
  translationState,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsControlRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const [profile, setProfile] = useState(
    localStorage.getItem("news-profile") || "default",
  );
  const [analyticsAllowed, setAnalyticsAllowed] = useState(isLocalDevHost());
  const [gatekeeperAllowed, setGatekeeperAllowed] = useState(isLocalDevHost());
  const [profileSwitchAllowed, setProfileSwitchAllowed] = useState(isLocalDevHost());
  const ui = language === "ko" ? copy.ko : copy.en;

  useEffect(() => {
    async function syncProfileFromBackend() {
      try {
        const response = await getProfile();
        const backendProfile = response?.profile || "default";
        const currentProfile = localStorage.getItem("news-profile") || "default";
        if (backendProfile !== currentProfile) {
          localStorage.setItem("news-profile", backendProfile);
          setProfile(backendProfile);
          window.dispatchEvent(
            new CustomEvent("news-profile-change", { detail: backendProfile }),
          );
          console.log(`[TopBar] Profile synced to ${backendProfile} from backend (was ${currentProfile})`);
        } else {
          console.log(`[TopBar] Profile already matches backend: ${backendProfile}`);
        }
      } catch (error) {
        console.warn("[TopBar] Could not sync profile from backend:", error);
      }
    }
    syncProfileFromBackend();
  }, []);

  useEffect(() => {
    const onProfile = () => setProfile(localStorage.getItem("news-profile") || "default");
    window.addEventListener("news-profile-change", onProfile);
    window.addEventListener("storage", onProfile);
    return () => {
      window.removeEventListener("news-profile-change", onProfile);
      window.removeEventListener("storage", onProfile);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointerDown = (event) => {
      if (settingsOpen && !settingsControlRef.current?.contains(event.target)) {
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function checkPrivateAccess() {
      const [analyticsResult, gatekeeperResult, trendsResult] = await Promise.allSettled([
        getAnalyticsAccess(),
        getGatekeeperAccess(),
        getTrendsAccess(),
      ]);
      if (cancelled) return;
      const localDevelopment = isLocalDevHost();
      setAnalyticsAllowed(
        analyticsResult.status === "fulfilled"
          ? Boolean(analyticsResult.value?.allowed) || localDevelopment
          : localDevelopment,
      );
      setGatekeeperAllowed(
        gatekeeperResult.status === "fulfilled"
          ? Boolean(gatekeeperResult.value?.allowed) || localDevelopment
          : localDevelopment,
      );
      setProfileSwitchAllowed(
        trendsResult.status === "fulfilled"
          ? Boolean(trendsResult.value?.allowed) || localDevelopment
          : localDevelopment,
      );
    }
    checkPrivateAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  const isBroadcast = profile === "broadcast";
  const privilegedNav = protectedSettingsNav.filter((item) => {
    if (item.access === "trends") return profileSwitchAllowed;
    if (item.access === "gatekeeper") return gatekeeperAllowed;
    if (item.access === "analytics") return analyticsAllowed;
    return false;
  });
  const activeSettingsItem = [...baseSettingsNav, ...protectedSettingsNav].find(
    (item) => routeMatches(pathname, item),
  );
  const closeSettings = () => setSettingsOpen(false);
  const selectLanguage = (nextLanguage) => {
    if (nextLanguage === language || translationState?.pending) return;
    onToggleLanguage?.();
  };

  return (
    <header
      className={[
        "design-header premium-command-header fixed inset-x-0 top-0 z-40 w-full",
        isBroadcast ? "is-broadcast" : "is-default",
      ].join(" ")}
      data-no-translate
    >
      <div className="command-header-inner premium-command-inner">
        <div className="header-identity premium-header-identity">
          <button
            aria-label={language === "ko" ? "브리핑 홈으로 이동" : "Go to briefing home"}
            className="news-wordmark premium-wordmark"
            onClick={() => navigate("/home")}
            type="button"
          >
            <span className="news-word">Samsung</span>
            <span className="scrapper-word">TechScout</span>
          </button>
          <span className="profile-badge premium-profile-badge">
            <span aria-hidden="true" />
            {isBroadcast ? ui.profileBroadcast : ui.profileDefault}
          </span>
        </div>

        <nav aria-label={ui.primaryNavigation} className="command-nav premium-command-nav">
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                ["command-nav-link premium-command-link", isActive ? "active" : ""].join(" ")
              }
              to={item.to}
            >
              <Icon name={item.icon} size={16} />
              <span className="premium-command-label">{navLabel(item, language, viewer)}</span>
              {item.to === "/scan" && manualScan?.running && (
                <span className="deep-scan-dot" aria-label={ui.scanRunning} />
              )}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions premium-header-actions">
          <ThemeToggle language={language} theme={theme} onToggle={onToggleTheme} />

          <div className="premium-settings-control" ref={settingsControlRef}>
            <button
              aria-controls="premium-settings-center"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label={
                activeSettingsItem
                  ? `${navLabel(activeSettingsItem, language, viewer)}; ${ui.openSettings}`
                  : ui.openSettings
              }
              className={[
                "command-settings-trigger premium-settings-trigger",
                activeSettingsItem ? "active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setSettingsOpen((current) => !current)}
              ref={settingsTriggerRef}
              title={ui.openSettings}
              type="button"
            >
              <Icon name="settings" size={18} />
              <span className="premium-settings-trigger-label">{ui.settings}</span>
            </button>

            {settingsOpen && (
              <div
                aria-label={ui.settingsTitle}
                className="command-settings-menu premium-settings-center"
                id="premium-settings-center"
                role="dialog"
              >
                <div className="premium-settings-heading">
                  <div>
                    <span>{ui.settingsEyebrow}</span>
                    <h2>{ui.settingsTitle}</h2>
                  </div>
                  <button aria-label={ui.closeSettings} onClick={closeSettings} type="button">
                    <Icon name="x" size={17} />
                  </button>
                </div>

                <button
                  className="premium-settings-profile-entry"
                  onClick={() => {
                    closeSettings();
                    onEditProfile?.();
                  }}
                  type="button"
                >
                  <span className="premium-settings-profile-avatar" aria-hidden="true">
                    {initialsFor(viewer?.display_name)}
                  </span>
                  <span className="premium-settings-profile-copy">
                    <small>{ui.yourDesk}</small>
                    <strong>{viewerLoading ? ui.loadingProfile : viewer?.display_name || ui.setupProfile}</strong>
                    <span>{viewer?.email || viewer?.ip || ui.noEmail}</span>
                  </span>
                  <span className="premium-settings-profile-action">
                    {ui.editProfile}
                    <Icon name="chevR" size={15} />
                  </span>
                </button>

                <section className="premium-settings-primary" aria-labelledby="premium-desk-heading">
                  <h3 id="premium-desk-heading">{ui.deskSection}</h3>
                  <div className="premium-settings-grid">
                    {mainNav.map((item) => (
                      <SettingsLink
                        item={item}
                        key={`mobile-${item.to}`}
                        language={language}
                        onNavigate={closeSettings}
                        pathname={pathname}
                        viewer={viewer}
                      />
                    ))}
                  </div>
                </section>

                <a className="premium-venture-card" href="/venturelens" title={ui.openVenture}>
                  <span className="premium-venture-icon" aria-hidden="true">
                    <Icon name="sparkle" size={19} />
                  </span>
                  <span className="premium-venture-copy">
                    <small>{ui.ventureEyebrow}</small>
                    <strong>{ui.ventureTitle}</strong>
                    <span>{ui.ventureNote}</span>
                  </span>
                  <Icon className="premium-venture-arrow" name="external" size={17} />
                </a>

                <div className="premium-settings-columns">
                  <section aria-labelledby="premium-workspace-heading">
                    <h3 id="premium-workspace-heading">{ui.workspaceSection}</h3>
                    <div className="premium-settings-grid">
                      {baseSettingsNav.map((item) => (
                        <SettingsLink
                          item={item}
                          key={item.to}
                          language={language}
                          onNavigate={closeSettings}
                          pathname={pathname}
                          viewer={viewer}
                        />
                      ))}
                    </div>
                  </section>

                  {privilegedNav.length > 0 && (
                    <section aria-labelledby="premium-admin-heading">
                      <h3 id="premium-admin-heading">{ui.adminSection}</h3>
                      <div className="premium-settings-grid">
                        {privilegedNav.map((item) => (
                          <SettingsLink
                            item={item}
                            key={item.to}
                            language={language}
                            onNavigate={closeSettings}
                            pathname={pathname}
                            viewer={viewer}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                <section className="premium-language-panel" aria-labelledby="premium-language-heading">
                  <div className="premium-language-status">
                    <span id="premium-language-heading">{ui.language}</span>
                    <small>{ui.currentInterface}</small>
                    <strong>{language === "ko" ? "한국어" : "English"}</strong>
                  </div>
                  <div className="premium-language-switch" aria-label={ui.language} role="group">
                    <button
                      aria-pressed={language === "en"}
                      className={language === "en" ? "active" : ""}
                      disabled={translationState?.pending}
                      onClick={() => selectLanguage("en")}
                      type="button"
                    >
                      <span aria-hidden="true">EN</span>
                      {ui.english}
                    </button>
                    <button
                      aria-pressed={language === "ko"}
                      className={language === "ko" ? "active" : ""}
                      disabled={translationState?.pending}
                      onClick={() => selectLanguage("ko")}
                      type="button"
                    >
                      <span aria-hidden="true">한</span>
                      {ui.korean}
                    </button>
                  </div>
                  <p className={translationState?.error ? "is-error" : ""} aria-live="polite">
                    {translationState?.pending
                      ? ui.translating
                      : translationState?.error
                        ? ui.translationError
                        : ui.translationReady}
                  </p>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
