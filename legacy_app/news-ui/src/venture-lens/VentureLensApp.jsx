import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Bookmark,
  CheckCircle2,
  Code2,
  GitCompareArrows,
  GitFork,
  Home,
  Languages,
  Network,
  Newspaper,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useLanguage } from "../news-scrapper/translation/LanguageProvider.jsx";
import { useGuidePet } from "../shared/guide/GuidePetContext.jsx";
import {
  compareVentureSignals,
  getPaperDossier,
  getRepositoryDossier,
  getTechnologyDossier,
  getVentureIntelligence,
  getVentureOverview,
  markVentureNotificationsRead,
  refreshVentureLens,
  toggleVentureWatchlist,
} from "./api.js";

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const COMPARISON_STORAGE_KEY = "venture-lens-comparison-v1";
const ALL_PAGE_SIZE = 30;
const pages = [
  ["overview", "Overview", Home],
  ["radar", "Radar", Radar],
  ["repositories", "Repositories", Code2],
  ["research", "Research", BookOpen],
  ["compare", "Compare", Scale],
  ["graph", "Signal Graph", Network],
  ["watchlist", "Watchlist", Bookmark],
  ["briefs", "Briefs", Newspaper],
];

function routeFor(page) {
  return page === "overview" ? "/venturelens" : `/venturelens/${page}`;
}

function currentPage(pathname) {
  const segment = pathname.replace(/^\/venturelens\/?/, "").split("/")[0];
  return pages.some(([id]) => id === segment) ? segment : "overview";
}

function referenceKey(kind, id) {
  return `${kind}:${id}`;
}

function storedComparison() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(COMPARISON_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && ["repository", "paper", "technology"].includes(item.kind) && item.id && item.label).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

