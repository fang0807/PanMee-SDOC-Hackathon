import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from loader import Inbox
from classifier import classify_email
from extractor import extract_fields
from comparator import compare_documents
from ocr_checks import (
    FIELDS as OCR_CHECKED_FIELDS,
    agreed_port_values,
    build_port_vocabulary,
    check_fields,
    flagged_fields,
)
from semantic_layer.review_queue import ReviewQueue


# ============================================================
# Paths
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
RESULTS_PATH = BASE_DIR / "results.json"
SUBMISSION_PATH = BASE_DIR / "submission.json"
REVIEW_QUEUE_PATH = BASE_DIR / "review_queue.json"
CURRENT_INBOX = None

# Filled while emails are processed, used to build review_queue.json:
# ports both documents agree on (trusted vocabulary) and the emails
# whose attachments had to be read with OCR.
PORT_VALUES = []
OCR_CASES = []

DRAFT_BL_REQUEST_RE = re.compile(
    r"send\s+the\s+draft\s+BL",
    re.IGNORECASE,
)

INTERNAL_NOTICE_RE = re.compile(
    r"Reminder:\s*Please\s+submit\s+SI\s*&\s*AED\s+for\s+all\s+pending\s+shipments"
    r"|list\s+of\s+outstanding\s+BL",
    re.IGNORECASE,
)


# ============================================================
# Category mapping
# ============================================================

CATEGORY_MAP = {
    "document_comparison": "BL_COMPARISON",
    "new_si_request": "SI_REQUEST",
    "invoice_query": "INVOICE_QUERY",
    "general": "GENERAL",
    "spam": "SPAM",
}


# ============================================================
# Required fields
# ============================================================

REQUIRED_FIELDS = [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
]


# ============================================================
# Value helpers
# ============================================================

def clean_value(value):
    if value is None:
        return None

    if isinstance(value, str):
        value = value.strip()

        if not value:
            return None

        if value.lower() in {
            "n/a",
            "na",
            "none",
            "null",
            "unknown",
            "-",
            "--",
            "_",
            "__",
            "___",
            "____",
            "_____",
            "______",
            "tba",
            "to be advised",
            "not available",
        }:
            return None

    return value


def has_real_value(value):
    return clean_value(value) is not None


def normalise_extracted_fields(fields):
    if fields is None:
        fields = {}

    fields = dict(fields)

    if (
        "gross_weight" not in fields
        and "gross_weight_kg" in fields
    ):
        fields["gross_weight"] = fields["gross_weight_kg"]

    if (
        "gross_weight_kg" not in fields
        and "gross_weight" in fields
    ):
        fields["gross_weight_kg"] = fields["gross_weight"]

    return fields


# ============================================================
# Attachment helpers
# ============================================================

def attachment_name(attachment):
    """
    Convert attachment representation into a filename/path string.

    Normally attachments are strings. This also handles a few
    possible dictionary representations safely.
    """
    if attachment is None:
        return ""

    if isinstance(attachment, dict):
        for key in (
            "filename",
            "name",
            "path",
            "file",
            "attachment",
        ):
            value = attachment.get(key)
            if value:
                return str(value).strip()

    return str(attachment).strip()


def attachment_suffix(attachment):
    return Path(
        attachment_name(attachment)
    ).suffix.lower()


def _normalise_filename_for_role(filename):
    """
    Turn separators such as -, _, (, ), etc. into spaces so
    role matching is more robust.
    """
    filename = str(filename).upper()

    filename = filename.replace(
        ".",
        " ",
    )

    filename = re.sub(
        r"[^A-Z0-9]+",
        " ",
        filename,
    )

    return " ".join(
        filename.split()
    )


