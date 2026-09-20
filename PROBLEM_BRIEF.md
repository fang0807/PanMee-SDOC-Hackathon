## Marking Scheme
#### Technical — 70 Points
- System Design & Architecture — 15 pts
- Working Core Prototype — 25 pts
- Technology Integration — 15 pts
- Technical Feasibility & Validation — 15 pts

#### Product & Impact — 30 Points
- Problem Statement Understanding — 10 pts
- Innovation & Solution Approach — 10 pts
- Practical Value & Potential — 10 pts

---
### Context
A shipping operations team receives different kinds of messages in the same inbox: requests to check documents, prepare new shipping instructions, answer invoice questions, and share operational updates. Spam arrives alongside them.

For a document-checking request, the team compares a Shipping Instruction (SI), which contains the intended shipment details, against a draft Bill of Lading (BL). The SI is the reference for this check. The goal is to catch incorrect details before the draft is finalized.

---
### The Problems
- **Finding the right emails takes time.** Staff must read each message and decide what action it needs. A document request that is overlooked never reaches the checking step.
- **Manual comparison is repetitive and easy to get wrong.** Names, ports, quantities, and weight must be checked across two documents. A missed discrepancy can lead to corrections, delays, and additional work.
- **The same information can look different.** One document may say "Port of Loading" while the other says "Load Port" — the system must recognize these as the same field, not a discrepancy. Harder cases exist too: an order (negotiable) Bill of Lading may not have a literal "Consignee" line at all, expressing it instead as "To the Order of," so field mapping sometimes has to reconcile different document structures, not just different labels.
- **A confident-looking answer isn't the same as a trustworthy one.** A system that always outputs *something* isn't automatically reliable — unreadable documents, missing attachments, and missing values must be recognized as "cannot verify," not silently treated as a match or a mismatch.

---
### What the System Should Do
Starting from the inbox, the system produces a clear result for each email:

| Capability | What it means |
| :--- | :--- |
| **Classify** | Sort every email into one of `BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM` — using subject/body cues (keywords like "Shipping Instruction", "BL", "Invoice") as signals, refined by model-based classification for ambiguous cases. |
| **Extract** | For `BL_COMPARISON` emails only, read the SI and BL attachments — across text, PDF, Excel, and docx formats — and pull out the 7 shipment fields. |
| **Compare** | Normalize equivalent labels/values, diff the two documents, and surface mismatched fields side by side (`SI: value / BL: value`). |
| **Ask for help** | When the system can't complete the task on its own — unreadable doc, missing attachment, missing value, wrong document, low-confidence read — escalate to a person with the evidence and the reason, instead of guessing or failing silently. |

Only `BL_COMPARISON` emails continue past classification to the checking step; the other four categories only need to be classified correctly.

**Real examples from the sample inbox** (`sdoc-hackathon-bundle/inbox/`):

| Category | Example subject | Why |
| :--- | :--- | :--- |
| `BL_COMPARISON` | `REQUEST BL DRAFT _ PO 26067_ COATED IVORY BOARD__138MT` (`email_004`) | Body: "Attached are the SI and draft BL... please check the details and confirm," with both an `_SI.txt` and a `_BL.txt` attachment. |
| `SI_REQUEST` | `REQUEST SI _ 5RFR-37631 _ GDANSK_POLAND _ AL GURG STATIONERY LLC _ SIJ1051834` (`email_007`) | Asks for a new SI to be issued; shipment details are typed inline in the body, no attachments — nothing to compare. |
| `INVOICE_QUERY` | `RE_ LOCAL CHARGES FOB - KARGOSMAR - 5AKR-61849 - TELEX RELEASE CHARGES` (`email_002`) | Asks whether a charge is included in an invoice; no SI or BL involved. |
| `GENERAL` | `_Reminder_Paper - Submit SI & AED_26-01-2026` (`email_012`) | Subject contains the keyword "SI," but the body is a routine vessel-berthing update with no attachment. A pure keyword classifier would misfile this as `SI_REQUEST`. |
| `SPAM` | `Increase your shipping revenue with this ONE weird trick` (`email_015`) | Sender domain and body (a mailbox-storage phishing link) have nothing to do with the subject or with shipping operations. |

---
### The 7 Compared Fields
`shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`, `container_count`, `gross_weight_kg`.

If all 7 match, report **"No mismatch detected."** Otherwise, flag only the fields that actually differ — e.g. if the SI lists 3 containers and the BL lists 4, and everything else agrees, flag just the container count as `SI: 3 / BL: 4`.

**Worked example (`email_004`):**

