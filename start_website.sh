#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=5000
FRONTEND_PORT=3000

find_pid_by_port() {
  local port="$1"
  ss -ltnp "( sport = :$port )" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -n1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="${3:-60}"
  local elapsed=0

  until curl -fsS "$url" >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if (( elapsed >= timeout_seconds )); then
      echo "$name did not become ready within ${timeout_seconds}s."
      return 1
    fi
  done
}

stop_port_if_running() {
  local port="$1"
  local pid
  pid="$(find_pid_by_port "$port" || true)"
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

echo "Stopping existing OmniFind processes..."
stop_port_if_running "$BACKEND_PORT"
stop_port_if_running "$FRONTEND_PORT"

echo "Starting backend on :$BACKEND_PORT"
cd "$ROOT_DIR"
nohup npm start >/tmp/omnifind-server.log 2>&1 &
echo $! >/tmp/omnifind-server.pid

echo "Starting frontend on :$FRONTEND_PORT"
cd "$ROOT_DIR/frontend"
nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" >/tmp/omnifind-client.log 2>&1 &
echo $! >/tmp/omnifind-client.pid

if ! wait_for_http "Backend" "http://127.0.0.1:${BACKEND_PORT}/api/health" 120; then
  echo "Backend failed to start. Recent backend log output:"
  tail -n 120 /tmp/omnifind-server.log || true
  exit 1
fi

if ! wait_for_http "Frontend" "http://127.0.0.1:${FRONTEND_PORT}/" 90; then
  echo "Frontend failed to start. Recent frontend log output:"
  tail -n 120 /tmp/omnifind-client.log || true
  exit 1
fi

echo "Backend health:"
curl -sS "http://127.0.0.1:${BACKEND_PORT}/api/health"
echo
echo "Frontend head:"
curl -sS "http://127.0.0.1:${FRONTEND_PORT}/" | head -c 120
echo
echo "OmniFind started."
