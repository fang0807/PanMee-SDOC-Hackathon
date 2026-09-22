"""HTTP API around the SI-vs-BL pipeline in main.py.

Run locally:   uvicorn api:app --port 8000
Environment:   ALLOWED_ORIGINS  comma-separated origins allowed by CORS
"""

import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openpyxl import load_workbook

import main as pipeline
from loader import Inbox
from ui_records import build_fields
from autoreply_bridge import (
    get_verification_autoreply_state,
    handle_verification_autoreply,
)
from gmail_receiver import (
    GmailInboxStore,
    GmailReceiver,
    receiver_enabled_from_env,
)


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

# The original SI / BL files of the sample inbox, named
# {email_id}_{SI|BL}.{extension}.
ATTACHMENTS_DIR = Path(__file__).resolve().parent / "attachments"

EMAIL_ID_PATTERN = re.compile(r"(?:email_\d{1,6}|gmail_[a-f0-9]{12})")
ATTACHMENT_ROLES = {"SI", "BL"}

# The Excel preview is a table, so very large sheets are cut short.
MAX_SHEET_ROWS = 300
MAX_SHEET_COLUMNS = 30


def load_ui_emails():
    if not UI_DATA_PATH.exists():
        return []

    return json.loads(UI_DATA_PATH.read_text(encoding="utf-8"))


UI_EMAILS = load_ui_emails()

# Customer emails received from Gmail are persisted outside the bundled
# sample dataset so git/deploy updates never overwrite them.
GMAIL_RUNTIME_DIR = Path(
    os.getenv(
        "GMAIL_RECEIVER_DATA_DIR",
        str(Path(__file__).resolve().parent / "runtime_gmail"),
    )
)
GMAIL_STORE = GmailInboxStore(GMAIL_RUNTIME_DIR)
GMAIL_RECEIVER = None


def all_ui_emails():
    """Bundled sample records plus Gmail-received customer records."""

    runtime_records = GMAIL_STORE.list_records()
    runtime_ids = {record.get("id") for record in runtime_records}
    return runtime_records + [record for record in UI_EMAILS if record.get("id") not in runtime_ids]


def search_text(record):
    """Everything a person might type to find this email, lower-cased.

    Covers the id, subject, sender, body (shipment and booking numbers
    appear there), document type, category and the SI / BL field values.
    """

    parts = [
        record.get("id", ""),
        record.get("subject", ""),
        record.get("sender", ""),
        record.get("senderName", ""),
        record.get("body", ""),
        record.get("docType", ""),
        record.get("workflowType", ""),
        record.get("workflowSubtype", ""),
        record.get("category", ""),
    ]

    for field in record.get("fields") or []:
        parts.append(field["si"])
        parts.append(field["bl"])

    return " ".join(str(part) for part in parts if part).lower()


MAX_SEARCH_IDS = 1000


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


@app.on_event("startup")
def start_gmail_receiver():
    """Start optional Gmail polling without blocking the API."""

    global GMAIL_RECEIVER
    GMAIL_RECEIVER = GmailReceiver.from_env(GMAIL_STORE, PIPELINE_LOCK)
    if receiver_enabled_from_env():
        try:
            GMAIL_RECEIVER.start()
        except Exception as exc:
            # Keep the verification API available even if Gmail credentials or
            # connectivity are wrong.  /api/gmail-receiver/status exposes it.
            GMAIL_RECEIVER.last_error = f"{type(exc).__name__}: {exc}"


@app.on_event("shutdown")
def stop_gmail_receiver():
    if GMAIL_RECEIVER is not None:
        GMAIL_RECEIVER.stop()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/gmail-receiver/status")
def gmail_receiver_status():
    receiver = GMAIL_RECEIVER or GmailReceiver.from_env(GMAIL_STORE, PIPELINE_LOCK)
    return {
        "enabled": receiver_enabled_from_env(),
        **receiver.status(),
    }


@app.post("/api/gmail-receiver/poll")
async def gmail_receiver_poll():
    """Run one Gmail poll immediately (useful for testing/demo)."""

    global GMAIL_RECEIVER
    if GMAIL_RECEIVER is None:
        GMAIL_RECEIVER = GmailReceiver.from_env(GMAIL_STORE, PIPELINE_LOCK)
    try:
        imported = await run_in_threadpool(GMAIL_RECEIVER.poll_once)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Gmail Receiver failed: {type(exc).__name__}: {exc}",
        )
    return {"ok": True, "imported": imported, **GMAIL_RECEIVER.status()}


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

        # No classification: an uploaded SI + BL is a document check.
        result = pipeline.compare_attachments(email, detail)

    return result, detail


