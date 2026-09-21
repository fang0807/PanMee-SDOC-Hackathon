"""Command line interface for the standalone Auto Reply plugin."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .plugin import AutoReplyPlugin


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SmartDoc standalone Auto Reply plugin")
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Optional runtime folder for previews, review queue and sent records.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    process = sub.add_parser("process", help="Process one verification event JSON file")
    process.add_argument("event", help="Path to event JSON")

    approve = sub.add_parser("approve", help="Approve and send one queued mismatch draft")
    approve.add_argument("email_id", help="Email id used when the mismatch was queued")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    plugin = AutoReplyPlugin(data_dir=args.data_dir)

    try:
        if args.command == "process":
            event = _load_json(args.event)
            email = event.get("email") or {}
            verification = event.get("verification") or {}
            decision = plugin.handle(email, verification)
        else:
            decision = plugin.approve_and_send(args.email_id)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps({"ok": True, **decision.to_dict()}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
