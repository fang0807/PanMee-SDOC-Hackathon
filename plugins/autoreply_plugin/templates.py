"""Email templates used by the standalone Auto Reply plugin."""

from __future__ import annotations

FIELD_LABELS = {
    "shipper": "Shipper",
    "consignee": "Consignee",
    "notify_party": "Notify Party",
    "port_of_loading": "Port of Loading",
    "port_of_discharge": "Port of Discharge",
    "container_count": "Container Count",
    "gross_weight": "Gross Weight",
    "gross_weight_kg": "Gross Weight",
}


def _reply_subject(original_subject: str | None) -> str:
    subject = (original_subject or "Shipping Instruction").strip()
    if subject.lower().startswith("re:"):
        return subject
    return f"Re: {subject}"


def match_reply(original_subject: str | None) -> tuple[str, str]:
    """Reply sent automatically when SI and BL verification is OK."""
    subject = _reply_subject(original_subject)
    body = (
        "Dear Client,\n\n"
        "Thank you for your submission. Your Shipping Instruction (SI) "
        "has been correctly received and the document verification was completed successfully.\n\n"
        "No further action is required at this time.\n\n"
        "Best regards,\n"
        "SmartDoc Verification Team"
    )
    return subject, body


def mismatch_reply(
    original_subject: str | None,
    defect_fields: list[str] | None,
) -> tuple[str, str]:
    """Draft for employee review when mismatches were detected."""
    subject = _reply_subject(original_subject)
    fields = [
        FIELD_LABELS.get(field, field.replace("_", " ").title())
        for field in (defect_fields or [])
        if field
    ]

    if fields:
        bullets = "\n".join(f"- {field}" for field in fields)
        issue_text = (
            "The following item(s) do not match between the SI and the draft BL:\n"
            f"{bullets}\n\n"
        )
    else:
        issue_text = (
            "One or more items do not match between the SI and the draft BL.\n\n"
        )

    body = (
        "Dear Client,\n\n"
        "Thank you for your submission. During verification, we identified "
        "differences that require your attention.\n\n"
        f"{issue_text}"
        "Please review the information and provide the corrected details or documents.\n\n"
        "Best regards,\n"
        "SmartDoc Verification Team"
    )
    return subject, body
