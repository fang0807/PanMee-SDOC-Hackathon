"""Reusable semantic fallback layer for document verification systems."""

from .engine import SemanticEngine
from .schemas import (
    ClassificationResult,
    ExtractionResult,
    FieldResult,
)
from .providers import (
    SemanticProvider,
    MockProvider,
    OpenAICompatibleProvider,
)
from .review_queue import (
    ReviewQueue,
    ReviewItem,
)
from .trace import DecisionTrace
from .metrics import SemanticMetrics
from .adapters import (
    SemanticAdapter,
    GenericAdapter,
)


__all__ = [
    "SemanticEngine",
    "ClassificationResult",
    "ExtractionResult",
    "FieldResult",
    "SemanticProvider",
    "MockProvider",
    "OpenAICompatibleProvider",
    "ReviewQueue",
    "ReviewItem",
    "DecisionTrace",
    "SemanticMetrics",
    "SemanticAdapter",
    "GenericAdapter",
]