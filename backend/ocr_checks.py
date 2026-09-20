#!/usr/bin/env python3

"""Plausibility checks for fields extracted from OCR text.

These checks never decide OK / MISMATCH. They only tell a reviewer which
OCR-read values look suspicious and why. Everything is rule-based and
generic: the port vocabulary is built at run time from documents that
had a real text layer, not from a fixed list.
"""

import difflib
import re


FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
)

NAME_FIELDS = ("shipper", "consignee", "notify_party")
PORT_FIELDS = ("port_of_loading", "port_of_discharge")

# Characters OCR tends to invent from borders, lines and noise.
_JUNK_CHARS = re.compile(r"[|\\\[\]{}<>_~^`¦�]")

# 128.544 : three digits after a dot is usually a misread "128,544"
_SEPARATOR_SUSPECT = re.compile(r"^\d{1,3}\.\d{3}(?:\s*[a-z]+)?$", re.IGNORECASE)

_WEIGHT = re.compile(
    r"^\d[\d,]*(?:\.\d+)?\s*(?:kgs?|mt|tons?|t)?\.?$",
    re.IGNORECASE,
)


def _flag(field, code, message, suggestion=None):
    flag = {
        "field": field,
        "code": code,
        "message": message,
    }

    if suggestion:
        flag["suggestion"] = suggestion

    return flag


def _compact(value):
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def normalise_port(value):
    """Drop UN/LOCODE suffixes such as "(CNNTG)" and tidy spacing."""

    text = re.sub(r"\([^)]*\)", " ", str(value))
    text = re.sub(r"\s+", " ", text).strip(" ,.-")

    return text.upper()


def build_port_vocabulary(values):
    """Map compact form -> readable port name, from trusted documents."""

    vocabulary = {}

    for value in values:
        if not value:
            continue

        readable = normalise_port(value)
        key = _compact(readable)

        if key:
            vocabulary.setdefault(key, readable)

    return vocabulary


def agreed_port_values(si_fields, bl_fields):
    """Ports that the SI and BL of one email both state identically.

    Only these are trusted as "known" ports: a misspelling in a single
    document must not become part of the vocabulary.
    """

    agreed = []

    for name in PORT_FIELDS:
        si_value = (si_fields or {}).get(name)
        bl_value = (bl_fields or {}).get(name)

        if (
            isinstance(si_value, str)
            and isinstance(bl_value, str)
            and _compact(normalise_port(si_value))
            and _compact(normalise_port(si_value))
            == _compact(normalise_port(bl_value))
        ):
            agreed.append(si_value)

    return agreed


def _check_name(field, value):
    if _JUNK_CHARS.search(value):
        return [
            _flag(
                field,
                "junk_characters",
                "Contains characters that are usually OCR noise",
            )
        ]

    if len(value.strip()) < 2:
        return [
            _flag(field, "too_short", "Value is too short to be a name")
        ]

    return []


def _check_port(field, value, vocabulary):
    if _JUNK_CHARS.search(value):
        return [
            _flag(
                field,
                "junk_characters",
                "Contains characters that are usually OCR noise",
            )
        ]

    if not vocabulary:
        return []

    key = _compact(normalise_port(value))

    if key in vocabulary:
        return []

    close = difflib.get_close_matches(
        key,
        list(vocabulary),
        n=1,
        cutoff=0.8,
    )

    if close:
        return [
            _flag(
                field,
                "port_unrecognised",
                "Not a known port; close to one seen in readable documents",
                suggestion=vocabulary[close[0]],
            )
        ]

    return [
        _flag(
            field,
            "port_unrecognised",
            "Not a port seen in any readable document",
        )
    ]


def _check_container_count(field, value):
    if not re.match(r"^\s*\d+", value):
        return [
            _flag(
                field,
                "not_numeric",
                "Container count does not start with a number",
            )
        ]

    return []


def _check_gross_weight(field, value):
    text = value.strip()

    if not _WEIGHT.match(text):
        return [
            _flag(
                field,
                "not_numeric",
                "Weight is not a number followed by an optional unit",
            )
        ]

    if _SEPARATOR_SUSPECT.match(text):
        return [
            _flag(
                field,
                "separator_suspect",
                "Dot before exactly three digits may be a misread comma",
            )
        ]

    return []


def check_fields(fields, port_vocabulary=None):
    """Return a list of flags for one OCR'd document's extracted fields."""

    flags = []
    fields = fields or {}

    for name in FIELDS:
        value = fields.get(name)

        if value in (None, ""):
            flags.append(
                _flag(name, "not_found", "Field not found in OCR text")
            )
            continue

        value = str(value)

        if name in NAME_FIELDS:
            flags.extend(_check_name(name, value))
        elif name in PORT_FIELDS:
            flags.extend(_check_port(name, value, port_vocabulary))
        elif name == "container_count":
            flags.extend(_check_container_count(name, value))
        elif name == "gross_weight":
            flags.extend(_check_gross_weight(name, value))

    return flags


def flagged_fields(flags):
    """Unique field names in the order they were flagged."""

    names = []

    for flag in flags:
        if flag["field"] not in names:
            names.append(flag["field"])

    return names
