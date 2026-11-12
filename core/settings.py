"""Central filesystem and environment configuration.

The root ``.env`` remains the single deployment configuration source. Product
packages import paths from here so moving code never changes where models,
frontend assets, or mutable runtime data live.
"""

from __future__ import annotations

import os
import shutil
import datetime as dt
import json
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from core.storage import JsonStore


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


def resolve_frontend_dist(
    project_root: Path = PROJECT_ROOT,
    configured_path: str | os.PathLike | None = None,
) -> Path:
    """Resolve both source-tree and portable Windows frontend layouts.

    A configured path remains authoritative.  Without one, development uses
    ``news-ui/dist`` while a copied portable deployment can use
    ``frontend/dist`` beside ``main.py``.  The same compiled bundle therefore
    works in both environments without editing frontend source or rebuilding
    it with a machine-specific API URL.
    """

    configured = (
        configured_path
        if configured_path is not None
        else os.environ.get("NEWSSCRAPPER_FRONTEND_DIST")
    )
    if configured:
        return Path(configured).expanduser()
    root = Path(project_root)
    candidates = (root / "news-ui" / "dist", root / "frontend" / "dist")
    return next(
        (candidate for candidate in candidates if (candidate / "index.html").is_file()),
        candidates[0],
    )


FRONTEND_DIST = resolve_frontend_dist()


