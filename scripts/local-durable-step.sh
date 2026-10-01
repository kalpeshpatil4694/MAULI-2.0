#!/usr/bin/env bash
# Drive one step of the local durable-path check. Designed to be run several times, each time
# through scripts/local-durable-dev.sh, because every invocation throws the isolate away and
# rebuilds it from the persisted D1 — which is exactly the durability property being tested.
#
#   scripts/local-durable-step.sh create "Build a simple calculator web app"
#   scripts/local-durable-step.sh drive [max_seconds]
#
# `create` queues a command, accepts its approval, and records the project id in
# $PROJECT_FILE. `drive` fires the scheduled handler (the same entry point production's cron
# uses) until the project reaches a terminal state or the time budget runs out, printing
# progress from a FRESHLY HYDRATED store each time.
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${MAULI_BASE:?run me through scripts/local-durable-dev.sh}"
PROJECT_FILE="${MAULI_PROJECT_FILE:-/tmp/mauli-project-id}"
MODE="${1:-drive}"
BUDGET="${2:-90}"
F="x-mauli-founder: Mauli123"

jqp() { python3 -c "import json,sys;d=json.load(sys.stdin);
def dig(o):
    o=o.get('data',o) if isinstance(o,dict) else o
    return o.get('result',o) if isinstance(o,dict) else o
print(eval(sys.argv[1]))" "$1"; }

case "$MODE" in
  create)
    curl -s -m 30 -X POST "$BASE/api/command" -H 'content-type: application/json' -H "$F" \
      --data-binary "$(python3 -c 'import json,sys;print(json.dumps({"command":sys.argv[1]}))' "${2:-Build a simple calculator web app}")" \
      > /tmp/mauli-command.json
    python3 - "$PROJECT_FILE" <<'PY'
import json, sys
d = json.load(open('/tmp/mauli-command.json'))
r = d.get('data', d).get('result', {})
p = r.get('project') or {}
open(sys.argv[1], 'w').write(p.get('id', ''))
print(f"  project {p.get('id')} state={p.get('state')}")
a = r.get('approval') or {}
if a.get('id'):
    print(f"  approval {a['id']} risk={a.get('risk')}")
PY
    AP=$(python3 -c "
import json
d=json.load(open('/tmp/mauli-command.json'));r=d.get('data',d).get('result',{})
print((r.get('approval') or {}).get('id',''))")
    if [ -n "$AP" ]; then
      curl -s -m 30 -X POST "$BASE/api/approvals/$AP" -H 'content-type: application/json' -H "$F" \
        --data-binary '{"approved":true,"note":"local durable verification"}' \
        | python3 -c "import json,sys;d=json.load(sys.stdin);b=d.get('data',d);print('  approved ->',b.get('status'),(b.get('project') or {}).get('state'))"
    fi
    ;;
  drive)
    PID=$(cat "$PROJECT_FILE")
    [ -n "$PID" ] || { echo "no project id in $PROJECT_FILE — run 'create' first"; exit 1; }
    end=$(( $(date +%s) + BUDGET ))
    while [ "$(date +%s)" -lt "$end" ]; do
      # Long client timeout on purpose: a cron tick that outlives its client gets cancelled
      # mid-flight, which looks exactly like a wedged scheduler.
      curl -s -m "${MAULI_CRON_TIMEOUT:-150}" -o /dev/null "$BASE/cdn-cgi/local/scheduled"
      sleep 2
      curl -s -m 20 -H "$F" "$BASE/api/projects/$PID/detail" > /tmp/mauli-detail.json 2>/dev/null
      python3 - <<'PY'
import json
d = json.load(open('/tmp/mauli-detail.json'))['data']['detail']
tasks = d.get('tasks') or []
c = {}
for t in tasks: c[t['state']] = c.get(t['state'], 0) + 1
done = c.get('completed', 0)
print(f"  project={d['project']['state']:<18} {done}/{len(tasks)} completed  {c}")
PY
      ST=$(python3 -c "
import json
d=json.load(open('/tmp/mauli-detail.json'))['data']['detail']
print(d['project']['state'])")
      case "$ST" in completed|failed|cancelled) echo "  terminal: $ST"; break;; esac
    done
    ;;
  diag)
    # Explain why the project is not advancing: per-task state, failure reason, recovery count,
    # plus whatever live-run/lease information the worker exposes.
    PID=$(cat "$PROJECT_FILE")
    [ -n "$PID" ] || { echo "no project id in $PROJECT_FILE — run 'create' first"; exit 1; }
    curl -s -m 25 -H "$F" "$BASE/api/projects/$PID/detail" > /tmp/mauli-detail.json
    python3 - <<'PY'
import json
d = json.load(open('/tmp/mauli-detail.json'))['data']['detail']
p = d['project']
tasks = d.get('tasks') or []
by_id = {t.get('id'): t for t in tasks}
print('project', p.get('id'), 'state=' + str(p.get('state')), 'updated=' + str(p.get('updatedAt')))
for t in sorted(tasks, key=lambda x: (x.get("sequence") or 0)):
    deps = [[dep[:8], (by_id.get(dep) or {}).get('state')] for dep in (t.get('dependsOn') or [])]
    print('  ' + json.dumps({k: t.get(k) for k in ('state', 'executor', 'attempts', 'infraRecoveries',
        'leaseUntil', 'blockedReason', 'error', 'verificationId', 'sequence', 'title') if k in t},
        default=str)[:260] + (' deps=' + json.dumps(deps) if deps else ''))
for r in (d.get('runs') or [])[:10]:
    print('  run ' + ' | '.join([str(r.get('state')), str(r.get('taskId')), 'attempt=' + str(r.get('attempt')),
                                'started=' + str(r.get('startedAt')), 'hb=' + str(r.get('heartbeatAt')),
                                'err=' + str(r.get('error'))[:200]]))
PY
    echo "--- /api/activity (last 40) ---"
    curl -s -m 25 -H "$F" "$BASE/api/activity?limit=40" | python3 -c "
import json,sys
d = json.load(sys.stdin)
b = d.get('data', d)
items = b.get('activities') or b.get('events') or b.get('items') or []
print('count:', len(items))
for e in items[-30:]:
    keep = {k: v for k, v in e.items() if k in ('at', 'createdAt', 'type', 'kind', 'taskId', 'runId',
           'projectId', 'reason', 'error', 'nextState', 'infraRecoveries', 'status')}
    print(' ', str(keep)[:260])
"
    echo "--- /api/state ---"
    curl -s -m 25 -H "$F" "$BASE/api/state" | python3 -c "
import json,sys
d = json.load(sys.stdin)
b = d.get('data', d)
runs = b.get('runs') or []
print('running runs:', len([r for r in runs if r.get('state') == 'running']))
for r in runs[:10]:
    print(' ', r.get('state'), r.get('taskId'), r.get('startedAt'), str(r.get('error'))[:160])
"
    ;;
  *)
    echo "unknown mode: $MODE"; exit 2;;
esac
