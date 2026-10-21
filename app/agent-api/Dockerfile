# Build from the repo root: docker build -f app/agent-api/Dockerfile .
# (the API imports the shared pipeline and guidelines from eval/)
FROM python:3.12-slim

# git: requirements.txt installs Lár from a pinned GitHub commit
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY eval/lar_agent/agent.py eval/lar_agent/retrieval.py eval/lar_agent/
COPY eval/guidelines eval/guidelines
COPY app/agent-api/main.py app/agent-api/main.py

WORKDIR /srv/app/agent-api
ENV TRIAGE_LEDGER_PATH=/data/app_authority_ledger.json
VOLUME /data
EXPOSE 8010
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
