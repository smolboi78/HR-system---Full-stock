FROM python:3.11-slim

# WeasyPrint (PDF reports) needs Pango/Cairo/GDK-Pixbuf at the system level -
# pip alone isn't enough. libpq-dev is for psycopg building from source if
# no wheel matches; harmless to keep.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Runs migrations, then seeds the first admin user + holidays + category
# rules (idempotent - safe on every deploy), then starts the API.
CMD alembic upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
