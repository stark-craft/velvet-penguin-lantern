// Pure helper for Research reload partial failure handling
export function evaluateReloadResult(discStatus, intelStatus, discError, intelError) {
  const hasDiscovery = discStatus === 'fulfilled';
  const hasIntel = intelStatus === 'fulfilled';
  if (hasDiscovery && hasIntel) {
    return { status: 'success', message: 'Research refreshed successfully.' };
  }
  if (!hasDiscovery && !hasIntel) {
    return { status: 'failure', message: discError?.message || intelError?.message || 'Reload failed', preserve: false };
  }
  // Partial: preserve safely received but return failure
  const msg = discError?.message || intelError?.message || 'Partial reload failure';
  return { status: 'failure', message: msg, preserve: true, partial: true };
}

export function shouldShowSuccess(result) {
  return result.status === 'success';
}

// Single-flight guard for Research refresh: ensures exactly one concurrent
// refresh request while one is already running. Used by ResearchOverview
// (via SamparkResearch) to prevent duplicate provider refreshes.
export function createSingleFlight() {
  let running = false;
  return {
    isRunning: () => running,
    tryStart: () => {
      if (running) return false;
      running = true;
      return true;
    },
    finish: () => {
      running = false;
    },
  };
}

// Alias kept for readability at call sites.
export const createRefreshGuard = createSingleFlight;