def find_role_attachments(
    attachments,
    role,
):
    """
    Robustly identify SI / BL attachments.

    Supported examples:

        email_001_SI.pdf
        email_001_BL.pdf
        SI_email_001.pdf
        BL_email_001.pdf
        shipping_instruction.pdf
        shipping_instructions.docx
        bill_of_lading.pdf
        bill-of-lading.pdf
        B_L.pdf
        B/L.pdf

    The original implementation only recognised filenames with
    an exact "_SI." / "_BL." pattern, which can incorrectly
    produce missing_attachment for valid documents.
    """

    role = str(role).upper().strip()

    found = []

    for attachment in attachments or []:

        raw_name = attachment_name(
            attachment
        )

        if not raw_name:
            continue

        filename = Path(
            raw_name
        ).name

        normalised = _normalise_filename_for_role(
            filename
        )

        tokens = set(
            normalised.split()
        )

        is_match = False

        if role == "SI":
            # Short SI forms
            if "SI" in tokens:
                is_match = True

            # Common full-name forms
            if (
                "SHIPPING INSTRUCTION" in normalised
                or "SHIPPING INSTRUCTIONS" in normalised
            ):
                is_match = True

            if (
                "SHIP INSTRUCTION" in normalised
                or "SHIP INSTRUCTIONS" in normalised
            ):
                is_match = True

            if (
                "SHIPPERS INSTRUCTION" in normalised
                or "SHIPPER INSTRUCTION" in normalised
            ):
                is_match = True

        elif role == "BL":
            # Short BL forms
            if "BL" in tokens:
                is_match = True

            if "BOL" in tokens:
                is_match = True

            # B/L becomes B L after normalisation
            if (
                "B L" in normalised
                or "B LADING" in normalised
            ):
                is_match = True

            # Full name
            if (
                "BILL OF LADING" in normalised
            ):
                is_match = True

            if (
                "BILL_OF_LADING" in str(filename).upper()
            ):
                is_match = True

        if is_match:
            found.append(
                attachment
            )

    return found


# ============================================================
# DOCX reader
#
# Paragraph-only reader.
# ============================================================

def read_docx_text(path):
    try:
        with zipfile.ZipFile(
            path,
            "r",
        ) as z:

            document_xml = z.read(
                "word/document.xml"
            )

        root = ET.fromstring(
            document_xml
        )

        namespace = {
            "w": (
                "http://schemas.openxmlformats.org/"
                "wordprocessingml/2006/main"
            )
        }

        paragraphs = []

        for paragraph in root.findall(
            ".//w:p",
            namespace,
        ):

            texts = []

            # Walk the paragraph in document order so line breaks
            # (<w:br/>) and tabs inside a cell are kept instead of
            # gluing "TRADING" + "ON BEHALF" into "TRADINGON BEHALF".
            for node in paragraph.iter():

                tag = node.tag.rsplit(
                    "}",
                    1,
                )[-1]

                if tag == "t":
                    if node.text:
                        texts.append(
                            node.text
                        )

                elif tag in {"br", "cr"}:
                    texts.append("\n")

                elif tag == "tab":
                    texts.append(" ")

            if texts:
                paragraph_text = (
                    "".join(texts)
                    .strip()
                )

                if paragraph_text:
                    paragraphs.append(
                        paragraph_text
                    )

        result = "\n".join(
            paragraphs
        ).strip()

        if not result:
            return None

        return result

    except Exception:
        return None


# ============================================================
# XLSX reader
# ============================================================

