"""A CI workflow that is absent on the PR branch (added to main later) is N/A, never a crash (no network)."""
import importlib.util, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
spec = importlib.util.spec_from_file_location("sched_mw", os.path.join(ROOT, ".nova/cloud_scheduler.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
spec2 = importlib.util.spec_from_file_location("pick_ac", os.path.join(ROOT, ".github/scripts/pick_artifact_check.py"))
P = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(P)

# 1. dispatch: HTTP 422 (no workflow_dispatch on that ref) -> False, no exception
def run422(*a):
    raise RuntimeError("gh workflow run preview-artifact-unit.yml rc=1: could not create workflow dispatch event: HTTP 422: "
                       "Workflow does not have 'workflow_dispatch' trigger")
assert S.dispatch_ci("preview-artifact-unit.yml", "cloud/UX317", run=run422) is False
calls = []
assert S.dispatch_ci("secret-scan.yml", "cloud/UX317", run=lambda *a: calls.append(a)) is True and calls
# other errors still raise
def run500(*a):
    raise RuntimeError("gh workflow run x.yml rc=1: HTTP 500: boom")
try:
    S.dispatch_ci("x.yml", "cloud/UX1", run=run500); raise AssertionError("500 must raise")
except RuntimeError as ex:
    assert "500" in str(ex)

# 2. wf_on_ref: 404 from the contents API -> False; content -> True
def g404(path):
    raise RuntimeError("gh api repos/x rc=1: gh: Not Found (HTTP 404)")
assert S.wf_on_ref("preview-artifact-unit.yml", "cloud/UX316", getter=g404) is False
assert S.wf_on_ref("secret-scan.yml", "cloud/UX316", getter=lambda p: {"name": "secret-scan.yml"}) is True

# 3. ci_need drops absent workflows and remembers them for this sha
disp = {"sha": "abc", "wf": []}
need = S.ci_need(["secret-scan.yml", "preview-artifact-unit.yml", "ux-unit.yml"], "cloud/UX317", disp,
                 exists=lambda w: w != "preview-artifact-unit.yml")
assert need == ["secret-scan.yml", "ux-unit.yml"], need
assert disp["na"] == ["preview-artifact-unit.yml"]
# second pass does not re-query the remembered N/A workflow
assert S.ci_need(["preview-artifact-unit.yml"], "cloud/UX317", disp, exists=lambda w: 1 / 0) == []

# 4. artifact check picker: skip when worker/live untouched; per-artifact check otherwise
ex = {"tests/unit/artifact-pur-04.check.mjs", "tests/unit/ux430-artifact.check.mjs"}
assert P.plan([("M", "index.html"), ("A", "tests/ui-ux317.mjs")], exists=ex.__contains__) == []
assert P.plan([("M", "worker/live/nova-rx-preview.pur-04.js")], exists=ex.__contains__) == \
    [("worker/live/nova-rx-preview.pur-04.js", "tests/unit/artifact-pur-04.check.mjs")]
assert P.plan([("A", "worker/live/nova-rx-preview.ux430.js")], exists=ex.__contains__) == \
    [("worker/live/nova-rx-preview.ux430.js", "tests/unit/ux430-artifact.check.mjs")]
assert P.plan([("A", "worker/live/nova-rx-preview.ux-999.js")], exists=ex.__contains__) == \
    [("worker/live/nova-rx-preview.ux-999.js", None)]
assert P.plan([("D", "worker/live/nova-rx-preview.pur-04.js")], exists=ex.__contains__) == []
# the real pur-04 check exists in the repo
assert P.plan([("M", "worker/live/nova-rx-preview.pur-04.js")], exists=lambda p: os.path.exists(os.path.join(ROOT, p)))[0][1] \
    == "tests/unit/artifact-pur-04.check.mjs"
print("scheduler_missing_workflow_test: OK")
