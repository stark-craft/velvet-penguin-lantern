"""Load or download the configured Hugging Face models into the local cache.

Use from the backend directory:
``python -m scripts.warm_models --allow-download --strict``.
"""

from __future__ import annotations

import sys

from main import main


if __name__ == "__main__":
    raise SystemExit(main(["warm-models", *sys.argv[1:]]))
