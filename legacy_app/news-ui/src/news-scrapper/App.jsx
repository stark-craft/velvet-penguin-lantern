import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import DesignViewport from "./components/DesignViewport.jsx";
import { useTracking } from "./utils/tracking.js";
import { searchExtractedIntelligence } from "./api.js";
import { normalizeList } from "./utils/normalize.js";
import { trackAction } from "./utils/tracking.js";
import ForYouWorkspaceScreen from "./for-you/ForYouWorkspaceScreen.jsx";
import UserProfileModal from "./components/UserProfileModal.jsx";
import Icon from "./components/Icon.jsx";
import { getAccessCapabilities, getRecommendationStatus, getViewerProfile } from "./api.js";
import { useLanguage } from "./translation/LanguageProvider.jsx";
import "./styles/personalization.css";
const SENSE_ATMOSPHERE_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4";
const THEME_STORAGE_KEY = "news-theme";
const PROFILE_SWITCHER_ENABLED = import.meta.env.DEV
  && String(import.meta.env.VITE_ENABLE_PROFILE_SWITCHER || "").toLowerCase() === "true";

const FeedScreen = lazy(() => import("./screens/FeedScreen.jsx"));
const ScanScreen = lazy(() => import("./screens/ScanScreen.jsx"));
const SelectedScreen = lazy(() => import("./screens/SelectedScreen.jsx"));
const ApprovedScreen = lazy(() => import("./screens/ApprovedScreen.jsx"));
const RejectedScreen = lazy(() => import("./screens/RejectedScreen.jsx"));
const SourcesScreen = lazy(() => import("./screens/SourcesScreen.jsx"));
const SchedulerScreen = lazy(() => import("./screens/SchedulerScreen.jsx"));
const HistoryScreen = lazy(() => import("./screens/HistoryScreen.jsx"));
const TrendsScreen = lazy(() => import("./screens/TrendsScreen.jsx"));
const VocScreen = lazy(() => import("./screens/VocScreen.jsx"));
const AnalyticsScreen = lazy(() => import("./screens/AnalyticsScreen.jsx"));
const GatekeeperReviewScreen = lazy(() => import("./screens/GatekeeperCapabilityScreen.jsx"));
const ResearchScreen = lazy(() => import("./screens/ResearchScreen.jsx"));
const SamsungInternalScreen = lazy(() => import("./screens/SamsungInternalScreen.jsx"));
const SamsungInternalReaderScreen = lazy(() => import("./screens/SamsungInternalReaderScreen.jsx"));
const InternalPublishingScreen = lazy(() => import("./screens/InternalPublishingScreen.jsx"));
const AccessManagementScreen = lazy(() => import("./screens/AccessManagementScreen.jsx"));
const VentureLensApp = lazy(() => import("../venture-lens/VentureLensApp.jsx"));

function readStoredTheme() {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
    ? "light"
    : "dark";
}

function readStoredProfile() {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem("news-profile") === "broadcast"
    ? "broadcast"
    : "default";
}

