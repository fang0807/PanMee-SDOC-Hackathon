# SmartDoc — Shipping Document Verification

An AI-assisted inbox that reads a shipping operations team's mail, tells document-comparison
requests apart from SI requests, invoice queries, general mail and spam, checks a Shipping
Instruction (SI) against a draft Bill of Lading (BL), and hands anything it can't decide on its
own to a person — with the evidence attached.

Built for **Averis x Monash Hackathon 2026**.

## Quick start

```powershell
# Terminal 1 — backend API
cd backend && pip install -r requirements.txt && python -m uvicorn api:app --port 8000

# Terminal 2 — web app
cd frontend && npm install && copy .env.example .env.local && npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Full steps, including running the
batch pipeline and seeing the score, are in [§7](#7-run-it-locally).

---

## 1. The problem

A shipping operations team receives several kinds of messages in one inbox: requests to check
documents, requests to prepare a new SI, invoice questions, operational updates, and spam. For a
document-checking request, the team compares an SI (the source of truth for the intended
shipment) against a draft BL, to catch mistakes before the BL is finalized.

Doing this by hand doesn't scale:

- **Triage is slow.** Every message has to be read before anyone knows what it needs. A request
  that's missed never reaches the checking step.
- **Manual comparison is repetitive and error-prone.** Shipper, consignee, ports, container
  count, and weight all have to be checked across two documents by eye.
- **The same field is spelled differently across documents.** "Port of Loading" on one page,
  "Load Port" on another — the system has to know these mean the same thing.

### What the system has to do

| Capability | What it means |
|---|---|
| **Classify** | Tell BL-comparison requests apart from new-SI requests, invoice queries, general mail, and spam. |
| **Extract** | For comparison requests, read the SI and BL attachments and locate the seven shipment fields. |
| **Compare** | Check the values and surface any mismatched field, SI and BL side by side. |
| **Ask for help** | When it can't decide on its own, escalate to a person with the evidence attached, instead of guessing or failing silently. |

**Fields checked:** shipper, consignee, notify party, port of loading, port of discharge,
container count, gross weight (kg). If all seven agree, the report says "No mismatch detected."
If, say, the SI lists 3 containers and the BL lists 4, only `container_count` is flagged, shown as
`SI: 3 / BL: 4`.

---

## 2. What we built

A three-part pipeline that turns the inbox into a scored, explainable decision for every email,
with a web app on top for the people who have to act on the output.

```
inbox (JSON emails + SI/BL attachments)
        │
        ▼
 ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌────────────────┐
 │  Classify   │──▶│   Extract    │──▶│   Compare   │──▶│  Human review   │
 │ (rules +    │   │ (text/PDF/   │   │ (7 fields,  │   │ (escalate what  │
 │  LLM        │   │  DOCX/OCR)   │   │  normalized │   │  can't be       │
 │  fallback)  │   │              │   │  matching)  │   │  decided)       │
 └─────────────┘   └──────────────┘   └─────────────┘   └────────────────┘
        │                                                        │
        ▼                                                        ▼
  SPAM / GENERAL /                                        Manual Review
  SI_REQUEST /                                             Workspace (web)
  INVOICE_QUERY                                                   │
        │                                                         ▼
        ▼                                              OK ─────▶ Auto Reply
   shown in Inbox → Others                              MISMATCH ─▶ pending-review draft, then Resend
