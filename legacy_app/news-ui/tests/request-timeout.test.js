import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestTimeoutError,
  fetchWithTimeout,
} from '../src/shared/api/requestTimeout.js';

function pendingFetch(_input, options = {}) {
  return new Promise((_, reject) => {
    options.signal?.addEventListener('abort', () => {
      reject(options.signal.reason || new DOMException('Request aborted', 'AbortError'));
    }, { once: true });
  });
}

test('shared requests fail with a recoverable timeout instead of hanging forever', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = pendingFetch;
  try {
    await assert.rejects(
      fetchWithTimeout('/slow-endpoint', {}, 5),
      (error) => error instanceof RequestTimeoutError
        && error.code === 'REQUEST_TIMEOUT'
        && error.timeoutMs === 5,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shared requests preserve a caller cancellation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = pendingFetch;
  const controller = new AbortController();
  try {
    const request = fetchWithTimeout('/cancelled-endpoint', { signal: controller.signal }, 5_000);
    controller.abort(new DOMException('Stopped by the viewer', 'AbortError'));
    await assert.rejects(request, (error) => error?.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
