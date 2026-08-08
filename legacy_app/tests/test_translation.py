import unittest
import tempfile
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
            "translate_many",
            return_value=["좋은 아침입니다", "인공지능 브리핑"],
        ):
            response = translation.translate_to_korean(payload)

        self.assertEqual(
            [item.translated for item in response.translations],
            ["좋은 아침입니다", "인공지능 브리핑"],
        )
        self.assertEqual(response.engine, "local-marian")

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
