"""Request identity, trusted proxy, and capability helpers.

Only a verified identity supplied by application middleware is trusted by
default.  Identity and forwarding headers are honored only when explicitly
enabled *and* received from a configured trusted proxy.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
from dataclasses import dataclass
from typing import AbstractSet, Mapping, Optional, Protocol, Tuple

from .config import Settings
from .models import Capability


class ClientLike(Protocol):
    host: Optional[str]


class RequestLike(Protocol):
    headers: Mapping[str, str]
    client: Optional[ClientLike]


@dataclass(frozen=True)
class Principal:
    identity: Optional[str]
    ip_hash: str
    capabilities: Tuple[Capability, ...]
    authentication_method: str

    def can(self, capability: Capability) -> bool:
        return capability in self.capabilities


BASE_CAPABILITIES = frozenset(
    {Capability.READ, Capability.PERSONALIZE, Capability.SUBMIT_FEEDBACK}
)
DEVELOPER_CAPABILITIES = frozenset(
    {
        *BASE_CAPABILITIES,
        Capability.BROADCAST,
        Capability.PROFILE_SWITCH,
        Capability.GATEKEEPER_REVIEW,
        Capability.ANALYTICS,
        Capability.MANAGE_SOURCES,
        Capability.MANAGE_JOBS,
    }
)
ADMIN_CAPABILITIES = frozenset(Capability)


ANONYMOUS_CLIENT_IP = "0.0.0.0"


def _parse_ip(value: Optional[str]) -> Optional[ipaddress._BaseAddress]:
    if not isinstance(value, str):
        return None
    candidate = value.strip().strip('"')
    if not candidate or candidate.casefold() == "unknown" or candidate.startswith("_"):
        return None
    if candidate.casefold().startswith("for="):
        candidate = candidate[4:].strip().strip('"')
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    try:
        return ipaddress.ip_address(candidate.split("%", 1)[0])
    except ValueError:
        if candidate.count(":") == 1:
            host, port = candidate.rsplit(":", 1)
            if port.isdigit():
                try:
                    return ipaddress.ip_address(host)
                except ValueError:
                    return None
        return None


def _in_allowlist(address: ipaddress._BaseAddress, allowlist: Tuple[str, ...]) -> bool:
    return any(address in ipaddress.ip_network(item, strict=False) for item in allowlist)


def _forwarded_chain(headers: Mapping[str, str]) -> Tuple[ipaddress._BaseAddress, ...]:
    forwarded = headers.get("forwarded") or headers.get("Forwarded")
    parsed = []
    if forwarded:
        for element in forwarded.split(","):
            match = re.search(r"(?:^|;)\s*for=([^;]+)", element, flags=re.IGNORECASE)
            if match:
                address = _parse_ip(match.group(1))
                if address is not None:
                    parsed.append(address)
        if parsed:
            return tuple(parsed)

    forwarded_for = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if forwarded_for:
        for value in forwarded_for.split(","):
            address = _parse_ip(value)
            if address is not None:
                parsed.append(address)
        if parsed:
            return tuple(parsed)

    real_ip = headers.get("x-real-ip") or headers.get("X-Real-IP")
    address = _parse_ip(real_ip) if real_ip else None
    return (address,) if address is not None else ()


def resolve_client_ip(
    peer_ip: Optional[str],
    headers: Mapping[str, str],
    settings: Settings,
) -> str:
    """Resolve a client IP without allowing untrusted forwarding spoofing."""

    peer = _parse_ip(peer_ip)
    if peer is None:
        # Local Vinext adapters can omit the socket peer for their server-side
        # fetch. Development accepts their explicit bridge marker so identity
        # remains testable; production never takes this peerless shortcut.
        proxy_marker = headers.get("x-signalroom-proxy") or headers.get(
            "X-Signalroom-Proxy"
        )
        if (
            settings.environment == "development"
            and settings.trust_proxy_headers
            and proxy_marker == "frontend-bff-v1"
        ):
            chain = _forwarded_chain(headers)
            if chain:
                return chain[0].compressed
        # Some ASGI/browser adapters omit the peer host.  Keep those requests
        # usable as an anonymous viewer without ever promoting them to the
        # loopback/developer allowlist.
        return ANONYMOUS_CLIENT_IP
    if not settings.trust_proxy_headers or not _in_allowlist(
        peer, settings.trusted_proxy_ips
    ):
        return peer.compressed

    chain = _forwarded_chain(headers)
    if not chain:
        return peer.compressed

    # Work from the trusted connection backwards.  The first hop not present in
    # the trusted-proxy allowlist is the effective client.
    for address in reversed(chain):
        if not _in_allowlist(address, settings.trusted_proxy_ips):
            return address.compressed
    return chain[0].compressed


def get_client_ip(request: RequestLike, settings: Settings) -> str:
    if request.client is None:
        return ANONYMOUS_CLIENT_IP
    return resolve_client_ip(request.client.host, request.headers, settings)


def hash_client_ip(ip: str, settings: Settings) -> str:
    """Return a versioned HMAC pseudonym; raw IPs must never be persisted."""

    address = _parse_ip(ip)
    if address is None:
        raise ValueError("cannot hash an invalid IP address")
    digest = hmac.new(
        settings.ip_hash_secret.get_secret_value().encode("utf-8"),
        f"signalroom-ip-v1\x00{address.compressed}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"ip:v1:{digest}"


def extract_bearer_token(headers: Mapping[str, str]) -> Optional[str]:
    authorization = headers.get("authorization") or headers.get("Authorization")
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        return None
    return token.strip()


def _normalize_identity(identity: Optional[str]) -> Optional[str]:
    if identity is None:
        return None
    normalized = identity.strip().casefold()
    return normalized or None


def _header_identity(
    request: RequestLike,
    settings: Settings,
    peer_ip: Optional[str],
) -> Optional[str]:
    peer = _parse_ip(peer_ip)
    if (
        peer is None
        or not settings.trust_identity_headers
        or not _in_allowlist(peer, settings.trusted_proxy_ips)
    ):
        return None
    for name in (
        "x-signalroom-user-email",
        "x-auth-request-email",
        "cf-access-authenticated-user-email",
    ):
        value = request.headers.get(name) or request.headers.get(name.title())
        if value:
            return _normalize_identity(value)
    return None


def resolve_capabilities(
    settings: Settings,
    *,
    identity: Optional[str],
    client_ip: str,
    bearer_token: Optional[str] = None,
) -> Tuple[Tuple[Capability, ...], str]:
    """Resolve capabilities and the strongest authentication method used."""

    normalized_identity = _normalize_identity(identity)
    address = _parse_ip(client_ip)
    if address is None:
        raise ValueError("client_ip must be a valid IP address")

    expected_key = settings.admin_key.get_secret_value() if settings.admin_key else None
    if expected_key and bearer_token and hmac.compare_digest(bearer_token, expected_key):
        return tuple(sorted(ADMIN_CAPABILITIES, key=lambda item: item.value)), "admin_key"

    if normalized_identity in settings.admin_emails or _in_allowlist(
        address, settings.admin_ips
    ):
        return tuple(sorted(ADMIN_CAPABILITIES, key=lambda item: item.value)), "admin_allowlist"

    capabilities: AbstractSet[Capability] = BASE_CAPABILITIES
    method = "internal_viewer"
    if _in_allowlist(address, settings.developer_ips):
        capabilities = DEVELOPER_CAPABILITIES
        method = "developer_allowlist"
    if normalized_identity in settings.analytics_emails:
        capabilities = frozenset({*capabilities, Capability.ANALYTICS})
        method = "identity_allowlist"
    if _in_allowlist(address, settings.broadcast_ips):
        capabilities = frozenset({*capabilities, Capability.BROADCAST})
        if method == "internal_viewer":
            method = "broadcast_allowlist"
    return tuple(sorted(capabilities, key=lambda item: item.value)), method


def resolve_principal(
    request: RequestLike,
    settings: Settings,
    *,
    verified_identity: Optional[str] = None,
) -> Principal:
    client_ip = get_client_ip(request, settings)
    identity = _normalize_identity(verified_identity) or _header_identity(
        request,
        settings,
        request.client.host if request.client is not None else ANONYMOUS_CLIENT_IP,
    )
    capabilities, method = resolve_capabilities(
        settings,
        identity=identity,
        client_ip=client_ip,
        bearer_token=extract_bearer_token(request.headers),
    )
    return Principal(
        identity=identity,
        ip_hash=hash_client_ip(client_ip, settings),
        capabilities=capabilities,
        authentication_method=method,
    )


def require_capability(principal: Principal, capability: Capability) -> None:
    if not principal.can(capability):
        raise PermissionError(f"capability required: {capability.value}")
