export const navigation = [
  { group: "Desk", items: [
    { id: "briefing", label: "Briefing", icon: "◫" },
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
    { id: "feedback", label: "Share VOC", icon: "◉" },
    { id: "sources", label: "Sources", icon: "⌂" },
    { id: "analytics", label: "Analytics", icon: "⌗" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ]},
] as const;
