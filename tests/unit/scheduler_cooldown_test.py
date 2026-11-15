"""A red agent run that dies within seconds (slot usage limit) is not counted and cools the slot down (no network)."""
import importlib.util, os, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("sched_cd", os.path.join(ROOT, ".nova/cloud_scheduler.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
S.SLOTS[:] = ["A", "B"]


def ts(ago):
    return datetime.datetime.fromtimestamp(S.NOW - ago, datetime.timezone.utc).isoformat(timespec="seconds")


def run(secs, concl="failure", ago=100):
    return {"created_at": ts(ago), "run_started_at": ts(ago), "updated_at": ts(ago - secs), "status": "completed",
            "conclusion": concl, "html_url": "https://x/run/9"}


it = [{"id": "P1", "status": "pending"},
      {"id": "UX401", "status": "running", "attempts": 2, "slot": "A", "dispatched_at": ts(110)},
      {"id": "UX318", "status": "fixing", "fix_attempts": 2, "slot": "A", "dispatched_at": ts(110), "pr": 473},
      {"id": "UX320", "status": "running", "attempts": 0, "slot": "B", "dispatched_at": ts(1900)}]
cd = {}
S.reconcile_finished(it, {}, {"UX401": run(24), "UX318": run(30), "UX320": run(1500, ago=1800)}, {}, [], lambda t: 0, cd)
b = {t["id"]: t for t in it}
# quick fail: not counted, retried at the front, slot A cooled down
assert b["UX401"]["status"] == "pending" and b["UX401"]["attempts"] == 2 and b["UX401"]["retry"], b["UX401"]
assert {it[0]["id"], it[1]["id"]} == {"UX401", "UX320"}, [t["id"] for t in it]
assert b["UX318"]["status"] == "pr_open" and b["UX318"]["fix_attempts"] == 1, b["UX318"]
assert "A" in cd and S.age(cd["A"]) < 0 and "B" not in cd, cd
# a long red run still counts as an attempt
assert b["UX320"]["status"] == "pending" and b["UX320"]["attempts"] == 1
# cooled slot is not free; expired cooldown is
assert S.free_slots({}, cd) == ["B"]
assert S.free_slots({"x": "B"}, cd) == []
assert S.free_slots({}, {"A": ts(10)}) == ["A", "B"]
assert S.quick_fail(run(24)) and not S.quick_fail(run(24, concl="success")) and not S.quick_fail(run(600))
print("scheduler cooldown: ok")
