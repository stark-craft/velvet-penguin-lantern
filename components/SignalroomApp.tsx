"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefingView } from "@/components/Briefing";
import { Header, Sidebar } from "@/components/Shell";
import { DeskPet } from "@/components/DeskPet";
import { SearchView } from "@/components/Search";
import { AnalyticsView, DroppedView, GatekeeperView, HistoryView, NotInterestedView, SavedView, SelectedView, SettingsView, SourcesView, WorkflowView } from "@/components/WorkspaceViews";
import { AdvancedFilterDrawer, ApprovalModal, ArticleDetails, ExportModal, FeedbackModal, GatekeeperAccessModal, HistorySnapshotDrawer, NotificationsDrawer, ProfileModal, ScanModal, SourceModal } from "@/components/Overlays";
import { EmptyState, GlobalTooltip, Icon, ToastRegion } from "@/components/ui";
import { downloadExport, mapRawArticle, mapSource, signalroomApi, type DeskNotification, type ScanJob, type VocResponse } from "@/lib/signalroom-client";
import { PRODUCT_NAME } from "@/lib/brand";
import type { AccessCapabilities, AdvancedFilters, Article, ArticleAction, BackendCapability, BriefingHistoryRecord, ColorTheme, DeskProfile, DetailedAnalytics, FeedbackSubmission, GatekeeperAudit, InterestSignal, SourceArticle, SourceRecord, StoryCluster, ViewerProfile, ViewMode, WorkflowItem } from "@/types/news";

type Toast = { id: number; message: string; tone?: string };
type ProfileSets = Record<DeskProfile, Set<string>>;
type ProfileStatus = Record<DeskProfile, Record<string, string>>;

const emptySets = (): ProfileSets => ({ default: new Set(), broadcast: new Set() });
const pageLabels: Record<string, string> = { briefing: "Morning briefing", discover: "Discover", search: "Search intelligence", selected: "Selected intelligence", workflow: "Editorial workflow", saved: "Saved library", gatekeeper: "Gatekeeper audit", dropped: "Dropped articles", "not-interested": "Not interested", history: "Briefing history", sources: "Source management", analytics: "Intelligence analytics", settings: "Workspace settings" };
const statusFromDisposition = (disposition: { approved: boolean; selected: boolean; under_review: boolean }) => disposition.approved ? "Approved" : disposition.under_review ? "Under Review" : disposition.selected ? "Selected" : "New";
const capabilitiesFromBackend = (items: BackendCapability[], method: string): AccessCapabilities => ({ isAdmin: items.includes("admin"), canViewAnalytics: items.includes("analytics"), canSwitchDeskProfile: items.includes("profile_switch"), canReviewGatekeeper: items.includes("gatekeeper_review"), canManageSources: items.includes("manage_sources"), canManageJobs: items.includes("manage_jobs"), accessLabel: method === "admin_key" || method === "admin_allowlist" ? "Administrator" : method === "developer_allowlist" ? "Developer network" : method === "identity_allowlist" ? "Approved identity" : method === "broadcast_allowlist" ? "Broadcast network" : "Standard desk" });
const emptyAdvancedFilters = (): AdvancedFilters => ({ dateFrom: "", dateTo: "", region: "all", source: "all", statuses: [], priorities: [], savedOnly: false, minimumRelevance: 0, contentType: "all", hasImage: false, hasSummary: false });
const advancedFilterCount = (filters: AdvancedFilters) => [filters.dateFrom, filters.dateTo, filters.region !== "all", filters.source !== "all", filters.statuses.length, filters.priorities.length, filters.savedOnly, filters.minimumRelevance > 0, filters.contentType !== "all", filters.hasImage, filters.hasSummary].filter(Boolean).length;

