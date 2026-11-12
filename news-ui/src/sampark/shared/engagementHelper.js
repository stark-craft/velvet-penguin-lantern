// Pure helpers for dwell calculation, used by useArticleEngagement and tested with fake timers
export function computeActiveMs(total, start, visible, now = Date.now()) {
  if (visible && start != null) {
    return total + (now - start);
  }
  return total;
}

export function shouldEmitDwell(total, start, visible, sentDwell, sentOpen, now = Date.now()) {
  if (!visible || sentDwell || !sentOpen) return false;
  const active = computeActiveMs(total, start, visible, now);
  return active >= 5000;
}

export function flushDwellOnClose({ total, start, visible, sentOpen, sentDwell }, now = Date.now()) {
  let newTotal = total;
  let newStart = start;
  let newVisible = visible;
  if (visible && start != null) {
    newTotal = total + (now - start);
    newStart = 0;
    newVisible = false;
  }
  const shouldEmit = sentOpen && !sentDwell && newTotal >= 5000;
  return { total: newTotal, start: newStart, visible: newVisible, shouldEmit, activeMs: newTotal };
}
