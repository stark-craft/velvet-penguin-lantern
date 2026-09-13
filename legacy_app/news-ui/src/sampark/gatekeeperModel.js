// Pure Gatekeeper list reconciliation. Tested behaviorally; SamparkGatekeeper
// renders from these so background refresh never erases loaded pages.
import { decodeHtmlEntities } from '../news-scrapper/utils/normalize.js';

export function rowId(row, fallback) {
  return String(row?.id || row?.title || `signal-${fallback}`);
}

// Merge one fetched page into the loaded window. Append extends by stable id;
// refresh replaces the whole window (caller sizes limit to the loaded count).
export function mergeGatekeeperItems(current, incoming, { append = false } = {}) {
  const list = Array.isArray(current) ? current : [];
  const fresh = Array.isArray(incoming) ? incoming : [];
  if (!append) return [...fresh];
  const seen = new Set(list.map((d, i) => rowId(d, i)));
  return [...list, ...fresh.filter((d, i) => !seen.has(rowId(d, `new-${i}`)))];
}

// The next pagination offset always begins after the loaded window.
export function nextPageOffset(loadedItems) {
  return Array.isArray(loadedItems) ? loadedItems.length : 0;
}

// Restoration-queue polling authority: queue jobs or dropped records whose
// *restoration status* is queued/processing. Pipeline stages (bouncer_stage,
// stage, state) are never a polling signal.
export function restorationActive(queueJobs, droppedItems) {
  const active = (v) => v === 'queued' || v === 'processing';
  if (Array.isArray(queueJobs) && queueJobs.some((j) => active(j?.status))) return true;
  if (Array.isArray(droppedItems) && droppedItems.some((d) => active(d?.status))) return true;
  return false;
}

// Decode persisted presentation text (titles, reasons, sources, keywords)
// with the shared safe entity decoder — never dangerouslySetInnerHTML.
export function decodedRowText(value) {
  return decodeHtmlEntities(value ?? '');
}

export function decodedKeywords(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return list.map((k) => decodeHtmlEntities(String(k)).trim()).filter(Boolean);
}