export default function SignalroomApp({ initialViewer, capabilities: initialCapabilities }: { initialViewer: ViewerProfile; capabilities: AccessCapabilities; initialTelemetry?: null }) {
  const [activePage, setActivePage] = useState("briefing");
  const [viewer, setViewer] = useState(initialViewer);
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [profile, setProfile] = useState<DeskProfile>("default");
  const [theme, setTheme] = useState<ColorTheme>("light");
  const [devicePreferencesReady, setDevicePreferencesReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("compact");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [team, setTeam] = useState("All teams");
  const [sort, setSort] = useState("Most relevant");
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(emptyAdvancedFilters);
  const [articles, setArticles] = useState<Article[]>([]);
  const [clusters, setClusters] = useState<StoryCluster[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [history, setHistory] = useState<BriefingHistoryRecord[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingHistoryRecord | null>(null);
  const [briefingArticleIds, setBriefingArticleIds] = useState<Set<string>>(new Set());
  const [selectedByProfile, setSelectedByProfile] = useState<ProfileSets>(emptySets);
  const [savedByProfile, setSavedByProfile] = useState<ProfileSets>(emptySets);
  const [notInterestedByProfile, setNotInterestedByProfile] = useState<ProfileSets>(emptySets);
  const [hiddenByProfile, setHiddenByProfile] = useState<ProfileSets>(emptySets);
  const [interestingByProfile, setInterestingByProfile] = useState<ProfileSets>(emptySets);
  const [statusByProfile, setStatusByProfile] = useState<ProfileStatus>({ default: {}, broadcast: {} });
  const [workflow, setWorkflow] = useState<WorkflowItem[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [analytics, setAnalytics] = useState<DetailedAnalytics | null>(null);
  const [feedbackInbox, setFeedbackInbox] = useState<VocResponse[]>([]);
  const [gatekeeper, setGatekeeper] = useState<GatekeeperAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastBriefingAt, setLastBriefingAt] = useState<string | null>(null);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<DeskNotification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<SourceRecord | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [approvalArticle, setApprovalArticle] = useState<{ id: string; title: string } | null>(null);
  const [gatekeeperAccessOpen, setGatekeeperAccessOpen] = useState(false);
  const [gatekeeperTarget, setGatekeeperTarget] = useState<"gatekeeper" | "dropped">("gatekeeper");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const advancedCount = useMemo(() => advancedFilterCount(advancedFilters), [advancedFilters]);

  const selectedIds = selectedByProfile[profile];
  const saved = savedByProfile[profile];
  const approved = useMemo(() => new Set(Object.entries(statusByProfile[profile]).filter(([, value]) => value === "Approved").map(([id]) => id)), [profile, statusByProfile]);
  const statusById = statusByProfile[profile];
  const interestById = useMemo(() => Object.fromEntries(articles.map((article) => [article.id, interestingByProfile[profile].has(article.id) ? "interesting" : notInterestedByProfile[profile].has(article.id) ? "not-interested" : null])) as Record<string, InterestSignal>, [articles, interestingByProfile, notInterestedByProfile, profile]);

  const addToast = useCallback((message: string, tone = "success") => { const id = Date.now() + Math.floor(Math.random() * 1000); setToasts((items) => [...items, { id, message, tone }]); window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200); }, []);
  const showError = useCallback((reason: unknown, fallback: string) => { const message = reason instanceof Error ? reason.message : fallback; setError(message); addToast(message, "warning"); }, [addToast]);

  const applySets = useCallback((desk: DeskProfile, records: Record<string, Awaited<ReturnType<typeof signalroomApi.worklist>>>) => {
    const setFor = (name: string) => new Set(records[name]?.items.map((item) => item.article.id) ?? []);
    setSelectedByProfile((current) => ({ ...current, [desk]: setFor("selected") }));
    setSavedByProfile((current) => ({ ...current, [desk]: setFor("saved") }));
    setInterestingByProfile((current) => ({ ...current, [desk]: setFor("interesting") }));
    setNotInterestedByProfile((current) => ({ ...current, [desk]: setFor("not_interested") }));
    setHiddenByProfile((current) => ({ ...current, [desk]: setFor("hidden") }));
    const dispositions = Object.values(records).flatMap((record) => record.items.map((item) => item.disposition));
    setStatusByProfile((current) => ({ ...current, [desk]: Object.fromEntries(dispositions.map((item) => [item.article_id, statusFromDisposition(item)])) }));
    const workflowStates = ["under_review", "selected", "approved"];
    const seen = new Set<string>();
    const nextWorkflow = workflowStates.flatMap((state) => (records[state]?.items ?? []).filter((item) => !seen.has(item.article.id) && seen.add(item.article.id)).map((item) => { const article = mapRawArticle(item.article); const ownerId = item.disposition.actor_id; return { id: `${desk}:${article.id}`, articleId: article.id, title: article.headline, category: article.category, owner: item.disposition.owner_display_name || (ownerId === viewer.id ? viewer.displayName : "Protected contributor"), ownerId, canMove: ownerId === viewer.id || capabilities.isAdmin, team: article.team.replace(" Team", ""), priority: article.priority, status: statusFromDisposition(item.disposition), created: article.date, due: "—", notes: state === "under_review" ? "Shared review submission" : state === "approved" ? "Shared approved signal" : "Personal selected item", attachments: item.article.sources.length, exported: false }; }));
    setWorkflow(nextWorkflow);
  }, [capabilities.isAdmin, viewer.displayName, viewer.id]);

  const loadDesk = useCallback(async (requested?: DeskProfile) => {
    setLoading(true); setError(null);
    try {
      const me = await signalroomApi.me(requested);
      const desk = me.active_profile;
      try {
        const storedTheme = window.localStorage.getItem(`signalroom-theme-${desk}`) as ColorTheme | null;
        const storedView = window.localStorage.getItem(`signalroom-feed-view-${desk}`) as ViewMode | null;
        setTheme(storedTheme === "dark" ? "dark" : "light");
        setView(storedView === "cards" || storedView === "dense" ? storedView : "compact");
      } catch { /* Profile-specific device preferences are optional. */ }
      setProfile(desk); setCapabilities(capabilitiesFromBackend(me.capabilities, me.authentication_method));
      setViewer((current) => ({ ...current, id: me.actor_id, currentIp: me.current_ip, accountEmail: me.identity ?? current.accountEmail, displayName: me.preferences?.display_name?.trim() || current.displayName, contactEmail: me.preferences?.contact_email ?? current.contactEmail, petEnabled: me.preferences?.pet_enabled ?? current.petEnabled, petKind: me.preferences?.pet_kind ?? current.petKind, petColor: me.preferences?.pet_color ?? current.petColor, roleLabel: me.capabilities.includes("analytics") ? "Intelligence lead" : "Intelligence analyst" }));
      if (!me.preferences) { setOnboardingRequired(true); setProfileOpen(true); }
      const states = ["selected", "saved", "under_review", "approved", "interesting", "not_interested", "hidden"];
      const [feed, sourceRows, historyRows, notificationRows, ...worklists] = await Promise.all([signalroomApi.feed(desk), signalroomApi.sources(desk), signalroomApi.briefings(desk), signalroomApi.notifications(desk), ...states.map((state) => signalroomApi.worklist(desk, state))]);
      setNotifications((current) => [...notificationRows, ...current.filter((item) => item.kind === "search")].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30));
      const records = Object.fromEntries(states.map((state, index) => [state, worklists[index]]));
      const worklistArticles = worklists.flatMap((item) => item.items.map((entry) => mapRawArticle(entry.article)));
      const merged = new Map<string, Article>([...feed.articles, ...worklistArticles].map((article) => [article.id, article]));
      setArticles([...merged.values()]); setClusters(feed.clusters); setSources(sourceRows.map(mapSource)); setHistory(historyRows.items); setHistoryCursor(historyRows.page.next_cursor); setLastBriefingAt(feed.briefing?.generated_at ?? null); applySets(desk, records);
      setBriefingArticleIds(new Set([...feed.articles.map((article) => article.id), ...feed.clusters.flatMap((cluster) => cluster.sources.map((source) => source.articleId).filter((id): id is string => Boolean(id)))]));
      if (me.capabilities.includes("analytics")) {
        const [detail, inbox] = await Promise.all([signalroomApi.analytics(desk), signalroomApi.feedbackInbox(desk)]);
        setAnalytics(detail); setFeedbackInbox(inbox.items);
      } else { setAnalytics(null); setFeedbackInbox([]); }
      // Gatekeeper content is never prefetched. Every browser session must
      // explicitly unlock the audit surface, including developer/admin users.
      setGatekeeper(null);
    } catch (reason) { showError(reason, "Could not load the intelligence desk"); }
    finally { setLoading(false); }
  }, [applySets, showError]);

  useEffect(() => {
    const initialization = window.setTimeout(() => {
      try {
        const existingSession = window.sessionStorage.getItem("signalroom-session-id");
        const nextSession = existingSession || (window.crypto?.randomUUID?.() ?? `session-${Date.now()}`);
        window.sessionStorage.setItem("signalroom-session-id", nextSession); setSessionId(nextSession);
        const storedTheme = window.localStorage.getItem("signalroom-theme-default") as ColorTheme | null;
        const storedView = window.localStorage.getItem("signalroom-feed-view-default") as ViewMode | null;
        setTheme(storedTheme === "dark" ? "dark" : "light"); setView(storedView === "cards" || storedView === "dense" ? storedView : "compact");
      } catch { setSessionId(window.crypto?.randomUUID?.() ?? `session-${Date.now()}`); }
      setDevicePreferencesReady(true);
      void loadDesk();
    }, 0);
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setActivePage("search"); } };
    document.addEventListener("keydown", onKey); return () => { window.clearTimeout(initialization); document.removeEventListener("keydown", onKey); };
  }, [loadDesk]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setReadNotificationIds(new Set(JSON.parse(window.localStorage.getItem(`newsScrapper-notifications-read:${viewer.id}`) || "[]") as string[])); }
      catch { setReadNotificationIds(new Set()); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewer.id]);

  useEffect(() => {
    const timer = window.setInterval(() => { void signalroomApi.notifications(profile).then((rows) => setNotifications((current) => [...rows, ...current.filter((item) => item.kind === "search")].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30))).catch(() => undefined); }, 60_000);
    return () => window.clearInterval(timer);
  }, [profile]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.profile = profile;
    document.documentElement.style.colorScheme = theme;
    if (!devicePreferencesReady) return;
    try {
      window.localStorage.setItem(`signalroom-theme-${profile}`, theme);
      window.localStorage.setItem(`signalroom-feed-view-${profile}`, view);
    } catch { /* Device-only preference remains in memory. */ }
  }, [devicePreferencesReady, profile, theme, view]);

  const track = useCallback((event_type: "page_view" | "article_open" | "article_action" | "search" | "export" | "heartbeat" | "feedback" | "profile_switch", properties: Record<string, string | number | boolean> = {}, article_id?: string) => { if (!sessionId) return; void signalroomApi.event(profile, { event_type, session_id: sessionId, path: `/${activePage}`, article_id, properties, occurred_at: new Date().toISOString() }).catch(() => undefined); }, [activePage, profile, sessionId]);
  useEffect(() => { if (sessionId) track("page_view", { page: activePage }); }, [activePage, profile, sessionId, track]);
  useEffect(() => {
    if (!sessionId) return;
    const heartbeat = (resumed = false) => { if (document.visibilityState === "visible") track("heartbeat", resumed ? { resumed: true } : { visible: true }); };
    const timer = window.setInterval(() => heartbeat(), 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") heartbeat(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [sessionId, track]);
  const navigate = (id: string) => { if (id === "feedback") { setFeedbackOpen(true); setMobileNavOpen(false); return; } if (id === "analytics" && !capabilities.canViewAnalytics) return addToast("Analytics is restricted", "warning"); if ((id === "gatekeeper" || id === "dropped") && !gatekeeper) { setGatekeeperTarget(id); setGatekeeperAccessOpen(true); setMobileNavOpen(false); return; } setActivePage(id); setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const changeProfile = (next: DeskProfile) => { if (!capabilities.canSwitchDeskProfile || next === profile) return; track("profile_switch", { destination_profile: next }); const stored = window.localStorage.getItem(`signalroom-theme-${next}`) as ColorTheme | null; setTheme(stored === "dark" ? "dark" : "light"); void loadDesk(next); };

  const availableArticles = useMemo(() => articles.filter((article) => !hiddenByProfile[profile].has(article.id) && !notInterestedByProfile[profile].has(article.id)), [articles, hiddenByProfile, notInterestedByProfile, profile]);
  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const weights = { critical: 4, high: 3, medium: 2, low: 1 };
    const items = availableArticles.filter((article) => {
      const publishedAt = article.publishedAt ? Date.parse(article.publishedAt) : Date.parse(article.date);
      const afterFrom = !advancedFilters.dateFrom || (Number.isFinite(publishedAt) && publishedAt >= Date.parse(`${advancedFilters.dateFrom}T00:00:00`));
      const beforeTo = !advancedFilters.dateTo || (Number.isFinite(publishedAt) && publishedAt <= Date.parse(`${advancedFilters.dateTo}T23:59:59.999`));
      const status = statusById[article.id] ?? article.status;
      return advancedFilters.contentType !== "cluster"
        && (!needle || `${article.headline} ${article.summary} ${article.keywords.join(" ")} ${article.source}`.toLowerCase().includes(needle))
        && (category === "All categories" || article.category === category)
        && (team === "All teams" || article.team === team)
        && (advancedFilters.region === "all" || article.region === advancedFilters.region)
        && (advancedFilters.source === "all" || article.source === advancedFilters.source)
        && (!advancedFilters.statuses.length || advancedFilters.statuses.includes(status as AdvancedFilters["statuses"][number]))
        && (!advancedFilters.priorities.length || advancedFilters.priorities.includes(article.priority))
        && (!advancedFilters.savedOnly || saved.has(article.id))
        && article.relevance >= advancedFilters.minimumRelevance
        && (!advancedFilters.hasImage || Boolean(article.image))
        && (!advancedFilters.hasSummary || Boolean(article.summary.trim()))
        && afterFrom && beforeTo;
    });
    if (sort === "Latest") return [...items].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
    if (sort === "Oldest") return [...items].sort((a, b) => Date.parse(a.publishedAt ?? "") - Date.parse(b.publishedAt ?? ""));
    if (sort === "Highest priority") return [...items].sort((a, b) => weights[b.priority] - weights[a.priority]);
    if (sort === "Highest confidence") return [...items].sort((a, b) => b.confidence - a.confidence);
    return [...items].sort((a, b) => b.relevance - a.relevance);
  }, [advancedFilters, availableArticles, category, query, saved, sort, statusById, team]);
  const historyIds = useMemo(() => new Set(history.flatMap((snapshot) => snapshot.article_ids)), [history]);
  const workflowIds = useMemo(() => new Set(workflow.map((item) => item.articleId)), [workflow]);
  const searchArticles = useMemo(() => {
    const archiveArticles = history.flatMap((snapshot) => snapshot.articles.map(mapRawArticle));
    const merged = new Map([...availableArticles, ...archiveArticles].map((article) => [article.id, article]));
    return [...merged.values()].filter((article) => !hiddenByProfile[profile].has(article.id) && !notInterestedByProfile[profile].has(article.id));
  }, [availableArticles, hiddenByProfile, history, notInterestedByProfile, profile]);
  const unreadNotifications = useMemo(() => notifications.filter((item) => !readNotificationIds.has(item.id)), [notifications, readNotificationIds]);
  const markNotificationsRead = () => { const next = new Set(notifications.map((item) => item.id)); setReadNotificationIds(next); try { window.localStorage.setItem(`newsScrapper-notifications-read:${viewer.id}`, JSON.stringify([...next])); } catch { /* Device read state is best effort. */ } };
  const recordSearchNotification = (searchQuery: string, resultCount: number, scope: string) => { track("search", { query_length: searchQuery.length, result_count: resultCount, scope }); if (!searchQuery.trim()) return; const item: DeskNotification = { id: `search:${Date.now()}`, kind: "search", title: resultCount ? "Search results ready" : "Search completed", message: resultCount ? `${resultCount} result${resultCount === 1 ? "" : "s"} found for “${searchQuery}”.` : `No saved intelligence matched “${searchQuery}”.`, created_at: new Date().toISOString(), article_id: null }; setNotifications((current) => [item, ...current].slice(0, 30)); };

  const performAction = useCallback(async (id: string, action: ArticleAction, success: string, note?: string) => { try { const result = await signalroomApi.action(profile, id, action, note); const disposition = result.disposition; const replaceSet = (setter: React.Dispatch<React.SetStateAction<ProfileSets>>, present: boolean) => setter((current) => { const next = new Set(current[profile]); if (present) next.add(id); else next.delete(id); return { ...current, [profile]: next }; }); replaceSet(setSelectedByProfile, disposition.selected); replaceSet(setSavedByProfile, disposition.saved); replaceSet(setInterestingByProfile, disposition.interesting === true); replaceSet(setNotInterestedByProfile, disposition.interesting === false); replaceSet(setHiddenByProfile, disposition.hidden); setStatusByProfile((current) => ({ ...current, [profile]: { ...current[profile], [id]: statusFromDisposition(disposition) } })); setGatekeeper((current) => current ? { ...current, articles: current.articles.map((item) => item.article_id === id ? { ...item, disposition } : item) } : current); track("article_action", { action }, id); addToast(success); return true; } catch (reason) { showError(reason, "Article action failed"); return false; } }, [addToast, profile, showError, track]);
  const toggleSelected = (id: string) => void performAction(id, selectedIds.has(id) ? "deselect" : "select", selectedIds.has(id) ? "Removed from Selected" : "Added to Selected");
  const toggleSaved = (id: string) => void performAction(id, saved.has(id) ? "unsave" : "save", saved.has(id) ? "Removed from Saved" : "Saved for later");
  const commitArticleStatus = async (id: string, nextStatus: string, approvalKey?: string) => {
    try {
      if (nextStatus === "New") {
        await signalroomApi.action(profile, id, "clear_review");
        await signalroomApi.action(profile, id, "deselect");
      } else if (nextStatus === "Under Review") {
        await signalroomApi.action(profile, id, "clear_review");
        await signalroomApi.action(profile, id, "mark_under_review");
      } else if (nextStatus === "Selected") {
        await signalroomApi.action(profile, id, "clear_review");
        await signalroomApi.action(profile, id, "select");
      } else if (nextStatus === "Approved") {
        await signalroomApi.action(profile, id, "approve", undefined, approvalKey);
      } else return;
      track("article_action", { action: `status_${nextStatus.toLowerCase().replaceAll(" ", "_")}` }, id);
      await loadDesk(profile);
      addToast(`Article marked ${nextStatus}`);
      return true;
    } catch (reason) { showError(reason, "Article status could not be updated"); return false; }
  };
  const setArticleStatus = async (id: string, nextStatus: string): Promise<void> => {
    if (nextStatus === "Approved") {
      const article = articles.find((item) => item.id === id) ?? searchArticles.find((item) => item.id === id);
      setApprovalArticle({ id, title: article?.headline ?? "this intelligence signal" });
      return;
    }
    await commitArticleStatus(id, nextStatus);
  };
  const setInterest = (id: string, signal: InterestSignal) => { if (signal) void performAction(id, signal === "interesting" ? "interesting" : "not_interested", signal === "interesting" ? "Preference signal recorded" : "Moved to Not Interested"); };
  const hideArticle = (id: string) => void performAction(id, "hide", "Article hidden");
  const selectVisible = async (ids: string[]) => { const all = ids.length > 0 && ids.every((id) => selectedIds.has(id)); try { await signalroomApi.batchAction(profile, ids, all ? "deselect" : "select"); await loadDesk(profile); addToast(all ? "Visible selection cleared" : `${ids.length} articles selected`); } catch (reason) { showError(reason, "Batch action failed"); } };
  const applyBatch = async (action: ArticleAction, copy: string) => { const ids = [...selectedIds]; if (!ids.length) return; try { await signalroomApi.batchAction(profile, ids, action); await loadDesk(profile); addToast(copy); } catch (reason) { showError(reason, "Batch action failed"); } };
  const openArticle = async (article: Article) => { setSelectedArticle(article); track("article_open", {}, article.id); try { const [raw, actions] = await Promise.all([signalroomApi.article(profile, article.id), signalroomApi.articleActions(profile, article.id)]); setSelectedArticle({ ...mapRawArticle(raw), status: statusById[article.id] ?? article.status, decisionTrail: actions.items }); } catch (reason) { showError(reason, "Could not load dossier details"); } };
  const openArticleById = async (id: string) => { const cached = articles.find((item) => item.id === id) ?? searchArticles.find((item) => item.id === id); if (cached) return openArticle(cached); try { const raw = await signalroomApi.article(profile, id); await openArticle(mapRawArticle(raw)); } catch (reason) { showError(reason, "Could not load dossier details"); } };
  const openClusterSource = (source: SourceArticle) => { if (source.articleId) { void openArticleById(source.articleId); return; } if (source.url) { window.open(source.url, "_blank", "noopener,noreferrer"); return; } addToast("This source record has no dossier or original URL", "warning"); };
  const openHistorySnapshot = async (snapshot: BriefingHistoryRecord) => { try { setSelectedBriefing(await signalroomApi.briefing(profile, snapshot.id)); } catch (reason) { showError(reason, "Could not load the complete briefing snapshot"); } };
  const loadMoreHistory = async () => { if (!historyCursor || historyLoadingMore) return; setHistoryLoadingMore(true); try { const page = await signalroomApi.briefings(profile, historyCursor); setHistory((current) => { const seen = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !seen.has(item.id))]; }); setHistoryCursor(page.page.next_cursor); } catch (reason) { showError(reason, "Could not load older briefing snapshots"); } finally { setHistoryLoadingMore(false); } };

  const saveViewer = async (next: ViewerProfile) => { try { const savedPreference = await signalroomApi.savePreferences({ display_name: next.displayName, contact_email: next.contactEmail || null, pet_enabled: next.petEnabled, pet_kind: next.petKind, pet_color: next.petColor }); setViewer({ ...next, displayName: savedPreference.display_name, contactEmail: savedPreference.contact_email ?? "", petEnabled: savedPreference.pet_enabled, petKind: savedPreference.pet_kind, petColor: savedPreference.pet_color }); setOnboardingRequired(false); window.localStorage.removeItem(`signalroom-profile-draft:${next.id}`); addToast(`Saved. ${PRODUCT_NAME} will call you ${savedPreference.display_name}.`); } catch (reason) { try { window.localStorage.setItem(`signalroom-profile-draft:${next.id}`, JSON.stringify({ displayName: next.displayName, contactEmail: next.contactEmail })); } catch { /* draft is best effort */ } showError(reason, "Identity was not saved; the draft remains on this device"); throw reason; } };
  const saveSource = async (source: SourceRecord) => { try { const response = sources.some((item) => item.id === source.id) ? await signalroomApi.updateSource(profile, source) : await signalroomApi.createSource(profile, source); const mapped = mapSource(response); setSources((items) => items.some((item) => item.id === mapped.id) ? items.map((item) => item.id === mapped.id ? mapped : item) : [...items, mapped]); addToast(`${mapped.name} saved`); } catch (reason) { showError(reason, "Source could not be saved"); throw reason; } };
  const submitFeedback = async (submission: Omit<FeedbackSubmission, "id" | "createdAt">) => { const response = await signalroomApi.feedback(profile, submission); track("feedback", { rating: submission.rating, category: submission.category }); if (capabilities.canViewAnalytics) setFeedbackInbox((items) => [response, ...items]); addToast("Thank you — your feedback was added to the product queue"); return response.reference; };
  const startScan = useCallback(async () => { const result = await signalroomApi.scan(profile); setScanJob(result.job); return result.job; }, [profile]);
  const refreshJob = useCallback(async (id: string) => { const job = await signalroomApi.job(id); setScanJob(job); if (job.status === "succeeded") await loadDesk(profile); return job; }, [loadDesk, profile]);

  const renderPage = () => {
    if (loading) return <div className="page-content"><EmptyState icon="◌" title="Loading your intelligence desk" copy="Resolving your profile, feed, worklists, and source configuration…" /></div>;
    if (error && !articles.length && !history.length) return <div className="page-content"><EmptyState icon="!" title="The intelligence desk is unavailable" copy={error} action={<button className="primary-button" onClick={() => void loadDesk(profile)}>Try again</button>} /></div>;
    if (activePage === "briefing" || activePage === "discover") return <BriefingView viewer={viewer} discoverMode={activePage === "discover"} articles={filteredArticles} clusters={clusters} saved={saved} approved={approved} selectedIds={selectedIds} statusById={statusById} view={view} query={query} category={category} team={team} sort={sort} advancedCount={advancedCount} advancedFilters={advancedFilters} onToggleSelected={toggleSelected} onSelectVisible={(ids) => void selectVisible(ids)} onStatus={setArticleStatus} onView={setView} onQuery={setQuery} onCategory={setCategory} onTeam={setTeam} onSort={setSort} onAdvanced={() => setFiltersOpen(true)} onClear={() => { setQuery(""); setCategory("All categories"); setTeam("All teams"); setAdvancedFilters(emptyAdvancedFilters()); }} onOpen={(article) => void openArticle(article)} onOpenClusterSource={openClusterSource} onSave={toggleSaved} onNotInterested={(id) => setInterest(id, "not-interested")} onWorkflow={(article) => void setArticleStatus(article.id, "Under Review")} onExport={() => setExportOpen(true)} onNavigateWorkflow={() => navigate("workflow")} />;
    if (activePage === "search") return <SearchView articles={searchArticles} briefingIds={briefingArticleIds} historyIds={historyIds} workflowIds={workflowIds} savedIds={saved} onSearch={recordSearchNotification} onOpen={(article) => void openArticle(article)} selectedIds={selectedIds} onToggleSelected={toggleSelected} />;
    if (activePage === "selected") return <SelectedView articles={articles} selectedIds={selectedIds} statusById={statusById} saved={saved} onToggleSelected={toggleSelected} onStatus={setArticleStatus} onSave={toggleSaved} onOpen={(article) => void openArticle(article)} onExport={() => setExportOpen(true)} />;
    if (activePage === "workflow") return <WorkflowView items={workflow} onMove={setArticleStatus} onExport={() => setExportOpen(true)} onOpen={(id) => void openArticleById(id)} />;
    if (activePage === "saved") return <SavedView articles={articles} saved={saved} selectedIds={selectedIds} onToggleSelected={toggleSelected} onSave={toggleSaved} onWorkflow={(article) => setArticleStatus(article.id, "Under Review")} onOpen={(article) => void openArticle(article)} onExport={() => setExportOpen(true)} />;
    if (activePage === "gatekeeper" && gatekeeper) return <GatekeeperView audit={gatekeeper} onDropped={() => navigate("dropped")} />;
    if (activePage === "dropped" && gatekeeper) return <DroppedView audit={gatekeeper} onRestore={(id) => void setArticleStatus(id, "Under Review")} onHide={(id) => void performAction(id, "hide", "Article hidden")} onWorkflow={(id) => void setArticleStatus(id, "Under Review")} />;
    if (activePage === "not-interested") return <NotInterestedView articles={articles.filter((article) => notInterestedByProfile[profile].has(article.id) && !hiddenByProfile[profile].has(article.id))} viewerName={viewer.displayName} onRestore={(id) => void performAction(id, "restore", "Story restored")} onRemove={(id) => void performAction(id, "hide", "Story removed")} />;
    if (activePage === "history") return <HistoryView items={history} onOpen={(item) => void openHistorySnapshot(item)} hasMore={Boolean(historyCursor)} loadingMore={historyLoadingMore} onLoadMore={() => void loadMoreHistory()} />;
    if (activePage === "sources") return <SourcesView sources={sources} readOnly={!capabilities.canManageSources} onAdd={() => { setEditingSource(null); setSourceModalOpen(true); }} onEdit={(source) => { setEditingSource(source); setSourceModalOpen(true); }} />;
    if (activePage === "analytics" && capabilities.canViewAnalytics) return <AnalyticsView viewer={viewer} telemetry={analytics} feedback={feedbackInbox} />;
    if (activePage === "settings") return <SettingsView viewer={viewer} theme={theme} onOpenProfile={() => setProfileOpen(true)} onThemeChange={setTheme} />;
    return null;
  };

  const scanRunning = scanJob?.status === "queued" || scanJob?.status === "running";
  return <div className={`signalroom-app ${sidebarCollapsed ? "nav-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""} ${selectedIds.size ? "has-selection" : ""}`} data-profile={profile} data-theme={theme}>
    <a href="#main-content" className="skip-link">Skip to intelligence</a>
    <Sidebar active={activePage} collapsed={sidebarCollapsed} onNavigate={navigate} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} profile={profile} canSwitchProfile={capabilities.canSwitchDeskProfile} canViewAnalytics={capabilities.canViewAnalytics} onProfileChange={changeProfile} onFeedback={() => setFeedbackOpen(true)} sourceCount={sources.filter((source) => source.enabled).length} lastBriefingAt={lastBriefingAt} droppedCount={gatekeeper?.counters.articles.dropped ?? 0} />
    {mobileNavOpen && <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
    <Header pageLabel={pageLabels[activePage] ?? PRODUCT_NAME} onScan={() => setScanOpen(true)} onNotifications={() => setNotificationsOpen(true)} onSearch={() => setActivePage("search")} onMenu={() => { setSidebarCollapsed(false); setMobileNavOpen((open) => !open); }} menuOpen={mobileNavOpen} notificationsCount={unreadNotifications.length} scanRunning={scanRunning} profile={profile} theme={theme} onThemeChange={() => setTheme(theme === "light" ? "dark" : "light")} viewer={viewer} profileOpen={profileOpen} onProfile={() => setProfileOpen(true)} lastBriefingAt={lastBriefingAt} />
    <main id="main-content" tabIndex={-1}>{error && (articles.length > 0 || history.length > 0) && <div className="backend-warning" role="status"><Icon>!</Icon><span>{error}</span><button onClick={() => { setError(null); void loadDesk(profile); }}>Retry</button></div>}{renderPage()}</main>
    {selectedIds.size > 0 && <aside className="batch-action-bar" aria-label="Selected article actions"><div className="batch-count"><span>{selectedIds.size}</span><div><strong>In export tray</strong><small>{profile === "broadcast" ? "Broadcast" : "Default"} profile only</small></div></div><div className="batch-actions"><button onClick={() => navigate("selected")}><Icon>✓</Icon>Open Selected</button><button onClick={() => void applyBatch("mark_under_review", "Selection moved under review")}><Icon>◷</Icon>Under review</button><button onClick={() => void applyBatch("save", "Selection saved")}><Icon>◇</Icon>Save</button><button onClick={() => void applyBatch("interesting", "Preference signals recorded")}><Icon>↑</Icon>Interesting</button><button className="batch-export" onClick={() => setExportOpen(true)}><Icon>↥</Icon>Export {selectedIds.size}</button><button className="batch-clear" onClick={() => void applyBatch("deselect", "Selection cleared")} aria-label="Clear selection">×</button></div></aside>}
    {selectedArticle && <ArticleDetails key={selectedArticle.id} article={selectedArticle} open onClose={() => setSelectedArticle(null)} saved={saved.has(selectedArticle.id)} approved={approved.has(selectedArticle.id)} selected={selectedIds.has(selectedArticle.id)} status={statusById[selectedArticle.id] ?? selectedArticle.status} interest={interestById[selectedArticle.id] ?? null} onToggleSelected={() => toggleSelected(selectedArticle.id)} onStatus={(status) => setArticleStatus(selectedArticle.id, status)} onInterest={(signal) => setInterest(selectedArticle.id, signal)} onHide={() => hideArticle(selectedArticle.id)} onSave={() => toggleSaved(selectedArticle.id)} onApprove={() => setArticleStatus(selectedArticle.id, "Approved")} onNotInterested={() => setInterest(selectedArticle.id, "not-interested")} onExport={() => setExportOpen(true)} canApprove={capabilities.canReviewGatekeeper} />}
    {filtersOpen && <AdvancedFilterDrawer open onClose={() => setFiltersOpen(false)} value={advancedFilters} regions={[...new Set([...articles.map((article) => article.region), ...clusters.map((cluster) => cluster.region)])].filter(Boolean).sort()} sources={[...new Set([...articles.map((article) => article.source), ...clusters.flatMap((cluster) => cluster.sources.map((source) => source.source))])].filter(Boolean).sort()} onApply={setAdvancedFilters} />}
    <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} job={scanJob} canStart={capabilities.canManageJobs} onStart={startScan} onRefresh={refreshJob} onReset={() => setScanJob(null)} />
    <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} selectedCount={selectedIds.size} onExport={async (format) => { const ids = selectedIds.size ? [...selectedIds] : filteredArticles.map((article) => article.id); if (!ids.length) throw new Error("There are no articles to export"); track("export", { format, article_count: ids.length }); await downloadExport(profile, ids, format); }} />
    <NotificationsDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} items={notifications} readIds={readNotificationIds} onMarkAllRead={markNotificationsRead} onOpenArticle={(id) => { setNotificationsOpen(false); void openArticleById(id); }} />
    <DeskPet viewer={viewer} notificationCount={unreadNotifications.length} onOpenNotifications={() => setNotificationsOpen(true)} />
    {approvalArticle && <ApprovalModal open articleTitle={approvalArticle.title} onClose={() => setApprovalArticle(null)} onApprove={async (key) => { const approved = await commitArticleStatus(approvalArticle.id, "Approved", key); if (!approved) throw new Error("The approval key was not accepted."); }} />}
    {gatekeeperAccessOpen && <GatekeeperAccessModal open onClose={() => setGatekeeperAccessOpen(false)} onUnlock={async (key) => { const audit = await signalroomApi.gatekeeper(profile, key); setGatekeeper(audit); setActivePage(gatekeeperTarget); addToast("Gatekeeper unlocked for this session"); }} />}
    {sourceModalOpen && <SourceModal open onClose={() => setSourceModalOpen(false)} source={editingSource} onSave={saveSource} />}
    <HistorySnapshotDrawer snapshot={selectedBriefing} onClose={() => setSelectedBriefing(null)} onOpenArticle={(id) => { setSelectedBriefing(null); void openArticleById(id); }} />
    {profileOpen && <ProfileModal open onClose={() => setProfileOpen(false)} viewer={viewer} accessLabel={capabilities.accessLabel} onSave={saveViewer} required={onboardingRequired} />}
    {feedbackOpen && <FeedbackModal open onClose={() => setFeedbackOpen(false)} viewer={viewer} context={{ page: activePage, profile, theme, articleId: selectedArticle?.id, sessionId }} onSubmit={submitFeedback} />}
    <ToastRegion toasts={toasts} dismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} /><GlobalTooltip />
  </div>;
}
