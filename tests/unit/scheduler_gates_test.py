"""Auto gate deploys in .nova/cloud_scheduler.py and .nova/gate_result.py (no network)."""
import importlib.util, json, os, sys, time, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


S = load("sched", ".nova/cloud_scheduler.py")
G = load("gate_result", ".nova/gate_result.py")
calls = []
S.act = lambda *a: calls.append(a) or ""
RUNS = {"workflow_runs": []}
S.api = lambda path: RUNS if "deploy-backend-staging" in path else {}


def q(st14="owner_gate", after_status="done"):
    items = [{"id": "N109", "status": after_status},
             {"id": "GATE-14", "status": st14, "after": ["N109"]},
             {"id": "GATE-17", "status": "owner_gate", "after": []}]
    return items, {t["id"]: t for t in items}


# 1. not ready -> nothing
items, byid = q(after_status="failed"); S.gate_deploys(items, byid)
assert not calls and byid["GATE-14"]["status"] == "owner_gate"
# 2. ready -> dispatch deploy with gate id; GATE-17 never dispatched even with no deps
items, byid = q(); S.gate_deploys(items, byid)
assert len(calls) == 1, calls
c = calls[0]
assert c[:4] == ("gh", "workflow", "run", "deploy-backend-staging.yml") and "gate_id=GATE-14" in c
assert "dry_run=false" in c and "confirm=DEPLOY nova-rx-api-staging" in c and "--ref" in c and "main" in c
assert byid["GATE-14"]["status"] == "deploying" and byid["GATE-17"]["status"] == "owner_gate"
assert "GATE-17" not in S.AUTO_GATES
# 3. deploying, fresh -> untouched
calls.clear(); S.gate_deploys(items, byid); assert not calls and byid["GATE-14"]["status"] == "deploying"
# 4. stale + run success -> done; stale + run failure -> failed; stale + in progress -> waits
old = datetime.datetime.fromtimestamp(S.NOW - 4000, datetime.timezone.utc).isoformat()
newer = datetime.datetime.fromtimestamp(S.NOW - 3990, datetime.timezone.utc).isoformat()
for concl, status, want in (("success", "completed", "done"), ("failure", "completed", "failed"), (None, "in_progress", "deploying")):
    items, byid = q("deploying"); byid["GATE-14"]["dispatched_at"] = old
    RUNS["workflow_runs"] = [{"display_title": "gate GATE-14 deploy", "created_at": newer, "status": status, "conclusion": concl, "html_url": "u"}]
    S.gate_deploys(items, byid); assert byid["GATE-14"]["status"] == want, (concl, byid["GATE-14"])
# 5. stale + no run -> failed
items, byid = q("deploying"); byid["GATE-14"]["dispatched_at"] = old; RUNS["workflow_runs"] = []
S.gate_deploys(items, byid); assert byid["GATE-14"]["status"] == "failed"

# gate_result.apply
qq = {"tasks": [{"id": "GATE-14", "status": "deploying"}, {"id": "GATE-17", "status": "owner_gate"}]}
res = {"status": "done", "sha": "abc", "version_id": "v2", "previous_version_id": "v1", "bookmark": "b", "migrated": False, "at": "t"}
assert G.apply(qq, "GATE-14", res, "success", "url", "now")
g = qq["tasks"][0]
assert g["status"] == "done" and g["deploy"]["version_id"] == "v2" and g["deploy"]["sha"] == "abc" and g["deployed_at"] == "t"
assert G.apply(qq, "GATE-14", {"status": "failed"}, "failure", "url", "now") and g["status"] == "failed"
assert G.apply(qq, "GATE-14", res, "failure", "url", "now") and g["status"] == "failed"  # job red wins
assert not G.apply(qq, "GATE-17", res, "success", "url", "now") and qq["tasks"][1]["status"] == "owner_gate"
print("scheduler gates: ok")
