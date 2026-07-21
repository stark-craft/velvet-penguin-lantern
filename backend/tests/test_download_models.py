from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import download_models


class ModelVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def spec(weight: bytes) -> dict:
        return {
            "repo_id": "example/model",
            "revision": "a" * 40,
            "directory": "example-model",
            "allow_patterns": ("config.json", "model.safetensors"),
            "weight_file": "model.safetensors",
            "weight_sha256": hashlib.sha256(weight).hexdigest(),
        }

    def test_verify_only_accepts_complete_hash_matched_model(self) -> None:
        weight = b"safe deterministic weight fixture"
        folder = self.root / "example-model"
        folder.mkdir()
        (folder / "config.json").write_text('{"model_type":"fixture"}', encoding="utf-8")
        (folder / "model.safetensors").write_bytes(weight)
        with patch.dict(
            download_models.MODEL_SPECS,
            {"embedding": self.spec(weight)},
            clear=True,
        ):
            result = download_models.verify_models(
                target_root=self.root, only="embedding"
            )
        self.assertTrue(result["verified"])
        self.assertFalse(result["network_requests_made"])

    def test_verify_only_reports_missing_files_and_nonzero_main_exit(self) -> None:
        spec = self.spec(b"missing")
        output = StringIO()
        with patch.dict(
            download_models.MODEL_SPECS, {"embedding": spec}, clear=True
        ), redirect_stdout(output):
            exit_code = download_models.main(
                ["--verify-only", "--only", "embedding", "--target-root", str(self.root)]
            )
        payload = json.loads(output.getvalue())
        self.assertEqual(exit_code, 3)
        self.assertFalse(payload["verified"])
        self.assertIn("missing model directory", payload["models"]["embedding"]["errors"][0])

    def test_verify_only_detects_html_saved_as_model_file(self) -> None:
        weight = b"<!doctype html><html><body>proxy error</body></html>"
        folder = self.root / "example-model"
        folder.mkdir()
        (folder / "config.json").write_text("<html>blocked</html>", encoding="utf-8")
        (folder / "model.safetensors").write_bytes(weight)
        with patch.dict(
            download_models.MODEL_SPECS,
            {"embedding": self.spec(weight)},
            clear=True,
        ):
            result = download_models.verify_models(
                target_root=self.root, only="embedding"
            )
        errors = result["models"]["embedding"]["errors"]
        self.assertFalse(result["verified"])
        self.assertTrue(any("HTML error page" in error for error in errors))

    def test_invalid_ca_bundle_is_rejected_before_network_use(self) -> None:
        invalid = self.root / "invalid.pem"
        invalid.write_text("not a certificate", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "does not contain a PEM certificate"):
            download_models.resolve_trust_source(invalid, use_system_ca=False)

    def test_tls_error_classification_is_actionable(self) -> None:
        error = ssl_error = download_models.ssl.SSLCertVerificationError(
            1, "certificate verify failed: unable to get local issuer certificate"
        )
        self.assertIs(error, ssl_error)
        self.assertEqual(
            download_models.diagnose_download_error(error),
            "untrusted_certificate_authority",
        )


if __name__ == "__main__":
    unittest.main()
