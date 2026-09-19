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


# ============================================================
# Basic normalization
# ============================================================

def normalize_text(value):

    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.upper()


# ============================================================
# Port normalization
# ============================================================

def normalize_port(value):

    value = normalize_text(value)

    if value is None:
        return None

    # Remove UN/LOCODE at the end.
    #
    # Examples:
    #
    # NANTONG, CHINA (CNNTG)
    # -> NANTONG, CHINA
    #
    # TUTICORIN (INTUT)
    # -> TUTICORIN

    value = re.sub(
        r"\s*\([A-Z]{5}\)\s*$",
        "",
        value,
    )

    return value.strip()


# ============================================================
# Weight normalization
# ============================================================

def normalize_weight(value):

    value = normalize_text(value)

    if value is None:
        return None

    # Remove commas.

    value = value.replace(
        ",",
        "",
    )

    # Extract numeric portion.

    match = re.search(
        r"\d+(?:\.\d+)?",
        value,
    )

    if not match:
        return None

    try:

        return float(
            match.group(0)
        )

    except Exception:

        return None


# ============================================================
# Container-count normalization
# ============================================================

def normalize_container_count(value):

    value = normalize_text(value)

    if value is None:
        return None

    # Normalize spaces around X.
    #
    # Examples:
    #
    # 10 X 40HC
    # 10X40HC
    #
    # both become:
    #
    # 10X40HC

    value = re.sub(
        r"\s*X\s*",
        "X",
        value,
    )

    return value


# ============================================================
# Field-specific normalization
# ============================================================

def normalize_value(
    field,
    value,
):

    if field in [
        "port_of_loading",
        "port_of_discharge",
    ]:

        return normalize_port(
            value
        )

    if field == "gross_weight":

        return normalize_weight(
            value
        )

    if field == "container_count":

        return normalize_container_count(
            value
        )

    return normalize_text(
        value
    )


# ============================================================
# Document comparison
# ============================================================

def compare_documents(
    si,
    bl,
):

    mismatches = []
    missing_fields = []

    for field in FIELDS:

        si_value = si.get(
            field
        )

        bl_value = bl.get(
            field
        )

        normalized_si = normalize_value(
            field,
            si_value,
        )

        normalized_bl = normalize_value(
            field,
            bl_value,
        )

        si_has_value = (
            normalized_si is not None
        )

        bl_has_value = (
            normalized_bl is not None
        )

        # ----------------------------------------------------
        # BOTH SIDES EMPTY
        #
        # We genuinely cannot compare this field.
        # Keep it as missing.
        # ----------------------------------------------------

        if (
            not si_has_value
            and not bl_has_value
        ):

            missing_fields.append(
                {
                    "field": field,
                    "si": si_value,
                    "bl": bl_value,
                }
            )

            continue

        # ----------------------------------------------------
        # ONLY ONE SIDE HAS A VALUE
        #
        # Example:
        #
        # SI = None
        # BL = TUTICORIN
        #
        # This is a real mismatch.
        #
        # main.py will separately handle explicit
        # missing-value markers such as N/A / TBA / ____.
        # ----------------------------------------------------

        if (
            si_has_value
            != bl_has_value
        ):

            mismatches.append(
                {
                    "field": field,
                    "si": si_value,
                    "bl": bl_value,
                }
            )

            continue

        # ----------------------------------------------------
        # BOTH SIDES HAVE VALUES
        # ----------------------------------------------------

        if normalized_si != normalized_bl:

            mismatches.append(
                {
                    "field": field,
                    "si": si_value,
                    "bl": bl_value,
                }
            )

    return (
        mismatches,
        missing_fields,
    )