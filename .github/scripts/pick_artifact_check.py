#!/usr/bin/env python3
"""Pick the unit check(s) for the preview Worker artifact(s) a PR/branch changes.

No network, never deploys, never prints secrets.
- Changed files are diffed against the merge base with origin/main.
- No worker/live/nova-rx-preview.*.js added/modified -> SKIP (exit 0, nothing to check).
- Each changed artifact nova-rx-preview.<tag>.js runs its own check, the first that exists of:
    tests/unit/artifact-<tag>.check.mjs, artifact-<tag w/o '-'>.check.mjs,
    tests/unit/<tag>-artifact.check.mjs, <tag w/o '-'>-artifact.check.mjs
  If none exists, only `node --check <artifact>` runs (with a warning).
Usage: pick_artifact_check.py [--base REF] [--print]   (--print: list the plan, do not run)
"""
import os, re, subprocess, sys

ART = re.compile(r"^worker/live/nova-rx-preview\.([A-Za-z0-9._-]+)\.js$")


def candidates(tag):
    flat = tag.replace("-", "")
    names = [f"artifact-{tag}.check.mjs", f"artifact-{flat}.check.mjs", f"{tag}-artifact.check.mjs", f"{flat}-artifact.check.mjs"]
    out = []
    for n in names:
        if f"tests/unit/{n}" not in out:
            out.append(f"tests/unit/{n}")
    return out


def plan(changed, exists=os.path.exists):
    """changed: [(status, path)] from `git diff --name-status`. Returns [] (skip) or [(artifact, check|None)]."""
    out = []
    for st, path in changed:
        if st.startswith("D"):
            continue
        m = ART.match(path)
        if not m:
            continue
        chk = next((c for c in candidates(m.group(1)) if exists(c)), None)
        out.append((path, chk))
    return sorted(set(out))


def git_changed(base):
    mb = subprocess.run(["git", "merge-base", base, "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    raw = subprocess.run(["git", "diff", "--name-status", "--no-renames", mb, "HEAD"], capture_output=True, text=True, check=True).stdout
    rows = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            rows.append((parts[0], parts[-1]))
    return rows


def main(argv):
    base = "origin/main"
    if "--base" in argv:
        base = argv[argv.index("--base") + 1]
    p = plan(git_changed(base))
    if not p:
        print("SKIP: this ref does not add or modify a worker/live/nova-rx-preview.*.js artifact (N/A)")
        return 0
    fail = 0
    for art, chk in p:
        if "--print" in argv:
            print(f"{art} -> {chk or 'node --check only'}"); continue
        print(f"== {art}")
        r = subprocess.run(["node", "--check", art])
        fail |= r.returncode != 0
        if chk:
            print(f"== {chk}")
            fail |= subprocess.run(["node", "--no-warnings", chk]).returncode != 0
        else:
            print(f"::warning::no unit check found for {art} (tried {', '.join(candidates(ART.match(art).group(1)))}); ran node --check only")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
