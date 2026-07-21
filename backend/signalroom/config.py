"""Application configuration loaded explicitly from environment variables."""

from __future__ import annotations

import ipaddress
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Mapping, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
FALSE_VALUES = frozenset({"0", "false", "no", "off"})
DEVELOPMENT_IP_HASH_SECRET = "development-only-change-this-ip-hash-secret"


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _csv(value: Optional[str]) -> Tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


def _boolean(name: str, value: Optional[str], default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    normalized = value.strip().casefold()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    raise ValueError(f"{name} must be one of true/false, 1/0, yes/no, or on/off")


def _optional_secret(value: Optional[str]) -> Optional[SecretStr]:
    if value is None or value.strip() == "":
        return None
    return SecretStr(value.strip())


def _model_reference(
    root_dir: Path,
    local_path: Optional[str],
    hub_model_id: str,
) -> str:
    """Prefer an explicit deployment-local model folder over a Hub model ID."""

    if local_path is None or not local_path.strip():
        return hub_model_id.strip()
    candidate = Path(local_path.strip()).expanduser()
    if not candidate.is_absolute():
        candidate = Path(root_dir).expanduser() / candidate
    return str(candidate.resolve())


class Settings(BaseModel):
    """Validated runtime settings.

    Relative paths are resolved against ``root_dir`` rather than the process
    working directory, which makes CLI, worker, and API launches consistent.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    cors_origins: Tuple[str, ...] = (
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:5173",
    )

    root_dir: Path = Field(default_factory=_backend_root)
    storage_path: Path = Path("runtime/data")
    # Retained only for explicitly injected legacy SQLite repositories.
    database_path: Path = Path("runtime/signalroom.db")
    profile_dir: Path = Path("profiles")
    sites_dir: Path = Path("sites")
    model_dir: Path = Path("models")
    crawl_output_dir: Path = Path("runtime/crawls")
    stream_crawler_logs: bool = True

    scheduler_enabled: bool = True
    schedule_interval_hours: int = Field(default=4, ge=1, le=168)
    scheduler_run_on_start: bool = True
    scheduler_startup_delay_seconds: int = Field(default=10, ge=0, le=3_600)
    scheduler_misfire_grace_seconds: int = Field(default=3_600, ge=1, le=86_400)
    scheduler_stale_job_hours: int = Field(default=8, ge=1, le=168)
    scheduler_reload_profiles: bool = True
    timezone_name: str = "Asia/Kolkata"

    hf_local_only: bool = True
    embedding_model_id: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    summarization_model_id: str = "sshleifer/distilbart-cnn-12-6"
    summarization_model: str = "sshleifer/distilbart-cnn-12-6"

    admin_key: Optional[SecretStr] = None
    approval_key: SecretStr = SecretStr("2741")
    gatekeeper_key: SecretStr = SecretStr("6384")
    admin_emails: Tuple[str, ...] = ()
    analytics_emails: Tuple[str, ...] = ()
    admin_ips: Tuple[str, ...] = ()
    broadcast_ips: Tuple[str, ...] = ()
    developer_ips: Tuple[str, ...] = ("127.0.0.1", "::1")
    trusted_proxy_ips: Tuple[str, ...] = ("127.0.0.1", "::1")
    trust_proxy_headers: bool = False
    trust_identity_headers: bool = False
    ip_hash_secret: SecretStr = SecretStr(DEVELOPMENT_IP_HASH_SECRET)

    # Applied to state-changing HTTP methods.  The pilot is intentionally a
    # single API process, so a small in-memory fixed-window limiter is enough
    # to contain accidental loops and basic request floods.
    max_request_bytes: int = Field(default=1_048_576, ge=1, le=16_777_216)
    mutation_rate_limit_per_minute: int = Field(default=120, ge=1, le=100_000)

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, value: str) -> str:
        normalized = value.casefold()
        aliases = {"dev": "development", "prod": "production"}
        normalized = aliases.get(normalized, normalized)
        if normalized not in {"development", "test", "production"}:
            raise ValueError("environment must be development, test, or production")
        return normalized

    @field_validator("approval_key", "gatekeeper_key")
    @classmethod
    def validate_editorial_key(cls, value: SecretStr) -> SecretStr:
        key = value.get_secret_value()
        if not re.fullmatch(r"\d{4}", key):
            raise ValueError("editorial keys must contain exactly four digits")
        return value

    @field_validator("timezone_name")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown timezone: {value}") from exc
        return value

    @field_validator("admin_emails", "analytics_emails")
    @classmethod
    def normalize_identities(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        normalized = []
        for value in values:
            email = value.strip().casefold()
            if not email or "@" not in email or any(character.isspace() for character in email):
                raise ValueError(f"invalid identity allowlist entry: {value!r}")
            if email not in normalized:
                normalized.append(email)
        return tuple(normalized)

    @field_validator(
        "admin_ips",
        "broadcast_ips",
        "developer_ips",
        "trusted_proxy_ips",
    )
    @classmethod
    def validate_ip_allowlist(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        normalized = []
        for value in values:
            try:
                network = ipaddress.ip_network(value.strip(), strict=False)
            except ValueError as exc:
                raise ValueError(f"invalid IP/CIDR allowlist entry: {value!r}") from exc
            text = str(network)
            if text not in normalized:
                normalized.append(text)
        return tuple(normalized)

    @model_validator(mode="after")
    def resolve_paths_and_validate_secrets(self) -> "Settings":
        root_dir = self.root_dir.expanduser().resolve()

        def rooted(path: Path) -> Path:
            expanded = path.expanduser()
            if expanded.is_absolute():
                return expanded.resolve()
            return (root_dir / expanded).resolve()

        object.__setattr__(self, "root_dir", root_dir)
        object.__setattr__(self, "storage_path", rooted(self.storage_path))
        object.__setattr__(self, "database_path", rooted(self.database_path))
        object.__setattr__(self, "profile_dir", rooted(self.profile_dir))
        object.__setattr__(self, "sites_dir", rooted(self.sites_dir))
        object.__setattr__(self, "model_dir", rooted(self.model_dir))
        object.__setattr__(self, "crawl_output_dir", rooted(self.crawl_output_dir))

        secret = self.ip_hash_secret.get_secret_value()
        if len(secret.encode("utf-8")) < 32:
            raise ValueError("ip_hash_secret must contain at least 32 bytes")
        if self.environment == "production":
            if secret == DEVELOPMENT_IP_HASH_SECRET or secret.startswith("replace-with"):
                raise ValueError("production requires a unique IP hashing secret")
            if "*" in self.cors_origins:
                raise ValueError("production CORS origins cannot contain '*'")
        return self

    @classmethod
    def from_env(
        cls,
        environ: Optional[Mapping[str, str]] = None,
        *,
        root_dir: Optional[Path] = None,
    ) -> "Settings":
        env = os.environ if environ is None else environ
        root = root_dir or Path(env.get("SIGNALROOM_ROOT", _backend_root()))
        embedding_model_id = env.get(
            "SIGNALROOM_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        summarization_model_id = env.get(
            "SIGNALROOM_SUMMARIZATION_MODEL", "sshleifer/distilbart-cnn-12-6"
        )
        environment = env.get("SIGNALROOM_ENV", "development")
        return cls(
            environment=environment,
            host=env.get("SIGNALROOM_HOST", "127.0.0.1"),
            port=int(env.get("SIGNALROOM_PORT", "8000")),
            cors_origins=_csv(env.get("SIGNALROOM_CORS_ORIGINS"))
            or (
                "http://127.0.0.1:3000",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://localhost:5173",
            ),
            root_dir=root,
            storage_path=Path(env.get("SIGNALROOM_STORAGE_PATH", "runtime/data")),
            database_path=Path(env.get("SIGNALROOM_DATABASE_PATH", "runtime/signalroom.db")),
            profile_dir=Path(env.get("SIGNALROOM_PROFILE_DIR", "profiles")),
            sites_dir=Path(env.get("SIGNALROOM_SITES_DIR", "sites")),
            model_dir=Path(env.get("SIGNALROOM_MODEL_DIR", "models")),
            crawl_output_dir=Path(
                env.get("SIGNALROOM_CRAWL_OUTPUT_DIR", "runtime/crawls")
            ),
            stream_crawler_logs=_boolean(
                "SIGNALROOM_STREAM_CRAWLER_LOGS",
                env.get("SIGNALROOM_STREAM_CRAWLER_LOGS"),
                True,
            ),
            scheduler_enabled=_boolean(
                "SIGNALROOM_SCHEDULER_ENABLED",
                env.get("SIGNALROOM_SCHEDULER_ENABLED"),
                True,
            ),
            schedule_interval_hours=int(
                env.get("SIGNALROOM_SCHEDULE_INTERVAL_HOURS", "4")
            ),
            scheduler_run_on_start=_boolean(
                "SIGNALROOM_SCHEDULER_RUN_ON_START",
                env.get("SIGNALROOM_SCHEDULER_RUN_ON_START"),
                True,
            ),
            scheduler_startup_delay_seconds=int(
                env.get("SIGNALROOM_SCHEDULER_STARTUP_DELAY_SECONDS", "10")
            ),
            scheduler_misfire_grace_seconds=int(
                env.get("SIGNALROOM_SCHEDULER_MISFIRE_GRACE_SECONDS", "3600")
            ),
            scheduler_stale_job_hours=int(
                env.get("SIGNALROOM_SCHEDULER_STALE_JOB_HOURS", "8")
            ),
            scheduler_reload_profiles=_boolean(
                "SIGNALROOM_SCHEDULER_RELOAD_PROFILES",
                env.get("SIGNALROOM_SCHEDULER_RELOAD_PROFILES"),
                True,
            ),
            timezone_name=env.get("SIGNALROOM_TIMEZONE", "Asia/Kolkata"),
            hf_local_only=_boolean(
                "SIGNALROOM_HF_LOCAL_ONLY", env.get("SIGNALROOM_HF_LOCAL_ONLY"), True
            ),
            embedding_model_id=embedding_model_id,
            embedding_model=_model_reference(
                root,
                env.get("SIGNALROOM_EMBEDDING_MODEL_PATH"),
                embedding_model_id,
            ),
            summarization_model_id=summarization_model_id,
            summarization_model=_model_reference(
                root,
                env.get("SIGNALROOM_SUMMARIZATION_MODEL_PATH"),
                summarization_model_id,
            ),
            admin_key=_optional_secret(env.get("SIGNALROOM_ADMIN_KEY")),
            approval_key=SecretStr(env.get("SIGNALROOM_APPROVAL_KEY", "2741")),
            gatekeeper_key=SecretStr(env.get("SIGNALROOM_GATEKEEPER_KEY", "6384")),
            admin_emails=_csv(env.get("SIGNALROOM_ADMIN_EMAILS")),
            analytics_emails=_csv(env.get("SIGNALROOM_ANALYTICS_EMAILS")),
            admin_ips=_csv(env.get("SIGNALROOM_ADMIN_IPS")),
            broadcast_ips=_csv(env.get("SIGNALROOM_BROADCAST_IPS")),
            developer_ips=(
                _csv(env.get("SIGNALROOM_DEVELOPER_IPS"))
                if "SIGNALROOM_DEVELOPER_IPS" in env
                else ("127.0.0.1", "::1")
            ),
            trusted_proxy_ips=(
                _csv(env.get("SIGNALROOM_TRUSTED_PROXY_IPS"))
                if "SIGNALROOM_TRUSTED_PROXY_IPS" in env
                else (
                    ("127.0.0.1", "::1", "0.0.0.0")
                    if environment.casefold() in {"development", "dev"}
                    else ("127.0.0.1", "::1")
                )
            ),
            trust_proxy_headers=_boolean(
                "SIGNALROOM_TRUST_PROXY_HEADERS",
                env.get("SIGNALROOM_TRUST_PROXY_HEADERS"),
                environment.casefold() in {"development", "dev"},
            ),
            trust_identity_headers=_boolean(
                "SIGNALROOM_TRUST_IDENTITY_HEADERS",
                env.get("SIGNALROOM_TRUST_IDENTITY_HEADERS"),
                False,
            ),
            ip_hash_secret=SecretStr(
                env.get("SIGNALROOM_IP_HASH_SECRET", DEVELOPMENT_IP_HASH_SECRET)
            ),
            max_request_bytes=int(
                env.get("SIGNALROOM_MAX_REQUEST_BYTES", "1048576")
            ),
            mutation_rate_limit_per_minute=int(
                env.get("SIGNALROOM_MUTATION_RATE_LIMIT_PER_MINUTE", "120")
            ),
        )

    def prepare_runtime_directories(self) -> None:
        """Create writable runtime roots; source/config roots remain read-only."""

        storage_directory = (
            self.storage_path.parent
            if self.storage_path.suffix.casefold() == ".json"
            else self.storage_path
        )
        storage_directory.mkdir(parents=True, exist_ok=True)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.crawl_output_dir.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
