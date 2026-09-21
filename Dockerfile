FROM python:3.12-slim

# Tesseract is the OCR engine used for scanned attachments.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Keep the backend and the standalone Auto Reply plugin as sibling packages,
# matching the layout used during local development.
COPY backend/ /app/backend/
COPY plugins/ /app/plugins/

WORKDIR /app/backend

# One worker: the pipeline keeps state in module globals.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
