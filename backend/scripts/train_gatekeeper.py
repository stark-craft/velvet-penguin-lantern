"""Run the gatekeeper training command.

Use from the backend directory:
``python -m scripts.train_gatekeeper --profile default``.
"""

from __future__ import annotations

import sys

from main import main


if __name__ == "__main__":
    raise SystemExit(main(["train", *sys.argv[1:]]))
