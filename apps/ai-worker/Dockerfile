FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

FROM base AS deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM deps AS runner
COPY app ./app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
