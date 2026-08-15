import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from news_scrapper import application as main


class PrivacyMigrationTests(unittest.TestCase):
    def test_raw_ip_is_removed_without_losing_activity(self):
        with tempfile.TemporaryDirectory() as directory:
            tracker_file = Path(directory) / "usage_tracker.json"
            tracker_file.write_text(json.dumps({
                "legacy-device": {
                    "ip": "192.0.2.10",
                    "fingerprint": "browser-one",
                    "display_name": "Navin",
                    "activity": {"2026-07-22": {"page_loads": 3}},
                }
            }))
            with patch.object(main, "USAGE_TRACKER_FILE", str(tracker_file)):
                self.assertTrue(main.migrate_tracker_privacy())
                data = json.loads(tracker_file.read_text())
            self.assertEqual(len(data), 1)
            record = next(iter(data.values()))
            self.assertNotIn("ip", record)
            self.assertEqual(len(record["ip_hash"]), 64)
            self.assertEqual(record["activity"]["2026-07-22"]["page_loads"], 3)


if __name__ == "__main__":
    unittest.main()
