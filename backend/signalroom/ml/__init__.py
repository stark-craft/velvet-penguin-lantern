"""Model-agnostic ML building blocks for the Signalroom pipeline."""

from .clustering import (
    DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    SemanticClusterer,
    article_identity,
    cluster_articles,
    cosine_similarity,
    stable_cluster_id,
)
from .embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingService,
    article_embedding_text,
    embed_articles,
)
from .gatekeeper import (
    DEFAULT_HARD_DROP_THRESHOLD,
    DEFAULT_PREFETCH_DROP_THRESHOLD,
    DEFAULT_REVIEW_THRESHOLD,
    ArtifactVerificationError,
    Gatekeeper,
    build_gatekeeper_text,
    gatekeeper_decision,
    load_verified_artifact,
)
from .summarizer import (
    DEFAULT_SUMMARIZATION_MODEL,
    DistilBartSummarizer,
    SummarizationService,
    article_summary_text,
    extractive_summary,
    summarize_article,
)
from .training import (
    CentroidClassifier,
    TrainingDataError,
    prepare_training_examples,
    train_gatekeeper,
)

__all__ = [
    "ArtifactVerificationError",
    "CentroidClassifier",
    "DEFAULT_CLUSTER_SIMILARITY_THRESHOLD",
    "DEFAULT_EMBEDDING_MODEL",
    "DEFAULT_HARD_DROP_THRESHOLD",
    "DEFAULT_PREFETCH_DROP_THRESHOLD",
    "DEFAULT_REVIEW_THRESHOLD",
    "DEFAULT_SUMMARIZATION_MODEL",
    "DistilBartSummarizer",
    "EmbeddingService",
    "Gatekeeper",
    "SemanticClusterer",
    "SummarizationService",
    "TrainingDataError",
    "article_embedding_text",
    "article_identity",
    "article_summary_text",
    "build_gatekeeper_text",
    "cluster_articles",
    "cosine_similarity",
    "embed_articles",
    "extractive_summary",
    "gatekeeper_decision",
    "load_verified_artifact",
    "prepare_training_examples",
    "stable_cluster_id",
    "summarize_article",
    "train_gatekeeper",
]
