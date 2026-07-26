const API_BASE = import.meta.env.VITE_API_BASE || "";

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

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
