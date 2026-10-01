#!/usr/bin/env bash
# Boot the REAL Worker (src/worker.js) under `wrangler dev` against a LOCAL, persisted D1
# database, run one command against it, then shut the worker down again.
#
# Why this exists: Cloudflare's free-tier D1 meter is a per-account, per-day counter. While
# it is exhausted the deployed worker refuses every write, so POST /api/command cannot be
# exercised against production. This harness runs the identical worker code, identical SQL
# and identical routes against local D1, which is a genuine test of the durable path — the
# only thing it does not reproduce is Cloudflare's quota enforcement.
#
# Because the D1 state is persisted under $PERSIST, each invocation starts from whatever the
# previous one left behind. Restarting wrangler also throws the isolate away, so state that
# comes back after a restart was genuinely read back out of D1.
#
# Usage: scripts/local-durable-dev.sh '<shell command to run against the local worker>'
#   env: MAULI_LOCAL_PORT (8787)  MAULI_LOCAL_PERSIST (/tmp/mauli-d1)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORT="${MAULI_LOCAL_PORT:-$((8800 + RANDOM % 900))}"
PERSIST="${MAULI_LOCAL_PERSIST:-/tmp/mauli-d1}"
LOG="${MAULI_LOCAL_LOG:-/tmp/mauli-wrangler-dev.log}"

mkdir -p "$PERSIST"
: > "$LOG"

# setsid gives wrangler (and the workerd it spawns) their own process group, so the trap
# below can take the whole group down. Without it workerd survives as an orphan and the next
# invocation dies with "Address already in use".
# MAULI_LOCAL_VARS lets a verification run inject extra plain-text vars, e.g.
# MAULI_LOCAL_VARS="MAULI_TASK_TIMEOUT_MS:20000".
EXTRA_VARS=()
if [ -n "${MAULI_LOCAL_VARS:-}" ]; then
  IFS=',' read -r -a EXTRA_VARS <<< "$MAULI_LOCAL_VARS"
fi

setsid npx wrangler dev --port "$PORT" --ip 127.0.0.1 --local --persist-to "$PERSIST" \
  --var MAULI_FOUNDER_KEY:Mauli123 "${EXTRA_VARS[@]+"${EXTRA_VARS[@]}"}" > "$LOG" 2>&1 &
WRANGLER_PID=$!
cleanup() {
  kill -TERM -"$WRANGLER_PID" 2>/dev/null
  sleep 1
  kill -KILL -"$WRANGLER_PID" 2>/dev/null
  wait "$WRANGLER_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

ready=0
# Probe with a route that is NOT on the worker's "light path" list (worker.js), so readiness
# also means ensureSchema + the D1 hydrate have finished. Otherwise the first real request
# pays for hydration and can look like a hang.
for _ in $(seq 1 "${MAULI_LOCAL_READY_TRIES:-45}"); do
  sleep 2
  if curl -s -m 25 "http://127.0.0.1:$PORT/api/artifacts" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then break; fi
done

if [ "$ready" != "1" ]; then
  echo "wrangler dev never became ready on port $PORT"
  tail -40 "$LOG"
  exit 1
fi
echo "wrangler dev ready on http://127.0.0.1:$PORT  (d1 persist: $PERSIST, log: $LOG)"
echo "$PORT" > /tmp/mauli-local-port
echo

MAULI_BASE="http://127.0.0.1:$PORT" bash -c "$*"
status=$?

echo
echo "--- wrangler dev log (tail) ---"
tail -25 "$LOG"
exit $status