| Field | SI value | BL value | Result |
| :--- | :--- | :--- | :--- |
| shipper | APRIL FAR EAST (M) SDN BHD | APRIL FAR EAST (M) SDN BHD | Match |
| consignee | EAST BRIGHT FZ-LLC | *(no "Consignee" line — order B/L)* To the Order of: UAB NOVAKOPA | **Mismatch** |
| notify_party | EAST BRIGHT FZ-LLC | UAB NOVAKOPA | **Mismatch** |
| port_of_loading | NANTONG, CHINA (CNNTG) | NANTONG, CHINA (CNNTG) | Match |
| port_of_discharge | KARACHI, PAKISTAN (PKKHI) | KARACHI, PAKISTAN (PKKHI) | Match |
| container_count | 6 x 40'HC | 6 x 40'HC | Match |
| gross_weight_kg | 131,058 KG | 131,058 KG | Match |

→ `status: "MISMATCH"`, `defect_fields: ["consignee", "notify_party"]` — exactly the submission shown below.

---
### Required Output (submission contract)
Regardless of internal design, the system must be able to emit **one JSON object keyed by `email_id`**, covering every email in the dataset, shaped like `sample_submission.json`:

```json
{
  "email_004": {
    "category": "BL_COMPARISON",
    "status": "MISMATCH",
    "review_reason": null,
    "has_defect": true,
    "defect_fields": ["consignee", "notify_party"]
  }
}
```

- `status`: `OK` (all 7 fields match) · `MISMATCH` (≥1 field differs) · `NEEDS_REVIEW` (cannot decide).
- `review_reason` (only when `NEEDS_REVIEW`): `wrong_doc_type` | `missing_attachment` | `unreadable` | `missing_value`.
- Non-comparison categories (`SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`) only need `category` populated — no comparison fields apply.

This is the minimum required shape for self-evaluation. Everything else described below (evidence, confidence, normalized values) is internal richness the system is free to keep on top of it.

In the worker-facing UI, these same outcomes are shown as boxes: `OK` → **MATCH**, `MISMATCH` → **MISMATCH**, `NEEDS_REVIEW` → **WORKERS REVIEW**.

---
### Sample
| Email | Condition / Result | Action |
| :--- | :--- | :--- |
| **BL_Comparison** | Match | Done |
| | Mismatch | Report the error |
| | Wrong document / Missing Attachment / Unreadable / Missing value | Need review |
| **SI_Request** | — | Categorized only |
| **Invoice_Query** | — | Categorized only |
| **Spam** | — | Categorized only |
| **General** | — | Categorized only |

---
### Scope: Basic vs. Advanced
The dataset and challenge are staged — build the basic version end-to-end before reaching for the advanced techniques.

**Basic (baseline):**
- JSON email records + **plain-text** SI/BL attachments only.
- Classification across all 5 categories.
- Extraction + comparison of the 7 fields for `BL_COMPARISON` emails.
- Correct submission JSON output.

**Advanced (once the basic pipeline works):**
| Challenge | What changes |
| :--- | :--- |
| **PDF and Word attachments** | Extract from tables and varied page layouts, not just flat text. |
| **Scanned documents** | Image-only PDFs/scans — needs OCR, a vision-capable LLM, or both. |
| **Messier inputs** | Varied field labels, inconsistent formatting, misleading subjects, missing attachments — the system must tell a real discrepancy apart from a reading/formatting issue. |
| **Reliability and human review** | Route unreadable/uncertain/incomplete cases to a person with source evidence and a reason; handle processing failures visibly and allow retries. |

Accuracy means catching the right requests and the right discrepancies without raising false alarms. The reliability challenge is specifically about what happens when the system *can't* make a dependable decision.

This isn't hypothetical scope — the sample bundle already contains the non-text attachments the advanced stage has to handle: `.pdf` SI/BL pairs (`email_059`, `email_160`), `.xlsx` pairs (`email_005`, `email_097` SI, `email_171`), and `.docx` BLs (`email_055`, `email_097`, `email_107`).

---
### Design Approach
Treat this as a reliability and decision-making problem, not just a document-classification problem. Build a modular pipeline, and keep AI and deterministic logic separated by responsibility:

