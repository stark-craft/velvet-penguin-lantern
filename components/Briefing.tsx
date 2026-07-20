"use client";

import { useState } from "react";
import type { AdvancedFilters, Article, SourceArticle, StoryCluster, ViewerProfile, ViewMode } from "@/types/news";
import { ArticleSelectionToggle, EmptyState, Icon, PriorityBadge, SafeImage, ScoreRing, SignalBadge, SourceBadge, StatusBadge } from "@/components/ui";

export function MetricRibbon({ selectedCount, articles, clusters }: { selectedCount: number; articles: Article[]; clusters: StoryCluster[] }) {
  const [expanded, setExpanded] = useState(false);
  const highPriority = articles.filter((article) => article.priority === "critical" || article.priority === "high").length;
  const primaryMetrics = [
    { label: "Retained", value: articles.length + clusters.length, delta: "current briefing", tone: "positive" },
    { label: "Clusters", value: clusters.length, delta: "related coverage", tone: "cluster" },
    { label: "Priority", value: highPriority, delta: "critical or high", tone: "priority" },
    { label: "Selected", value: selectedCount, delta: "export tray", tone: "saved" },
  ];
  const secondaryMetrics = [
    { label: "Articles", value: articles.length, delta: "standalone signals" },
    { label: "Sources represented", value: new Set(articles.map((article) => article.source)).size, delta: "in this feed" },
  ];
  return (
    <section className="briefing-pulse" aria-label="Today’s briefing pulse">
      <div className="briefing-pulse-heading"><div><span className="eyebrow">Decision pulse</span><strong>{articles.length + clusters.length} retained signals · current profile</strong></div><button className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Hide supporting metrics" : "All metrics"}<Icon>{expanded ? "↑" : "↓"}</Icon></button></div>
      <div className="briefing-trace" aria-hidden="true"><i /><i /><i /><i /><span /></div>
      <div className="metric-ribbon metric-ribbon-primary">
        {primaryMetrics.map((metric, index) => <div className={`metric-item metric-${metric.tone}`} key={metric.label}><span className="metric-index">{String(index + 1).padStart(2, "0")}</span><strong>{metric.value}</strong><div><span>{metric.label}</span><small>{metric.delta}</small></div></div>)}
      </div>
      {expanded && <div className="metric-more-grid">{secondaryMetrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.delta}</small></div>)}</div>}
    </section>
  );
}

export function AIDailyOverview({ firstName, articles }: { firstName: string; articles: Article[] }) {
  const leads = articles.slice(0, 3);
  return (
    <aside className="ai-overview">
      <div className="ai-orbit" aria-hidden="true"><span /><i /><b /></div>
      <div className="panel-topline"><span className="ai-label">✦ CURRENT BRIEFING</span><StatusBadge tone="live">Live signal</StatusBadge></div>
      <h2>{leads.length ? `${leads.length} lead signals are ready for review.` : "The first briefing has not been generated yet."}</h2>
      <p>{leads[0]?.summary ?? "Run the configured crawler to create a retained, summarized intelligence briefing."}</p>
      <div className="overview-signals">
        {leads.map((article, index) => <div key={article.id}><span className="signal-number">{String(index + 1).padStart(2, "0")}</span><p><strong>{article.headline}</strong> {article.insight}</p></div>)}
      </div>
      <div className="attention-note">
        <span>{firstName}, {leads.length} signals lead this briefing.</span>
        <p>{leads.length ? "Open each dossier to review provenance, intent, and the recorded Gatekeeper evidence before export." : "There is no fabricated briefing content while the backend is empty."}</p>
      </div>
    </aside>
  );
}

