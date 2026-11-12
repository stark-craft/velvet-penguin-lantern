// One same-origin contract for both environments: Vite proxies these requests
// during development and FastAPI serves them beside the production bundle.
// Never bake localhost or a workstation hostname into the copied build.
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from './requestTimeout.js';

const API_BASE = "";

export async function apiRequest(path, options = {}) {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    },
  }, timeoutMs);

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      payload?.detail ||
      payload?.message ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}
