import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useGuidePet } from "../../shared/guide/GuidePetContext.jsx";
import Icon from "./Icon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import NotificationBell from "./NotificationBell.jsx";
import useModalFocus from "./modals/useModalFocus.js";
import { NEWS_SCRAPPER_NAV_STYLE } from "./navigationStyle.js";
import { getProfile } from "../api.js";
import "./premium-navigation.css";

const mainNav = [
  { to: "/for-you", label: "For You", labelKo: "추천", icon: "sparkle", forYouOnly: true },
  { to: "/home", label: "Briefing", labelKo: "브리핑", icon: "home" },
  { to: "/scan", label: "Scan", labelKo: "스캔", icon: "search" },
  { to: "/research", label: "Research", labelKo: "리서치", icon: "note", matches: ["/research", "/venturelens"] },
  { to: "/samsung-internal", label: "Samsung Internal", labelKo: "삼성 내부", icon: "layers" },
];

const baseSettingsNav = [
  { to: "/for-you/following", label: "Following", labelKo: "팔로잉", icon: "bookmark" },
  { to: "/history", label: "Briefing Archive", labelKo: "브리핑 아카이브", icon: "archive" },
  { to: "/rejected", label: "Hidden Signals", labelKo: "숨긴 시그널", icon: "eye" },
  { to: "/voc", label: "Team & Feedback", labelKo: "팀 및 피드백", icon: "note" },
];

const protectedSettingsNav = [
  { to: "/selected", label: "Review Center", labelKo: "검토 센터", icon: "check2", any: ["review.news.view", "review.contributions.view"] },
  { to: "/approved", label: "Approved Briefing", labelKo: "승인된 브리핑", icon: "star", any: ["approved.view", "review.news.approve"] },
  {
    to: "/sources",
    label: "Source Control",
    labelKo: "소스 관리",
    icon: "rss",
    matches: ["/sources", "/manage-sources"],
    any: ["sources.view", "sources.manage"],
  },
  { to: "/scheduler", label: "Scheduler", labelKo: "스케줄러", icon: "clock", any: ["scheduler.view", "scheduler.control"] },
  {
    to: "/gatekeeper-review",
    label: "Gatekeeper Review",
    labelKo: "게이트키퍼 검토",
    icon: "shield",
    any: ["gatekeeper.review"],
  },
  {
    to: "/director-analytics",
    label: "Analytics",
    labelKo: "분석",
    icon: "layers",
    any: ["analytics.view"],
  },
  { to: "/access-management", label: "Access Management", labelKo: "접근 관리", icon: "key", any: ["access.manage"] },
];

