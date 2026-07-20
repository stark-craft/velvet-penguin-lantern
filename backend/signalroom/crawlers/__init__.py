"""Scrapy-based discovery and article extraction for Signalroom."""

from .items import ARTICLE_SCHEMA_VERSION, ArticleRecord, DiscoveryRecord

__all__ = [
    "ARTICLE_SCHEMA_VERSION",
    "ArticleRecord",
    "DiscoveryRecord",
]
