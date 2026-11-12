import { apiRequest } from "../shared/api/client.js";

export const getVentureOverview = () => apiRequest("/venture-lens/overview");

export const getVentureDiscovery = (refresh = false) =>
  apiRequest(`/venture-lens/discovery${refresh ? "?refresh=true" : ""}`);

export const refreshVentureLens = () =>
  apiRequest("/venture-lens/refresh", { method: "POST", timeoutMs: 120_000 });

export const getVentureIntelligence = () =>
  apiRequest("/venture-lens/intelligence");

export const getTechnologyDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/technology/${encodeURIComponent(id)}`, options);

export const getRepositoryDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/repository/${String(id).split("/").map(encodeURIComponent).join("/")}`, options);

export const getPaperDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/paper/${encodeURIComponent(id)}`, options);

const pathIdentifier = (id) => String(id || "").split("/").map(encodeURIComponent).join("/");

export const getModelDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/model/${pathIdentifier(id)}`, options);

export const getDatasetDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/dataset/${pathIdentifier(id)}`, options);

export const getPatentDossier = (id, options = {}) =>
  apiRequest(`/venture-lens/dossier/patent/${pathIdentifier(id)}`, options);

export const compareVentureSignals = (items) =>
  apiRequest("/venture-lens/compare", {
    method: "POST",
    body: JSON.stringify({ items }),
  });

export const toggleVentureWatchlist = (item) =>
  apiRequest("/venture-lens/watchlist/toggle", {
    method: "POST",
    body: JSON.stringify(item),
  });

export const markVentureNotificationsRead = () =>
  apiRequest("/venture-lens/notifications/read", { method: "POST" });