function syncLabel(value) {
  if (!value) return "Starter snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently refreshed";
  return `Synced ${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function ArrowIcon() {
  return <ArrowUpRight aria-hidden="true" size={14} />;
}

function WatchButton({ active, disabled = false, onClick }) {
  return <button aria-busy={disabled} aria-label={active ? "Remove from watchlist" : "Add to watchlist"} className={active ? "vl-icon-action active" : "vl-icon-action"} disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }} title={active ? "Watching" : "Watch this signal"} type="button"><Star aria-hidden="true" fill={active ? "currentColor" : "none"} size={15} /></button>;
}

function CompareButton({ active, onClick }) {
  return <button aria-label={active ? "Remove from comparison" : "Add to comparison"} className={active ? "vl-icon-action compare active" : "vl-icon-action compare"} onClick={(event) => { event.stopPropagation(); onClick(); }} title={active ? "Selected for comparison" : "Compare this signal"} type="button"><GitCompareArrows aria-hidden="true" size={15} /></button>;
}

function RepoCard({ repository, watched, watchPending, compared, onOpen, onWatch, onCompare }) {
  const hasStats = Number.isFinite(repository.stars) || Number.isFinite(repository.forks);
  return (
    <article className="vl-repo-card interactive" onClick={() => onOpen("repository", repository.id)}>
      <header><span className={`vl-repo-mark is-${repository.category}`}>{String(repository.name || "R").slice(0, 2).toUpperCase()}</span><div><span>{repository.owner}</span><h3>{repository.name}</h3></div><div className="vl-card-tools"><WatchButton active={watched} disabled={watchPending} onClick={onWatch} /><CompareButton active={compared} onClick={onCompare} /></div></header>
      <p>{repository.description || "Open-source implementation signal awaiting a fuller project description."}</p>
      <div className="vl-card-tags">{(repository.topics || []).slice(0, 3).map((topic) => <span key={topic}>{topic}</span>)}</div>
      <footer><span><i className="vl-language-dot" />{repository.language || "Mixed"}</span>{Number.isFinite(repository.stars) && <span title="GitHub stars"><Star size={12} /> {compactNumber.format(repository.stars)}</span>}{Number.isFinite(repository.forks) && <span title="Repository forks"><GitFork size={12} /> {compactNumber.format(repository.forks)}</span>}{!hasStats && <span className="vl-metadata-pending">Metadata pending</span>}<button className="vl-open-dossier" onClick={(event) => { event.stopPropagation(); onOpen("repository", repository.id); }} type="button">Dossier</button>{repository.url && <a href={repository.url} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><Code2 size={12} /> GitHub <ArrowIcon /></a>}</footer>
    </article>
  );
}

function PaperCard({ paper, watched, watchPending, compared, onOpen, onWatch, onCompare }) {
  return (
    <article className="vl-paper-card interactive" onClick={() => onOpen("paper", paper.id)}>
      <div className={`vl-paper-index is-${paper.category}`}><span>{String(paper.category || "AI").slice(0, 3).toUpperCase()}</span><strong>{String(paper.published_at || "—").slice(0, 4)}</strong></div>
      <div className="vl-paper-copy"><div className="vl-paper-meta"><span>{paper.category?.replaceAll("-", " ")}</span><div className="vl-card-tools"><WatchButton active={watched} disabled={watchPending} onClick={onWatch} /><CompareButton active={compared} onClick={onCompare} /></div></div><h3>{paper.title}</h3><p>{paper.summary}</p><div className="vl-paper-authors">{(paper.authors || []).slice(0, 3).join(" · ") || "Research collective"}</div><div className="vl-paper-actions"><button onClick={(event) => { event.stopPropagation(); onOpen("paper", paper.id); }} type="button">Open dossier</button>{paper.url && <a href={paper.url} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank"><BookOpen size={13} /> arXiv <ArrowIcon /></a>}</div></div>
    </article>
  );
}

function CategoryRail({ categories, active, onChange }) {
  return <div className="vl-category-rail" role="group" aria-label="Filter by topic category"><button aria-pressed={active === "all"} className={active === "all" ? "active" : ""} onClick={() => onChange("all")} type="button">All signals</button>{categories.map((category) => <button aria-pressed={active === category.id} className={active === category.id ? "active" : ""} key={category.id} onClick={() => onChange(category.id)} type="button"><i className={`is-${category.id}`} />{category.label}</button>)}</div>;
}

function WorkspaceLoading() {
  return <section aria-live="polite" className="vl-workspace-state" role="status"><RefreshCw className="spinning" aria-hidden="true" size={24} /><strong>Loading Venture Lens</strong><p>Connecting repository, research and decision signals…</p></section>;
}

function WorkspaceFailure({ message, onRetry }) {
  return <section className="vl-workspace-state is-error" role="alert"><Radar aria-hidden="true" size={26} /><strong>Venture Lens could not load</strong><p>{message || "The workspace is temporarily unavailable."}</p><button onClick={onRetry} type="button">Try again</button></section>;
}

function EmptyWorkspace({ children }) {
  return <div className="vl-empty"><Radar aria-hidden="true" size={20} /><span>{children}</span></div>;
}

function SectionHead({ number, title, copy, action }) {
  return <div className="vl-section-head"><div><span className="vl-section-number">{number}</span><div><h2>{title}</h2><p>{copy}</p></div></div>{action}</div>;
}

function MetricBars({ metrics = {} }) {
  return <div className="vl-metric-bars">{Object.entries(metrics).map(([label, raw]) => { const value = Number(raw) || 0; return <div key={label}><header><span>{label.replaceAll("_", " ")}</span><strong>{value}</strong></header><i><b style={{ width: `${Math.max(3, Math.min(100, value))}%` }} /></i></div>; })}</div>;
}

function DossierModal({ dossier, loading, watched, onClose, onWatch, onOpenRelated }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const open = Boolean(dossier || loading);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    const background = document.querySelectorAll(".venture-lens > .vl-topbar, .venture-lens > .vl-page, .venture-lens > .vl-footer");
    background.forEach((node) => { node.setAttribute("inert", ""); node.setAttribute("aria-hidden", "true"); });
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector("button, a[href]")?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = priorOverflow;
      background.forEach((node) => { node.removeAttribute("inert"); node.removeAttribute("aria-hidden"); });
      previousFocus?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  const title = dossier?.label || dossier?.full_name || dossier?.title || "Loading intelligence";
  return <div className="vl-modal-scrim" onMouseDown={onClose} role="presentation"><section aria-label={`${title} dossier`} aria-modal="true" className="vl-dossier" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>{loading ? <div className="vl-dossier-loading"><i /><strong>Building dossier</strong><span>Connecting implementation and research evidence…</span></div> : <><header className="vl-dossier-head"><div><span>{dossier.kind} dossier</span><h2>{title}</h2><p>{dossier.stage || "Signal"} · Momentum {dossier.momentum_score || dossier.score || "—"}/100</p></div><div><WatchButton active={watched} onClick={onWatch} /><button aria-label="Close dossier" className="vl-close" onClick={onClose} type="button"><X size={18} /></button></div></header><div className="vl-dossier-body"><main><section><span className="vl-dossier-label">Executive assessment</span><p className="vl-dossier-lead">{dossier.assessment || dossier.summary || dossier.executive_summary}</p></section>{dossier.why_now && <section><h3>Why now</h3><p>{dossier.why_now}</p></section>}{dossier.contribution && <section><h3>Core contribution</h3><p>{dossier.contribution}</p></section>}{dossier.practical_relevance && <section><h3>Practical relevance</h3><p>{dossier.practical_relevance}</p></section>}{dossier.recommendation && <section className="vl-recommendation"><h3>Recommended posture</h3><p>{dossier.recommendation}</p></section>}{!!dossier.strengths?.length && <section><h3>Strengths</h3><ul>{dossier.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>}{!!dossier.risks?.length && <section><h3>Risks and validation points</h3><ul>{dossier.risks.map((item) => <li key={item}>{item}</li>)}</ul></section>}{!!dossier.limitations?.length && <section><h3>Limitations</h3><ul>{dossier.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>}</main><aside>{dossier.metrics && <MetricBars metrics={dossier.metrics} />}<div className="vl-dossier-facts">{Number.isFinite(dossier.stars) && <span><small>Stars</small><strong>{compactNumber.format(dossier.stars)}</strong></span>}{Number.isFinite(dossier.forks) && <span><small>Forks</small><strong>{compactNumber.format(dossier.forks)}</strong></span>}{dossier.repository_count !== undefined && <span><small>Repositories</small><strong>{dossier.repository_count}</strong></span>}{dossier.paper_count !== undefined && <span><small>Papers</small><strong>{dossier.paper_count}</strong></span>}</div>{[...(dossier.repositories || dossier.related_repositories || []), ...(dossier.papers || dossier.related_papers || [])].length > 0 && <div className="vl-related-list"><h3>Connected evidence</h3>{(dossier.repositories || dossier.related_repositories || []).slice(0, 4).map((item) => <button key={item.id} onClick={() => onOpenRelated("repository", item.id)} type="button"><span>Repository</span><strong>{item.full_name || item.name}</strong></button>)}{(dossier.papers || dossier.related_papers || []).slice(0, 4).map((item) => <button key={item.id} onClick={() => onOpenRelated("paper", item.id)} type="button"><span>Research</span><strong>{item.title}</strong></button>)}</div>}{(dossier.url || dossier.pdf_url) && <a className="vl-primary-link" href={dossier.url || dossier.pdf_url} rel="noreferrer" target="_blank">Open original source <ArrowIcon /></a>}</aside></div></>}</section></div>;
}

function metricValue(item, definition) {
  const raw = item[definition.id] ?? item.metrics?.[definition.id];
  if (raw === null || raw === undefined || raw === "") return "—";
  if (definition.format === "date") return String(raw).slice(0, 10);
  const number = Number(raw);
  if (!Number.isFinite(number)) return "—";
  if (definition.format === "number") return compactNumber.format(number);
  return `${Math.round(number)}/100`;
}

function ComparisonResult({ result, onClose }) {
  if (!result?.items?.length) return null;
  return <div className="vl-compare-result"><header><div><span>{result.kind} decision matrix</span><h3>{result.items.length} like-for-like signals compared</h3></div><button onClick={onClose} type="button">Clear result</button></header><div className="vl-compare-table" style={{ "--compare-columns": result.items.length }}><div className="vl-compare-label">Signal</div>{result.items.map((item) => <div className="vl-compare-name" key={`${item.kind}-${item.id}`}>{item.label || item.full_name || item.title}</div>)}{(result.metrics || []).map((definition) => <React.Fragment key={definition.id}><div className="vl-compare-label">{definition.label}</div>{result.items.map((item) => { const raw = item[definition.id] ?? item.metrics?.[definition.id]; return <div className="vl-compare-cell" key={`${item.id}-${definition.id}`}><strong>{metricValue(item, definition)}</strong>{definition.format === "score" && <i><b style={{ width: `${Math.max(0, Math.min(100, Number(raw) || 0))}%` }} /></i>}</div>; })}</React.Fragment>)}</div></div>;
}

function RelationshipGraph({ graph, onOpen }) {
  const technologies = (graph?.nodes || []).filter((node) => node.kind === "technology");
  if (!technologies.length) return <EmptyWorkspace>No connected evidence is available yet. Sync live data, then try again.</EmptyWorkspace>;
  return <div className="vl-graph-stage">{technologies.map((technology) => { const targets = (graph.edges || []).filter((edge) => edge.source === technology.id).map((edge) => graph.nodes.find((node) => node.id === edge.target)).filter(Boolean); return <article className="vl-graph-cluster" key={technology.id}><button className="vl-graph-hub" onClick={() => onOpen("technology", technology.category)} type="button"><span>{technology.score}</span><strong>{technology.label}</strong><small>technology signal</small></button><div className="vl-graph-branches">{targets.map((node) => <button className={`is-${node.kind}`} key={node.id} onClick={() => onOpen(node.kind, node.entity_id)} type="button"><span>{node.kind}</span><strong>{node.label}</strong><small>{node.score}/100</small></button>)}</div></article>; })}</div>;
}

export default function VentureLensApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { language, toggleLanguage, translationState } = useLanguage();
  const { enabled: guideEnabled, requestGuide } = useGuidePet();
  const page = currentPage(location.pathname);
  const [payload, setPayload] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [paperQuery, setPaperQuery] = useState("");
  const [repoCategory, setRepoCategory] = useState("all");
  const [paperCategory, setPaperCategory] = useState("all");
  const [repoVisible, setRepoVisible] = useState(ALL_PAGE_SIZE);
  const [paperVisible, setPaperVisible] = useState(ALL_PAGE_SIZE);
  const [dossier, setDossier] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [compareItems, setCompareItems] = useState(storedComparison);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsReading, setNotificationsReading] = useState(false);
  const [pendingWatchKeys, setPendingWatchKeys] = useState(() => new Set());
  const notificationRef = useRef(null);

  async function loadWorkspace() {
    setLoading(true); setError("");
    const [overviewResult, intelligenceResult] = await Promise.allSettled([getVentureOverview(), getVentureIntelligence()]);
    if (overviewResult.status === "fulfilled") setPayload(overviewResult.value);
    if (intelligenceResult.status === "fulfilled") setIntelligence(intelligenceResult.value);
    const failures = [overviewResult, intelligenceResult].filter((result) => result.status === "rejected");
    if (failures.length) setError(failures.map((result) => result.reason?.message || "A workspace request failed.").join(" "));
    setLoading(false);
  }

  useEffect(() => { loadWorkspace(); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); setNotificationsOpen(false); }, [location.pathname]);
  useEffect(() => { setRepoVisible(ALL_PAGE_SIZE); }, [repoCategory, repoQuery]);
  useEffect(() => { setPaperVisible(ALL_PAGE_SIZE); }, [paperCategory, paperQuery]);
  useEffect(() => { window.sessionStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(compareItems)); }, [compareItems]);
  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const handlePointerDown = (event) => { if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false); };
    const handleKeyDown = (event) => { if (event.key === "Escape") setNotificationsOpen(false); };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("pointerdown", handlePointerDown); document.removeEventListener("keydown", handleKeyDown); };
  }, [notificationsOpen]);

  const repositories = payload?.github?.items || [];
  const papers = payload?.research?.items || [];
  const githubCategories = payload?.github?.categories || [];
  const researchCategories = payload?.research?.categories || [];
  const watchlist = intelligence?.watchlist || [];
  const watchedKeys = useMemo(() => new Set(watchlist.map((item) => item.key)), [watchlist]);
  const comparedKeys = useMemo(() => new Set(compareItems.map((item) => referenceKey(item.kind, item.id))), [compareItems]);
  const unreadCount = (intelligence?.notifications || []).filter((item) => !item.read).length;
  const normalizedRepoQuery = repoQuery.trim().toLowerCase();
  const normalizedPaperQuery = paperQuery.trim().toLowerCase();
  const filteredRepositories = useMemo(() => repositories.filter((item) => (repoCategory === "all" || item.category === repoCategory) && (!normalizedRepoQuery || [item.name, item.full_name, item.description, ...(item.topics || [])].join(" ").toLowerCase().includes(normalizedRepoQuery))), [repositories, repoCategory, normalizedRepoQuery]);
  const filteredPapers = useMemo(() => papers.filter((item) => (paperCategory === "all" || item.category === paperCategory) && (!normalizedPaperQuery || [item.title, item.summary, ...(item.authors || [])].join(" ").toLowerCase().includes(normalizedPaperQuery))), [papers, paperCategory, normalizedPaperQuery]);
  const hotRepositories = useMemo(() => [...repositories].filter((item) => Number.isFinite(item.stars)).sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 2), [repositories]);
  const hotPapers = useMemo(() => [...papers].sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || ""))).slice(0, 2), [papers]);

  async function handleRefresh() { setSyncing(true); setError(""); try { await refreshVentureLens(); await loadWorkspace(); } catch (requestError) { setError(requestError.message); } finally { setSyncing(false); } }
  async function openDossier(kind, id) { setDossier(null); setDossierLoading(true); try { setDossier(kind === "repository" ? await getRepositoryDossier(id) : kind === "paper" ? await getPaperDossier(id) : await getTechnologyDossier(id)); } catch (requestError) { setError(requestError.message); } finally { setDossierLoading(false); } }
  async function toggleWatch(kind, id, label) {
    const key = referenceKey(kind, id);
    if (pendingWatchKeys.has(key)) return;
    setPendingWatchKeys((current) => new Set(current).add(key));
    try { const result = await toggleVentureWatchlist({ kind, id, label }); const derived = await getVentureIntelligence(); setIntelligence({ ...derived, watchlist: result.items }); }
    catch (requestError) { setError(requestError.message); }
    finally { setPendingWatchKeys((current) => { const next = new Set(current); next.delete(key); return next; }); }
  }

  function toggleCompare(kind, id, label) {
    const key = referenceKey(kind, id); setComparison(null);
    setCompareItems((current) => {
      if (current.some((item) => referenceKey(item.kind, item.id) === key)) return current.filter((item) => referenceKey(item.kind, item.id) !== key);
      if (current.length && current[0].kind !== kind) { setError(`Compare repositories with repositories, papers with papers, or technology signals with technology signals. Clear the current ${current[0].kind} selection first.`); return current; }
      if (current.length >= 4) { setError("A comparison can contain at most four signals. Remove one before adding another."); return current; }
      setError(""); return [...current, { kind, id, label }];
    });
  }

  async function runComparison() { if (compareItems.length < 2) return; setComparing(true); setError(""); try { setComparison(await compareVentureSignals(compareItems)); } catch (requestError) { setError(requestError.message); } finally { setComparing(false); } }
  async function readNotifications() {
    if (!unreadCount || notificationsReading) return;
    setNotificationsReading(true);
    try { const items = await markVentureNotificationsRead(); setIntelligence((current) => ({ ...current, notifications: items.items || items })); }
    catch (requestError) { setError(requestError.message); }
    finally { setNotificationsReading(false); }
  }
  const dossierWatched = dossier ? watchedKeys.has(referenceKey(dossier.kind, dossier.id)) : false;
  const initialLoading = loading && !payload && !intelligence;
  const fatalError = !loading && !!error && !payload && !intelligence;

  const repoCards = (items) => items.map((repository) => { const key = referenceKey("repository", repository.id); return <RepoCard compared={comparedKeys.has(key)} key={`${repository.category}-${repository.id}`} onCompare={() => toggleCompare("repository", repository.id, repository.full_name || repository.name)} onOpen={openDossier} onWatch={() => toggleWatch("repository", repository.id, repository.full_name || repository.name)} repository={repository} watched={watchedKeys.has(key)} watchPending={pendingWatchKeys.has(key)} />; });
  const paperCards = (items) => items.map((paper) => { const key = referenceKey("paper", paper.id); return <PaperCard compared={comparedKeys.has(key)} key={`${paper.category}-${paper.id}`} onCompare={() => toggleCompare("paper", paper.id, paper.title)} onOpen={openDossier} onWatch={() => toggleWatch("paper", paper.id, paper.title)} paper={paper} watched={watchedKeys.has(key)} watchPending={pendingWatchKeys.has(key)} />; });

  return (
    <div className="venture-lens">
      <div className="vl-orb vl-orb-one" aria-hidden="true" /><div className="vl-orb vl-orb-two" aria-hidden="true" />
      <header className="vl-topbar vl-floating-navigation">
        <button
          aria-label="Open Venture Lens overview"
          className="vl-brand"
          onClick={() => navigate("/venturelens")}
          type="button"
        >
          <span className="vl-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Venture Lens</strong><small>Sense.AI intelligence</small></span>
        </button>

        <nav aria-label="Venture Lens pages" className="vl-nav">
          {pages.map(([id, label, PageIcon]) => (
            <button
              aria-current={page === id ? "page" : undefined}
              aria-label={label}
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => navigate(routeFor(id))}
              title={label}
              type="button"
            >
              <PageIcon aria-hidden="true" size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="vl-top-actions">
          <a className="vl-return-link" href="/for-you" title="Open NewsScrapper">
            <Newspaper aria-hidden="true" size={15} />
            <span>NewsScrapper</span>
          </a>
          <button
            aria-busy={translationState.pending > 0}
            aria-label={language === "ko" ? "Switch to English" : "한국어로 전환"}
            className="vl-language-toggle"
            data-no-translate
            onClick={() => {
              if (language !== "ko") translationState?.prepareBrowser?.();
              toggleLanguage();
            }}
            title={translationState.error || (language === "ko" ? "Switch to English" : "한국어로 전환")}
            type="button"
          >
            <Languages aria-hidden="true" size={15} />
            <span>{translationState.pending > 0 ? (language === "ko" ? "번역 중" : "Translating") : language === "ko" ? "English" : "한국어"}</span>
          </button>
          <button
            aria-pressed={guideEnabled}
            className={guideEnabled ? "vl-guide-trigger active" : "vl-guide-trigger"}
            onClick={requestGuide}
            title="Show the optional Sense.ai guide"
            type="button"
          >
            <Sparkles aria-hidden="true" size={15} />
            <span>Guide</span>
          </button>
          <div className="vl-notification-wrap" ref={notificationRef}>
            <button
              aria-controls="venture-notifications"
              aria-expanded={notificationsOpen}
              aria-label={notificationsOpen ? "Close notifications" : "Open notifications"}
              className="vl-notification-trigger"
              onClick={() => setNotificationsOpen((value) => !value)}
              type="button"
            >
              <Bell aria-hidden="true" size={17} />
              {unreadCount > 0 && <b>{unreadCount}</b>}
            </button>
            {notificationsOpen && (
              <div
                aria-label="Personal watch notifications"
                className="vl-notification-panel"
                id="venture-notifications"
                role="dialog"
              >
                <header>
                  <div><span>Personal watch</span><strong>Notifications</strong></div>
                  <button
                    aria-busy={notificationsReading}
                    disabled={!unreadCount || notificationsReading}
                    onClick={readNotifications}
                    type="button"
                  >
                    {notificationsReading ? "Marking…" : unreadCount ? "Mark read" : "All read"}
                  </button>
                </header>
                {(intelligence?.notifications || []).length
                  ? intelligence.notifications.map((item) => (
                    <article className={item.read ? "" : "unread"} key={item.id}>
                      <span>{item.kind}</span><strong>{item.title}</strong><p>{item.message}</p>
                    </article>
                  ))
                  : <p className="vl-notification-empty">Watch a technology, repository or paper to begin monitoring it.</p>}
              </div>
            )}
          </div>
          <button
            aria-label={syncing ? "Syncing Venture Lens" : "Sync Venture Lens live data"}
            className="vl-sync-control"
            disabled={syncing}
            onClick={handleRefresh}
            title={syncing ? "Syncing" : "Sync live"}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={syncing ? "spinning" : ""} size={15} />
            <span>{syncing ? "Syncing" : "Sync live"}</span>
          </button>
        </div>
      </header>

      <main className={`vl-page vl-page-${page}`}>
        {initialLoading && <WorkspaceLoading />}
        {fatalError && <WorkspaceFailure message={error} onRetry={loadWorkspace} />}
        {error && !fatalError && <div className="vl-notice" role="alert"><strong>Venture Lens needs your attention.</strong><span>{error}</span><button onClick={loadWorkspace} type="button">Try again</button><button aria-label="Dismiss message" onClick={() => setError("")} type="button"><X size={15} /></button></div>}

        <div hidden={initialLoading || fatalError}>

        {page === "overview" && <><section className="vl-hero"><div className="vl-hero-copy"><div className="vl-eyebrow"><Sparkles size={14} /> Technology decision intelligence</div><h1>Find the technologies worth <em>your attention.</em></h1><p>Venture Lens connects open-source adoption, current research and implementation evidence—then gives every task its own focused workspace.</p><div className="vl-hero-actions"><button onClick={() => navigate("/venturelens/radar")} type="button">Explore the radar <ArrowIcon /></button><button onClick={() => navigate("/venturelens/repositories")} type="button">Browse repositories</button></div></div><aside className="vl-radar-card"><div className="vl-radar-visual" aria-hidden="true"><i className="ring one" /><i className="ring two" /><i className="ring three" /><i className="sweep" /><b className="ping p1" /><b className="ping p2" /><b className="ping p3" /><span>LIVE<br />LENS</span></div><div className="vl-radar-copy"><span>Signal coverage</span><strong>{repositories.length + papers.length} opportunities indexed</strong><small>{payload?.github?.status === "live" || payload?.research?.status === "live" ? "Connected to live public sources" : "Cached decision workspace"}</small></div></aside></section><section className="vl-metrics"><article><span>Repositories</span><strong>{repositories.length}</strong><small>{githubCategories.length} technology lenses</small></article><article><span>Research papers</span><strong>{papers.length}</strong><small>{researchCategories.length} research lenses</small></article><article><span>Technology radar</span><strong>{intelligence?.radar?.length || 0}</strong><small>scored decision signals</small></article><article><span>Data status</span><strong>{loading ? "Loading" : "Ready"}</strong><small>{syncLabel(payload?.github?.refreshed_at || payload?.research?.refreshed_at)}</small></article></section><section className="vl-section vl-hot-section"><SectionHead number="NOW" title="Hot signals" copy="A small live preview—not the entire workspace. Open a dedicated page when you want to explore deeply." /><div className="vl-hot-layout"><div><header><Code2 size={18} /><span>Trending implementations</span><button onClick={() => navigate("/venturelens/repositories")} type="button">View all <ArrowIcon /></button></header><div className="vl-repo-grid">{repoCards(hotRepositories)}{!hotRepositories.length && <EmptyWorkspace>No repository signals are available.</EmptyWorkspace>}</div></div><div><header><BookOpen size={18} /><span>Fresh research</span><button onClick={() => navigate("/venturelens/research")} type="button">View all <ArrowIcon /></button></header><div className="vl-paper-grid">{paperCards(hotPapers)}{!hotPapers.length && <EmptyWorkspace>No research signals are available.</EmptyWorkspace>}</div></div></div></section><section className="vl-section vl-workspace-links"><SectionHead number="MAP" title="Choose a workspace" copy="Every capability has a separate page, a clear purpose and its own interaction model." /><div>{pages.slice(1).map(([id, label, Icon]) => <button key={id} onClick={() => navigate(routeFor(id))} type="button"><Icon size={20} /><strong>{label}</strong><span>Open workspace</span><ArrowIcon /></button>)}</div></section></>}

        {page === "radar" && <section className="vl-section vl-page-section"><SectionHead number="01" title="Technology radar" copy="Ranked technology themes with implementation and research evidence kept together." />{intelligence?.radar?.length ? <div className="vl-radar-layout"><div className="vl-radar-axis"><span>Adopt</span><span>Evaluate</span><span>Explore</span><span>Watch</span><b>Technology<br />momentum</b></div><div className="vl-radar-signals">{intelligence.radar.map((item) => { const key = referenceKey("technology", item.id); return <article className={`stage-${String(item.stage).toLowerCase()}`} key={item.id}><button onClick={() => openDossier("technology", item.id)} type="button"><span>{item.score}</span><strong>{item.label}</strong><small>{item.repository_count} repos · {item.paper_count} papers</small><em>{item.stage}</em></button><div className="vl-radar-tools"><WatchButton active={watchedKeys.has(key)} disabled={pendingWatchKeys.has(key)} onClick={() => toggleWatch("technology", item.id, item.label)} /><CompareButton active={comparedKeys.has(key)} onClick={() => toggleCompare("technology", item.id, item.label)} /></div></article>; })}</div></div> : <EmptyWorkspace>No technology signals are available yet. Sync live data to build the radar.</EmptyWorkspace>}</section>}

        {page === "repositories" && <section className="vl-section vl-page-section"><SectionHead number="02" title="Repository intelligence" copy="Live implementation signals organized into practical technology lenses—including AI coding and prompt engineering." action={<label className="vl-inline-search"><Search aria-hidden="true" size={14} /><input aria-label="Search repositories" onChange={(event) => setRepoQuery(event.target.value)} placeholder="Search repositories" value={repoQuery} />{repoQuery && <button aria-label="Clear repository search" onClick={() => setRepoQuery("")} type="button"><X aria-hidden="true" size={13} /></button>}</label>} /><CategoryRail active={repoCategory} categories={githubCategories} onChange={setRepoCategory} /><div className="vl-coverage-note"><CheckCircle2 aria-hidden="true" size={15} /><span>{repoCategory === "all" ? `${githubCategories.length} categories` : "Category view"} · showing {Math.min(filteredRepositories.length, repoCategory === "all" ? repoVisible : 10)} of {filteredRepositories.length} matching repositories</span></div><div className="vl-repo-grid">{repoCards(filteredRepositories.slice(0, repoCategory === "all" ? repoVisible : 10))}</div>{!loading && !filteredRepositories.length && <EmptyWorkspace>No repositories match this search and category. Clear a filter to widen the lens.</EmptyWorkspace>}{repoCategory === "all" && repoVisible < filteredRepositories.length && <button className="vl-load-more" onClick={() => setRepoVisible((count) => count + ALL_PAGE_SIZE)} type="button">Show {Math.min(ALL_PAGE_SIZE, filteredRepositories.length - repoVisible)} more repositories</button>}</section>}

        {page === "research" && <section className="vl-section vl-page-section"><SectionHead number="03" title="Research stream" copy="Current papers grouped by decision-useful themes, with ten results available in every category." action={<label className="vl-inline-search"><Search aria-hidden="true" size={14} /><input aria-label="Search research papers" onChange={(event) => setPaperQuery(event.target.value)} placeholder="Search papers or authors" value={paperQuery} />{paperQuery && <button aria-label="Clear research search" onClick={() => setPaperQuery("")} type="button"><X aria-hidden="true" size={13} /></button>}</label>} /><CategoryRail active={paperCategory} categories={researchCategories} onChange={setPaperCategory} /><div className="vl-coverage-note"><CheckCircle2 aria-hidden="true" size={15} /><span>{paperCategory === "all" ? `${researchCategories.length} categories` : "Category view"} · showing {Math.min(filteredPapers.length, paperCategory === "all" ? paperVisible : 10)} of {filteredPapers.length} matching papers</span></div><div className="vl-paper-grid">{paperCards(filteredPapers.slice(0, paperCategory === "all" ? paperVisible : 10))}</div>{!loading && !filteredPapers.length && <EmptyWorkspace>No papers match this search and category. Clear a filter to widen the research stream.</EmptyWorkspace>}{paperCategory === "all" && paperVisible < filteredPapers.length && <button className="vl-load-more" onClick={() => setPaperVisible((count) => count + ALL_PAGE_SIZE)} type="button">Show {Math.min(ALL_PAGE_SIZE, filteredPapers.length - paperVisible)} more papers</button>}</section>}

        {page === "compare" && <section className="vl-section vl-page-section"><SectionHead number="04" title="Compare workbench" copy="Compare two to four signals of the same type. Cross-type comparisons are blocked because stars, citations and technology momentum are not equivalent measures." /><div className="vl-compare-guidance"><GitCompareArrows size={20} /><div><strong>{compareItems.length ? `${compareItems[0].kind} comparison active` : "Choose one comparison type"}</strong><span>Select from Radar, Repositories or Research. Once the first signal is selected, only that same signal type can be added.</span></div>{compareItems.length > 0 && <button onClick={() => { setCompareItems([]); setComparison(null); }} type="button">Clear selection</button>}</div><div className="vl-compare-workbench"><div className="vl-compare-selection">{compareItems.length ? compareItems.map((item, index) => <article key={referenceKey(item.kind, item.id)}><span>0{index + 1} · {item.kind}</span><strong>{item.label}</strong><button onClick={() => toggleCompare(item.kind, item.id, item.label)} type="button">Remove</button></article>) : <div className="vl-compare-empty"><GitCompareArrows size={25} /><strong>No signals selected yet.</strong><span>Use the compare icon on cards or radar signals, then return here.</span></div>}</div><button className="vl-compare-run" disabled={compareItems.length < 2 || comparing} onClick={runComparison} type="button">{comparing ? "Building matrix…" : `Compare ${compareItems.length || "selected"} ${compareItems[0]?.kind || "signals"}`}</button></div><ComparisonResult onClose={() => setComparison(null)} result={comparison} /></section>}

        {page === "graph" && <section className="vl-section vl-page-section"><SectionHead number="05" title="Research-to-repository graph" copy="A navigable evidence map linking technology themes to influential papers and implementations." /><RelationshipGraph graph={intelligence?.graph} onOpen={openDossier} /></section>}

        {page === "watchlist" && <section className="vl-section vl-page-section"><SectionHead number="06" title="Personal watchlist" copy="Your private monitoring desk for technologies, repositories and research papers." /><div className="vl-watch-layout"><div className="vl-watch-grid">{watchlist.length ? watchlist.map((item) => { const key = referenceKey(item.kind, item.id); return <article key={item.key}><span>{item.kind}</span><strong>{item.label}</strong><small>Watching since {new Date(item.saved_at).toLocaleDateString()}</small><div><button onClick={() => openDossier(item.kind, item.id)} type="button">Open dossier</button><button aria-busy={pendingWatchKeys.has(key)} disabled={pendingWatchKeys.has(key)} onClick={() => toggleWatch(item.kind, item.id, item.label)} type="button">{pendingWatchKeys.has(key) ? "Removing…" : "Remove"}</button></div></article>; }) : <div className="vl-watch-empty"><Star size={28} /><strong>Your watchlist is ready.</strong><p>Use the star action on any radar signal, repository or paper to monitor it here.</p></div>}</div><aside className="vl-monitor-panel"><span>Monitoring loop</span><strong>{watchlist.length} active signals</strong><p>Watchlist activity is stored per viewer and generates personal notifications.</p><button onClick={() => setNotificationsOpen(true)} type="button"><Bell aria-hidden="true" size={14} /> Open notifications {unreadCount ? `(${unreadCount})` : ""}</button></aside></div></section>}

        {page === "briefs" && <section className="vl-section vl-page-section vl-brief-section"><SectionHead number="07" title="Opportunity briefs" copy="Decision notes assembled from the strongest signals in the current cache." /><div className="vl-brief-grid">{(intelligence?.briefs || []).map((brief, index) => <article key={brief.id}><header><span>0{index + 1}</span><small>{brief.type}</small></header><h3>{brief.title}</h3><p>{brief.summary}</p><ul>{brief.actions.map((action) => <li key={action}>{action}</li>)}</ul><button onClick={() => brief.technology_id ? openDossier("technology", brief.technology_id) : brief.repository_id ? openDossier("repository", brief.repository_id) : brief.paper_id ? openDossier("paper", brief.paper_id) : undefined} type="button">Open supporting intelligence <ArrowIcon /></button></article>)}</div>{!intelligence?.briefs?.length && <EmptyWorkspace>No opportunity briefs are available yet. Sync live data to assemble the next set.</EmptyWorkspace>}</section>}
        </div>
      </main>

      {compareItems.length > 0 && page !== "compare" && <aside aria-live="polite" className="vl-compare-tray"><div><GitCompareArrows aria-hidden="true" size={17} /><span><strong>{compareItems.length} {compareItems[0].kind}{compareItems.length === 1 ? "" : "s"}</strong> selected for comparison</span></div><button onClick={() => navigate("/venturelens/compare")} type="button">Open compare</button><button aria-label="Clear comparison selection" onClick={() => { setCompareItems([]); setComparison(null); }} type="button"><X aria-hidden="true" size={15} /></button></aside>}
      <footer className="vl-footer"><button className="vl-brand" onClick={() => navigate("/venturelens")} type="button"><span className="vl-brand-mark"><i /><i /><i /></span><span><strong>Sense.AI</strong><small>Decision intelligence</small></span></button><p>Public-source signals. Cached responsibly. Built for internal exploration.</p><span>Designed & engineered by Vineet Singh</span></footer>
      <DossierModal dossier={dossier} loading={dossierLoading} onClose={() => { setDossier(null); setDossierLoading(false); }} onOpenRelated={openDossier} onWatch={() => dossier && toggleWatch(dossier.kind, dossier.id, dossier.label || dossier.full_name || dossier.title)} watched={dossierWatched} />
    </div>
  );
}
