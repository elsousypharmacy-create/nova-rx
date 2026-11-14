#!/usr/bin/env python3
"""NOVA Rx cloud queue scheduler (runs in GitHub Actions with GITHUB_TOKEN).

Deterministic: no AI calls, never deploys, never prints secrets.
1. Opens PRs for cloud/<id> branches that are ahead of main and have no PR.
2. Dispatches the PR's applicable CI workflows on the branch (PRs/commits made
   with GITHUB_TOKEN do not trigger pull_request/push CI).
3. Squash-merges cloud PRs whose CI runs are all green; on red CI dispatches
   agent-task in fix mode (max 2), then marks the task failed.
4. Starts the next pending task when a Claude slot is free.
State lives in .nova/cloud-queue.json on main.

The workflow loops this script while cloud PRs are waiting on CI. When a
pass leaves any task in pr_open, write 'true' to SCHEDULER_STAY_FILE
(/tmp/cloud-scheduler-stay by default) so the job keeps polling. Otherwise
write 'false' and the job exits; an in-progress agent run wakes it.
"""
import json, os, re, subprocess, sys, time, datetime

REPO = os.environ.get("GITHUB_REPOSITORY", "elsousypharmacy-create/nova-rx")
QF = ".nova/cloud-queue.json"
AGENT_WF, SELF_WF = "agent-task.yml", "cloud-scheduler.yml"
DEPLOY_WF = "deploy-backend-staging.yml"
# owner_gates the scheduler may auto-deploy (staging Worker only) once all `after` tasks are done.
# GATE-17 (live pilot + production enablement) is deliberately absent: owner-only.
AUTO_GATES = ("GATE-14", "GATE-15", "GATE-16")
DEPLOY_STALE = 2700  # seconds; deploy job 25m + mark-gate 5m, plus margin
SLOTS = ["A"] + (["B"] if os.environ.get("HAS_B") == "true" else [])
MAX_FIX, MAX_ATTEMPTS, GRACE = 2, 2, 600
DRY = "--dry-run" in sys.argv
DONE = ("done", "done_noop")
NOW = time.time()


def log(m):
    print(m, flush=True)


def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f"{' '.join(a[:4])} rc={r.returncode}: {r.stderr.strip()[-300:]}")
    return r.stdout


def _parse_gh_json(out):
    """Parse `gh api` JSON, including `--paginate` concatenation of pages.

    `gh api --paginate` writes one JSON document per page back-to-back
    (arrays or objects). json.loads then raises JSONDecodeError: Extra data.
    """
    out = (out or "").strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        pass
    dec = json.JSONDecoder()
    pages, idx, n = [], 0, len(out)
    while idx < n:
        while idx < n and out[idx].isspace():
            idx += 1
        if idx >= n:
            break
        val, idx = dec.raw_decode(out, idx)
        pages.append(val)
    if not pages:
        return None
    if all(isinstance(p, list) for p in pages):
        merged = []
        for p in pages:
            merged.extend(p)
        return merged
    if all(isinstance(p, dict) for p in pages):
        merged = {}
        for p in pages:
            for k, v in p.items():
                if isinstance(v, list) and isinstance(merged.get(k), list):
                    merged[k].extend(v)
                else:
                    merged[k] = v
        return merged
    return pages[0]


def api(path):
    out = sh("gh", "api", "--paginate", path) if "per_page" in path else sh("gh", "api", path)
    return _parse_gh_json(out)



def ci_never_started(r):
    """True when GitHub failed the run without starting any job (billing, spending limit)."""
    if r.get("status") != "completed" or r.get("conclusion") not in ("failure", "timed_out", "startup_failure"):
        return False
    jobs = (api(f"repos/{REPO}/actions/runs/{r['id']}/jobs") or {}).get("jobs") or []
    if not jobs:
        return True
    return all((not j.get("runner_name")) and not (j.get("steps") or []) for j in jobs)


def act(*a):
    log("+ " + " ".join(x if len(x) < 80 else x[:77] + "..." for x in a))
    if not DRY:
        return sh(*a)
    return ""


def iso(ts=None):
    return datetime.datetime.fromtimestamp(ts or NOW, datetime.timezone.utc).isoformat(timespec="seconds")


