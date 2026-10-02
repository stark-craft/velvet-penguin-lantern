import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestId } from '../src/sampark/report-editor/requestId.js';

const contract = /^[a-zA-Z0-9-]{16,64}$/;

test('secure contexts use native UUID with its receiver intact', () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return '47acbeb9-b5db-4891-a770-482cce3f2b5b'; } };
  assert.equal(createRequestId(crypto), '47acbeb9-b5db-4891-a770-482cce3f2b5b');
});

test('plain HTTP hosts can generate a request ID without randomUUID', () => {
  const crypto = { getRandomValues(bytes) { assert.equal(this, crypto); bytes.set(Array.from({length:16}, (_, i) => i)); return bytes; } };
  assert.equal(createRequestId(crypto), 'report-000102030405060708090a0b0c0d0e0f');
  assert.match(createRequestId(crypto), contract);
});

test('unusable randomUUID falls back to available random bytes', () => {
  assert.equal(createRequestId({randomUUID() { throw new Error('Unavailable'); }, getRandomValues(bytes) { return bytes.fill(255); }}), `report-${'ff'.repeat(16)}`);
});

test('hosts without usable Web Crypto still get distinct valid request IDs', t => {
  t.mock.method(Date, 'now', () => 0);
  t.mock.method(Math, 'random', () => 0);
  const first = createRequestId(null);
  const second = createRequestId({getRandomValues() { throw new Error('Unavailable'); }});
  assert.match(first, contract);
  assert.match(second, contract);
  assert.notEqual(first, second);
});