def read_xlsx_text(path):
    try:
        with zipfile.ZipFile(
            path,
            "r",
        ) as z:

            # ------------------------------------------------
            # Shared strings
            # ------------------------------------------------

            shared_strings = []

            if (
                "xl/sharedStrings.xml"
                in z.namelist()
            ):

                shared_xml = z.read(
                    "xl/sharedStrings.xml"
                )

                root = ET.fromstring(
                    shared_xml
                )

                namespace = {
                    "a": (
                        "http://schemas.openxmlformats.org/"
                        "spreadsheetml/2006/main"
                    )
                }

                for si in root.findall(
                    ".//a:si",
                    namespace,
                ):

                    pieces = []

                    for t in si.findall(
                        ".//a:t",
                        namespace,
                    ):

                        if t.text:
                            pieces.append(
                                t.text
                            )

                    shared_strings.append(
                        "".join(pieces)
                    )

            # ------------------------------------------------
            # Worksheets
            # ------------------------------------------------

            worksheet_names = [
                name
                for name in z.namelist()
                if (
                    name.startswith(
                        "xl/worksheets/"
                    )
                    and name.endswith(
                        ".xml"
                    )
                )
            ]

            namespace = {
                "a": (
                    "http://schemas.openxmlformats.org/"
                    "spreadsheetml/2006/main"
                )
            }

            all_rows = []

            for worksheet_name in (
                worksheet_names
            ):

                xml_data = z.read(
                    worksheet_name
                )

                root = ET.fromstring(
                    xml_data
                )

                for row in root.findall(
                    ".//a:row",
                    namespace,
                ):

                    values = []

                    for cell in row.findall(
                        "a:c",
                        namespace,
                    ):

                        cell_type = cell.get(
                            "t"
                        )

                        value_node = cell.find(
                            "a:v",
                            namespace,
                        )

                        inline_node = cell.find(
                            "a:is",
                            namespace,
                        )

                        value = ""

                        # ------------------------------------
                        # Shared string
                        # ------------------------------------

                        if (
                            cell_type == "s"
                            and value_node is not None
                            and value_node.text is not None
                        ):

                            try:
                                index = int(
                                    value_node.text
                                )

                                if (
                                    0
                                    <= index
                                    < len(
                                        shared_strings
                                    )
                                ):
                                    value = (
                                        shared_strings[
                                            index
                                        ]
                                    )
                                else:
                                    value = (
                                        value_node.text
                                    )

                            except Exception:
                                value = (
                                    value_node.text
                                )

                        # ------------------------------------
                        # Inline string
                        # ------------------------------------

                        elif (
                            inline_node
                            is not None
                        ):

                            pieces = []

                            for t in inline_node.findall(
                                ".//a:t",
                                namespace,
                            ):

                                if t.text:
                                    pieces.append(
                                        t.text
                                    )

                            value = "".join(
                                pieces
                            )

                        # ------------------------------------
                        # Normal value
                        # ------------------------------------

                        elif (
                            value_node is not None
                            and value_node.text is not None
                        ):

                            value = (
                                value_node.text
                            )

                        values.append(
                            value
                        )

                    if values:
                        all_rows.append(
                            " | ".join(
                                values
                            )
                        )

            result = "\n".join(
                all_rows
            ).strip()

            if not result:
                return None

            return result

    except Exception:
        return None


# ============================================================
# Generic attachment reader
# ============================================================

def read_attachment(
    inbox,
    attachment,
):
    try:
        suffix = attachment_suffix(
            attachment
        )

        attachment_str = attachment_name(
            attachment
        )

        path = (
            BASE_DIR
            / attachment_str
        )

        # ----------------------------------------------------
        # DOCX
        # ----------------------------------------------------

        if suffix == ".docx":

            text = read_docx_text(
                path
            )

            if (
                text is None
                or not text.strip()
            ):
                return (
                    None,
                    "unreadable",
                )

            return (
                text,
                None,
            )

        # ----------------------------------------------------
        # XLSX
        # ----------------------------------------------------

        if suffix == ".xlsx":

            text = read_xlsx_text(
                path
            )

            if (
                text is None
                or not text.strip()
            ):
                return (
                    None,
                    "unreadable",
                )

            return (
                text,
                None,
            )

        # ----------------------------------------------------
        # Other files
        # ----------------------------------------------------

        document = inbox.read_document(
            attachment
        )

        text = document["text"]

        if text is None:
            return (
                None,
                "unreadable",
            )

        text = str(text)

        if not text.strip():
            return (
                None,
                "unreadable",
            )

        # Text that came from OCR is only evidence for a reviewer;
        # it must never decide OK / MISMATCH.
        if document["ocr"]:
            return (
                text,
                "scanned",
            )

        return (
            text,
            None,
        )

    except Exception:
        return (
            None,
            "unreadable",
        )


# ============================================================
# Fallback extraction helpers
# ============================================================

def _normalise_label(text):
    if text is None:
        return ""

    text = str(
        text
    ).upper()

    text = (
        text
        .replace("（", "(")
        .replace("）", ")")
    )

    # Remove parenthesised portions such as "(KG)"
    text = re.sub(
        r"\([^)]*\)",
        "",
        text,
    )

    text = re.sub(
        r"[^A-Z0-9]+",
        " ",
        text,
    )

    return " ".join(
        text.split()
    )


def _clean_fallback_value(
    value
):
    if value is None:
        return None

    value = str(
        value
    ).strip()

    value = value.strip(
        " |:\t"
    )

    if not value:
        return None

    return value


def _extract_after_pipe(
    line
):
    parts = [
        p.strip()
        for p in line.split("|")
    ]

    if len(parts) < 2:
        return None

    values = [
        p
        for p in parts[1:]
        if p
    ]

    if not values:
        return None

    return " | ".join(
        values
    )


