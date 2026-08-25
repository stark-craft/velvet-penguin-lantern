import { apiRequest } from "../shared/api/client.js";

export const getVentureOverview = () => apiRequest("/venture-lens/overview");

export const getVentureDiscovery = (refresh = false) =>
  apiRequest(`/venture-lens/discovery${refresh ? "?refresh=true" : ""}`);

export const refreshVentureLens = () =>
  apiRequest("/venture-lens/refresh", { method: "POST" });

export const getVentureIntelligence = () =>
  apiRequest("/venture-lens/intelligence");

export const getTechnologyDossier = (id) =>
  apiRequest(`/venture-lens/dossier/technology/${encodeURIComponent(id)}`);

export const getRepositoryDossier = (id) =>
  apiRequest(`/venture-lens/dossier/repository/${String(id).split("/").map(encodeURIComponent).join("/")}`);

export const getPaperDossier = (id) =>
  apiRequest(`/venture-lens/dossier/paper/${encodeURIComponent(id)}`);

const pathIdentifier = (id) => String(id || "").split("/").map(encodeURIComponent).join("/");

export const getModelDossier = (id) =>
  apiRequest(`/venture-lens/dossier/model/${pathIdentifier(id)}`);

export const getDatasetDossier = (id) =>
  apiRequest(`/venture-lens/dossier/dataset/${pathIdentifier(id)}`);

export const getPatentDossier = (id) =>
  apiRequest(`/venture-lens/dossier/patent/${pathIdentifier(id)}`);

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
