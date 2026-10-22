# One container for the API and the AI service, so a single free web service can host both.
# The AI service listens on localhost only; the API is the public entry point.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY ai/requirements.txt ai/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r ai/requirements.txt

COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci --omit=dev

COPY ai ai
COPY api api
COPY deploy/start.sh /start.sh

ENV NODE_ENV=production
EXPOSE 10000
CMD ["bash", "/start.sh"]
