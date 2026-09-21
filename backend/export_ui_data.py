#!/usr/bin/env python3

"""Run the pipeline on the whole inbox and save what the web UI shows.

    python export_ui_data.py

Writes ui_data.json next to this file, then checks every record against
submission.json. Exits with an error if the two ever disagree. Run it again
whenever the pipeline changes.
"""

import json
import sys

import main as pipeline
from loader import Inbox
from ui_records import make_ui_record


UI_DATA_PATH = pipeline.BASE_DIR / "ui_data.json"

COMPARED_KEYS = ("category", "status", "defect_fields", "review_reason")


def main():
    pipeline.CURRENT_INBOX = Inbox(str(pipeline.BASE_DIR))
    pipeline.PORT_VALUES.clear()
    pipeline.OCR_CASES.clear()

    submission = json.loads(
        pipeline.SUBMISSION_PATH.read_text(encoding="utf-8")
    )

    records = []
    differences = []

    for email in pipeline.CURRENT_INBOX.emails():
        detail = {}
        result = pipeline.process_email(email, detail)

        records.append(make_ui_record(email, result, detail))

        expected = submission.get(result["email_id"])

        if expected is None or any(
            result[key] != expected[key] for key in COMPARED_KEYS
        ):
            differences.append(result["email_id"])

    UI_DATA_PATH.write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Wrote {len(records)} records to {UI_DATA_PATH}")
    print(f"Records that differ from submission.json: {len(differences)}")

    if differences:
        print("First differences:", ", ".join(differences[:10]))
        sys.exit(1)


if __name__ == "__main__":
    main()
