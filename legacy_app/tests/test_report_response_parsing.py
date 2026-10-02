"""Samsung response variation must not break private report generation."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from core.storage import JsonStore
from news_scrapper.adapters import samsung_chat as chat
from news_scrapper.reports import analysis, impact, service


class ChatJsonParsingTests(unittest.TestCase):
    def test_single_object_preserves_nested_values_and_braces_in_strings(self):
        expected = {
            'answer': 'A quoted "answer" with {braces} and a \\ path.',
            'metadata': {'points': ['One', 'Two']},
        }
        self.assertEqual(chat.extract_json(json.dumps(expected)), expected)

    def test_merges_adjacent_or_separately_fenced_complete_objects(self):
        first = json.dumps({'answer': 'Explanation', 'metadata': {'source': 'Publisher'}})
        second = json.dumps({'replacement': 'Detailed Samsung relevance'})
        for content in (
            first + second,
            first + '\n\n' + second,
            f'Analysis follows.\n```json\n{first}\n```\n```JSON\n{second}\n```\nDone.',
        ):
            with self.subTest(content=content):
                parsed = chat.extract_json(content)
                self.assertEqual(parsed['answer'], 'Explanation')
                self.assertEqual(parsed['replacement'], 'Detailed Samsung relevance')
                self.assertEqual(parsed['metadata'], {'source': 'Publisher'})

    def test_later_complete_object_can_correct_an_earlier_field(self):
        self.assertEqual(
            chat.extract_json('{"replacement":"Earlier"}\n{"replacement":"Corrected"}'),
            {'replacement': 'Corrected'},
        )

    def test_empty_object_is_valid_but_missing_or_invalid_json_fails_safely(self):
        self.assertEqual(chat.extract_json('```json\n{}\n```'), {})
        for content in (
            '', 'No JSON', '{"replacement":"truncated', '[]', 'null',
            '{"outer":{"replacement":"Nested fragment"}',
            '{"answer":"Complete"}\n{"replacement":"truncated',
        ):
            with self.subTest(content=content), self.assertRaises(RuntimeError) as raised:
                chat.extract_json(content)
            self.assertEqual(str(raised.exception), 'Samsung Chat response did not contain valid JSON')


class ReportResponseParsingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.store = JsonStore(Path(temp.name) / 'reports.json')
        for setting, value in (
            ('URL', 'https://example.test/chat'), ('CLIENT', 'test'),
            ('TOKEN', 'test'), ('MODEL_ID', 'test'),
        ):
            configuration = patch.object(chat, setting, value)
            configuration.start()
            self.addCleanup(configuration.stop)
        store_patch = patch.object(service, 'STORE', self.store)
        store_patch.start()
        self.addCleanup(store_patch.stop)
        response_patch = patch.object(chat, 'call_samsung_chat')
        self.call_chat = response_patch.start()
        self.addCleanup(response_patch.stop)
        from news_scrapper.adapters import samsung_web_search
        search_patch = patch.object(samsung_web_search, 'call_samsung_web_search_api')
        self.call_search = search_patch.start()
        self.addCleanup(search_patch.stop)
        self.article = {'title': 'Technology development', 'summary': 'Source-backed article evidence.'}

    def response(self, fields):
        self.call_chat.return_value = {'content': json.dumps(fields)}

    def test_impact_prefers_replacement_over_all_equivalent_fields(self):
        self.response({
            'replacement': '  Preferred full analysis  ', 'impact': 'Alternative impact',
            'analysis': 'Alternative analysis', 'samsung_impact': 'Alternative Samsung impact',
            'why_it_matters': 'Alternative implications', 'why_matters': 'Other implications',
            'answer': 'Short explanation',
        })
        self.assertEqual(impact.generate('viewer', self.article)['impact'], 'Preferred full analysis')

    def test_impact_accepts_each_equivalent_nonempty_string(self):
        for field in ('impact', 'analysis', 'samsung_impact', 'why_it_matters', 'why_matters', 'answer'):
            with self.subTest(field=field):
                self.response({'replacement': '  ', field: f'  Analysis from {field}  '})
                self.assertEqual(impact.generate(field, self.article)['impact'], f'Analysis from {field}')
                self.assertEqual(service.quota(field)['remaining'], 2)
        self.call_search.assert_not_called()

    def test_impact_skips_invalid_alias_types_and_uses_answer_last(self):
        self.response({
            'replacement': {}, 'impact': [], 'analysis': 2, 'samsung_impact': None,
            'why_it_matters': False, 'why_matters': '  ', 'answer': 'Usable answer',
        })
        self.assertEqual(impact.generate('viewer', self.article)['impact'], 'Usable answer')
        self.response({'why_matters': 'Full relevance', 'answer': 'Short explanation'})
        self.assertEqual(impact.generate('other', self.article)['impact'], 'Full relevance')

    def test_multiple_json_blocks_work_for_automatic_and_manual_generation(self):
        self.call_chat.return_value = {
            'content': '{"answer":"Explanation"}\n\n{"replacement":"Detailed relevance"}',
        }
        automatic = impact.generate('viewer', self.article)
        self.assertEqual(automatic['impact'], 'Detailed relevance')
        self.assertEqual(service.quota('viewer')['remaining'], 2)
        manual = service.ask('viewer', 'Why Samsung?', 'Evidence', 'request-00000001', 'samsung-impact')
        self.assertEqual(manual['answer'], 'Explanation')
        self.assertEqual(manual['replacement'], 'Detailed relevance')
        self.assertEqual(manual['quota']['remaining'], 1)
        self.call_search.assert_not_called()

    def test_multiple_blocks_support_analysis_and_private_cache_reopening(self):
        self.call_chat.return_value = {
            'content': '{"answer":"Explanation"}\n{"analysis":"Cross-article comparison"}',
        }
        articles = [self.article, {**self.article, 'title': 'Second development'}]
        first = analysis.generate('viewer', articles)
        self.assertEqual(first['analysis'], 'Cross-article comparison')
        self.assertTrue(analysis.generate('viewer', articles)['cached'])
        self.call_chat.assert_called_once()
        self.assertEqual(service.quota('viewer')['remaining'], 2)

    def test_empty_or_failed_impact_logs_metadata_only_and_remains_retryable(self):
        self.response({'unexpected': 'sensitive-generated-value', 'replacement': {'invalid': 'sensitive-inner-value'}})
        with self.assertLogs(impact.__name__, level='WARNING') as logged, self.assertRaises(HTTPException) as raised:
            impact.generate('viewer', self.article)
        self.assertEqual(raised.exception.status_code, 502)
        diagnostics = '\n'.join(logged.output)
        self.assertIn('unexpected', diagnostics)
        self.assertIn('ValueError', diagnostics)
        self.assertNotIn('sensitive-generated-value', diagnostics)
        self.assertNotIn('sensitive-inner-value', diagnostics)
        self.assertNotIn('impacts', self.store.read().get('viewer', {}))
        self.assertEqual(service.quota('viewer')['remaining'], 2)

        self.call_chat.side_effect = RuntimeError('secret-token https://internal.example/endpoint')
        with self.assertLogs(impact.__name__, level='WARNING') as logged, self.assertRaises(HTTPException):
            impact.generate('viewer', self.article)
        diagnostics = '\n'.join(logged.output)
        self.assertIn('RuntimeError', diagnostics)
        self.assertNotIn('secret-token', diagnostics)
        self.assertNotIn('internal.example', diagnostics)
        self.call_chat.side_effect = None
        self.response({'impact': 'Retry succeeds'})
        self.assertEqual(impact.generate('viewer', self.article)['impact'], 'Retry succeeds')
        self.assertTrue(impact.generate('viewer', self.article)['cached'])


if __name__ == '__main__':
    unittest.main()