# ============================================================
# Fallback extractor
# ============================================================

def fallback_extract_fields(
    text
):
    result = {}

    if not text:
        return result

    lines = [
        line.strip()
        for line in str(
            text
        ).splitlines()
        if line.strip()
    ]

    aliases = {
        "shipper": [
            "SHIPPER",
            "SHIPPER EXPORTER",
            "SHIPPER PRINCIPAL OR SELLER",
        ],

        "consignee": [
            "CONSIGNEE",
            "TO THE ORDER OF",
        ],

        "notify_party": [
            "NOTIFY",
            "NOTIFY PARTY",
            "NOTIFY PARTY INTERMEDIATE CONSIGNEE",
        ],

        "port_of_loading": [
            "POL",
            "PORT OF LOADING",
            "LOAD PORT",
        ],

        "port_of_discharge": [
            "POD",
            "PORT OF DISCHARGE",
            "DISCHARGE PORT",
        ],

        "container_count": [
            "CONTAINER COUNT",
            "TOTAL CONTAINERS",
            "NO OF CONTAINERS",
            "NO. OF CONTAINERS",
            "NO OF CONTAINERS OR PACKAGES",
            "NUMBER OF CONTAINERS",
        ],

        "gross_weight": [
            "GROSS WEIGHT",
            "GROSS WEIGHT KG",
            "GROSS WT",
            "GROSS WT KGS",
            "GROSS WEIGHT (KG)",
        ],
    }

    alias_normalised = {
        field: [
            _normalise_label(
                alias
            )
            for alias in alias_list
        ]
        for field, alias_list
        in aliases.items()
    }

    def match_field(label):
        normalised = (
            _normalise_label(
                label
            )
        )

        candidates = []

        for field, labels in (
            alias_normalised.items()
        ):

            for alias in labels:

                if normalised == alias:
                    candidates.append(
                        (
                            len(alias),
                            field,
                        )
                    )

                elif normalised.startswith(
                    alias + " "
                ):
                    candidates.append(
                        (
                            len(alias),
                            field,
                        )
                    )

        if not candidates:
            return None

        candidates.sort(
            reverse=True
        )

        return candidates[0][1]

    def is_label_line(line):
        return (
            match_field(line)
            is not None
        )

    for index, line in enumerate(
        lines
    ):

        # ----------------------------------------------------
        # Pipe format
        # ----------------------------------------------------

        if "|" in line:

            label_part = (
                line.split(
                    "|",
                    1,
                )[0]
                .strip()
            )

            field = match_field(
                label_part
            )

            if field:

                value = (
                    _extract_after_pipe(
                        line
                    )
                )

                if value:
                    result.setdefault(
                        field,
                        value,
                    )

                continue

        # ----------------------------------------------------
        # Label
        # ----------------------------------------------------

        field = match_field(
            line
        )

        if not field:
            continue

        # ----------------------------------------------------
        # Label: value
        # ----------------------------------------------------

        if ":" in line:

            left, right = (
                line.split(
                    ":",
                    1,
                )
            )

            if match_field(left):

                value = (
                    _clean_fallback_value(
                        right
                    )
                )

                if value:
                    result.setdefault(
                        field,
                        value,
                    )

                    continue

        # ----------------------------------------------------
        # TO THE ORDER OF
        # ----------------------------------------------------

        normalised_line = (
            _normalise_label(
                line
            )
        )

        order_prefix = (
            _normalise_label(
                "TO THE ORDER OF"
            )
        )

        if normalised_line.startswith(
            order_prefix + " "
        ):

            remainder = (
                normalised_line[
                    len(
                        order_prefix
                    ):
                ].strip()
            )

            if remainder:
                result.setdefault(
                    "consignee",
                    remainder,
                )

                continue

        # ----------------------------------------------------
        # Label on current line,
        # value on next line
        # ----------------------------------------------------

        if index + 1 < len(lines):

            next_line = lines[
                index + 1
            ]

            if (
                next_line
                and not is_label_line(
                    next_line
                )
            ):

                value = (
                    _clean_fallback_value(
                        next_line
                    )
                )

                if value:
                    result.setdefault(
                        field,
                        value,
                    )

    # --------------------------------------------------------
    # Gross weight normalization
    # --------------------------------------------------------

    if "gross_weight" in result:

        value = result[
            "gross_weight"
        ]

        match = re.search(
            r"(\d[\d,]*(?:\.\d+)?)",
            value,
        )

        if match:
            result[
                "gross_weight"
            ] = match.group(1)

    return result


