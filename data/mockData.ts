import type {
  Article,
  SourceRecord,
  StoryCluster,
  WorkflowItem,
} from "@/types/news";

export const navigation = [
  { group: "Desk", items: [
    { id: "briefing", label: "Morning Briefing", icon: "◫" },
    { id: "discover", label: "Discover", icon: "⌁" },
    { id: "search", label: "Search", icon: "⌕" },
  ]},
  { group: "Decisions", items: [
    { id: "selected", label: "Selected", icon: "✓" },
    { id: "workflow", label: "Workflow", icon: "▦" },
    { id: "saved", label: "Saved", icon: "◇" },
  ]},
  { group: "Audit", items: [
    { id: "gatekeeper", label: "Gatekeeper", icon: "◎" },
    { id: "dropped", label: "Dropped Articles", icon: "↘" },
    { id: "not-interested", label: "Not Interested", icon: "⊘" },
    { id: "history", label: "History", icon: "◷" },
  ]},
  { group: "System", items: [
    { id: "sources", label: "Sources", icon: "⌂" },
    { id: "analytics", label: "Analytics", icon: "⌗" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ]},
];

export const briefingMetrics = [
  { label: "Discovered", value: 184, delta: "+7%", tone: "neutral" },
  { label: "Retained", value: 123, delta: "66.8%", tone: "positive" },
  { label: "Gatekeeper", value: 61, delta: "rejected", tone: "negative" },
  { label: "Clusters", value: 32, delta: "+5 today", tone: "cluster" },
  { label: "Priority", value: 7, delta: "3 critical", tone: "priority" },
  { label: "In review", value: 18, delta: "queue", tone: "warning" },
  { label: "Approved", value: 9, delta: "+3", tone: "positive" },
  { label: "Saved", value: 14, delta: "3 folders", tone: "saved" },
];

export const articles: Article[] = [
  {
    id: "agent-controls",
    headline: "OpenAI adds policy gates and audit trails for enterprise AI agents",
    summary: "A new control layer lets administrators cap tool permissions, require human sign-off for sensitive actions, and inspect a trace of every agent decision across shared workspaces.",
    insight: "Governance is becoming a buying criterion, not a post-deployment add-on.",
    source: "Reuters", sourceCode: "R", author: "Anna Tong", published: "07:42 IST", date: "18 Jul 2026", image: "/images/server-room.jpg",
    category: "AI Agents", team: "Cloud Team", region: "North America", keywords: ["agent orchestration", "audit logs", "enterprise AI"], entities: ["OpenAI", "Microsoft"], technologies: ["Policy gates", "Agent traces"],
    priority: "critical", relevance: 98, confidence: 96, signal: "opportunity", status: "Under Review", credibility: 96,
    gatekeeper: { verdict: "Retained", reason: "Direct impact on enterprise agent governance and procurement.", considered: ["enterprise", "agents", "governance", "audit"] },
  },
  {
    id: "eu-agent-rules",
    headline: "EU regulators outline evidence rules for high-risk autonomous agents",
    summary: "Draft guidance would require operators to preserve model, tool and human-override records when agents make decisions in employment, finance, or essential services.",
    insight: "The record-keeping burden may reshape enterprise agent architecture before formal enforcement begins.",
    source: "Financial Times", sourceCode: "FT", author: "Madhumita Murgia", published: "07:18 IST", date: "18 Jul 2026", image: "/images/server-room.jpg",
    category: "Regulation", team: "Regulatory Team", region: "Europe", keywords: ["AI Act", "auditability", "high-risk systems"], entities: ["European Commission", "EU AI Office"], technologies: ["Autonomous agents", "Decision logs"],
    priority: "critical", relevance: 97, confidence: 95, signal: "risk", status: "Selected", credibility: 95,
    gatekeeper: { verdict: "Retained", reason: "Material regulatory signal for autonomous-decision products.", considered: ["regulation", "agents", "AI Act", "evidence"] },
  },
  {
    id: "blue-oled",
    headline: "Samsung Display demonstrates blue OLED stack with 25% lower power draw",
    summary: "A prototype television panel pairs a longer-lived blue emitter with adaptive drive electronics, reducing peak power without sacrificing color volume in lab tests.",
    insight: "If production yield holds, efficiency—not brightness—could define the next premium-TV cycle.",
    source: "The Elec", sourceCode: "EL", author: "Jung Min-hee", published: "06:55 IST", date: "18 Jul 2026", image: "/images/oled-display.jpg",
    category: "Display Technology", team: "TV & Display Team", region: "South Korea", keywords: ["blue OLED", "power", "emitter"], entities: ["Samsung Display", "UDC"], technologies: ["OLED", "Adaptive drive"],
    priority: "high", relevance: 95, confidence: 93, signal: "opportunity", status: "Approved", credibility: 85,
    gatekeeper: { verdict: "Retained", reason: "Strong product signal for the premium display roadmap.", considered: ["OLED", "display", "efficiency", "Samsung"] },
  },
  {
    id: "orange-agents",
    headline: "Orange pilots intent-based AI agents across five 5G operations centers",
    summary: "The trial translates service goals into network actions, then asks operators to approve changes affecting capacity, energy use, and fault recovery.",
    insight: "Human-in-the-loop network automation is moving from demos into operational workflows.",
    source: "Fierce Network", sourceCode: "FN", author: "Linda Hardesty", published: "06:31 IST", date: "18 Jul 2026", image: "/images/server-room.jpg",
    category: "Telecom", team: "Cloud Team", region: "Europe", keywords: ["5G", "network operations", "intent-based"], entities: ["Orange", "Nokia"], technologies: ["5G", "AI agents"],
    priority: "high", relevance: 92, confidence: 91, signal: "mixed", status: "Under Review", credibility: 87,
    gatekeeper: { verdict: "Retained", reason: "Concrete enterprise deployment with human-approval controls.", considered: ["5G", "agents", "network", "operations"] },
  },
  {
    id: "robot-foundation",
    headline: "NVIDIA releases compact robotics model for on-device planning",
    summary: "The multimodal model combines camera, language, and motion inputs and is tuned to run on edge modules for warehouse and service robots with intermittent connectivity.",
    insight: "Smaller local models reduce latency and data exposure, widening viable robotics deployments.",
    source: "IEEE Spectrum", sourceCode: "IE", author: "Evan Ackerman", published: "05:58 IST", date: "18 Jul 2026", image: "/images/robotics.jpg",
    category: "Robotics", team: "Robotics Team", region: "Global", keywords: ["VLA", "edge AI", "robotics"], entities: ["NVIDIA", "FANUC"], technologies: ["Vision-language-action", "Edge inference"],
    priority: "high", relevance: 94, confidence: 92, signal: "opportunity", status: "Selected", credibility: 94,
    gatekeeper: { verdict: "Retained", reason: "High relevance to edge robotics and deployment economics.", considered: ["robotics", "edge", "model", "planning"] },
  },
  {
    id: "provenance",
    headline: "Broadcasters unite on live content provenance standard ahead of election season",
    summary: "A coalition of public and commercial broadcasters will embed signed capture and edit metadata into live news feeds while preserving compatibility with existing playout systems.",
    insight: "Provenance is shifting from experimental watermarking to newsroom infrastructure.",
    source: "Advanced Television", sourceCode: "AT", author: "Mark Layton", published: "05:36 IST", date: "18 Jul 2026", image: "/images/oled-display.jpg",
    category: "Broadcasting", team: "Media Intelligence Team", region: "Global", keywords: ["C2PA", "provenance", "elections"], entities: ["BBC", "EBU", "C2PA"], technologies: ["Content credentials", "Live production"],
    priority: "critical", relevance: 96, confidence: 97, signal: "risk", status: "Approved", credibility: 90,
    gatekeeper: { verdict: "Retained", reason: "Priority media-integrity infrastructure signal.", considered: ["broadcast", "provenance", "election", "C2PA"] },
  },
  {
    id: "scene-ads",
    headline: "Netflix tests scene-aware ad placement that avoids dialogue and plot turns",
    summary: "A contextual system maps scene boundaries, emotional intensity, and brand-safety signals to suggest lower-disruption positions for ad-supported streams.",
    insight: "Commercial upside is meaningful, but transparency around contextual profiling will matter.",
    source: "Variety", sourceCode: "V", author: "Todd Spangler", published: "04:49 IST", date: "18 Jul 2026", image: "/images/oled-display.jpg",
    category: "Advertising", team: "Media Intelligence Team", region: "North America", keywords: ["streaming ads", "contextual AI", "ad tier"], entities: ["Netflix", "IAB"], technologies: ["Scene detection", "Contextual AI"],
    priority: "medium", relevance: 86, confidence: 88, signal: "mixed", status: "New", credibility: 89,
    gatekeeper: { verdict: "Retained", reason: "Relevant streaming-monetization product test.", considered: ["streaming", "ads", "AI", "context"] },
  },
  {
    id: "india-satcom",
    headline: "India proposes shared spectrum framework for satellite broadband and DTH",
    summary: "The consultation explores coordination zones, interference reporting, and time-bound spectrum access as low-earth-orbit broadband scales alongside incumbent broadcast services.",
    insight: "The framework could lower entry barriers while raising compliance costs for DTH operators.",
    source: "TelecomTalk", sourceCode: "TT", author: "Gopal Vittal", published: "03:20 IST", date: "18 Jul 2026", image: "/images/server-room.jpg",
    category: "DTH", team: "Regulatory Team", region: "India", keywords: ["LEO", "spectrum", "DTH"], entities: ["TRAI", "DoT", "ISRO"], technologies: ["Satellite broadband", "Spectrum sharing"],
    priority: "critical", relevance: 93, confidence: 91, signal: "mixed", status: "Selected", credibility: 82,
    gatekeeper: { verdict: "Retained", reason: "Policy change may affect DTH and broadband deployment timelines.", considered: ["spectrum", "DTH", "satellite", "India"] },
  },
];

export const clusters: StoryCluster[] = [
  {
    id: "agent-governance", title: "Enterprise agent governance moves from policy to product controls",
    summary: "Six reports converge on a single market shift: enterprise agent platforms are adding permission boundaries, decision traces, and mandatory human review as deployers prepare for tighter audit expectations.",
    image: "/images/server-room.jpg", category: "AI Agents", team: "Cloud Team", region: "Global", confidence: 96, priority: "critical", signal: "mixed",
    entities: ["OpenAI", "Microsoft", "EU AI Office"], timeRange: "06:50–07:42 IST",
    sources: [
      { source: "Reuters", code: "R", headline: "OpenAI expands controls for enterprise agent deployments", time: "07:42", summary: "Administrators gain policy gates and granular traces.", similarity: 93 },
      { source: "TechCrunch", code: "TC", headline: "Enterprise agents get human approval checkpoints", time: "07:31", summary: "New safeguards focus on sensitive tool calls.", similarity: 89, duplicate: "Near duplicate" },
      { source: "Financial Times", code: "FT", headline: "Auditability moves to the center of agent procurement", time: "06:50", summary: "Buyers now treat governance as a core platform requirement.", similarity: 81 },
    ],
  },
  {
    id: "provenance-live", title: "Content provenance enters the live broadcast stack",
    summary: "Nine reports describe a coordinated push to sign capture and edit metadata inside existing newsroom systems, responding to synthetic-media risks ahead of major elections.",
    image: "/images/oled-display.jpg", category: "Broadcasting", team: "Media Intelligence Team", region: "Global", confidence: 97, priority: "critical", signal: "risk",
    entities: ["BBC", "EBU", "C2PA"], timeRange: "04:58–05:36 IST",
    sources: [
      { source: "Advanced Television", code: "AT", headline: "EBU members adopt live content credentials", time: "05:36", summary: "Signed metadata will follow news footage through playout.", similarity: 95 },
      { source: "Variety", code: "V", headline: "Newsrooms back content credentials ahead of elections", time: "05:18", summary: "Broadcasters coordinate standards and public messaging.", similarity: 88 },
      { source: "Broadband TV News", code: "BT", headline: "Provenance metadata enters broadcast playout", time: "04:58", summary: "Vendors begin integrating C2PA into established stacks.", similarity: 86, duplicate: "Syndicated" },
    ],
  },
];

export const initialWorkflow: WorkflowItem[] = [
  { id: "w1", articleId: "scene-ads", title: articles[6].headline, category: "Advertising", owner: "Maya Chen", team: "Media Intelligence", priority: "medium", status: "New", created: "Today", due: "20 Jul", notes: "Validate privacy angle", attachments: 0, exported: false },
  { id: "w2", articleId: "orange-agents", title: articles[3].headline, category: "Telecom", owner: "Arjun Rao", team: "Cloud", priority: "high", status: "Under Review", created: "Today", due: "19 Jul", notes: "Compare vendor claims", attachments: 2, exported: false },
  { id: "w3", articleId: "agent-controls", title: articles[0].headline, category: "AI Agents", owner: "Maya Chen", team: "Cloud", priority: "critical", status: "Under Review", created: "Today", due: "18 Jul", notes: "Board briefing candidate", attachments: 3, exported: false },
  { id: "w4", articleId: "robot-foundation", title: articles[4].headline, category: "Robotics", owner: "Sofia Kim", team: "Robotics", priority: "high", status: "Selected", created: "17 Jul", due: "20 Jul", notes: "Request benchmark context", attachments: 1, exported: false },
  { id: "w5", articleId: "blue-oled", title: articles[2].headline, category: "Display", owner: "Liam Brooks", team: "TV & Display", priority: "high", status: "Approved", created: "17 Jul", due: "18 Jul", notes: "Lead display section", attachments: 4, exported: false },
  { id: "w6", articleId: "provenance", title: articles[5].headline, category: "Broadcasting", owner: "Maya Chen", team: "Media Intelligence", priority: "critical", status: "Exported", created: "16 Jul", due: "18 Jul", notes: "Election risk memo", attachments: 2, exported: true },
];

export const sources: SourceRecord[] = [
  { id: "s1", name: "Reuters", code: "R", url: "reuters.com", category: "Business", region: "Global", enabled: true, deepScan: true, reliability: 96, lastScan: "8 min ago", discovered: 438 },
  { id: "s2", name: "Financial Times", code: "FT", url: "ft.com", category: "Business", region: "Global", enabled: true, deepScan: true, reliability: 95, lastScan: "12 min ago", discovered: 264 },
  { id: "s3", name: "The Elec", code: "EL", url: "thelec.net", category: "Display", region: "South Korea", enabled: true, deepScan: true, reliability: 85, lastScan: "16 min ago", discovered: 176 },
  { id: "s4", name: "Advanced Television", code: "AT", url: "advanced-television.com", category: "Broadcasting", region: "Europe", enabled: true, deepScan: false, reliability: 90, lastScan: "21 min ago", discovered: 201 },
  { id: "s5", name: "IEEE Spectrum", code: "IE", url: "spectrum.ieee.org", category: "Robotics", region: "Global", enabled: true, deepScan: true, reliability: 94, lastScan: "32 min ago", discovered: 119 },
  { id: "s6", name: "Fierce Network", code: "FN", url: "fierce-network.com", category: "Telecom", region: "North America", enabled: true, deepScan: false, reliability: 87, lastScan: "1h ago", discovered: 145, lastError: "One section timed out; partial scan retained" },
  { id: "s7", name: "TelecomTalk", code: "TT", url: "telecomtalk.info", category: "Telecom", region: "India", enabled: false, deepScan: false, reliability: 82, lastScan: "3h ago", discovered: 92, lastError: "Rate limited by source" },
  { id: "s8", name: "Variety", code: "V", url: "variety.com", category: "Media", region: "North America", enabled: true, deepScan: false, reliability: 89, lastScan: "43 min ago", discovered: 184 },
];

export const droppedArticles = [
  { id: "d1", headline: "AI-generated celebrity avatars headline a virtual fashion show", source: "TrendWire", rejected: "08:04 IST", score: 29, reason: "Entertainment-only coverage", category: "Media", keywords: ["AI avatar", "celebrity", "fashion"] },
  { id: "d2", headline: "Smart toaster gains a voice assistant and toast-history app", source: "Gadget Post", rejected: "07:51 IST", score: 21, reason: "Low-value consumer novelty", category: "Smart Home", keywords: ["smart", "assistant", "appliance"] },
  { id: "d3", headline: "Cryptocurrency token uses ‘agent’ branding in exchange promotion", source: "Coin Now", rejected: "07:33 IST", score: 16, reason: "Keyword collision; promotional content", category: "Technology News", keywords: ["agent", "token", "exchange"] },
  { id: "d4", headline: "Local retailer discounts last year’s television range", source: "Retail Beat", rejected: "06:49 IST", score: 18, reason: "Retail promotion without market signal", category: "Television", keywords: ["TV", "discount", "retail"] },
];

export const notInterestedArticles = [
  { id: "n1", headline: "Quarterly TV shipment tracker revised by 0.4%", source: "Panel Watch", marked: "Yesterday", expires: "5d 8h", category: "Television" },
  { id: "n2", headline: "Regional cable operator refreshes set-top-box packaging", source: "Cable Desk", marked: "3 days ago", expires: "12d 2h", category: "Cable" },
  { id: "n3", headline: "Smart speaker colorways announced for holiday retail", source: "Home Tech", marked: "Today", expires: "26d 14h", category: "Smart Home" },
];

export const historyItems = [
  { date: "17 July 2026", weekday: "Thursday", articles: 171, clusters: 29, categories: ["AI Agents", "Telecom", "Display"], approved: 8, exports: 2 },
  { date: "16 July 2026", weekday: "Wednesday", articles: 198, clusters: 35, categories: ["Regulation", "Broadcasting", "Robotics"], approved: 11, exports: 3 },
  { date: "15 July 2026", weekday: "Tuesday", articles: 143, clusters: 24, categories: ["Semiconductors", "Streaming", "AI Models"], approved: 7, exports: 1 },
  { date: "14 July 2026", weekday: "Monday", articles: 221, clusters: 39, categories: ["Display", "DTH", "Security"], approved: 13, exports: 4 },
];

export const notifications = [
  { id: 1, type: "success", title: "Morning scan completed", detail: "184 articles found across 42 active sources.", time: "8 min" },
  { id: 2, type: "priority", title: "Priority cluster detected", detail: "Agent governance coverage accelerated across six sources.", time: "14 min" },
  { id: 3, type: "warning", title: "Source partially unavailable", detail: "Fierce Network returned one section timeout.", time: "36 min" },
  { id: 4, type: "success", title: "Export ready", detail: "Board Briefing · 17 July is ready to share.", time: "1h" },
  { id: 5, type: "cluster", title: "New cluster created", detail: "Live content provenance · 9 related reports.", time: "2h" },
];

export const analyticsTrend = [
  { day: "Sat", discovered: 146, retained: 101, rejected: 45 },
  { day: "Sun", discovered: 178, retained: 119, rejected: 59 },
  { day: "Mon", discovered: 159, retained: 108, rejected: 51 },
  { day: "Tue", discovered: 221, retained: 146, rejected: 75 },
  { day: "Wed", discovered: 143, retained: 97, rejected: 46 },
  { day: "Thu", discovered: 198, retained: 132, rejected: 66 },
  { day: "Fri", discovered: 184, retained: 123, rejected: 61 },
];
