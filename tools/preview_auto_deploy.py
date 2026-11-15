#!/usr/bin/env python3
"""Pick the newest nova-rx-preview Worker artifact by git commit time and decide whether to auto-deploy it.
Never deploys an older artifact over a newer one (the qa-219 race). No secrets are printed.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path

REQUIRED_MARKERS = (
    "novaWaBtn",
    "hLoad",
    "inbox/history",
    "data-wa-inbox-open",  # UX400: PIN-free conversations UI (replaces the old waHistPin lock-form marker)
    "NOVA_FIX50",
    "NOVA_FIX50_VV",
    "hPoll",
    "winClosed",
)

LIVE_DIR = "worker/live"
PREFIX = "nova-rx-preview."


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_paths(root: str | Path) -> list[Path]:
    d = Path(root) / LIVE_DIR
    if not d.is_dir():
        return []
    return sorted(p for p in d.glob(PREFIX + "*.js") if p.is_file())


def commit_time(root: str | Path, rel: str, git: str = "git") -> int:
    out = subprocess.check_output(
        [git, "-C", str(root), "log", "-1", "--format=%ct", "--", rel],
        text=True,
    ).strip()
    return int(out) if out else 0


def newest_artifact(root: str | Path, times: dict[str, int] | None = None, git: str = "git") -> tuple[str, int] | None:
    """Return (relative path, commit unix time) of the newest artifact. Ties break by path name desc."""
    best = None
    for p in artifact_paths(root):
        rel = p.relative_to(root).as_posix()
        ts = times[rel] if times is not None else commit_time(root, rel, git=git)
        cand = (ts, rel)
        if best is None or cand[0] > best[0] or (cand[0] == best[0] and cand[1] > best[1]):
            best = cand
    if not best:
        return None
    return best[1], best[0]


def missing_markers(text: str, required: tuple[str, ...] = REQUIRED_MARKERS) -> list[str]:
    return [m for m in required if m not in text]


def regression_markers(live_text: str, new_text: str, required: tuple[str, ...] = REQUIRED_MARKERS) -> list[str]:
    """Markers present in the live preview that the new artifact dropped, plus any required ones it lacks."""
    from_live = [m for m in required if m in live_text and m not in new_text]
    required_missing = missing_markers(new_text, required)
    # unique, required first
    out = []
    for m in list(required_missing) + [m for m in from_live if m not in required_missing]:
        out.append(m)
    return out


def should_deploy(newest_rel: str, changed: list[str] | None, origin_newest: tuple[str, int] | None, this_time: int) -> str | None:
    """Return a skip reason, or None if this artifact should be deployed."""
    if changed is not None and newest_rel not in set(changed):
        return f"newest artifact {newest_rel} was not in this push; skipping so an older file cannot overwrite it"
    if origin_newest and (origin_newest[1] > this_time or (origin_newest[1] == this_time and origin_newest[0] > newest_rel)):
        return f"origin/main has a newer artifact {origin_newest[0]} (t={origin_newest[1]}); skipping {newest_rel}"
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--changed", default="", help="newline- or comma-separated paths changed in this push (empty = consider all)")
    ap.add_argument("--live-html", default="", help="path to downloaded live HTML for regression markers (optional)")
    ap.add_argument("--origin-newest", default="", help="path\\ttime of newest artifact on origin/main, if known")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    picked = newest_artifact(root)
    if not picked:
        print("SKIP=no worker/live/nova-rx-preview.*.js artifacts", file=sys.stderr)
        return 2
    rel, ts = picked
    changed = None
    if args.changed.strip():
        changed = [c.strip() for c in args.changed.replace(",", "\n").splitlines() if c.strip()]
    origin = None
    if args.origin_newest.strip():
        path, _, t = args.origin_newest.partition("\t")
        if not t:
            path, _, t = args.origin_newest.partition(":")
        origin = (path, int(t))
    skip = should_deploy(rel, changed, origin, ts)
    text = (root / rel).read_text(encoding="utf-8", errors="replace")
    live = ""
    if args.live_html:
        live = Path(args.live_html).read_text(encoding="utf-8", errors="replace")
    miss = regression_markers(live, text) if live else missing_markers(text)
    if miss:
        skip = skip or ("missing markers: " + ",".join(miss))
    if skip:
        print(f"SKIP={skip}", file=sys.stderr)
        print(f"ARTIFACT_PATH={rel}")
        print(f"COMMIT_TIME={ts}")
        return 2
    print(f"ARTIFACT_PATH={rel}")
    print(f"COMMIT_TIME={ts}")
    print(f"SHA256={sha256_file(root / rel)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
