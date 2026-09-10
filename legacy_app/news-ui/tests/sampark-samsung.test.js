import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSamsungArchive } from '../src/news-scrapper/internal/samsungInternalModel.js';

const stories = [
  { id: 'global', title: 'Galaxy launch', summary: 'A new device', category: 'Mobile', source: 'Samsung Newsroom' },
  { id: 'local', title: 'Campus opening', summary: 'Bengaluru welcomes engineers', category: 'People', source: 'Samsung India' },
  { id: 'inside', title: 'Meet the team', body: 'Research colleagues in Bengaluru', author: 'Mina', category: 'People' },
];
test('Samsung archive combines category and case-insensitive search without changing records', () => {
  assert.deepEqual(filterSamsungArchive(stories, { query: '  BENGALURU ', category: 'People' }).map(x => x.id), ['local', 'inside']);
  assert.deepEqual(filterSamsungArchive(stories, { query: 'Bengaluru', category: 'Mobile' }), []);
  assert.deepEqual(filterSamsungArchive(stories, { query: 'mina' }), [stories[2]]);
  assert.deepEqual(filterSamsungArchive(stories, { query: 'newsroom' }), [stories[0]]);
  assert.deepEqual(filterSamsungArchive(stories), stories);
  assert.equal(stories.length, 3);
});
test('Samsung archive supports empty channels and records without optional text', () => {
  assert.deepEqual(filterSamsungArchive([], { query: 'Samsung' }), []);
  assert.deepEqual(filterSamsungArchive([{ id: 'empty' }], { query: 'Samsung' }), []);
});