```

Every stage is designed to be **inspectable**: nothing produces a bare "yes/no". A classification
carries the scores it beat and the rule names that fired; a comparison carries the SI and BL value
side by side for every field it flagged; an escalation carries a reason and the evidence that led
to it. That's a deliberate choice for a document-checking system in a shipping context — an
operator has to be able to see *why* the system decided something before acting on it.

### 2.1 Classification — rules first, LLM only when unsure

`backend/classifier.py` is a weighted rule engine, not a black box. For each email it runs three
independent signal sources and sums their weights into a score per category:

1. **Attachment structure.** Filenames are pattern-matched for an `SI`/`BL` role
   (`xxx_SI.pdf`, `BL_xxx.docx`, …). Both roles present is the strongest signal for
   `BL_COMPARISON`; either alone nudges toward comparison or a fresh SI request.
2. **Inline SI structure.** The body is scanned for SI-shaped lines (`Shipper:`, `POL:`,
   `Gross Wt:`, …) — five or more hits is treated as an inline SI even with no attachment at all.
3. **Body and subject cues.** ~70 hand-written regexes per category (e.g. *"compare SI against
   draft BL"*, *"please find shipping instruction for"*, *"automated notification"*,
   *"verify your account"*) each contribute a weight tuned from misclassifications in the
   dataset.

The category with the highest total wins, and **confidence is the margin to the runner-up**, not
the raw score: `confidence = 1 - e^(-margin / 2)`. A clear win (nothing else scored) is
high-confidence; a narrow win between two plausible categories is low-confidence, however high the
absolute score. Two guard rules exist specifically because generic keyword matching alone
misreads this dataset's structure:

- **SI protection** — a canonical SI email often ends with *"please revert with draft BL once
  available"*, which contains the word "BL" but is not a comparison request. If an email matches
  the SI template and has no explicit compare/check/against wording near "BL", its
  `BL_COMPARISON` score is capped rather than left to win on a stray keyword.
- **Spam override** — a handful of unambiguous phrases (*"verify your account"*, *"you have
  won"*, *"bitcoin"*, *"gift card"*) add a flat bonus so obvious spam doesn't lose to a rule that
  happens to score higher on the invoice/general lists.

Only when the rules' own confidence falls below `SEMANTIC_CLASSIFICATION_THRESHOLD` (default
`0.60`) does the optional LLM fallback in `backend/semantic_layer/` get a turn, and it can only
choose one of the five fixed categories or abstain — it never overrides a confident rule result.
That's what keeps the pipeline fast, deterministic, and fully usable with zero API keys
configured; the LLM is a tie-breaker, not the decision-maker.

### 2.2 Extraction — reading the documents, not just the emails

`backend/extractor.py` locates the seven shipment fields inside an SI or BL attachment,
whatever format it arrives in. Real shipping paperwork never uses one field name consistently, so
extraction is built around a **label-alias table**: dozens of label variants per field (`"POL"`,
`"Loading Port"`, `"Port of Loading (POL)"`, `"P.O.L."`) all resolve to the same canonical key
(`port_of_loading`) before anything is compared. `backend/ocr.py` / `backend/ocr_checks.py` add a
Tesseract OCR pass for image-only or scanned pages, so a photographed BL is read the same way as a
native PDF — it just costs more time and can fail more often, which is one of the reasons a
document ends up in human review instead of a false result.

### 2.3 Comparison — normalize before you compare

`backend/comparator.py` treats "the values look different" and "the values *are* different" as
two different problems, and only reports the second. Each field gets normalization matched to how
that field actually varies across real documents:

- **Ports** — collapse whitespace/case, then strip a trailing UN/LOCODE suffix, so
  `"Nantong, China (CNNTG)"` and `"NANTONG, CHINA"` compare equal.
- **Parties** (shipper/consignee/notify) — an SI often lists `"NAME | full address, ..."` while
  the BL lists just the name, so only the name segment before the first `|` is compared.
- **Weights** — commas and units are stripped down to the bare number, so `"12,500 KGS"` and
  `"12500"` compare equal.
- **Container counts** — spacing around `×`/`X` is normalized so `"10 X 40HC"` and `"10X40HC"`
  compare equal.

A field where *both* documents are missing a value is reported as `missing`, not `mismatch` —
there's nothing to disagree about. A field present on one side and absent on the other **is** a
mismatch (e.g. SI has no consignee, BL does): that's a real discrepancy, not a data gap. Every
other field is compared value-for-value after normalization, and only the fields that disagree are
returned — a perfect match produces an empty list, not seven "OK"s.

### 2.4 Human review — escalate with evidence, never guess

`backend/semantic_layer/review_queue.py` is where anything the pipeline can't safely resolve on
its own lands: a missing attachment, a document that OCR couldn't read, a field with no value on
either side of a real comparison, or an attachment that turned out to be the wrong document type
entirely. Each entry records *why* it was escalated and the source evidence behind that reason, so
the person picking it up in the Manual Review Workspace sees the same thing the pipeline saw
instead of a bare "needs review" flag. This queue is exactly what the "Reliability" row in the
score table (§3) measures — 20/20 of the dataset's deliberately broken cases were caught and
routed here rather than silently scored as a false match or false mismatch.

### 2.5 The web app

`frontend/` (React + TypeScript + Vite) is the interface a shipping-ops employee actually works
in, built around the same four stages: an **Inbox** that shows each email moving
New → Classify → BL Comparison → Verify, a **Verification** screen with Match / Mismatch / Review
tabs and a date filter, a **Documents** archive of everything that's been processed, the
**Manual Review Workspace** for escalated emails, a **Resend** queue for corrections that need a
person's sign-off, and a **Live Check** page to upload a fresh SI/BL pair and see a result
immediately, outside the batch pipeline.

**Resend is a browser action, not a backend send.** Unlike Auto Reply (below), clicking Resend
never calls the API or the SMTP mailer. `gmailComposeUrl()` (`frontend/src/figma/App.tsx`) builds
a `https://mail.google.com/mail/?view=cm&...` link pre-filled with the recipient, subject, and a
draft body (the mismatched fields, or the pending-review draft Auto Reply already prepared), and
`window.open()`s it in a new tab. Gmail's own compose window then sends from **whichever Google
account is currently signed in to that browser** — there's no separate "resend account" to
configure. The email is only marked as resent in the app once that tab opens; nothing confirms the
employee actually hit Send on the Gmail side.

