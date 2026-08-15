import unittest
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from news_scrapper import translation


class KoreanTranslationTests(unittest.TestCase):
    def test_incomplete_local_model_folder_is_not_reported_as_installed(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "config.json").write_text("{}", encoding="utf-8")
            with patch.object(translation, "MODEL_PATH", model_path):
                self.assertFalse(translation._local_model_available())

                for filename in ("source.spm", "target.spm", "model.safetensors"):
                    (model_path / filename).write_bytes(b"model")
                self.assertTrue(translation._local_model_available())

    def test_long_text_is_split_without_losing_content(self):
        source = "First sentence. Second sentence. Third sentence."
        chunks = translation._split_text(source, target_chars=24)

        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks), source)

    def test_endpoint_preserves_request_order(self):
        payload = translation.TranslationRequest(
            texts=["Good morning", "Artificial intelligence briefing"],
        )
        with patch.object(
            translation.translator,
            "translate_many_with_stats",
            return_value=(
                ["좋은 아침입니다", "인공지능 브리핑"],
                {
                    "input_items": 2,
                    "unique_items": 2,
                    "cache_hits": 0,
                    "translated_items": 2,
                    "duration_ms": 12,
                },
            ),
        ):
            response = translation.translate_to_korean(payload)

        self.assertEqual(
            [item.translated for item in response.translations],
            ["좋은 아침입니다", "인공지능 브리핑"],
        )
        self.assertEqual(response.engine, "local-marian")
        self.assertEqual(response.translated_items, 2)

    def test_duplicate_inputs_are_inferred_once_and_then_served_from_cache(self):
        subject = translation.KoreanTranslator()
        calls = []

        def fake_inference(chunks):
            calls.extend(chunks)
            return [f"KO:{chunk}" for chunk in chunks]

        subject._translate_chunks_unlocked = fake_inference
        values = ["Repeated headline"] * 8 + ["Another headline"] * 2
        first, first_stats = subject.translate_many_with_stats(values)
        second, second_stats = subject.translate_many_with_stats(values)

        self.assertEqual(len(calls), 2)
        self.assertEqual(len(set(first)), 2)
        self.assertEqual(first, second)
        self.assertEqual(first_stats["input_items"], 10)
        self.assertEqual(first_stats["unique_items"], 2)
        self.assertEqual(first_stats["translated_items"], 2)
        self.assertEqual(second_stats["translated_items"], 0)
        self.assertEqual(second_stats["cache_hits"], 2)

    def test_simultaneous_requests_share_one_inference_pass(self):
        subject = translation.KoreanTranslator()
        inference_calls = []
        start = threading.Barrier(3)
        results = []

        def fake_inference(chunks):
            inference_calls.append(list(chunks))
            time.sleep(0.03)
            return [f"KO:{chunk}" for chunk in chunks]

        subject._translate_chunks_unlocked = fake_inference

        def worker():
            start.wait()
            results.append(subject.translate_many(["Shared live headline"]))

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        start.wait()
        for thread in threads:
            thread.join(timeout=2)

        self.assertEqual(inference_calls, [["Shared live headline"]])
        self.assertEqual(results, [["KO:Shared live headline"], ["KO:Shared live headline"]])

    def test_endpoint_rejects_unsupported_language_direction(self):
        payload = translation.TranslationRequest(
            texts=["안녕하세요"],
            source_language="ko",
            target_language="en",
        )

        with self.assertRaises(HTTPException) as raised:
            translation.translate_to_korean(payload)

        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