const copy = {
  en: {
    primaryNavigation: "Primary navigation",
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
    guideEyebrow: "Optional guide",
    guideTitle: "Scout, your Sense.ai guide",
    guideNote: "Turn on route-aware tips when you want them. Scout stays off by default and never blocks your work.",
    guideLaunch: "Show guide",
    guideEnabled: "Guide enabled",
    guideDisabled: "Guide off",
    language: "Language",
    currentInterface: "Current interface",
    english: "English",
    korean: "Korean",
    translating: "Translating interface…",
    translationReady: "Language changes apply only to your browser.",
    translationError: "Some dynamic content could not be translated. Check the local Korean model.",
    translationConfirmEyebrow: "Language change",
    translationConfirmTitle: "Switch TechScout to Korean?",
    translationConfirmBody: "Interface labels change first, then loaded stories follow progressively.",
    translationConfirmLock: "TechScout uses private on-device translation when your browser supports it, with the local server model as fallback. You can return to English at any time.",
    translationCancel: "Stay in English",
    translationStart: "Start Korean translation",
    translationProgressTitle: "Korean translation in progress",
    translationProgressBody: "Keep browsing while visible content is translated first. Your exact English originals remain available.",
    translationPreparing: "Preparing the page",
    translationDownloading: "Downloading the private on-device language pack",
    translationLoadingModel: "Preparing the private local language model",
    translationRetrying: "Retrying the local translator",
    translationItems: "text items remaining",
    translationCompleted: "translated",
    translationEngineBrowser: "On-device browser engine",
    translationEngineLocal: "Private local server engine",
    translationRetry: "Retry translation",
    translationStop: "Show English now",
    translationFailureTitle: "Korean translation paused",
    translationFailureBody: "Some content could not be translated. Your English content is still safe and you can switch back immediately.",
    translationReturnEnglish: "Return to English",
    scanRunning: "Scan running",
  },
  ko: {
    primaryNavigation: "기본 탐색",
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
    guideEyebrow: "선택형 가이드",
    guideTitle: "Sense.ai 가이드 Scout",
    guideNote: "필요할 때만 화면별 도움말을 켜세요. 기본값은 꺼짐이며 작업을 방해하지 않습니다.",
    guideLaunch: "가이드 보기",
    guideEnabled: "가이드 켜짐",
    guideDisabled: "가이드 꺼짐",
    language: "언어",
    currentInterface: "현재 인터페이스",
    english: "영어",
    korean: "한국어",
    translating: "인터페이스 번역 중…",
    translationReady: "언어 변경은 현재 브라우저에만 적용됩니다.",
    translationError: "일부 동적 콘텐츠를 번역할 수 없습니다. 로컬 한국어 모델을 확인하세요.",
    translationConfirmEyebrow: "언어 변경",
    translationConfirmTitle: "TechScout를 한국어로 전환할까요?",
    translationConfirmBody: "인터페이스 레이블이 먼저 바뀌고, 불러온 기사는 순차적으로 번역됩니다.",
    translationConfirmLock: "지원되는 브라우저에서는 비공개 온디바이스 번역을 사용하고, 그렇지 않으면 로컬 서버 모델을 사용합니다. 언제든 영어로 돌아갈 수 있습니다.",
    translationCancel: "영어 유지",
    translationStart: "한국어 번역 시작",
    translationProgressTitle: "한국어 번역 진행 중",
    translationProgressBody: "계속 탐색해도 됩니다. 화면에 보이는 콘텐츠부터 번역하며 영어 원문은 그대로 보존됩니다.",
    translationPreparing: "페이지 준비 중",
    translationDownloading: "비공개 온디바이스 언어 팩 다운로드 중",
    translationLoadingModel: "비공개 로컬 언어 모델 준비 중",
    translationRetrying: "로컬 번역기 재시도 중",
    translationItems: "개 텍스트 항목 남음",
    translationCompleted: "개 번역 완료",
    translationEngineBrowser: "브라우저 온디바이스 엔진",
    translationEngineLocal: "비공개 로컬 서버 엔진",
    translationRetry: "번역 다시 시도",
    translationStop: "지금 영어로 보기",
    translationFailureTitle: "한국어 번역이 일시 중지되었습니다",
    translationFailureBody: "일부 콘텐츠를 번역할 수 없습니다. 영어 원문은 안전하게 유지되며 즉시 영어로 돌아갈 수 있습니다.",
    translationReturnEnglish: "영어로 돌아가기",
    scanRunning: "스캔 실행 중",
  },
};

function routeMatches(pathname, item) {
  const candidates = item.matches || [item.to];
  return candidates.some(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0]?.slice(0, 2) || "ME"
  ).toUpperCase();
}

