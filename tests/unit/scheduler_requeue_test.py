"""A task left on "running" whose agent run completed red is requeued at the front (no network)."""
import importlib.util, os, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("sched_rq", os.path.join(ROOT, ".nova/cloud_scheduler.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)


def ts(ago):
    return datetime.datetime.fromtimestamp(S.NOW - ago, datetime.timezone.utc).isoformat(timespec="seconds")


def run(concl, ago=1700, status="completed"):
    return {"created_at": ts(ago), "status": status, "conclusion": concl, "html_url": "https://x/run/1"}


def items():
    return [{"id": "DONE1", "status": "done"},
            {"id": "P1", "status": "pending", "attempts": 0},
            {"id": "UX404", "status": "running", "attempts": 0, "slot": "A", "dispatched_at": ts(1710)},
            {"id": "UX430", "status": "running", "attempts": 2, "slot": "B", "dispatched_at": ts(1710)}]


# 1. turn-cap failure with no commits -> pending, retry, moved to front; at the cap -> failed
it = items()
req = S.reconcile_finished(it, {}, {"UX404": run("failure"), "UX430": run("failure")}, {}, [], lambda t: 0)
b = {t["id"]: t for t in it}
assert b["UX404"]["status"] == "pending" and b["UX404"]["retry"] and b["UX404"]["attempts"] == 1, b["UX404"]
assert it[0]["id"] == "UX404", [t["id"] for t in it]
assert b["UX430"]["status"] == "failed" and b["UX430"]["attempts"] == 3 and not b["UX430"].get("retry")
assert "failure" in b["UX404"]["last_failure"] and [t["id"] for t in req] == ["UX404"]

# 2. red run WITH auto-saved WIP commits -> still requeued (not a PR of partial work)
it = items()
S.reconcile_finished(it, {}, {"UX404": run("failure")}, {}, ["UX404"], lambda t: 3)
b = {t["id"]: t for t in it}
assert b["UX404"]["status"] == "pending" and b["UX404"]["retry"] and it[0]["id"] == "UX404"

# 3. green run with commits -> stays running (PR step opens the PR); cancelled -> requeued
it = items()
S.reconcile_finished(it, {}, {"UX404": run("success"), "UX430": run("cancelled")}, {}, ["UX404"], lambda t: 2)
b = {t["id"]: t for t in it}
assert b["UX404"]["status"] == "running" and not b["UX404"].get("retry")
assert b["UX430"]["status"] == "failed"  # attempts 2 -> 3 == MAX_ATTEMPTS

# 4. still in progress (active) -> untouched; stale older run does not count as this attempt's result
it = items()
S.reconcile_finished(it, {"UX404": "A"}, {"UX404": run(None, status="in_progress")}, {}, [], lambda t: 0)
assert {t["id"]: t for t in it}["UX404"]["status"] == "running"
it = items()
S.reconcile_finished(it, {}, {"UX404": run("failure", ago=9000)}, {}, ["UX404"], lambda t: 2)
assert {t["id"]: t for t in it}["UX404"]["status"] == "running"  # old red run ignored; branch has commits

# 5. fixing -> pr_open as before
it = [{"id": "F1", "status": "fixing", "dispatched_at": ts(100)}]
S.reconcile_finished(it, {}, {"F1": run("failure", ago=90)}, {"F1": {}}, ["F1"], lambda t: 1)
assert it[0]["status"] == "pr_open"
print("scheduler requeue: ok")

# 6. owner rule: Sonnet unless the task pins opus (any slot, fix mode too)
assert S.pick_model({"id": "UX401"}, "A") == "sonnet" and S.pick_model({"id": "X"}, "B", "fix") == "sonnet"
assert S.pick_model({"id": "UX404", "model": "opus"}, "A") == "opus"
print("scheduler model default: ok")
