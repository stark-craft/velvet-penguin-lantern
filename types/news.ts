export type Priority = "critical" | "high" | "medium" | "low";
export type Decision = "pending" | "approved" | "rejected";
export type Signal = "opportunity" | "risk" | "mixed" | "neutral";
export type ViewMode = "cards" | "compact" | "dense";
export type DeskProfile = "default" | "broadcast";
export type ColorTheme = "light" | "dark";
export type ReviewStatus = "New" | "Under Review" | "Selected" | "Approved" | "Rejected";
export type InterestSignal = "interesting" | "not-interested" | null;

export interface AdvancedFilters {
  dateFrom: string;
  dateTo: string;
  region: string;
  source: string;
  statuses: ReviewStatus[];
  priorities: Priority[];
  savedOnly: boolean;
  minimumRelevance: number;
  contentType: "all" | "article" | "cluster";
  hasImage: boolean;
  hasSummary: boolean;
}

export interface ViewerProfile {
  id: string;
  displayName: string;
  contactEmail: string;
  accountEmail: string | null;
  roleLabel: string;
}

export interface AccessCapabilities {
  canViewAnalytics: boolean;
  canSwitchDeskProfile: boolean;
  canReviewGatekeeper: boolean;
  canManageSources: boolean;
  canManageJobs: boolean;
  accessLabel: string;
}

export type BackendCapability =
  | "read"
  | "personalize"
  | "submit_feedback"
  | "broadcast"
  | "profile_switch"
  | "gatekeeper_review"
  | "analytics"
  | "manage_sources"
  | "manage_jobs"
  | "admin";

export type FeedbackCategory = "Relevance" | "Summaries" | "Sources" | "Workflow" | "Bug" | "Idea" | "Other";

export interface FeedbackSubmission {
  id: string;
  rating: number;
  category: FeedbackCategory;
  message: string;
  allowFollowUp: boolean;
  contactEmail?: string;
  includeContext: boolean;
  context?: {
    page: string;
    profile: DeskProfile;
    theme: ColorTheme;
    articleId?: string;
    sessionId?: string;
  };
  createdAt: string;
}

export interface Article {
  id: string;
  headline: string;
  summary: string;
  insight: string;
  source: string;
  sourceCode: string;
  author: string;
  published: string;
  date: string;
  publishedAt?: string | null;
  image: string;
  category: string;
  team: string;
  region: string;
  keywords: string[];
  entities: string[];
  technologies: string[];
  priority: Priority;
  relevance: number;
  confidence: number;
  signal: Signal;
  status: string;
  credibility: number;
  gatekeeper: {
    verdict: "Retained" | "Rejected";
    reason: string;
    considered: string[];
  };
  canonicalUrl?: string;
  intent?: string;
  sourceArticles?: SourceArticle[];
  decisionTrail?: ArticleActionRecord[];
}

export interface SourceArticle {
  source: string;
  code: string;
  headline: string;
  time: string;
  summary: string;
  similarity: number;
  duplicate?: "Near duplicate" | "Syndicated";
  url?: string;
  articleId?: string;
  primary?: boolean;
}

export interface StoryCluster {
  id: string;
  title: string;
  summary: string;
  image: string;
  category: string;
  team: string;
  region: string;
  confidence: number;
  priority: Priority;
  signal: Signal;
  entities: string[];
  sources: SourceArticle[];
  timeRange: string;
  publishedAt?: string | null;
}

export interface WorkflowItem {
  id: string;
  articleId: string;
  title: string;
  category: string;
  owner: string;
  team: string;
  priority: Priority;
  status: string;
  created: string;
  due: string;
  notes: string;
  attachments: number;
  exported: boolean;
}

export interface SourceRecord {
  id: string;
  name: string;
  code: string;
  url: string;
  category: string;
  region: string;
  enabled: boolean;
  deepScan: boolean;
  reliability: number;
  lastScan: string;
  lastError?: string;
  discovered: number;
  rssUrl?: string | null;
  timezone?: string;
  maxLinks?: number;
  manualDeepScanCandidate?: boolean;
}

export interface BackendMe {
  actor_id: string;
  identity: string | null;
  active_profile: DeskProfile;
  capabilities: BackendCapability[];
  authentication_method: string;
  preferences?: {
    display_name?: string | null;
    contact_email?: string | null;
  } | null;
}

