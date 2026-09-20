> **Note on folder layout:** this guide was written for the local workspace
> `PanMee-SDOC-Hackathon-1/`, where this repo sits as the sub-folder
> `PanMee-SDOC-Hackathon/` next to the organizers' `server/` and `data_v2/`
> folders. When you clone this repo, its contents (`main.py`, `classifier.py`, ...)
> are at the repo root, so skip the `cd PanMee-SDOC-Hackathon` steps. The scoring
> steps (sections 3 and 5) need the organizers' `server/` and `data_v2/` folders,
> which are not part of this repo.

# Run the pipeline and get the final score

All commands are for **PowerShell** (the default terminal in VS Code on Windows).
Open the terminal with ``Ctrl+` ``, with the repo root
`PanMee-SDOC-Hackathon-1` as the opened folder.

## 1. One-time setup

```powershell
python --version              # should print Python 3.x
pip install pypdf openpyxl    # readers for PDF and Excel attachments
```

## 2. Run the pipeline and get the score (everyday command)

```powershell
cd PanMee-SDOC-Hackathon
$env:PYTHONIOENCODING = "utf-8"
python main.py
```

What happens:

1. `main.py` reads every email in the inbox, classifies it, and compares the
   SI against the draft BL.
2. It writes `results.json` (full detail) and `submission.json` (the file to hand in).
3. It then calls `../server/score_cli.py` on `submission.json` and prints the report.

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
python score_cli.py ..\PanMee-SDOC-Hackathon\submission.json

# machine-readable output
python score_cli.py ..\PanMee-SDOC-Hackathon\submission.json --json
```

`score_cli.py` grades against `data_v2/ground_truth.json` (the organizers' answer key).

## 4. Show only the score lines

The PDF reader prints harmless `startxref` / `EOF marker` warnings. To hide them:

```powershell
cd PanMee-SDOC-Hackathon
python main.py 2>$null | Select-String "FINAL SCORE|accuracy|defect|rate"
```

## 5. Optional: score through the Docker server (HTTP)

Not needed for the normal run. Start Docker Desktop first.

```powershell
# from the repo root
docker compose up -d --build      # starts http://localhost:8080 in the background
```

Check `http://localhost:8080/health`. If it shows `"emails": 0`, the folder is not
under a path Docker can share, so move the project under your home folder.

```powershell
cd PanMee-SDOC-Hackathon
python -c "import json; from loader import Inbox; print(Inbox('http://localhost:8080').submit(json.load(open('submission.json'))))"
```

```powershell
docker compose down               # stop it when finished
```

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `UnicodeEncodeError: 'charmap' codec ...` | Run `$env:PYTHONIOENCODING = "utf-8"` first |
| `Skipping score: ... score_cli.py not found` | Keep the `server/` folder next to `PanMee-SDOC-Hackathon/` |
| `ModuleNotFoundError: pypdf` or `openpyxl` | Run `pip install pypdf openpyxl` |
| `startxref` / `EOF marker not found` lines | Harmless warnings about malformed PDFs; the run still finishes |
| Score step fails: ground truth not found | `data_v2/ground_truth.json` is missing (participant bundle); ask the organizers to score `submission.json` |

## 7. Note on the score

`1.0000` is the result on the local 520-email dataset. The pipeline rules were tuned
by comparing against this dataset's answer key, so a hidden or different test set
may score lower.
