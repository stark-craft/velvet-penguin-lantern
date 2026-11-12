"""Shared public-network URL validation for server-side outbound requests."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


def canonical_public_http_url(value: object, *, allowed_ports: set[int] = {80, 443}) -> str:
    try:
        parsed = urlsplit(str(value or "").strip())
    except ValueError as error:
        raise ValueError("Use a valid public HTTP or HTTPS URL.") from error
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise ValueError("Use a valid public HTTP or HTTPS URL.")
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("Use a valid public HTTP or HTTPS URL.") from error
    if port and port not in allowed_ports:
        raise ValueError("That network port is not allowed.")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith((".local", ".internal")):
        raise ValueError("Private or local network URLs are not allowed.")
    netloc = hostname
    if ":" in hostname and not hostname.startswith("["):
        netloc = f"[{hostname}]"
    if port:
        netloc = f"{netloc}:{port}"
    return urlunsplit(
        (parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, "")
    )


def assert_public_http_url(value: object, *, allowed_ports: set[int] = {80, 443}) -> str:
    canonical = canonical_public_http_url(value, allowed_ports=allowed_ports)
    parsed = urlsplit(canonical)
    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as error:
        raise ValueError("The hostname could not be resolved.") from error
    if not addresses:
        raise ValueError("The hostname could not be resolved.")
    for address in addresses:
        try:
            parsed_ip = ipaddress.ip_address(address)
        except ValueError as error:
            raise ValueError("The hostname resolved to an invalid address.") from error
        if not parsed_ip.is_global:
            raise ValueError("Private or local network URLs are not allowed.")
    return canonical
