"""Reusable semantic fallback layer for document verification systems."""
from .engine import SemanticEngine
from .schemas import ClassificationResult, ExtractionResult, FieldResult
from .providers import SemanticProvider, MockProvider, OpenAICompatibleProvider

__all__ = [
    "SemanticEngine",
    "ClassificationResult",
    "ExtractionResult",
    "FieldResult",
    "SemanticProvider",
    "MockProvider",
    "OpenAICompatibleProvider",
]