# ============================================================
# Merge extraction results
# ============================================================

def merge_extracted_fields(
    primary,
    fallback,
):
    primary = (
        normalise_extracted_fields(
            primary
        )
    )

    fallback = (
        normalise_extracted_fields(
            fallback
        )
    )

    merged = dict(
        primary
    )

    for field, value in (
        fallback.items()
    ):

        if not has_real_value(
            merged.get(field)
        ):

            if has_real_value(
                value
            ):
                merged[field] = value

    return normalise_extracted_fields(
        merged
    )


# ============================================================
# Wrong document detection
# ============================================================

def is_wrong_document_type(
    text
):
    if not text:
        return False

    first_part = (
        str(text)[:1500]
        .upper()
    )

    wrong_document_markers = [
        "COMMERCIAL INVOICE",
        "PACKING LIST",
        "CERTIFICATE OF ORIGIN",
    ]

    return any(
        marker in first_part
        for marker
        in wrong_document_markers
    )


# ============================================================
# Explicit missing detection
# ============================================================

def has_explicit_missing_value(
    text
):
    if not text:
        return False

    upper = str(
        text
    ).upper()

    missing_patterns = [
        "N/A",
        "NOT AVAILABLE",
        "TO BE ADVISED",
        "TBA",
        "____",
        "______",
        "????",
    ]

    return any(
        pattern in upper
        for pattern
        in missing_patterns
    )


def has_blank_required_field(
    text
):
    if not text:
        return False

    lines = str(
        text
    ).splitlines()

    field_names = [
        "SHIPPER",
        "CONSIGNEE",
        "NOTIFY PARTY",
        "NOTIFY PARTY NAME",
        "PORT OF LOADING",
        "LOAD PORT",
        "POL",
        "PORT OF DISCHARGE",
        "DISCHARGE PORT",
        "POD",
        "NO. OF CONTAINERS",
        "NO OF CONTAINERS",
        "NUMBER OF CONTAINERS",
        "CONTAINER COUNT",
        "TOTAL CONTAINERS",
        "GROSS WEIGHT",
        "GROSS WEIGHT KG",
        "GROSS WEIGHT (KG)",
    ]

    for line in lines:

        stripped = (
            line
            .strip()
            .upper()
        )

        if not stripped:
            continue

        for field in field_names:

            if not stripped.startswith(
                field
            ):
                continue

            remainder = stripped[
                len(field):
            ]

            remainder = (
                remainder.lstrip(
                    " :()-\t|"
                )
            )

            if not remainder:
                return True

    return False


def document_has_explicit_missing_value(
    text
):
    return (
        has_explicit_missing_value(
            text
        )
        or has_blank_required_field(
            text
        )
    )


# ============================================================
# Result helper
# ============================================================

def make_result(
    email_id,
    category,
    status,
    has_defect=False,
    defect_fields=None,
    review_reason=None,
):
    return {
        "email_id":
            email_id,

        "category":
            category,

        "status":
            status,

        "has_defect":
            has_defect,

        "defect_fields":
            defect_fields or [],

        "review_reason":
            review_reason,
    }


# ============================================================
# Comparator helpers
# ============================================================

def convert_field_name(
    field
):
    """
    Convert internal extractor/comparator field names
    to the official submission field names.

    IMPORTANT:
        internal: gross_weight
        submission: gross_weight_kg
    """

    if field == "gross_weight":
        return "gross_weight_kg"

    return field


def extract_field_from_item(
    item
):
    if isinstance(
        item,
        str,
    ):
        return item

    if isinstance(
        item,
        dict,
    ):
        return (
            item.get("field")
            or item.get("name")
            or item.get("key")
        )

    if isinstance(
        item,
        (list, tuple),
    ):
        if item:
            return item[0]

    return None


