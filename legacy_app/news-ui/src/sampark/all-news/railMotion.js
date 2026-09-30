// Measure the beginning of the next copy, including the gap between copies.
export function railLoopDistance(track, itemCount) {
  const first = track?.children?.[0];
  const nextCopy = track?.children?.[itemCount];
  if (!first || !nextCopy) return 0;
  const distance = nextCopy.getBoundingClientRect().top - first.getBoundingClientRect().top;
  return Number.isFinite(distance) && distance > 0 ? distance : 0;
}

export function normalizeRailOffset(offset, distance) {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.max(0, Number(offset) || 0) % distance;
}

export function advanceRailOffset(offset, elapsedMilliseconds, distance, reducedMotion = false) {
  // A monitor move or a delayed frame must not cause a large catch-up jump.
  const elapsed = Math.max(0, Math.min(100, Number(elapsedMilliseconds) || 0));
  const pixelsPerSecond = reducedMotion ? 18 / 1.75 : 18;
  return normalizeRailOffset(offset + elapsed * pixelsPerSecond / 1000, distance);
}

export function railCopyCount(viewportHeight, distance) {
  if (!Number.isFinite(distance) || distance <= 0) return 2;
  return Math.max(2, Math.ceil(Math.max(0, Number(viewportHeight) || 0) / distance) + 1);
}