function ProductAtmosphere({ live }) {
  const videoRef = useRef(null);
  const [shouldPlay, setShouldPlay] = useState(false);
  useEffect(() => {
    if (!live || typeof window === "undefined") {
      setShouldPlay(false);
      return undefined;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const saveData = Boolean(navigator.connection?.saveData);
    if (reduced || saveData) {
      setShouldPlay(false);
      return undefined;
    }
    const sync = () => setShouldPlay(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [live]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlay) video.play().catch(() => {}); else video.pause();
  }, [shouldPlay]);
  return (
    <div
      className={live ? "product-atmosphere is-live" : "product-atmosphere"}
      aria-hidden="true"
    >
      {" "}
      {live && shouldPlay && (
        <video
          className="product-atmosphere-video"
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          ref={videoRef}
        >
          {" "}
          <source src={SENSE_ATMOSPHERE_VIDEO} type="video/mp4" />{" "}
        </video>
      )}{" "}
      <div className="product-atmosphere-material" />{" "}
    </div>
  );
}

function LegacySavedRedirect() {
  const { pathname } = useLocation();
  const target = pathname === "/saved/contribute"
    ? "/for-you/create/contributions"
    : pathname === "/saved/leadership"
      ? "/for-you/create/contributions/leadership"
      : pathname === "/saved/briefings"
        ? "/for-you/create"
        : "/for-you/following";
  return <Navigate to={target} replace />;
}

function ContributionOnly({ access, children }) {
  if (access === null) {
    return <div className="fy-state"><span className="fy-loader" /><p>Checking private publishing access…</p></div>;
  }
  return access?.allowed ? children : <Navigate to="/for-you" replace />;
}

function RouteLoading() {
  return <div className="fy-state" role="status"><span className="fy-loader" /><p>Opening workspace…</p></div>;
}

function CapabilityOnly({ capabilities, any = [], all = [], children }) {
  if (capabilities === null) return <RouteLoading />;
  const values = new Set(capabilities);
  const allowed = (any.length === 0 || any.some((capability) => values.has(capability)))
    && all.every((capability) => values.has(capability));
  if (allowed) return children;
  return (
    <section className="workflow-empty restricted-workspace" role="status">
      <Icon name="shield" size={26} />
      <h2>You don’t have access to this workspace.</h2>
      <p>Your briefing and personal workspaces are unchanged. Ask an access administrator if this tool is part of your role.</p>
    </section>
  );
}

export default function App() {
  const { pathname } = useLocation();
  useTracking(pathname);
  const manualAbortRef = useRef(null);
  const mainRef = useRef(null);
  const previousPathRef = useRef(pathname);
  const [theme, setTheme] = useState(readStoredTheme);
  const { language, toggleLanguage, translationState } = useLanguage();
  const [activeProfile, setActiveProfile] = useState("default");
  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [viewerError, setViewerError] = useState("");
  const [viewerLoadAttempt, setViewerLoadAttempt] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileRequired, setProfileRequired] = useState(false);
  const [viewerRevision, setViewerRevision] = useState(0);
  const [recommendationStatus, setRecommendationStatus] = useState(null);
  const [capabilityState, setCapabilityState] = useState(null);
  const [manualScan, setManualScan] = useState({
    query: "",
    from: "",
    to: "",
    pickedSites: [],
    running: false,
    started: false,
    status: "Ready for investigation.",
    cards: [],
    checked: {},
    logs: [],
    archiveFiles: 0,
    articlesSearched: 0,
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const unified = recommendationStatus?.profile_mode !== "legacy";
    if (unified) {
      localStorage.removeItem("news-profile-override");
      localStorage.removeItem("news-profile");
      setActiveProfile("default");
      document.documentElement.dataset.profile = "default";
      return undefined;
    }
    const syncProfile = (event) => {
      const nextProfile =
        event?.detail === "broadcast" || readStoredProfile() === "broadcast"
          ? "broadcast"
          : "default";
      setActiveProfile(nextProfile);
      document.documentElement.dataset.profile = nextProfile;
    };

    syncProfile();
    window.addEventListener("news-profile-change", syncProfile);
    window.addEventListener("storage", syncProfile);
    return () => {
      window.removeEventListener("news-profile-change", syncProfile);
      window.removeEventListener("storage", syncProfile);
    };
  }, [recommendationStatus?.profile_mode]);

  useEffect(() => {
    let cancelled = false;
    getRecommendationStatus()
      .then((result) => { if (!cancelled) setRecommendationStatus(result); })
      .catch(() => {
        // A transient status request must not silently demote the new default
        // experience for the remainder of this page load. For You has its own
        // visible retry/error state if the underlying feed is unavailable.
        if (!cancelled) setRecommendationStatus({
          enabled: true,
          default_landing: true,
          profile_mode: "unified",
          legacy_profile_routing: false,
        });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAccessCapabilities()
      .then((result) => {
        if (!cancelled) setCapabilityState({
          capabilities: Array.isArray(result?.capabilities) ? result.capabilities : [],
          principal: result?.principal || "",
        });
      })
      .catch((error) => {
        console.warn("[Access] Capability check failed closed:", error);
        if (!cancelled) setCapabilityState({ capabilities: [], principal: "" });
      });
    return () => { cancelled = true; };
  }, []);

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  useEffect(() => {
    let cancelled = false;
    setViewerLoading(true);
    setViewerError("");
    getViewerProfile()
      .then((profile) => {
        if (cancelled) return;
        setViewer(profile);
        const displayName = String(profile?.display_name || "").trim();
        if (displayName) {
          localStorage.setItem("news-viewer-name", displayName);
          localStorage.setItem("initiator-name", displayName);
          if (profile?.email) {
            localStorage.setItem("news-viewer-email", profile.email);
          }
        } else {
          setProfileRequired(true);
          setProfileOpen(true);
        }
      })
      .catch((error) => {
        console.warn("[Viewer] Could not load the viewer profile:", error);
        if (!cancelled) {
          setViewerError("Your profile could not be loaded. Your briefing is still available.");
        }
      })
      .finally(() => {
        if (!cancelled) setViewerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewerLoadAttempt]);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    mainRef.current?.focus?.({ preventScroll: true });
  }, [pathname]);

  const restoreSettingsFocus = () => {
    window.requestAnimationFrame(() => {
      document.querySelector('[aria-controls="premium-settings-center"]')?.focus?.();
    });
  };

  const handleViewerSaved = (profile) => {
    setViewer((current) => ({ ...current, ...profile }));
    setProfileRequired(false);
    setProfileOpen(false);
    setViewerRevision((current) => current + 1);
    window.dispatchEvent(
      new CustomEvent("news-viewer-change", { detail: profile }),
    );
  };

  useEffect(() => {
    const hasUnsavedScanState =
      manualScan.running || manualScan.cards.length > 0;
    if (!hasUnsavedScanState) return undefined;
    const warnBeforeRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeRefresh);
    return () => window.removeEventListener("beforeunload", warnBeforeRefresh);
  }, [manualScan.running, manualScan.cards.length]);
  const patchManualScan = (patch) =>
    setManualScan((current) => ({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    }));
  const makeLog = (message, level = "status") => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    message,
    level,
  });
  const appendManualLog = (message, level = "status") => {
    if (!message) return;
    patchManualScan((current) => {
      const logs = current.logs || [];
      if (logs[logs.length - 1]?.message === message) return { logs };
      return { logs: [...logs, makeLog(message, level)].slice(-30) };
    });
  };
  const stopManualScan = () => {
    if (manualAbortRef.current) manualAbortRef.current.abort();
    manualAbortRef.current = null;
    patchManualScan({ running: false, status: "Search stopped." });
    appendManualLog("Search stopped by user.", "warning");
  };
  const startManualScan = async ({ query, from, to, pickedSites }) => {
    const keywords = query.trim();
    if (!keywords) return;
    if (manualAbortRef.current) manualAbortRef.current.abort();
    const controller = new AbortController();
    manualAbortRef.current = controller;
    setManualScan((current) => ({
      ...current,
      query,
      from,
      to,
      pickedSites,
      running: true,
      started: true,
      cards: [],
      checked: {},
      archiveFiles: 0,
      articlesSearched: 0,
      status: "Searching extracted intelligence archives...",
      logs: [makeLog(`Local archive search started for "${keywords}".`, "command")],
    }));
    trackAction("search", {
      query: keywords,
      from_date: from || "",
      to_date: to || "",
      target_sites: pickedSites.join(", "),
      screen: "scan",
    });
    try {
      const data = await searchExtractedIntelligence(
        {
          query: keywords,
          from_date: from || undefined,
          to_date: to || undefined,
          target_sites: pickedSites.length ? pickedSites.join(",") : undefined,
          limit: 250,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const list = normalizeList(data?.results || []);
      const archiveFiles = Number(data?.archive_files_searched || 0);
      const articlesSearched = Number(data?.articles_searched || 0);
      const summary = `Search complete · ${list.length} matches from ${articlesSearched} stored articles`;
      setManualScan((current) => ({
        ...current,
        cards: list,
        status: summary,
        running: false,
        archiveFiles,
        articlesSearched,
        logs: [
          ...(current.logs || []),
          makeLog(
            `Checked ${archiveFiles} extracted files and ${articlesSearched} stored articles.`,
            "active",
          ),
          makeLog(`${list.length} matching signals returned. No crawler was launched.`, "complete"),
        ].slice(-30),
      }));
    } catch (error) {
      if (error?.name === "AbortError") return;
      const message = error?.message || "Archive search failed.";
      patchManualScan((current) => ({
        status: message,
        running: false,
        logs: [...(current.logs || []), makeLog(message, "error")].slice(-30),
      }));
    } finally {
      if (manualAbortRef.current === controller) manualAbortRef.current = null;
    }
  };
  const defaultLanding = recommendationStatus?.enabled && recommendationStatus?.default_landing
    ? "/for-you"
    : "/home";
  const capabilities = capabilityState?.capabilities ?? null;
  const hasCapability = (capability) => Boolean(capabilities?.includes(capability));
  const contributionAccess = capabilities === null
    ? null
    : { allowed: hasCapability("contributions.create"), ip: "" };
  return (
    <DesignViewport>
      {" "}
      <div
        className="app-shell min-h-screen text-slate-100"
        data-profile={activeProfile}
        data-theme={theme}
      >
        {" "}
        <a className="news-skip-link" href="#news-main-content">
          Skip to main content
        </a>{" "}
        <ProductAtmosphere live={pathname === "/home" || pathname.startsWith("/for-you")} />{" "}
        <TopBar
          manualScan={manualScan}
          theme={theme}
          onToggleTheme={toggleTheme}
          language={language}
          onToggleLanguage={toggleLanguage}
          translationState={translationState}
          viewer={viewer}
          viewerLoading={viewerLoading}
          onEditProfile={() => {
            setProfileRequired(false);
            setProfileOpen(true);
          }}
          forYouEnabled={Boolean(recommendationStatus?.enabled)}
          profileMode={recommendationStatus?.profile_mode || "unified"}
          contributionAllowed={Boolean(contributionAccess?.allowed)}
          capabilities={capabilities}
        />{" "}
        <main
          className="design-main mx-auto w-full"
          id="news-main-content"
          ref={mainRef}
          tabIndex={-1}
        >
          {" "}
          <Suspense fallback={<RouteLoading />}><Routes key={viewerRevision}>
            {" "}
            <Route path="/" element={recommendationStatus === null
              ? <div className="fy-state"><span className="fy-loader" /><p>Preparing TechScout…</p></div>
              : <Navigate to={defaultLanding} replace />} />{" "}
            <Route
              path="/for-you/*"
              element={<ForYouWorkspaceScreen contributionAccess={contributionAccess} viewer={viewer} />}
            />{" "}
            <Route path="/home" element={<FeedScreen capabilities={capabilities || []} />} />{" "}
            <Route
              path="/scan"
              element={
                <ScanScreen
                  manualScan={manualScan}
                  setManualScan={patchManualScan}
                  startManualScan={startManualScan}
                  stopManualScan={stopManualScan}
                  capabilities={capabilities || []}
                />
              }
            />{" "}
            <Route path="/selected" element={<CapabilityOnly capabilities={capabilities} any={["review.news.view", "review.contributions.view"]}><SelectedScreen capabilities={capabilities || []} /></CapabilityOnly>} />{" "}
            <Route path="/approved" element={<CapabilityOnly capabilities={capabilities} any={["approved.view", "review.news.approve"]}><ApprovedScreen /></CapabilityOnly>} />{" "}
            <Route path="/saved/*" element={<LegacySavedRedirect />} />{" "}
            <Route path="/research" element={<ResearchScreen />} />{" "}
            <Route path="/samsung-internal" element={<SamsungInternalScreen canManageAnnouncements={hasCapability("review.contributions.publish")} contributionAllowed={Boolean(contributionAccess?.allowed)} />} />{" "}
            <Route path="/samsung-internal/leadership/:id" element={<SamsungInternalReaderScreen kind="leadership" />} />{" "}
            <Route path="/samsung-internal/announcement/:id" element={<SamsungInternalReaderScreen kind="announcement" />} />{" "}
            <Route path="/samsung-internal/story/:id" element={<SamsungInternalReaderScreen kind="story" />} />{" "}
            <Route
              path="/internal-publishing"
              element={<ContributionOnly access={contributionAccess}><InternalPublishingScreen /></ContributionOnly>}
            />{" "}
            <Route path="/venturelens/*" element={<VentureLensApp />} />{" "}
            <Route path="/rejected" element={<RejectedScreen />} />{" "}
            <Route path="/sources" element={<CapabilityOnly capabilities={capabilities} any={["sources.view", "sources.manage"]}><SourcesScreen canManage={hasCapability("sources.manage")} /></CapabilityOnly>} />{" "}
            <Route path="/manage-sources" element={<Navigate to="/sources" replace />} />{" "}
            <Route path="/scheduler" element={<CapabilityOnly capabilities={capabilities} any={["scheduler.view", "scheduler.control"]}><SchedulerScreen canControl={hasCapability("scheduler.control")} /></CapabilityOnly>} />{" "}
            <Route path="/history" element={<HistoryScreen reviewAllowed={hasCapability("review.news.submit")} />} />{" "}
            {PROFILE_SWITCHER_ENABLED && <Route path="/trends" element={<TrendsScreen />} />}{" "}
            <Route path="/voc" element={<VocScreen />} />{" "}
            <Route path="/director-analytics" element={<CapabilityOnly capabilities={capabilities} any={["analytics.view"]}><AnalyticsScreen /></CapabilityOnly>} />{" "}
            <Route
              path="/gatekeeper-review"
              element={<CapabilityOnly capabilities={capabilities} any={["gatekeeper.review"]}><GatekeeperReviewScreen /></CapabilityOnly>}
            />{" "}
            <Route path="/access-management" element={<CapabilityOnly capabilities={capabilities} any={["access.manage"]}><AccessManagementScreen /></CapabilityOnly>} />{" "}
            <Route path="*" element={recommendationStatus === null
              ? <div className="fy-state"><span className="fy-loader" /><p>Preparing TechScout…</p></div>
              : <Navigate to={defaultLanding} replace />} />{" "}
          </Routes></Suspense>{" "}
        </main>{" "}
        {viewerError && (
          <aside className="shell-service-notice" role="alert">
            <span aria-hidden="true"><Icon name="warning" size={17} /></span>
            <div>
              <strong>Profile temporarily unavailable</strong>
              <p>{viewerError}</p>
            </div>
            <button onClick={() => setViewerLoadAttempt((current) => current + 1)} type="button">
              Try again
            </button>
          </aside>
        )}{" "}
        <UserProfileModal
          open={profileOpen}
          firstVisit={profileRequired}
          viewer={viewer}
          onClose={() => {
            if (!profileRequired) {
              setProfileOpen(false);
              restoreSettingsFocus();
            }
          }}
          onSaved={handleViewerSaved}
        />{" "}
      </div>{" "}
    </DesignViewport>
  );
}