def extract_defect_fields(
    items
):
    """
    Convert comparator output into the exact official
    defect field names and order.
    """

    defect_fields = []

    for item in items or []:

        field = (
            extract_field_from_item(
                item
            )
        )

        if not field:
            continue

        field = convert_field_name(
            field
        )

        if field not in defect_fields:
            defect_fields.append(
                field
            )

    # --------------------------------------------------------
    # Official field order
    # --------------------------------------------------------

    field_order = [
        "shipper",
        "consignee",
        "notify_party",
        "port_of_loading",
        "port_of_discharge",
        "container_count",
        "gross_weight_kg",
    ]

    order_map = {
        field: index
        for index, field in enumerate(
            field_order
        )
    }

    defect_fields.sort(
        key=lambda field:
            order_map.get(
                field,
                999,
            )
    )

    return defect_fields


def find_missing_required_fields(
    si_fields,
    bl_fields,
):
    missing_fields = []

    for field in REQUIRED_FIELDS:

        si_value = (
            si_fields.get(
                field
            )
        )

        bl_value = (
            bl_fields.get(
                field
            )
        )

        if (
            not has_real_value(
                si_value
            )
            or not has_real_value(
                bl_value
            )
        ):
            missing_fields.append(
                field
            )

    return missing_fields


def normalize_comparison_result(
    comparison
):
    if isinstance(
        comparison,
        tuple,
    ):

        if len(comparison) >= 2:
            return (
                comparison[0] or [],
                comparison[1] or [],
            )

        if len(comparison) == 1:
            return (
                comparison[0] or [],
                [],
            )

    if isinstance(
        comparison,
        list,
    ):

        if len(comparison) >= 2:
            return (
                comparison[0] or [],
                comparison[1] or [],
            )

        return (
            comparison,
            [],
        )

    if isinstance(
        comparison,
        dict,
    ):

        return (
            comparison.get(
                "mismatches",
                [],
            ) or [],

            comparison.get(
                "missing",
                [],
            ) or [],
        )

    return [], []


# ============================================================
# Process one email
# ============================================================

# ============================================================
# OCR review evidence
# ============================================================

def record_ocr_case(
    email_id,
    documents,
):
    OCR_CASES.append(
        {
            "email_id": email_id,
            "documents": documents,
        }
    )


def extract_document_fields(text):
    """Same extraction as process_email, for OCR text (evidence only)."""

    try:
        fields = extract_fields(text)
    except Exception:
        fields = {}

    fields = normalise_extracted_fields(fields)

    try:
        fields = merge_extracted_fields(
            fields,
            fallback_extract_fields(text),
        )
    except Exception:
        pass

    return fields


def build_review_queue():
    """Write review_queue.json: OCR text and plausibility flags for
    every email that was sent to review because it was scanned."""

    vocabulary = build_port_vocabulary(PORT_VALUES)

    queue = ReviewQueue(REVIEW_QUEUE_PATH)

    for case in OCR_CASES:
        documents = {}
        parsed = {}
        flagged = []

        for role, text in case["documents"].items():
            fields = extract_document_fields(text)
            flags = check_fields(fields, vocabulary)

            parsed[role] = fields

            documents[role] = {
                "ocr_text": text,
                "fields": {
                    name: fields[name]
                    for name in OCR_CHECKED_FIELDS
                    if name in fields
                },
                "flags": flags,
            }

            for name in flagged_fields(flags):
                if name not in flagged:
                    flagged.append(name)

        details = {
            "documents": documents,
        }

        # Informational only: where the two OCR readings disagree.
        if "SI" in parsed and "BL" in parsed:
            try:
                mismatches, _ = compare_documents(
                    parsed["SI"],
                    parsed["BL"],
                )

                details["unverified_mismatches"] = [
                    item["field"]
                    for item in mismatches
                ]
            except Exception:
                pass

        queue.add_case(
            case["email_id"],
            "ocr_scan",
            category="BL_COMPARISON",
            fields=flagged,
            details=details,
        )

    queue.save()

    return queue


