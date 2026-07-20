/**
 * Privacy-conscious Phase-1 fixtures for restricted usage analytics.
 * IPs are masked; emails, search text, notes, and contact details are omitted.
 */

export type TelemetryDeskProfile = "default" | "broadcast";
export type TelemetrySessionStatus = "active" | "ended";
export type FeedbackStatus = "new" | "triaged" | "planned" | "resolved";
export type FeedbackCategory = "relevance" | "summary" | "sources" | "workflow" | "usability" | "bug" | "idea" | "other";
export type TelemetryScreen = "briefing" | "discover" | "search" | "selected" | "workflow" | "saved" | "dossier" | "sources" | "analytics" | "settings";
export type TelemetryActionName =
  | "page_view"
  | "article_opened"
  | "article_selected"
  | "article_saved"
  | "status_changed"
  | "interest_recorded"
  | "search_started"
  | "source_tested"
  | "scan_opened"
  | "export_started"
  | "export_completed"
  | "desk_profile_changed"
  | "theme_changed"
  | "analytics_user_opened"
  | "analytics_session_opened"
  | "voc_submitted";

export interface TelemetryUser {
  id: string;
  displayName: string;
  initials: string;
  role: string;
  team: string;
  primaryProfile: TelemetryDeskProfile;
  maskedIp: string;
  lastSeenMinutesAgo: number;
  sessions7d: number;
  activeMinutes7d: number;
  screensVisited7d: number;
  articlesReviewed7d: number;
  actions7d: number;
  feedbackCount: number;
}

export interface TelemetrySession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  status: TelemetrySessionStatus;
  durationMinutes: number;
  lastSeenMinutesAgo: number;
  deskProfile: TelemetryDeskProfile;
  maskedIp: string;
  deviceLabel: string;
  screens: TelemetryScreen[];
  articleIds: string[];
  actionCount: number;
}

