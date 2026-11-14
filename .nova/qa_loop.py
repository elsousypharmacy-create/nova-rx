#!/usr/bin/env python3
"""NOVA Rx continuous QA loop (runs in GitHub Actions; no AI calls, no deploys).

Creates ONE audit task per cycle as .nova/inbox/qa-loop-<next>.json. The cloud
scheduler ingests it; the audit task then writes the report, fix tasks and
(only if there are fixes) a qa artifact build task. Never touches the queue file.
Pause: set repository variable QA_LOOP_DISABLED=true (or env var of same name).
"""
import json, os, re, sys

QF = ".nova/cloud-queue.json"
INBOX = ".nova/inbox"
DONE = ("done", "done_noop", "failed")
FOCUS = [
    "quick sale & barcode", "invoices", "returns & refunds",
    "purchasing & receiving", "inventory, expiry & shortages",
    "customers, debts & chronic refill", "reports & shift close",
    "conversations (WhatsApp inbox)", "settings & permissions",
    "mobile layout", "keyboard & accessibility", "performance",
    "Arabic copy & RTL", "errors, offline & edge cases",
]
FIX_CAP = 15
UX_ID = re.compile(r"^UX([0-9]+)$")


def disabled(env=os.environ):
    return str(env.get("QA_LOOP_DISABLED", "")).strip().lower() == "true"


def busy(tasks):
    """True if a qa-loop task is still in flight (one cycle at a time)."""
    return any(str(t.get("source", "")).startswith("inbox/qa-loop") and t.get("status") not in DONE for t in tasks)


def _ids_in(tasks):
    for t in tasks or []:
        m = UX_ID.match(str(t.get("id", "")))
        if m:
            yield int(m.group(1))


def next_id(queue_tasks, inbox_dir=INBOX):
    ids = list(_ids_in(queue_tasks))
    if os.path.isdir(inbox_dir):
        for fn in os.listdir(inbox_dir):
            if fn.endswith(".json"):
                try:
                    ids += list(_ids_in(json.load(open(os.path.join(inbox_dir, fn))).get("tasks")))
                except Exception:
                    pass
    return max(ids or [0]) + 1


def focus_for(queue_tasks, inbox_dir=INBOX):
    """Rotate by the number of qa-loop audit cycles already created (queue + inbox)."""
    n = {t["id"] for t in queue_tasks if str(t.get("source", "")).startswith("inbox/qa-loop") and "fixes" not in str(t.get("source", ""))}
    if os.path.isdir(inbox_dir):
        for fn in os.listdir(inbox_dir):
            m = re.match(r"^qa-loop-(\d+)\.json$", fn)
            if m:
                n.add("UX" + m.group(1))
    return FOCUS[len(n) % len(FOCUS)]


def build_task(nxt, focus):
    cap = FIX_CAP
    fix_ids = ", ".join(f"UX{nxt + i}" for i in range(1, cap + 1))
    last = nxt + cap
    brief = (
        f"Continuous QA audit (focus: {focus}). Audit the CURRENT repo frontend locally with Playwright "
        "(desktop 1366x768 + mobile 390x844, fake data, no live writes, no supplier/live sites), focusing on the focus area "
        "plus a quick smoke of all main journeys. Every cycle must cover every main screen "
        "(البيع، الفواتير، المنتجات، العملاء، التقارير، المشتريات، الإعدادات، المحادثات، and any other top-nav tab or link). "
        "Click every top-nav link/tab and every visible primary header button (including the WhatsApp #novaWaBtn icon). "
        "Flag any HTTP 404, blank page, 'Not found', failed navigation, or console error. "
        "Quality bar is EXCEPTIONAL (world-class pharmacy POS, Apple/Linear-level polish): judge as the strictest senior product designer + QA lead. "
        "Report findings at every severity including low/polish (alignment, spacing, contrast, copy, empty/loading/error states, speed, keyboard flow). "
        "Score each of the 14 focus areas 0-10 and update .nova/qa/scorecard.json ({area: {score, last_cycle, open_findings}}); "
        "an area counts as exceptional only at >=9.5 with zero open findings. Never mark the product done; the loop continues. "
        "Read all previous .nova/qa/*report*.md and qa-loop-*.md first to avoid duplicates and to re-verify that earlier fixes really work. "
        f"Write .nova/qa/qa-loop-{nxt}.md (Arabic, short) with screenshots in .nova/qa/qa-loop-{nxt}/ (max 15). "
        f"Then write .nova/inbox/qa-loop-{nxt}-fixes.json ({{\"tasks\":[...]}}) with at most {cap} frontend-only fix tasks "
        f"(ids UX{nxt + 1}..UX{last}; highest impact first, any severity; areas scoring <9.5 first; tests required; Black Edition Arabic RTL preserved; backend frozen; no deploy), "
        f"plus, ONLY if there are fixes, a final task titled exactly 'Build worker/live/nova-rx-preview.qa-{nxt}.js (qa-loop, no deploy)' "
        f"with after = all its fix ids, which rebuilds the artifact from the latest worker/live artifact the same way UX80 did "
        f"(tools/build-worker-artifact.mjs, markers test, node --check, no deploy). Fix ids available: {fix_ids}. "
        "If truly nothing is found, write the report only (no fixes file). Do not edit .nova/cloud-queue.json."
    )
    return {"tasks": [{
        "id": f"UX{nxt}", "phase": 10,
        "title": f"QA loop audit {nxt}: {focus}",
        "brief": brief,
        "acceptance": f"Report .nova/qa/qa-loop-{nxt}.md exists; scorecard updated; fixes inbox file if any findings; no deploy; backend untouched.",
        "after": [],
    }]}


def run(env=os.environ, qf=QF, inbox_dir=INBOX, out=None):
    """Returns the created path or None."""
    if disabled(env):
        print("QA_LOOP_DISABLED=true: exiting"); return None
    tasks = json.load(open(qf)).get("tasks", [])
    if busy(tasks):
        print("a qa-loop task is still in flight: nothing to do"); return None
    nxt = next_id(tasks, inbox_dir)
    data = build_task(nxt, focus_for(tasks, inbox_dir))
    path = os.path.join(inbox_dir, f"qa-loop-{nxt}.json")
    json.dump(data, open(path, "w"), ensure_ascii=False, indent=2); open(path, "a").write("\n")
    print(f"created {path} ({data['tasks'][0]['title']})")
    if out or env.get("GITHUB_OUTPUT"):
        open(out or env["GITHUB_OUTPUT"], "a").write(f"created=true\npath={path}\n")
    return path


if __name__ == "__main__":
    run()
