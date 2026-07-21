"""newsScrapper application entry point and operational command-line interface.

Run ``python main.py --help`` from the backend directory for the available
commands.  The module-level ``app`` is intentionally kept for
``uvicorn main:app`` deployments.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence
from uuid import NAMESPACE_URL, uuid5

from signalroom.app import create_app
from signalroom.config import Settings
from signalroom.json_storage import JSONRepository
from signalroom.ml.embeddings import EmbeddingService
from signalroom.ml.summarizer import SummarizationService
from signalroom.ml.training import TrainingDataError, train_gatekeeper
from signalroom.models import (
    ArticleActionType,
    PageParams,
    ProfileId,
    TelemetryEventCreate,
    TelemetryEventType,
)
from signalroom.profiles import LoadedProfile, ProfileRegistry
from signalroom.services.pipeline import PipelineService
from signalroom.services.scheduler import MorningScheduler, SchedulerAlreadyRunning


# ASGI export used by ``uvicorn main:app``.  Model weights remain lazy: creating
# the FastAPI app does not import torch, load Hugging Face models, or start the
# scheduler.
app = create_app()


def _json_output(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False, default=str))


def _parse_date(value: Optional[str]) -> Optional[date]:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("dates must use YYYY-MM-DD") from exc


def _settings() -> Settings:
    settings = Settings.from_env()
    settings.prepare_runtime_directories()
    return settings


def _runtime(settings: Settings) -> tuple[ProfileRegistry, JSONRepository, PipelineService]:
    profiles = ProfileRegistry.from_settings(settings)
    repository = JSONRepository(settings.storage_path)
    pipeline = PipelineService(settings, profiles, repository)
    return profiles, repository, pipeline


def _active_profiles(
    registry: ProfileRegistry, requested: str
) -> Sequence[LoadedProfile]:
    if requested == "all":
        return registry.scheduled()
    return (registry.get(ProfileId(requested)),)


def _load_feedback(path: Path) -> List[Mapping[str, Any]]:
    """Read either a JSON array/object or newline-delimited JSON records."""

    candidate = path.expanduser().resolve()
    try:
        raw = candidate.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read feedback file {candidate}: {exc}") from exc
    if not raw.strip():
        raise ValueError(f"feedback file is empty: {candidate}")

    records: Any
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        records = []
        for line_number, line in enumerate(raw.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"invalid JSON on line {line_number} of {candidate}: {exc.msg}"
                ) from exc
    else:
        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict) and isinstance(payload.get("feedback"), list):
            records = payload["feedback"]
        elif isinstance(payload, dict):
            records = [payload]
        else:
            raise ValueError("feedback JSON must be an object or array of objects")

    if not records or not all(isinstance(record, dict) for record in records):
        raise ValueError("feedback input must contain at least one JSON object")
    return records


_KEEP_ACTIONS = frozenset(
    {
        ArticleActionType.SELECT,
        ArticleActionType.SAVE,
        ArticleActionType.APPROVE,
        ArticleActionType.INTERESTING,
        ArticleActionType.RESTORE,
    }
)
_DROP_ACTIONS = frozenset(
    {ArticleActionType.NOT_INTERESTED, ArticleActionType.HIDE}
)


def _feedback_from_repository(
    repository: JSONRepository, profile: ProfileId
) -> List[Mapping[str, Any]]:
    """Convert the latest useful action per actor/article into training rows."""

    records: List[Mapping[str, Any]] = []
    seen = set()
    cursor: Optional[str] = None
    while True:
        page = repository.list_actions(
            profile=profile,
            page=PageParams(limit=100, cursor=cursor),
        )
        for action in page.items:
            if action.action not in _KEEP_ACTIONS | _DROP_ACTIONS:
                continue
            key = (action.actor_id, action.article_id)
            if key in seen:
                continue
            seen.add(key)
            article = repository.get_article(action.article_id, profile=profile)
            records.append(
                {
                    "profile": profile.value,
                    "action": (
                        "not_interested"
                        if action.action in _DROP_ACTIONS
                        else "interesting"
                    ),
                    "article": article.model_dump(mode="json"),
                }
            )
        if not page.page.has_more or not page.page.next_cursor:
            break
        cursor = page.page.next_cursor
    return records


def _command_api(arguments: argparse.Namespace) -> int:
    import uvicorn

    settings = _settings()
    uvicorn.run(
        "main:app" if arguments.reload else app,
        host=arguments.host if arguments.host is not None else settings.host,
        port=arguments.port if arguments.port is not None else settings.port,
        reload=arguments.reload,
        log_level=arguments.log_level,
    )
    return 0


def _command_scheduler(arguments: argparse.Namespace) -> int:
    settings = _settings()
    if not settings.scheduler_enabled and not arguments.force:
        print(
            "Scheduler is disabled by SIGNALROOM_SCHEDULER_ENABLED. "
            "Use --force to start it explicitly.",
            file=sys.stderr,
        )
        return 2
    profiles, repository, pipeline = _runtime(settings)
    scheduler = MorningScheduler(
        settings,
        profiles.scheduled,
        pipeline.run_profile,
        repository=repository,
    )
    print(
        "Starting newsScrapper scheduler every "
        f"{settings.schedule_interval_hours} hours ({settings.timezone_name}); "
        "profiles run sequentially and startup recovery is enabled."
    )
    try:
        scheduler.start(blocking=True)
    except KeyboardInterrupt:
        return 0
    except SchedulerAlreadyRunning as exc:
        print(str(exc), file=sys.stderr)
        return 2
    finally:
        scheduler.shutdown(wait=False)
    return 0


def _command_run(arguments: argparse.Namespace) -> int:
    settings = _settings()
    profiles, _repository, pipeline = _runtime(settings)
    results: List[Dict[str, Any]] = []
    for profile in _active_profiles(profiles, arguments.profile):
        result = pipeline.run_profile(
            profile_id=profile.id,
            trigger=arguments.trigger,
            requested_by=arguments.requested_by,
            from_date=arguments.from_date,
            to_date=arguments.to_date,
            keywords=arguments.keyword or None,
            source_ids=arguments.source or None,
        )
        results.append(result)
    _json_output(results[0] if len(results) == 1 else results)
    return 0


def _command_preflight(arguments: argparse.Namespace) -> int:
    """Validate source selection and generate requests without network access."""

    from signalroom.crawlers.spiders.news_spider import NewsSpider

    settings = _settings()
    registry = ProfileRegistry.from_settings(settings)
    results = []
    failed = False
    for loaded in _active_profiles(registry, arguments.profile):
        spider = NewsSpider(
            profile=loaded.id.value,
            run_id=f"preflight_{loaded.id.value}",
            keyword="",
            match_all="true",
            sites_file=str(loaded.sources_path),
            target_sites=",".join(arguments.source or ()) or "All",
            timezone_name=settings.timezone_name,
            discovery_only="true",
        )
        requests = list(spider._iter_initial_requests())
        diagnostics = dict(spider.source_diagnostics)
        diagnostics["generated_request_urls"] = [request.url for request in requests[:10]]
        diagnostics["generated_request_urls_truncated"] = len(requests) > 10
        results.append(diagnostics)
        failed = failed or bool(diagnostics["unmatched_source_overrides"])
        failed = failed or (
            int(diagnostics["selected_enabled"]) > 0 and not requests
        )
    _json_output(results[0] if len(results) == 1 else results)
    return 2 if failed else 0


def _command_seed_demo_analytics(_arguments: argparse.Namespace) -> int:
    """Create repeatable local-only people/activity examples for UI validation."""

    settings = _settings()
    repository = JSONRepository(settings.storage_path)
    people = (
        ("demo:anaya-rao", "Anaya Rao", "anaya@example.test"),
        ("demo:kabir-mehta", "Kabir Mehta", "kabir@example.test"),
        ("demo:meera-iyer", "Meera Iyer", "meera@example.test"),
        ("demo:arjun-kapoor", "Arjun Kapoor", "arjun@example.test"),
        ("demo:zoya-khan", "Zoya Khan", "zoya@example.test"),
        ("demo:dev-malhotra", "Dev Malhotra", "dev@example.test"),
    )
    paths = ("/briefing", "/discover", "/search", "/workflow", "/saved")
    now = datetime.now(timezone.utc)
    created_people = 0
    created_events = 0
    for person_index, (actor, name, email) in enumerate(people):
        if repository.get_viewer_preference(actor) is None:
            repository.upsert_viewer_preference(
                actor,
                display_name=name,
                contact_email=email,
                pet_enabled=person_index % 2 == 0,
                pet_kind=("orbit", "pixel", "cloud")[person_index % 3],
                pet_color=("violet", "coral", "mint", "gold")[person_index % 4],
            )
            created_people += 1
        if repository.list_activity(actor_id=actor, page=PageParams(limit=1)).items:
            continue
        session = uuid5(NAMESPACE_URL, f"newsScrapper-demo-session:{actor}")
        for event_index in range(8 + person_index):
            event_type = (
                TelemetryEventType.ARTICLE_ACTION
                if event_index == 5
                else TelemetryEventType.SEARCH
                if event_index == 3
                else TelemetryEventType.HEARTBEAT
                if event_index % 4 == 0
                else TelemetryEventType.PAGE_VIEW
            )
            properties: Dict[str, Any] = {}
            if event_type == TelemetryEventType.ARTICLE_ACTION:
                properties["action"] = ("select", "save", "mark_under_review")[
                    person_index % 3
                ]
            elif event_type == TelemetryEventType.SEARCH:
                properties["query"] = ("AI", "broadcast", "display")[person_index % 3]
            repository.record_activity(
                TelemetryEventCreate(
                    event_type=event_type,
                    session_id=session,
                    profile=ProfileId.DEFAULT,
                    actor_id=actor,
                    path=paths[event_index % len(paths)],
                    properties=properties,
                    occurred_at=now
                    - timedelta(days=person_index % 3, minutes=(event_index + 1) * 7),
                )
            )
            created_events += 1
    _json_output(
        {
            "people_available": len(people),
            "people_created": created_people,
            "events_created": created_events,
            "storage": str(settings.storage_path),
            "note": "Safe to run again; existing demo people are not duplicated.",
        }
    )
    return 0


def _command_train(arguments: argparse.Namespace) -> int:
    settings = _settings()
    profiles = ProfileRegistry.from_settings(settings)
    profile_id = ProfileId(arguments.profile)
    profile = profiles.get(profile_id)
    repository = JSONRepository(settings.storage_path)
    feedback = (
        _load_feedback(arguments.input)
        if arguments.input is not None
        else _feedback_from_repository(repository, profile_id)
    )
    local_files_only = False if arguments.allow_download else settings.hf_local_only
    embedder = EmbeddingService(
        settings.embedding_model,
        model_identity=settings.embedding_model_id,
        local_files_only=local_files_only,
    )
    result = train_gatekeeper(
        feedback,
        profile=profile.id.value,
        artifact_root=settings.model_dir,
        embedder=embedder,
        min_samples=arguments.min_samples,
        prefer_sklearn=not arguments.force_centroid,
        version=arguments.version,
        review_threshold=profile.gatekeeper_review_threshold,
        hard_drop_threshold=profile.gatekeeper_drop_threshold,
        prefetch_drop_threshold=profile.prefetch_drop_threshold,
    )
    _json_output(result)
    return 0


def _command_warm_models(arguments: argparse.Namespace) -> int:
    settings = _settings()
    local_files_only = False if arguments.allow_download else settings.hf_local_only
    status: Dict[str, Any] = {}
    if arguments.only in {"all", "embedding"}:
        embedder = EmbeddingService(
            settings.embedding_model,
            model_identity=settings.embedding_model_id,
            local_files_only=local_files_only,
        )
        embedder.encode_one("newsScrapper model cache readiness check")
        status["embedding"] = embedder.status()
    if arguments.only in {"all", "summarization"}:
        summarizer = SummarizationService(
            settings.summarization_model,
            model_identity=settings.summarization_model_id,
            local_files_only=local_files_only,
        )
        # status() performs the lazy load; inference is deliberately skipped so
        # this command checks cache readiness without an expensive generation.
        status["summarization"] = summarizer.status()
    degraded = any(bool(item.get("degraded")) for item in status.values())
    _json_output(
        {
            "ready": not degraded,
            "local_files_only": local_files_only,
            "models": status,
        }
    )
    return 2 if arguments.strict and degraded else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="newsScrapper",
        description="Operate the newsScrapper news-intelligence backend.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    api_parser = commands.add_parser("api", help="run the FastAPI HTTP service")
    api_parser.add_argument("--host", help="bind host; defaults to SIGNALROOM_HOST")
    api_parser.add_argument("--port", type=int, help="bind port; defaults to SIGNALROOM_PORT")
    api_parser.add_argument("--reload", action="store_true", help="restart on source changes")
    api_parser.add_argument("--log-level", default="info")
    api_parser.set_defaults(handler=_command_api)

    scheduler_parser = commands.add_parser(
        "scheduler", help="run the interval scheduler as a dedicated process"
    )
    scheduler_parser.add_argument(
        "--force",
        action="store_true",
        help="start even when SIGNALROOM_SCHEDULER_ENABLED is false",
    )
    scheduler_parser.set_defaults(handler=_command_scheduler)

    run_parser = commands.add_parser("run", help="run one crawl/ML pipeline now")
    run_parser.add_argument(
        "--profile",
        choices=("default", "broadcast", "all"),
        default="all",
        help="profile to run; all follows configured schedule order",
    )
    run_parser.add_argument("--from-date", type=_parse_date, metavar="YYYY-MM-DD")
    run_parser.add_argument("--to-date", type=_parse_date, metavar="YYYY-MM-DD")
    run_parser.add_argument("--keyword", action="append", help="override keyword; repeatable")
    run_parser.add_argument("--source", action="append", help="limit to site ID; repeatable")
    run_parser.add_argument("--requested-by", default="local-cli")
    run_parser.add_argument(
        "--trigger",
        choices=("manual", "scheduler"),
        default="manual",
        help="label this run as a manual test or scheduled cycle",
    )
    run_parser.set_defaults(handler=_command_run)

    preflight_parser = commands.add_parser(
        "preflight", help="validate source entrypoints without crawling the network"
    )
    preflight_parser.add_argument(
        "--profile",
        choices=("default", "broadcast", "all"),
        default="all",
    )
    preflight_parser.add_argument(
        "--source", action="append", help="limit to a source ID; repeatable"
    )
    preflight_parser.set_defaults(handler=_command_preflight)

    demo_parser = commands.add_parser(
        "seed-demo-analytics",
        help="add six repeatable fake users and activity rows for local UI testing",
    )
    demo_parser.set_defaults(handler=_command_seed_demo_analytics)

    train_parser = commands.add_parser(
        "train", help="train and atomically promote a profile gatekeeper"
    )
    train_parser.add_argument("--profile", choices=("default", "broadcast"), required=True)
    train_parser.add_argument(
        "--input",
        type=Path,
        help="JSON/JSONL feedback; omit to use stored article actions",
    )
    train_parser.add_argument("--min-samples", type=int, default=4)
    train_parser.add_argument("--version")
    train_parser.add_argument(
        "--force-centroid",
        action="store_true",
        help="use the dependency-light centroid classifier instead of sklearn",
    )
    train_parser.add_argument(
        "--allow-download",
        action="store_true",
        help="allow Hugging Face access instead of local-cache-only loading",
    )
    train_parser.set_defaults(handler=_command_train)

    warm_parser = commands.add_parser(
        "warm-models", help="load/check the configured Hugging Face model cache"
    )
    warm_parser.add_argument(
        "--only",
        choices=("all", "embedding", "summarization"),
        default="all",
    )
    warm_parser.add_argument(
        "--allow-download",
        action="store_true",
        help="allow Hugging Face to download missing model files",
    )
    warm_parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero if either model uses its deterministic fallback",
    )
    warm_parser.set_defaults(handler=_command_warm_models)
    return parser


def main(argv: Optional[Iterable[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    parser = build_parser()
    arguments = parser.parse_args(list(argv) if argv is not None else None)
    try:
        return int(arguments.handler(arguments))
    except (TrainingDataError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