### 2.6 Auto Reply and Gmail Receiver — optional, decoupled

Two pieces sit outside the core pipeline on purpose, so neither can destabilize the classify →
extract → compare → review path itself:

- **Auto Reply** (`plugins/autoreply_plugin/`) runs *after* verification. On `OK` it drafts (and,
  once enabled, sends) a confirmation; on `MISMATCH` it prepares a pending-review draft that an
  employee has to approve before anything goes out. It never imports or calls into the
  classifier, extractor, comparator, API, or frontend — it only consumes their output.
- **Gmail Receiver** (`backend/gmail_receiver.py`) polls a real Gmail inbox over IMAP and feeds
  new mail through the same pipeline the sample dataset uses, so the system can sit in front of a
  live inbox as well as a static JSON dataset — the classification, extraction, and comparison
  logic doesn't change based on where the email came from.

---

## 3. Score

Run against the organiser's 520-email sample dataset and its local answer key
(`backend/data_v2/ground_truth.json`):

```
FINAL SCORE  1.0000   (w: s1=0.3, s3=0.2, e2e=0.5)
```

| Part | Weight | What it measures | Result |
|---|---|---|---|
| Stage 1 | 30% | Email classification, macro-F1 across all 5 categories | 1.00 |
| Stage 3 | 20% | BL-vs-SI defect field F1 (comparable document emails) | 1.00 |
| End-to-end | 50% | Defect emails caught all the way through, start to finish | 46/46 (1.00) |
| Reliability (diagnostic, not weighted) | — | Escalation recall/precision for the 20 gold `NEEDS_REVIEW` cases (wrong doc type, missing attachment, unreadable, missing value — 5 each) | 20/20 escalated |

This is the score on this local dataset, which the pipeline's rules were tuned against — a hidden
or different test set may score lower. Reproduce it yourself with:

```powershell
cd backend
$env:PYTHONIOENCODING = "utf-8"
python main.py
```

which writes `results.json` and `submission.json`, then calls `server/score_cli.py` and prints the
report above. Re-score a saved `submission.json` without re-running the pipeline with
`python server/score_cli.py submission.json` (add `--json` for machine-readable output).

---

## 4. Advanced-stage coverage

The brief's basic expectations (classify plain-text email + plain-text attachments, extract seven
fields, compare, report) are covered above. Against the advanced challenges:

| Advanced challenge | Status | Where |
|---|---|---|
| PDF and Word attachments | ✅ | `pypdf`, `python-docx`/`docx-preview` in `backend/extractor.py`, table/layout-aware reading |
| Scanned / image-only documents | ✅ | Tesseract OCR fallback, `backend/ocr.py`, `backend/ocr_checks.py` |
| Messier inputs (varied labels, formatting, misleading subjects, missing attachments) | ✅ | Field-label alias table in `extractor.py`; value normalization in `comparator.py`; subject-pattern parsing in `backend/ui_records.py` (`format_subject`) covers ~89% of real dataset subjects for display, with a raw-subject fallback for the rest |
| Reliability & human review | ✅ | `backend/semantic_layer/review_queue.py` + the Manual Review Workspace in the web app; escalated cases carry the reason and source evidence, not a silent guess |

---

## 5. Tech stack

| Layer | Stack |
|---|---|
| Backend / pipeline | Python 3, FastAPI, uvicorn, `pypdf`, `openpyxl`, `pillow`, `pytesseract` |
| Optional LLM fallback | Any OpenAI-compatible Chat Completions endpoint (`backend/semantic_layer/providers.py`), off by default — the rule-based pipeline runs fully without it |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, `docx-preview` |
| Auto Reply | Standalone Python plugin, SMTP (Gmail App Password) |
| Gmail Receiver | IMAP polling, background thread in the FastAPI app |
| Deployment | Docker (backend) on Render/Railway/Fly; Vite static build (frontend) on Vercel — the two talk over HTTPS |