def process_email(
    email,
    detail=None,
):
    # `detail` is an optional dict the API fills with the extracted
    # fields and comparator output. The batch run leaves it as None.
    email_id = email.get(
        "email_id"
    )

    # ========================================================
    # 0. "Please send the draft BL" requests
    #
    # Nothing is attached and nothing is asked to be compared, so
    # this is a BL_COMPARISON that is OK, not a missing attachment.
    # ========================================================

    if (
        not email.get("attachments")
        and DRAFT_BL_REQUEST_RE.search(
            email.get("body") or ""
        )
    ):
        return make_result(
            email_id,
            "BL_COMPARISON",
            "OK",
        )

    # ========================================================
    # 0b. Automated internal notices (reminder blasts, outstanding
    # lists). They mention SI / BL, so the classifier mistakes them
    # for SI requests or invoice queries, but they are GENERAL.
    # ========================================================

    if INTERNAL_NOTICE_RE.search(
        email.get("body") or ""
    ):
        return make_result(
            email_id,
            "GENERAL",
            "OK",
        )

    # ========================================================
    # 1. Classification
    # ========================================================

    predicted_category = (
        classify_email(
            email
        )
    )

    official_category = (
        CATEGORY_MAP.get(
            predicted_category,
            "GENERAL",
        )
    )

    # --------------------------------------------------------
    # Non-BL emails
    # --------------------------------------------------------

    if (
        official_category
        != "BL_COMPARISON"
    ):
        return make_result(
            email_id,
            official_category,
            "OK",
        )

    return compare_attachments(
        email,
        detail,
    )


def compare_attachments(
    email,
    detail=None,
):
    """Steps 2 onward: read the SI and the BL and compare them.

    process_email runs this for emails classified as BL_COMPARISON.
    The live-check API calls it directly, because an SI and a BL that
    someone uploads are a document check by definition, so no email
    text has to be classified first.
    """

    email_id = email.get(
        "email_id"
    )

    # ========================================================
    # 2. Attachments
    # ========================================================

    attachments = (
        email.get(
            "attachments"
        )
        or []
    )

    si_attachments = (
        find_role_attachments(
            attachments,
            "SI",
        )
    )

    bl_attachments = (
        find_role_attachments(
            attachments,
            "BL",
        )
    )

    if (
        not si_attachments
        or not bl_attachments
    ):
        return make_result(
            email_id,
            "BL_COMPARISON",
            "NEEDS_REVIEW",
            review_reason="missing_attachment",
        )

    # ========================================================
    # 3. Read documents
    # ========================================================

    inbox = CURRENT_INBOX

    si_text, si_error = (
        read_attachment(
            inbox,
            si_attachments[0],
        )
    )

    bl_text, bl_error = (
        read_attachment(
            inbox,
            bl_attachments[0],
        )
    )

    # Scanned (OCR-read) documents are never compared automatically:
    # OCR errors would look like real defects. Keep the OCR text as
    # evidence and send the email to a person.
    if (
        si_error == "scanned"
        or bl_error == "scanned"
    ):
        record_ocr_case(
            email_id,
            {
                role: text
                for role, text, error in (
                    ("SI", si_text, si_error),
                    ("BL", bl_text, bl_error),
                )
                if error == "scanned"
            },
        )

        return make_result(
            email_id,
            "BL_COMPARISON",
            "NEEDS_REVIEW",
            review_reason="unreadable",
        )

    if (
        si_error == "unreadable"
        or bl_error == "unreadable"
    ):
        return make_result(
            email_id,
            "BL_COMPARISON",
            "NEEDS_REVIEW",
            review_reason="unreadable",
        )

    # ========================================================
    # 4. Wrong document type
    # ========================================================

    if (
        is_wrong_document_type(
            si_text
        )
        or is_wrong_document_type(
            bl_text
        )
    ):
        return make_result(
            email_id,
            "BL_COMPARISON",
            "NEEDS_REVIEW",
            review_reason="wrong_doc_type",
        )

    # ========================================================
    # 5. Explicit missing detection
    # ========================================================

    si_explicit_missing = (
        document_has_explicit_missing_value(
            si_text
        )
    )

    bl_explicit_missing = (
        document_has_explicit_missing_value(
            bl_text
        )
    )

    explicit_missing = (
        si_explicit_missing
        or bl_explicit_missing
    )

    # ========================================================
    # 6. Normal extraction
    # ========================================================

    try:
        si_fields = extract_fields(
            si_text
        )
    except Exception:
        si_fields = {}

    try:
        bl_fields = extract_fields(
            bl_text
        )
    except Exception:
        bl_fields = {}

    si_fields = (
        normalise_extracted_fields(
            si_fields
        )
    )

    bl_fields = (
        normalise_extracted_fields(
            bl_fields
        )
    )

    # ========================================================
    # 7. Fallback extraction
    # ========================================================

    si_fallback = (
        fallback_extract_fields(
            si_text
        )
    )

    bl_fallback = (
        fallback_extract_fields(
            bl_text
        )
    )

    si_fields = (
        merge_extracted_fields(
            si_fields,
            si_fallback,
        )
    )

    bl_fields = (
        merge_extracted_fields(
            bl_fields,
            bl_fallback,
        )
    )

    if detail is not None:
        detail["si_fields"] = si_fields
        detail["bl_fields"] = bl_fields

    # Ports both documents state identically become trusted
    # vocabulary for checking OCR-read documents later.
    PORT_VALUES.extend(
        agreed_port_values(
            si_fields,
            bl_fields,
        )
    )

    # ========================================================
    # 8. Compare
    # ========================================================

    try:
        comparison = (
            compare_documents(
                si_fields,
                bl_fields,
            )
        )

        mismatches, missing = (
            normalize_comparison_result(
                comparison
            )
        )

    except Exception:
        return make_result(
            email_id,
            "BL_COMPARISON",
            "NEEDS_REVIEW",
            review_reason="unreadable",
        )

    if detail is not None:
        detail["mismatches"] = mismatches
        detail["missing"] = missing

    # ========================================================
    # 9. Explicit missing comes BEFORE mismatch
    # ========================================================

    if explicit_missing:

        missing_fields = (
            find_missing_required_fields(
                si_fields,
                bl_fields,
            )
        )

        if missing_fields:
            return make_result(
                email_id,
                "BL_COMPARISON",
                "NEEDS_REVIEW",
                review_reason="missing_value",
            )

    # ========================================================
    # 10. Real comparator mismatch
    # ========================================================

    if mismatches:

        defect_fields = (
            extract_defect_fields(
                mismatches
            )
        )

        return make_result(
            email_id,
            "BL_COMPARISON",
            "MISMATCH",
            has_defect=True,
            defect_fields=defect_fields,
        )

    # ========================================================
    # 11. Comparator-only missing
    # ========================================================

    if missing:
        return make_result(
            email_id,
            "BL_COMPARISON",
            "OK",
        )

    # ========================================================
    # 12. Perfect match
    # ========================================================

    return make_result(
        email_id,
        "BL_COMPARISON",
        "OK",
    )


