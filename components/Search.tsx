"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Article } from "@/types/news";
import { ArticleSelectionToggle, EmptyState, Icon, SourceBadge, StatusBadge } from "@/components/ui";

type SearchScope = "all" | "briefing" | "history" | "workflow" | "saved";
type SearchSort = "relevance" | "latest" | "category" | "source";

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term.trim()) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}

function publishedTime(article: Article) {
  const value = article.publishedAt ?? article.date;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SearchView({
  articles,
  briefingIds,
  historyIds,
  workflowIds,
  savedIds,
  onOpen,
  selectedIds,
  onToggleSelected,
  onSearch,
}: {
  articles: Article[];
  briefingIds: Set<string>;
  historyIds: Set<string>;
  workflowIds: Set<string>;
  savedIds: Set<string>;
  onOpen: (article: Article) => void;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onSearch: (query: string, resultCount: number, scope: SearchScope) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const inScope = (article: Article) => scope === "all"
      || (scope === "briefing" && briefingIds.has(article.id))
      || (scope === "history" && historyIds.has(article.id))
      || (scope === "workflow" && workflowIds.has(article.id))
      || (scope === "saved" && savedIds.has(article.id));
    const matches = articles.filter((article) => inScope(article) && (!needle || `${article.headline} ${article.summary} ${article.insight} ${article.keywords.join(" ")} ${article.entities.join(" ")} ${article.source} ${article.region} ${article.team}`.toLowerCase().includes(needle)));
    if (sort === "latest") return [...matches].sort((a, b) => publishedTime(b) - publishedTime(a));
    if (sort === "category") return [...matches].sort((a, b) => a.category.localeCompare(b.category) || b.relevance - a.relevance);
    if (sort === "source") return [...matches].sort((a, b) => a.source.localeCompare(b.source) || b.relevance - a.relevance);
    return [...matches].sort((a, b) => b.relevance - a.relevance);
  }, [articles, briefingIds, historyIds, query, savedIds, scope, sort, workflowIds]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (query.trim()) onSearch(query.trim(), results.length, scope); };
  const scopeLabels: Record<SearchScope, string> = { all: "All loaded intelligence", briefing: "Current briefing", history: "30-day history", workflow: "Workflow", saved: "Saved" };

  return (
    <div className="page-content search-page">
      <div className="page-masthead"><div><span className="eyebrow">Intelligence retrieval</span><h1>Search</h1><p>Search the current profile’s loaded briefing, worklists, saved records, and rolling 30-day archive.</p></div></div>
      <div className="local-search-view">
        <form className="search-hero" onSubmit={submit}>
          <span className="eyebrow">Search the desk</span>
          <h2>Find the signal you remember.</h2>
          <p>Results come only from intelligence already returned by the Signalroom backend.</p>
          <label className="hero-search"><Icon>⌕</Icon><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search headlines, summaries, entities, sources, or keywords" /><kbd>↵</kbd></label>
        </form>
        <div className="search-controls"><div><label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as SearchScope)}>{Object.entries(scopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as SearchSort)}><option value="relevance">Relevance</option><option value="latest">Latest publication</option><option value="category">Category</option><option value="source">Source</option></select></label></div><span><strong>{results.length}</strong> results in {scopeLabels[scope].toLowerCase()}</span></div>
        {!query && <EmptyState icon="⌕" title="Search the current profile" copy="Enter a phrase, then narrow the real result set by briefing, history, workflow, or saved status." />}
        {query && <section className="search-results"><div className="section-title-row"><div><span className="eyebrow">Local results</span><h3>Matches for “{query}”</h3></div><StatusBadge tone="neutral">{scopeLabels[scope]}</StatusBadge></div>{results.length ? results.map((article) => <article className={`search-result-card ${selectedIds.has(article.id) ? "is-selected" : ""}`} key={article.id}><ArticleSelectionToggle checked={selectedIds.has(article.id)} label={article.headline} onChange={() => onToggleSelected(article.id)} compact /><SourceBadge code={article.sourceCode} name={article.source} /><div><div className="search-result-meta"><span>{article.source}</span><span>{article.date}</span><span>{article.category}</span></div><button onClick={() => onOpen(article)}><h3><Highlight text={article.headline} term={query} /></h3></button><p><Highlight text={article.summary} term={query} /></p><div className="search-result-footer"><StatusBadge tone="ai">✦ AI summary</StatusBadge><span>{article.team}</span><span>{article.relevance}% relevance</span></div></div><button className="secondary-button" onClick={() => onOpen(article)} aria-label={`Open ${article.headline}`}>Open dossier <Icon>↗</Icon></button></article>) : <EmptyState icon="⌕" title="No intelligence found" copy="Try a company name, source, technology, category, or broader phrase." action={<button className="secondary-button" onClick={() => setQuery("")}>Clear search</button>} />}</section>}
      </div>
      <section className="research-config"><div className="research-config-title"><div><span className="eyebrow">Web-wide research</span><h2>Global search is not available yet</h2><p>No ad-hoc web-search endpoint exists in the backend, so this version does not request credentials or display external results.</p></div><StatusBadge tone="neutral">Not connected</StatusBadge></div></section>
    </div>
  );
}
