from dataclasses import asdict, is_dataclass
from typing import Any, Dict, Optional

from .config import CLASSIFICATION_THRESHOLD, FIELD_THRESHOLD
from .prompts import (
    classification_prompt,
    extraction_prompt,
    FIELDS,
    CATEGORIES,
)
from .schemas import (
    ClassificationResult,
    ExtractionResult,
    FieldResult,
)


class SemanticEngine:
    """Rule-first semantic fallback layer."""

    def __init__(
        self,
        provider=None,
        classification_threshold=CLASSIFICATION_THRESHOLD,
        field_threshold=FIELD_THRESHOLD,
    ):
        self.provider = provider
        self.classification_threshold = classification_threshold
        self.field_threshold = field_threshold

    @staticmethod
    def _plain(obj):
        if is_dataclass(obj):
            return asdict(obj)

        if hasattr(obj, "__dict__"):
            return dict(obj.__dict__)

        return obj

    def classify(
        self,
        email: Dict[str, Any],
        rule_result: Any = None,
    ) -> ClassificationResult:
        rr = self._plain(rule_result) or {}

        category = rr.get("category")
        confidence = float(
            rr.get("confidence", 0) or 0
        )

        uncertain = bool(
            rr.get(
                "uncertain",
                confidence < self.classification_threshold,
            )
        )

        if (
            not self.provider
            or (
                category in CATEGORIES
                and confidence >= self.classification_threshold
                and not uncertain
            )
        ):
            return ClassificationResult(
                category or "GENERAL",
                confidence,
                "rules",
                "Rule result accepted",
            )

        data = self.provider.classify(
            classification_prompt(
                email,
                rr,
            )
        )

        value = str(
            data.get(
                "category",
                "GENERAL",
            )
        ).upper()

        if value not in CATEGORIES:
            value = category or "GENERAL"

        conf = max(
            0.0,
            min(
                1.0,
                float(
                    data.get(
                        "confidence",
                        0,
                    )
                    or 0
                ),
            ),
        )

        return ClassificationResult(
            value,
            conf,
            "llm",
            str(
                data.get(
                    "reason",
                    "",
                )
            ),
            data,
        )

    @staticmethod
    def _normalise_llm_fields(data, missing):
        """
        Accept both:
            {"fields": {...}}
        and a flat fallback:
            {"shipper": {...}, "consignee": {...}}
        """

        if not isinstance(data, dict):
            return {}

        nested = data.get("fields")

        if isinstance(nested, dict):
            fields = dict(nested)
        else:
            fields = {
                key: value
                for key, value in data.items()
                if key in missing
            }

        if (
            "gross_weight" in missing
            and "gross_weight" not in fields
            and "gross_weight_kg" in data
        ):
            fields["gross_weight"] = data[
                "gross_weight_kg"
            ]

        return fields

    @staticmethod
    def _field_result_from_llm(
        name,
        item,
    ):
        if isinstance(item, dict):
            value = item.get("value")

            try:
                confidence = float(
                    item.get(
                        "confidence",
                        0,
                    )
                    or 0
                )
            except (TypeError, ValueError):
                confidence = 0.0

            confidence = max(
                0.0,
                min(
                    1.0,
                    confidence,
                ),
            )

            unit = item.get("unit")

            reason = str(
                item.get(
                    "reason",
                    "",
                )
            )

            return FieldResult(
                value=value,
                confidence=confidence,
                unit=unit,
                reason=reason,
            )

        if item not in (None, ""):
            return FieldResult(
                value=item,
                confidence=0.80,
                unit=None,
                reason="Semantic provider returned a direct value",
            )

        return FieldResult(
            value=None,
            confidence=0.0,
            unit=None,
            reason="Field not returned by semantic provider",
        )

    def extract(
        self,
        document_text: str,
        existing_fields: Optional[Dict[str, Any]] = None,
        fields=None,
    ) -> ExtractionResult:
        existing_fields = existing_fields or {}
        wanted = fields or FIELDS

        missing = []
        output = {}

        for name in wanted:
            raw = existing_fields.get(name)

            if isinstance(raw, dict):
                value = raw.get("value")

                try:
                    conf = float(
                        raw.get(
                            "confidence",
                            (
                                1.0
                                if value not in (None, "")
                                else 0.0
                            ),
                        )
                    )
                except (TypeError, ValueError):
                    conf = 0.0

            else:
                value = raw
                conf = (
                    1.0
                    if value not in (None, "")
                    else 0.0
                )

            if (
                value not in (None, "")
                and conf >= self.field_threshold
            ):
                output[name] = FieldResult(
                    value=value,
                    confidence=conf,
                    unit=(
                        raw.get("unit")
                        if isinstance(raw, dict)
                        else None
                    ),
                    reason="Existing extractor",
                )
            else:
                missing.append(name)

        raw_semantic = None

        if self.provider and missing:
            raw_semantic = self.provider.extract(
                extraction_prompt(
                    document_text,
                    missing,
                )
            )

            llm_fields = (
                self._normalise_llm_fields(
                    raw_semantic,
                    missing,
                )
            )

            for name in missing:
                item = llm_fields.get(name)

                output[name] = (
                    self._field_result_from_llm(
                        name,
                        item,
                    )
                )

            source = "hybrid"

        else:
            for name in missing:
                output[name] = FieldResult(
                    None,
                    0.0,
                    None,
                    "Missing / below confidence threshold",
                )

            source = "rules"

        return ExtractionResult(
            fields=output,
            source=source,
            raw=(
                raw_semantic
                if isinstance(
                    raw_semantic,
                    dict,
                )
                else None
            ),
        )

    def review_required(
        self,
        classification=None,
        extraction=None,
    ) -> bool:
        if (
            classification
            and classification.confidence
            < self.classification_threshold
        ):
            return True

        if extraction:
            return any(
                field.value is None
                or field.confidence < self.field_threshold
                for field
                in extraction.fields.values()
            )

        return False
