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

# preview deploy trigger is disabled (moved to auto-deploy-preview.yml; only newest artifact by commit time)
calls = []; S.act = lambda *a: calls.append(a) or ""
art = "worker/live/nova-rx-preview.qa-92.js"
def mk(status="done"):
    items = [{"id": "UX101", "title": f"Build {art} (qa-loop, no deploy)", "status": status}]
    return items, {i["id"]: i for i in items}
for st in ("running", "done"):
    items, byid = mk(st)
    S.preview_deploys(items, byid, exists=lambda p: True, live_modified=lambda: "2026-11-14T16:48:11", markers=lambda p: [])
    assert not calls and "preview_deploy" not in items[0]
items = [{"id": "UX80", "title": "Build worker/live/nova-rx-preview.ux-pro3.js (x)", "status": "done"}]
S.preview_deploys(items, {"UX80": items[0]}, exists=lambda p: True)
assert not calls
# marker helper still flags a stale artifact that lacks required markers
stale_sample = os.path.join(tmp, "stale-qa-219.js")
open(stale_sample, "w").write("novaWaBtn search only, no history")
assert S.missing_markers(stale_sample)
# UX400: a pre-UX400 PIN-gated UI lacks only the PIN-free inbox marker. index.html (the next artifact) has all.
pin_sample = os.path.join(tmp, "pin-wa-live3.js")
open(pin_sample, "w").write(" ".join(m for m in S.REQUIRED_MARKERS if m != "data-wa-inbox-open") + " waHistPin")
assert S.missing_markers(pin_sample) == ["data-wa-inbox-open"]
assert not S.missing_markers("index.html") and "waHistPin" not in S.REQUIRED_MARKERS and "X-Nova-Pin" not in S.REQUIRED_MARKERS
print("qa_loop tests ok")
