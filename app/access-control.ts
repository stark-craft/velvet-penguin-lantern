import { headers } from "next/headers";
import type { AccessCapabilities } from "@/types/news";

const splitAllowlist = (value: string | undefined) =>
  new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));

const normalizeIp = (value: string | null) => {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first?.replace(/^::ffff:/, "") || null;
};

export async function resolveAccessCapabilities(email: string | null): Promise<AccessCapabilities> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const expectedProxySecret = process.env.SIGNALROOM_PROXY_SHARED_SECRET ?? "";
  const receivedProxySecret = requestHeaders.get("x-signalroom-proxy-secret") ?? "";
  const authenticatedProxy = process.env.NODE_ENV !== "production" || (
    expectedProxySecret.length >= 32 && receivedProxySecret === expectedProxySecret
  );
  const trustProxyIpHeaders = authenticatedProxy && process.env.SIGNALROOM_TRUST_PROXY_IP_HEADERS === "true";
  const ip = trustProxyIpHeaders ? normalizeIp(
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for"),
  ) : null;
  const localPreview = process.env.NODE_ENV !== "production" && (host.startsWith("localhost") || host.startsWith("127.0.0.1"));
  const allowedEmails = splitAllowlist(process.env.SIGNALROOM_ADMIN_EMAILS);
  const allowedIps = splitAllowlist(process.env.SIGNALROOM_ANALYTICS_IPS);
  const emailAllowed = Boolean(authenticatedProxy && email && allowedEmails.has(email.toLowerCase()));
  const ipAllowed = Boolean(ip && allowedIps.has(ip.toLowerCase()));
  const elevated = localPreview || emailAllowed || ipAllowed;

  return {
    isAdmin: false,
    canViewAnalytics: elevated,
    canSwitchDeskProfile: elevated,
    canReviewGatekeeper: elevated,
    canManageSources: elevated,
    canManageJobs: elevated,
    accessLabel: localPreview ? "Local developer" : emailAllowed ? "Developer identity" : ipAllowed ? "Approved network" : "Standard desk",
  };
}
