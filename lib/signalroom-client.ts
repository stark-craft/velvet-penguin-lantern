import type {
  Article,
  ArticleAction,
  ArticleActionRecord,
  BackendFeed,
  BackendMe,
  BackendPage,
  BackendProfileSummary,
  BriefingHistoryRecord,
  DeskProfile,
  DetailedAnalytics,
  FeedbackSubmission,
  GatekeeperAudit,
  RawArticle,
  SourceArticle,
  SourceRecord,
  WorklistRecord,
} from "@/types/news";
import { PRODUCT_NAME } from "@/lib/brand";

function apiBase(): string {
  const directPort = process.env.NEXT_PUBLIC_SIGNALROOM_DIRECT_API_PORT?.trim()
    || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SIGNALROOM_USE_BFF !== "true" ? "8000" : "");
  if (directPort && typeof window !== "undefined") {
    const port = Number(directPort);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return `${window.location.protocol}//${window.location.hostname}:${port}/api/v1`;
    }
  }
  const configured = process.env.NEXT_PUBLIC_SIGNALROOM_API_BASE?.trim();
  return configured?.replace(/\/+$/, "") || "/api/signalroom";
}

export class SignalroomApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}/${path.replace(/^\/+/, "")}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as unknown;
    throw new SignalroomApiError(apiErrorMessage(body, `${PRODUCT_NAME} request failed (${response.status})`), response.status);
  }
  return response.json() as Promise<T>;
}

const profileQuery = (profile: DeskProfile) => `profile=${encodeURIComponent(profile)}`;

