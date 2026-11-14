"""qa_loop.py id/focus/one-at-a-time logic and scheduler preview deploy trigger (no network)."""
import importlib.util, json, os, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


Q = load("qa_loop", ".nova/qa_loop.py")
S = load("sched", ".nova/cloud_scheduler.py")
tmp = tempfile.mkdtemp(); inbox = os.path.join(tmp, "inbox"); os.mkdir(inbox)
json.dump({"tasks": [{"id": "UX90"}, {"id": "FIX41"}]}, open(os.path.join(inbox, "a.json"), "w"))
tasks = [{"id": "UX5", "status": "done"}, {"id": "FIX3"}]
assert Q.next_id(tasks, inbox) == 91
assert Q.next_id([], os.path.join(tmp, "none")) == 1
assert Q.disabled({"QA_LOOP_DISABLED": "true"}) and not Q.disabled({"QA_LOOP_DISABLED": "false"}) and not Q.disabled({})
assert len(Q.FOCUS) == 14 and Q.FIX_CAP == 15 and Q.focus_for([], os.path.join(tmp, "none")) == Q.FOCUS[0]
assert "invoices" in Q.FOCUS and "conversations (WhatsApp inbox)" in Q.FOCUS
json.dump({"tasks": [{"id": "UX91"}]}, open(os.path.join(inbox, "qa-loop-91.json"), "w"))
assert Q.focus_for([], inbox) == Q.FOCUS[1]
assert Q.busy([{"id": "UX1", "source": "inbox/qa-loop-1.json", "status": "pending"}])
assert Q.busy([{"id": "UX1", "source": "inbox/qa-loop-1-fixes.json", "status": "running"}])
assert not Q.busy([{"id": "UX1", "source": "inbox/qa-loop-1.json", "status": "done"},
                   {"id": "UX2", "source": "inbox/qa-loop-1-fixes.json", "status": "failed"},
                   {"id": "UX3", "source": "inbox/ux-pro.json", "status": "pending"}])
# run(): creates one task, then refuses while it is in flight, and honours the pause switch
qf = os.path.join(tmp, "q.json"); json.dump({"tasks": tasks}, open(qf, "w"))
before = open(qf).read()
assert Q.run({"QA_LOOP_DISABLED": "true"}, qf, inbox) is None
p = Q.run({}, qf, inbox); assert p.endswith("qa-loop-92.json"), p
t = json.load(open(p))["tasks"][0]
assert t["id"] == "UX92" and "UX93..UX107" in t["brief"] and "qa-loop-92.md" in t["brief"] and "nova-rx-preview.qa-92.js (qa-loop, no deploy)" in t["brief"]
assert "at most 15 frontend-only" in t["brief"] and "click every top-nav" in t["brief"].lower()
assert "404" in t["brief"] and "blank page" in t["brief"] and "console error" in t["brief"]
assert "المحادثات" in t["brief"]
assert open(qf).read() == before
json.dump({"tasks": tasks + [{"id": "UX92", "source": "inbox/qa-loop-92.json", "status": "running"}]}, open(qf, "w"))
assert Q.run({}, qf, inbox) is None

# preview deploy trigger
calls = []; S.act = lambda *a: calls.append(a) or ""
RUN = {"workflow_runs": []}; S.api = lambda path: RUN
art = "worker/live/nova-rx-preview.qa-92.js"
S._sha256 = lambda p: "a" * 64
def mk(status="done"):
    items = [{"id": "UX101", "title": f"Build {art} (qa-loop, no deploy)", "status": status}]
    return items, {i["id"]: i for i in items}
items, byid = mk("running"); S.preview_deploys(items, byid, exists=lambda p: True); assert not calls
items, byid = mk(); S.preview_deploys(items, byid, exists=lambda p: False); assert not calls
S.preview_deploys(items, byid, exists=lambda p: True)
c = calls[0]; assert c[:4] == ("gh", "workflow", "run", "deploy-worker.yml") and "dry_run=true" in c and f"artifact_path={art}" in c
assert not any("production" in x or "staging" in x for x in c)
d = items[0]["preview_deploy"]; assert d["stage"] == "dry"
fresh = S.iso(S.NOW + 5)
RUN["workflow_runs"] = [{"created_at": fresh, "status": "in_progress"}]
calls.clear(); S.preview_deploys(items, byid, exists=lambda p: True); assert not calls and d["stage"] == "dry"
RUN["workflow_runs"] = [{"created_at": fresh, "status": "completed", "conclusion": "success", "html_url": "u"}]
S.preview_deploys(items, byid, exists=lambda p: True)
assert d["stage"] == "real" and "dry_run=false" in calls[0] and "confirm=DEPLOY nova-rx-preview" in calls[0]
S.preview_deploys(items, byid, smoke=lambda: (True, "ok"), exists=lambda p: True); assert d["stage"] == "deployed"
# already deployed -> never again
calls.clear(); S.preview_deploys(items, byid, exists=lambda p: True); assert not calls
# smoke failure with a previous artifact -> rollback to it
items, byid = mk(); items[0]["preview_deploy"] = {"stage": "real", "path": art, "sha256": "a" * 64, "at": fresh,
    "previous": {"path": "worker/live/nova-rx-preview.qa-80.js", "sha256": "b" * 64}}
S.preview_deploys(items, byid, smoke=lambda: (False, "boom"), exists=lambda p: True)
d2 = items[0]["preview_deploy"]; assert d2["stage"] == "rollback" and "artifact_path=worker/live/nova-rx-preview.qa-80.js" in calls[-1]
# non-qa build titles never deploy
calls.clear(); items = [{"id": "UX80", "title": "Build worker/live/nova-rx-preview.ux-pro3.js (x)", "status": "done"}]
S.preview_deploys(items, {"UX80": items[0]}, exists=lambda p: True); assert not calls
print("qa_loop tests ok")
