"""Small file-based queue/state store so the plugin remains standalone."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def safe_id(value: str) -> str:
    cleaned = _SAFE_ID_RE.sub("_", str(value or "unknown")).strip("._")
    return cleaned or "unknown"


class ReplyStore:
    def __init__(self, base_dir: str | Path):
        self.base_dir = Path(base_dir)
        self.pending_dir = self.base_dir / "pending_review"
        self.sent_dir = self.base_dir / "sent"
        self.preview_dir = self.base_dir / "preview"
        for directory in (self.pending_dir, self.sent_dir, self.preview_dir):
            directory.mkdir(parents=True, exist_ok=True)

    def _path(self, directory: Path, email_id: str) -> Path:
        return directory / f"{safe_id(email_id)}.json"

    @staticmethod
    def _write(path: Path, payload: dict[str, Any]) -> Path:
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return path

    def pending_path(self, email_id: str) -> Path:
        return self._path(self.pending_dir, email_id)

    def sent_path(self, email_id: str) -> Path:
        return self._path(self.sent_dir, email_id)

    def save_pending(self, email_id: str, payload: dict[str, Any]) -> Path:
        return self._write(self.pending_path(email_id), payload)

    def save_preview(self, email_id: str, payload: dict[str, Any]) -> Path:
        return self._write(self._path(self.preview_dir, email_id), payload)

    def mark_sent(self, email_id: str, payload: dict[str, Any]) -> Path:
        path = self._write(self.sent_path(email_id), payload)
        pending = self.pending_path(email_id)
        if pending.exists():
            pending.unlink()
        return path

    def already_sent(self, email_id: str) -> bool:
        return self.sent_path(email_id).exists()

    def load_pending(self, email_id: str) -> dict[str, Any]:
        path = self.pending_path(email_id)
        if not path.exists():
            raise FileNotFoundError(f"No pending review draft for {email_id}")
        return json.loads(path.read_text(encoding="utf-8"))
