"""Unit tests for tools/preview_auto_deploy.py (no network, no deploy)."""
import json, os, subprocess, sys, tempfile
from pathlib import Path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import preview_auto_deploy as P


def test_newest_by_commit_time_fallback():
    """Legacy artifacts without NOVA_BUILD stamp fall back to git commit time."""
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
    times["worker/live/nova-rx-preview.qa-219.js"] = 50
    rel, ts = P.newest_artifact(root, times=times)
    assert rel.endswith("wa-live3.js") and ts == 300


def test_build_stamp_selection_and_pur01b_over_pur03_regression():
    """An artifact built earlier on an older main_sha (pur-01b) but committed/merged later
    must NOT win over an artifact built later on a newer descendant main_sha (pur-03)."""
    root = Path(tempfile.mkdtemp())
    d = root / "worker" / "live"
    d.mkdir(parents=True)
    sha_old = "a" * 40
    sha_new = "b" * 40
    # pur-01b was built at 10:00 on sha_old, but merged to main at commit time 500
    (d / "nova-rx-preview.pur-01b.js").write_text(
        f'// NOVA_MODULE_ADAPTER_V1\nconst NOVA_BUILD={{"built_at":"2026-11-19T10:00:00Z","main_sha":"{sha_old}","task":"pur-01b"}};\n'
    )
    # pur-03 was built at 11:00 on sha_new (descendant of sha_old), merged earlier at commit time 400
    (d / "nova-rx-preview.pur-03.js").write_text(
        f'// NOVA_MODULE_ADAPTER_V1\nconst NOVA_BUILD={{"built_at":"2026-11-19T11:00:00Z","main_sha":"{sha_new}","task":"pur-03"}};\n'
    )
    times = {
        "worker/live/nova-rx-preview.pur-03.js": 400,
        "worker/live/nova-rx-preview.pur-01b.js": 500,  # later git commit time!
    }
    ancestry = {
        (sha_old, sha_new): True,
        (sha_new, sha_old): False,
    }
    rel, ts = P.newest_artifact(root, times=times, ancestry=ancestry)
    assert rel == "worker/live/nova-rx-preview.pur-03.js", f"expected pur-03, got {rel}"
    assert ts == P.parse_iso_timestamp("2026-11-19T11:00:00Z")

    # Even if pur-01b had a skewed clock with a later built_at, main_sha ancestry still prefers the descendant (pur-03)
    (d / "nova-rx-preview.pur-01b.js").write_text(
        f'// NOVA_MODULE_ADAPTER_V1\nconst NOVA_BUILD={{"built_at":"2026-11-19T12:00:00Z","main_sha":"{sha_old}","task":"pur-01b"}};\n'
    )
    rel2, _ = P.newest_artifact(root, times=times, ancestry=ancestry)
    assert rel2 == "worker/live/nova-rx-preview.pur-03.js", f"ancestry must prefer descendant main_sha, got {rel2}"

    # And check_main_sha_ancestry / should_deploy explicitly refuses deploying pur-01b over pur-03
    why = P.check_main_sha_ancestry(
        root,
        "worker/live/nova-rx-preview.pur-01b.js",
        candidate_sha=sha_old,
        other_shas={"worker/live/nova-rx-preview.pur-03.js": sha_new},
        ancestry=ancestry,
    )
    assert why and "not a descendant-or-equal" in why
    assert P.check_main_sha_ancestry(
        root,
        "worker/live/nova-rx-preview.pur-03.js",
        candidate_sha=sha_new,
        other_shas={"worker/live/nova-rx-preview.pur-01b.js": sha_old},
        ancestry=ancestry,
    ) is None


