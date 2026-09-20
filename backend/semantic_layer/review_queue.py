import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ReviewItem:
    email_id: str
    reason: str
    status: str = "PENDING"
    category: Optional[str] = None
    document_role: Optional[str] = None
    fields: List[str] = field(default_factory=list)
    rule_category: Optional[str] = None
    rule_confidence: Optional[float] = None
    semantic_category: Optional[str] = None
    semantic_confidence: Optional[float] = None
    details: Dict[str, Any] = field(default_factory=dict)


class ReviewQueue:
    """
    Dependency-free Human Review Queue.

    One email is represented by one queue item. If several review
    signals are raised for the same email, they are merged into the
    existing item instead of creating duplicates.
    """

    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.items: List[ReviewItem] = []
        self._by_email = {}

    @staticmethod
    def _merge_unique(left, right):
        result = list(left or [])

        for value in right or []:
            if value not in result:
                result.append(value)

        return result

    def add(self, item: ReviewItem):
        key = str(item.email_id)

        if key not in self._by_email:
            self.items.append(item)
            self._by_email[key] = item
            return True

        existing = self._by_email[key]

        # Merge fields.
        existing.fields = self._merge_unique(
            existing.fields,
            item.fields,
        )

        # Preserve the first/main reason and store other signals.
        if (
            item.reason
            and item.reason != existing.reason
        ):
            extra = existing.details.setdefault(
                "additional_reasons",
                [],
            )

            if item.reason not in extra:
                extra.append(item.reason)

        # Merge document roles if more than one source raised a flag.
        if (
            item.document_role
            and item.document_role
            != existing.document_role
        ):
            roles = existing.details.setdefault(
                "document_roles",
                [],
            )

            if existing.document_role:
                if existing.document_role not in roles:
                    roles.append(
                        existing.document_role
                    )

            if item.document_role not in roles:
                roles.append(
                    item.document_role
                )

        # Fill optional metadata when it was not already available.
        for attr in (
            "category",
            "document_role",
            "rule_category",
            "rule_confidence",
            "semantic_category",
            "semantic_confidence",
        ):
            if (
                getattr(existing, attr) is None
                and getattr(item, attr) is not None
            ):
                setattr(
                    existing,
                    attr,
                    getattr(item, attr),
                )

        # Merge details without deleting earlier information.
        for key_name, value in (
            item.details or {}
        ).items():
            if value in (None, [], {}):
                continue

            if key_name not in existing.details:
                existing.details[
                    key_name
                ] = value

            elif (
                isinstance(
                    existing.details[key_name],
                    list,
                )
                and isinstance(
                    value,
                    list,
                )
            ):
                existing.details[
                    key_name
                ] = self._merge_unique(
                    existing.details[
                        key_name
                    ],
                    value,
                )

        return False

    def add_case(
        self,
        email_id,
        reason,
        *,
        category=None,
        document_role=None,
        fields=None,
        rule_category=None,
        rule_confidence=None,
        semantic_category=None,
        semantic_confidence=None,
        details=None,
    ):
        return self.add(
            ReviewItem(
                email_id=str(email_id),
                reason=str(reason),
                category=category,
                document_role=document_role,
                fields=list(fields or []),
                rule_category=rule_category,
                rule_confidence=rule_confidence,
                semantic_category=semantic_category,
                semantic_confidence=semantic_confidence,
                details=dict(details or {}),
            )
        )

    def pending(self):
        return [
            item
            for item in self.items
            if item.status == "PENDING"
        ]

    def summary(self):
        by_reason = {}

        for item in self.items:
            by_reason[item.reason] = (
                by_reason.get(
                    item.reason,
                    0,
                )
                + 1
            )

        return {
            "total": len(self.items),
            "pending": len(self.pending()),
            "by_reason": by_reason,
        }

    def as_dict(self):
        return {
            "summary": self.summary(),
            "items": [
                asdict(item)
                for item in self.items
            ],
        }

    def save(self, path=None):
        target = (
            Path(path)
            if path
            else self.path
        )

        if target is None:
            raise ValueError(
                "No review queue output path configured"
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