def age(s):
    try:
        return NOW - datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 1e9


# ---------- CI discovery (pull_request workflows + path filters) ----------
def _yaml():
    try:
        import yaml
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--user", "--break-system-packages", "pyyaml"])
        import site, importlib
        sys.path.append(site.getusersitepackages()); importlib.invalidate_caches()
        import yaml
    return yaml


def glob_re(p):
    out, i = "", 0
    while i < len(p):
        if p.startswith("**/", i):
            out += "(?:.*/)?"; i += 3; continue
        if p.startswith("**", i):
            out += ".*"; i += 2; continue
        c = p[i]
        out += "[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c)
        i += 1
    return re.compile(out + r"\Z")


def match_list(pats, f):
    hit = False
    for p in pats:
        neg = p.startswith("!")
        if glob_re(p[1:] if neg else p).match(f):
            hit = not neg
    return hit


def ci_workflows():
    yaml = _yaml(); res = {}
    d = ".github/workflows"
    for fn in sorted(os.listdir(d)):
        if not fn.endswith((".yml", ".yaml")) or fn in (AGENT_WF, SELF_WF):
            continue
        try:
            y = yaml.safe_load(open(os.path.join(d, fn)))
        except Exception:
            continue
        on = y.get("on", y.get(True)) if isinstance(y, dict) else None
        if isinstance(on, str): on = {on: None}
        if isinstance(on, list): on = {k: None for k in on}
        if not isinstance(on, dict) or "pull_request" not in on:
            continue
        if "workflow_dispatch" not in on:
            log(f"warn: {fn} has pull_request but no workflow_dispatch; cannot run it for bot PRs")
            continue
        res[fn] = on.get("pull_request") or {}
    return res


def applicable(wfs, files):
    out = []
    for fn, f in wfs.items():
        br = f.get("branches")
        if br and not match_list(br, "main"):
            continue
        if f.get("paths") and not any(match_list(f["paths"], x) for x in files):
            continue
        if f.get("paths-ignore") and all(match_list(f["paths-ignore"], x) for x in files):
            continue
        out.append(fn)
    return out


# ---------- follow-up inbox ----------
# Cloud tasks may not edit the queue. A merged task can instead commit
# .nova/inbox/*.json = {"tasks":[{id,title,brief,acceptance,phase?,after?}]}.
# Only ids like UX12 / FIX3 are accepted; existing ids are never overwritten;
# status is always forced to pending. New tasks go before the first pending
# task so follow-ups run next.
INBOX_ID = re.compile(r"^(UX|FIX)[0-9]{1,4}$")


def ingest_followups(items, byid):
    d = ".nova/inbox"
    if not os.path.isdir(d):
        return
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".json"):
            continue
        try:
            data = json.load(open(os.path.join(d, fn)))
        except Exception as ex:
            log(f"warn: inbox {fn} unreadable: {ex}"); continue
        for x in (data.get("tasks") or [])[:30]:
            tid = str(x.get("id", ""))
            if not INBOX_ID.match(tid) or tid in byid or not x.get("title") or not x.get("brief"):
                continue
            t = {"id": tid, "phase": x.get("phase", 10), "title": str(x["title"])[:200], "brief": str(x["brief"])[:6000],
                 "acceptance": str(x.get("acceptance", ""))[:2000],
                 "after": [a for a in (x.get("after") or []) if isinstance(a, str)][:10],
                 "status": "pending", "attempts": 0, "fix_attempts": 0, "source": f"inbox/{fn}"}
            pos = next((i for i, y in enumerate(items) if y.get("status") == "pending"), len(items))
            items.insert(pos, t); byid[tid] = t
            log(f"inbox: queued {tid} from {fn}")