---

## 6. Repository structure

| Path | Role |
|---|---|
| `backend/main.py` | Batch pipeline entry point (classify → extract → compare → score) |
| `backend/classifier.py` | Rule-based email classification + confidence |
| `backend/extractor.py` | SI/BL field extraction (text/PDF/DOCX + label aliases) |
| `backend/comparator.py` | Field normalization + matching |
| `backend/ocr.py`, `backend/ocr_checks.py` | Tesseract fallback for scanned attachments |
| `backend/semantic_layer/` | Optional LLM fallback + human review queue |
| `backend/api.py` | FastAPI app backing the web app (live checks, sample inbox, search) |
| `backend/ui_records.py` | Shapes pipeline results for the UI (subjects, dates, fields) |
| `backend/export_ui_data.py` | Regenerates `ui_data.json` served by `GET /api/emails` |
| `backend/gmail_receiver.py` | Optional IMAP ingestion of a live inbox |
| `backend/autoreply_bridge.py` | Wires the standalone Auto Reply plugin into the API |
| `backend/server/` | Scoring (`score_cli.py`, `scoring.py`) against the local answer key |
| `backend/inbox/`, `backend/attachments/`, `backend/data_v2/` | The 520-email sample dataset + ground truth |
| `frontend/src/figma/` | The actual web app (`App.tsx`, `api.ts`) — Inbox, Verification, Documents, Manual Review, Resend, Live Check screens |
| `plugins/autoreply_plugin/` | Standalone post-verification Auto Reply plugin (safe-mode by default) |

---

## 7. Run it locally

**Backend** (API on port 8000):

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn api:app --port 8000
```

Check it's up at http://localhost:8000/health → `{"status":"ok"}`.

**Frontend** (web app):

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open the printed URL (usually http://localhost:5173). On the **Live check** page, upload an SI and
a BL (e.g. `backend/attachments/email_004_SI.txt` and `email_004_BL.txt`) and press **Run check**.

Scanned PDFs/images need Tesseract installed locally to OCR (otherwise they're sent to manual
review, which is still a correct outcome). The Docker image already includes it.

**Batch pipeline + score** (no web app needed):

```powershell
cd backend
$env:PYTHONIOENCODING = "utf-8"
python main.py
```

| Symptom | Fix |
|---|---|
| `UnicodeEncodeError: 'charmap' codec ...` | Run `$env:PYTHONIOENCODING = "utf-8"` first |
| `ModuleNotFoundError: pypdf` or `openpyxl` | Run `pip install pypdf openpyxl` |
| `startxref` / `EOF marker not found` lines | Harmless warnings about malformed PDFs in the sample set; the run still finishes |
| Score step fails: ground truth not found | Make sure `backend/data_v2/ground_truth.json` is present (`git pull`) |

---

## 8. Deploy

**Backend** — Docker image built from the **repository root** (it needs `plugins/` alongside
`backend/`):

```powershell
docker build -t smartdoc-api .
docker run --rm -p 8000:8000 smartdoc-api
```

On Render/Railway/Fly: new web service from this repo, root directory = repo root, runtime =
Docker, set `ALLOWED_ORIGINS` to your frontend's deployed URL. Then confirm `/health` returns ok
(free tiers sleep when idle — wake it before a demo).

**Frontend** — Vercel, root directory = `frontend`, framework preset Vite, environment variable
`VITE_API_URL` = the backend URL above (redeploy after changing it — Vite bakes it in at build
time). Make sure `ALLOWED_ORIGINS` on the backend matches the Vercel URL exactly (no trailing
slash) or the browser blocks the requests.

---

## 9. Optional integrations

**Gmail Receiver** — poll a real inbox over IMAP and have new mail flow through the same
pipeline automatically:

```powershell
$env:GMAIL_RECEIVER_ENABLED="1"
$env:GMAIL_RECEIVER_USERNAME="your_receiver@gmail.com"
$env:GMAIL_RECEIVER_APP_PASSWORD="16-character App Password"
```

Status at `GET /api/gmail-receiver/status` reports `configured`, `running`, `lastImported`,
`totalImported`, `lastError`, and `storedRecords`; force a poll with `POST
/api/gmail-receiver/poll`. If the receiver is the same Gmail account already used by Auto Reply,
you can omit the two credential variables above — it falls back to `AUTOREPLY_SMTP_USERNAME` /
`AUTOREPLY_SMTP_PASSWORD`. Less common settings (`GMAIL_RECEIVER_FOLDER`, `_SEARCH`,
`_MAX_PER_POLL`, `_MARK_SEEN`, `_IGNORE_SELF`, `_HOST`) default sensibly and rarely need changing.

**Auto Reply** — safe-mode (preview only) by default. To send for real:

```powershell
$env:AUTOREPLY_LIVE_SEND="1"
$env:AUTOREPLY_SMTP_USERNAME="your_account@gmail.com"
$env:AUTOREPLY_SMTP_PASSWORD="your_gmail_app_password"
$env:AUTOREPLY_FROM_ADDRESS="your_account@gmail.com"
```

`OK` sends automatically; `MISMATCH` drafts a reply under
`plugins/autoreply_plugin/runtime/pending_review/` for an employee to approve, with
`python -m plugins.autoreply_plugin.cli approve <email_id>`; `NEEDS_REVIEW` sends nothing. Test
either path safely (no real email) with:

```powershell
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_match.json
python -m plugins.autoreply_plugin.cli process plugins\autoreply_plugin\example_mismatch.json
```

**LLM fallback** (optional, off by default — the classifier and extractor work without it):

```powershell
$env:SEMANTIC_LLM_ENDPOINT="https://.../chat/completions"
$env:SEMANTIC_LLM_API_KEY="..."
$env:SEMANTIC_LLM_MODEL="..."
```

Only called when the rule-based classifier's own confidence is below
`SEMANTIC_CLASSIFICATION_THRESHOLD` (default 0.60).

---

## 10. Data & the organiser's self-evaluation

The dataset is the organiser's sample inbox: JSON email records plus the SI/BL attachments they
reference, available either as a static ZIP (`inbox/`, `attachments/`, `sample_submission.json`,
`loader.py`) or as a local Docker server at `http://localhost:8080`. `loader.py` gives the same
`Inbox(...)` interface either way:

