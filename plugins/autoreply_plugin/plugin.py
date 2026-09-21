"""Standalone post-verification Auto Reply plugin.

The plugin deliberately does not import any SmartDoc backend modules. It only
consumes a small event dictionary, so it can be copied to another version of
the project without changing the classifier/comparator/extractor code.
"""

from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .mailer import SMTPConfig, SMTPMailer
from .store import ReplyStore
from .templates import match_reply, mismatch_reply


_EMAIL_RE = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")


@dataclass
class AutoReplyDecision:
    email_id: str
    status: str
    action: str
    recipient: str = ""
    subject: str = ""
    body: str = ""
    path: str = ""
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AutoReplyPlugin:
    """Process one verification result and decide/send/queue a reply."""

    def __init__(
        self,
        *,
        data_dir: str | Path | None = None,
        live_send: bool | None = None,
        mailer: SMTPMailer | None = None,
    ):
        default_dir = Path(__file__).resolve().parent / "runtime"
        self.store = ReplyStore(data_dir or os.getenv("AUTOREPLY_DATA_DIR") or default_dir)

        if live_send is None:
            live_send = os.getenv("AUTOREPLY_LIVE_SEND", "0").strip().lower() in {
                "1", "true", "yes", "on"
            }
        self.live_send = bool(live_send)
        self._mailer = mailer

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _recipient(email: dict[str, Any]) -> str:
        recipient = str(email.get("from") or email.get("sender") or "").strip()
        if "\r" in recipient or "\n" in recipient or not _EMAIL_RE.match(recipient):
            return ""
        return recipient

    def _get_mailer(self) -> SMTPMailer:
        if self._mailer is None:
            self._mailer = SMTPMailer(SMTPConfig.from_env())
        return self._mailer

    @staticmethod
    def _normalise_status(verification: dict[str, Any]) -> str:
        return str(verification.get("status") or "").strip().upper()

    def handle(
        self,
        email: dict[str, Any],
        verification: dict[str, Any],
    ) -> AutoReplyDecision:
        email_id = str(
            verification.get("email_id") or email.get("email_id") or "unknown"
        )
        status = self._normalise_status(verification)
        recipient = self._recipient(email)

        if status not in {"OK", "MISMATCH", "NEEDS_REVIEW"}:
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="SKIPPED",
                reason=f"Unsupported verification status: {status or 'empty'}",
            )

        if status == "NEEDS_REVIEW":
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="SKIPPED",
                recipient=recipient,
                reason="Verification itself needs employee review; no auto reply generated.",
            )

        if not recipient:
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="SKIPPED",
                reason="Sender email address is missing or invalid.",
            )

        if self.store.already_sent(email_id):
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="ALREADY_SENT",
                recipient=recipient,
                path=str(self.store.sent_path(email_id)),
                reason="Duplicate reply blocked by email_id idempotency check.",
            )

        original_subject = email.get("subject")

        if status == "MISMATCH":
            subject, body = mismatch_reply(
                original_subject,
                list(verification.get("defect_fields") or []),
            )
            payload = {
                "email_id": email_id,
                "verification_status": status,
                "recipient": recipient,
                "subject": subject,
                "body": body,
                "defect_fields": list(verification.get("defect_fields") or []),
                "requires_employee_review": True,
                "created_at": self._timestamp(),
            }
            path = self.store.save_pending(email_id, payload)
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="REVIEW_REQUIRED",
                recipient=recipient,
                subject=subject,
                body=body,
                path=str(path),
                reason="Mismatch reply drafted but not sent until employee approval.",
            )

        subject, body = match_reply(original_subject)
        payload = {
            "email_id": email_id,
            "verification_status": status,
            "recipient": recipient,
            "subject": subject,
            "body": body,
            "requires_employee_review": False,
            "created_at": self._timestamp(),
        }

        if not self.live_send:
            path = self.store.save_preview(email_id, payload)
            return AutoReplyDecision(
                email_id=email_id,
                status=status,
                action="PREVIEW_ONLY",
                recipient=recipient,
                subject=subject,
                body=body,
                path=str(path),
                reason="Dry-run mode is enabled; set AUTOREPLY_LIVE_SEND=1 to send automatically.",
            )

        self._get_mailer().send(recipient, subject, body)
        payload["sent_at"] = self._timestamp()
        path = self.store.mark_sent(email_id, payload)
        return AutoReplyDecision(
            email_id=email_id,
            status=status,
            action="SENT",
            recipient=recipient,
            subject=subject,
            body=body,
            path=str(path),
        )

    def approve_and_send(self, email_id: str) -> AutoReplyDecision:
        """Employee-approved send path for a queued MISMATCH reply."""
        if self.store.already_sent(email_id):
            return AutoReplyDecision(
                email_id=email_id,
                status="MISMATCH",
                action="ALREADY_SENT",
                path=str(self.store.sent_path(email_id)),
            )

        payload = self.store.load_pending(email_id)
        recipient = str(payload["recipient"])
        subject = str(payload["subject"])
        body = str(payload["body"])

        if not self.live_send:
            return AutoReplyDecision(
                email_id=email_id,
                status="MISMATCH",
                action="APPROVAL_PREVIEW",
                recipient=recipient,
                subject=subject,
                body=body,
                path=str(self.store.pending_path(email_id)),
                reason="Approved draft is ready, but dry-run mode prevents real sending.",
            )

        self._get_mailer().send(recipient, subject, body)
        payload["approved_at"] = self._timestamp()
        payload["sent_at"] = self._timestamp()
        path = self.store.mark_sent(email_id, payload)
        return AutoReplyDecision(
            email_id=email_id,
            status="MISMATCH",
            action="SENT_AFTER_REVIEW",
            recipient=recipient,
            subject=subject,
            body=body,
            path=str(path),
        )
