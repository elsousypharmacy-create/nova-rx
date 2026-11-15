"""Unit tests for tools/preview_auto_deploy.py (no network, no deploy)."""
import os, sys, tempfile, textwrap
from pathlib import Path
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import preview_auto_deploy as P

def test_newest_by_commit_time():
    root = Path(tempfile.mkdtemp())
    d = root / "worker" / "live"
    d.mkdir(parents=True)
    (d / "nova-rx-preview.qa-219.js").write_text("old")
    (d / "nova-rx-preview.wa-live3.js").write_text("new")
    (d / "nova-rx-preview.qa-231.js").write_text("mid")
    times = {
        "worker/live/nova-rx-preview.qa-219.js": 100,
        "worker/live/nova-rx-preview.qa-231.js": 200,
        "worker/live/nova-rx-preview.wa-live3.js": 300,
    }
    rel, ts = P.newest_artifact(root, times=times)
    assert rel == "worker/live/nova-rx-preview.wa-live3.js" and ts == 300
    # an older file even if listed later must not win
    times["worker/live/nova-rx-preview.qa-219.js"] = 50
    rel, ts = P.newest_artifact(root, times=times)
    assert rel.endswith("wa-live3.js") and ts == 300

def test_skip_older_push_and_origin_newer():
    newest = "worker/live/nova-rx-preview.wa-live3.js"
    # push only added the stale qa-219
    why = P.should_deploy(newest, ["worker/live/nova-rx-preview.qa-219.js"], None, 300)
    assert why and "was not in this push" in why
    # push includes the newest
    assert P.should_deploy(newest, [newest], None, 300) is None
    # origin/main already has a later artifact
    why = P.should_deploy(newest, [newest], ("worker/live/nova-rx-preview.wa-live4.js", 400), 300)
    assert why and "origin/main has a newer artifact" in why

def test_markers_and_no_regression():
    required = "novaWaBtn hLoad inbox/history data-wa-inbox-open NOVA_FIX50 NOVA_FIX50_VV hPoll winClosed"
    good = required + " hSend"
    qa219 = "novaWaBtn search only, no history"
    assert "hLoad" in P.missing_markers(qa219)
    assert P.missing_markers(good) == []
    # live already has FIX50; new must keep it
    live = good
    dropped = "novaWaBtn hLoad inbox/history data-wa-inbox-open hPoll winClosed hSend"  # dropped FIX50
    miss = P.regression_markers(live, dropped)
    assert "NOVA_FIX50" in miss and "NOVA_FIX50_VV" in miss
    assert P.regression_markers(qa219, good) == []  # upgrading from stale live is ok if required markers present
    # UX400: the old PIN lock-form marker no longer counts; a PIN-gated candidate lacks the PIN-free inbox marker
    assert "waHistPin" not in P.REQUIRED_MARKERS
    pin_gated = good.replace("data-wa-inbox-open", "waHistPin")
    assert P.missing_markers(pin_gated) == ["data-wa-inbox-open"]
    for keep in ("novaWaBtn", "hLoad", "inbox/history", "NOVA_FIX50", "NOVA_FIX50_VV", "hPoll", "winClosed"):
        assert keep in P.REQUIRED_MARKERS

def test_real_artifacts():
    miss219 = P.missing_markers(Path(ROOT, "worker/live/nova-rx-preview.qa-219.js").read_text(encoding="utf-8", errors="replace"))
    miss3 = P.missing_markers(Path(ROOT, "worker/live/nova-rx-preview.wa-live3.js").read_text(encoding="utf-8", errors="replace"))
    assert "hLoad" in miss219 and "NOVA_FIX50" in miss219
    assert miss3 == ["data-wa-inbox-open"]  # wa-live3 is the PIN-gated UI (pre-UX400)
    # the next artifact is built from index.html, which must carry every marker and no PIN UI
    app = Path(ROOT, "index.html").read_text(encoding="utf-8")
    assert P.missing_markers(app) == []
    assert "waHistPin" not in app and "X-Nova-Pin" not in app

if __name__ == "__main__":
    test_newest_by_commit_time()
    test_skip_older_push_and_origin_newer()
    test_markers_and_no_regression()
    test_real_artifacts()
    print("preview_auto_deploy tests ok")