def ensure_runtime_directories() -> None:
    """Create product-owned mutable directories without touching user data."""

    for path in (
        NEWS_RUNTIME_DIR,
        NEWS_RUNTIME_DIR / "history_archive",
        NEWS_RUNTIME_DIR / "intelligence_store" / "default" / "history",
        NEWS_RUNTIME_DIR / "intelligence_store" / "broadcast" / "history",
        NEWS_RUNTIME_DIR / "intelligence_store" / "unified" / "history",
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
        "viewer_identity_claims.json",
        "viewer_saved_store.json",
        "viewer_personalization.json",
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


def _state_identity(value: Any) -> str:
    if not isinstance(value, dict):
        return str(value)
    link = str(
        value.get("canonical_link") or value.get("link") or value.get("url") or ""
    ).strip().casefold()
    if link:
        return f"link:{link}"
    title = str(value.get("title") or "").strip().casefold()
    summary = str(value.get("summary") or value.get("master_summary") or "").strip().casefold()
    label = str(value.get("label") or "").strip().casefold()
    return f"content:{title}|{summary}|{label}"


def _merged_rows(primary: Any, rollback: Any) -> list[dict[str, Any]]:
    """Merge JSON-list state without mutating the retained rollback file."""

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in [*(primary if isinstance(primary, list) else []), *(rollback if isinstance(rollback, list) else [])]:
        if not isinstance(row, dict):
            continue
        key = _state_identity(row)
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def migrate_unified_news_state(runtime_dir: Path = NEWS_RUNTIME_DIR) -> dict[str, Any]:
    """Idempotently consolidate old profile state into one serving system.

    The broadcast files remain untouched as rollback inputs.  The authoritative
    serving/training paths are the former default filenames, which keeps a
    portable deployment compatible while guaranteeing that the model loaded by
    the API is also the model replaced by the trainer.
    """

    root = Path(runtime_dir)
    root.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schema_version": 1,
        "training_changed": False,
        "not_interested_changed": False,
        "workflow_changed": False,
        "history_seeded": False,
        "authoritative_training": str(root / "trainingData.json"),
        "authoritative_model": str(root / "bouncer_model.pkl"),
        "rollback_model": str(root / "bouncer_model_broadcast.pkl"),
    }

    for primary_name, rollback_name, report_key in (
        ("trainingData.json", "trainingData_broadcast.json", "training_changed"),
        ("not_interested_store.json", "not_interested_store_broadcast.json", "not_interested_changed"),
    ):
        primary_store = JsonStore(root / primary_name, list)
        rollback_store = JsonStore(root / rollback_name, list)
        primary = primary_store.read()
        merged = _merged_rows(primary, rollback_store.read())
        if merged != (primary if isinstance(primary, list) else []):
            primary_store.write(merged)
            report[report_key] = True
        report[f"{primary_name}_records"] = len(merged)

    authoritative_training = root / "trainingData.json"
    authoritative_model = root / "bouncer_model.pkl"
    report["model_needs_retrain"] = bool(
        authoritative_training.exists()
        and (
            not authoritative_model.exists()
            or authoritative_training.stat().st_mtime > authoritative_model.stat().st_mtime
        )
    )

    primary_workflow = JsonStore(
        root / "workflow_store.json", lambda: {"selected": [], "approved": []}
    )
    rollback_workflow = JsonStore(
        root / "workflow_store_broadcast.json", lambda: {"selected": [], "approved": []}
    ).read()
    workflow = primary_workflow.read()
    workflow = workflow if isinstance(workflow, dict) else {"selected": [], "approved": []}
    merged_workflow = dict(workflow)
    for lane in ("selected", "approved"):
        merged_workflow[lane] = _merged_rows(
            workflow.get(lane),
            rollback_workflow.get(lane) if isinstance(rollback_workflow, dict) else [],
        )
    if merged_workflow != workflow:
        primary_workflow.write(merged_workflow)
        report["workflow_changed"] = True

    unified_history = root / "intelligence_store" / "unified" / "history"
    unified_history.mkdir(parents=True, exist_ok=True)
    had_unified_history = any(unified_history.glob("briefing_*.json"))
    latest: list[tuple[str, Path]] = []

    def annotated_rows(path: Path, legacy_profile: str) -> list[dict[str, Any]]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = []
        rows: list[dict[str, Any]] = []
        for original in payload if isinstance(payload, list) else []:
            if not isinstance(original, dict):
                continue
            row = dict(original)
            row["legacy_profile"] = row.get("legacy_profile") or legacy_profile
            row["vertical"] = row.get("vertical") or (
                "broadcast" if legacy_profile == "broadcast" else "technology"
            )
            row["verticals"] = row.get("verticals") or [row["vertical"]]
            row["audiences"] = row.get("audiences") or ["all"]
            row["profile"] = "unified"
            rows.append(row)
        return rows

    migrated_history_files = 0
    for legacy_profile in ("default", "broadcast"):
        candidates = list(
            (root / "intelligence_store" / legacy_profile / "history").glob(
                "briefing_*.json"
            )
        )
        if candidates:
            latest.append((legacy_profile, max(candidates, key=lambda path: path.stat().st_mtime)))
        for source in candidates:
            destination = unified_history / source.name
            existing = JsonStore(destination, list).read() if destination.exists() else []
            merged = _merged_rows(existing, annotated_rows(source, legacy_profile))
            if merged != (existing if isinstance(existing, list) else []):
                JsonStore(destination, list).write(merged)
                os.utime(destination, (source.stat().st_mtime, source.stat().st_mtime))
                migrated_history_files += 1
    report["history_files_migrated"] = migrated_history_files

    # On the first cutover, publish one combined latest snapshot so the first
    # unified feed is never accidentally only the final legacy partition.
    if not had_unified_history:
        rows: list[dict[str, Any]] = []
        for legacy_profile, path in latest:
            rows = _merged_rows(rows, annotated_rows(path, legacy_profile))
        if rows:
            timestamp = dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            JsonStore(unified_history / f"briefing_{timestamp}.json", list).write(rows)
            report["history_seeded"] = True
            report["history_records"] = len(rows)

    JsonStore(root / "unified_migration_report.json", dict).write(report)
    return report


def model_path(modern_name: str, legacy_name: str | None = None) -> Path:
    """Resolve the new model layout while retaining legacy Windows installs."""

    modern = MODEL_ROOT / modern_name
    if modern.exists() or not legacy_name:
        return modern
    legacy = PROJECT_ROOT / legacy_name
    return legacy if legacy.exists() else modern
