"""Pure IP normalization and profile resolution helpers."""

from __future__ import annotations

import ipaddress
from collections.abc import Mapping, Set


def normalize_ip(value: str) -> str:
    candidate = str(value or "").strip().strip("[]")
    if not candidate:
        return "unknown"
    try:
        parsed = ipaddress.ip_address(candidate)
        if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
            return str(parsed.ipv4_mapped)
        return str(parsed)
    except ValueError:
        return candidate


def client_ip(
    peer_ip: str,
    headers: Mapping[str, str],
    trusted_proxies: Set[str],
) -> str:
    peer = normalize_ip(peer_ip)
    if peer not in trusted_proxies:
        return peer
    forwarded = headers.get("x-forwarded-for", "")
    if forwarded:
        return normalize_ip(forwarded.split(",", 1)[0])
    real_ip = headers.get("x-real-ip", "")
    return normalize_ip(real_ip) if real_ip else peer


def resolve_profile(
    resolved_ip: str,
    broadcast_ips: Set[str],
    requested_profile: str = "",
    switch_allowed_ips: Set[str] = frozenset(),
) -> str:
    requested = str(requested_profile or "").strip().lower()
    if requested in {"default", "broadcast"} and resolved_ip in switch_allowed_ips:
        return requested
    return "broadcast" if resolved_ip in broadcast_ips else "default"