export interface TelemetryAction {
  id: string;
  sessionId: string;
  userId: string;
  occurredAt: string;
  minuteOffset: number;
  screen: TelemetryScreen;
  name: TelemetryActionName;
  label: string;
  articleId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface VocSubmission {
  id: string;
  userId: string;
  sessionId: string;
  submittedAt: string;
  minutesIntoSession: number;
  rating: 1 | 2 | 3 | 4 | 5;
  category: FeedbackCategory;
  status: FeedbackStatus;
  message: string;
  followUpRequested: boolean;
  screen: TelemetryScreen;
  deskProfile: TelemetryDeskProfile;
  articleId?: string;
  diagnosticContextIncluded: boolean;
}

/** Fixed clock for the relative “minutes ago” values below. */
export const telemetryReferenceTime = "2026-07-18T08:30:00+05:30";

export const telemetryUsers: TelemetryUser[] = [
  { id: "usr-maya", displayName: "Maya Chen", initials: "MC", role: "Intelligence lead", team: "Media Intelligence", primaryProfile: "default", maskedIp: "10.24.18.xxx", lastSeenMinutesAgo: 1, sessions7d: 9, activeMinutes7d: 184, screensVisited7d: 9, articlesReviewed7d: 27, actions7d: 94, feedbackCount: 1 },
  { id: "usr-arjun", displayName: "Arjun Rao", initials: "AR", role: "Cloud editor", team: "Cloud", primaryProfile: "default", maskedIp: "10.24.22.xxx", lastSeenMinutesAgo: 18, sessions7d: 7, activeMinutes7d: 132, screensVisited7d: 8, articlesReviewed7d: 19, actions7d: 71, feedbackCount: 1 },
  { id: "usr-sofia", displayName: "Sofia Kim", initials: "SK", role: "Robotics analyst", team: "Robotics", primaryProfile: "default", maskedIp: "10.24.31.xxx", lastSeenMinutesAgo: 34, sessions7d: 6, activeMinutes7d: 96, screensVisited7d: 6, articlesReviewed7d: 14, actions7d: 43, feedbackCount: 1 },
  { id: "usr-liam", displayName: "Liam Brooks", initials: "LB", role: "Display strategist", team: "TV & Display", primaryProfile: "default", maskedIp: "10.24.27.xxx", lastSeenMinutesAgo: 49, sessions7d: 5, activeMinutes7d: 78, screensVisited7d: 5, articlesReviewed7d: 12, actions7d: 38, feedbackCount: 1 },
  { id: "usr-priya", displayName: "Priya Nair", initials: "PN", role: "Source operations", team: "Research Operations", primaryProfile: "broadcast", maskedIp: "10.24.35.xxx", lastSeenMinutesAgo: 71, sessions7d: 4, activeMinutes7d: 64, screensVisited7d: 5, articlesReviewed7d: 8, actions7d: 29, feedbackCount: 0 },
  { id: "usr-devansh", displayName: "Devansh Mehta", initials: "DM", role: "Platform developer", team: "Internal Tools", primaryProfile: "broadcast", maskedIp: "10.24.4.xxx", lastSeenMinutesAgo: 1, sessions7d: 11, activeMinutes7d: 112, screensVisited7d: 11, articlesReviewed7d: 7, actions7d: 86, feedbackCount: 1 },
];

export const telemetrySessions: TelemetrySession[] = [
  { id: "ses-maya-0718-a", userId: "usr-maya", startedAt: "2026-07-18T07:43:00+05:30", endedAt: null, status: "active", durationMinutes: 46, lastSeenMinutesAgo: 1, deskProfile: "default", maskedIp: "10.24.18.xxx", deviceLabel: "Chrome · macOS", screens: ["briefing", "dossier", "selected"], articleIds: ["agent-controls", "eu-agent-rules"], actionCount: 6 },
  { id: "ses-maya-0717-a", userId: "usr-maya", startedAt: "2026-07-17T16:06:00+05:30", endedAt: "2026-07-17T16:44:00+05:30", status: "ended", durationMinutes: 38, lastSeenMinutesAgo: 946, deskProfile: "default", maskedIp: "10.24.18.xxx", deviceLabel: "Chrome · macOS", screens: ["saved", "dossier", "selected"], articleIds: ["blue-oled"], actionCount: 4 },
  { id: "ses-arjun-0718-a", userId: "usr-arjun", startedAt: "2026-07-18T07:41:00+05:30", endedAt: "2026-07-18T08:12:00+05:30", status: "ended", durationMinutes: 31, lastSeenMinutesAgo: 18, deskProfile: "default", maskedIp: "10.24.22.xxx", deviceLabel: "Edge · Windows", screens: ["workflow", "dossier"], articleIds: ["orange-agents"], actionCount: 5 },
  { id: "ses-arjun-0717-a", userId: "usr-arjun", startedAt: "2026-07-17T14:22:00+05:30", endedAt: "2026-07-17T14:46:00+05:30", status: "ended", durationMinutes: 24, lastSeenMinutesAgo: 1064, deskProfile: "default", maskedIp: "10.24.22.xxx", deviceLabel: "Edge · Windows", screens: ["search", "dossier"], articleIds: ["eu-agent-rules"], actionCount: 3 },
  { id: "ses-sofia-0718-a", userId: "usr-sofia", startedAt: "2026-07-18T07:29:00+05:30", endedAt: "2026-07-18T07:56:00+05:30", status: "ended", durationMinutes: 27, lastSeenMinutesAgo: 34, deskProfile: "default", maskedIp: "10.24.31.xxx", deviceLabel: "Chrome · Windows", screens: ["briefing", "dossier", "selected"], articleIds: ["robot-foundation"], actionCount: 5 },
  { id: "ses-liam-0718-a", userId: "usr-liam", startedAt: "2026-07-18T07:19:00+05:30", endedAt: "2026-07-18T07:41:00+05:30", status: "ended", durationMinutes: 22, lastSeenMinutesAgo: 49, deskProfile: "default", maskedIp: "10.24.27.xxx", deviceLabel: "Safari · macOS", screens: ["discover", "dossier"], articleIds: ["blue-oled"], actionCount: 4 },
  { id: "ses-priya-0718-a", userId: "usr-priya", startedAt: "2026-07-18T07:00:00+05:30", endedAt: "2026-07-18T07:19:00+05:30", status: "ended", durationMinutes: 19, lastSeenMinutesAgo: 71, deskProfile: "broadcast", maskedIp: "10.24.35.xxx", deviceLabel: "Edge · Windows", screens: ["sources", "briefing"], articleIds: [], actionCount: 3 },
  { id: "ses-devansh-0718-a", userId: "usr-devansh", startedAt: "2026-07-18T07:36:00+05:30", endedAt: null, status: "active", durationMinutes: 53, lastSeenMinutesAgo: 1, deskProfile: "broadcast", maskedIp: "10.24.4.xxx", deviceLabel: "Chrome · Linux dev PC", screens: ["analytics", "dossier", "settings"], articleIds: ["provenance"], actionCount: 7 },
];

type ActionDetails = Pick<TelemetryAction, "articleId" | "metadata">;
const action = (
  id: string,
  sessionId: string,
  userId: string,
  occurredAt: string,
  minuteOffset: number,
  screen: TelemetryScreen,
  name: TelemetryActionName,
  label: string,
  details: ActionDetails = {},
): TelemetryAction => ({ id, sessionId, userId, occurredAt, minuteOffset, screen, name, label, ...details });

export const telemetryActions: TelemetryAction[] = [
  action("act-maya-01", "ses-maya-0718-a", "usr-maya", "2026-07-18T07:43:00+05:30", 0, "briefing", "page_view", "Opened Morning Briefing"),
  action("act-maya-02", "ses-maya-0718-a", "usr-maya", "2026-07-18T07:47:00+05:30", 4, "dossier", "article_opened", "Opened an article dossier", { articleId: "agent-controls" }),
  action("act-maya-03", "ses-maya-0718-a", "usr-maya", "2026-07-18T07:51:00+05:30", 8, "dossier", "status_changed", "Moved article to Under Review", { articleId: "agent-controls", metadata: { from: "New", to: "Under Review" } }),
  action("act-maya-04", "ses-maya-0718-a", "usr-maya", "2026-07-18T08:02:00+05:30", 19, "briefing", "article_selected", "Added article to Selected", { articleId: "eu-agent-rules" }),
  action("act-maya-05", "ses-maya-0718-a", "usr-maya", "2026-07-18T08:19:00+05:30", 36, "selected", "export_started", "Started a selected-article export", { metadata: { format: "PowerPoint", articleCount: 4 } }),
  action("act-maya-06", "ses-maya-0718-a", "usr-maya", "2026-07-18T08:27:00+05:30", 44, "selected", "voc_submitted", "Submitted product feedback", { metadata: { feedbackId: "voc-1041", rating: 4, category: "relevance" } }),
  action("act-maya-prev-01", "ses-maya-0717-a", "usr-maya", "2026-07-17T16:06:00+05:30", 0, "saved", "page_view", "Opened Saved intelligence"),
  action("act-maya-prev-02", "ses-maya-0717-a", "usr-maya", "2026-07-17T16:12:00+05:30", 6, "dossier", "article_opened", "Opened an article dossier", { articleId: "blue-oled" }),
  action("act-maya-prev-03", "ses-maya-0717-a", "usr-maya", "2026-07-17T16:17:00+05:30", 11, "dossier", "article_saved", "Saved article for later", { articleId: "blue-oled" }),
  action("act-maya-prev-04", "ses-maya-0717-a", "usr-maya", "2026-07-17T16:39:00+05:30", 33, "selected", "export_completed", "Completed intelligence export", { metadata: { format: "Word", articleCount: 6 } }),

  action("act-arjun-01", "ses-arjun-0718-a", "usr-arjun", "2026-07-18T07:41:00+05:30", 0, "workflow", "page_view", "Opened Workflow"),
  action("act-arjun-02", "ses-arjun-0718-a", "usr-arjun", "2026-07-18T07:46:00+05:30", 5, "dossier", "article_opened", "Opened an article dossier", { articleId: "orange-agents" }),
  action("act-arjun-03", "ses-arjun-0718-a", "usr-arjun", "2026-07-18T07:53:00+05:30", 12, "dossier", "status_changed", "Moved article to Selected", { articleId: "orange-agents", metadata: { from: "Under Review", to: "Selected" } }),
  action("act-arjun-04", "ses-arjun-0718-a", "usr-arjun", "2026-07-18T07:57:00+05:30", 16, "dossier", "article_saved", "Saved article for later", { articleId: "orange-agents" }),
  action("act-arjun-05", "ses-arjun-0718-a", "usr-arjun", "2026-07-18T08:09:00+05:30", 28, "workflow", "voc_submitted", "Submitted product feedback", { metadata: { feedbackId: "voc-1040", rating: 3, category: "workflow" } }),
  action("act-arjun-prev-01", "ses-arjun-0717-a", "usr-arjun", "2026-07-17T14:22:00+05:30", 0, "search", "page_view", "Opened Search"),
  action("act-arjun-prev-02", "ses-arjun-0717-a", "usr-arjun", "2026-07-17T14:25:00+05:30", 3, "search", "search_started", "Started a local intelligence search", { metadata: { mode: "local" } }),
  action("act-arjun-prev-03", "ses-arjun-0717-a", "usr-arjun", "2026-07-17T14:31:00+05:30", 9, "dossier", "article_opened", "Opened an article dossier", { articleId: "eu-agent-rules" }),

  action("act-sofia-01", "ses-sofia-0718-a", "usr-sofia", "2026-07-18T07:29:00+05:30", 0, "briefing", "page_view", "Opened Morning Briefing"),
  action("act-sofia-02", "ses-sofia-0718-a", "usr-sofia", "2026-07-18T07:34:00+05:30", 5, "dossier", "article_opened", "Opened an article dossier", { articleId: "robot-foundation" }),
  action("act-sofia-03", "ses-sofia-0718-a", "usr-sofia", "2026-07-18T07:42:00+05:30", 13, "dossier", "interest_recorded", "Marked article Interesting", { articleId: "robot-foundation", metadata: { signal: "interesting" } }),
  action("act-sofia-04", "ses-sofia-0718-a", "usr-sofia", "2026-07-18T07:49:00+05:30", 20, "selected", "article_selected", "Added article to Selected", { articleId: "robot-foundation" }),
  action("act-sofia-05", "ses-sofia-0718-a", "usr-sofia", "2026-07-18T07:52:00+05:30", 23, "dossier", "voc_submitted", "Submitted product feedback", { articleId: "robot-foundation", metadata: { feedbackId: "voc-1038", rating: 4, category: "sources" } }),

  action("act-liam-01", "ses-liam-0718-a", "usr-liam", "2026-07-18T07:19:00+05:30", 0, "discover", "page_view", "Opened Discover"),
  action("act-liam-02", "ses-liam-0718-a", "usr-liam", "2026-07-18T07:23:00+05:30", 4, "dossier", "article_opened", "Opened an article dossier", { articleId: "blue-oled" }),
  action("act-liam-03", "ses-liam-0718-a", "usr-liam", "2026-07-18T07:29:00+05:30", 10, "dossier", "status_changed", "Approved article", { articleId: "blue-oled", metadata: { from: "Selected", to: "Approved" } }),
  action("act-liam-04", "ses-liam-0718-a", "usr-liam", "2026-07-18T07:38:00+05:30", 19, "dossier", "voc_submitted", "Submitted product feedback", { articleId: "blue-oled", metadata: { feedbackId: "voc-1039", rating: 2, category: "summary" } }),

  action("act-priya-01", "ses-priya-0718-a", "usr-priya", "2026-07-18T07:00:00+05:30", 0, "sources", "page_view", "Opened Sources"),
  action("act-priya-02", "ses-priya-0718-a", "usr-priya", "2026-07-18T07:07:00+05:30", 7, "sources", "source_tested", "Tested a broadcast source", { metadata: { sourceId: "advanced-television", result: "healthy" } }),
  action("act-priya-03", "ses-priya-0718-a", "usr-priya", "2026-07-18T07:14:00+05:30", 14, "briefing", "scan_opened", "Opened the scan monitor", { metadata: { sourceGroup: "broadcast", mode: "fast" } }),

  action("act-devansh-01", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T07:36:00+05:30", 0, "analytics", "page_view", "Opened restricted Analytics"),
  action("act-devansh-02", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T07:41:00+05:30", 5, "analytics", "analytics_user_opened", "Opened a user activity drilldown", { metadata: { targetUserId: "usr-maya" } }),
  action("act-devansh-03", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T07:44:00+05:30", 8, "analytics", "analytics_session_opened", "Opened a session action timeline", { metadata: { targetSessionId: "ses-maya-0718-a" } }),
  action("act-devansh-04", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T07:51:00+05:30", 15, "analytics", "desk_profile_changed", "Switched to Broadcast desk preview", { metadata: { from: "default", to: "broadcast" } }),
  action("act-devansh-05", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T07:54:00+05:30", 18, "settings", "theme_changed", "Switched Broadcast desk to dark theme", { metadata: { from: "light", to: "dark" } }),
  action("act-devansh-06", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T08:08:00+05:30", 32, "dossier", "article_opened", "Opened an article dossier", { articleId: "provenance" }),
  action("act-devansh-07", "ses-devansh-0718-a", "usr-devansh", "2026-07-18T08:24:00+05:30", 48, "settings", "voc_submitted", "Submitted product feedback", { metadata: { feedbackId: "voc-1042", rating: 5, category: "usability" } }),
];

export const vocSubmissions: VocSubmission[] = [
  { id: "voc-1041", userId: "usr-maya", sessionId: "ses-maya-0718-a", submittedAt: "2026-07-18T08:27:00+05:30", minutesIntoSession: 44, rating: 4, category: "relevance", status: "triaged", message: "The ordering is strong; a clearer explanation for keeping two similar items would help editorial review.", followUpRequested: false, screen: "selected", deskProfile: "default", articleId: "eu-agent-rules", diagnosticContextIncluded: true },
  { id: "voc-1042", userId: "usr-devansh", sessionId: "ses-devansh-0718-a", submittedAt: "2026-07-18T08:24:00+05:30", minutesIntoSession: 48, rating: 5, category: "usability", status: "resolved", message: "The desk-profile indicator and session drilldown remain clear in both themes.", followUpRequested: false, screen: "settings", deskProfile: "broadcast", diagnosticContextIncluded: true },
  { id: "voc-1040", userId: "usr-arjun", sessionId: "ses-arjun-0718-a", submittedAt: "2026-07-18T08:09:00+05:30", minutesIntoSession: 28, rating: 3, category: "workflow", status: "planned", message: "A bulk owner change from Selected would reduce repeated workflow edits.", followUpRequested: true, screen: "workflow", deskProfile: "default", diagnosticContextIncluded: true },
  { id: "voc-1039", userId: "usr-liam", sessionId: "ses-liam-0718-a", submittedAt: "2026-07-18T07:38:00+05:30", minutesIntoSession: 19, rating: 2, category: "summary", status: "new", message: "The OLED summary should separate laboratory claims from independently verified performance.", followUpRequested: true, screen: "dossier", deskProfile: "default", articleId: "blue-oled", diagnosticContextIncluded: true },
  { id: "voc-1038", userId: "usr-sofia", sessionId: "ses-sofia-0718-a", submittedAt: "2026-07-18T07:52:00+05:30", minutesIntoSession: 23, rating: 4, category: "sources", status: "triaged", message: "Source comparison is useful; showing which report supplied each technical claim would make it stronger.", followUpRequested: false, screen: "dossier", deskProfile: "default", articleId: "robot-foundation", diagnosticContextIncluded: false },
];

export const telemetryMock = {
  referenceTime: telemetryReferenceTime,
  users: telemetryUsers,
  sessions: telemetrySessions,
  actions: telemetryActions,
  feedback: vocSubmissions,
};

export type TelemetryMock = typeof telemetryMock;
