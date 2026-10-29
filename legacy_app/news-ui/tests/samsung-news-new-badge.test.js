import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAMSUNG_NEW_BADGE_WINDOW_MS,
  isRecentlyPublishedSamsungItem,
  publishedRecordToSignal,
  SAMPARK_SAMSUNG_CHANNELS,
  buildSamparkSamsungModel,
} from '../src/sampark/samsung-news/samsungNewsModel.js';

const now = Date.parse('2026-10-29T08:00:00Z');
const published = (deltaMs, contentType = 'document_import') => publishedRecordToSignal({
  id: `record-${contentType}`,
  status: 'published',
  contentType,
  author: 'Example Author',
  title: 'Published content',
  publishedAt: new Date(now - deltaMs).toISOString(),
});

test('Tech AXis is display-only: internal channel ID remains stable', () => {
  assert.deepEqual(SAMPARK_SAMSUNG_CHANNELS.map((x) => x.label), [
    'SRI-D Tech AXis', 'Samsung Global', 'Samsung Local',
  ]);
  const result = buildSamparkSamsungModel({ feed: {}, published: [] });
  assert.equal(result.internal.id, 'internal');
  assert.equal(result.internal.label, 'SRI-D Tech AXis');
});

test('NEW is true for published documents, stories, announcements within 48h', () => {
  assert.equal(SAMSUNG_NEW_BADGE_WINDOW_MS, 48 * 60 * 60 * 1000);
  for (const contentType of ['document_import', 'story', 'announcement']) {
    assert.equal(isRecentlyPublishedSamsungItem(published(1000, contentType), now), true);
  }
  assert.equal(isRecentlyPublishedSamsungItem(published(SAMSUNG_NEW_BADGE_WINDOW_MS - 1), now), true);
});

test('NEW expires at exactly 48h and rejects future publication', () => {
  assert.equal(isRecentlyPublishedSamsungItem(published(SAMSUNG_NEW_BADGE_WINDOW_MS), now), false);
  assert.equal(isRecentlyPublishedSamsungItem(published(SAMSUNG_NEW_BADGE_WINDOW_MS + 1), now), false);
  assert.equal(isRecentlyPublishedSamsungItem(published(-1000), now), false);
});

test('NEW does not accept unpublished, feed-only, date-only or edited-only content', () => {
  assert.equal(isRecentlyPublishedSamsungItem(null, now), false);
  assert.equal(isRecentlyPublishedSamsungItem({ published_at: new Date(now).toISOString() }, now), false);
  assert.equal(isRecentlyPublishedSamsungItem({ _isInternalPublished: true, _publishedId: 'x', published_at: '2026-10-29' }, now), false);
  const editedOnly = publishedRecordToSignal({
    id: 'draft', status: 'published', contentType: 'document_import',
    updatedAt: new Date(now - 1000).toISOString(), title: 'Older document',
  });
  assert.equal(isRecentlyPublishedSamsungItem(editedOnly, now), false);
  const source = published(1000);
  assert.equal(isRecentlyPublishedSamsungItem({ ...source, _isInternalPublished: false }, now), false);
});

test('MD signature uses the real contributor name, never institutional fallback', () => {
  const named = publishedRecordToSignal({
    id: 'md1', contentType: 'leadership', status: 'published',
    author: 'Taylor', publishedAt: '2026-10-29T07:00:00Z',
  });
  assert.equal(named.signatureAuthor, 'Taylor');
  const unnamed = publishedRecordToSignal({
    id: 'md2', contentType: 'leadership', status: 'published',
    publishedAt: '2026-10-29T07:00:00Z',
  });
  assert.equal(unnamed.signatureAuthor, '');
  assert.equal(unnamed.author, 'Samsung Research Institute Delhi');
});
