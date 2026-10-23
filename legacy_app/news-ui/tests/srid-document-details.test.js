import test from 'node:test';
import assert from 'node:assert/strict';
import { documentInsightOf, documentSignalOf, documentTagOf } from '../src/sampark/samsung-news/documentPresentation.js';

const published = {
  id: 'ic_example',
  contentType: 'document_import',
  status: 'published',
  title: 'Improving software development workflows',
  summary: 'A technical report on software engineering.',
  body: 'This document covers software engineering practices. Automated testing improves reliability across teams.',
  ownerName: 'Example Contributor',
  publishedAt: '2026-10-23T12:00:00Z',
  cover: { url: '/internal-content/ic_example/cover?v=1' },
  sourceDocument: { name: 'report.pdf', url: '/internal-content/ic_example/document' },
};

test('tag derives from actual extracted document body', () => {
  assert.equal(documentTagOf(published), 'Software Engineering');
  assert.equal(documentTagOf({
    ...published,
    body: 'Researchers achieved progress with AI-powered code generation.',
  }), 'AI & Machine Learning');
});

test('tag fallback is explicit if PDF extraction was unavailable', () => {
  assert.equal(documentTagOf({ body: '', summary: '', category: 'Technology' }), 'Technology');
  assert.equal(documentTagOf({ body: '', summary: '' }), 'Internal Document');
});

test('why matters selects an impact sentence from extracted text', () => {
  assert.equal(documentInsightOf(published), 'Automated testing improves reliability across teams.');
});

test('details maps the original document, image and stable reaction identity', () => {
  const signal = documentSignalOf(published);
  assert.equal(signal.canonical_link, 'internal://ic_example');
  assert.equal(signal.image_url, published.cover.url);
  assert.equal(signal.sourceDocument.url, published.sourceDocument.url);
  assert.equal(signal.sources[0].title, 'report.pdf');
  assert.equal(signal.src, 'Example Contributor');
  assert.equal(signal.why_matters, 'Automated testing improves reliability across teams.');
});

test('invalid input is not presented as a real published document', () => {
  assert.equal(documentSignalOf(null), null);
  assert.equal(documentSignalOf({ title: 'missing ID' }), null);
});
