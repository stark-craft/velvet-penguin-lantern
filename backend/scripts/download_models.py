"""Download Signalroom's two Hugging Face repositories into explicit local folders.

Run from the repository root after installing ``requirements.txt``::

    python backend/scripts/download_models.py

Normal application startup never calls this script and never downloads weights.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


MODEL_SPECS = {
    "embedding": {
        "repo_id": "sentence-transformers/all-MiniLM-L6-v2",
        "revision": "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
        "directory": "all-MiniLM-L6-v2",
        "allow_patterns": (
            "1_Pooling/config.json",
            "config.json",
            "config_sentence_transformers.json",
            "model.safetensors",
            "modules.json",
            "sentence_bert_config.json",
            "special_tokens_map.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.txt",
        ),
        "weight_file": "model.safetensors",
        "weight_sha256": "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
    },
    "summarization": {
        "repo_id": "sshleifer/distilbart-cnn-12-6",
        # This verified revision adds a safetensors conversion. Selecting only
        # that file avoids loading the repository's pickle-backed .bin weights.
        "revision": "eb8b5a5eb7de268c0d7db6fa247188c909acf265",
        "directory": "distilbart-cnn-12-6",
        "allow_patterns": (
            "config.json",
            "merges.txt",
            "model.safetensors",
            "tokenizer_config.json",
            "vocab.json",
        ),
        "weight_file": "model.safetensors",
        "weight_sha256": "bb2e2ae9c5e339a6e86adac3c946bb853db50d7c588477ddd1622dd2d1fc567c",
    },
}


def _selected_models(only: str) -> Iterable[tuple[str, Dict[str, Any]]]:
    if only == "all":
        return MODEL_SPECS.items()
    return ((only, MODEL_SPECS[only]),)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_models(
    *,
    target_root: Path,
    only: str = "all",
    force_download: bool = False,
) -> Dict[str, object]:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "huggingface-hub is unavailable; install the root requirements.txt first"
        ) from exc

    root = target_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    downloaded: Dict[str, object] = {}
    for purpose, spec in _selected_models(only):
        destination = root / spec["directory"]
        destination.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=spec["repo_id"],
            repo_type="model",
            revision=spec["revision"],
            local_dir=destination,
            allow_patterns=list(spec["allow_patterns"]),
            force_download=force_download,
        )
        weight_path = destination / spec["weight_file"]
        if not weight_path.is_file():
            raise RuntimeError(f"download did not produce {weight_path}")
        actual_sha256 = _sha256(weight_path)
        if actual_sha256 != spec["weight_sha256"]:
            raise RuntimeError(
                f"checksum mismatch for {weight_path}: expected "
                f"{spec['weight_sha256']}, got {actual_sha256}"
            )
        downloaded[purpose] = {
            "repo_id": spec["repo_id"],
            "revision": spec["revision"],
            "path": str(destination),
            "weight_sha256": actual_sha256,
        }
    return {"download_complete": True, "selection": only, "models": downloaded}


def build_parser() -> argparse.ArgumentParser:
    backend_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Download MiniLM and DistilBART into backend/model_weights."
    )
    parser.add_argument(
        "--target-root",
        type=Path,
        default=backend_root / "model_weights",
        help="parent folder for the two model directories",
    )
    parser.add_argument(
        "--only",
        choices=("all", "embedding", "summarization"),
        default="all",
    )
    parser.add_argument("--force-download", action="store_true")
    return parser


def main(argv: Optional[Iterable[str]] = None) -> int:
    arguments = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        result = download_models(
            target_root=arguments.target_root,
            only=arguments.only,
            force_download=arguments.force_download,
        )
    except Exception as exc:
        print(json.dumps({"download_complete": False, "error": str(exc)}, indent=2))
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
