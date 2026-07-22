import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class RetentionTests(unittest.TestCase):
    def test_only_expired_history_is_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            old_file = Path(directory) / "briefing_old.json"
            fresh_file = Path(directory) / "briefing_fresh.json"
            old_file.write_text("[]")
            fresh_file.write_text("[]")
            old_timestamp = time.time() - (31 * 86400)
            os.utime(old_file, (old_timestamp, old_timestamp))
            with patch.object(main, "get_profile_history_files", return_value=[str(old_file), str(fresh_file)]):
                removed = main.purge_expired_history("default", keep_days=30)
            self.assertEqual(removed, 1)
            self.assertFalse(old_file.exists())
            self.assertTrue(fresh_file.exists())


if __name__ == "__main__":
    unittest.main()
