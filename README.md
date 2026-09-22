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

A three-part system that turns the inbox into a scored, explainable pipeline, with a web app on
top for the people who have to act on it.

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

- **Classification** (`backend/classifier.py`) is rule-based first — subject/body patterns,
  attachment presence, keyword scoring — and only falls back to an optional LLM
  (`backend/semantic_layer/`) when its own confidence is below threshold. This keeps the system
  fast and explainable, and still usable with zero API keys configured.
- **Extraction** (`backend/extractor.py`, `backend/ocr.py`, `backend/ocr_checks.py`) reads plain
  text, PDF (`pypdf`), and Word (`docx`) attachments, recognizes dozens of label variants per
  field (`"POL"`, `"Loading Port"`, `"Port of Loading (POL)"` all normalize to
  `port_of_loading`), and falls back to Tesseract OCR for image-only/scanned pages.
- **Comparison** (`backend/comparator.py`) normalizes each value (case, whitespace, UN/LOCODE
  suffixes, unit formatting) before comparing, so formatting differences don't produce false
  mismatches, then reports exactly which of the seven fields disagree.
- **Human review** (`backend/semantic_layer/review_queue.py`) catches what the pipeline can't
  resolve — missing attachment, unreadable document, missing value, wrong document type — and
  surfaces it with the reason and source evidence rather than guessing. It's what the "Reliability"
  score section below measures.
- **The web app** (`frontend/`, React + TypeScript + Vite) is the interface a shipping-ops
  employee actually uses: an Inbox workflow (New → Classify → BL Comparison → Verify), a
  Verification screen with Match/Mismatch/Review tabs and a date filter, a Documents archive, a
  Manual Review workspace for escalated emails, a Resend queue for corrections, and a Live Check
  page to upload a fresh SI/BL pair and see the result immediately.
- **Auto Reply** (`plugins/autoreply_plugin/`) is a standalone plugin that runs after
  verification: it drafts (and, once enabled, sends) a confirmation on `OK`, and prepares a
  pending-review draft on `MISMATCH` that an employee approves before it goes out. It never
  touches the classifier, extractor, comparator, API, or frontend.
- **Gmail Receiver** (`backend/gmail_receiver.py`, optional) polls a real Gmail inbox over IMAP,
  runs new mail through the same pipeline, and the web app picks it up automatically — so the
  same system can sit in front of a live inbox, not just the sample dataset.

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

```
backend/
  main.py             batch pipeline entry point (classify → extract → compare → score)
  classifier.py        rule-based email classification + confidence
  extractor.py          SI/BL field extraction (text/PDF/DOCX + label aliases)
  comparator.py          field normalization + matching
  ocr.py / ocr_checks.py  Tesseract fallback for scanned attachments
  semantic_layer/        optional LLM fallback + human review queue
  api.py                  FastAPI app backing the web app (live checks, sample inbox, search)
  ui_records.py            shapes pipeline results for the UI (subjects, dates, fields)
  export_ui_data.py         regenerates ui_data.json served by GET /api/emails
  gmail_receiver.py          optional IMAP ingestion of a live inbox
  autoreply_bridge.py         wires the standalone Auto Reply plugin into the API
  server/                     scoring (score_cli.py, scoring.py) against the local answer key
  inbox/, attachments/, data_v2/   the 520-email sample dataset + ground truth
frontend/
  src/figma/            the actual web app (App.tsx, api.ts) — Inbox, Verification, Documents,
                         Manual Review, Resend, Live Check screens
plugins/autoreply_plugin/  standalone post-verification Auto Reply plugin (safe-mode by default)
PROBLEM_BRIEF.md        the organiser's original problem statement (full text)
DEPLOY.md, RUN_AND_SCORE.md, GMAIL_RECEIVER.md   step-by-step detail behind the sections below
```

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

See [`RUN_AND_SCORE.md`](RUN_AND_SCORE.md) for the full troubleshooting table (encoding errors,
missing `pypdf`/`openpyxl`, harmless PDF-parser warnings, etc.).

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

Full walkthrough: [`DEPLOY.md`](DEPLOY.md).

---

## 9. Optional integrations

**Gmail Receiver** — poll a real inbox over IMAP and have new mail flow through the same
pipeline automatically:

```powershell
$env:GMAIL_RECEIVER_ENABLED="1"
$env:GMAIL_RECEIVER_USERNAME="your_receiver@gmail.com"
$env:GMAIL_RECEIVER_APP_PASSWORD="16-character App Password"
```

Status at `GET /api/gmail-receiver/status`, force a poll with `POST /api/gmail-receiver/poll`.
Full detail (BL-request subtypes, persistence across deploys, optional settings):
[`GMAIL_RECEIVER.md`](GMAIL_RECEIVER.md).

**Auto Reply** — safe-mode (preview only) by default. To send for real:

```powershell
$env:AUTOREPLY_LIVE_SEND="1"
$env:AUTOREPLY_SMTP_USERNAME="your_account@gmail.com"
$env:AUTOREPLY_SMTP_PASSWORD="your_gmail_app_password"
$env:AUTOREPLY_FROM_ADDRESS="your_account@gmail.com"
```

`OK` sends automatically; `MISMATCH` drafts a reply under
`plugins/autoreply_plugin/runtime/pending_review/` for an employee to approve first; `NEEDS_REVIEW`
sends nothing. Full detail: [`plugins/autoreply_plugin/README.md`](plugins/autoreply_plugin/README.md).

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
§3). Full field/category reference: [`PROBLEM_BRIEF.md`](PROBLEM_BRIEF.md).

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
