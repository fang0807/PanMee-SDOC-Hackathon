"""Turn pipeline output into the records the web UI shows.

Shared by api.py (live checks) and export_ui_data.py (the 520 inbox emails).
"""

import re
from datetime import datetime
from pathlib import Path

import main as pipeline

ATTACHMENT_NAME = re.compile(r"_(SI|BL)\.([A-Za-z0-9]+)$")

# The dataset has no real timestamp field. About a third of the sample
# emails include a forwarded reply chain with "Sent: <date>" lines from
# earlier messages in the thread. We treat the latest one found as a
# best-effort stand-in for a received date; the rest have no date at all.
SENT_LINE = re.compile(
    r"Sent:\s*(?:\w+,\s*)?([A-Za-z]+ \d{1,2}, \d{4})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?"
)


def received_date(email):
    """Best-effort received date parsed from quoted 'Sent:' lines.

    Returns (display, iso): display is e.g. "22 Dec, 09:39 PM" for showing
    in the UI, iso is "2026-12-22" for exact-day filtering (a calendar
    picker's value format). Both are "" when the email has no date
    anywhere in its source data.
    """

    body = email.get("body") or ""
    best = None

    for date_part, time_part in SENT_LINE.findall(body):
        fmt = "%B %d, %Y %I:%M %p" if time_part else "%B %d, %Y"

        try:
            dt = datetime.strptime(f"{date_part} {time_part}".strip(), fmt)
        except ValueError:
            continue

        if best is None or dt > best:
            best = dt

    if best is None:
        return "", ""

    if best.hour or best.minute:
        display = best.strftime("%d %b, %I:%M %p")
    else:
        display = best.strftime("%d %b")

    return display, best.strftime("%Y-%m-%d")


# Legal-entity suffixes: always title-cased like a normal word (Co, Ltd,
# Pte, ...), never kept as a bare uppercase abbreviation.
KNOWN_SUFFIXES = {
    "LLC", "LTD", "INC", "GMBH", "PTY", "PTE", "SDN", "BHD", "FZE", "FZ",
    "CO", "LLP", "PLC", "DMCC", "FZC", "CORP", "LP",
}
# Place abbreviations that should stay uppercase (never title-cased).
KEEP_UPPER_PLACE = {"UAE", "US", "UK", "USA", "MEA"}


def _title_company_word(m):
    word = m.group(0)
    if word.upper() in KNOWN_SUFFIXES:
        return word[:1].upper() + word[1:].lower()
    if word.isupper() and len(word) <= 2:
        return word.upper()
    return word[:1].upper() + word[1:].lower()


def _title_place_word(m):
    word = m.group(0)
    if word.upper() in KEEP_UPPER_PLACE:
        return word.upper()
    return word[:1].upper() + word[1:].lower()


def _title_plain_word(m):
    word = m.group(0)
    return word[:1].upper() + word[1:].lower()


def _title_company(text):
    return re.sub(r"[A-Za-z]+", _title_company_word, text.strip())


def _title_place(text):
    return re.sub(r"[A-Za-z]+", _title_place_word, text.strip())


def _title_plain(text):
    """Vessel/misc names: plain capitalize, no abbreviation guessing."""
    return re.sub(r"[A-Za-z]+", _title_plain_word, text.strip())


def _join(parts):
    return " · ".join(p for p in parts if p)


def _embedded_date(text, fmt):
    """Parse a date embedded in the subject itself, as a received() fallback."""

    try:
        dt = datetime.strptime(text, fmt)
    except ValueError:
        return ""

    return dt.strftime("%d %b")


# Each formatter takes the regex match for its template and returns
# (headline, detail_parts, embedded_date). Reference codes (booking refs,
# BL/SI/invoice/PO numbers, carrier codes) are interpolated verbatim from
# the regex groups and never title-cased.
def _f_to_confirm_docs(m):
    booking, port, country, company, num = m.groups()
    return (
        f"To Confirm Docs — {_title_company(company)} ({_title_place(port)}, {_title_place(country)})",
        [f"Booking {booking}", f"BL {num}"],
        "",
    )