export function FeaturedStory({
  article,
  saved,
  onOpen,
  onSave,
  onNotInterested,
  selected,
  status,
  onToggleSelected,
  onUnderReview,
}: {
  article: Article;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
  onNotInterested: () => void;
  selected: boolean;
  status: string;
  onToggleSelected: () => void;
  onUnderReview: () => void;
}) {
  return (
    <article className={`featured-story ${selected ? "is-selected" : ""}`}>
      <div className="featured-image">
        <SafeImage src={article.image} alt="Lead visual for the featured intelligence signal" />
        <div className="image-shade" />
        <div className="featured-kicker"><span>01 · LEAD SIGNAL</span><span>{article.sourceArticles?.length ?? 1} source report{(article.sourceArticles?.length ?? 1) === 1 ? "" : "s"}</span></div>
        <div className="featured-selection"><ArticleSelectionToggle checked={selected} label={article.headline} onChange={onToggleSelected} /></div>
        <div className="featured-title">
          <div className="story-meta inverse"><PriorityBadge priority={article.priority} /><span>{article.category}</span><span>{article.published}</span></div>
          <h2>{article.headline}</h2>
        </div>
      </div>
      <div className="featured-body">
        <div className="ai-summary-block"><span>✦ AI CONSOLIDATED SUMMARY</span><p>{article.summary}</p></div>
        <div className="entity-row">{article.entities.map((entity) => <span key={entity}>{entity}</span>)}<span className="team-chip">{article.team}</span><SignalBadge signal={article.signal} /></div>
        <div className="featured-actions">
          <button className="primary-button" onClick={onOpen}>Open dossier <Icon>↗</Icon></button>
          <button className={`secondary-button ${status === "Under Review" ? "active" : ""}`} onClick={onUnderReview}><Icon>◷</Icon>{status === "Under Review" ? "Under review" : "Review"}</button>
          <button className={`secondary-button ${saved ? "active" : ""}`} onClick={onSave}><Icon>{saved ? "◆" : "◇"}</Icon>{saved ? "Saved" : "Save"}</button>
          <button className="ghost-button" onClick={onNotInterested}><Icon>⊘</Icon>Not for me</button>
        </div>
      </div>
    </article>
  );
}

export function FilterBar({
  query,
  category,
  team,
  view,
  sort,
  resultCount,
  advancedCount,
  onQuery,
  onCategory,
  onTeam,
  onView,
  onSort,
  onAdvanced,
  onClear,
  allSelected,
  selectedCount,
  onSelectAll,
}: {
  query: string; category: string; team: string; view: ViewMode; sort: string; resultCount: number; advancedCount: number;
  onQuery: (value: string) => void; onCategory: (value: string) => void; onTeam: (value: string) => void; onView: (value: ViewMode) => void; onSort: (value: string) => void; onAdvanced: () => void; onClear: () => void;
  allSelected: boolean; selectedCount: number; onSelectAll: () => void;
}) {
  const active = [query && `“${query}”`, category !== "All categories" && category, team !== "All teams" && team].filter(Boolean) as string[];
  return (
    <div className="filter-shell">
      <div className="filter-bar">
        <button className={`select-visible-button ${allSelected ? "active" : ""}`} onClick={onSelectAll}><span>{allSelected ? "✓" : ""}</span>{allSelected ? "All selected" : "Select visible"}{selectedCount > 0 && <b>{selectedCount}</b>}</button>
        <label className="filter-search"><Icon>⌕</Icon><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Filter today’s intelligence" aria-label="Filter articles by keyword" /></label>
        <label className="select-control"><span className="sr-only">Category</span><select value={category} onChange={(e) => onCategory(e.target.value)}><option>All categories</option><option>AI Agents</option><option>Regulation</option><option>Display Technology</option><option>Broadcasting</option><option>Robotics</option><option>Telecom</option></select></label>
        <label className="select-control"><span className="sr-only">Team</span><select value={team} onChange={(e) => onTeam(e.target.value)}><option>All teams</option><option>Cloud Team</option><option>Hardware Team</option><option>Robotics Team</option><option>TV & Display Team</option><option>Media Intelligence Team</option><option>Regulatory Team</option></select></label>
        <button className="filter-button" onClick={onAdvanced}><Icon>⌁</Icon>More filters{advancedCount > 0 && <span>{advancedCount}</span>}</button>
        <div className="filter-spacer" />
        <span className="result-count"><strong>{resultCount}</strong> visible</span>
        <label className="sort-control"><span>Sort</span><select value={sort} onChange={(e) => onSort(e.target.value)}><option>Most relevant</option><option>Latest</option><option>Oldest</option><option>Highest priority</option><option>Most sources</option><option>Highest confidence</option></select></label>
        <div className="view-switch" role="group" aria-label="Feed view">
          <button className={view === "cards" ? "active" : ""} onClick={() => onView("cards")} aria-label="Comfortable card view"><Icon>▦</Icon></button>
          <button className={view === "compact" ? "active" : ""} onClick={() => onView("compact")} aria-label="Compact editorial index"><Icon>☷</Icon></button>
          <button className={view === "dense" ? "active" : ""} onClick={() => onView("dense")} aria-label="Dense intelligence table"><Icon>≡</Icon></button>
        </div>
      </div>
      {active.length > 0 && <div className="active-filter-row"><span>Active</span>{active.map((item) => <button key={item} onClick={item.startsWith("“") ? () => onQuery("") : item === category ? () => onCategory("All categories") : () => onTeam("All teams")}>{item} ×</button>)}<button className="clear-filters" onClick={onClear}>Clear all</button><span className="preset-pill">Preset · Executive watch</span></div>}
    </div>
  );
}

