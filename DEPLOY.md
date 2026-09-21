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

- **Live checks.** `POST /api/process` does not store anything. The website keeps the results of your live
  checks in this browser's `localStorage`, so they survive a refresh but are private to that browser and
  disappear if site data is cleared.
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

1. Push the repo to GitHub.
2. Render: **New > Web Service**, pick the repo, set **Root Directory** to `backend`, **Runtime** to Docker.
3. Add the environment variable `ALLOWED_ORIGINS` set to your Vercel URL, for example
   `https://your-app.vercel.app`. Separate several origins with commas.
4. Deploy, then open `https://<your-service>.onrender.com/health`. It should return `{"status":"ok"}`.

Free plans sleep when idle. Open the `/health` URL a minute before a demo.

Test the image locally before deploying:

```powershell
cd backend
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
