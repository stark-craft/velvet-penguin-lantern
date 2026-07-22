import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import DesignViewport from "./components/DesignViewport.jsx";
import VocFeedback from "./components/VocFeedback.jsx";
import { useTracking } from "./utils/tracking.js";
import { searchExtractedIntelligence } from "./api.js";
import { normalizeList } from "./utils/normalize.js";
import { trackAction } from "./utils/tracking.js";
import FeedScreen from "./screens/FeedScreen.jsx";
import ScanScreen from "./screens/ScanScreen.jsx";
import SelectedScreen from "./screens/SelectedScreen.jsx";
import ApprovedScreen from "./screens/ApprovedScreen.jsx";
import RejectedScreen from "./screens/RejectedScreen.jsx";
import SourcesScreen from "./screens/SourcesScreen.jsx";
import SchedulerScreen from "./screens/SchedulerScreen.jsx";
import HistoryScreen from "./screens/HistoryScreen.jsx";
import TrendsScreen from "./screens/TrendsScreen.jsx";
import VocScreen from "./screens/VocScreen.jsx";
import AnalyticsScreen from "./screens/AnalyticsScreen.jsx";
import GatekeeperReviewScreen from "./screens/GatekeeperReviewScreen.jsx";
const SENSE_ATMOSPHERE_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4";
const THEME_STORAGE_KEY = "news-theme";

function readStoredTheme() {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
    ? "light"
    : "dark";
}

function ProductAtmosphere({ live }) {
  return (
    <div
      className={live ? "product-atmosphere is-live" : "product-atmosphere"}
      aria-hidden="true"
    >
      {" "}
      {live && (
        <video
          className="product-atmosphere-video"
          muted
          playsInline
          autoPlay
          loop
        >
          {" "}
          <source src={SENSE_ATMOSPHERE_VIDEO} type="video/mp4" />{" "}
        </video>
      )}{" "}
      <div className="product-atmosphere-material" />{" "}
    </div>
  );
}
export default function App() {
  const { pathname } = useLocation();
  useTracking(pathname);
  const manualAbortRef = useRef(null);
  const [theme, setTheme] = useState(readStoredTheme);
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

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
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
    if (!keywords || manualScan.running) return;
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
  return (
    <DesignViewport>
      {" "}
      <div className="app-shell min-h-screen text-slate-100" data-theme={theme}>
        {" "}
        <ProductAtmosphere live={pathname === "/home"} />{" "}
        <TopBar
          manualScan={manualScan}
          theme={theme}
          onToggleTheme={toggleTheme}
        />{" "}
        <main className="design-main mx-auto w-full">
          {" "}
          <Routes>
            {" "}
            <Route path="/" element={<Navigate to="/home" replace />} />{" "}
            <Route path="/home" element={<FeedScreen />} />{" "}
            <Route
              path="/scan"
              element={
                <ScanScreen
                  manualScan={manualScan}
                  setManualScan={patchManualScan}
                  startManualScan={startManualScan}
                  stopManualScan={stopManualScan}
                />
              }
            />{" "}
            <Route path="/selected" element={<SelectedScreen />} />{" "}
            <Route path="/approved" element={<ApprovedScreen />} />{" "}
            <Route path="/rejected" element={<RejectedScreen />} />{" "}
            <Route path="/sources" element={<SourcesScreen />} />{" "}
            <Route path="/manage-sources" element={<SourcesScreen />} />{" "}
            <Route path="/scheduler" element={<SchedulerScreen />} />{" "}
            <Route path="/history" element={<HistoryScreen />} />{" "}
            <Route path="/trends" element={<TrendsScreen />} />{" "}
            <Route path="/voc" element={<VocScreen />} />{" "}
            <Route path="/director-analytics" element={<AnalyticsScreen />} />{" "}
            <Route
              path="/gatekeeper-review"
              element={<GatekeeperReviewScreen />}
            />{" "}
          </Routes>{" "}
        </main>{" "}
        <VocFeedback />{" "}
      </div>{" "}
    </DesignViewport>
  );
}
