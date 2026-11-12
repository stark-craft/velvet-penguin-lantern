import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_TEMPLATES,
  URL_LIMIT,
  blankCreateForm,
  contributionFromBriefing,
  countEnteredUrls,
  formFromContribution,
  previewParagraphs,
} from '../src/sampark/create-news/createNewsModel.js';

test('Create News exposes four stable story layouts and the 20 URL contract', () => {
  assert.deepEqual(STORY_TEMPLATES.map((entry) => entry.id), [
    'two-column',
    'list-view',
    'feature-card',
    'text-top',
  ]);
  assert.equal(URL_LIMIT, 20);
  assert.equal(countEnteredUrls('https://one.test/a\nhttp://two.test/b, invalid'), 2);
});

test('Create forms choose sensible SRI-D defaults and retain saved placement', () => {
  assert.equal(blankCreateForm('story').displaySection, 'srid');
  assert.equal(blankCreateForm('leadership').layout, 'feature-card');
  assert.equal(blankCreateForm('leadership').displaySection, 'hero');
  assert.equal(blankCreateForm('announcement').layout, 'text-top');

  const saved = formFromContribution({
    id: 'draft-1',
    contentType: 'story',
    layout: 'list-view',
    displaySection: 'hero',
    title: 'Display roadmap',
  });
  assert.equal(saved.layout, 'list-view');
  assert.equal(saved.displaySection, 'hero');
  assert.equal(saved.title, 'Display roadmap');
});

test('A completed URL briefing becomes editable contribution copy', () => {
  const form = contributionFromBriefing({
    title: 'A generated title',
    summary: 'A generated summary',
    full_contents: 'The complete extracted article body.',
    category: 'Technology',
    src: 'Example News',
  });
  assert.equal(form.title, 'A generated title');
  assert.equal(form.body, 'The complete extracted article body.');
  assert.equal(form.author, 'Example News');
  assert.equal(form.layout, 'two-column');
  assert.equal(form.displaySection, 'srid');
});

test('Preview copy breaks long body text into useful blocks', () => {
  assert.deepEqual(
    previewParagraphs('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.', 2),
    ['First paragraph.', 'Second paragraph.'],
  );
});
