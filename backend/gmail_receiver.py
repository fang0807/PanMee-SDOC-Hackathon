"""Background Gmail IMAP receiver for SmartDoc.

The receiver is intentionally separate from the classification/verification core.
It downloads new customer messages, stores the raw email + supported attachments,
runs the existing pipeline once, and persists a UI record.  The FastAPI layer can
then merge these records with the bundled sample inbox.

Environment variables:
  GMAIL_RECEIVER_ENABLED=1
  GMAIL_RECEIVER_USERNAME=receiver@gmail.com
  GMAIL_RECEIVER_APP_PASSWORD=<Google app password>
  GMAIL_RECEIVER_POLL_SECONDS=30
  GMAIL_RECEIVER_FOLDER=INBOX
  GMAIL_RECEIVER_SEARCH=UNSEEN
  GMAIL_RECEIVER_MAX_PER_POLL=25
  GMAIL_RECEIVER_MARK_SEEN=1
  GMAIL_RECEIVER_IGNORE_SELF=1
  GMAIL_RECEIVER_HOST=imap.gmail.com

If receiver username/password are omitted, the Auto Reply SMTP credentials are
used as a fallback so one Gmail account can both receive and send.
"""

from __future__ import annotations

import hashlib
import html
import imaplib
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime, parseaddr
from pathlib import Path
from typing import Callable, Optional

import main as pipeline
from loader import Inbox
from ui_records import make_ui_record

SUPPORTED_SUFFIXES = {
    ".txt", ".pdf", ".docx", ".xlsx",
    ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp",
}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


class _HTMLText:
    TAG_RE = re.compile(r"<[^>]+>")
    SPACE_RE = re.compile(r"[ \t]+")
    NL_RE = re.compile(r"\n{3,}")

    @classmethod
    def clean(cls, value: str) -> str:
        value = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value or "")
        value = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", value)
        value = cls.TAG_RE.sub(" ", value)
        value = html.unescape(value)
        value = cls.SPACE_RE.sub(" ", value)
        value = cls.NL_RE.sub("\n\n", value)
        return value.strip()


def _safe_filename(name: str) -> str:
    name = Path(name or "attachment").name
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" .")
    return name or "attachment"


def _format_received(msg: EmailMessage) -> str:
    try:
        dt = parsedate_to_datetime(str(msg.get("Date", "")))
        if dt is None:
            raise ValueError
        dt = dt.astimezone()
    except Exception:
        dt = datetime.now().astimezone()

    hour = dt.hour % 12 or 12
    ampm = "AM" if dt.hour < 12 else "PM"
    return f"{dt.day} {dt.strftime('%b')}, {hour}:{dt.minute:02d} {ampm}"