export interface BackendProfileSummary {
  id: DeskProfile;
  label: string;
  active: boolean;
  enabled: boolean;
  source_count: number;
  keyword_count: number;
}

export interface BackendFeed {
  profile: DeskProfile;
  briefing: {
    id: string;
    generated_at: string;
    crawl_job_id: string | null;
    counters: Record<string, number>;
  } | null;
  articles: Article[];
  clusters: StoryCluster[];
}

export interface BackendPage<T> {
  items: T[];
  page: { limit: number; has_more: boolean; next_cursor: string | null };
}

export interface RawArticleSource {
  id: string;
  article_id: string;
  profile: DeskProfile;
  source_key: string;
  publisher: string;
  url: string;
  canonical_url: string | null;
  published_at: string | null;
  discovered_at: string;
  discovery_method: string;
  crawl_job_id: string | null;
  metadata: Record<string, unknown>;
}

export interface RawArticle {
  id: string;
  stable_id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  summary: string | null;
  intent: string | null;
  body_text: string | null;
  top_image_url: string | null;
  region: string;
  category: string;
  language: string;
  importance_score: number;
  keywords: string[];
  profiles: DeskProfile[];
  sources: RawArticleSource[];
  model_metadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ArticleAction = "select" | "deselect" | "save" | "unsave" | "mark_under_review" | "clear_review" | "approve" | "interesting" | "not_interested" | "hide" | "restore";

export interface ArticleDisposition {
  article_id: string;
  actor_id: string;
  selected: boolean;
  saved: boolean;
  under_review: boolean;
  approved: boolean;
  interesting: boolean | null;
  hidden: boolean;
  last_action_at: string | null;
}

export interface ArticleActionRecord {
  id: string;
  article_id: string;
  profile: DeskProfile;
  actor_id: string;
  action: ArticleAction;
  note: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface WorklistRecord {
  article: RawArticle;
  disposition: ArticleDisposition;
}

export interface BriefingHistoryRecord {
  id: string;
  profile: DeskProfile;
  crawl_job_id: string | null;
  article_ids: string[];
  generated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  articles: RawArticle[];
}

export interface DetailedAnalytics {
  profile: DeskProfile;
  window_started_at: string;
  window_ended_at: string;
  window_days: number;
  idle_cap_minutes: number;
  summary: AnalyticsRollup & { unique_actors: number; session_count: number; unattributed_event_count: number };
  users: Array<AnalyticsRollup & { actor_id: string | null; session_count: number }>;
  sessions: Array<AnalyticsRollup & { session_id: string; actor_id: string | null }>;
  coverage: Record<string, number | boolean>;
}

export interface AnalyticsRollup {
  active_minutes: number;
  event_count: number;
  article_count: number;
  paths: Array<{ path: string; count: number }>;
  event_types: Record<string, number>;
  action_types: Record<string, number>;
  started_at: string | null;
  last_seen_at: string | null;
}

export interface BackendFeedback extends FeedbackSubmission {
  reference?: string;
  actorId?: string | null;
}

export interface GatekeeperAudit {
  profile: DeskProfile;
  job: { id: string; status: string; counters: Record<string, number>; created_at: string; completed_at: string | null } | null;
  latest_briefing: { id: string; created_at: string; article_count: number; is_for_audited_run: boolean } | null;
  counters: {
    pipeline: Record<string, number>;
    clusters: { total: number; retained: number; review: number; dropped: number };
    articles: { total: number; retained: number; review: number; dropped: number };
  };
  clusters: Array<Record<string, unknown>>;
  articles: GatekeeperAuditArticle[];
  limit: number;
  truncated: boolean;
}

export interface GatekeeperAuditArticle {
  article_id: string;
  cluster_id: string;
  title: string;
  summary: string | null;
  source: string | null;
  sources: string[];
  canonical_url: string;
  published_at: string | null;
  gatekeeper: {
    decision: string;
    bucket: "retained" | "review" | "dropped";
    retained: boolean;
    score: number | null;
    reason: string;
    thresholds: Record<string, number>;
    model: { version: string | null; degraded: boolean; stage: string };
  };
  disposition: ArticleDisposition | null;
}
