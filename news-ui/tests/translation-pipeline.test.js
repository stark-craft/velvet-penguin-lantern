import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserTranslationCapability,
  uniqueTranslationValues,
} from '../src/news-scrapper/translation/usePageTranslation.js';

test('translation work is deduplicated before an engine request', () => {
  assert.deepEqual(
    uniqueTranslationValues([
      'A useful headline',
      ' A useful headline ',
      'A useful headline',
      'Another useful headline',
      'https://example.com/story',
      '',
    ]),
    ['A useful headline', 'Another useful headline'],
  );
});

test('browser translation is progressive enhancement and never required on LAN HTTP', () => {
  const Translator = { create() {} };
  assert.deepEqual(
    browserTranslationCapability({ isSecureContext: false, Translator }),
    { available: false, reason: 'unsupported' },
  );
  assert.equal(
    browserTranslationCapability({ isSecureContext: true, Translator }).available,
    true,
  );
});
