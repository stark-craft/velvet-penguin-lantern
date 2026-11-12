export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 180_000;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`The request took longer than ${Math.round(timeoutMs / 1000)} seconds. Try again.`);
    this.name = 'RequestTimeoutError';
    this.code = 'REQUEST_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Give every browser request a finite lifetime while preserving a caller's
 * AbortSignal. This keeps route loaders and action buttons recoverable when a
 * backend, proxy, or upstream service accepts a connection but never replies.
 */
export async function fetchWithTimeout(input, options = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const duration = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const callerSignal = options.signal;
  if (callerSignal?.aborted) {
    throw callerSignal.reason || new DOMException('Request aborted', 'AbortError');
  }

  const controller = new AbortController();
  let timeoutError = null;
  const forwardAbort = () => controller.abort(
    callerSignal?.reason || new DOMException('Request aborted', 'AbortError'),
  );
  callerSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = globalThis.setTimeout(() => {
    timeoutError = new RequestTimeoutError(duration);
    controller.abort(timeoutError);
  }, duration);

  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } catch (error) {
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  }
}
