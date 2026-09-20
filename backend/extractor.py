import re


FIELDS = [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
]


FIELD_LABELS = [
    "shipper",
    "shipper/exporter",
    "shipper (principal or seller)",
    "consignee",
    "consignee (non-negotiable)",
    "notify",
    "notify party",
    "port of loading",
    "port of loading (pol)",
    "loading port",
    "pol",
    "discharge port",
    "port of discharge",
    "destination port",
    "pod",
    "container count",
    "total containers",
    "containers",
    "no. of containers",
    "no. of containers or packages",
    "gross weight",
    "gross wt",
    "gross weight毛重(kgs)",
]


def clean_value(value):
    if not value:
        return None

    value = value.strip()
    value = re.sub(r"\s+", " ", value)

    # Treat placeholders as missing / unreadable
    if value.lower() in ["n/a", "na", "none", "unknown", "-", "--"]:
        return None

    if re.fullmatch(r"_+", value):
        return None

    if re.fullmatch(r"_+[a-zA-Z]*", value):
        return None

    # If the extracted value is actually another field label,
    # treat it as missing.
    lower = value.lower().strip()

    for label in FIELD_LABELS:
        if lower.startswith(label + ":"):
            return None

    return value


def extract_line_value(text, patterns, validate=None):
    for pattern in patterns:
        match = re.search(
            pattern,
            text,
            re.IGNORECASE | re.MULTILINE
        )

        if match:
            value = clean_value(match.group(1))
            if value and (validate is None or validate(value)):
                return value

    return None


def looks_like_weight(value):
    # A weight starts with a number ("23,702 KG", "243588"). This rejects
    # container IDs such as "GLBV3136502" that sit under a
    # "GROSS WEIGHT (KG)" table header in PDF text.
    return bool(re.match(r"^\d[\d,]*(?:\.\d+)?\s*(?:kgs?\b|$)", value.strip(), re.IGNORECASE))


