"""Scheduler keeps polling when startable work waits only on a short slot cooldown (no network)."""
import importlib.util, os, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("sched_stay", os.path.join(ROOT, ".nova/cloud_scheduler.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
S.SLOTS[:] = ["A", "B"]


def ts(ahead):
    return datetime.datetime.fromtimestamp(S.NOW + ahead, datetime.timezone.utc).isoformat(timespec="seconds")


def by(it):
    return {t["id"]: t for t in it}


done = {"id": "D", "status": "done"}
# 2026-11-15 stall: every pending task had not_before 14s ahead, nothing active -> must stay
it = [done, {"id": "UX401", "status": "pending", "after": ["D"], "not_before": ts(14)}]
assert S.should_stay(it, by(it), {}, {"A": ts(14)})
# an active agent run wakes the scheduler itself
assert not S.should_stay(it, by(it), {"UX320": "B"}, {})
# CI in flight
assert S.should_stay([{"id": "X", "status": "pr_open"}], {}, {"Y": "A"}, {})
# blocked by an unfinished dependency only -> exit
it2 = [{"id": "P", "status": "pending", "after": ["Q"]}, {"id": "Q", "status": "failed"}]
assert not S.should_stay(it2, by(it2), {}, {})
# long wait (hours) -> exit, do not burn runner minutes
it3 = [done, {"id": "L", "status": "pending", "after": ["D"], "not_before": ts(4 * 3600)}]
assert not S.should_stay(it3, by(it3), {}, {})
# pinned to a cooled slot for hours -> exit; unpinned with the other slot free -> stay
it4 = [done, {"id": "W", "status": "pending", "after": ["D"], "pin_slot": "A"}]
assert not S.should_stay(it4, by(it4), {}, {"A": ts(4 * 3600)})
it4[1].pop("pin_slot")
assert S.should_stay(it4, by(it4), {}, {"A": ts(4 * 3600)})
print("scheduler stay: ok")
