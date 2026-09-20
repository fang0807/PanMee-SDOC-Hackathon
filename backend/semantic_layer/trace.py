import json
from pathlib import Path
from typing import Any, Dict, Optional


class DecisionTrace:
    """
    Dependency-free decision trace / explainability recorder.

    This module records decisions only. It does not make or override
    classification, extraction, comparison, or review decisions.
    """

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.records: Dict[str, Dict[str, Any]] = {}

    def _record(self, email_id):
        key = str(email_id)

        if key not in self.records:
            self.records[key] = {
                "email_id": key,
                "classification": None,
                "extraction": {},
                "final": None,
                "review": None,
            }

        return self.records[key]

    def record_classification(
        self,
        email_id,
        *,
        rule_category=None,
        rule_confidence=None,
        rule_uncertain=None,
        semantic_category=None,
        semantic_confidence=None,
        semantic_source=None,
        semantic_reason=None,
        decision=None,
        final_category=None,
    ):
        record = self._record(email_id)

        record["classification"] = {
            "rule": {
                "category": rule_category,
                "confidence": rule_confidence,
                "uncertain": rule_uncertain,
            },
            "semantic": (
                {
                    "category": semantic_category,
                    "confidence": semantic_confidence,
                    "source": semantic_source,
                    "reason": semantic_reason,
                }
                if semantic_category is not None
                else None
            ),
            "decision": decision,
            "final_category": final_category,
        }

    def record_field(
        self,
        email_id,
        *,
        document_role,
        field,
        value,
        confidence,
        source,
        reason=None,
        unit=None,
    ):
        record = self._record(email_id)

        role = str(document_role).upper()
        extraction = record["extraction"]

        if role not in extraction:
            extraction[role] = {}

        extraction[role][str(field)] = {
            "value": value,
            "confidence": confidence,
            "source": source,
            "reason": reason,
            "unit": unit,
        }

    def record_final(
        self,
        email_id,
        *,
        status,
        category=None,
        has_defect=False,
        defect_fields=None,
        review_reason=None,
    ):
        record = self._record(email_id)

        record["final"] = {
            "status": status,
            "category": category,
            "has_defect": bool(has_defect),
            "defect_fields": list(defect_fields or []),
            "review_reason": review_reason,
        }

    def record_review(
        self,
        email_id,
        *,
        reason,
        fields=None,
        document_role=None,
        status="PENDING",
    ):
        record = self._record(email_id)

        record["review"] = {
            "status": status,
            "reason": reason,
            "fields": list(fields or []),
            "document_role": document_role,
        }

    def summary(self):
        semantic_classifications = 0
        semantic_fields = 0
        mismatches = 0
        review_cases = 0

        for record in self.records.values():
            classification = record.get("classification") or {}

            if classification.get("decision") == "semantic_accepted":
                semantic_classifications += 1

            for role_fields in record.get("extraction", {}).values():
                for field_data in role_fields.values():
                    if field_data.get("source") == "semantic":
                        semantic_fields += 1

            final = record.get("final") or {}

            if final.get("status") == "MISMATCH":
                mismatches += 1

            if (
                record.get("review") is not None
                or final.get("status") == "NEEDS_REVIEW"
            ):
                review_cases += 1

        return {
            "total_records": len(self.records),
            "semantic_classifications": semantic_classifications,
            "semantic_fields": semantic_fields,
            "mismatches": mismatches,
            "review_cases": review_cases,
        }

    def as_dict(self):
        return {
            "summary": self.summary(),
            "records": [
                self.records[key]
                for key in sorted(self.records)
            ],
        }

    def save(self, path: Optional[str] = None):
        target = Path(path) if path else self.path

        if target is None:
            raise ValueError(
                "No decision trace output path configured"
            )

        target.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        target.write_text(
            json.dumps(
                self.as_dict(),
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        return target