export function ArticleCard({
  article,
  view,
  saved,
  approved,
  onOpen,
  onSave,
  onNotInterested,
  onWorkflow,
  selected,
  status,
  onToggleSelected,
  onUnderReview,
  rank,
}: {
  article: Article; view: ViewMode; saved: boolean; approved: boolean;
  onOpen: () => void; onSave: () => void; onNotInterested: () => void; onWorkflow: () => void;
  selected: boolean; status: string; onToggleSelected: () => void; onUnderReview: () => void;
  rank?: number | string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (view === "dense") {
    return (
      <article className={`article-card dense-card priority-${article.priority} ${selected ? "is-selected" : ""}`}>
        <span className={`status-rail ${approved ? "approved" : ""}`} />
        <div className="dense-select-cell"><span className="signal-index" aria-hidden="true">{String(rank ?? 0).padStart(2, "0")}</span><ArticleSelectionToggle checked={selected} label={article.headline} onChange={onToggleSelected} compact /></div>
        <ScoreRing value={article.relevance} />
        <button className="dense-headline" onClick={onOpen}>{article.headline}</button>
        <span className="dense-source"><SourceBadge code={article.sourceCode} name={article.source} />{article.source}</span>
        <span>{article.team.replace(" Team", "")}</span><span>{article.published}</span><StatusBadge tone={status === "Approved" ? "approved" : status === "Selected" ? "ai" : "review"}>{status}</StatusBadge>
        <button className="icon-button" onClick={onSave} aria-label={saved ? "Remove from saved" : "Save article"}><Icon>{saved ? "◆" : "◇"}</Icon></button>
      </article>
    );
  }
  return (
    <article className={`article-card ${view === "compact" ? "compact-card" : "standard-card"} priority-${article.priority} ${selected ? "is-selected" : ""}`}>
      <div className="article-selection-cell"><span className="signal-index" aria-hidden="true">{String(rank ?? 0).padStart(2, "0")}</span><ArticleSelectionToggle checked={selected} label={article.headline} onChange={onToggleSelected} compact /></div>
      <div className="article-image"><SafeImage src={article.image} alt="" /><span className="image-score">{article.relevance}% match</span></div>
      <div className="article-content">
        <div className="article-topline">
          <span className="source-line"><SourceBadge code={article.sourceCode} name={article.source} /><strong>{article.source}</strong><span>{article.published}</span></span>
          <span className="card-badges"><PriorityBadge priority={article.priority} /><StatusBadge tone={status === "Approved" ? "approved" : status === "Selected" ? "ai" : "review"}>{status}</StatusBadge></span>
        </div>
        <button className="article-title" onClick={onOpen}><h3>{article.headline}</h3></button>
        <div className="ai-card-summary"><span>✦ AI SUMMARY</span><p>{article.summary}</p></div>
        <div className="article-meta"><span>{article.category}</span><span>{article.team}</span><SignalBadge signal={article.signal} /></div>
        {expanded && <div className="article-expanded"><div><span>AI OPINION</span><p>{article.insight}</p></div><div><span>KEYWORDS</span><p>{article.keywords.join(" · ")}</p></div></div>}
        <div className="article-actions">
          <button className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Less context" : "Why it matters"} <Icon>{expanded ? "↑" : "↓"}</Icon></button>
          <div className="article-action-set">
            <button className={`icon-button ${status === "Under Review" ? "active" : ""}`} onClick={onUnderReview} aria-label="Mark article under review"><Icon>◷</Icon></button>
            <button className="icon-button" onClick={onSave} aria-label={saved ? "Remove from saved" : "Save article"}><Icon>{saved ? "◆" : "◇"}</Icon></button>
            <button className="icon-button" onClick={onWorkflow} aria-label="Add article to workflow"><Icon>＋</Icon></button>
            <button className="icon-button" onClick={onNotInterested} aria-label="Mark article not interested"><Icon>⊘</Icon></button>
            <button className="secondary-button compact-action" onClick={onOpen}>Open dossier <Icon>↗</Icon></button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ClusterCard({ cluster, view, onOpen, rank }: { cluster: StoryCluster; view: ViewMode; onOpen: (source?: StoryCluster["sources"][number]) => void; rank?: number | string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`cluster-card cluster-${view}`}>
      <span className="cluster-signal-index" aria-hidden="true">{String(rank ?? 0).padStart(2, "0")}</span>
      <span className="cluster-bracket" aria-hidden="true" />
      <div className="cluster-heading">
        <div className="cluster-image-stack"><i /><i /><SafeImage src={cluster.image} alt="" /></div>
        <div className="cluster-copy">
          <div className="cluster-kicker"><span>CLUSTER · {cluster.sources.length} REPORTS</span><span>{cluster.timeRange}</span></div>
          <h3>{cluster.title}</h3>
          {view !== "dense" && <div className="cluster-summary"><span>✦ CONSOLIDATED BY AI</span><p>{cluster.summary}</p></div>}
          <div className="article-meta"><span>{cluster.category}</span><span>{cluster.team}</span><span>{cluster.region}</span><SignalBadge signal={cluster.signal} /></div>
        </div>
        <div className="cluster-confidence"><ScoreRing value={cluster.confidence} label="Cluster confidence" /><small>cluster<br />confidence</small></div>
      </div>
      <div className="cluster-source-strip"><div className="source-stack">{cluster.sources.map((source) => <SourceBadge key={source.source} code={source.code} name={source.source} />)}</div><span>{cluster.entities.join(" · ")}</span><button className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Collapse comparison" : "Compare sources"} <Icon>{expanded ? "↑" : "↓"}</Icon></button></div>
      {expanded && <div className="source-comparison">{cluster.sources.map((source, index) => <div className="source-comparison-row" key={source.source}><span className="timeline-node">{index + 1}</span><SourceBadge code={source.code} name={source.source} /><div><strong>{source.source} · {source.time}</strong><button onClick={() => onOpen(source)}>{source.headline}</button><p>{source.summary}</p></div><div className="similarity"><strong>{source.similarity}%</strong><span>similarity</span>{source.duplicate && <StatusBadge tone="duplicate">{source.duplicate}</StatusBadge>}</div><button className="icon-button" onClick={() => onOpen(source)} aria-label={`Open ${source.source} dossier`}><Icon>↗</Icon></button></div>)}</div>}
    </article>
  );
}

export function LiveDesk({ onReview, articles }: { onReview: () => void; articles: Article[] }) {
  const keywordCounts = new Map<string, number>();
  articles.forEach((article) => article.keywords.forEach((keyword) => keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1)));
  const topics = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const entities = [...new Set(articles.flatMap((article) => article.entities))].slice(0, 6);
  const reviewCount = articles.filter((article) => article.status === "Under Review").length;
  return (
    <aside className="live-desk">
      <div className="live-desk-header"><div><span className="eyebrow">Live desk</span><h3>Signals building now</h3></div><span className="pulse-dot" /></div>
      <section><span className="side-section-title">Emerging topics</span>{topics.map(([label, count]) => <div className="topic-row" key={label}><div><strong>{label}</strong><span>{count}</span></div><i><b style={{ width: `${Math.min(100, count * 20)}%` }} /></i></div>)}</section>
      <section><span className="side-section-title">Watched entities</span><div className="entity-cloud">{entities.map((entity) => <span key={entity}>{entity}</span>)}</div></section>
      <section className="review-queue"><div><span className="side-section-title">Review queue</span><strong>{reviewCount} items</strong></div><p>Items you moved under review appear in the shared workflow.</p><button className="secondary-button" onClick={onReview}>Open workflow <Icon>→</Icon></button></section>
    </aside>
  );
}

export function BriefingView({
  viewer,
  articles,
  clusters,
  saved,
  approved,
  selectedIds,
  statusById,
  view,
  query,
  category,
  team,
  sort,
  onView,
  onQuery,
  onCategory,
  onTeam,
  onSort,
  onAdvanced,
  onClear,
  onOpen,
  onSave,
  onNotInterested,
  onWorkflow,
  onExport,
  onNavigateWorkflow,
  onToggleSelected,
  onSelectVisible,
  onStatus,
  advancedCount = 0,
  advancedFilters,
  onOpenClusterSource,
  discoverMode = false,
}: {
  viewer: ViewerProfile;
  articles: Article[]; clusters: StoryCluster[]; saved: Set<string>; approved: Set<string>; selectedIds: Set<string>; statusById: Record<string, string>; view: ViewMode; query: string; category: string; team: string; sort: string;
  onView: (view: ViewMode) => void; onQuery: (value: string) => void; onCategory: (value: string) => void; onTeam: (value: string) => void; onSort: (value: string) => void; onAdvanced: () => void; onClear: () => void;
  onOpen: (article: Article) => void; onOpenClusterSource: (source: SourceArticle) => void; onSave: (id: string) => void; onNotInterested: (id: string) => void; onWorkflow: (article: Article) => void; onExport: () => void; onNavigateWorkflow: () => void; onToggleSelected: (id: string) => void; onSelectVisible: (ids: string[]) => void; onStatus: (id: string, status: string) => void; advancedCount?: number; advancedFilters: AdvancedFilters; discoverMode?: boolean;
}) {
  const featured = articles[0];
  const feedArticles = discoverMode ? articles : articles.slice(1);
  const firstName = viewer.displayName.trim().split(/\s+/)[0] || "Analyst";
  const clusterNeedle = query.trim().toLowerCase();
  const visibleClusters = clusters.filter((cluster) => {
    const haystack = `${cluster.title} ${cluster.summary} ${cluster.category} ${cluster.team} ${cluster.region} ${cluster.entities.join(" ")} ${cluster.sources.map((source) => `${source.source} ${source.headline} ${source.summary}`).join(" ")}`.toLowerCase();
    const publishedAt = cluster.publishedAt ? Date.parse(cluster.publishedAt) : 0;
    const afterFrom = !advancedFilters.dateFrom || (publishedAt > 0 && publishedAt >= Date.parse(`${advancedFilters.dateFrom}T00:00:00`));
    const beforeTo = !advancedFilters.dateTo || (publishedAt > 0 && publishedAt <= Date.parse(`${advancedFilters.dateTo}T23:59:59.999`));
    return advancedFilters.contentType !== "article" && !advancedFilters.savedOnly && advancedFilters.statuses.length === 0 &&
      (!clusterNeedle || haystack.includes(clusterNeedle)) &&
      (category === "All categories" || cluster.category === category) &&
      (team === "All teams" || cluster.team === team) &&
      (advancedFilters.region === "all" || cluster.region === advancedFilters.region) &&
      (advancedFilters.source === "all" || cluster.sources.some((source) => source.source === advancedFilters.source)) &&
      (!advancedFilters.priorities.length || advancedFilters.priorities.includes(cluster.priority)) &&
      cluster.confidence >= advancedFilters.minimumRelevance &&
      (!advancedFilters.hasImage || Boolean(cluster.image)) &&
      (!advancedFilters.hasSummary || Boolean(cluster.summary.trim())) &&
      afterFrom && beforeTo;
  });
  type FeedItem =
    | { kind: "article"; id: string; priority: Article["priority"]; time: number; score: number; sourceCount: number; article: Article }
    | { kind: "cluster"; id: string; priority: StoryCluster["priority"]; time: number; score: number; sourceCount: number; cluster: StoryCluster };
  const toMinutes = (value: string) => {
    const match = value.match(/(\d{1,2}):(\d{2})/g)?.at(-1);
    if (!match) return 0;
    const [hours, minutes] = match.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const feedItems: FeedItem[] = [
    ...feedArticles.map((article) => ({ kind: "article" as const, id: article.id, priority: article.priority, time: toMinutes(article.published), score: sort === "Highest confidence" ? article.confidence : article.relevance, sourceCount: 1, article })),
    ...visibleClusters.map((cluster) => ({ kind: "cluster" as const, id: cluster.id, priority: cluster.priority, time: toMinutes(cluster.timeRange), score: cluster.confidence, sourceCount: cluster.sources.length + 2, cluster })),
  ];
  const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  const sortedFeedItems = [...feedItems].sort((a, b) => {
    if (sort === "Latest") return b.time - a.time;
    if (sort === "Oldest") return a.time - b.time;
    if (sort === "Highest priority") return priorityWeight[b.priority] - priorityWeight[a.priority] || b.score - a.score;
    if (sort === "Most sources") return b.sourceCount - a.sourceCount || b.score - a.score;
    return b.score - a.score;
  });
  const chronological = sort === "Latest" || sort === "Oldest";
  const priorityItems = sortedFeedItems.filter((item) => item.priority === "critical" || item.priority === "high");
  const moreItems = sortedFeedItems.filter((item) => item.priority !== "critical" && item.priority !== "high");
  const sections = chronological
    ? [{ number: "01", title: sort === "Latest" ? "Latest signals" : "Oldest first", copy: "Articles and clusters in publication order", items: sortedFeedItems }]
    : [
        { number: "01", title: "Priority signals", copy: "Critical and high-confidence stories first", items: priorityItems },
        { number: "02", title: "More intelligence", copy: "The rest of today’s retained desk", items: moreItems },
      ].filter((section) => section.items.length > 0);
  const openClusterSource = (cluster: StoryCluster, source?: StoryCluster["sources"][number]) => {
    const target = source ?? cluster.sources[0];
    if (target) onOpenClusterSource(target);
  };
  const renderFeedItem = (item: FeedItem) => {
    if (item.kind === "cluster") return <ClusterCard key={item.id} rank={`C${visibleClusters.findIndex((cluster) => cluster.id === item.id) + 1}`} cluster={item.cluster} view={view} onOpen={(source) => openClusterSource(item.cluster, source)} />;
    const article = item.article;
    const rank = sortedFeedItems.findIndex((candidate) => candidate.id === item.id) + (discoverMode ? 1 : 2);
    return <ArticleCard key={article.id} rank={rank} article={article} view={view} saved={saved.has(article.id)} approved={approved.has(article.id)} selected={selectedIds.has(article.id)} status={statusById[article.id] ?? article.status} onToggleSelected={() => onToggleSelected(article.id)} onUnderReview={() => onStatus(article.id, "Under Review")} onOpen={() => onOpen(article)} onSave={() => onSave(article.id)} onNotInterested={() => onNotInterested(article.id)} onWorkflow={() => onWorkflow(article)} />;
  };
  const selectableIds = articles.map((article) => article.id);
  const visibleSignalCount = articles.length + visibleClusters.length;
  const hasResults = visibleSignalCount > 0;
  return (
    <div className="page-content briefing-page">
      <div className="page-masthead personalized-masthead"><div><span className="eyebrow">{discoverMode ? `Signal stream · ${visibleSignalCount} visible` : `Morning intelligence · ${visibleSignalCount} ready`}</span><h1>{discoverMode ? `Explore the live desk, ${firstName}.` : `Good morning, ${firstName}.`}</h1><p>{discoverMode ? "Every retained signal, clustered and ranked as it arrives." : hasResults ? "Your latest backend-generated briefing is ready for review." : "No briefing has been generated for this profile yet."}</p><span className="personalization-note"><Icon>◎</Icon>Personalized workspace · shared desk intelligence</span></div><div className="masthead-actions"><button className="primary-button" onClick={onExport} disabled={!articles.length}><Icon>↥</Icon>Export briefing</button></div></div>
      {!discoverMode && featured && <><MetricRibbon selectedCount={selectedIds.size} articles={articles} clusters={clusters} /><div className="lead-grid"><FeaturedStory article={featured} saved={saved.has(featured.id)} selected={selectedIds.has(featured.id)} status={statusById[featured.id] ?? featured.status} onToggleSelected={() => onToggleSelected(featured.id)} onUnderReview={() => onStatus(featured.id, "Under Review")} onOpen={() => onOpen(featured)} onSave={() => onSave(featured.id)} onNotInterested={() => onNotInterested(featured.id)} /><AIDailyOverview firstName={firstName} articles={articles} /></div></>}
      <div className="feed-heading"><div><span className="eyebrow">{discoverMode ? "All retained intelligence" : "Intelligence stream"}</span><h2>{discoverMode ? "Latest signals" : "What else is moving"}</h2></div><span className="feed-updated"><i />Updated just now</span></div>
      <FilterBar query={query} category={category} team={team} view={view} sort={sort} resultCount={visibleSignalCount} advancedCount={advancedCount} allSelected={selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))} selectedCount={selectedIds.size} onSelectAll={() => onSelectVisible(selectableIds)} onQuery={onQuery} onCategory={onCategory} onTeam={onTeam} onView={onView} onSort={onSort} onAdvanced={onAdvanced} onClear={onClear} />
      {view === "dense" && <div className="dense-header"><span>Select</span><span>Score</span><span>Headline</span><span>Source</span><span>Team</span><span>Published</span><span>Status</span><span /></div>}
      {!hasResults ? <EmptyState icon="⌕" title="No signals match these filters" copy="Try removing a category, widening the team scope, or clearing the keyword search." action={<button className="primary-button" onClick={onClear}>Clear all filters</button>} /> : <div className="feed-layout"><div className="feed-main signal-trace-feed">
        {sections.map((section) => <section className="feed-section" key={section.title}><header className="feed-section-heading"><div><span className="section-number">{section.number}</span><div><strong>{section.title}</strong><small>{section.copy}</small></div></div><span>{section.items.length}</span></header>{section.items.map(renderFeedItem)}</section>)}
      </div><LiveDesk onReview={onNavigateWorkflow} articles={articles} /></div>}
    </div>
  );
}
