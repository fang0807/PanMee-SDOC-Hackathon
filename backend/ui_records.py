"""Turn pipeline output into the records the web UI shows.

Shared by api.py (live checks) and export_ui_data.py (the 520 inbox emails).
"""

import main as pipeline


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


def doc_type(email, result):
    if result["category"] == "BL_COMPARISON":
        return "SI + BL" if email.get("attachments") else "BL request"

    return DOC_TYPES.get(result["category"], "General")


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
        "category": result["category"],
        "status": result["status"],
        "defectFields": result["defect_fields"],
        "reviewReason": result["review_reason"],
        "fields": build_fields(result, detail),
    }
