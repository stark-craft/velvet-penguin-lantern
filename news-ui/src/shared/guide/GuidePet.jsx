import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useGuidePet } from "./GuidePetContext.jsx";

const GUIDE_VERSION = "2026.08-production";
const GUIDE_PROGRESS_KEY = "sense-guide-route-progress-v2";

function readCompletedRoutes() {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(GUIDE_PROGRESS_KEY) || "{}");
    return value?.version === GUIDE_VERSION && Array.isArray(value?.routes)
      ? new Set(value.routes.map(String))
      : new Set();
  } catch {
    return new Set();
  }
}

const NEWS_TOURS = {
  "/for-you": [
    {
      title: "Your intelligence, ranked",
      body: "This is your personal starting point. It learns from what you open, follow, like, dislike and dismiss without hiding the shared newsroom briefing.",
      selector: ".fy-preference-strip, .fy-executive",
    },
    {
      title: "Five-minute executive scan",
      body: "These five signals are the quickest route through the day. Each hook tells you what changed before you decide whether to open the dossier.",
      selector: ".fy-executive, .fy-section",
    },
    {
      title: "Useful, controlled surprises",
      body: "This lane deliberately keeps a small amount of unfamiliar intelligence in view so your feed does not become a filter bubble.",
      selector: ".fy-exploration, .fy-exploration-rail",
    },
    {
      title: "More when you need it",
      body: "Continue into the longer ranked feed only when you have time. Following a signal creates a private story thread for closely related updates.",
      selector: ".fy-section:last-of-type",
    },
  ],
  "/for-you/following": [
    {
      title: "Story threads you follow",
      body: "Each followed signal anchors a private thread. TechScout uses semantic similarity, topic overlap and recency to keep only genuinely related updates nearby.",
      selector: ".fy-following-page, .fy-following-thread",
    },
  ],
  "/for-you/create": [
    {
      title: "Create from your own material",
      body: "Turn article links into a private briefing. Authorized contributors can also prepare Samsung Internal stories and leadership messages here.",
      selector: ".fy-create-page, .fy-create-switcher",
    },
  ],
  "/for-you/create/contributions": [
    {
      title: "Contribute to Samsung Internal",
      body: "Write directly or import a supported document. Drafts remain private to your viewer identity until you submit them for editorial review.",
      selector: ".fy-create-page, .cw-workspace",
    },
  ],
  "/home": [
    {
      title: "The shared newsroom briefing",
      body: "This page is the common intelligence picture. The hero rotates through the strongest multi-source clusters rather than a separate feed for each person.",
      selector: ".hero-stage, .hero-layout, .top-intelligence-grid",
    },
    {
      title: "Latest-day signals",
      body: "This moving rail is the newest material from the latest completed scheduler run. Open any signal for its dossier and source trail.",
      selector: ".latest-day-stage, .latest-signals-section",
    },
    {
      title: "Search the loaded briefing",
      body: "These controls filter intelligence already stored by the platform. They never launch the crawler or send an open-web search.",
      selector: ".loaded-briefing-panel, .briefing-keyword-filter",
    },
  ],
  "/scan": [
    {
      title: "Search without crawling",
      body: "Scan searches intelligence already extracted by scheduled runs. Enter a query, then submit it explicitly; no internet crawler is started.",
      selector: ".scan-query-deck, .scan-command-center",
    },
    {
      title: "Narrow the evidence",
      body: "Use dates and Source scope to limit the archive. The source picker comes from your configured catalog and reports loading failures explicitly.",
      selector: ".scan-scope-grid, .scan-command-controls",
    },
    {
      title: "Keep working while it searches",
      body: "Your active search is preserved when you move to another tab in the app. Return here to review or select the results.",
      selector: ".scan-results-workspace, .scan-result-stage",
    },
  ],
  "/selected": [
    {
      title: "Shared review queue",
      body: "Signals submitted by newsroom users wait here for editorial review. Ownership and action safeguards prevent one user from silently removing another user’s work.",
      selector: ".review-page, .review-console",
    },
  ],
  "/approved": [
    {
      title: "Approved briefing",
      body: "This is the publication-ready collection. Export controls create the final briefing formats, while removal is confirmed before anything changes.",
      selector: ".approved-page, .approved-console",
    },
  ],
  "/history": [
    {
      title: "Thirty days of intelligence",
      body: "Browse previous scheduler runs, search across dates and select older signals for a new export. Large archives load progressively to keep the page fast.",
      selector: ".archive-v2-hero, .archive-v2-page",
    },
    {
      title: "Load only what you need",
      body: "The archive mounts a safe first group of cards. Use Show more to continue without freezing lower-powered Windows machines.",
      selector: ".archive-v2-results, .archive-v2-groups",
    },
  ],
  "/research": [
    {
      title: "Research Observatory",
      body: "Featured papers, repositories, models, datasets and patents are normalized into one evidence-first discovery surface.",
      selector: ".rio-observatory, .research-screen",
    },
    {
      title: "Open the evidence, not another news card",
      body: "The evidence stream and compact lanes lead into Venture Lens dossiers while preserving the same TechScout visual system.",
      selector: ".rio-stream, .rio-lanes",
    },
  ],
  "/samsung-internal": [
    {
      title: "Samsung Focus",
      body: "Leadership messages and the strongest Samsung signals share a fixed, stable carousel with complete readers where available.",
      selector: ".samsung-focus, .samsung-internal-focus",
    },
    {
      title: "Samsung Intelligence Wire",
      body: "Global, Local and Inside Samsung records advance in a shared motion system that pauses only when you choose.",
      selector: ".samsung-intelligence-wire, .continuous-signal-stream",
    },
  ],
  "/rejected": [
    {
      title: "Hidden signals",
      body: "This workspace separates your personal hidden cards from globally rejected intelligence. Restoring a global item also repairs the shared briefing safely.",
      selector: ".hidden-page, .hidden-hero",
    },
  ],
  "/sources": [
    {
      title: "Source control",
      body: "This is the crawler’s allowed catalog. Enabled sources can be RSS feeds or normal websites; validation protects the scheduler from malformed entries.",
      selector: ".source-control-page, .source-control-hero",
    },
  ],
  "/manage-sources": [
    {
      title: "Source control",
      body: "This is the crawler’s allowed catalog. Enabled sources can be RSS feeds or normal websites; validation protects the scheduler from malformed entries.",
      selector: ".source-control-page, .source-control-hero",
    },
  ],
  "/scheduler": [
    {
      title: "Scheduler health",
      body: "See the latest run, the next planned scan and pipeline status here. Manual refresh does not start a crawl, and overlapping status polls are prevented.",
      selector: ".scheduler-page, .scheduler-hero",
    },
  ],
  "/voc": [
    {
      title: "Voice of customer",
      body: "Send a compliment, complaint or idea directly to the product team. Submission status is explicit so feedback is never lost silently.",
      selector: ".voc-page, .voc-page-grid",
    },
  ],
  "/gatekeeper-review": [
    {
      title: "Gatekeeper review",
      body: "This protected workspace shows what the bouncer removed. Authorized reviewers can restore false positives and improve future filtering.",
      selector: ".gatekeeper-root, main",
    },
  ],
  "/director-analytics": [
    {
      title: "Private adoption analytics",
      body: "Authorized leaders can review usage, actions and feedback here. User identity is shown by display name while stored IP identifiers remain hashed.",
      selector: ".analytics-page, main",
    },
  ],
  "/trends": [
    {
      title: "Workspace preferences",
      body: "This page retains browser-level reviewer preferences. Most day-to-day navigation and identity controls now live in the Settings command center.",
      selector: ".profile-page",
    },
  ],
};

