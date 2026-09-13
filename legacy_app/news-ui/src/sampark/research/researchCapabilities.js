export const SUPPORTED_WATCH_KINDS = new Set(['technology', 'repository', 'paper']);
export const SUPPORTED_COMPARE_KINDS = new Set(['technology', 'repository', 'paper']);

export function isWatchSupported(kind) {
  return SUPPORTED_WATCH_KINDS.has(String(kind || '').toLowerCase());
}
export function isCompareSupported(kind) {
  return SUPPORTED_COMPARE_KINDS.has(String(kind || '').toLowerCase());
}
export function isSupportedArtifactKind(kind) {
  return isWatchSupported(kind) || isCompareSupported(kind);
}