def ui_email_with_autoreply(record):
    item = dict(record)
    auto_reply = get_verification_autoreply_state(record.get("id", ""))
    if auto_reply:
        item["autoReply"] = auto_reply
    return item


@app.get("/api/emails")
def list_emails():
    """All recorded emails, including Gmail-received customer mail."""

    return [ui_email_with_autoreply(record) for record in all_ui_emails()]


def find_ui_email(email_id):
    for record in all_ui_emails():
        if record.get("id") == email_id:
            return record
    raise HTTPException(status_code=404, detail="Email not found.")


@app.post("/api/emails/{email_id}/verify")
async def verify_sample_email(email_id: str):
    """Confirm one sample-inbox SI/BL verification and run Auto Reply.

    The sample inbox already contains the pipeline result exported in ui_data.json.
    Clicking Verify is therefore the workflow event that confirms that result and
    hands it to the standalone Auto Reply plugin.  This avoids re-reading the
    same sample files while still keeping sending behind an explicit verification
    action.
    """

    record = find_ui_email(email_id)

    if record.get("category") != "BL_COMPARISON":
        raise HTTPException(
            status_code=400,
            detail="Only BL_COMPARISON emails can be verified here.",
        )

    # A draft-BL request is kept under BL_COMPARISON by the benchmark schema,
    # but it is not an SI-vs-BL document comparison and must never trigger the
    # verification/Auto Reply workflow.  The frontend routes it to Others as
    # "BL Request"; keep the API safe if it is called directly.
    if record.get("workflowType") == "BL_REQUEST":
        raise HTTPException(
            status_code=400,
            detail="BL request emails do not contain an SI/BL pair to verify.",
        )

    result = {
        "email_id": record["id"],
        "category": record["category"],
        "status": record["status"],
        "has_defect": bool(record.get("defectFields")),
        "defect_fields": list(record.get("defectFields") or []),
        "review_reason": record.get("reviewReason"),
    }
    email = {
        "email_id": record["id"],
        "from": record.get("sender", ""),
        "sender": record.get("sender", ""),
        "subject": record.get("subject", ""),
        "body": record.get("body", ""),
        "attachments": [],
    }

    try:
        auto_reply = await run_in_threadpool(
            handle_verification_autoreply,
            email,
            result,
        )
    except Exception as exc:
        auto_reply = {
            "ok": False,
            "email_id": email_id,
            "status": result.get("status"),
            "action": "ERROR",
            "reason": f"Auto Reply failed: {type(exc).__name__}: {exc}",
        }

    return {
        **result,
        "fields": record.get("fields") or [],
        "auto_reply": auto_reply,
    }


