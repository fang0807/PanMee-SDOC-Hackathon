"""Compatibility shim for older SmartDoc semantic-layer imports.

The canonical SemanticAdapter lives in semantic_layer.adapters.base.
Keep this module so older/merged code using
``from semantic_layer.base import SemanticAdapter`` continues to work.
"""
from .adapters.base import SemanticAdapter

__all__ = ["SemanticAdapter"]
