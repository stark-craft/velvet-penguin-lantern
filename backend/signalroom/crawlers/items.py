"""JSON-exportable crawler record contracts.

The spider deliberately yields plain dictionaries.  These TypedDict definitions
document that wire contract without making Scrapy's feed exporter depend on a
custom Item serializer.
"""

from typing import Dict, List, Optional, TypedDict


ARTICLE_SCHEMA_VERSION = 1


class QualityMetadata(TypedDict, total=False):
    status: str
    extractor: str
    selector: str
    character_count: int
    word_count: int
    paragraph_count: int
    has_real_title: bool
    has_published_at: bool


class DiscoveryRecord(TypedDict, total=False):
    schema_version: int
    record_type: str
    run_id: str
    profile: str
    source_id: str
    source: str
    source_region: str
    source_timezone: str
    requested_url: str
    final_url: str
    canonical_url: str
    title: str
    title_source: str
    excerpt: str
    published_at: Optional[str]
    modified_at: Optional[str]
    raw_date: str
    date_source: str
    date_precision: str
    keyword_matches: List[str]
    keywords_found: List[str]
    discovery_method: str
    discovered_at: str
    quality: QualityMetadata


class ArticleRecord(DiscoveryRecord, total=False):
    lead_image_url: Optional[str]
    authors: List[str]
    author: str
    body_text: str
    content_hash: Optional[str]
    fetched_at: str
    http_status: int
    redirect_chain: List[str]
    extraction: QualityMetadata
    extraction_quality: str
    provenance: Dict[str, str]