@app.get("/api/emails/search")
def search_emails(
    q: str = Query("", max_length=200),
    status: Optional[Literal["OK", "MISMATCH", "NEEDS_REVIEW"]] = None,
    category: Optional[
        Literal[
            "BL_COMPARISON",
            "SI_REQUEST",
            "INVOICE_QUERY",
            "GENERAL",
            "SPAM",
        ]
    ] = None,
    ids: Optional[str] = Query(None, max_length=20000),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Search the sample inbox.

    q         words to find; an email must contain every word (any case)
              in its id, subject, sender, body or SI / BL field values.
    status    OK, MISMATCH or NEEDS_REVIEW.
    category  BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL or SPAM.
    ids       comma-separated email ids to search within. The server keeps
              no review or resend queue, so a caller that has one (for
              example the resend queue) passes its ids here.

    Returns {"total", "limit", "offset", "results"}; results use the same
    records as GET /api/emails, in inbox order.
    """

    words = q.lower().split()
    wanted_ids = None

    if ids is not None:
        wanted_ids = {part.strip() for part in ids.split(",") if part.strip()}

        if len(wanted_ids) > MAX_SEARCH_IDS:
            raise HTTPException(
                status_code=400,
                detail=f"Pass at most {MAX_SEARCH_IDS} ids.",
            )

    records = all_ui_emails()
    matches = [
        record
        for record in records
        if (wanted_ids is None or record["id"] in wanted_ids)
        and (status is None or record["status"] == status)
        and (category is None or record["category"] == category)
        and all(word in search_text(record) for word in words)
    ]

    return {
        "total": len(matches),
        "limit": limit,
        "offset": offset,
        "results": [ui_email_with_autoreply(record) for record in matches[offset:offset + limit]],
    }


def find_attachment(email_id, role):
    """The original SI or BL file of a sample email.

    The id and role are checked before they touch the file system, so a
    request can never name a path outside ATTACHMENTS_DIR.
    """

    if (
        not EMAIL_ID_PATTERN.fullmatch(email_id)
        or role not in ATTACHMENT_ROLES
    ):
        raise HTTPException(status_code=404, detail="Attachment not found.")

    matches = sorted(ATTACHMENTS_DIR.glob(f"{email_id}_{role}.*"))
    if not matches:
        matches = sorted(GMAIL_STORE.attachments_dir.glob(f"{email_id}_{role}.*"))

    if not matches:
        raise HTTPException(
            status_code=404,
            detail=f"{email_id} has no {role} attachment.",
        )

    return matches[0]


# Declared here because the slim Docker image has no system MIME table.
MEDIA_TYPES = {
    ".txt": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
    ".docx": (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ),
    ".xlsx": (
        "application/vnd.openxmlformats-officedocument"
        ".spreadsheetml.sheet"
    ),
}


def media_type_for(path):
    return (
        MEDIA_TYPES.get(path.suffix.lower())
        or mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )


def read_sheets(path):
    """The cells of an Excel file, one table per sheet."""

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheets = []

    try:
        for sheet in workbook.worksheets:
            rows = []
            truncated = False

            for row in sheet.iter_rows(values_only=True):
                cells = [
                    "" if value is None else str(value)
                    for value in row[:MAX_SHEET_COLUMNS]
                ]

                if not any(cells):
                    continue

                if len(rows) >= MAX_SHEET_ROWS:
                    truncated = True
                    break

                rows.append(cells)

            width = max((len(row) for row in rows), default=0)

            sheets.append(
                {
                    "name": sheet.title,
                    "rows": [row + [""] * (width - len(row)) for row in rows],
                    "truncated": truncated,
                }
            )
    finally:
        workbook.close()

    return sheets


@app.get("/api/emails/{email_id}/attachments/{role}/file")
def attachment_file(email_id: str, role: str, download: bool = False):
    """The original attachment, shown in the page or saved when download=1."""

    path = find_attachment(email_id, role)

    return FileResponse(
        path,
        media_type=media_type_for(path),
        filename=path.name,
        content_disposition_type="attachment" if download else "inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/emails/{email_id}/attachments/{role}/text")
async def attachment_text(email_id: str, role: str):
    """The text the pipeline reads from the attachment (OCR for scans)."""

    path = find_attachment(email_id, role)

    # The same reader the pipeline uses, so this is exactly what it saw.
    text, flag = await run_in_threadpool(
        pipeline.read_attachment,
        Inbox(str(ATTACHMENTS_DIR.parent)),
        f"attachments/{path.name}",
    )

    return {
        "filename": path.name,
        "extension": path.suffix.lower(),
        "text": text or "",
        "ocr": flag == "scanned",
        "unreadable": text is None,
    }


@app.get("/api/emails/{email_id}/attachments/{role}/sheet")
async def attachment_sheet(email_id: str, role: str):
    """The cells of an Excel attachment, for showing it as a table."""

    path = find_attachment(email_id, role)

    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HTTPException(status_code=400, detail="Not an Excel file.")

    try:
        sheets = await run_in_threadpool(read_sheets, path)
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="This Excel file could not be read.",
        )

    return {"filename": path.name, "sheets": sheets}


@app.post("/api/process")
async def process(
    subject: str = Form(""),
    body: str = Form(""),
    sender: str = Form(""),
    si: UploadFile = File(...),
    bl: UploadFile = File(...),
):
    """Compare an uploaded SI and BL.

    An upload of the two documents is a document check by definition, so
    classification is skipped. Subject/body/sender metadata are accepted
    so the standalone Auto Reply plugin can address the original sender.
    """

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
            "sender": sender,
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
