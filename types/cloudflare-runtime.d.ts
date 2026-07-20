/** Minimal build-time declarations supplied by the Vinext/Workers runtime. */
declare interface D1Database {
  prepare(query: string): unknown;
}

declare interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database; [name: string]: unknown };
}
