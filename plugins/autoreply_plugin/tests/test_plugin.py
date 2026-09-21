import tempfile
import unittest

from plugins.autoreply_plugin.plugin import AutoReplyPlugin


class FakeMailer:
    def __init__(self):
        self.messages = []

    def send(self, recipient, subject, body):
        self.messages.append((recipient, subject, body))


class AutoReplyPluginTests(unittest.TestCase):
    def test_ok_dry_run_creates_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = AutoReplyPlugin(data_dir=tmp, live_send=False)
            result = plugin.handle(
                {"email_id": "e1", "from": "a@example.com", "subject": "SI"},
                {"email_id": "e1", "status": "OK", "defect_fields": []},
            )
            self.assertEqual(result.action, "PREVIEW_ONLY")
            self.assertIn("correctly received", result.body)

    def test_ok_live_sends_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            mailer = FakeMailer()
            plugin = AutoReplyPlugin(data_dir=tmp, live_send=True, mailer=mailer)
            first = plugin.handle(
                {"email_id": "e2", "from": "a@example.com", "subject": "SI"},
                {"email_id": "e2", "status": "OK", "defect_fields": []},
            )
            second = plugin.handle(
                {"email_id": "e2", "from": "a@example.com", "subject": "SI"},
                {"email_id": "e2", "status": "OK", "defect_fields": []},
            )
            self.assertEqual(first.action, "SENT")
            self.assertEqual(second.action, "ALREADY_SENT")
            self.assertEqual(len(mailer.messages), 1)

    def test_mismatch_requires_review_then_sends(self):
        with tempfile.TemporaryDirectory() as tmp:
            mailer = FakeMailer()
            plugin = AutoReplyPlugin(data_dir=tmp, live_send=True, mailer=mailer)
            draft = plugin.handle(
                {"email_id": "e3", "from": "a@example.com", "subject": "SI"},
                {
                    "email_id": "e3",
                    "status": "MISMATCH",
                    "defect_fields": ["port_of_discharge", "gross_weight_kg"],
                },
            )
            self.assertEqual(draft.action, "REVIEW_REQUIRED")
            self.assertEqual(len(mailer.messages), 0)
            self.assertIn("Port of Discharge", draft.body)

            sent = plugin.approve_and_send("e3")
            self.assertEqual(sent.action, "SENT_AFTER_REVIEW")
            self.assertEqual(len(mailer.messages), 1)

    def test_needs_review_skips(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin = AutoReplyPlugin(data_dir=tmp, live_send=False)
            result = plugin.handle(
                {"email_id": "e4", "from": "a@example.com"},
                {"email_id": "e4", "status": "NEEDS_REVIEW"},
            )
            self.assertEqual(result.action, "SKIPPED")


if __name__ == "__main__":
    unittest.main()