1. **Inbox Ingestion** — read email records, subjects, bodies, attachment references (via `loader.py`'s `Inbox` class).
2. **Email Classification** — identify the 5 categories. Subject keywords are a first-pass signal (`REQUEST SI` / `SI NEEDED` / `CUST SI` → likely `SI_REQUEST`; `REQUEST BL DRAFT` / `TO CONFIRM DOCS` / `Draft BL ... amend` → likely `BL_COMPARISON`; `CHARGES` / `INVOICE` / `FREIGHT` → likely `INVOICE_QUERY`), but keywords alone aren't reliable — confirm with body content and attachment shape. A real `BL_COMPARISON` email has exactly an SI + a BL attachment; `email_012`'s subject contains "SI" but it's a zero-attachment `GENERAL` operations update, which a keyword-only classifier would get wrong.
3. **Document Processing** — read SI/BL attachments (plain text first; PDF/Word/OCR/vision in the advanced stage).
4. **Field Extraction & Normalization** — pull the 7 fields, map equivalent labels and equivalent document structures, standardize units/formatting. Label variants already present in the sample data: `Port of Loading (POL)` / `POL` / `Load Port`; `Consignee (Non-Negotiable)` on a straight B/L vs. `To the Order of` on an order B/L; `Notify` / `Notify Party`; `Total Containers` / `Container Count`; `Gross Wt (kgs)` / `Gross Weight (KG)` (`22,000 KG` ↔ `22000 kg`).
5. **Verification Engine** — compare normalized values with deterministic rules; separate true mismatches from extraction uncertainty.
6. **Decision & Reporting** — produce `OK` / `MISMATCH` / `NEEDS_REVIEW` with evidence (source location, original + normalized value) backing every field.
7. **Evaluation & Monitoring** — use the self-eval endpoint to catch classification/mismatch misses during development; separately track how the system behaves on missing/unclear/unreadable input, since the scoreboard doesn't grade escalation quality on its own.

| Component | Responsibility |
| :--- | :--- |
| **Classifier** | Decide the email category. |
| **Document Reader** | Extract raw content from attachments. |
| **Normalizer** | Standardize equivalent labels, structures, and value formats. |
| **Comparison Engine** | Apply explicit rules to normalized values. |
| **Review Manager** | Flag incomplete/uncertain cases with a reason and evidence. |
| **Report Generator** | Produce the submission JSON and the human-readable side-by-side report. |

**Ground rules carried into every stage:**
- Missing information is not a mismatch — recognize "cannot verify" as its own outcome.
- Measure false positives and false negatives separately; don't just chase the aggregate score.
- The self-eval scoreboard is a development aid, not the final assessment — it doesn't fully judge whether escalation happened at the right time with enough context.
- Develop against the participant bundle's data, not the answer key.

---
### System Architecture
This is not a website — it's a **Python pipeline** that runs as a batch/CLI process, plus an *optional*, separately-built UI layer deferred to Stage 4.

```
sdoc-hackathon-bundle (or Docker server)
        │  loader.Inbox
        ▼
 ┌───────────────┐ ┌────────────────┐ ┌───────────┐ ┌───────────────────┐
 │ classifier.py │→│ document_reader│→│normalizer │→│ comparison_engine │
 └───────────────┘ └────────────────┘ └───────────┘ └───────────────────┘
                                                             │
                                                             ▼
                                                     ┌────────────────┐
                                                     │ review_manager │
                                                     └────────────────┘
                                                             │
                                                             ▼
                                                     ┌──────────────────┐
                                                     │ report_generator │ → submission.json → inbox.submit()
                                                     └──────────────────┘
```

- **Runtime shape:** a single Python entry point (e.g. `python -m pipeline`) that iterates `loader.Inbox`, runs every email through the modules above, and writes `submission.json` — no server, no database required to satisfy the graded contract. `inbox.submit(submission)` (or `POST /submit`) is called separately, on demand, for self-eval.
- **Module breakdown**, matching the Component Responsibility table in Design Approach: `classifier.py`, `document_reader.py` (text now; PDF/Word/OCR plug in later without changing the interface), `normalizer.py`, `comparison_engine.py`, `review_manager.py`, `report_generator.py`, orchestrated by one `pipeline.py`.
- **State:** the pipeline is stateless between runs — `submission.json` (plus whatever per-field evidence you choose to keep, e.g. a sibling `evidence.json`) is the only artifact. No DB is needed until the UI (Stage 4) needs somewhere to persist worker overrides.
- **The UI is explicitly out of scope for now** (per Development Strategy, it's Stage 4, built only after Stages 1–3 work) — when it is built, it will be a thin layer that reads the pipeline's output rather than reimplementing any of this logic.

---
### UI Specification
*(Stage 4 — deferred; build this only after the pipeline above is working end-to-end.)*

The worker-facing UI is a presentation layer over the submission JSON — every badge, filter, and action below maps directly onto `category` / `status` / `review_reason` / `defect_fields`, nothing it shows is invented separately from that contract.

**Shared badge convention** (used on every screen):
- `MATCH` (`status: OK`) — green.
- `MISMATCH` — red.
- `WORKERS REVIEW` (`status: NEEDS_REVIEW`) — yellow.
- `SI_REQUEST` / `INVOICE_QUERY` / `GENERAL` (categorized-only) — gray.
- `SPAM` — red, strikethrough subject text.

#### Screen 1 — Inbox / Triage view
The default landing screen: every processed email as one row.
- **Columns:** checkbox · Email ID · Subject (truncated, full text on hover) · From · Category badge · Status badge (`BL_COMPARISON` rows only) · Received date.
- **Filter tabs**, each with a live count badge: `All` · `MATCH` · `MISMATCH` · `WORKERS REVIEW` · `SI Request` · `Invoice Query` · `General` · `Spam`.
- **Search box** over subject / sender / email ID. **Sort control**: by date, or by status severity (`MISMATCH` and `WORKERS REVIEW` first).
- **Row click:** `BL_COMPARISON` rows open the Comparison Detail view (Screen 2); every other category opens a lightweight read-only preview (raw subject/body + assigned category — "categorized only," nothing to compare).
- **Bulk action:** select multiple `WORKERS REVIEW` rows → "Mark reviewed" once a worker has manually resolved them.
- **States:** skeleton rows while a batch is still processing; "No emails match this filter" empty state per tab.

#### Screen 2 — Comparison Detail view (`BL_COMPARISON` only)
- **Header:** subject, from, received date, category badge, overall status badge, and links to open the original SI and BL attachments.
- **Comparison table:** one row per field (`shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`, `container_count`, `gross_weight_kg`) — columns `Field` · `SI value` · `BL value` · `Result` (✓ green for match, ✗ red for mismatch, ⚠ amber for unreadable/missing). Mismatched rows get a red left-border highlight, matching the worked `email_004` example above.
- **Review banner** (shown only when `status: NEEDS_REVIEW`): plain-language statement of the `review_reason` (`wrong_doc_type` / `missing_attachment` / `unreadable` / `missing_value`), naming which attachment or field triggered it, with a jump link to the exact source text.
- **Worker actions:** `Confirm mismatch` (locks the report) · `Override` (requires a comment — e.g. "not a real mismatch, label variant," which feeds back into the Normalizer's synonym list) · `Escalate` (assign to someone else) · `Approve & close`.
- **Evidence drawer** (collapsible side panel): the raw extracted text snippet behind each field's value, for both SI and BL, so a worker can verify the extraction itself rather than trusting it blindly.

#### Screen 3 — Review Queue view
The `WORKERS REVIEW` subset of the inbox, grouped by `review_reason` into four collapsible sections (`Wrong Document`, `Missing Attachment`, `Unreadable`, `Missing Value`), each with a count badge. Each card shows the email subject, a one-line evidence snippet, and an `Open` action into Screen 2.

#### Interaction flow
Inbox row click → Comparison Detail view → worker takes an action → the row's status badge updates in place back in the Inbox (with a toast confirmation) → if it was a `WORKERS REVIEW` case, its card drops out of the Review Queue once resolved.

---
### Working with the Data
Two equivalent ways to access the dataset, both through the same `loader.py` interface:

| Option | How you use it |
| :--- | :--- |
| **Static bundle** | Unzip `sdoc-hackathon-bundle/` (`inbox/`, `attachments/`, `sample_submission.json`, `loader.py`) and read the files directly — no service needed. |
| **Local server (Docker)** | `docker compose up --build` in `sdoc-hackathon-docker/` serves the same dataset over HTTP at `http://localhost:8080`, plus a self-eval endpoint. |

```python
from loader import Inbox

inbox = Inbox("data")  # or Inbox("http://localhost:8080")
for email in inbox:
    for path in email["attachments"]:
        text = inbox.read_text(path)
```

Submit a result for self-scoring with `inbox.submit(submission)` (HTTP only) or `POST /submit`. The response is a scoreboard — final score = 50% end-to-end defect catch + 30% Stage-1 classification macro-F1 + 20% Stage-3 defect-F1, with `NEEDS_REVIEW` handling reported as a separate reliability axis. Ground truth is never returned by any endpoint.

---
### Development Strategy
1. **Stage 1 — Baseline:** end-to-end pipeline, plain-text only, classification + basic JSON output.
2. **Stage 2 — Correctness:** field normalization, missing-value handling, validation.
3. **Stage 3 — Realistic Documents:** PDF/Word/OCR/vision support, error handling, retries.
4. **Stage 4 — Demonstrable UI:** build the three screens from the UI Specification section above (Inbox, Comparison Detail, Review Queue) as a presentation layer over the submission JSON — not a replacement for it.
