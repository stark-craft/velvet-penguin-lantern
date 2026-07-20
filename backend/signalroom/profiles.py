"""Strict loaders for the Default and Broadcast profile/source JSON files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, Literal, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)
from typing_extensions import Annotated

from .config import Settings
from .models import ProfileId


Slug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=100,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]


class ProfileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    schema_version: Literal[1]
    id: ProfileId
    label: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    enabled: StrictBool
    sources_file: Annotated[str, StringConstraints(min_length=5, max_length=200)]
    cluster_similarity_threshold: float = Field(ge=0.0, le=1.0)
    gatekeeper_review_threshold: float = Field(ge=0.0, le=1.0)
    gatekeeper_drop_threshold: float = Field(ge=0.0, le=1.0)
    prefetch_drop_threshold: float = Field(ge=0.0, le=1.0)
    schedule_order: int = Field(ge=1, le=100)
    keywords: Tuple[Annotated[str, StringConstraints(min_length=1, max_length=200)], ...]

    @field_validator("sources_file")
    @classmethod
    def validate_sources_file(cls, value: str) -> str:
        path = Path(value)
        if path.name != value or path.suffix.casefold() != ".json":
            raise ValueError("sources_file must be a JSON basename without path components")
        return value

    @field_validator("keywords")
    @classmethod
    def validate_keywords(cls, values: Tuple[str, ...]) -> Tuple[str, ...]:
        if not values:
            raise ValueError("a profile requires at least one keyword")
        unique = []
        seen = set()
        for value in values:
            keyword = value.strip()
            marker = keyword.casefold()
            if marker in seen:
                raise ValueError(f"duplicate profile keyword: {keyword!r}")
            seen.add(marker)
            unique.append(keyword)
        return tuple(unique)

    @model_validator(mode="after")
    def validate_threshold_order(self) -> "ProfileConfig":
        if not self.gatekeeper_review_threshold < self.gatekeeper_drop_threshold:
            raise ValueError("gatekeeper review threshold must be below the drop threshold")
        if self.gatekeeper_drop_threshold > self.prefetch_drop_threshold:
            raise ValueError("gatekeeper drop threshold must not exceed prefetch drop threshold")
        return self


class SiteConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    id: Slug
    name: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    enabled: StrictBool
    rss_url: Optional[AnyHttpUrl] = None
    homepage: Optional[AnyHttpUrl] = None
    url: Optional[AnyHttpUrl] = None
    category: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "General"
    region: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "Global"
    timezone: str = "UTC"
    allowed_domains: Tuple[
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True,
                min_length=3,
                max_length=253,
                pattern=r"^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,63}$",
            ),
        ],
        ...,
    ] = ()
    max_links: int = Field(default=100, ge=1, le=500)
    allow_deep_scan: StrictBool = True
    manual_deep_scan_candidate: StrictBool = False

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown site timezone: {value}") from exc
        return value

    @model_validator(mode="after")
    def require_discovery_url(self) -> "SiteConfig":
        if self.rss_url is None and self.homepage is None and self.url is None:
            raise ValueError("a site requires rss_url, homepage, url, or a combination")
        if (
            self.enabled
            and self.rss_url is None
            and self.url is None
            and not self.allow_deep_scan
        ):
            raise ValueError(
                "an enabled source without rss_url or url must allow deep scanning"
            )
        return self

    @property
    def allowed_hosts(self) -> Tuple[str, ...]:
        hosts = []
        for url in (self.rss_url, self.homepage, self.url):
            if url is not None and url.host and url.host.casefold() not in hosts:
                hosts.append(url.host.casefold())
        for host in self.allowed_domains:
            normalized = host.casefold()
            if normalized not in hosts:
                hosts.append(normalized)
        return tuple(hosts)


class SitesFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1]
    sites: Tuple[SiteConfig, ...]

    @field_validator("sites")
    @classmethod
    def unique_site_ids(cls, sites: Tuple[SiteConfig, ...]) -> Tuple[SiteConfig, ...]:
        identifiers = [site.id for site in sites]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("site IDs must be unique within one sources file")
        return sites


class LoadedProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, arbitrary_types_allowed=True)

    config: ProfileConfig
    sites: Tuple[SiteConfig, ...]
    profile_path: Path
    sources_path: Path

    @property
    def id(self) -> ProfileId:
        return self.config.id

    @property
    def label(self) -> str:
        return self.config.label

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    @property
    def sources_file(self) -> str:
        return self.config.sources_file

    @property
    def keywords(self) -> Tuple[str, ...]:
        return self.config.keywords

    @property
    def schedule_order(self) -> int:
        return self.config.schedule_order

    @property
    def cluster_similarity_threshold(self) -> float:
        return self.config.cluster_similarity_threshold

    @property
    def gatekeeper_review_threshold(self) -> float:
        return self.config.gatekeeper_review_threshold

    @property
    def gatekeeper_drop_threshold(self) -> float:
        return self.config.gatekeeper_drop_threshold

    @property
    def prefetch_drop_threshold(self) -> float:
        return self.config.prefetch_drop_threshold

    @property
    def enabled_sites(self) -> Tuple[SiteConfig, ...]:
        return tuple(site for site in self.sites if site.enabled)


class ProfileConfigurationError(ValueError):
    pass


def _load_json(path: Path) -> object:
    try:
        with path.open("r", encoding="utf-8") as file_obj:
            return json.load(file_obj)
    except FileNotFoundError as exc:
        raise ProfileConfigurationError(f"configuration file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProfileConfigurationError(
            f"invalid JSON in {path}: line {exc.lineno}, column {exc.colno}"
        ) from exc
    except OSError as exc:
        raise ProfileConfigurationError(f"cannot read configuration file {path}: {exc}") from exc


def _ensure_child(root: Path, candidate: Path, label: str) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ProfileConfigurationError(f"{label} escapes configured root {root}") from exc
    return candidate


def load_profile(profile_id: ProfileId, settings: Settings) -> LoadedProfile:
    if not isinstance(profile_id, ProfileId):
        profile_id = ProfileId(profile_id)
    profile_path = _ensure_child(
        settings.profile_dir,
        settings.profile_dir / f"{profile_id.value}.json",
        "profile file",
    )
    try:
        profile = ProfileConfig.model_validate(_load_json(profile_path))
    except Exception as exc:
        if isinstance(exc, ProfileConfigurationError):
            raise
        raise ProfileConfigurationError(
            f"invalid profile configuration {profile_path}: {exc}"
        ) from exc
    if profile.id != profile_id:
        raise ProfileConfigurationError(
            f"profile filename {profile_id.value}.json contains id={profile.id.value!r}"
        )

    sources_path = _ensure_child(
        settings.sites_dir,
        settings.sites_dir / profile.sources_file,
        "sources file",
    )
    try:
        sources = SitesFile.model_validate(_load_json(sources_path))
    except Exception as exc:
        if isinstance(exc, ProfileConfigurationError):
            raise
        raise ProfileConfigurationError(
            f"invalid sources configuration {sources_path}: {exc}"
        ) from exc

    return LoadedProfile(
        config=profile,
        sites=sources.sites,
        profile_path=profile_path,
        sources_path=sources_path,
    )


def load_profiles(settings: Settings) -> Dict[ProfileId, LoadedProfile]:
    profiles = {
        profile_id: load_profile(profile_id, settings)
        for profile_id in (ProfileId.DEFAULT, ProfileId.BROADCAST)
    }
    order = [profile.config.schedule_order for profile in profiles.values()]
    if len(order) != len(set(order)):
        raise ProfileConfigurationError("profile schedule_order values must be unique")
    return profiles


class ProfileRegistry:
    def __init__(self, profiles: Dict[ProfileId, LoadedProfile]):
        expected = {ProfileId.DEFAULT, ProfileId.BROADCAST}
        if set(profiles) != expected:
            raise ProfileConfigurationError(
                "registry requires exactly default and broadcast profiles"
            )
        self._profiles = dict(profiles)

    @classmethod
    def from_settings(cls, settings: Settings) -> "ProfileRegistry":
        return cls(load_profiles(settings))

    def get(self, profile_id: ProfileId) -> LoadedProfile:
        try:
            return self._profiles[ProfileId(profile_id)]
        except (KeyError, ValueError) as exc:
            raise KeyError(f"unknown profile: {profile_id}") from exc

    def all(self) -> Tuple[LoadedProfile, ...]:
        return tuple(self._profiles.values())

    def enabled(self) -> Tuple[LoadedProfile, ...]:
        return tuple(profile for profile in self.all() if profile.config.enabled)

    def scheduled(self) -> Tuple[LoadedProfile, ...]:
        return tuple(sorted(self.enabled(), key=lambda item: item.config.schedule_order))

    def __iter__(self) -> Iterable[LoadedProfile]:
        return iter(self.all())
