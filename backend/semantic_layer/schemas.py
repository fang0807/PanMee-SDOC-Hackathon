from dataclasses import dataclass, field
from typing import Any, Dict, Optional

@dataclass
class ClassificationResult:
    value: str
    confidence: float
    source: str = "rules"
    reason: str = ""
    raw: Optional[Dict[str, Any]] = None

@dataclass
class FieldResult:
    value: Any = None
    confidence: float = 0.0
    unit: Optional[str] = None
    reason: str = ""

@dataclass
class ExtractionResult:
    fields: Dict[str, FieldResult] = field(default_factory=dict)
    source: str = "rules"
    raw: Optional[Dict[str, Any]] = None

    def as_dict(self):
        return {
            "fields": {
                name: {
                    "value": item.value,
                    "confidence": item.confidence,
                    "unit": item.unit,
                    "reason": item.reason,
                }
                for name, item in self.fields.items()
            },
            "source": self.source,
        }
