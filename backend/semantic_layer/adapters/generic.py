from dataclasses import asdict, is_dataclass
from typing import Any, Dict, Optional

from .base import SemanticAdapter


class GenericAdapter(SemanticAdapter):
    """
    Configurable adapter for different host-system versions.

    It normalises:
      - email objects/dicts
      - classification result shapes
      - document field aliases

    The Semantic Core therefore only needs one canonical schema.
    """

    DEFAULT_CATEGORY_MAP = {
        "bl_comparison": "BL_COMPARISON",
        "document_comparison": "BL_COMPARISON",
        "compare_bl": "BL_COMPARISON",
        "si_request": "SI_REQUEST",
        "new_si_request": "SI_REQUEST",
        "invoice_query": "INVOICE_QUERY",
        "invoice": "INVOICE_QUERY",
        "general": "GENERAL",
        "spam": "SPAM",
    }

    DEFAULT_FIELD_MAP = {
        # Canonical names
        "shipper": "shipper",
        "consignee": "consignee",
        "notify_party": "notify_party",
        "port_of_loading": "port_of_loading",
        "port_of_discharge": "port_of_discharge",
        "container_count": "container_count",
        "gross_weight": "gross_weight",

        # Common aliases
        "exporter": "shipper",
        "consignor": "shipper",
        "sender": "shipper",

        "receiver": "consignee",
        "consigned_to": "consignee",

        "notify": "notify_party",
        "party_to_notify": "notify_party",

        "pol": "port_of_loading",
        "loading_port": "port_of_loading",
        "origin_port": "port_of_loading",

        "pod": "port_of_discharge",
        "discharge_port": "port_of_discharge",
        "destination_port": "port_of_discharge",
        "final_discharge_location": "port_of_discharge",

        "containers": "container_count",
        "container_quantity": "container_count",
        "number_of_containers": "container_count",

        "gross_weight_kg": "gross_weight",
        "weight": "gross_weight",
        "gross_mass": "gross_weight",
    }

    def __init__(
        self,
        category_map: Optional[Dict[str, str]] = None,
        field_map: Optional[Dict[str, str]] = None,
        reverse_field_map: Optional[Dict[str, str]] = None,
        uncertainty_threshold: float = 0.60,
    ):
        merged_category_map = dict(
            self.DEFAULT_CATEGORY_MAP
        )
        if category_map:
            merged_category_map.update(
                category_map
            )

        merged_field_map = dict(
            self.DEFAULT_FIELD_MAP
        )
        if field_map:
            merged_field_map.update(
                field_map
            )

        self.category_map = {
            str(key).strip().lower(): value
            for key, value in merged_category_map.items()
        }

        self.field_map = {
            str(key).strip().lower(): value
            for key, value in merged_field_map.items()
        }

        self.reverse_field_map = dict(
            reverse_field_map or {}
        )

        self.uncertainty_threshold = float(
            uncertainty_threshold
        )

    @staticmethod
    def _plain(obj: Any) -> Dict[str, Any]:
        if obj is None:
            return {}

        if isinstance(obj, dict):
            return dict(obj)

        if is_dataclass(obj):
            return asdict(obj)

        if hasattr(obj, "__dict__"):
            return dict(vars(obj))

        return {"value": obj}

    @staticmethod
    def _safe_confidence(value: Any) -> float:
        try:
            confidence = float(value)
        except (TypeError, ValueError):
            return 0.0

        return max(
            0.0,
            min(1.0, confidence),
        )

    def email_to_standard(
        self,
        email: Any,
    ) -> Dict[str, Any]:
        data = self._plain(email)

        return {
            "email_id": (
                data.get("email_id")
                or data.get("id")
                or data.get("message_id")
            ),
            "subject": (
                data.get("subject")
                or data.get("title")
                or ""
            ),
            "body": (
                data.get("body")
                or data.get("content")
                or data.get("text")
                or ""
            ),
            "attachments": (
                data.get("attachments")
                or data.get("files")
                or []
            ),
        }

    def classification_to_standard(
        self,
        result: Any,
    ) -> Dict[str, Any]:
        data = self._plain(result)

        raw_category = (
            data.get("category")
            or data.get("label")
            or data.get("class")
            or data.get("value")
            or "GENERAL"
        )

        category_key = str(
            raw_category
        ).strip().lower()

        category = self.category_map.get(
            category_key,
            str(raw_category).strip().upper(),
        )

        confidence = self._safe_confidence(
            data.get(
                "confidence",
                data.get("score", 0.0),
            )
        )

        uncertain = data.get(
            "uncertain"
        )

        if uncertain is None:
            uncertain = (
                confidence
                < self.uncertainty_threshold
            )

        return {
            "category": category,
            "confidence": confidence,
            "uncertain": bool(uncertain),
            "source": (
                data.get("source")
                or "rules"
            ),
        }

    def fields_to_standard(
        self,
        fields: Any,
    ) -> Dict[str, Any]:
        data = self._plain(fields)
        output: Dict[str, Any] = {}

        for key, value in data.items():
            source_key = str(key).strip()
            standard_key = self.field_map.get(
                source_key.lower(),
                source_key,
            )

            # Prefer an already-populated canonical field over an alias.
            if (
                standard_key not in output
                or output.get(standard_key)
                in (None, "")
            ):
                output[standard_key] = value

        return output

    def fields_from_standard(
        self,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        output = {}

        for key, value in (
            fields or {}
        ).items():
            host_key = self.reverse_field_map.get(
                key,
                key,
            )
            output[host_key] = value

        return output
