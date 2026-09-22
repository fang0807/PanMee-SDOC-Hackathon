"""Thin adapter between SmartDoc backend and standalone Auto Reply plugin."""

from pathlib import Path
import json
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from plugins.autoreply_plugin import AutoReplyPlugin

_PLUGIN = None


def _get_plugin():
    global _PLUGIN
    if _PLUGIN is None:
        _PLUGIN = AutoReplyPlugin()
    return _PLUGIN


def handle_verification_autoreply(email, result):
    """Run Auto Reply only for SI-vs-BL verification results."""
    if result.get("category") != "BL_COMPARISON":
        return {
            "ok": True,
            "email_id": result.get("email_id") or email.get("email_id"),
            "status": result.get("status"),
            "action": "SKIPPED",
            "reason": "Auto Reply only applies to BL_COMPARISON verification.",
        }

    decision = _get_plugin().handle(email, result)
    return {"ok": True, **decision.to_dict()}

def get_verification_autoreply_state(email_id):
    """Return persisted Auto Reply state for a sample email, if any."""
    plugin = _get_plugin()
    candidates = (
        ("SENT", plugin.store.sent_path(email_id)),
        ("REVIEW_REQUIRED", plugin.store.pending_path(email_id)),
        ("PREVIEW_ONLY", plugin.store.preview_path(email_id)),
    )

    for action, path in candidates:
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
        return {
            "ok": True,
            "email_id": email_id,
            "status": payload.get("verification_status"),
            "action": action,
            "recipient": payload.get("recipient", ""),
            "subject": payload.get("subject", ""),
            "body": payload.get("body", ""),
            "path": str(path),
            "reason": "",
        }

    return None

