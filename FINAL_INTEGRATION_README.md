# Final integration patch

This patch keeps the existing Auto Reply / Resend / attachment preview / Live
Check workflow and adds the following fixes:

1. **BL Request correction + finer subtypes**
   - only a no-attachment email whose body really asks to *send the draft BL*
     is a BL request;
   - subtypes: **BL Draft Request**, **BL Confirmation Request**, and
     **BL Amendment Request**;
   - no-attachment SI-vs-BL comparison requests remain **BL Comparison →
     NEEDS_REVIEW (missing_attachment)** instead of being mislabeled.

2. **Review queue synchronisation**
   - unresolved `NEEDS_REVIEW` BL-comparison messages appear in both
     **Inbox → Review** and **Verification → Review**;
   - resolving the review removes it from the unresolved queue;
   - opening a Verification review goes directly to the Manual Review workspace.

3. **Automatic Gmail Receiver**
   - optional IMAP background polling;
   - customer sender / subject / body / date / supported attachments are stored;
   - the existing classifier + comparison pipeline runs automatically;
   - received Gmail records are persisted under `backend/runtime_gmail/`;
   - the frontend reloads `/api/emails` every 10 seconds, so new mail appears in
     the correctly classified Inbox queue without refreshing the browser.

4. **One-command regression checker**
   - `python verify_all.py` performs backend/plugin/API/workflow/frontend-build/
     520-email-score checks in safe dry-run mode;
   - `python verify_all.py --quick` skips the slower frontend build and score;
   - `verify_all.cmd` is the Windows double-click wrapper.

## Apply

Extract this patch into the **repository root** and allow files to be replaced.
Do not copy it into `frontend/` or `backend/` only; the zip already contains the
correct folder structure.

Then run:

```powershell
python verify_all.py
```

## Gmail Receiver

See `GMAIL_RECEIVER.md`. Minimal PowerShell configuration:

```powershell
$env:GMAIL_RECEIVER_ENABLED="1"
$env:GMAIL_RECEIVER_USERNAME="receiver@gmail.com"
$env:GMAIL_RECEIVER_APP_PASSWORD="YOUR_APP_PASSWORD"
cd backend
python -m uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

The receiver never needs the normal Gmail login password and the App Password
must not be committed to git.
