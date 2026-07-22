import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import secure_http


class SecureHttpTests(unittest.TestCase):
    def test_false_verify_flag_cannot_disable_tls(self):
        with patch.dict(os.environ, {"SAMSUNG_WEB_SEARCH_VERIFY_SSL": "false"}, clear=False):
            with patch.dict(os.environ, {"REQUESTS_CA_BUNDLE": "", "SSL_CERT_FILE": ""}, clear=False):
                self.assertIs(secure_http.tls_verify("SAMSUNG_WEB_SEARCH"), True)

    def test_custom_ca_bundle_is_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            ca = Path(directory) / "company.pem"
            ca.write_text("test certificate placeholder")
            with patch.dict(os.environ, {"REQUESTS_CA_BUNDLE": str(ca)}, clear=False):
                self.assertEqual(secure_http.tls_verify("SAMSUNG_WEB_SEARCH"), str(ca))


if __name__ == "__main__":
    unittest.main()