const VENTURE_TOURS = {
  Overview: [
    {
      title: "Sense.ai beyond the news",
      body: "Venture Lens connects live repositories, current research and implementation evidence. NewsScrapper watches events; Venture Lens helps evaluate what to build or investigate next.",
      selector: ".vl-overview-hero, .vl-hero",
    },
    {
      title: "A preview, not a crowded dashboard",
      body: "Hot signals show only a small live sample. Use the dedicated workspaces for the full repository, paper, radar and comparison views.",
      selector: ".vl-hot-section, .vl-hot-layout",
    },
  ],
  Radar: [
    {
      title: "Technology radar",
      body: "Radar combines adoption, research momentum and practical readiness into a decision posture: adopt, trial, assess or watch.",
      selector: ".vl-radar-layout",
    },
  ],
  Repositories: [
    {
      title: "Implementation evidence",
      body: "Repository signals use real stars, forks, activity and issue data. Filters and search are specific to this workspace and results load progressively.",
      selector: ".vl-page-repositories .vl-section-head, .vl-category-rail",
    },
    {
      title: "Open the dossier",
      body: "A dossier turns public metrics into strengths, risks and connected research. It is keyboard accessible and closes safely with Escape.",
      selector: ".vl-page-repositories .vl-repo-grid",
    },
  ],
  Research: [
    {
      title: "Research evidence",
      body: "Browse papers by technology lens, then open a dossier for the abstract, authors, connected repositories and implementation implications.",
      selector: ".vl-page-research .vl-section-head, .vl-page-research .vl-paper-grid",
    },
  ],
  Compare: [
    {
      title: "Compare like with like",
      body: "Comparison keeps repository and research evidence in their proper metric systems. Your working selection survives refresh within this browser tab.",
      selector: ".vl-compare-workbench, .vl-page-compare",
    },
  ],
  "Signal Graph": [
    {
      title: "Connected evidence",
      body: "The graph reveals which repositories, papers and technology lenses reinforce one another instead of treating every signal as an isolated item.",
      selector: ".vl-graph-stage, .vl-page-graph",
    },
  ],
  Watchlist: [
    {
      title: "Your Venture Lens watchlist",
      body: "Keep promising repositories and papers close without changing the shared intelligence corpus. Watchlist actions report success or failure explicitly.",
      selector: ".vl-watch-layout, .vl-page-watchlist",
    },
  ],
  Briefs: [
    {
      title: "Decision briefs",
      body: "Briefs compress connected evidence into a leadership-ready view of the opportunity, current proof and questions still needing validation.",
      selector: ".vl-brief-grid, .vl-page-briefs",
    },
  ],
};

