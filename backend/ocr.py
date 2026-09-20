#!/usr/bin/env python3

"""Tesseract OCR helpers for attachments that have no text layer.

Nothing here is tied to particular emails or values. If Tesseract or its
Python packages are missing, every function returns "" and a single
warning is printed, so callers fall back to their existing behaviour.

Environment variables:
    TESSERACT_CMD   full path to tesseract(.exe) when it is not on PATH
    OCR_LANG        Tesseract language code(s), default "eng"
    OCR_TIMEOUT     seconds allowed per image, default 60
"""

import os
import shutil
import sys
from io import BytesIO
from pathlib import Path


IMAGE_SUFFIXES = (
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
)

_COMMON_PATHS = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/opt/homebrew/bin/tesseract",
)

_state = {
    "engine": None,
    "checked": False,
    "warned": False,
}


def is_image_path(name):
    return str(name).lower().endswith(IMAGE_SUFFIXES)


def find_tesseract():
    """Return the path of the Tesseract executable, or None."""

    configured = os.getenv("TESSERACT_CMD", "").strip()

    if configured:
        return configured if Path(configured).exists() else None

    found = shutil.which("tesseract")

    if found:
        return found

    for candidate in _COMMON_PATHS:
        if Path(candidate).exists():
            return candidate

    return None


def _warn_once(message):
    if _state["warned"]:
        return

    _state["warned"] = True

    print(
        f"OCR unavailable: {message}",
        file=sys.stderr,
    )


def _engine():
    """Return the configured pytesseract module, or None."""

    if _state["checked"]:
        return _state["engine"]

    _state["checked"] = True

    try:
        import pytesseract
        from PIL import Image  # noqa: F401
    except ImportError as exc:
        _warn_once(
            f"{exc}. Run: pip install pytesseract pillow"
        )
        return None

    command = find_tesseract()

    if not command:
        _warn_once(
            "Tesseract not found. Install it or set TESSERACT_CMD"
        )
        return None

    pytesseract.pytesseract.tesseract_cmd = command
    _state["engine"] = pytesseract

    return pytesseract


def ocr_available():
    return _engine() is not None


def ocr_image(image):
    """OCR one PIL image. Returns stripped text, or "" on any failure."""

    engine = _engine()

    if engine is None:
        return ""

    try:
        if image.mode not in ("L", "RGB"):
            image = image.convert("RGB")

        text = engine.image_to_string(
            image,
            lang=os.getenv("OCR_LANG", "eng"),
            timeout=float(os.getenv("OCR_TIMEOUT", "60")),
        )

    except Exception:
        return ""

    return text.strip()


def ocr_image_bytes(data):
    """OCR the bytes of an image file (png, jpg, tiff, ...)."""

    if _engine() is None:
        return ""

    try:
        from PIL import Image

        return ocr_image(Image.open(BytesIO(data)))

    except Exception:
        return ""


def ocr_pdf_page(page):
    """OCR every image embedded in a pypdf page."""

    if _engine() is None:
        return ""

    try:
        from PIL import Image

        texts = []

        for embedded in page.images:
            text = ocr_image(
                Image.open(BytesIO(embedded.data))
            )

            if text:
                texts.append(text)

        return "\n".join(texts)

    except Exception:
        return ""
