"""Post-merge dispatch of Auto-deploy preview artifact (no network)."""
import importlib.util, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location(
    "sched_preview", os.path.join(ROOT, ".nova/cloud_scheduler.py")
)
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

assert S.PREVIEW_DEPLOY_WF == "auto-deploy-preview.yml"
assert S.should_dispatch_preview_deploy(
    ["index.html", "worker/live/nova-rx-preview.ux-403.js"]
)
assert S.should_dispatch_preview_deploy(["worker/live/nova-rx-preview.qa-431.js"])
assert S.should_dispatch_preview_deploy(["worker/live"])
assert not S.should_dispatch_preview_deploy(
    ["index.html", "tests/ux/reports.spec.mjs"]
)
assert not S.should_dispatch_preview_deploy(
    ["worker/live/nova-rx-preview.ux-403.js"], noop=True
)
assert not S.should_dispatch_preview_deploy([])
assert not S.should_dispatch_preview_deploy(None)
assert not S.should_dispatch_preview_deploy(["worker/liveware.js"])
assert not S.should_dispatch_preview_deploy(["docs/worker/live/readme.md"])

calls = []
orig_act, orig_log = S.act, S.log
S.act = lambda *a: calls.append(a)
S.log = lambda m: None
try:
    assert S.dispatch_preview_deploy("UX403", ["index.html"]) is False
    assert calls == []
    assert S.dispatch_preview_deploy(
        "UX403", ["worker/live/nova-rx-preview.ux-403.js"]
    ) is True
    assert calls == [(
        "gh", "workflow", "run", "auto-deploy-preview.yml",
        "-R", S.REPO, "--ref", "main", "-f", "dry_run=false",
    )]
    calls.clear()
    assert S.dispatch_preview_deploy(
        "NOOP", ["worker/live/nova-rx-preview.ux-403.js"], noop=True
    ) is False
    assert calls == []
finally:
    S.act, S.log = orig_act, orig_log

print("scheduler preview deploy: ok")