function navLabel(item, language) {
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

function KoreanTranslationDialog({ open, ui, onCancel, onConfirm, returnFocusRef }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(onCancel);
  const startRef = useRef(null);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert");
    const previousRootAria = appRoot?.getAttribute("aria-hidden");
    document.documentElement.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
    startRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") cancelRef.current?.();
      if (event.key !== "Tab") return;
      const actions = dialogRef.current?.querySelectorAll("button") || [];
      if (!actions.length) return;
      const first = actions[0];
      const last = actions[actions.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      if (!rootWasInert) appRoot?.removeAttribute("inert");
      if (previousRootAria === null) appRoot?.removeAttribute("aria-hidden");
      else appRoot?.setAttribute("aria-hidden", previousRootAria);
      if (previous?.isConnected) previous.focus?.();
      else returnFocusRef?.current?.focus?.();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;
  return createPortal(
    <div className="translation-confirm-overlay" data-no-translate role="presentation">
      <section
        aria-describedby="translation-confirm-description"
        aria-labelledby="translation-confirm-title"
        aria-modal="true"
        className="translation-confirm-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <div className="translation-confirm-symbol" aria-hidden="true">
          <span>EN</span><Icon name="chevR" size={15} /><strong>한</strong>
        </div>
        <div className="translation-confirm-copy">
          <span>{ui.translationConfirmEyebrow}</span>
          <h2 id="translation-confirm-title">{ui.translationConfirmTitle}</h2>
          <p id="translation-confirm-description">{ui.translationConfirmBody}</p>
        </div>
        <div className="translation-confirm-note">
          <Icon name="clock" size={17} />
          <p>{ui.translationConfirmLock}</p>
        </div>
        <div className="translation-confirm-actions">
          <button className="translation-confirm-cancel" onClick={onCancel} type="button">
            {ui.translationCancel}
          </button>
          <button className="translation-confirm-start" onClick={onConfirm} ref={startRef} type="button">
            <Icon name="sparkle" size={16} />
            {ui.translationStart}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function TranslationProgressNotice({ state, ui, onReturnToEnglish }) {
  const pending = Number(state?.pending || 0);
  const completed = Number(state?.completed || 0);
  const total = Number(state?.total || 0);
  const engineLabel = state?.engine === "browser-native"
    ? ui.translationEngineBrowser
    : state?.engine === "local-marian"
      ? ui.translationEngineLocal
      : "";
  const phaseLabel = state?.phase === "downloading"
    ? `${ui.translationDownloading}${Number.isFinite(state?.downloadProgress) ? ` · ${state.downloadProgress}%` : ""}`
    : state?.phase === "loading-model"
      ? ui.translationLoadingModel
      : state?.phase === "retrying"
        ? ui.translationRetrying
        : pending > 0
          ? `${pending} ${ui.translationItems}`
          : ui.translationPreparing;
  return createPortal(
    <aside className="translation-progress-notice" data-no-translate>
      <span className="translation-progress-orbit" aria-hidden="true"><span /></span>
      <div aria-live="polite" role="status">
        <strong>{ui.translationProgressTitle}</strong>
        <p>{ui.translationProgressBody}</p>
        <small>
          {phaseLabel}
          {engineLabel ? ` · ${engineLabel}` : ""}
          {total > 0 ? ` · ${completed}/${total} ${ui.translationCompleted}` : ""}
        </small>
      </div>
      <button onClick={onReturnToEnglish} type="button">{ui.translationStop}</button>
    </aside>,
    document.body,
  );
}

function TranslationFailureNotice({ ui, onRetry, onReturnToEnglish }) {
  return createPortal(
    <aside aria-live="assertive" className="translation-failure-notice" data-no-translate role="alert">
      <span className="translation-failure-icon" aria-hidden="true">
        <Icon name="warning" size={17} />
      </span>
      <div>
        <strong>{ui.translationFailureTitle}</strong>
        <p>{ui.translationFailureBody}</p>
      </div>
      <div className="translation-failure-actions">
        <button onClick={onRetry} type="button">{ui.translationRetry}</button>
        <button onClick={onReturnToEnglish} type="button">{ui.translationReturnEnglish}</button>
      </div>
    </aside>,
    document.body,
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
  forYouEnabled = false,
  profileMode = "legacy",
  contributionAllowed = false,
  capabilities = null,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { enabled: guideEnabled, requestGuide, setEnabled: setGuideEnabled } = useGuidePet();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translationConfirmOpen, setTranslationConfirmOpen] = useState(false);
  const settingsControlRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const settingsDialogRef = useModalFocus(settingsOpen, () => setSettingsOpen(false));
  const [profile, setProfile] = useState(
    profileMode === "unified"
      ? "default"
      : localStorage.getItem("news-profile") || "default",
  );
  const ui = language === "ko" ? copy.ko : copy.en;
  const visibleMainNav = mainNav.filter((item) => !item.forYouOnly || forYouEnabled);

  useEffect(() => {
    if (profileMode === "unified") {
      localStorage.removeItem("news-profile-override");
      localStorage.removeItem("news-profile");
      setProfile("default");
      return undefined;
    }
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
    return undefined;
  }, [profileMode]);

  useEffect(() => {
    const onProfile = () => setProfile(
      profileMode === "unified"
        ? "default"
        : localStorage.getItem("news-profile") || "default",
    );
    window.addEventListener("news-profile-change", onProfile);
    window.addEventListener("storage", onProfile);
    return () => {
      window.removeEventListener("news-profile-change", onProfile);
      window.removeEventListener("storage", onProfile);
    };
  }, [profileMode]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const main = document.getElementById("news-main-content");
    const backgroundHeaderItems = [
      document.querySelector(".premium-header-identity"),
      document.querySelector(".premium-command-nav"),
      document.querySelector(".premium-theme-toggle"),
    ].filter(Boolean);
    const mainWasInert = main?.hasAttribute("inert");
    const previousMainAria = main?.getAttribute("aria-hidden");
    const previousHeaderState = backgroundHeaderItems.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    main?.setAttribute("inert", "");
    main?.setAttribute("aria-hidden", "true");
    backgroundHeaderItems.forEach((element) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    const onPointerDown = (event) => {
      if (settingsOpen && !settingsControlRef.current?.contains(event.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      if (!mainWasInert) main?.removeAttribute("inert");
      if (previousMainAria === null) main?.removeAttribute("aria-hidden");
      else main?.setAttribute("aria-hidden", previousMainAria);
      previousHeaderState.forEach(({ element, inert, ariaHidden }) => {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
    };
  }, [settingsOpen]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [pathname]);

  const isBroadcast = profileMode !== "unified" && profile === "broadcast";
  const capabilitySet = new Set(capabilities || []);
  const privilegedNav = protectedSettingsNav.filter((item) =>
    (item.any || []).some((capability) => capabilitySet.has(capability)),
  );
  const activeSettingsItem = [...baseSettingsNav, ...protectedSettingsNav].find(
    (item) => routeMatches(pathname, item),
  );
  const closeSettings = () => setSettingsOpen(false);
  const selectLanguage = (nextLanguage) => {
    if (nextLanguage === language) return;
    if (nextLanguage === "ko") {
      setSettingsOpen(false);
      setTranslationConfirmOpen(true);
      return;
    }
    onToggleLanguage?.();
  };
  const translationBusy = language === "ko" && (
    !translationState?.active
    || translationState?.translating
    || Number(translationState?.pending || 0) > 0
  );

  return (
    <header
      className={[
        "design-header premium-command-header fixed inset-x-0 top-0 z-40 w-full",
        isBroadcast ? "is-broadcast" : "is-default",
        `nav-style-${NEWS_SCRAPPER_NAV_STYLE}`,
      ].join(" ")}
      data-navigation-style={NEWS_SCRAPPER_NAV_STYLE}
      data-no-translate
    >
      <div className="command-header-inner premium-command-inner">
        <div className="header-identity premium-header-identity">
          <button
            aria-label={language === "ko" ? "브리핑 홈으로 이동" : "Go to briefing home"}
            className="news-wordmark premium-wordmark"
            onClick={() => navigate("/for-you")}
            type="button"
          >
            <span className="news-word">Samsung</span>
            <span className="scrapper-word">TechScout</span>
          </button>
        </div>

        <nav aria-label={ui.primaryNavigation} className="command-nav premium-command-nav">
          {visibleMainNav.map((item) => (
            <NavLink
              key={item.to}
              className={() => [
                "command-nav-link premium-command-link",
                routeMatches(pathname, item) ? "active" : "",
              ].join(" ")}
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

          {contributionAllowed && <NotificationBell />}

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
                aria-modal="true"
                className="command-settings-menu premium-settings-center"
                id="premium-settings-center"
                ref={settingsDialogRef}
                role="dialog"
                tabIndex={-1}
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
                    {visibleMainNav.map((item) => (
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
                      onClick={() => selectLanguage("en")}
                      type="button"
                    >
                      <span aria-hidden="true">EN</span>
                      {ui.english}
                    </button>
                    <button
                      aria-pressed={language === "ko"}
                      className={language === "ko" ? "active" : ""}
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

                <section className="premium-guide-panel" aria-labelledby="premium-guide-heading">
                  <span className="premium-guide-avatar" aria-hidden="true">
                    <Icon name="sparkle" size={18} />
                  </span>
                  <div className="premium-guide-copy">
                    <small>{ui.guideEyebrow}</small>
                    <strong id="premium-guide-heading">{ui.guideTitle}</strong>
                    <span>{ui.guideNote}</span>
                  </div>
                  <div className="premium-guide-controls">
                    <button
                      aria-checked={guideEnabled}
                      aria-label={guideEnabled ? ui.guideEnabled : ui.guideDisabled}
                      className={guideEnabled ? "premium-guide-switch is-on" : "premium-guide-switch"}
                      onClick={() => setGuideEnabled(!guideEnabled)}
                      role="switch"
                      type="button"
                    >
                      <span aria-hidden="true" />
                    </button>
                    <button
                      className="premium-guide-launch"
                      onClick={() => {
                        closeSettings();
                        requestGuide();
                      }}
                      type="button"
                    >
                      {ui.guideLaunch}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
      <KoreanTranslationDialog
        onCancel={() => setTranslationConfirmOpen(false)}
        onConfirm={() => {
          // Start browser-native model creation inside this user gesture. The
          // hook still owns fallback, progress, cleanup, and exact rollback.
          translationState?.prepareBrowser?.();
          setTranslationConfirmOpen(false);
          setSettingsOpen(false);
          onToggleLanguage?.();
        }}
        open={translationConfirmOpen}
        returnFocusRef={settingsTriggerRef}
        ui={ui}
      />
      {translationBusy && !translationState?.error && (
        <TranslationProgressNotice
          onReturnToEnglish={() => onToggleLanguage?.()}
          state={translationState}
          ui={ui}
        />
      )}
      {language === "ko" && translationState?.error && (
        <TranslationFailureNotice
          onRetry={() => translationState?.retry?.()}
          ui={ui}
          onReturnToEnglish={() => onToggleLanguage?.()}
        />
      )}
    </header>
  );
}
