import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import DesignViewport from "./components/DesignViewport.jsx";
import VocFeedback from "./components/VocFeedback.jsx";
import { useTracking } from "./utils/tracking.js";
import { streamCrawl } from "./api.js";
import { normalizeArticle, normalizeList } from "./utils/normalize.js";
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
  const manualCloseRef = useRef(null);
  const [theme, setTheme] = useState(readStoredTheme);
  const [manualScan, setManualScan] = useState({
    query: "Samsung OLED AI",
    from: "",
    to: "",
    pickedSites: [],
    running: false,
    started: false,
    status: "Ready for investigation.",
    cards: [],
    checked: {},
    logs: [],
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
    if (manualCloseRef.current) manualCloseRef.current();
    manualCloseRef.current = null;
    patchManualScan({ running: false, status: "Search stopped." });
    appendManualLog("Search stopped by user.", "warning");
  };
  const startManualScan = ({ query, from, to, pickedSites }) => {
    const keywords = query.trim();
    if (!keywords || manualScan.running) return;
    if (manualCloseRef.current) manualCloseRef.current();
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
      status:
        "Running Intelligence Scan · Crawling selected sources · Filtering articles · Clustering stories",
      logs: [makeLog(`Search started for "${keywords}".`, "command")],
    }));
    trackAction("search", {
      query: keywords,
      from_date: from || "",
      to_date: to || "",
      target_sites: pickedSites.join(", "),
      screen: "scan",
    });
    manualCloseRef.current = streamCrawl(
      {
        keywords,
        from_date: from || undefined,
        to_date: to || undefined,
        target_sites: pickedSites.length ? pickedSites.join(",") : undefined,
      },
      ({ type, data }) => {
        const eventType = type === "message" && data?.type ? data.type : type;
        if (eventType === "job_started") {
          appendManualLog(
            `Crawler job connected${data?.job_id ? ` · ${data.job_id}` : ""}.`,
            "active",
          );
        } else if (eventType === "status") {
          const message =
            typeof data === "string" ? data : data?.message || "Scanning...";
          patchManualScan({ status: message });
          appendManualLog(message, "active");
        } else if (eventType === "card") {
          const raw = data?.card || data?.event || data;
          setManualScan((current) => {
            const card = normalizeArticle(raw, current.cards.length);
            if (!card) return current;
            const log = makeLog(
              `Signal surfaced: ${card.title.slice(0, 68)}${card.title.length > 68 ? "..." : ""}`,
              "signal",
            );
            return {
              ...current,
              cards: [...current.cards, card],
              logs: [...(current.logs || []), log].slice(-30),
            };
          });
        } else if (eventType === "data") {
          const arr = Array.isArray(data)
            ? data
            : data?.result ||
              data?.results ||
              data?.articles ||
              data?.events ||
              [];
          const list = normalizeList(arr);
          setManualScan((current) => ({
            ...current,
            cards: list.length ? list : current.cards,
            status: `Search complete · ${list.length || current.cards.length} results clustered`,
            running: false,
            logs: [
              ...(current.logs || []),
              makeLog(
                `Search complete · ${list.length || current.cards.length} results clustered.`,
                "complete",
              ),
            ].slice(-30),
          }));
          if (manualCloseRef.current) {
            manualCloseRef.current();
            manualCloseRef.current = null;
          }
        } else if (eventType === "error") {
          const message =
            data?.error || data?.message || "Search connection interrupted.";
          patchManualScan((current) => ({
            status: message,
            running: false,
            logs: [...(current.logs || []), makeLog(message, "error")].slice(
              -30,
            ),
          }));
          if (manualCloseRef.current) {
            manualCloseRef.current();
            manualCloseRef.current = null;
          }
        }
      },
    );
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