const VENTURE_ROUTE_SECTIONS = {
  "/venturelens": "Overview",
  "/venturelens/radar": "Radar",
  "/venturelens/repositories": "Repositories",
  "/venturelens/research": "Research",
  "/venturelens/compare": "Compare",
  "/venturelens/graph": "Signal Graph",
  "/venturelens/watchlist": "Watchlist",
  "/venturelens/briefs": "Briefs",
};

function safeTarget(selector) {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function Scoutling({ talking }) {
  return (
    <svg className={talking ? "sense-scoutling is-talking" : "sense-scoutling"} viewBox="0 0 124 116" aria-hidden="true">
      <defs>
        <linearGradient id="scout-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9af7db" />
          <stop offset="1" stopColor="#6e8dff" />
        </linearGradient>
        <radialGradient id="scout-face" cx="50%" cy="35%" r="70%">
          <stop offset="0" stopColor="#172a3f" />
          <stop offset="1" stopColor="#09121f" />
        </radialGradient>
      </defs>
      <path className="sense-scout-antenna" d="M62 24V12m0 0 8-6m-8 6-8-6" fill="none" stroke="#baffec" strokeLinecap="round" strokeWidth="4" />
      <circle cx="62" cy="8" r="4" fill="#ffe08a" />
      <path className="sense-scout-arm sense-scout-arm-left" d="M31 70C20 68 14 61 9 52" fill="none" stroke="url(#scout-body)" strokeLinecap="round" strokeWidth="10" />
      <path className="sense-scout-arm sense-scout-arm-point" d="M93 70c12-5 18-13 22-23m0 0-1 10m1-10-9 5" fill="none" stroke="url(#scout-body)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="8" />
      <rect x="24" y="24" width="76" height="76" rx="34" fill="url(#scout-body)" />
      <rect x="30" y="31" width="64" height="55" rx="26" fill="url(#scout-face)" />
      <g className="sense-scout-eyes" fill="#dffff6">
        <ellipse cx="50" cy="56" rx="6" ry="8" />
        <ellipse cx="75" cy="56" rx="6" ry="8" />
      </g>
      <circle cx="52" cy="54" r="2" fill="#6e8dff" />
      <circle cx="77" cy="54" r="2" fill="#6e8dff" />
      <path className="sense-scout-mouth" d="M54 72c5 4 11 4 16 0" fill="none" stroke="#9af7db" strokeLinecap="round" strokeWidth="3" />
      <path d="M46 99v8m32-8v8" stroke="#85aaff" strokeLinecap="round" strokeWidth="7" />
    </svg>
  );
}

export default function GuidePet() {
  const { pathname } = useLocation();
  const { enabled, requestId, setEnabled } = useGuidePet();
  const [stepIndex, setStepIndex] = useState(0);
  const [quietRoute, setQuietRoute] = useState("");
  const [emerging, setEmerging] = useState(false);
  const [completedRoutes, setCompletedRoutes] = useState(readCompletedRoutes);
  const guideRootRef = useRef(null);
  const highlightRef = useRef(null);
  const pointerPathRef = useRef(null);
  const petRef = useRef(null);
  const targetFrameRef = useRef(0);
  const scrollSettleRef = useRef(0);
  const manualStepLockRef = useRef(0);
  const handledRequestRef = useRef(0);

  const isVenture = pathname === "/venturelens" || pathname.startsWith("/venturelens/");
  const ventureSection = VENTURE_ROUTE_SECTIONS[pathname] || "Overview";
  const routeKey = isVenture ? `venture:${ventureSection}` : pathname;
  const steps = useMemo(() => {
    if (isVenture) return VENTURE_TOURS[ventureSection] || VENTURE_TOURS.Overview;
    return NEWS_TOURS[pathname] || [{
      title: "Sense.ai guide",
      body: "I can explain the purpose of this workspace without interrupting your work. Move through the guide or turn me off from Settings at any time.",
      selector: "main",
    }];
  }, [isVenture, pathname, ventureSection]);

  const step = steps[Math.min(stepIndex, steps.length - 1)] || steps[0];
  const visible = enabled && quietRoute !== routeKey && !completedRoutes.has(routeKey);

  const persistCompletedRoutes = (next) => {
    setCompletedRoutes(next);
    try {
      window.localStorage.setItem(GUIDE_PROGRESS_KEY, JSON.stringify({
        version: GUIDE_VERSION,
        routes: [...next].sort(),
      }));
    } catch {
      // In-memory completion still prevents repeated interruptions.
    }
  };

  const completeRoute = () => {
    const next = new Set(completedRoutes);
    next.add(routeKey);
    persistCompletedRoutes(next);
    setQuietRoute(routeKey);
  };

  const reopenRoute = () => {
    const next = new Set(completedRoutes);
    next.delete(routeKey);
    persistCompletedRoutes(next);
    setQuietRoute("");
  };

  useLayoutEffect(() => {
    manualStepLockRef.current = 0;
    setStepIndex(0);
    setQuietRoute("");
    if (requestId > 0 && handledRequestRef.current !== requestId) {
      handledRequestRef.current = requestId;
      setCompletedRoutes((current) => {
        if (!current.has(routeKey)) return current;
        const next = new Set(current);
        next.delete(routeKey);
        try {
          window.localStorage.setItem(GUIDE_PROGRESS_KEY, JSON.stringify({ version: GUIDE_VERSION, routes: [...next].sort() }));
        } catch {
          // Keep the explicit request active for this visit.
        }
        return next;
      });
    }
  }, [requestId, routeKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    setEmerging(true);
    const timer = window.setTimeout(() => setEmerging(false), 1040);
    return () => window.clearTimeout(timer);
  }, [enabled, requestId, routeKey]);

  useEffect(() => {
    const root = guideRootRef.current;
    if (!visible || !step) {
      if (root) root.dataset.targetVisible = "false";
      return undefined;
    }

    let observedTarget = null;
    let mutationObserver = null;
    let resizeObserver = null;

    const measureTarget = () => {
      targetFrameRef.current = 0;
      if (!guideRootRef.current) return;
      const target = safeTarget(step.selector);
      if (!target) {
        guideRootRef.current.dataset.targetVisible = "false";
        return;
      }

      if (target !== observedTarget) {
        resizeObserver?.disconnect();
        observedTarget = target;
        resizeObserver?.observe(target);
        mutationObserver?.disconnect();
        mutationObserver = null;
      }

      const rect = target.getBoundingClientRect();
      const isOnScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      guideRootRef.current.dataset.targetVisible = String(isOnScreen);
      if (!isOnScreen) return;

      const left = Math.max(8, rect.left);
      const top = Math.max(8, rect.top);
      const width = Math.max(1, Math.min(rect.width, window.innerWidth - left - 8));
      const height = Math.max(1, Math.min(rect.height, window.innerHeight - top - 8));
      const centerX = Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2));
      const centerY = Math.max(16, Math.min(window.innerHeight - 16, rect.top + Math.min(rect.height / 2, 180)));

      const highlight = highlightRef.current;
      if (highlight) {
        highlight.style.width = `${width}px`;
        highlight.style.height = `${height}px`;
        highlight.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      }

      const petRect = petRef.current?.getBoundingClientRect();
      const startX = petRect ? petRect.left + petRect.width * 0.28 : window.innerWidth - 72;
      const startY = petRect ? petRect.top + petRect.height * 0.38 : window.innerHeight - 104;
      const horizontalReach = Math.max(80, Math.abs(startX - centerX) * 0.34);
      const controlX = startX - horizontalReach;
      const controlY = startY + (centerY - startY) * 0.24;
      pointerPathRef.current?.setAttribute(
        "d",
        `M ${startX} ${startY} Q ${controlX} ${controlY} ${centerX} ${centerY}`,
      );
    };

    const scheduleTargetMeasure = () => {
      if (targetFrameRef.current) return;
      targetFrameRef.current = window.requestAnimationFrame(measureTarget);
    };

    const handleScroll = () => {
      const currentRoot = guideRootRef.current;
      if (currentRoot) currentRoot.dataset.tracking = "true";
      scheduleTargetMeasure();
      window.clearTimeout(scrollSettleRef.current);
      scrollSettleRef.current = window.setTimeout(() => {
        if (guideRootRef.current) guideRootRef.current.dataset.tracking = "false";
        scheduleTargetMeasure();
      }, 120);
    };

    resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(scheduleTargetMeasure)
      : null;

    if (!safeTarget(step.selector) && typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(scheduleTargetMeasure);
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    scheduleTargetMeasure();
    const entranceMeasureTimer = window.setTimeout(scheduleTargetMeasure, 1060);
    window.addEventListener("resize", scheduleTargetMeasure);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", scheduleTargetMeasure);
      window.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(entranceMeasureTimer);
      window.clearTimeout(scrollSettleRef.current);
      if (targetFrameRef.current) window.cancelAnimationFrame(targetFrameRef.current);
      targetFrameRef.current = 0;
    };
  }, [step, visible]);

  useEffect(() => {
    if (!visible || steps.length < 2) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const targets = steps.map((item) => safeTarget(item.selector));
    const observer = new IntersectionObserver((entries) => {
      if (Date.now() < manualStepLockRef.current) return;
      const strongest = entries
        .filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.42)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!strongest) return;
      const next = targets.indexOf(strongest.target);
      if (next >= 0) setStepIndex(next);
    }, { threshold: [0.42, 0.65] });
    targets.filter(Boolean).forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [routeKey, steps, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") completeRoute();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [routeKey, visible]);

  if (!enabled) return null;

  const revealStep = (nextIndex) => {
    const target = safeTarget(steps[nextIndex]?.selector);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    manualStepLockRef.current = Date.now() + (reduceMotion ? 120 : 900);
    setStepIndex(nextIndex);
    target?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  };

  const advance = () => {
    if (stepIndex >= steps.length - 1) {
      completeRoute();
      return;
    }
    revealStep(stepIndex + 1);
  };

  const retreat = () => {
    revealStep((stepIndex - 1 + steps.length) % steps.length);
  };

  const guide = (
    <div
      ref={guideRootRef}
      className={emerging ? "sense-guide-root is-emerging" : "sense-guide-root"}
      data-guide-route={routeKey}
      data-target-visible="false"
      data-tracking="false"
    >
      {visible && (
        <>
          <div ref={highlightRef} className="sense-guide-highlight" aria-hidden="true" />
          <svg className="sense-guide-pointer" aria-hidden="true">
            <defs>
              <linearGradient id="sense-guide-pointer-gradient" x1="0" x2="1">
                <stop offset="0" stopColor="#7897ff" stopOpacity=".18" />
                <stop offset="1" stopColor="#91f4d5" stopOpacity=".72" />
              </linearGradient>
            </defs>
            <path ref={pointerPathRef} vectorEffect="non-scaling-stroke" />
          </svg>
        </>
      )}
      <div className="sense-guide-hole" aria-hidden="true" />
      <button
        ref={petRef}
        className="sense-guide-pet"
        type="button"
        aria-label={visible ? "Hide Scout guide on this page" : "Open Scout guide"}
        aria-expanded={visible}
        onClick={() => visible ? completeRoute() : reopenRoute()}
      >
        <Scoutling talking={visible} />
      </button>
      {visible && (
        <aside className="sense-guide-bubble" aria-label="Scout guide" aria-live="polite">
          <div className="sense-guide-bubble-head">
            <span>SCOUT · {stepIndex + 1}/{steps.length}</span>
            <button type="button" onClick={completeRoute} aria-label="Complete Scout guide on this page">×</button>
          </div>
          <div className="sense-guide-copy" key={`${routeKey}:${stepIndex}`}>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </div>
          <div className="sense-guide-actions">
            {steps.length > 1 && <button type="button" onClick={retreat}>Back</button>}
            <button className="is-primary" type="button" onClick={advance}>{stepIndex >= steps.length - 1 ? "Done" : "Next"}</button>
            <button type="button" onClick={() => setEnabled(false)}>Turn off</button>
          </div>
        </aside>
      )}
    </div>
  );

  return createPortal(guide, document.body);
}