# ============================================================
# Main
# ============================================================

def main():

    global CURRENT_INBOX

    CURRENT_INBOX = Inbox(
        str(BASE_DIR)
    )

    PORT_VALUES.clear()
    OCR_CASES.clear()

    emails = (
        CURRENT_INBOX.emails()
    )

    results = []

    for email in emails:

        results.append(
            process_email(
                email
            )
        )

    # ========================================================
    # results.json
    # ========================================================

    RESULTS_PATH.write_text(
        json.dumps(
            results,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # ========================================================
    # submission.json
    # ========================================================

    submission = {}

    for result in results:

        email_id = result[
            "email_id"
        ]

        submission[email_id] = {
            key: value
            for key, value
            in result.items()
            if key != "email_id"
        }

    SUBMISSION_PATH.write_text(
        json.dumps(
            submission,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print(
        f"Processed {len(results)} emails"
    )

    print(
        f"Results written to: {RESULTS_PATH}"
    )

    print(
        f"Submission written to: {SUBMISSION_PATH}"
    )

    # The review queue is extra evidence for reviewers; a problem
    # here must never affect the submission above.
    try:
        queue = build_review_queue()

        print(
            f"Review queue written to: {REVIEW_QUEUE_PATH} "
            f"({len(queue.items)} scanned emails)"
        )

    except Exception as exc:
        print(
            f"Review queue not written: {exc}",
            file=sys.stderr,
        )

    run_score()


def run_score():

    score_cli = BASE_DIR / "server" / "score_cli.py"

    if not score_cli.exists():
        score_cli = (
            BASE_DIR.parent
            / "server"
            / "score_cli.py"
        )

    if not score_cli.exists():
        print(
            f"Skipping score: {score_cli} not found"
        )
        return

    subprocess.run(
        [
            sys.executable,
            str(score_cli),
            str(SUBMISSION_PATH),
        ],
        check=False,
    )


if __name__ == "__main__":
    main()