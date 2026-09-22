"""Turn pipeline output into the records the web UI shows.

Shared by api.py (live checks) and export_ui_data.py (the 520 inbox emails).
"""

import re
from pathlib import Path

import main as pipeline

ATTACHMENT_NAME = re.compile(r"_(SI|BL)\.([A-Za-z0-9]+)$")

# Internal field names, in the order the UI lists them. gross_weight is
# reported as gross_weight_kg in the submission (see convert_field_name).
FIELD_ORDER = [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
]

DOC_TYPES = {
    "SI_REQUEST": "SI Request",
    "INVOICE_QUERY": "Invoice Query",
    "GENERAL": "General",
    "SPAM": "Spam",
}

BL_AMENDMENT_RE = re.compile(
    r"\b(amend|amendment|revise|revision|correct|correction)\b.*\bBL\b|\bBL\b.*\b(amend|amendment|revise|revision|correct|correction)\b",
    re.IGNORECASE,
)


def bl_request_subtype(email):
    """Return the UI-only subtype for a real draft-BL request.

    The benchmark intentionally keeps these messages under BL_COMPARISON,
    so this function does not change the model category.  It only separates
    workflow intent in the UI and prevents missing-attachment comparisons
    from being mislabeled as requests.
    """

    if email.get("attachments"):
        return None

    body = email.get("body") or ""
    if not pipeline.DRAFT_BL_REQUEST_RE.search(body):
        return None

    subject = email.get("subject") or ""

    if BL_AMENDMENT_RE.search(subject):
        return "BL Amendment Request"

    if "to confirm docs" in subject.lower():
        return "BL Confirmation Request"

    return "BL Draft Request"


def build_fields(result, detail):
    """Per-field table: the value from each document and a verdict."""

    if "si_fields" not in detail:
        return []

    defects = set(result["defect_fields"])
    fields = []

    for name in FIELD_ORDER:
        key = pipeline.convert_field_name(name)

        si_value = detail["si_fields"].get(name)
        bl_value = detail["bl_fields"].get(name)

        if key in defects:
            verdict = "mismatch"
            reason = "The SI and the BL do not agree on this field."

        elif (
            result["status"] == "NEEDS_REVIEW"
            and (
                not pipeline.has_real_value(si_value)
                or not pipeline.has_real_value(bl_value)
            )
        ):
            verdict = "review"
            reason = "This value is missing or unreadable in one document."

        else:
            verdict = "match"
            reason = ""

        fields.append(
            {
                "field": key,
                "si": "" if si_value is None else str(si_value),
                "bl": "" if bl_value is None else str(bl_value),
                "result": verdict,
                "reason": reason,
            }
        )

    return fields


def sender_name(address):
    domain = (address or "").split("@")[-1].strip()

    return domain or "Unknown sender"


def workflow_type(email, result):
    if result["category"] != "BL_COMPARISON":
        return result["category"]

    return "BL_REQUEST" if bl_request_subtype(email) else "BL_COMPARISON"


def doc_type(email, result):
    if result["category"] == "BL_COMPARISON":
        subtype = bl_request_subtype(email)
        if subtype:
            return subtype

        # This includes the important missing-attachment case.  It is still a
        # comparison that requires review, not a request for a draft BL.
        return "SI + BL"

    return DOC_TYPES.get(result["category"], "General")


def attachment_summary(email):
    """Return the first SI / BL attachment recognised by the pipeline.

    This uses the same robust role matcher as verification, so filenames such
    as ``shipping_instruction.pdf`` and ``bill-of-lading.pdf`` are shown in
    the UI instead of being hidden just because they do not end in ``_SI`` or
    ``_BL``.
    """

    attachments = email.get("attachments") or []
    summary = {}

    for role in ("SI", "BL"):
        matches = pipeline.find_role_attachments(attachments, role)
        if not matches:
            continue

        name = Path(pipeline.attachment_name(matches[0])).name
        summary[role] = {
            "filename": name,
            "extension": Path(name).suffix.lower().lstrip("."),
        }

    return summary


def make_ui_record(email, result, detail):
    """One inbox email plus its pipeline result, as the UI needs it."""

    return {
        "id": result["email_id"],
        "subject": email.get("subject") or "",
        "sender": email.get("from") or "",
        "senderName": sender_name(email.get("from")),
        "body": email.get("body") or "",
        # The dataset has no timestamps, so the email id stands in.
        "received": result["email_id"],
        "docType": doc_type(email, result),
        "workflowType": workflow_type(email, result),
        "workflowSubtype": bl_request_subtype(email),
        "category": result["category"],
        "status": result["status"],
        "defectFields": result["defect_fields"],
        "reviewReason": result["review_reason"],
        "fields": build_fields(result, detail),
        "attachments": attachment_summary(email),
    }
