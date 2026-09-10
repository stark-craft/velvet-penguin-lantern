# Sampark Workspaces — Inventory and Status

| Workspace | Sampark Route | Original Route | Purpose | Primary APIs | Mutations | Required Capability | Sampark Component | Status |
|---|---|---|---|---|---|---|---:|---|
| Saved & Following | `/sampark/following` | `/for-you/following` `FollowingScreen.jsx` | Private saved/follow threads, 30-day semantic updates | `GET /viewer/following` `GET /viewer/saved`, `POST /viewer/saved`, `POST /viewer/saved/remove` | `save/removeSaved` | none (private) | `SamparkFollowing.jsx` + modal in For You | **Complete** — uses `getFollowingThreads`, private per viewer, unfollow works, no leakage |
| Hidden News | `/sampark/hidden` | `/rejected` `RejectedScreen.jsx` | Private hidden stories, restore | `GET /viewer/hidden`, `POST /viewer/hidden`, `POST /viewer/hidden/restore` | `hide/restore` | none | `SamparkHidden.jsx` | **Complete** — private, restore works |
| Briefing Archives | `/sampark/history` | `/history` `HistoryScreen.jsx` | Daily briefing snapshots, approved feeds | `GET /history/list`, `GET /history/{file}`, `GET /history/range` | none (read) | none | `SamparkHistory.jsx` | Complete — list + detail, Sampark-native |
| VOC / Feedback | `/sampark/voc` | `/voc` `VocScreen.jsx` | Voice of Customer trends, feedback submission | `GET /voc`, `GET /trends/access`, `POST /voc` (if present) | feedback submit | none/trends view | `SamparkVoc.jsx` | Complete — trend cards, private where applicable |
| Review Center | `/sampark/review` | `/selected` `SelectedScreen.jsx` | Editorial review queue | `GET /workflow`, `POST /workflow/select` etc. | approve/reject/edit | `review.news.view` | `SamparkReview.jsx` | Complete — capability-gated shell, real `getWorkflow` |
| Approved Briefing | `/sampark/approved` | `/approved` `ApprovedScreen.jsx` | Approved stories | `GET /workflow` filtered `approved` | none | `approved.view` | `SamparkApproved.jsx` | Complete |
| Gatekeeper Review | `/sampark/gatekeeper` | `/gatekeeper-review` `GatekeeperCapabilityScreen.jsx` | Borderline, model/region correction | `GET /gatekeeper/*` | `model.train`, `region.correct` | `gatekeeper.review` | `SamparkGatekeeper.jsx` | Complete — distinct from Review, global training guarded |
| Source Control | `/sampark/sources` | `/sources` `SourcesScreen.jsx` | Source listing, enable/disable, category | `GET /sites`, `POST /sites` | `addSite`, `enable/disable` | `sources.view` / `sources.manage` | `SamparkSources.jsx` | Complete — table, view vs manage |
| Scheduler | `/sampark/scheduler` | `/scheduler` `SchedulerScreen.jsx` | Scheduler status, last/next run, Run Now | `GET /scheduler/status`, `POST /scheduler/run` | `runSchedulerNow` | `scheduler.view` / `control` | `SamparkScheduler.jsx` | Complete — coarse status, Run Now gated |
| Analytics | `/sampark/analytics` | `/director-analytics` `AnalyticsScreen.jsx` | Articles processed, kept/dropped, source performance | `GET /analytics`, `GET /analytics/recommendation-summary` | none | `analytics.view` | `SamparkAnalytics.jsx` | Complete — real values only |
| Access Management | `/sampark/access` | `/access-management` `AccessManagementScreen.jsx` | Principals, known IPs, capability grants | `GET /access-control/principals`, `PUT /principals/{id}`, `GET /access-control/audit` | `update_principal` | `access.manage` | `SamparkAccess.jsx` | Complete — privileged, confirmation required |

**Additional surfaces investigated:**
- **Scan** `/scan` `ScanScreen.jsx` `searchExtractedIntelligence` — main nav, not secondary, deferred (later All News/Scan phase) — **D**
- **Guide** `GuidePet` — optional, not a workspace — **D**
- **Venture Lens** `/venturelens/*` `VentureLensApp` — separate research product, not Sampark secondary — **D**
- **Internal Publishing** `/internal-publishing` `InternalPublishingScreen` — Create News, excluded per phase — **D**

**Routing principle:** All Sampark workspaces under `/sampark/*` shell (`SamparkApp.jsx` `main-card-container`), `TechScout` header persists, no old dark `Sense` UI leakage. Settings `Workspaces` links now `href="/sampark/..."` with `onClose`.

**Shared shell:** `src/sampark/shared/SamparkWorkspaceShell.jsx` (`WorkspaceHeader`, `WorkspaceEmpty`, `WorkspaceLoading`, `WorkspaceError`) — consistent typography, spacing, loading/empty/error.

**Capability visibility:** Settings and workspace routes gate via `effective_capabilities` (`getAccessCapabilities`) — ordinary viewer sees only Saved/Following, Hidden, History, VOC; privileged sees Review etc. per `any: [...]`.

**Privacy:** Saved, Following, Hidden are private per `private viewer_key` (`viewer_hidden_store` now private via `claim_legacy_private_bucket`), verified `Viewer A` `saved 1` vs `B 0` same IP.

**Status:** All 11 secondary workspaces have Sampark-native shells using existing backend contracts, no old UI leakage, no duplicated logic, no new backend writes beyond read.
