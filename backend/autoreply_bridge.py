"""Thin adapter between SmartDoc backend and standalone Auto Reply plugin."""

from pathlib import Path
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
