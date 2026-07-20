import { headers } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RESPONSE_HEADERS = ["content-disposition", "content-type", "x-signalroom-article-count"];

function isAuthenticatedProxyRequest(requestHeaders: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = process.env.SIGNALROOM_PROXY_SHARED_SECRET ?? "";
  const received = requestHeaders.get("x-signalroom-proxy-secret") ?? "";
  return expected.length >= 32 && received === expected;
}

function backendOrigin(): URL {
  const configured = process.env.SIGNALROOM_BACKEND_URL ?? "http://127.0.0.1:8000";
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("SIGNALROOM_BACKEND_URL must be an HTTP(S) origin without credentials");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function safePath(parts: string[]): string {
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("/"))) {
    throw new Error("Invalid Signalroom API path");
  }
  return parts.map(encodeURIComponent).join("/");
}

function trustedClientIp(requestHeaders: Headers): string {
  if (process.env.SIGNALROOM_TRUST_PROXY_IP_HEADERS !== "true") {
    return process.env.SIGNALROOM_LOCAL_CLIENT_IP ?? "127.0.0.1";
  }
  // Enable this only when the frontend is itself behind a company-controlled
  // reverse proxy that overwrites these headers. Browser input is never read
  // from the request body or query string.
  const candidate = requestHeaders.get("cf-connecting-ip")
    ?? requestHeaders.get("x-real-ip")
    ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]
    ?? process.env.SIGNALROOM_LOCAL_CLIENT_IP
    ?? "127.0.0.1";
  return candidate.trim().replace(/^::ffff:/, "").slice(0, 64);
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const requestHeaders = await headers();
    if (
      process.env.NODE_ENV === "production" &&
      (process.env.SIGNALROOM_TRUST_PROXY_IP_HEADERS !== "true" || !isAuthenticatedProxyRequest(requestHeaders))
    ) {
      return Response.json(
        { detail: "The production BFF requires an authenticated trusted proxy; use the direct API build for the internal laptop deployment." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const [{ path }, account] = await Promise.all([
      context.params,
      getChatGPTUser(),
    ]);
    const target = new URL(`api/v1/${safePath(path)}`, backendOrigin());
    target.search = new URL(request.url).search;

    const outgoing = new Headers({
      accept: request.headers.get("accept") ?? "application/json",
      "x-forwarded-for": trustedClientIp(requestHeaders),
      "x-forwarded-proto": new URL(request.url).protocol.replace(":", ""),
      "x-signalroom-proxy": "frontend-bff-v1",
    });
    if (account?.email) outgoing.set("x-signalroom-user-email", account.email.toLowerCase());
    const contentType = request.headers.get("content-type");
    if (contentType) outgoing.set("content-type", contentType);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: outgoing,
        body: METHODS_WITH_BODY.has(request.method) ? await request.arrayBuffer() : undefined,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseHeaders = new Headers({ "cache-control": "no-store, private" });
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The Signalroom backend timed out"
      : "The Signalroom backend is unavailable";
    return Response.json({ detail: message }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
