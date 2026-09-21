# Run and deploy the live system

The system has two parts that talk over HTTP:

- **Backend** (`backend/api.py`): FastAPI app that runs the SI-vs-BL pipeline on uploaded files.
- **Frontend** (`frontend/`): React app. Its **Live check** page uploads an SI and a BL to the backend and shows the result.

`python main.py` (see `RUN_AND_SCORE.md`) still runs the batch pipeline and scoring on its own.

## Where the data comes from (no database)

- **The 520 sample emails.** `backend/export_ui_data.py` runs the pipeline over the whole inbox and writes
  `backend/ui_data.json`. The API serves it at `GET /api/emails`, and the website loads it on start.
  The script also checks every record against `submission.json` and fails if they differ.
  Run it again, and commit the file, whenever the pipeline changes:

  ```powershell
  cd backend
  python export_ui_data.py
  ```

- **Searching the sample emails.** `GET /api/emails/search?q=...` filters the same records by words in the
  id, subject, sender, body or SI/BL values. Optional `status`, `category`, `limit`, `offset`, and `ids`
  (a comma-separated list to search within, because the server keeps no resend queue). It reads the same
  in-memory data, so it needs no database.
- **The original SI and BL files.** The Manual Review Workspace shows them through
  `GET /api/emails/{id}/attachments/{SI|BL}/file` (also `/text` and `/sheet`). They are read from
  `backend/attachments/` (1.6 MB), which is copied into the Docker image, so keep it out of
  `backend/.dockerignore`. Without it the deployed preview returns 404.
- **Live checks.** `POST /api/process` takes an SI and a BL plus optional email subject, sender and message metadata.
  The comparison itself skips classification and the uploads are deleted after the check. The sender address is
  required for Auto Reply / Resend to address a client. The result is
  shown on the Live check page with two choices: **Save to Verification** or **Run next test**. Saving keeps
  only the result, in that browser's `localStorage` (latest 50): it then appears in Verification and Overview
  there, but it is private to that browser, is lost if site data is cleared, and has no attachment preview
  because the files are never kept. An unsaved result is gone after a refresh.
- **Manual review decisions** (Match, Resend, Keep in review) are not saved and reset on refresh.

## Run locally

Terminal 1, the API:

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn api:app --port 8000
```

Terminal 2, the web app:

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open the printed URL (usually http://localhost:5173), choose **Live check**, upload an SI and a BL
(for example `backend/attachments/email_004_SI.txt` and `email_004_BL.txt`) and press **Run check**.

Scanned PDFs and images need the Tesseract program on your machine. Without it they are sent to
manual review. The Docker image below already includes it.

## Deploy

### 1. Backend on Render (or Railway / Fly) with Docker

The backend now imports the standalone `plugins/autoreply_plugin` package, so the Docker build context must be the **repository root** (not only `backend/`). A root `Dockerfile` is provided for this.

1. Push the repo to GitHub.
2. Render: **New > Web Service**, pick the repo, leave **Root Directory** at the repository root, and use **Runtime: Docker**.
3. Add `ALLOWED_ORIGINS` set to your Vercel URL, for example `https://your-app.vercel.app`.
4. For live Match auto-replies, also add `AUTOREPLY_LIVE_SEND=1`, `AUTOREPLY_SMTP_USERNAME`, `AUTOREPLY_SMTP_PASSWORD` (Gmail App Password), and `AUTOREPLY_FROM_ADDRESS`.
5. Deploy, then open `https://<your-service>.onrender.com/health`. It should return `{"status":"ok"}`.

Free plans sleep when idle. Open the `/health` URL a minute before a demo.

Test the image locally before deploying, from the repository root:

```powershell
docker build -t smartdoc-api .
docker run --rm -p 8000:8000 smartdoc-api
```

### 2. Frontend on Vercel

1. **Add New > Project**, pick the same repo, set **Root Directory** to `frontend`.
2. Framework preset **Vite** (build `npm run build`, output `dist`).
3. Add the environment variable `VITE_API_URL` set to the backend URL from step 1.
4. Deploy. If you later change `VITE_API_URL`, redeploy, because Vite bakes it in at build time.

Once the Vercel URL is known, go back to the backend and make sure `ALLOWED_ORIGINS` matches it exactly
(no trailing slash), otherwise the browser blocks the requests.