# ---------- auto gate deploys ----------
def gate_deploys(items, byid):
    """Dispatch the staging deploy for ready auto gates; reconcile stuck 'deploying' gates.
    The deploy workflow itself writes done/failed (+ sha, version id) back to the queue."""
    runs = None
    for t in items:
        if t["id"] not in AUTO_GATES:
            continue
        if t["status"] == "owner_gate" and all(byid.get(a, {}).get("status") in DONE for a in t.get("after", [])):
            if any(x.get("status") == "deploying" for x in items):
                log(f"{t['id']}: ready, waiting for another gate deploy"); continue
            act("gh", "workflow", "run", DEPLOY_WF, "-R", REPO, "--ref", "main", "-f", "dry_run=false",
                "-f", "confirm=DEPLOY nova-rx-api-staging", "-f", f"gate_id={t['id']}")
            t.update(status="deploying", dispatched_at=iso())
            log(f"{t['id']}: all after-tasks done -> dispatched {DEPLOY_WF}")
        elif t["status"] == "deploying" and age(t.get("dispatched_at", "")) > DEPLOY_STALE:
            if runs is None:
                runs = (api(f"repos/{REPO}/actions/workflows/{DEPLOY_WF}/runs?per_page=20") or {}).get("workflow_runs", [])[:20]
            mine = [r for r in runs if r.get("display_title") == f"gate {t['id']} deploy"
                    and age(r.get("created_at", "")) <= age(t.get("dispatched_at", "")) + 60]
            r = mine[0] if mine else None
            if r and r.get("status") != "completed":
                continue
            ok = bool(r) and r.get("conclusion") == "success"
            t["status"] = "done" if ok else "failed"
            t.setdefault("deploy", {}).update(run_url=(r or {}).get("html_url"), reconciled=iso())
            log(f"{t['id']}: reconciled deploy -> {t['status']}")


# ---------- auto preview deploy of qa-loop artifacts (nova-rx-preview ONLY) ----------
PREVIEW_WF = "deploy-worker.yml"
PREVIEW_URL = "https://nova-rx-preview.elsousypharmacy.workers.dev"
QA_BUILD = re.compile(r"^Build (worker/live/nova-rx-preview\.qa-[0-9]+\.js)\b")
PREVIEW_STALE = 1800


def _sha256(path):
    import hashlib
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def preview_smoke(url=PREVIEW_URL):
    """HTTP 200 on /, /emergency/stock.json parses as JSON with data, and the page has a search input."""
    import urllib.request
    def get(p):
        with urllib.request.urlopen(url + p, timeout=30) as r:
            return r.status, r.read()
    try:
        st, html = get("/")
        if st != 200:
            return False, f"/ -> {st}"
        st, raw = get("/emergency/stock.json")
        data = json.loads(raw)
        if st != 200 or not data:
            return False, "/emergency/stock.json empty or not 200"
        if b"search" not in html.lower():
            return False, "search not found in page"
        return True, "ok"
    except Exception as ex:
        return False, f"smoke error: {ex}"


def _deploy_run(path, sha, dry, ref="main"):
    # expected_modified_on "20" = any 20xx time: the qa artifact is built from the latest live artifact
    act("gh", "workflow", "run", PREVIEW_WF, "-R", REPO, "--ref", "main", "-f", f"artifact_ref={ref}",
        "-f", f"artifact_path={path}", "-f", f"sha256={sha}", "-f", "expected_modified_on=20",
        "-f", f"dry_run={'true' if dry else 'false'}", "-f", "confirm=" + ("" if dry else "DEPLOY nova-rx-preview"))


def _latest_run(path, since):
    runs = (api(f"repos/{REPO}/actions/workflows/{PREVIEW_WF}/runs?per_page=10") or {}).get("workflow_runs", [])[:10]
    mine = [r for r in runs if age(r.get("created_at", "")) <= age(since) + 60]
    return mine[0] if mine else None  # newest first


