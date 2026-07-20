"use client";

import { useEffect, useState } from "react";
import type { ScanJob } from "@/lib/signalroom-client";
import type { AdvancedFilters, Article, BriefingHistoryRecord, FeedbackCategory, FeedbackSubmission, InterestSignal, SourceRecord, ViewerProfile } from "@/types/news";
import { Drawer, Icon, Modal, PriorityBadge, SafeImage, ScoreRing, SignalBadge, SourceBadge, StatusBadge } from "@/components/ui";

export function ArticleDetails({
  article,
  open,
  onClose,
  saved,
  approved,
  selected,
  status,
  interest,
  onToggleSelected,
  onStatus,
  onInterest,
  onHide,
  onSave,
  onApprove,
  onNotInterested,
  onExport,
  canApprove,
}: {
  article: Article | null; open: boolean; onClose: () => void; saved: boolean; approved: boolean;
  selected: boolean; status: string; interest: InterestSignal; onToggleSelected: () => void; onStatus: (status: string) => void; onInterest: (signal: InterestSignal) => void; onHide: () => void;
  onSave: () => void; onApprove: () => void; onNotInterested: () => void; onExport: () => void; canApprove: boolean;
}) {
  const [tab, setTab] = useState<"overview" | "sources" | "trail">("overview");
  if (!article) return null;
  const intent = article.intent || (article.signal === "risk" ? "Risk signal" : article.signal === "opportunity" ? "Opportunity signal" : "No intent classification available");
  const intentConfidence = Math.min(98, article.confidence + (article.signal === "mixed" ? -4 : 1));
  const sourceRows = article.sourceArticles?.length ? article.sourceArticles.map((source) => ({ ...source, title: source.headline, primary: Boolean(source.primary) })) : [{ code: article.sourceCode, source: article.source, time: article.published, title: article.headline, summary: article.summary, similarity: 100, primary: true, url: article.canonicalUrl }];
  return (
    <Drawer open={open} onClose={onClose} title="Intelligence dossier" label={`${article.source} · ${article.date} · ${article.published}`} className="article-drawer dossier-drawer" footer={<div className="drawer-action-bar dossier-decision-dock"><button className={`secondary-button select-dossier-button ${selected ? "active" : ""}`} onClick={onToggleSelected}><Icon>{selected ? "✓" : "＋"}</Icon>{selected ? "In export tray" : "Select article"}</button><button className={`secondary-button ${status === "Under Review" ? "active" : ""}`} onClick={() => onStatus("Under Review")}><Icon>◷</Icon>Under review</button><button className={`secondary-button ${saved ? "active" : ""}`} onClick={onSave}><Icon>{saved ? "◆" : "◇"}</Icon>{saved ? "Saved" : "Save for later"}</button>{canApprove && <button className={`primary-button ${approved ? "approved-button" : ""}`} onClick={onApprove}><Icon>✓</Icon>{approved ? "Approved" : "Approve"}</button>}<button className="secondary-button" onClick={onExport}><Icon>↥</Icon>Export</button></div>}>
      <article className="article-detail-content dossier-content">
        <div className="dossier-hero"><SafeImage src={article.image} alt="Lead image for this article" /><div className="dossier-hero-gradient" /><div className="dossier-hero-meta"><PriorityBadge priority={article.priority} /><SignalBadge signal={article.signal} /><StatusBadge tone={status === "Approved" ? "approved" : status === "Selected" ? "ai" : "review"}>{status}</StatusBadge></div></div>
        <header className="dossier-title-block"><div className="detail-source"><SourceBadge code={article.sourceCode} name={article.source} /><span><strong>{article.source}</strong><small>{article.author} · Published {article.date}, {article.published}</small></span>{article.canonicalUrl && <a className="secondary-button" href={article.canonicalUrl} target="_blank" rel="noreferrer">Open original <Icon>↗</Icon></a>}</div><h1>{article.headline}</h1><p>{article.summary}</p></header>
        <nav className="dossier-tabs" aria-label="Dossier sections"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>Sources <span>{sourceRows.length}</span></button><button className={tab === "trail" ? "active" : ""} onClick={() => setTab("trail")}>Decision trail</button></nav>
        <div className="dossier-grid"><div className="dossier-main">
          {tab === "overview" && <>
            <section className="dossier-section dossier-summary"><div className="dossier-section-heading"><div><span>✦ GENERATED SUMMARY</span><h2>What happened</h2></div><StatusBadge tone="ai">Model output</StatusBadge></div><p>{article.summary}</p><div className="summary-facts"><div><span>Detected intent</span><strong>{intent}</strong></div><div><span>Source coverage</span><strong>{sourceRows.length} persisted source record{sourceRows.length === 1 ? "" : "s"}</strong></div></div></section>
            <section className="dossier-section"><div className="dossier-section-heading"><div><span>WHY IT MATTERS</span><h2>Intent interpretation</h2></div></div><p>{article.insight}</p></section>
            <section className="dossier-section"><div className="dossier-section-heading"><div><span>PROVENANCE</span><h2>Source constellation</h2></div><button className="text-button" onClick={() => setTab("sources")}>Compare all sources <Icon>→</Icon></button></div><div className="source-constellation">{sourceRows.slice(0,3).map((source, index) => <div key={`${source.source}-${source.time}-${index}`}><SourceBadge code={source.code} name={source.source} /><span><strong>{source.source}</strong><small>{source.time} · {source.similarity}% aligned</small></span><StatusBadge tone={source.primary ? "approved" : "neutral"}>{source.primary ? "Primary" : "Related"}</StatusBadge></div>)}</div></section>
          </>}
          {tab === "sources" && <section className="dossier-section dossier-sources"><div className="dossier-section-heading"><div><span>ALL SOURCE ARTICLES</span><h2>{sourceRows.length} persisted reports</h2></div></div><p className="section-intro">The crawler preserves each canonical source attached to this article.</p>{sourceRows.map((source, index) => <article key={`${source.source}-${source.time}-${index}`}><SourceBadge code={source.code} name={source.source} /><div><span><strong>{source.source}</strong><small>{source.time}</small></span><h3>{source.title}</h3><p>{source.summary}</p></div><div><strong>{source.similarity}%</strong><small>{source.primary ? "canonical" : "similarity"}</small>{source.url && <a className="icon-button" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.source} source article`}><Icon>↗</Icon></a>}</div></article>)}</section>}
          {tab === "trail" && <section className="dossier-section dossier-trail"><div className="dossier-section-heading"><div><span>AUDITABLE WORKFLOW</span><h2>Decision trail</h2></div><StatusBadge tone="approved">Live</StatusBadge></div>{article.decisionTrail?.length ? article.decisionTrail.map((event, index) => <div className="trail-event" key={event.id}><span>{index + 1}</span><time>{new Date(event.occurred_at).toLocaleString()}</time><div><strong>{event.action.replaceAll("_", " ")}</strong><p>{event.note || `Recorded for ${event.profile} profile`}</p></div></div>) : <p>No editorial actions have been recorded for this article.</p>}</section>}
        </div><aside className="dossier-rail">
          <section className="rail-status"><span>CURRENT DECISION</span><div><StatusBadge tone={status === "Approved" ? "approved" : status === "Selected" ? "ai" : "review"}>{status}</StatusBadge><button className="text-button" onClick={() => onStatus("Selected")}>Mark Selected</button></div></section>
          <section><span>INTENT CLASSIFICATION</span><h3>{intent}</h3><div className="intent-score"><i><b style={{ width: `${intentConfidence}%` }} /></i><strong>{intentConfidence}%</strong></div><small>Persisted model output</small></section>
          <section><span>SIGNAL CONTEXT</span><dl><div><dt>Region</dt><dd>{article.region}</dd></div><div><dt>Category</dt><dd>{article.category}</dd></div><div><dt>Desk</dt><dd>{article.team}</dd></div><div><dt>Published</dt><dd>{article.date}</dd></div><div><dt>Source quality</dt><dd>{article.credibility}/100</dd></div></dl></section>
          <section><span>MATCHED KEYWORDS</span><div className="rail-keywords">{article.keywords.map((item, index) => <b key={`${item}-${index}`}><i>{index + 1}</i>{item}</b>)}</div><small>Matched against this profile’s keyword configuration.</small></section>
          <section><span>GATEKEEPER EVIDENCE</span><div className="rail-confidence"><ScoreRing value={article.confidence} label="Gatekeeper confidence" /><p><strong>{article.gatekeeper.verdict}</strong>{article.gatekeeper.reason}</p></div></section>
          <section className="rail-training"><span>TRAIN THE RECOMMENDER</span><button className={interest === "interesting" ? "active" : ""} onClick={() => onInterest("interesting")}><Icon>↑</Icon><span><strong>Interesting</strong><small>More signals like this</small></span></button><button className={interest === "not-interested" ? "active danger" : ""} onClick={onNotInterested}><Icon>⊘</Icon><span><strong>Not interested</strong><small>Reduce similar coverage</small></span></button><button className="danger" onClick={onHide}><Icon>◌</Icon><span><strong>Hide article</strong><small>Remove from this profile</small></span></button></section>
        </aside></div>
      </article>
    </Drawer>
  );
}

export function ProfileModal({
  open,
  onClose,
  viewer,
  accessLabel,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  viewer: ViewerProfile;
  accessLabel: string;
  onSave: (viewer: ViewerProfile) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(viewer.displayName);
  const [contactEmail, setContactEmail] = useState(viewer.contactEmail);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const trimmedName = displayName.trim();
  const emailValid = !contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const firstName = trimmedName.split(/\s+/)[0] || "Analyst";
  const canSave = trimmedName.length > 0 && trimmedName.length <= 60 && emailValid;
  const save = async () => { setSaving(true); setSaveError(null); try { await onSave({ ...viewer, displayName: trimmedName, contactEmail: contactEmail.trim() }); onClose(); } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Identity could not be saved"); } finally { setSaving(false); } };
  return <Modal open={open} onClose={onClose} title="Your Signalroom identity" eyebrow="Personalize this desk" className="profile-modal" dialogId="profile-dialog" footer={<><button className="ghost-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" disabled={!canSave || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save identity"} <Icon>✓</Icon></button></>}>
    <div className="profile-preview"><div className="profile-preview-mark"><i /><i /><i /><i /></div><div><span>YOUR NEXT BRIEFING</span><h3>Good morning, {firstName}.</h3><p>Your name personalizes the desk’s greetings, ownership labels, and saved intelligence—without pretending the shared feed is different.</p></div></div>
    <div className="profile-form-grid">
      <label className="field-label"><span>What should Signalroom call you?</span><input value={displayName} maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your preferred name" autoComplete="name" aria-required="true" /><small>{displayName.length}/60 · You can change this any time.</small></label>
      <label className="field-label"><span>Contact email <em>Optional</em></span><input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" inputMode="email" aria-invalid={!emailValid} aria-describedby={!emailValid ? "profile-contact-error" : undefined} />{!emailValid && <small id="profile-contact-error" className="field-error">Enter a valid email address or leave this blank.</small>}</label>
      {viewer.accountEmail && <div className="account-identity-row"><span>Resolved identity</span><strong>{viewer.accountEmail}</strong><small>Read-only · supplied by the trusted company access layer.</small></div>}
      {saveError && <p className="field-error" role="alert">{saveError}</p>}
    </div>
    <div className="identity-access-card"><span className="identity-access-icon"><Icon>⌾</Icon></span><div><strong>{accessLabel}</strong><p>Your network identity is captured automatically by the server. It is never editable here, and this screen does not reveal the raw address.</p></div><StatusBadge tone={accessLabel === "Standard desk" ? "neutral" : "approved"}>{viewer.roleLabel}</StatusBadge></div>
    <p className="privacy-footnote"><Icon>◎</Icon>Display name and optional contact email are saved by the backend for this network-scoped identity.</p>
  </Modal>;
}

export function FeedbackModal({
  open,
  onClose,
  viewer,
  context,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  viewer: ViewerProfile;
  context: NonNullable<FeedbackSubmission["context"]>;
  onSubmit: (submission: Omit<FeedbackSubmission, "id" | "createdAt">) => Promise<string>;
}) {
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory>("Idea");
  const [message, setMessage] = useState("");
  const [allowFollowUp, setAllowFollowUp] = useState(false);
  const [contactEmail, setContactEmail] = useState(viewer.contactEmail);
  const [includeContext, setIncludeContext] = useState(true);
  const [reference, setReference] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const categories: FeedbackCategory[] = ["Relevance", "Summaries", "Sources", "Workflow", "Bug", "Idea", "Other"];
  const emailValid = !allowFollowUp || !contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const canSubmit = rating > 0 && message.trim().length >= 8 && message.trim().length <= 1200 && emailValid;
  const reset = () => { setRating(0); setCategory("Idea"); setMessage(""); setAllowFollowUp(false); setContactEmail(viewer.contactEmail); setIncludeContext(true); setReference(null); };
  const close = () => { if (reference) reset(); onClose(); };
  const submit = async () => { setSubmitting(true); setSubmitError(null); try { const id = await onSubmit({ rating, category, message: message.trim(), allowFollowUp, contactEmail: allowFollowUp && contactEmail.trim() ? contactEmail.trim() : undefined, includeContext, context: includeContext ? context : undefined }); setReference(id); } catch (error) { setSubmitError(error instanceof Error ? error.message : "Feedback could not be submitted"); } finally { setSubmitting(false); } };
  return <Modal open={open} onClose={close} title={reference ? "Feedback received" : "Help shape Signalroom"} eyebrow={reference ? "Voice of customer" : `Voice of customer · ${viewer.displayName}`} className="feedback-modal" footer={reference ? <button className="primary-button" onClick={() => { reset(); onClose(); }}>Back to the desk <Icon>→</Icon></button> : <><button className="ghost-button" onClick={close}>Keep draft & close</button><button className="primary-button" disabled={!canSubmit || submitting} onClick={() => void submit()}>{submitting ? "Sending…" : "Send feedback"} <Icon>→</Icon></button></>}>
    {reference ? <div className="feedback-success" role="status" aria-live="polite" tabIndex={-1}><span>✓</span><h3>Thank you. This is now part of the product conversation.</h3><p>Your note was saved with reference <strong>{reference}</strong>. The team can triage it alongside usage context without exposing article content or your raw IP.</p><div><span>Category</span><strong>{category}</strong><span>Rating</span><strong>{rating}/5</strong></div></div> : <>
      <div className="feedback-intro"><span className="feedback-orbit"><i /><b /><Icon>◉</Icon></span><div><h3>What was this experience like?</h3><p>Tell us what helped, what slowed you down, or what you wish existed. Specific feedback is more useful than polite feedback.</p></div></div>
      <fieldset className="rating-fieldset"><legend>How useful is Signalroom today?</legend><div>{[[1,"Blocked"],[2,"Frustrating"],[3,"Okay"],[4,"Useful"],[5,"Excellent"]].map(([value,label]) => <button type="button" key={value} className={rating === value ? "active" : ""} aria-pressed={rating === value} onClick={() => setRating(value as number)}><strong>{value}</strong><span>{label}</span></button>)}</div></fieldset>
      <fieldset className="category-fieldset"><legend>What is this about?</legend><div>{categories.map((item) => <button type="button" className={category === item ? "active" : ""} aria-pressed={category === item} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></fieldset>
      <label className="feedback-message"><span>Your feedback</span><textarea value={message} maxLength={1200} onChange={(event) => setMessage(event.target.value)} placeholder="For example: I could not tell why two similar articles were clustered, or I loved how the dossier showed source provenance…" /><small>{message.length}/1200 · Minimum 8 characters</small></label>
      <div className="feedback-options"><label><input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} /><span><strong>Include diagnostic context</strong><small>{context.page} · {context.profile} desk · {context.theme} theme{context.articleId ? " · current dossier" : ""}</small></span></label><label><input type="checkbox" checked={allowFollowUp} onChange={(event) => setAllowFollowUp(event.target.checked)} /><span><strong>The product team may follow up</strong><small>Only the contact address below is attached.</small></span></label>{allowFollowUp && <label className="followup-email"><span>Follow-up email</span><input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="you@company.com" inputMode="email" aria-invalid={!emailValid} aria-describedby={!emailValid ? "feedback-contact-error" : undefined} />{!emailValid && <small id="feedback-contact-error" className="field-error">Enter a valid email or leave this blank.</small>}</label>}</div>
      <p className="feedback-privacy"><Icon>⌾</Icon>We attach the screen, desk, theme, and session reference only when you opt in—never search text, analyst notes, or article body content.</p>
      {submitError && <p className="field-error" role="alert">{submitError}</p>}
    </>}
  </Modal>;
}

export function AdvancedFilterDrawer({ open, onClose, value, regions, sources, onApply }: { open: boolean; onClose: () => void; value: AdvancedFilters; regions: string[]; sources: string[]; onApply: (filters: AdvancedFilters) => void }) {
  const [draft, setDraft] = useState(value);
  const toggleList = <T extends string>(key: "statuses" | "priorities", item: T) => setDraft((current) => ({ ...current, [key]: current[key].includes(item as never) ? current[key].filter((value) => value !== item) : [...current[key], item] } as AdvancedFilters));
  const reset = () => setDraft({ dateFrom: "", dateTo: "", region: "all", source: "all", statuses: [], priorities: [], savedOnly: false, minimumRelevance: 0, contentType: "all", hasImage: false, hasSummary: false });
  const count = [draft.dateFrom, draft.dateTo, draft.region !== "all", draft.source !== "all", draft.statuses.length, draft.priorities.length, draft.savedOnly, draft.minimumRelevance > 0, draft.contentType !== "all", draft.hasImage, draft.hasSummary].filter(Boolean).length;
  return <Drawer open={open} onClose={onClose} title="Advanced filters" label="Narrow the real briefing" className="filter-drawer" footer={<><button className="ghost-button" onClick={reset}>Reset</button><button className="primary-button" onClick={() => { onApply(draft); onClose(); }}>Apply {count} filter{count === 1 ? "" : "s"}</button></>}>
    <div className="advanced-filter-sections"><section><h3>Publication</h3><div className="two-fields"><label>Date from<input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label><label>Date to<input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label></div></section><section><h3>Geography and source</h3><label>Region<select value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })}><option value="all">All regions</option>{regions.map((region) => <option key={region}>{region}</option>)}</select></label><label>Source<select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option value="all">All sources</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label></section><section><h3>Editorial decision</h3><div className="filter-check-grid">{(["New", "Under Review", "Selected", "Approved", "Rejected"] as const).map((item) => <label key={item}><input type="checkbox" checked={draft.statuses.includes(item)} onChange={() => toggleList("statuses", item)} />{item}</label>)}<label><input type="checkbox" checked={draft.savedOnly} onChange={(event) => setDraft({ ...draft, savedOnly: event.target.checked })} />Saved only</label></div></section><section><h3>Priority and quality</h3><div className="filter-check-grid">{(["critical", "high", "medium", "low"] as const).map((item) => <label key={item}><input type="checkbox" checked={draft.priorities.includes(item)} onChange={() => toggleList("priorities", item)} />{item[0].toUpperCase() + item.slice(1)}</label>)}</div><label>Minimum relevance <div className="range-field"><input type="range" min="0" max="100" step="5" value={draft.minimumRelevance} onChange={(event) => setDraft({ ...draft, minimumRelevance: Number(event.target.value) })} /><strong>{draft.minimumRelevance}%</strong></div></label><label>Content type<select value={draft.contentType} onChange={(event) => setDraft({ ...draft, contentType: event.target.value as AdvancedFilters["contentType"] })}><option value="all">Articles and clusters</option><option value="article">Standalone articles</option><option value="cluster">Clusters</option></select></label><div className="filter-check-grid"><label><input type="checkbox" checked={draft.hasImage} onChange={(event) => setDraft({ ...draft, hasImage: event.target.checked })} />Has image</label><label><input type="checkbox" checked={draft.hasSummary} onChange={(event) => setDraft({ ...draft, hasSummary: event.target.checked })} />Has summary</label></div></section></div>
  </Drawer>;
}

export function HistorySnapshotDrawer({ snapshot, onClose, onOpenArticle }: { snapshot: BriefingHistoryRecord | null; onClose: () => void; onOpenArticle: (articleId: string) => void }) {
  if (!snapshot) return null;
  return <Drawer open onClose={onClose} title="Briefing snapshot" label={`${new Date(snapshot.created_at).toLocaleString()} · ${snapshot.profile} profile`} className="article-drawer dossier-drawer" footer={<button className="secondary-button" onClick={onClose}>Close snapshot</button>}>
    <article className="article-detail-content dossier-content">
      <header className="dossier-title-block"><div><span className="eyebrow">Immutable 30-day archive</span><h1>{snapshot.articles[0]?.title ?? `${snapshot.article_ids.length} article briefing`}</h1><p>{snapshot.article_ids.length} retained articles · Job {snapshot.crawl_job_id ?? "not recorded"}</p></div></header>
      <section className="dossier-section dossier-sources"><div className="dossier-section-heading"><div><span>COMPLETE SNAPSHOT</span><h2>{snapshot.articles.length} available article record{snapshot.articles.length === 1 ? "" : "s"}</h2></div><StatusBadge tone="neutral">Read only</StatusBadge></div>
        {snapshot.articles.map((article, index) => <article key={article.id}><span className="signal-number">{String(index + 1).padStart(2, "0")}</span><div><span><strong>{article.sources[0]?.publisher ?? "Unknown source"}</strong><small>{article.published_at ? new Date(article.published_at).toLocaleString() : "Publication time unavailable"}</small></span><h3>{article.title}</h3><p>{article.summary ?? "Summary unavailable."}</p></div><button className="secondary-button" onClick={() => onOpenArticle(article.id)}>Open dossier <Icon>↗</Icon></button></article>)}
        {!snapshot.articles.length && <p>The snapshot metadata is available, but its article records have expired or are unavailable.</p>}
      </section>
    </article>
  </Drawer>;
}

export function ScanModal({ open, onClose, job, canStart, onStart, onRefresh, onReset }: { open: boolean; onClose: () => void; job: ScanJob | null; canStart: boolean; onStart: () => Promise<ScanJob>; onRefresh: (id: string) => Promise<ScanJob>; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (!open || !job || !["queued", "running"].includes(job.status)) return; const timer = window.setInterval(() => void onRefresh(job.id).catch(() => undefined), 1500); return () => window.clearInterval(timer); }, [job, onRefresh, open]);
  const start = async () => { setBusy(true); setMessage(null); try { await onStart(); } catch (error) { setMessage(error instanceof Error ? error.message : "Scan could not be started"); } finally { setBusy(false); } };
  const counters = job?.counters ?? {};
  return <Modal open={open} onClose={onClose} title={job ? "Source scan" : "Start a new scan"} eyebrow="Backend collection operation" className="scan-modal" footer={!job ? <><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!canStart || busy} onClick={() => void start()}>{busy ? "Starting…" : "Start scan"} <Icon>→</Icon></button></> : undefined}>
    {!job ? <div className="scan-config"><div className="target-selector"><div><strong>Configured profile sources</strong><span>The backend will use this profile’s enabled sites, keywords, clustering, summarization, and Gatekeeper settings.</span></div></div>{!canStart && <div className="scan-warning"><Icon>!</Icon><div><strong>Scan controls are restricted.</strong><p>Your network identity may read the current briefing but cannot launch jobs.</p></div></div>}{message && <p className="field-error" role="alert">{message}</p>}</div> : <div className="scan-progress-view"><div className="scan-progress-hero"><div className={`scan-orbit ${["queued", "running"].includes(job.status) ? "running" : ""}`}><i /><i /><span>{job.status === "succeeded" ? "✓" : job.status === "failed" || job.status === "cancelled" ? "!" : "↻"}</span></div><div><StatusBadge tone={job.status === "succeeded" ? "approved" : job.status === "failed" || job.status === "cancelled" ? "rejected" : "live"}>{job.status}</StatusBadge><h3>{job.status === "succeeded" ? "Scan completed" : job.status === "failed" ? "Scan failed" : job.status === "cancelled" ? "Scan cancelled" : "Pipeline is running"}</h3><p>{job.error ?? `Job ${job.id}`}</p></div></div><div className="scan-counters">{Object.entries(counters).slice(0, 6).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label.replaceAll("_", " ")}</span></div>)}</div>{message && <p className="field-error" role="alert">{message}</p>}<div className="scan-bottom-actions">{(job.status === "failed" || job.status === "cancelled") && <><button className="primary-button" disabled={!canStart || busy} onClick={() => void start()}>{busy ? "Retrying…" : "Retry scan"} <Icon>↻</Icon></button><button className="secondary-button" onClick={() => { setMessage(null); onReset(); }}>Reset</button></>} {job.status === "succeeded" && <><button className="primary-button" onClick={onClose}>View briefing <Icon>→</Icon></button><button className="secondary-button" onClick={onReset}>Start another scan</button></>} {["queued", "running"].includes(job.status) && <button className="secondary-button" onClick={onClose}>Run in background</button>}</div></div>}
  </Modal>;
}

export function ExportModal({ open, onClose, onExport, selectedCount = 0 }: { open: boolean; onClose: () => void; onExport: (format: string) => Promise<void>; selectedCount?: number }) {
  const [format, setFormat] = useState("pptx");
  const [state, setState] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const formats = [["pptx", "P", "PowerPoint"], ["docx", "W", "Word document"], ["xlsx", "X", "Excel workbook"], ["json", "{ }", "JSON"], ["csv", "C", "CSV"]];
  const run = async () => { setState("running"); setError(null); try { await onExport(format); setState("complete"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Export failed"); setState("error"); } };
  const close = () => { setState("idle"); setError(null); onClose(); };
  return <Modal open={open} onClose={close} title={state === "complete" ? "Export downloaded" : state === "running" ? "Preparing export" : "Export intelligence"} eyebrow="Backend-generated output" className="export-modal" footer={state !== "running" ? <><button className="ghost-button" onClick={close}>Close</button>{state !== "complete" && <button className="primary-button" onClick={() => void run()}>Start export <Icon>→</Icon></button>}</> : undefined}>
    {state === "idle" || state === "error" ? <><div className="format-grid">{formats.map(([id, icon, name]) => <button className={format === id ? "active" : ""} key={id} onClick={() => setFormat(id)}><span>{icon}</span><strong>{name}</strong><small>Generated by the Signalroom backend</small></button>)}</div><div className="export-summary"><Icon>↥</Icon><div><strong>{selectedCount ? `${selectedCount} selected articles` : "Current filtered articles"}</strong><span>Summaries, source links, images, and decision metadata are included.</span></div></div>{error && <p className="field-error" role="alert">{error}</p>}</> : state === "running" ? <div className="export-progress"><div className="file-animation"><span>{format[0].toUpperCase()}</span><i /><b /></div><h3>Generating the real file</h3><p>The download begins when the backend response is ready.</p></div> : <div className="export-complete"><span>✓</span><h3>Your export was downloaded</h3><p>The browser received the file generated by the backend.</p></div>}
  </Modal>;
}

export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Drawer open={open} onClose={onClose} title="Notifications" label="Desk activity" className="notification-drawer"><div className="notification-list"><p>No notification endpoint is configured. Signalroom does not show fabricated activity.</p></div></Drawer>;
}

export function SourceModal({ open, onClose, source, onSave }: { open: boolean; onClose: () => void; source: SourceRecord | null; onSave: (source: SourceRecord) => Promise<void> | void }) {
  const [name, setName] = useState(source?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [category, setCategory] = useState(source?.category ?? "Technology");
  const [region, setRegion] = useState(source?.region ?? "Global");
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [deepScan, setDeepScan] = useState(source?.deepScan ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { setSaving(true); setError(null); const next = source ? { ...source, name, url, category, region, enabled, deepScan } : { id: `new-${Date.now()}`, name, code: name.slice(0, 2).toUpperCase(), url, category, region, enabled, deepScan, reliability: 0, lastScan: "Awaiting first scan", discovered: 0 }; try { await onSave(next); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Source could not be saved"); } finally { setSaving(false); } };
  return <Modal open={open} onClose={onClose} title={source ? `Edit ${source.name}` : "Add a news source"} eyebrow="Source management" className="source-modal" footer={<><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void save()} disabled={!name || !url || saving}>{saving ? "Saving…" : "Save source"}</button></>}><div className="source-form"><label className="field-label"><span>Source name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Example News" /></label><label className="field-label"><span>Source URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></label><div className="two-fields"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Technology</option><option>Business</option><option>Broadcasting</option><option>Display</option><option>Telecom</option><option>Robotics</option><option>Regulation</option><option>Media</option></select></label><label>Region<select value={region} onChange={(event) => setRegion(event.target.value)}><option>Global</option><option>North America</option><option>Europe</option><option>India</option><option>Asia-Pacific</option></select></label></div><div className="source-form-toggles"><label><span><strong>Enabled</strong><small>Include this source in routine scans.</small></span><span className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><i /></span></label><label><span><strong>Allow deep scan</strong><small>Follow article and topic links on this source.</small></span><span className="switch"><input type="checkbox" checked={deepScan} onChange={(event) => setDeepScan(event.target.checked)} /><i /></span></label></div>{error && <p className="field-error" role="alert">{error}</p>}</div></Modal>;
}
