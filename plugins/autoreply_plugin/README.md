# Auto Reply Plugin (standalone)

This plugin runs **after** document verification and does not import or modify the existing classifier, extractor, comparator, API, or frontend.

## Behaviour

| Verification status | Auto Reply action |
|---|---|
| `OK` | Creates a success reply. In live mode it is sent automatically to the original sender. |
| `MISMATCH` | Creates a reply listing `defect_fields` and saves it under `runtime/pending_review/`. It is **not sent** until an employee approves it. |
| `NEEDS_REVIEW` | No auto reply is sent because the verification result itself still requires employee review. |

The plugin also keeps a `sent/` record by `email_id` to avoid accidental duplicate replies.

## 1. Test safely (no real email)

From the project root:

```powershell
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_match.json
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_mismatch.json
```

Safe mode is the default. `OK` produces a preview; `MISMATCH` produces a pending-review draft.

## 2. Enable real sending

Set these environment variables in the same terminal. Do not commit credentials.

```powershell
$env:AUTOREPLY_LIVE_SEND="1"
$env:AUTOREPLY_SMTP_USERNAME="your_account@gmail.com"
$env:AUTOREPLY_SMTP_PASSWORD="your_gmail_app_password"
$env:AUTOREPLY_FROM_ADDRESS="your_account@gmail.com"
```

Gmail SMTP defaults are already configured (`smtp.gmail.com:465`).

Then process an `OK` event:

```powershell
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_match.json
```

## 3. Employee review for MISMATCH

Processing a mismatch never sends it immediately:

```powershell
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_mismatch.json
```

Review the generated JSON file in:

```text
plugins/autoreply_plugin/runtime/pending_review/<email_id>.json
```

After the employee approves the text, send it with:

```powershell
python -m plugins.autoreply_plugin.cli approve demo_mismatch_001
```

When `AUTOREPLY_LIVE_SEND=0`, approval remains a preview. Set it to `1` only when you are ready for real email delivery.

## Integration contract

The plugin only needs this structure:

```json
{
  "email": {
    "email_id": "live_abcd1234",
    "from": "client@example.com",
    "subject": "Original subject"
  },
  "verification": {
    "email_id": "live_abcd1234",
    "status": "OK",
    "defect_fields": []
  }
}
```

For your current backend, the `verification` object can be the result returned by `process_email(...)`. This makes the plugin portable across project versions.
