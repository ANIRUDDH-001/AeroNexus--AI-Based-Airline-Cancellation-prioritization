# AeroNexus API image (Plan §20). Build from the repository root so the packages are in context:
#   docker build -f apps/api/Dockerfile -t aeronexus-api .
#   docker run -p 8000:8000 -e AERONEXUS_DB_URL=... aeronexus-api
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/core packages/core
COPY packages/datagen packages/datagen
COPY packages/ml packages/ml
COPY apps/api apps/api
COPY configs configs
COPY data/cases data/cases
COPY data/benchmarks data/benchmarks
RUN pip install -e packages/core -e packages/datagen -e "packages/ml[boost]" -e apps/api

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["sh", "-c", "uvicorn aeronexus_api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
