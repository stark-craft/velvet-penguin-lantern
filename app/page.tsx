import SignalroomApp from "@/components/SignalroomApp";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { resolveAccessCapabilities } from "@/app/access-control";

export const dynamic = "force-dynamic";

export default async function Home() {
  const account = await getChatGPTUser();
  const capabilities = await resolveAccessCapabilities(account?.email ?? null);
  const viewer = {
    id: account?.email.toLowerCase() ?? "local-analyst",
    displayName: account?.fullName ?? account?.displayName ?? "Analyst",
    contactEmail: "",
    accountEmail: account?.email ?? null,
    roleLabel: capabilities.canViewAnalytics ? "Intelligence lead" : "Intelligence analyst",
    currentIp: "Resolving…",
    petEnabled: false,
    petKind: "orbit" as const,
    petColor: "violet" as const,
  };
  return <SignalroomApp initialViewer={viewer} capabilities={capabilities} />;
}