def extract_fields(text):
    fields = {}

    # --------------------------------------------------
    # Shipper
    # --------------------------------------------------

    fields["shipper"] = extract_line_value(
    text,
    [
        r"^\s*Shipper/Exporter\s*:\s*(.+)$",
        r"^\s*Shipper\s*\(Principal or Seller\)\s*:\s*(.+)$",
        r"^\s*SHIPPER\s*:\s*(.+)$",

        # label | value
        r"^\s*Shipper/Exporter\s*\|\s*(.+)$",
        r"^\s*Shipper\s*\(Principal or Seller\)\s*\|\s*(.+)$",
        r"^\s*SHIPPER\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*Shipper/Exporter\s*$\n\s*(.+)$",
        r"^\s*Shipper\s*\(Principal or Seller\)\s*$\n\s*(.+)$",
        r"^\s*SHIPPER\s*$\n\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Consignee
    # --------------------------------------------------

    fields["consignee"] = extract_line_value(
    text,
    [
        r"^\s*CONSIGNEE\s*:\s*(.+)$",
        r"^\s*Consignee\s*\(Non-Negotiable\)\s*:\s*(.+)$",

        # label | value
        r"^\s*CONSIGNEE\s*\|\s*(.+)$",
        r"^\s*Consignee\s*\(Non-Negotiable\)\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*CONSIGNEE\s*$\n\s*(.+)$",
        r"^\s*Consignee\s*\(Non-Negotiable\)\s*$\n\s*(.+)$",
        r"^\s*To the Order of\s*:\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Notify Party
    # --------------------------------------------------

    fields["notify_party"] = extract_line_value(
    text,
    [
        r"^\s*NOTIFY PARTY\s*:\s*(.+)$",
        r"^\s*NOTIFY\s*:\s*(.+)$",
        r"^\s*Notify Party\s*:\s*(.+)$",
        r"^\s*Notify Party/Intermediate Consignee\s*:\s*(.+)$",

        # label | value
        r"^\s*NOTIFY PARTY\s*\|\s*(.+)$",
        r"^\s*NOTIFY\s*\|\s*(.+)$",
        r"^\s*Notify Party\s*\|\s*(.+)$",
        r"^\s*Notify Party/Intermediate Consignee\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*NOTIFY PARTY\s*$\n\s*(.+)$",
        r"^\s*NOTIFY\s*$\n\s*(.+)$",
        r"^\s*Notify Party\s*$\n\s*(.+)$",
        r"^\s*Notify Party/Intermediate Consignee\s*$\n\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Port of Loading
    # --------------------------------------------------

    fields["port_of_loading"] = extract_line_value(
    text,
    [
        r"^\s*Port of Loading\s*(?:\(POL\))?\s*:\s*(.+)$",
        r"^\s*PORT OF LOADING\s*:\s*(.+)$",
        r"^\s*POL\s*:\s*(.+)$",
        r"^\s*Loading Port\s*:\s*(.+)$",
        r"^\s*Load Port\s*:\s*(.+)$",

        # label | value
        r"^\s*Port of Loading\s*(?:\(POL\))?\s*\|\s*(.+)$",
        r"^\s*PORT OF LOADING\s*\|\s*(.+)$",
        r"^\s*POL\s*\|\s*(.+)$",
        r"^\s*Loading Port\s*\|\s*(.+)$",
        r"^\s*Load Port\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*Port of Loading\s*(?:\(POL\))?\s*$\n\s*(.+)$",
        r"^\s*POL\s*$\n\s*(.+)$",
        r"^\s*Load Port\s*$\n\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Port of Discharge
    # --------------------------------------------------

    fields["port_of_discharge"] = extract_line_value(
    text,
    [
        r"^\s*Discharge Port\s*:\s*(.+)$",
        r"^\s*Port of Discharge\s*:\s*(.+)$",
        r"^\s*POD\s*:\s*(.+)$",
        r"^\s*Destination Port\s*:\s*(.+)$",

        # label | value
        r"^\s*Discharge Port\s*\|\s*(.+)$",
        r"^\s*Port of Discharge\s*\|\s*(.+)$",
        r"^\s*POD\s*\|\s*(.+)$",
        r"^\s*Destination Port\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*Discharge Port\s*$\n\s*(.+)$",
        r"^\s*Port of Discharge\s*$\n\s*(.+)$",
        r"^\s*POD\s*$\n\s*(.+)$",
        r"^\s*Destination Port\s*$\n\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Container Count
    # --------------------------------------------------

    fields["container_count"] = extract_line_value(
    text,
    [
        r"^\s*No\.?\s*of Containers or Packages\s*:\s*(.+)$",
        r"^\s*Container Count\s*:\s*(.+)$",
        r"^\s*No\.?\s*of Containers\s*:\s*(.+)$",
        r"^\s*Total Containers\s*:\s*(.+)$",
        r"^\s*Containers\s*:\s*(.+)$",

        # label | value
        r"^\s*No\.?\s*of Containers or Packages\s*\|\s*(.+)$",
        r"^\s*Container Count\s*\|\s*(.+)$",
        r"^\s*No\.?\s*of Containers\s*\|\s*(.+)$",
        r"^\s*Total Containers\s*\|\s*(.+)$",
        r"^\s*Containers\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*No\.?\s*of Containers or Packages\s*$\n\s*(.+)$",
        r"^\s*Container Count\s*$\n\s*(.+)$",
        r"^\s*No\.?\s*of Containers\s*$\n\s*(.+)$",
        r"^\s*Total Containers\s*$\n\s*(.+)$",
        r"^\s*Containers\s*$\n\s*(.+)$",
    ]
)

    # --------------------------------------------------
    # Gross Weight
    # --------------------------------------------------

    fields["gross_weight"] = extract_line_value(
    text,
    [
        # PDF totals line; tolerates stray glyphs before the colon,
        # e.g. "TOTAL Gross Weight■■(KGS): 23,702 KG"
        r"^\s*TOTAL\s+Gross\s+(?:Weight|Wt)[^:|\n]*[:|]\s*(.+)$",

        r"^\s*Gross Weight\s*(?:\(KG\))?\s*:\s*(.+)$",
        r"^\s*GROSS WEIGHT\s*:\s*(.+)$",
        r"^\s*Gross Wt\s*(?:\(kgs\))?\s*:\s*(.+)$",
        r"^\s*Gross Weight毛重\s*(?:\(KGS\))?\s*:\s*(.+)$",
        r"^\s*TOTAL Gross Wt\s*(?:\(kgs\))?\s*:\s*(.+)$",
        r"^\s*TOTAL Gross Weight\s*(?:\(KG\))?\s*:\s*(.+)$",

        # label | value
        r"^\s*Gross Weight\s*(?:\(KG\))?\s*\|\s*(.+)$",
        r"^\s*GROSS WEIGHT\s*\|\s*(.+)$",
        r"^\s*Gross Wt\s*(?:\(kgs\))?\s*\|\s*(.+)$",
        r"^\s*Gross Weight毛重\s*(?:\(KGS\))?\s*\|\s*(.+)$",
        r"^\s*TOTAL Gross Wt\s*(?:\(kgs\))?\s*\|\s*(.+)$",
        r"^\s*TOTAL Gross Weight\s*(?:\(KG\))?\s*\|\s*(.+)$",

        # label and value on separate lines
        r"^\s*Gross Weight\s*(?:\(KG\))?\s*$\n\s*(.+)$",
        r"^\s*Gross Wt\s*(?:\(kgs\))?\s*$\n\s*(.+)$",
        r"^\s*Gross Weight毛重\s*(?:\(KGS\))?\s*$\n\s*(.+)$",
    ],
    validate=looks_like_weight,
)
    # Remove None values
    return {
        key: value
        for key, value in fields.items()
        if value is not None
    }