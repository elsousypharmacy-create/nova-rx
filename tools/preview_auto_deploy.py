#!/usr/bin/env python3
"""Pick the newest nova-rx-preview Worker artifact by embedded NOVA_BUILD stamp
(falling back to git commit time for legacy unstamped artifacts) and decide
whether to auto-deploy it.

Refuses an artifact whose embedded main_sha is not an ancestor-or-equal of
another artifact's main_sha (or is behind a newer artifact), preventing an
older-based branch merged later (e.g. pur-01b over pur-03) from overwriting
newer work. No secrets are printed.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
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
STAMP_RE = re.compile(r"(?:const\s+NOVA_BUILD\s*=\s*|NOVA_BUILD\s*=\s*)(\{[^\n;]*\})")


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


def parse_build_stamp(text_or_path: str | Path) -> dict[str, str] | None:
    """Extract NOVA_BUILD = {built_at, main_sha, task} from artifact head text or file path."""
    if isinstance(text_or_path, Path) or (
        isinstance(text_or_path, str)
        and "\n" not in text_or_path
        and len(text_or_path) < 4096
        and os.path.exists(text_or_path)
    ):
        try:
            with open(text_or_path, "r", encoding="utf-8", errors="replace") as f:
                head = f.read(16384)
        except OSError:
            return None
    else:
        head = str(text_or_path)[:16384]
    m = STAMP_RE.search(head)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data


def parse_iso_timestamp(iso_str: str | None) -> int | None:
    if not iso_str or not isinstance(iso_str, str):
        return None
    s = iso_str.strip()
    if not s:
        return None
    try:
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def commit_time(root: str | Path, rel: str, git: str = "git") -> int:
    try:
        out = subprocess.check_output(
            [git, "-C", str(root), "log", "-1", "--format=%ct", "--", rel],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        return int(out) if out else 0
    except Exception:
        return 0


def is_ancestor(
    root: str | Path,
    older_sha: str,
    newer_sha: str,
    git: str = "git",
    ancestry: dict[tuple[str, str], bool] | None = None,
) -> bool:
    """Return True if older_sha is an ancestor-or-equal of newer_sha in git history."""
    if not older_sha or not newer_sha:
        return True
    if older_sha == newer_sha:
        return True
    if ancestry is not None and (older_sha, newer_sha) in ancestry:
        return ancestry[(older_sha, newer_sha)]
    try:
        r = subprocess.run(
            [git, "-C", str(root), "merge-base", "--is-ancestor", older_sha, newer_sha],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if r.returncode == 0:
            return True
        if r.returncode == 1:
            return False
        # Unknown commit object in shallow/temp repo: check if newer_sha is actually older
        return False
    except Exception:
        return False


def artifact_time_and_stamp(
    root: str | Path,
    p: Path,
    times: dict[str, int] | None = None,
    stamps: dict[str, dict[str, str]] | None = None,
    git: str = "git",
) -> tuple[int, dict[str, str] | None]:
    rel = p.relative_to(root).as_posix()
    stamp = stamps.get(rel) if stamps is not None and rel in stamps else parse_build_stamp(p)
    built_ts = parse_iso_timestamp(stamp.get("built_at")) if stamp else None
    if built_ts is not None:
        return built_ts, stamp
    ts = times[rel] if times is not None and rel in times else commit_time(root, rel, git=git)
    return ts, stamp


def newest_artifact(
    root: str | Path,
    times: dict[str, int] | None = None,
    git: str = "git",
    stamps: dict[str, dict[str, str]] | None = None,
    ancestry: dict[tuple[str, str], bool] | None = None,
) -> tuple[str, int] | None:
    """Return (relative path, unix timestamp) of the newest artifact.
    Uses embedded NOVA_BUILD.built_at when present (fallback: git commit time).
    If an artifact's main_sha is a strict ancestor of another artifact's main_sha,
    the descendant wins even if its built_at/commit time is slightly earlier.
    Ties break by path name desc.
    """
    root_path = Path(root)
    entries: list[tuple[int, str, str]] = []
    for p in artifact_paths(root_path):
        rel = p.relative_to(root_path).as_posix()
        ts, stamp = artifact_time_and_stamp(root_path, p, times=times, stamps=stamps, git=git)
        sha = (stamp or {}).get("main_sha") or ""
        entries.append((ts, rel, sha))
    if not entries:
        return None

    # Filter out any artifact whose main_sha is a strict ancestor of another artifact's main_sha
    filtered: list[tuple[int, str, str]] = []
    for ts, rel, sha in entries:
        superseded = False
        if sha:
            for _, other_rel, other_sha in entries:
                if other_rel != rel and other_sha and other_sha != sha:
                    if is_ancestor(root_path, sha, other_sha, git=git, ancestry=ancestry) and not is_ancestor(
                        root_path, other_sha, sha, git=git, ancestry=ancestry
                    ):
                        superseded = True
                        break
        if not superseded:
            filtered.append((ts, rel, sha))

    pool = filtered or entries
    best = max(pool, key=lambda item: (item[0], item[1]))
    return best[1], best[0]


def check_main_sha_ancestry(
    root: str | Path,
    candidate_rel: str,
    candidate_sha: str | None = None,
    other_shas: dict[str, str] | None = None,
    git: str = "git",
    ancestry: dict[tuple[str, str], bool] | None = None,
) -> str | None:
    """Verify that candidate_rel's embedded main_sha is an ancestor-or-equal of (or descendant of)
    every other stamped artifact's main_sha, and specifically that every other stamped artifact's
    main_sha is an ancestor-or-equal of candidate_sha.
    Returns a refusal reason string if candidate_sha is not a descendant-or-equal of a newer artifact's main_sha,
    or None if valid.
    """
    root_path = Path(root)
    if candidate_sha is None:
        cand_path = root_path / candidate_rel
        stamp = parse_build_stamp(cand_path) if cand_path.is_file() else None
        candidate_sha = (stamp or {}).get("main_sha") or ""
    if not candidate_sha:
        return None

    peers: dict[str, str] = {}
    if other_shas is not None:
        peers.update(other_shas)
    else:
        for p in artifact_paths(root_path):
            rel = p.relative_to(root_path).as_posix()
            if rel == candidate_rel:
                continue
            st = parse_build_stamp(p)
            sh = (st or {}).get("main_sha") or ""
            if sh:
                peers[rel] = sh

    for other_rel, other_sha in sorted(peers.items()):
        if not other_sha or other_rel == candidate_rel or other_sha == candidate_sha:
            continue
        # Candidate is valid only if other_sha is an ancestor-or-equal of candidate_sha.
        # If candidate_sha is an ancestor of other_sha (or diverged/not descendant), refuse!
        if not is_ancestor(root_path, other_sha, candidate_sha, git=git, ancestry=ancestry):
            return (
                f"artifact {candidate_rel} (main_sha={candidate_sha[:12]}) is not a descendant-or-equal "
                f"of {other_rel} (main_sha={other_sha[:12]}); refusing so older base cannot overwrite newer work"
            )
    return None


def missing_markers(text: str, required: tuple[str, ...] = REQUIRED_MARKERS) -> list[str]:
    return [m for m in required if m not in text]


def regression_markers(live_text: str, new_text: str, required: tuple[str, ...] = REQUIRED_MARKERS) -> list[str]:
    """Markers present in the live preview that the new artifact dropped, plus any required ones it lacks."""
    from_live = [m for m in required if m in live_text and m not in new_text]
    required_missing = missing_markers(new_text, required)
    out = []
    for m in list(required_missing) + [m for m in from_live if m not in required_missing]:
        out.append(m)
    return out


def should_deploy(
    newest_rel: str,
    changed: list[str] | None,
    origin_newest: tuple[str, int] | tuple[str, int, str] | None,
    this_time: int,
    *,
    root: str | Path | None = None,
    this_main_sha: str = "",
    other_shas: dict[str, str] | None = None,
    git: str = "git",
    ancestry: dict[tuple[str, str], bool] | None = None,
) -> str | None:
    """Return a skip reason, or None if this artifact should be deployed."""
    if changed is not None and newest_rel not in set(changed):
        return f"newest artifact {newest_rel} was not in this push; skipping so an older file cannot overwrite it"
    if origin_newest:
        o_rel, o_time = origin_newest[0], origin_newest[1]
        o_sha = origin_newest[2] if len(origin_newest) > 2 else ""
        if o_time > this_time or (o_time == this_time and o_rel > newest_rel):
            return f"origin/main has a newer artifact {o_rel} (t={o_time}); skipping {newest_rel}"
        if o_sha and this_main_sha and root is not None:
            if not is_ancestor(root, o_sha, this_main_sha, git=git, ancestry=ancestry):
                return (
                    f"artifact {newest_rel} (main_sha={this_main_sha[:12]}) is not an ancestor-or-equal/descendant "
                    f"of origin/main newest {o_rel} (main_sha={o_sha[:12]}); skipping"
                )
    if root is not None:
        anc_err = check_main_sha_ancestry(
            root,
            newest_rel,
            candidate_sha=this_main_sha or None,
            other_shas=other_shas,
            git=git,
            ancestry=ancestry,
        )
        if anc_err:
            return anc_err
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--changed", default="", help="newline- or comma-separated paths changed in this push (empty = consider all)")
    ap.add_argument("--live-html", default="", help="path to downloaded live HTML for regression markers (optional)")
    ap.add_argument("--origin-newest", default="", help="path\\ttime[\\tmain_sha] of newest artifact on origin/main, if known")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    picked = newest_artifact(root)
    if not picked:
        print("SKIP=no worker/live/nova-rx-preview.*.js artifacts", file=sys.stderr)
        return 2
    rel, ts = picked
    stamp = parse_build_stamp(root / rel) or {}
    this_sha = stamp.get("main_sha") or ""
    changed = None
    if args.changed.strip():
        changed = [c.strip() for c in args.changed.replace(",", "\n").splitlines() if c.strip()]
    origin: tuple[str, int, str] | None = None
    if args.origin_newest.strip():
        parts = args.origin_newest.split("\t") if "\t" in args.origin_newest else args.origin_newest.split(":")
        path = parts[0]
        t = int(parts[1]) if len(parts) > 1 and parts[1] else 0
        o_sha = parts[2].strip() if len(parts) > 2 else ""
        origin = (path, t, o_sha)
    skip = should_deploy(rel, changed, origin, ts, root=root, this_main_sha=this_sha)
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
        if stamp.get("built_at"):
            print(f"BUILD_TIME={stamp['built_at']}")
        if this_sha:
            print(f"MAIN_SHA={this_sha}")
        return 2
    print(f"ARTIFACT_PATH={rel}")
    print(f"COMMIT_TIME={ts}")
    if stamp.get("built_at"):
        print(f"BUILD_TIME={stamp['built_at']}")
    if this_sha:
        print(f"MAIN_SHA={this_sha}")
    print(f"SHA256={sha256_file(root / rel)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
