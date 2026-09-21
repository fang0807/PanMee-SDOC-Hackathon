"""HTTP API around the SI-vs-BL pipeline in main.py.

Run locally:   uvicorn api:app --port 8000
Environment:   ALLOWED_ORIGINS  comma-separated origins allowed by CORS
"""

import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

import main as pipeline
from loader import Inbox


MAX_UPLOAD_BYTES = 10 * 1024 * 1024

ALLOWED_SUFFIXES = {
    ".txt",
    ".pdf",
    ".docx",
    ".xlsx",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
}

# The pipeline keeps its state in module globals (CURRENT_INBOX,
# PORT_VALUES, OCR_CASES), so only one request may use it at a time.
PIPELINE_LOCK = threading.Lock()

# Field order and the names used in defect_fields.
FIELD_ORDER = [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight",
]


app = FastAPI(title="SmartDoc SI/BL checker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


async def save_upload(upload, target_dir, email_id, role):
    suffix = Path(upload.filename or "").suffix.lower()

    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{role} file type '{suffix or 'unknown'}' is not "
                f"supported. Use: {', '.join(sorted(ALLOWED_SUFFIXES))}"
            ),
        )

    data = await upload.read(MAX_UPLOAD_BYTES + 1)

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"{role} file is larger than 10 MB.",
        )

    if not data:
        raise HTTPException(
            status_code=400,
            detail=f"{role} file is empty.",
        )

    # The pipeline finds the SI and BL by the role token in the
    # filename, so the upload is stored under a name that has it.
    path = target_dir / f"{email_id}_{role}{suffix}"
    path.write_bytes(data)

    return str(path)


def run_pipeline(email, workdir):
    detail = {}

    with PIPELINE_LOCK:
        pipeline.CURRENT_INBOX = Inbox(str(workdir))
        pipeline.PORT_VALUES.clear()
        pipeline.OCR_CASES.clear()

        result = pipeline.process_email(email, detail)

    return result, detail


def build_fields(result, detail):
    """Per-field table for the UI: values from each document and a verdict."""

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


@app.post("/api/process")
async def process(
    subject: str = Form(""),
    body: str = Form(""),
    sender: str = Form(""),
    si: UploadFile = File(...),
    bl: UploadFile = File(...),
):
    email_id = f"live_{uuid.uuid4().hex[:8]}"
    workdir = Path(tempfile.mkdtemp(prefix="smartdoc_"))

    try:
        attachments = [
            await save_upload(si, workdir, email_id, "SI"),
            await save_upload(bl, workdir, email_id, "BL"),
        ]

        email = {
            "email_id": email_id,
            "from": sender,
            "subject": subject,
            "body": body,
            "attachments": attachments,
        }

        result, detail = await run_in_threadpool(
            run_pipeline,
            email,
            workdir,
        )

        return {
            **result,
            "fields": build_fields(result, detail),
        }

    finally:
        shutil.rmtree(workdir, ignore_errors=True)