def _f_request_si(m):
    booking, port, country, company, num = m.groups()
    return (
        f"Request SI — {_title_company(company)} ({_title_place(port)}, {_title_place(country)})",
        [f"Booking {booking}", f"SI {num}"],
        "",
    )


def _f_cust_si_mea(m):
    booking, po = m.groups()
    return ("Customer SI — MEA", [f"Booking {booking}", f"PO {po}"], "")


def _f_si_needed(m):
    booking, company, po, port = m.groups()
    return (
        f"SI Needed — {_title_company(company)} ({_title_place(port)})",
        [f"Booking {booking}", f"PO {po}"],
        "",
    )


def _f_si_direct(m):
    num, carrier, booking, port, country, doctype, team, date = m.groups()
    return (
        f"SI — {_title_place(port)}, {_title_place(country)}",
        [f"Carrier {carrier}", f"BL {num}", f"Booking {booking}", f"Doc {doctype}", f"Team {team}"],
        _embedded_date(date, "%d-%b-%y"),
    )


def _f_team_desk(m):
    team, port, country, carrier, code, booking, inv, company, terms = m.groups()
    return (
        f"{team} — {_title_company(company)} ({_title_place(port)}, {_title_place(country)})",
        [f"Carrier {carrier}", f"SI {code}", f"Booking {booking}", f"Invoice {inv}", f"Terms {terms}"],
        "",
    )


def _f_request_bl_draft(m):
    po, product, qty = m.groups()
    return (f"Request BL Draft — PO {po}", [_title_company(product), qty], "")


def _f_cancel_invoice(m):
    inv, company, booking = m.groups()
    return (
        f"Request to Cancel Invoice — {_title_company(company)}",
        [f"Invoice {inv}", f"Booking {booking}"],
        "",
    )


def _f_draft_bl(m):
    vessel, voy, port, num = m.groups()
    return (
        f"Draft BL — {_title_plain(vessel)} V.{voy} ({_title_place(port)})",
        [f"Amend BL {num}"],
        "",
    )


def _f_local_charges(m):
    carrier, booking, desc = m.groups()
    return (
        f"Local Charges FOB — {_title_company(carrier)}",
        [f"Booking {booking}", _title_company(desc)],
        "",
    )


def _f_total_freight(m):
    country, booking = m.groups()
    return (f"Total Freight — {_title_place(country)}", [f"Booking {booking}"], "")


def _f_update_summary(m):
    date, vessel, voy = m.groups()
    return (
        f"Update Summary — {_title_plain(vessel)} V.{voy}",
        [],
        _embedded_date(date, "%d_%m_%Y"),
    )


def _f_reminder_paper(m):
    (date,) = m.groups()
    return ("Reminder — Submit SI & AED", [], _embedded_date(date, "%d-%m-%Y"))


def _f_rak_billing(m):
    code, num = m.groups()
    return ("RAK Billing — Missing GR", [f"Ref {code}", f"Invoice {num}"], "")


def _f_mill_dd(m):
    (num,) = m.groups()
    return ("Mill D&D Charges", [f"Invoice {num}"], "")


def _f_pending_bl(m):
    (date,) = m.groups()
    return ("Pending BL Release", [], _embedded_date(date, "%d_%m_%Y"))


def _f_rpa(m):
    (desc,) = m.groups()
    return (f"RPA — {_title_company(desc)}", [], "")


