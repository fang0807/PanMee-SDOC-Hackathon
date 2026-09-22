# Gmail Receiver — automatic customer email ingestion

SmartDoc can poll a receiver Gmail inbox with IMAP. New customer mail is stored,
classified with the existing pipeline, and returned by `GET /api/emails`, so it
appears in the web Inbox automatically (the frontend refreshes every 10 seconds).

## 1. Configure the receiver

Use a Google **App Password**, not the normal account password. In the same
PowerShell window that starts the backend:

```powershell
$env:GMAIL_RECEIVER_ENABLED="1"
$env:GMAIL_RECEIVER_USERNAME="testingsdochackathon@gmail.com"
$env:GMAIL_RECEIVER_APP_PASSWORD="YOUR_16_CHARACTER_APP_PASSWORD"
$env:GMAIL_RECEIVER_POLL_SECONDS="30"
```

If the receiver is the same Gmail account already used by Auto Reply, you may
omit the two receiver credential variables; SmartDoc falls back to:

```text
AUTOREPLY_SMTP_USERNAME
AUTOREPLY_SMTP_PASSWORD
```

Then start the API:

```powershell
cd backend
python -m uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

Do not commit App Passwords to git.

## 2. What happens when a client sends mail

Every poll:

1. Gmail `INBOX` is searched for `UNSEEN` messages.
2. The message sender, subject, body, date and supported attachments are saved.
3. SI / BL attachments are recognised using the same filename rules as the
   verification engine (`SI`, `Shipping Instruction`, `BL`, `Bill of Lading`, etc.).
4. The existing classifier / SI-vs-BL pipeline runs once.
5. The result is persisted under `backend/runtime_gmail/`.
6. `GET /api/emails` returns the new record together with the bundled inbox.
7. The frontend refreshes every 10 seconds and places the mail in the correct
   Inbox workflow category automatically.

Gmail Receiver **does not automatically send a reply** merely because a message
arrived. Match Auto Reply still happens when the employee confirms `Verify`, and
mismatch/review mail still follows the human-review workflow.

## 3. Check receiver status

Open:

```text
http://127.0.0.1:8000/api/gmail-receiver/status
```

Useful fields:

- `configured`: username + App Password were found
- `running`: background polling thread is alive
- `lastImported`: messages imported by the last poll
- `totalImported`: messages imported since backend start
- `lastError`: IMAP/login/network error, if any
- `storedRecords`: persisted Gmail records

## 4. Force a poll now

For testing, use Swagger (`http://127.0.0.1:8000/docs`) and execute:

```text
POST /api/gmail-receiver/poll
```

or PowerShell:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/gmail-receiver/poll
```

The next frontend refresh (maximum ~10 seconds) will show imported mail.

## 5. Optional settings

```powershell
$env:GMAIL_RECEIVER_FOLDER="INBOX"
$env:GMAIL_RECEIVER_SEARCH="UNSEEN"
$env:GMAIL_RECEIVER_MAX_PER_POLL="25"
$env:GMAIL_RECEIVER_MARK_SEEN="1"
$env:GMAIL_RECEIVER_IGNORE_SELF="1"
$env:GMAIL_RECEIVER_HOST="imap.gmail.com"
```

`GMAIL_RECEIVER_DATA_DIR` can move the persistent runtime store. For cloud
hosting, point it at a persistent disk if received emails must survive container
replacement.

## 6. BL request workflow refinement

The benchmark's official category remains `BL_COMPARISON` (so scoring is not
changed), but the UI now separates genuine no-attachment draft-BL requests into:

- **BL Draft Request**
- **BL Confirmation Request** (`TO CONFIRM DOCS` subject pattern)
- **BL Amendment Request** (`amend/revise/correct BL` subject pattern)

A no-attachment message asking to **compare** SI and draft BL is *not* a BL
request. It remains **BL Comparison → NEEDS_REVIEW → missing_attachment**, and is
shown in both Inbox → Review and Verification → Review.
