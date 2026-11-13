#!/usr/bin/env python3
"""Apply an auto-deploy result to an owner_gate in .nova/cloud-queue.json.
Env: GATE, RESULT (deploy-result JSON), JOB (deploy job result), RUN_URL.
Used by deploy-backend-staging.yml (mark-gate). Never prints secrets."""
import json, os, datetime
QF = ".nova/cloud-queue.json"
AUTO_GATES = ("GATE-14", "GATE-15", "GATE-16")


def apply(q, gate, result, job, run_url, now):
    t = next((x for x in q["tasks"] if x["id"] == gate), None)
    if not t or gate not in AUTO_GATES:
        return False
    ok = job == "success" and result.get("status") == "done"
    t["status"] = "done" if ok else "failed"
    t["deploy"] = {k: result.get(k) for k in ("sha", "version_id", "previous_version_id", "bookmark", "migrated", "reason") if result.get(k) not in (None, "")}
    t["deploy"].update(run_url=run_url, at=result.get("at") or now, job=job)
    if ok:
        t["deployed_at"] = t["deploy"]["at"]
    q["updated"] = now
    return True


if __name__ == "__main__":
    q = json.load(open(QF))
    try:
        res = json.loads(os.environ.get("RESULT") or "{}")
    except ValueError:
        res = {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    if apply(q, os.environ["GATE"], res, os.environ.get("JOB", ""), os.environ.get("RUN_URL", ""), now):
        json.dump(q, open(QF, "w"), ensure_ascii=False, indent=1); open(QF, "a").write("\n")
        print(f"{os.environ['GATE']}: {[t for t in q['tasks'] if t['id']==os.environ['GATE']][0]['status']}")