def preview_deploys(items, byid, smoke=None, exists=os.path.exists):
    """State machine per qa build task: dry run -> real deploy -> smoke -> (rollback on failure).
    Never touches production / api-staging / GATE-17; never applies migrations."""
    smoke = smoke or preview_smoke
    busy = any(isinstance(t.get("preview_deploy"), dict) and t["preview_deploy"].get("stage") in ("dry", "real", "rollback") for t in items)
    last_ok = [t["preview_deploy"] for t in items if isinstance(t.get("preview_deploy"), dict) and t["preview_deploy"].get("stage") == "deployed"]
    for t in items:
        m = QA_BUILD.match(t.get("title", ""))
        if not m or t.get("status") not in DONE:
            continue
        path, d = m.group(1), t.get("preview_deploy")
        if d is None:
            if busy or not exists(path):
                continue
            sha = _sha256(path)
            d = t["preview_deploy"] = {"stage": "dry", "path": path, "sha256": sha, "at": iso(),
                                       "previous": ({"path": last_ok[-1]["path"], "sha256": last_ok[-1]["sha256"]} if last_ok else None)}
            _deploy_run(path, sha, True); busy = True
            log(f"{t['id']}: dispatched preview dry run for {path}")
            continue
        stage = d.get("stage")
        if stage not in ("dry", "real", "rollback"):
            continue
        r = _latest_run(path, d["at"])
        if not r or r.get("status") != "completed":
            if age(d["at"]) > PREVIEW_STALE:
                d.update(stage="failed", reason="deploy run not completed in time")
            continue
        ok = r.get("conclusion") == "success"
        d["run_url"] = r.get("html_url")
        if stage == "dry":
            if ok:
                d.update(stage="real", at=iso()); _deploy_run(path, d["sha256"], False)
                log(f"{t['id']}: dry run ok -> real preview deploy")
            else:
                d.update(stage="failed", reason="dry run failed")
        elif stage == "real":
            good, why = (smoke() if ok else (False, "deploy run failed"))
            if good:
                d.update(stage="deployed", deployed_at=iso(), smoke="ok")
                log(f"{t['id']}: preview deployed + smoke ok")
            elif d.get("previous") and exists(d["previous"]["path"]):
                d.update(stage="rollback", reason=why, at=iso()); _deploy_run(d["previous"]["path"], d["previous"]["sha256"], False)
                log(f"{t['id']}: {why} -> rollback to {d['previous']['path']}")
            else:
                d.update(stage="failed", reason=why + " (no previous artifact recorded; the deploy workflow restores the pre-deploy code itself on upload/verify failure)")
        elif stage == "rollback":
            d.update(stage="rolled_back" if ok else "failed", reason=d.get("reason", "") + (" (rolled back)" if ok else " (ROLLBACK FAILED: check Cloudflare)"))
        busy = any(x.get("stage") in ("dry", "real", "rollback") for x in [d])


