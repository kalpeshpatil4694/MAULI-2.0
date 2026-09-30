#!/usr/bin/env python3
"""Full durable-path verification for MAULI 2.0.

Exercises the real founder flow end to end and reports a verdict per stage, so a
failure names the stage that broke instead of "something did not work":

  1. POST /api/command              -> project + tasks persisted (durable write)
  2. GET  /api/projects/:id/detail  -> task history readable after the fact
  3. GET  /api/artifacts            -> AI artifact present
  4. GET  /api/artifacts/:id/download -> the actual AI-generated app downloads

Nothing here is a template path: the artifact metadata records which generator
produced it, and that is asserted explicitly.
"""
import json, subprocess, sys, time

BASE = "https://mauli-2-0.kalpeshpatil4694.workers.dev"
KEY = "Mauli123"
OBJECTIVE = sys.argv[1] if len(sys.argv) > 1 else "Build a simple calculator web app"


def call(method, path, body=None, raw=False, timeout=180):
    # Cloudflare answers Python's urllib with "error code: 1010", so every request here
    # goes out through curl, which is what the founder's browser and the dashboard do.
    cmd = ["curl", "-s", "--max-time", str(timeout), "-X", method, BASE + path,
           "-H", f"x-mauli-founder: {KEY}", "-H", "content-type: application/json",
           "-w", "\n__STATUS__%{http_code}"]
    if body is not None:
        cmd += ["--data-binary", json.dumps(body)]
    proc = subprocess.run(cmd, capture_output=True)
    out = proc.stdout
    marker = out.rfind(b"\n__STATUS__")
    status = int(out[marker + 11:].strip() or 0) if marker != -1 else 0
    payload = out[:marker] if marker != -1 else out
    if raw:
        return status, payload
    try:
        return status, json.loads(payload)
    except Exception:
        return status, payload[:400].decode("utf8", "replace")


def blocked(payload):
    txt = json.dumps(payload)
    return "row write limit" in txt or "writes are blocked" in txt or "write blocked" in txt


def verdict(ok, label, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + ("  — " + detail if detail else ""))
    return ok


print(f"objective: {OBJECTIVE}\n")

# ---- stage 0: is the write path open at all? --------------------------------
status, resp = call("POST", "/api/command", {"command": OBJECTIVE})
if status != 200 or (resp.get("data") or resp).get("result", {}).get("status") == "error":
    if blocked(resp):
        print(f"WRITES STILL REFUSED at {time.strftime('%H:%M:%S UTC', time.gmtime())}")
        print(json.dumps(resp)[:400])
        sys.exit(2)
    print("unexpected failure:")
    print(json.dumps(resp)[:600])
    sys.exit(3)

result = resp.get("result") or resp.get("data", {}).get("result")
project = result.get("project") or {}
run_id = resp.get("runId") or result.get("runId")
approval = result.get("approval") or {}
project_id = project.get("id")
print(f"  runId   {run_id}")
print(f"  project {project_id}  state={project.get('state')}")
print(f"  status  {result.get('status')}  risk={(approval.get('risk') if approval else '-')}\n")

results = []
results.append(verdict(bool(project_id), "1. project created", str(project_id)))

# ---- stage 1: approve if a high-risk command opened an approval gate --------
if approval.get("id"):
    st, ap = call("POST", f"/api/approvals/{approval['id']}", {"approved": True, "note": "durable path verification"})
    body = ap.get("data") or ap
    results.append(verdict(st == 200 and body.get("status") == "approved", "2. approval accepted",
                           f"project now {(body.get('project') or {}).get('state')}"))

# ---- stage 2: wait for the chain to finish ---------------------------------
deadline = time.time() + 1500
detail = {}
while time.time() < deadline:
    time.sleep(25)
    st, d = call("GET", f"/api/projects/{project_id}/detail")
    detail = (d.get("data") or {}).get("detail") or {}
    tasks = detail.get("tasks") or []
    done = sum(1 for t in tasks if t.get("state") == "completed")
    failed = sum(1 for t in tasks if t.get("state") == "failed")
    print(f"  ... {done}/{len(tasks)} completed, {failed} failed, project={detail.get('project', {}).get('state')}")
    if tasks and done == len(tasks):
        break
    if failed:
        break

tasks = detail.get("tasks") or []
done = sum(1 for t in tasks if t.get("state") == "completed")
results.append(verdict(bool(tasks) and done == len(tasks), "3. task history durable and complete",
                       f"{done}/{len(tasks)} tasks, project={detail.get('project', {}).get('state')}"))

summary = detail.get("summary") or {}
print(f"  summary: {summary.get('completedTasks')}/{summary.get('totalTasks')} completed, "
      f"progress {summary.get('progressPct')}%")

# ---- stage 3: the AI artifact ---------------------------------------------
st, arts = call("GET", f"/api/artifacts?projectId={project_id}")
alist = (arts.get("data") or {}).get("artifacts") or []
code = [a for a in alist if a.get("type") == "code-workspace"]
delivery = [a for a in alist if a.get("type") == "final-delivery"]
results.append(verdict(bool(code), "4. AI code artifact stored", f"{len(code)} code-workspace artifact(s)"))

generated_by = sorted({(a.get("metadata") or {}).get("generatedBy") for a in code})
print(f"  generatedBy: {generated_by}")
results.append(verdict("functional-code-executor" in generated_by,
                       "5. produced by the AI path, not a template",
                       str(generated_by)))

# ---- stage 4: download it --------------------------------------------------
target = delivery[0] if delivery else (code[0] if code else None)
if target:
    st, blob = call("GET", f"/api/artifacts/{target['id']}/download", raw=True)
    results.append(verdict(st == 200 and isinstance(blob, (bytes, bytearray)) and blob[:2] == b"PK",
                           "6. artifact downloads", f"{st}, {len(blob)} bytes, zip={blob[:2] == b'PK'}"))
    open("/tmp/durable-delivery.zip", "wb").write(blob)
    print("  saved to /tmp/durable-delivery.zip")
else:
    results.append(verdict(False, "6. artifact downloads", "no artifact to download"))

print()
failed = [r for r in results if not r]
print(("ALL STAGES PASSED" if not failed else f"{len(failed)} STAGE(S) FAILED") + f" ({len(results) - len(failed)}/{len(results)})")
sys.exit(1 if failed else 0)
