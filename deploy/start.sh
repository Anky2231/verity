#!/usr/bin/env bash
# Starts the AI service (localhost only) and then the API in the foreground.
# Defaults match the Docker image; override ROOT and PYBIN to run it from a checkout.
set -euo pipefail
ROOT="${ROOT:-/app}"
PYBIN="${PYBIN:-/opt/venv/bin/python}"
AI_PORT="${AI_PORT:-8001}"

(cd "$ROOT/ai" && exec "$PYBIN" -m uvicorn app.main:app --host 127.0.0.1 --port "$AI_PORT") &
AI_PID=$!
trap 'kill $AI_PID 2>/dev/null || true' EXIT

# Wait (up to ~30 s) for the AI service so the first request does not fail.
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$AI_PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done

export AI_SERVICE_URL="http://127.0.0.1:$AI_PORT"
cd "$ROOT/api"
node src/index.js