# Tried in order against the subject (after stripping a "RE_"/"RE:" reply
# prefix). Covers ~89% of the real dataset; anything that doesn't match
# falls back to showing the subject unchanged (see format_subject below).
SUBJECT_TEMPLATES = [
    (re.compile(r"^TO CONFIRM DOCS\s*_\s*(\S+)\s*_\s*([^_]+)_([^_]+?)\s*_\s*(.+?)\s*_\s*(\S+)$", re.I), _f_to_confirm_docs),
    (re.compile(r"^REQUEST SI\s*_\s*(\S+)\s*_\s*([^_]+)_([^_]+?)\s*_\s*(.+?)\s*_\s*(\S+)$", re.I), _f_request_si),
    (re.compile(r"^CUST SI\s*_\s*MEA\s*_\s*(\S+)\s*_+\s*PO_(\S+)$", re.I), _f_cust_si_mea),
    (re.compile(r"^SI NEEDED_\s*(\S+)\s*_\s*(.+?)\s*_\s*PO_(\S+)\s*_\s*(.+)$", re.I), _f_si_needed),
    (re.compile(
        r"^SI\s*-\s*(\S+)\s*-\s*DIRECT\(([^)]+)\)\s*-\s*(\S+)\s*-\s*([^_]+)_([^-]+?)\s*-\s*"
        r"(OBL|HOUSE BL|SWB|SURR BL|TELEX)\s*-\s*(\S+)\s*-\s*(\d{1,2}-[A-Za-z]{3}-\d{2})$", re.I
    ), _f_si_direct),
    (re.compile(
        r"^(AFEMY|AFRT|AFPTME|AIE)\s*-\s*([^_]+)_([^-]+?)\s*-\s*([A-Z0-9]+)\(([^)]+)\)\s*-\s*(\S+)\s*-\s*"
        r"(\S+)\s*-\s*(.+?)\s*-\s*(DP|LC|OA|CFR|OA_CFR)$", re.I
    ), _f_team_desk),
    (re.compile(r"^REQUEST BL DRAFT\s*_\s*PO\s*(\S+)_\s*(.+?)__(\S+)$", re.I), _f_request_bl_draft),
    (re.compile(r"^REQUEST TO CANCEL INVOICE\s*-\s*(\S+)\s*-\s*(.+?)\s*-\s*(\S+)$", re.I), _f_cancel_invoice),
    (re.compile(r"^Draft BL\s+(.+?)\s+V\.(\S+)\s+(.+?)\s*-\s*amend BL\s*(\S+)$", re.I), _f_draft_bl),
    (re.compile(r"^LOCAL CHARGES FOB\s*-\s*(.+?)\s*-\s*(\S+)\s*-\s*(.+)$", re.I), _f_local_charges),
    (re.compile(r"^Total Freight\s*-\s*(.+?)\s*-\s*(\S+)$", re.I), _f_total_freight),
    (re.compile(r"^(\d{1,2}_\d{1,2}_\d{4})\s*-\s*UPDATE SUMMARY\s+(.+?)\s+V\.(\S+)$", re.I), _f_update_summary),
    (re.compile(r"^_?Reminder_?Paper\s*-\s*Submit SI\s*&\s*AED_(\d{1,2}-\d{1,2}-\d{4})$", re.I), _f_reminder_paper),
    (re.compile(r"^(\d+)\s+RAK BILLING\s+(\S+)\s+MISSING GR$", re.I), _f_rak_billing),
    (re.compile(r"^Mill D\s*&\s*D charges\s*-\s*(\S+)$", re.I), _f_mill_dd),
    (re.compile(r"^Pending BL Release\s+(\S+)$", re.I), _f_pending_bl),
    (re.compile(r"^_RPA_\s*(.+)$", re.I), _f_rpa),
]

RE_PREFIX = re.compile(r"^RE[:_]\s*", re.I)


def format_subject(subject, received):
    """Raw subject -> {"headline", "details"} for detail-view display.

    `subject` itself is untouched elsewhere (search, reply drafts, list
    rows) - this is a purely additive, best-effort cleanup. Unrecognized
    subjects fall back to showing the original text unchanged.
    """

    subject = (subject or "").strip()
    if not subject:
        return {"headline": "", "details": ""}

    prefix = RE_PREFIX.match(subject)
    body = subject[prefix.end():] if prefix else subject

    headline, parts, embedded = None, [], ""

    for regex, formatter in SUBJECT_TEMPLATES:
        match = regex.match(body)
        if match:
            headline, parts, embedded = formatter(match)
            break

    if headline is None:
        headline = body

    if prefix:
        headline = f"Re: {headline}"

    date = received or embedded

    return {"headline": headline, "details": _join(parts + ([date] if date else []))}


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

    received, received_iso = received_date(email)

    return {
        "id": result["email_id"],
        "subject": email.get("subject") or "",
        "displaySubject": format_subject(email.get("subject") or "", received),
        "sender": email.get("from") or "",
        "senderName": sender_name(email.get("from")),
        "body": email.get("body") or "",
        "received": received,
        "receivedDate": received_iso,
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