```python
from loader import Inbox
inbox = Inbox("data")  # or Inbox("http://localhost:8080")
for email in inbox: ...
inbox.read_text(path)  # text of an SI or BL attachment
```

Our `submission.json` (one JSON object keyed by `email_id`, matching `sample_submission.json`'s
shape) is what gets POSTed to the organiser's self-evaluation endpoint via `inbox.submit(...)` or
`POST /submit` when checking against their private reference set. Locally, the same shape is
scored offline by `backend/server/score_cli.py` against `backend/data_v2/ground_truth.json` (see
§3). The seven checked fields and five categories are listed in §1.

---

## 11. Environment variables reference

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `ALLOWED_ORIGINS` | backend | localhost:5173/5174 | CORS allow-list, comma-separated |
| `VITE_API_URL` | frontend | `http://localhost:8000` | Backend URL the web app calls |
| `TESSERACT_CMD`, `OCR_LANG`, `OCR_TIMEOUT` | backend | auto-detect, `eng`, `60` | Scanned-document OCR |
| `SEMANTIC_LLM_ENDPOINT/API_KEY/MODEL` | backend | unset (LLM fallback disabled) | Optional classification/extraction fallback |
| `SEMANTIC_CLASSIFICATION_THRESHOLD/FIELD_THRESHOLD` | backend | `0.60` / `0.75` | When the rule-based result is trusted vs. escalated to the LLM |
| `AUTOREPLY_LIVE_SEND` | plugin | `0` (preview only) | Set `1` to actually send mail |
| `AUTOREPLY_SMTP_USERNAME/PASSWORD/FROM_ADDRESS` | plugin | — | Gmail SMTP credentials (App Password, not your login password) |
| `GMAIL_RECEIVER_ENABLED/USERNAME/APP_PASSWORD` | backend | disabled | Optional live-inbox IMAP polling |
| `GMAIL_RECEIVER_DATA_DIR` | backend | `backend/runtime_gmail/` | Where received mail persists (mount a disk in production) |

Never commit real credentials — each `.env.example` documents the shape without a live secret.

---

## 12. Hackathon compliance

- **AI**: rule-based pipeline + optional LLM fallback for low-confidence classification/extraction
  (§9), used as a genuine decision-making component, not a bolt-on.
- **Cloud infrastructure**: backend containerized and deployable to Render/Railway/Fly; frontend
  deployable to Vercel; the two are designed to run as separate deployed services over HTTPS
  (§8).
- **Human-in-the-loop**: escalation with evidence, not silent failure or guessing (§2, §4).
- Team name, video demo link, live prototype link, and slide deck link go in the official
  submission form — see the rules for the current deadline and required fields.