def _extract_body(msg: EmailMessage) -> str:
    body_part = None
    try:
        body_part = msg.get_body(preferencelist=("plain", "html"))
    except Exception:
        pass

    if body_part is not None:
        try:
            value = body_part.get_content()
        except Exception:
            payload = body_part.get_payload(decode=True) or b""
            value = payload.decode(body_part.get_content_charset() or "utf-8", errors="replace")
        return _HTMLText.clean(value) if body_part.get_content_type() == "text/html" else str(value).strip()

    # Compatibility fallback for unusual multipart messages.
    chunks = []
    for part in msg.walk():
        if part.get_content_disposition() == "attachment":
            continue
        if part.get_content_type() not in {"text/plain", "text/html"}:
            continue
        try:
            value = part.get_content()
        except Exception:
            value = (part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", errors="replace")
        chunks.append(_HTMLText.clean(value) if part.get_content_type() == "text/html" else str(value).strip())
    return "\n\n".join(x for x in chunks if x).strip()


@dataclass
class ParsedIncomingEmail:
    sender: str
    sender_name: str
    subject: str
    body: str
    received: str
    message_id: str
    attachments: list[tuple[str, bytes]]


def parse_rfc822(raw: bytes) -> ParsedIncomingEmail:
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    sender_name, sender = parseaddr(str(msg.get("From", "")))
    attachments: list[tuple[str, bytes]] = []

    for part in msg.iter_attachments():
        filename = _safe_filename(part.get_filename() or "attachment")
        suffix = Path(filename).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            continue
        data = part.get_payload(decode=True) or b""
        if not data or len(data) > MAX_ATTACHMENT_BYTES:
            continue
        attachments.append((filename, data))

    return ParsedIncomingEmail(
        sender=sender.strip(),
        sender_name=(sender_name or sender.split("@")[0] or "Customer").strip(),
        subject=str(msg.get("Subject", "")).strip(),
        body=_extract_body(msg),
        received=_format_received(msg),
        message_id=str(msg.get("Message-ID", "")).strip(),
        attachments=attachments,
    )


class GmailInboxStore:
    """Small file-backed store for received Gmail records and attachments."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.inbox_dir = self.root / "inbox"
        self.attachments_dir = self.root / "attachments"
        self.records_dir = self.root / "records"
        self.raw_dir = self.root / "raw"
        self.state_path = self.root / "state.json"
        self._lock = threading.RLock()
        for folder in (self.inbox_dir, self.attachments_dir, self.records_dir, self.raw_dir):
            folder.mkdir(parents=True, exist_ok=True)

    def _state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return {"processed": []}

    def is_processed(self, key: str) -> bool:
        if not key:
            return False
        with self._lock:
            return key in set(self._state().get("processed") or [])

    def mark_processed(self, key: str) -> None:
        if not key:
            return
        with self._lock:
            state = self._state()
            processed = list(dict.fromkeys([*(state.get("processed") or []), key]))[-5000:]
            state["processed"] = processed
            self.state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def list_records(self) -> list[dict]:
        records = []
        with self._lock:
            for path in sorted(self.records_dir.glob("*.json"), reverse=True):
                try:
                    records.append(json.loads(path.read_text(encoding="utf-8")))
                except Exception:
                    continue
        return records

    def record_for_key(self, key: str) -> Optional[dict]:
        for record in self.list_records():
            if record.get("gmailMessageKey") == key:
                return record
        return None

    def save_record(self, email_id: str, record: dict) -> None:
        with self._lock:
            (self.records_dir / f"{email_id}.json").write_text(
                json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8"
            )

    def save_raw(self, email_id: str, raw: bytes) -> None:
        (self.raw_dir / f"{email_id}.eml").write_bytes(raw)


def _stable_key(parsed: ParsedIncomingEmail, uid: str) -> str:
    if parsed.message_id:
        return f"msgid:{parsed.message_id}"
    return f"uid:{uid}"


def _email_id(key: str) -> str:
    return "gmail_" + hashlib.sha1(key.encode("utf-8", errors="replace")).hexdigest()[:12]


def _save_attachments(store: GmailInboxStore, email_id: str, attachments: list[tuple[str, bytes]]) -> list[str]:
    saved: list[str] = []
    role_counts = {"SI": 0, "BL": 0}

    for index, (original_name, data) in enumerate(attachments, start=1):
        suffix = Path(original_name).suffix.lower()
        role = None
        for candidate in ("SI", "BL"):
            if pipeline.find_role_attachments([original_name], candidate):
                role = candidate
                break

        if role:
            role_counts[role] += 1
            extra = "" if role_counts[role] == 1 else f"_{role_counts[role]}"
            filename = f"{email_id}_{role}{extra}{suffix}"
        else:
            filename = f"{email_id}_ATT_{index}{suffix}"

        path = store.attachments_dir / filename
        path.write_bytes(data)
        saved.append(f"attachments/{filename}")

    return saved


def ingest_rfc822(
    raw: bytes,
    uid: str,
    store: GmailInboxStore,
    pipeline_lock: threading.Lock,
    ignore_sender: str = "",
) -> Optional[dict]:
    """Parse, persist and classify one Gmail RFC822 message."""

    parsed = parse_rfc822(raw)
    key = _stable_key(parsed, uid)

    if store.is_processed(key):
        return store.record_for_key(key)

    if ignore_sender and parsed.sender.lower() == ignore_sender.lower():
        store.mark_processed(key)
        return None

    email_id = _email_id(key)
    attachment_paths = _save_attachments(store, email_id, parsed.attachments)
    email = {
        "email_id": email_id,
        "from": parsed.sender,
        "sender": parsed.sender,
        "subject": parsed.subject,
        "body": parsed.body,
        "attachments": attachment_paths,
    }

    # Keep a source record that the existing Inbox loader can understand.
    (store.inbox_dir / f"{email_id}.json").write_text(
        json.dumps(email, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    store.save_raw(email_id, raw)

    detail: dict = {}
    with pipeline_lock:
        pipeline.CURRENT_INBOX = Inbox(str(store.root))
        pipeline.PORT_VALUES.clear()
        pipeline.OCR_CASES.clear()
        result = pipeline.process_email(email, detail)

    record = make_ui_record(email, result, detail)
    record.update({
        "received": parsed.received,
        "senderName": parsed.sender_name or record.get("senderName"),
        "source": "gmail",
        "gmailMessageKey": key,
        "gmailUid": str(uid),
    })
    store.save_record(email_id, record)
    store.mark_processed(key)
    return record


class GmailReceiver:
    """Poll Gmail IMAP on a daemon thread and ingest unseen messages."""

    def __init__(
        self,
        store: GmailInboxStore,
        pipeline_lock: threading.Lock,
        username: str,
        app_password: str,
        host: str = "imap.gmail.com",
        folder: str = "INBOX",
        search: str = "UNSEEN",
        poll_seconds: int = 30,
        max_per_poll: int = 25,
        mark_seen: bool = True,
        ignore_self: bool = True,
    ):
        self.store = store
        self.pipeline_lock = pipeline_lock
        self.username = username.strip()
        self.app_password = app_password.replace(" ", "").strip()
        self.host = host
        self.folder = folder
        self.search = search or "UNSEEN"
        self.poll_seconds = max(5, int(poll_seconds))
        self.max_per_poll = max(1, min(100, int(max_per_poll)))
        self.mark_seen = bool(mark_seen)
        self.ignore_self = bool(ignore_self)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.last_error = ""
        self.last_poll_at = ""
        self.last_imported = 0
        self.total_imported = 0

    @classmethod
    def from_env(cls, store: GmailInboxStore, pipeline_lock: threading.Lock) -> "GmailReceiver":
        truthy = lambda name, default="1": os.getenv(name, default).strip().lower() not in {"0", "false", "no", "off", ""}
        username = os.getenv("GMAIL_RECEIVER_USERNAME") or os.getenv("AUTOREPLY_SMTP_USERNAME", "")
        password = os.getenv("GMAIL_RECEIVER_APP_PASSWORD") or os.getenv("AUTOREPLY_SMTP_PASSWORD", "")
        return cls(
            store=store,
            pipeline_lock=pipeline_lock,
            username=username,
            app_password=password,
            host=os.getenv("GMAIL_RECEIVER_HOST", "imap.gmail.com"),
            folder=os.getenv("GMAIL_RECEIVER_FOLDER", "INBOX"),
            search=os.getenv("GMAIL_RECEIVER_SEARCH", "UNSEEN"),
            poll_seconds=int(os.getenv("GMAIL_RECEIVER_POLL_SECONDS", "30")),
            max_per_poll=int(os.getenv("GMAIL_RECEIVER_MAX_PER_POLL", "25")),
            mark_seen=truthy("GMAIL_RECEIVER_MARK_SEEN", "1"),
            ignore_self=truthy("GMAIL_RECEIVER_IGNORE_SELF", "1"),
        )

    @property
    def configured(self) -> bool:
        return bool(self.username and self.app_password)

    def status(self) -> dict:
        return {
            "configured": self.configured,
            "running": bool(self._thread and self._thread.is_alive()),
            "username": self.username,
            "folder": self.folder,
            "search": self.search,
            "pollSeconds": self.poll_seconds,
            "lastPollAt": self.last_poll_at,
            "lastImported": self.last_imported,
            "totalImported": self.total_imported,
            "lastError": self.last_error,
            "storedRecords": len(self.store.list_records()),
        }

    def poll_once(self) -> int:
        if not self.configured:
            raise RuntimeError("Gmail Receiver credentials are not configured.")

        imported = 0
        client = imaplib.IMAP4_SSL(self.host)
        try:
            client.login(self.username, self.app_password)
            typ, _ = client.select(self.folder, readonly=False)
            if typ != "OK":
                raise RuntimeError(f"Could not open Gmail folder {self.folder!r}.")

            typ, data = client.uid("search", None, self.search)
            if typ != "OK":
                raise RuntimeError("Gmail IMAP search failed.")
            uids = (data[0] or b"").split()[-self.max_per_poll:]

            for uid_bytes in uids:
                uid = uid_bytes.decode("ascii", errors="ignore")
                typ, chunks = client.uid("fetch", uid, "(BODY.PEEK[])")
                if typ != "OK":
                    continue
                raw = next((item[1] for item in chunks if isinstance(item, tuple) and len(item) > 1), None)
                if not raw:
                    continue

                before = len(self.store.list_records())
                ingest_rfc822(
                    raw,
                    uid=uid,
                    store=self.store,
                    pipeline_lock=self.pipeline_lock,
                    ignore_sender=self.username if self.ignore_self else "",
                )
                after = len(self.store.list_records())
                if after > before:
                    imported += 1

                if self.mark_seen:
                    client.uid("store", uid, "+FLAGS", "(\\Seen)")
        finally:
            try:
                client.logout()
            except Exception:
                pass

        self.last_poll_at = datetime.now().astimezone().isoformat(timespec="seconds")
        self.last_imported = imported
        self.total_imported += imported
        self.last_error = ""
        return imported

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                self.last_poll_at = datetime.now().astimezone().isoformat(timespec="seconds")
            self._stop.wait(self.poll_seconds)

    def start(self) -> None:
        if not self.configured:
            raise RuntimeError("Gmail Receiver credentials are not configured.")
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="smartdoc-gmail-receiver", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)


def receiver_enabled_from_env() -> bool:
    return os.getenv("GMAIL_RECEIVER_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