# ---------- main ----------
def main():
    q = json.load(open(QF)); items = q["tasks"]; byid = {t["id"]: t for t in items}
    before = json.dumps(q, sort_keys=True)
    ingest_followups(items, byid)

    runs = (api(f"repos/{REPO}/actions/workflows/{AGENT_WF}/runs?per_page=50") or {}).get("workflow_runs", [])[:50]
    active, seen = {}, {}  # task id -> slot for queued/in-progress agent runs; newest run start per task
    for r in runs:
        m = re.match(r"cloud (\S+) (new|fix) ([AB])$", r.get("display_title") or r.get("name") or "")
        if not m:
            continue
        seen[m.group(1)] = max(seen.get(m.group(1), ""), r.get("created_at", ""))
        if r["status"] != "completed":
            active[m.group(1)] = m.group(3)
    for t in items:  # just-dispatched runs may not be listed yet
        d = t.get("dispatched_at", "")
        if t["status"] in ("running", "fixing") and t["id"] not in active and age(d) < GRACE \
                and not (seen.get(t["id"]) and age(seen[t["id"]]) <= age(d) + 60):
            active[t["id"]] = t.get("slot", "A")
    log(f"slots={SLOTS} active={active}")

    prs = api(f"repos/{REPO}/pulls?state=open&base=main&per_page=100") or []
    open_pr = {p["head"]["ref"][6:]: p for p in prs if p["head"]["ref"].startswith("cloud/")}
    branches = [b["name"][6:] for b in (api(f"repos/{REPO}/branches?per_page=100") or []) if b["name"].startswith("cloud/")]

    # finished agent runs
    for t in items:
        if t["status"] in ("running", "fixing") and t["id"] not in active:
            if t["status"] == "fixing" or t["id"] in open_pr:
                t["status"] = "pr_open"
            elif t["id"] not in branches or (api(f"repos/{REPO}/compare/main...cloud/{t['id']}") or {}).get("ahead_by", 0) == 0:
                t["attempts"] = t.get("attempts", 0) + 1
                t["status"] = "failed" if t["attempts"] >= MAX_ATTEMPTS else "pending"
                log(f"{t['id']}: agent run produced no commits -> {t['status']}")

    # open PRs for branches without one
    for tid in branches:
        t = byid.get(tid)
        if tid in open_pr or tid in active or not t or t["status"] in DONE + ("failed",):
            continue
        if (api(f"repos/{REPO}/compare/main...cloud/{tid}") or {}).get("ahead_by", 0) == 0:
            continue
        body = (f"Cloud task {tid} (Claude Sonnet via GitHub Actions).\n\n{t['brief']}\n\nAcceptance: {t.get('acceptance','')}\n\n"
                "Opened by cloud-scheduler; CI is dispatched on the branch and the PR is squash-merged when all checks are green. Never deploys.")
        out = act("gh", "pr", "create", "-R", REPO, "--base", "main", "--head", f"cloud/{tid}", "--title", f"[{tid}] {t['title']}", "--body", body)
        m = re.search(r"/pull/(\d+)", out or "")
        t.update(status="pr_open", pr=int(m.group(1)) if m else t.get("pr"))
        if m:
            open_pr[tid] = api(f"repos/{REPO}/pulls/{m.group(1)}")

    # evaluate PRs
    wfs = None
    for tid, p in open_pr.items():
        t = byid.get(tid)
        if not t:
            t = {"id": tid, "title": p["title"], "brief": p.get("body") or "", "after": [], "status": "pr_open", "attempts": 1, "fix_attempts": 0}
            items.append(t); byid[tid] = t
        t["pr"] = p["number"]
        if tid in active or t["status"] in DONE + ("failed",):
            continue
        t["status"] = "pr_open"
        if p.get("draft"):
            act("gh", "pr", "ready", str(p["number"]), "-R", REPO)
        sha = p["head"]["sha"]
        files = [f["filename"] for f in api(f"repos/{REPO}/pulls/{p['number']}/files?per_page=100") or []]
        wfs = wfs if wfs is not None else ci_workflows()
        need = applicable(wfs, files)
        # Ignore pull_request runs that complete as action_required (GITHUB_TOKEN
        # PRs often need approval). Those would otherwise overwrite a green
        # workflow_dispatch of the same workflow and be treated as red CI.
        # Also ignore runs that never got a runner (billing / spending-limit
        # blocks). Treating those as red CI marks tasks failed and stalls the chain.
        latest = {}
        for r in sorted((api(f"repos/{REPO}/actions/runs?head_sha={sha}&per_page=100") or {}).get("workflow_runs", []), key=lambda r: r["created_at"]):
            if r.get("conclusion") == "action_required" or ci_never_started(r):
                continue
            fn = os.path.basename(r["path"].split("@")[0])
            prev = latest.get(fn)
            if prev is None:
                latest[fn] = r
                continue
            def score(x):
                good = 2 if x.get("conclusion") in ("success", "skipped", "neutral") else 0
                ev = 1 if x.get("event") == "workflow_dispatch" else 0
                done = 1 if x["status"] == "completed" else 0
                return (good, ev, done, x.get("created_at", ""))
            if score(r) >= score(prev):
                latest[fn] = r
        disp = t.setdefault("ci_dispatched", {})
        if disp.get("sha") != sha:
            disp.clear(); disp["sha"] = sha; disp["wf"] = []; disp["at"] = iso()
        missing = [w for w in need if w not in latest]
        for w in missing:
            if w not in disp["wf"] or age(disp.get("at", "")) > 1800:
                act("gh", "workflow", "run", w, "-R", REPO, "--ref", f"cloud/{tid}")
                if w not in disp["wf"]:
                    disp["wf"].append(w)
                disp["at"] = iso()
        pending = [w for w in need if w in latest and latest[w]["status"] != "completed"]
        if missing or pending:
            log(f"{tid} PR #{p['number']}: waiting CI missing={missing} pending={pending}")
            continue
        bad = [w for w in need if latest[w]["conclusion"] not in ("success", "skipped", "neutral")]
        if not bad:
            for _ in range(8):  # GitHub computes mergeability lazily after main moves
                info = json.loads(sh("gh", "pr", "view", str(p["number"]), "-R", REPO, "--json", "mergeable"))
                if info.get("mergeable") != "UNKNOWN":
                    break
                time.sleep(5)
            if info.get("mergeable") in ("MERGEABLE", "UNKNOWN"):
                try:
                    act("gh", "pr", "merge", str(p["number"]), "-R", REPO, "--squash", "--delete-branch", "--match-head-commit", sha)
                except RuntimeError as ex:
                    log(f"{tid}: merge not possible yet: {ex}"); continue
                noop = files and all(f.startswith(".nova/noop/") for f in files)
                t.update(status="done_noop" if noop else "done", merged_at=iso(), pr_url=p["html_url"])
                t.pop("ci_dispatched", None)
                log(f"{tid}: merged PR #{p['number']} ({t['status']})")
                continue
            why = "the PR has merge conflicts with main: merge origin/main into the branch and resolve them"
        else:
            why = "these CI workflows failed: " + ", ".join(f"{w} ({latest[w]['html_url']})" for w in bad)
        if t.get("fix_attempts", 0) >= MAX_FIX:
            t["status"] = "failed"; log(f"{tid}: failed after {MAX_FIX} fix attempts")
            act("gh", "pr", "comment", str(p["number"]), "-R", REPO, "--body", f"cloud-scheduler: giving up after {MAX_FIX} fix attempts; {why}. Left open for a human.")
            continue
        slot = next((s for s in SLOTS if s not in active.values()), None)
        if not slot:
            log(f"{tid}: needs fix but no free slot"); continue
        t["fix_attempts"] = t.get("fix_attempts", 0) + 1
        brief = f"FIX MODE for PR #{p['number']} (attempt {t['fix_attempts']}/{MAX_FIX}): {why}. Inspect with `gh run view <id> --log-failed` if needed, fix on this branch, rerun the tests, commit and push.\n\nOriginal task: {t['title']}\n{t['brief']}"
        act("gh", "workflow", "run", AGENT_WF, "-R", REPO, "--ref", "main", "-f", f"task_id={tid}", "-f", "mode=fix", "-f", f"slot={slot}", "-f", f"brief={brief[:20000]}")
        t.update(status="fixing", slot=slot, dispatched_at=iso()); active[tid] = slot

    gate_deploys(items, byid)
    preview_deploys(items, byid)

    # start next pending tasks
    for t in items:
        free = [s for s in SLOTS if s not in active.values()]
        if not free:
            break
        if t["status"] != "pending" or t["id"] in active:
            continue
        if not all(byid.get(a, {}).get("status") in DONE for a in t.get("after", [])):
            continue
        brief = f"{t['title']}\n{t['brief']}\nAcceptance: {t.get('acceptance','')}"
        act("gh", "workflow", "run", AGENT_WF, "-R", REPO, "--ref", "main", "-f", f"task_id={t['id']}", "-f", "mode=new", "-f", f"slot={free[0]}", "-f", f"brief={brief[:20000]}")
        t.update(status="running", slot=free[0], dispatched_at=iso()); active[t["id"]] = free[0]

    changed = json.dumps(q, sort_keys=True) != before
    if changed and not DRY:
        q["updated"] = iso()
        json.dump(q, open(QF, "w"), ensure_ascii=False, indent=1); open(QF, "a").write("\n")
        log("queue changed")
    stay = any(t["status"] == "pr_open" for t in items)
    stay_path = os.environ.get("SCHEDULER_STAY_FILE", "/tmp/cloud-scheduler-stay")
    try:
        open(stay_path, "w").write("true" if stay else "false")
    except OSError as ex:
        log(f"warn: could not write stay file: {ex}")
    if os.environ.get("GITHUB_OUTPUT"):
        open(os.environ["GITHUB_OUTPUT"], "a").write(
            f"changed={'true' if changed and not DRY else 'false'}\nstay={'true' if stay else 'false'}\n"
        )
    log("summary: " + ", ".join(f"{t['id']}={t['status']}" for t in items))
    log(f"stay={stay}")


if __name__ == "__main__":
    main()
