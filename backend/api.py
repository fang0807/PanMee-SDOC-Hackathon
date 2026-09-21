"""HTTP API around the SI-vs-BL pipeline in main.py.

Run locally:   uvicorn api:app --port 8000
Environment:   ALLOWED_ORIGINS  comma-separated origins allowed by CORS
"""

import json
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
from ui_records import build_fields
from autoreply_bridge import handle_verification_autoreply


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

UI_DATA_PATH = Path(__file__).resolve().parent / "ui_data.json"


def load_ui_emails():
    if not UI_DATA_PATH.exists():
        return []

    return json.loads(UI_DATA_PATH.read_text(encoding="utf-8"))


UI_EMAILS = load_ui_emails()


app = FastAPI(title="SmartDoc SI/BL checker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS",
            (
                "http://localhost:5173,http://127.0.0.1:5173,"
                "http://localhost:5174,http://127.0.0.1:5174"
            ),
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


@app.get("/api/emails")
def list_emails():
    """The pipeline results for the sample inbox (see export_ui_data.py)."""

    return UI_EMAILS


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

        # IMPORTANT: verification must run first so `result` exists
        # before the standalone Auto Reply plugin is called.
        result, detail = await run_in_threadpool(
            run_pipeline,
            email,
            workdir,
        )

        # Auto Reply is intentionally non-blocking for verification.
        # If SMTP/plugin configuration fails, users still receive the
        # document-comparison result instead of a 500 response.
        try:
            auto_reply = await run_in_threadpool(
                handle_verification_autoreply,
                email,
                result,
            )
        except Exception as exc:
            auto_reply = {
                "ok": False,
                "email_id": result.get("email_id") or email_id,
                "status": result.get("status"),
                "action": "ERROR",
                "reason": f"Auto Reply failed: {type(exc).__name__}: {exc}",
            }

        return {
            **result,
            "fields": build_fields(result, detail),
            "auto_reply": auto_reply,
        }

    finally:
        shutil.rmtree(workdir, ignore_errors=True)