def test_real_git_ancestry_and_cli_refusal():
    """Test real git merge-base --is-ancestor in a temporary git repository and CLI exit code."""
    root = Path(tempfile.mkdtemp())
    git = lambda *a: subprocess.check_output(["git", "-C", str(root), *a], text=True).strip()
    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    (root / "README").write_text("v1")
    git("add", ".")
    git("commit", "-qm", "c1")
    sha1 = git("rev-parse", "HEAD")

    (root / "README").write_text("v2")
    git("add", ".")
    git("commit", "-qm", "c2")
    sha2 = git("rev-parse", "HEAD")

    assert P.is_ancestor(root, sha1, sha2) is True
    assert P.is_ancestor(root, sha2, sha1) is False

    # Create two diverged commits to verify non-ancestor refusal
    git("checkout", "-qb", "branch-a", sha1)
    (root / "a.txt").write_text("a")
    git("add", ".")
    git("commit", "-qm", "ca")
    sha_a = git("rev-parse", "HEAD")

    git("checkout", "-qb", "branch-b", sha1)
    (root / "b.txt").write_text("b")
    git("add", ".")
    git("commit", "-qm", "cb")
    sha_b = git("rev-parse", "HEAD")

    assert P.is_ancestor(root, sha_a, sha_b) is False
    assert P.is_ancestor(root, sha_b, sha_a) is False

    d = root / "worker" / "live"
    d.mkdir(parents=True)
    markers = " ".join(P.REQUIRED_MARKERS)
    (d / "nova-rx-preview.task-a.js").write_text(
        f'// NOVA_MODULE_ADAPTER_V1\nconst NOVA_BUILD={{"built_at":"2026-11-19T10:00:00Z","main_sha":"{sha_a}","task":"task-a"}};\n{markers}\n'
    )
    (d / "nova-rx-preview.task-b.js").write_text(
        f'// NOVA_MODULE_ADAPTER_V1\nconst NOVA_BUILD={{"built_at":"2026-11-19T11:00:00Z","main_sha":"{sha_b}","task":"task-b"}};\n{markers}\n'
    )
    # Neither is an ancestor of the other -> main() refuses with exit code 2
    rc = P.main(["--root", str(root), "--changed", "worker/live/nova-rx-preview.task-b.js"])
    assert rc == 2


def test_build_tools_write_nova_build_stamp():
    """Verify build-worker-artifact.mjs and build-preview-refresh.mjs write NOVA_BUILD."""
    tmp = Path(tempfile.mkdtemp())
    base = Path(ROOT, "worker/live/nova-rx-preview.pur-04.js")
    out1 = tmp / "nova-rx-preview.unit-t1.js"
    subprocess.run(
        ["node", os.path.join(ROOT, "tools/build-worker-artifact.mjs"), str(base), os.path.join(ROOT, "index.html"), str(out1)],
        check=True,
        cwd=ROOT,
        stdout=subprocess.PIPE,
    )
    st1 = P.parse_build_stamp(out1)
    assert st1 and st1.get("task") == "unit-t1" and len(st1.get("main_sha", "")) == 40
    assert P.parse_iso_timestamp(st1.get("built_at")) is not None


def test_skip_older_push_and_origin_newer():
    newest = "worker/live/nova-rx-preview.wa-live3.js"
    why = P.should_deploy(newest, ["worker/live/nova-rx-preview.qa-219.js"], None, 300)
    assert why and "was not in this push" in why
    assert P.should_deploy(newest, [newest], None, 300) is None
    why = P.should_deploy(newest, [newest], ("worker/live/nova-rx-preview.wa-live4.js", 400), 300)
    assert why and "origin/main has a newer artifact" in why


def test_markers_and_no_regression():
    required = "novaWaBtn hLoad inbox/history data-wa-inbox-open NOVA_FIX50 NOVA_FIX50_VV hPoll winClosed"
    good = required + " hSend"
    qa219 = "novaWaBtn search only, no history"
    assert "hLoad" in P.missing_markers(qa219)
    assert P.missing_markers(good) == []
    live = good
    dropped = "novaWaBtn hLoad inbox/history data-wa-inbox-open hPoll winClosed hSend"
    miss = P.regression_markers(live, dropped)
    assert "NOVA_FIX50" in miss and "NOVA_FIX50_VV" in miss
    assert P.regression_markers(qa219, good) == []
    assert "waHistPin" not in P.REQUIRED_MARKERS
    pin_gated = good.replace("data-wa-inbox-open", "waHistPin")
    assert P.missing_markers(pin_gated) == ["data-wa-inbox-open"]
    for keep in ("novaWaBtn", "hLoad", "inbox/history", "NOVA_FIX50", "NOVA_FIX50_VV", "hPoll", "winClosed"):
        assert keep in P.REQUIRED_MARKERS


def test_real_artifacts():
    # PERF-02: index.html is a shell; the markers live in its split app/ files, so check the joined page
    app = subprocess.run(["node", os.path.join(ROOT, "tools/split-index.mjs"), "--join"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    assert P.missing_markers(app) == []
    assert "waHistPin" not in app
    picked = P.newest_artifact(ROOT)
    assert picked is not None
    newest_rel, _ = picked
    assert P.missing_markers(Path(ROOT, newest_rel).read_text(encoding="utf-8", errors="replace")) == []


if __name__ == "__main__":
    test_newest_by_commit_time_fallback()
    test_build_stamp_selection_and_pur01b_over_pur03_regression()
    test_real_git_ancestry_and_cli_refusal()
    test_build_tools_write_nova_build_stamp()
    test_skip_older_push_and_origin_newer()
    test_markers_and_no_regression()
    test_real_artifacts()
    print("preview_auto_deploy tests ok")
