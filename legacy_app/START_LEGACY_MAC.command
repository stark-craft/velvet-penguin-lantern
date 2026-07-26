#!/bin/zsh

set -e

LEGACY_ROOT="${0:A:h}"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

cd "$LEGACY_ROOT"
echo "Starting Sense.AI FastAPI backend on http://127.0.0.1:8000"
"$LEGACY_ROOT/.venv/bin/uvicorn" main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cd "$LEGACY_ROOT/news-ui"
echo "Starting the Sense.AI frontend on http://127.0.0.1:5173"
npm run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

echo ""
echo "Sense.AI is starting."
echo "NewsScrapper: http://127.0.0.1:5173/home"
echo "Venture Lens: http://127.0.0.1:5173/venturelens"
echo "Keep this window open. Press Control-C to stop both services."

wait