export const signalroomApi = {
  me: (profile?: DeskProfile) => api<BackendMe>(`me${profile ? `?${profileQuery(profile)}` : ""}`),
  notifications: (profile: DeskProfile) => api<DeskNotification[]>(`notifications?${profileQuery(profile)}`),
  profiles: (profile?: DeskProfile) => api<BackendProfileSummary[]>(`profiles${profile ? `?${profileQuery(profile)}` : ""}`),
  feed: (profile: DeskProfile) => api<BackendFeed>(`feed?${profileQuery(profile)}`),
  sources: (profile: DeskProfile) => api<SourceApiRecord[]>(`sources?${profileQuery(profile)}`),
  worklist: (profile: DeskProfile, state: string) => api<BackendPage<WorklistRecord>>(`worklists?${profileQuery(profile)}&state=${encodeURIComponent(state)}&limit=100`),
  briefings: (profile: DeskProfile, cursor?: string | null, limit = 20) => api<BackendPage<BriefingHistoryRecord>>(`briefings?${profileQuery(profile)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  briefing: (profile: DeskProfile, id: string) => api<BriefingHistoryRecord>(`briefings/${id}?${profileQuery(profile)}`),
  article: (profile: DeskProfile, id: string) => api<RawArticle>(`articles/${id}?${profileQuery(profile)}`),
  articleActions: (profile: DeskProfile, id: string) => api<BackendPage<ArticleActionRecord>>(`articles/${id}/actions?${profileQuery(profile)}&limit=100`),
  action: (profile: DeskProfile, id: string, action: ArticleAction, note?: string, approvalKey?: string) => api<{ disposition: WorklistRecord["disposition"] }>(`articles/${id}/actions?${profileQuery(profile)}`, { method: "POST", body: JSON.stringify({ action, note: note || null, approval_key: approvalKey || null }) }),
  batchAction: (profile: DeskProfile, ids: string[], action: ArticleAction, approvalKey?: string) => api<Array<{ disposition: WorklistRecord["disposition"] }>>(`article-actions/batch?${profileQuery(profile)}`, { method: "POST", body: JSON.stringify({ article_ids: ids, action, approval_key: approvalKey || null }) }),
  feedback: (profile: DeskProfile, submission: Omit<FeedbackSubmission, "id" | "createdAt">) => api<VocResponse>(`feedback?${profileQuery(profile)}`, { method: "POST", body: JSON.stringify(feedbackPayload(submission)) }),
  event: (profile: DeskProfile, payload: EventPayload) => api<Record<string, unknown>>(`events?${profileQuery(profile)}`, { method: "POST", body: JSON.stringify(payload) }),
  scan: (profile: DeskProfile) => api<{ job: ScanJob }>("admin/scans", { method: "POST", body: JSON.stringify({ profile, kind: "manual", keywords: [], source_ids: [], parameters: {} }) }),
  job: (id: string) => api<ScanJob>(`admin/jobs/${id}`),
  jobEvents: (id: string) => api<Array<Record<string, unknown>>>(`admin/jobs/${id}/events?limit=1000`),
  analytics: (profile: DeskProfile) => api<DetailedAnalytics>(`admin/analytics/detail?${profileQuery(profile)}&window_days=30`),
  feedbackInbox: (profile: DeskProfile) => api<BackendPage<VocResponse>>(`admin/feedback?${profileQuery(profile)}&limit=100`),
  gatekeeper: (profile: DeskProfile, key?: string) => api<GatekeeperAudit>(`gatekeeper/audit?${profileQuery(profile)}&limit=100`, key ? { headers: { "x-signalroom-gatekeeper-key": key } } : undefined),
  savePreferences: (payload: { display_name: string; contact_email: string | null; pet_enabled: boolean; pet_kind: string; pet_color: string }) => api<PreferenceResponse>("me/preferences", { method: "PUT", body: JSON.stringify(payload) }),
  createSource: (profile: DeskProfile, source: SourceRecord) => api<SourceApiRecord>(`sources?${profileQuery(profile)}`, { method: "POST", body: JSON.stringify(sourcePayload(source)) }),
  updateSource: (profile: DeskProfile, source: SourceRecord) => api<SourceApiRecord>(`sources/${encodeURIComponent(source.id)}?${profileQuery(profile)}`, { method: "PUT", body: JSON.stringify(sourcePayload(source)) }),
};

export interface ScanJob { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; counters: Record<string, number>; error: string | null; created_at: string; completed_at: string | null }
export interface EventPayload { event_type: "page_view" | "article_open" | "article_action" | "search" | "export" | "heartbeat" | "feedback" | "profile_switch"; session_id: string; path?: string; article_id?: string; properties?: Record<string, string | number | boolean>; occurred_at?: string }
export interface PreferenceResponse { actor_id: string; display_name: string; contact_email: string | null; pet_enabled: boolean; pet_kind: "orbit" | "pixel" | "cloud"; pet_color: "violet" | "coral" | "mint" | "gold"; updated_at: string }
export interface DeskNotification { id: string; kind: "briefing" | "approval" | "search"; title: string; message: string; created_at: string; article_id: string | null }
export interface VocResponse { id: string; reference: string; actor_id: string | null; rating: number; category: string; message: string; allow_follow_up: boolean; include_diagnostics: boolean; contact_email: string | null; page: string | null; diagnostics: Record<string, unknown>; created_at: string }
export interface SourceApiRecord { id: string; name: string; enabled: boolean; category: string; rss_url: string | null; homepage: string | null; url: string | null; region: string; timezone: string; max_links: number; allow_deep_scan: boolean; manual_deep_scan_candidate: boolean }

export function mapSource(source: SourceApiRecord): SourceRecord {
  return { id: source.id, name: source.name, code: initials(source.name), url: source.url ?? source.rss_url ?? source.homepage ?? "", category: source.category, region: source.region, enabled: source.enabled, deepScan: source.allow_deep_scan, reliability: 0, lastScan: "Awaiting scan telemetry", discovered: 0, rssUrl: source.rss_url, timezone: source.timezone, maxLinks: source.max_links, manualDeepScanCandidate: source.manual_deep_scan_candidate };
}

export function mapRawArticle(raw: RawArticle): Article {
  const primary = raw.sources[0];
  const date = raw.published_at ? new Date(raw.published_at) : null;
  const sourceArticles: SourceArticle[] = raw.sources.map((source) => ({ source: source.publisher, code: initials(source.publisher), headline: raw.title, time: formatTime(source.published_at ?? source.discovered_at), summary: raw.summary ?? "Summary unavailable.", similarity: 100, url: source.canonical_url ?? source.url, articleId: raw.id, primary: source.id === primary?.id }));
  const relevance = Math.max(0, Math.min(100, Math.round(raw.importance_score * 100)));
  const metadata = raw.metadata ?? {};
  const signal = stringValue(raw.intent).toLowerCase();
  return { id: raw.id, headline: raw.title, summary: raw.summary ?? "Summary unavailable.", insight: raw.intent ?? "No intent classification is available yet.", source: primary?.publisher ?? "Unknown source", sourceCode: initials(primary?.publisher ?? "Unknown"), author: stringValue(primary?.metadata?.author) || `${primary?.publisher ?? "Source"} desk`, published: formatTime(raw.published_at), date: date ? date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "Unknown date", publishedAt: raw.published_at, image: raw.top_image_url ?? "/og.png", category: raw.category, team: stringValue(metadata.team) || "Intelligence Team", region: raw.region, keywords: raw.keywords, entities: stringArray(metadata.entities), technologies: stringArray(metadata.technologies), priority: relevance >= 90 ? "critical" : relevance >= 75 ? "high" : relevance >= 55 ? "medium" : "low", relevance, confidence: relevance, signal: signal.includes("risk") ? "risk" : signal.includes("opportunity") ? "opportunity" : signal ? "mixed" : "neutral", status: "New", credibility: numberValue(metadata.credibility, relevance), gatekeeper: { verdict: metadata.retained === false ? "Rejected" : "Retained", reason: stringValue((metadata.gatekeeper as Record<string, unknown> | undefined)?.reason) || "No gatekeeper explanation was stored.", considered: raw.keywords }, canonicalUrl: raw.canonical_url, intent: raw.intent ?? undefined, sourceArticles };
}

function feedbackPayload(item: Omit<FeedbackSubmission, "id" | "createdAt">) {
  const categories: Record<string, string> = { Summaries: "content", Sources: "content", Workflow: "usability", Other: "general" };
  return { rating: item.rating, category: categories[item.category] ?? item.category.toLowerCase(), message: item.message, allow_follow_up: item.allowFollowUp, include_diagnostics: item.includeContext, contact_email: item.allowFollowUp ? item.contactEmail ?? null : null, page: item.context?.page ?? null, diagnostics: item.includeContext ? { profile: item.context?.profile, theme: item.context?.theme, article_id: item.context?.articleId, session_id: item.context?.sessionId } : {} };
}

function sourcePayload(source: SourceRecord) {
  return { name: source.name, url: source.url, category: source.category, region: source.region, enabled: source.enabled, allow_deep_scan: source.deepScan, timezone: source.timezone ?? "Asia/Kolkata", max_links: source.maxLinks ?? 50, manual_deep_scan_candidate: source.manualDeepScanCandidate ?? false };
}

function initials(value: string) { const words = value.match(/[A-Za-z0-9]+/g) ?? []; return (words.length > 1 ? words.slice(0, 3).map((word) => word[0]).join("") : words[0]?.slice(0, 2) || "?").toUpperCase(); }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "Unknown"; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function numberValue(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback; }

function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (Array.isArray(body)) {
    const messages = body.map((item) => apiErrorMessage(item, "")).filter(Boolean);
    return messages.length ? messages.join("; ") : fallback;
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.detail ?? record.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (Array.isArray(message)) {
      const messages = message.map((item) => {
        if (item && typeof item === "object") {
          const validation = item as Record<string, unknown>;
          const path = Array.isArray(validation.loc) ? validation.loc.filter((part) => part !== "body").join(".") : "";
          const text = typeof validation.msg === "string" ? validation.msg : apiErrorMessage(item, "");
          return path && text ? `${path}: ${text}` : text;
        }
        return apiErrorMessage(item, "");
      }).filter(Boolean);
      if (messages.length) return messages.join("; ");
    }
    if (message && typeof message === "object") return apiErrorMessage(message, fallback);
  }
  return fallback;
}

export async function downloadExport(profile: DeskProfile, ids: string[], format: string) {
  const response = await fetch(`${apiBase()}/exports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, article_ids: ids, format, include_images: true, include_summaries: true, include_source_links: true, include_opinions: true, include_metadata: true, include_rejected_items: false }) });
  if (!response.ok) throw new SignalroomApiError(apiErrorMessage(await response.json().catch(() => null), "Export failed"), response.status);
  const blob = await response.blob();
  const match = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob); anchor.download = match?.[1] ?? `signalroom-export.${format}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
}
