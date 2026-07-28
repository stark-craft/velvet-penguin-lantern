"""Central filesystem and environment configuration.

The root ``.env`` remains the single deployment configuration source. Product
packages import paths from here so moving code never changes where models,
frontend assets, or mutable runtime data live.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env", override=False)

MODEL_ROOT = Path(
    os.environ.get("SENSE_MODEL_ROOT", PROJECT_ROOT / "model_weights")
).expanduser()

NEWS_SCRAPPER_ROOT = PROJECT_ROOT / "news_scrapper"
NEWS_CONFIG_DIR = NEWS_SCRAPPER_ROOT / "config"
NEWS_RUNTIME_DIR = Path(
    os.environ.get("NEWSSCRAPPER_RUNTIME_DIR", NEWS_SCRAPPER_ROOT / "runtime")
).expanduser()
NEWS_CRAWLER_DIR = NEWS_SCRAPPER_ROOT / "crawler"

VENTURE_LENS_ROOT = PROJECT_ROOT / "venture_lens"
VENTURE_LENS_RUNTIME_DIR = Path(
    os.environ.get("VENTURE_LENS_RUNTIME_DIR", VENTURE_LENS_ROOT / "runtime")
).expanduser()

FRONTEND_ROOT = PROJECT_ROOT / "news-ui"
FRONTEND_DIST = Path(
    os.environ.get("NEWSSCRAPPER_FRONTEND_DIST", FRONTEND_ROOT / "dist")
).expanduser()


def ensure_runtime_directories() -> None:
    """Create product-owned mutable directories without touching user data."""

    for path in (
        NEWS_RUNTIME_DIR,
        NEWS_RUNTIME_DIR / "history_archive",
        NEWS_RUNTIME_DIR / "intelligence_store" / "default" / "history",
        NEWS_RUNTIME_DIR / "intelligence_store" / "broadcast" / "history",
        VENTURE_LENS_RUNTIME_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def migrate_legacy_news_runtime() -> None:
    """Copy legacy root-level state into the product-owned runtime once.

    The legacy files remain untouched as a rollback copy. Existing destination
    files always win, so a restart can never overwrite newer live state.
    """

    ensure_runtime_directories()
    legacy_files = (
        "bouncer_model.pkl",
        "bouncer_model_broadcast.pkl",
        "dropped_articles.json",
        "gatekeeper_restore_queue.json",
        "not_interested_store.json",
        "not_interested_store_broadcast.json",
        "region_learning.json",
        "region_learning_broadcast.json",
        "seen_registry.json",
        "trainingData.json",
        "trainingData_broadcast.json",
        "training_dataset.csv",
        "usage_tracker.json",
        "viewer_hidden_store.json",
        "viewer_saved_store.json",
        "viewer_url_briefings.json",
        "viewer_profiles.json",
        "voc_feedback.json",
        "workflow_store.json",
        "workflow_store_broadcast.json",
    )
    for name in legacy_files:
        source = PROJECT_ROOT / name
        destination = NEWS_RUNTIME_DIR / name
        if source.is_file() and not destination.exists():
            shutil.copy2(source, destination)

    for name in ("history_archive", "intelligence_store"):
        source = PROJECT_ROOT / name
        destination = NEWS_RUNTIME_DIR / name
        if source.is_dir():
            shutil.copytree(source, destination, dirs_exist_ok=True)


def model_path(modern_name: str, legacy_name: str | None = None) -> Path:
    """Resolve the new model layout while retaining legacy Windows installs."""

    modern = MODEL_ROOT / modern_name
    if modern.exists() or not legacy_name:
        return modern
    legacy = PROJECT_ROOT / legacy_name
    return legacy if legacy.exists() else modern
