# Run the web app locally

**Terminal 1: backend (API on port 8000)**

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn api:app --port 8000
```

To check that it's up, open http://localhost:8000/health. It should return `{"status":"ok"}`.

**Terminal 2: frontend (web app)**

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Then open the URL it prints, usually http://localhost:5173. See `DEPLOY.md` for putting it online.

---

# Run the pipeline and get the final score

All commands are for **PowerShell** (the default terminal in VS Code on Windows).
Run them from the repo root, i.e. the folder you get after cloning this repo.

## 1. One-time setup

```powershell
git clone https://github.com/fang0807/PanMee-SDOC-Hackathon.git
cd PanMee-SDOC-Hackathon
python --version              # should print Python 3.x
pip install pypdf openpyxl    # readers for PDF and Excel attachments
```

## 2. Run the pipeline and get the score (everyday command)

```powershell
cd backend
$env:PYTHONIOENCODING = "utf-8"
python main.py
```

What happens:

1. `main.py` reads every email in the inbox, classifies it, and compares the
   SI against the draft BL.
2. It writes `results.json` (full detail) and `submission.json` (the file to hand in).
3. It then calls `server/score_cli.py` on `submission.json` and prints the report.

The line you care about:

```
FINAL SCORE  1.0000   (w: s1=0.3, s3=0.2, e2e=0.5)
```

| Part | Weight | Meaning |
|---|---|---|
| End-to-end | 50% | Defect emails caught all the way through |
| Stage 1 | 30% | Email classification macro-F1 |
| Stage 3 | 20% | BL-vs-SI defect F1 |

`NEEDS_REVIEW` handling is reported separately as the "reliability" section.

## 3. Score only (without re-running the pipeline)

Use this after editing `submission.json` by hand, or to re-check a saved file:

```powershell
cd server
python score_cli.py ..\submission.json

# machine-readable output
python score_cli.py ..\submission.json --json
```

`score_cli.py` grades against `data_v2/ground_truth.json` (the answer key).

## 4. Show only the score lines

The PDF reader prints harmless `startxref` / `EOF marker` warnings. To hide them:

```powershell
python main.py 2>$null | Select-String "FINAL SCORE|accuracy|defect|rate"
```

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `UnicodeEncodeError: 'charmap' codec ...` | Run `$env:PYTHONIOENCODING = "utf-8"` first |
| `Skipping score: ... score_cli.py not found` | Make sure the `server/` folder is present next to `main.py` (run `git pull`) |
| `ModuleNotFoundError: pypdf` or `openpyxl` | Run `pip install pypdf openpyxl` |
| `startxref` / `EOF marker not found` lines | Harmless warnings about malformed PDFs; the run still finishes |
| Score step fails: ground truth not found | Make sure `data_v2/ground_truth.json` is present (run `git pull`) |

## 6. Note on the score

`1.0000` is the result on the local 520-email dataset. The pipeline rules were tuned
by comparing against this dataset's answer key, so a hidden or different test set
may score lower.
