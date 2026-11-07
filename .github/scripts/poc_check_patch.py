#!/usr/bin/env python3
"""Static gate for PoC Kimi patches. Runs from trusted main, never from the patch.

Usage: poc_check_patch.py PATCH_FILE
Allowlist comes from env POC_ALLOWLIST (space separated), set in the workflow.
Exit 0 = patch is acceptable, 1 = rejected (reason printed).
"""
import os
import re
import sys

MAX_PATCH_BYTES = 64 * 1024
MAX_NEW_FILE_LINES = 150
MAX_REPORT_ADDED_LINES = 40

# The test file must be new; the report may only get appended lines.
NEW_FILE = "tests/unit/poc0-manifest.check.mjs"
REPORT_FILE = "BUILD_REPORT.md"

# Code the new test file must not use (it only needs fs + JSON).
DENY_IN_TEST = [
    r"""['"](node:)?(child_process|net|http|https|http2|dgram|tls|dns|worker_threads|vm|cluster|inspector|os)['"]""",
    r"\brequire\s*\(",
    r"\bimport\s*\(",
    r"\bfetch\b",
    r"\bWebSocket\b",
    r"\bprocess\.env\b",
    r"\beval\s*\(",
    r"\bFunction\s*\(",
    r"\b(writeFile|appendFile|unlink|rmdir|rm|rename|symlink|chmod|copyFile)(Sync)?\s*\(",
]

# Anything that looks like a credential in added lines.
SECRET_PATTERNS = [
    r"sk-[A-Za-z0-9_-]{16,}",
    r"gh[pousr]_[A-Za-z0-9]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}",
    r"AKIA[0-9A-Z]{16}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{12,}",
]


def fail(msg):
    print(f"REJECT: {msg}")
    sys.exit(1)


def main():
    if len(sys.argv) != 2:
        fail("usage: poc_check_patch.py PATCH_FILE")
    allow = os.environ.get("POC_ALLOWLIST", "").split()
    if sorted(allow) != sorted([NEW_FILE, REPORT_FILE]):
        fail(f"POC_ALLOWLIST must be exactly {NEW_FILE} {REPORT_FILE}, got {allow}")

    raw = open(sys.argv[1], "rb").read()
    if not raw.strip():
        fail("patch is empty")
    if len(raw) > MAX_PATCH_BYTES:
        fail(f"patch too large ({len(raw)} bytes)")
    if b"\0" in raw:
        fail("patch contains NUL bytes")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail("patch is not valid UTF-8")
    if "\r" in text:
        fail("patch contains carriage returns")

    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if not lines or not lines[0].startswith("diff --git "):
        fail("patch must start with 'diff --git'")

    # Split into per-file blocks.
    blocks, cur = [], None
    for ln in lines:
        if ln.startswith("diff --git "):
            cur = [ln]
            blocks.append(cur)
        else:
            cur.append(ln)

    seen = set()
    for blk in blocks:
        m = re.fullmatch(r"diff --git a/(\S+) b/(\S+)", blk[0])
        if not m or m.group(1) != m.group(2):
            fail(f"unexpected diff header: {blk[0]!r}")
        path = m.group(1)
        if path not in allow:
            fail(f"file not in allowlist: {path}")
        if path in seen:
            fail(f"file appears twice: {path}")
        seen.add(path)

        # Header = everything before the first hunk.
        i = 1
        header = []
        while i < len(blk) and not blk[i].startswith("@@"):
            header.append(blk[i])
            i += 1
        body = blk[i:]
        if not body:
            fail(f"{path}: no text hunks (binary or mode-only change?)")

        if path == NEW_FILE:
            want = ["new file mode 100644", None, "--- /dev/null", f"+++ b/{path}"]
        else:
            want = [None, f"--- a/{path}", f"+++ b/{path}"]
        if len(header) != len(want):
            fail(f"{path}: unexpected header lines {header!r}")
        for got, exp in zip(header, want):
            if exp is None:
                if not re.fullmatch(r"index [0-9a-f]{7,64}\.\.[0-9a-f]{7,64}( 100644)?", got):
                    fail(f"{path}: unexpected index line {got!r}")
            elif got != exp:
                fail(f"{path}: expected {exp!r}, got {got!r}")

        added, removed = [], 0
        for ln in body:
            if ln.startswith("@@"):
                if not re.match(r"@@ -\d+(,\d+)? \+\d+(,\d+)? @@", ln):
                    fail(f"{path}: bad hunk header {ln!r}")
            elif ln.startswith("+"):
                added.append(ln[1:])
            elif ln.startswith("-"):
                removed += 1
            elif ln.startswith(" ") or ln == "\\ No newline at end of file":
                pass
            else:
                fail(f"{path}: unexpected patch line {ln[:80]!r}")

        if path == NEW_FILE:
            if removed:
                fail(f"{path}: new file cannot have removed lines")
            if len(added) > MAX_NEW_FILE_LINES:
                fail(f"{path}: too long ({len(added)} lines)")
            src = "\n".join(added)
            for pat in DENY_IN_TEST:
                if re.search(pat, src):
                    fail(f"{path}: forbidden code pattern {pat}")
        else:
            if removed:
                fail(f"{path}: only appended lines are allowed ({removed} removed)")
            if len(added) > MAX_REPORT_ADDED_LINES:
                fail(f"{path}: too many added lines ({len(added)})")

        for a in added:
            for pat in SECRET_PATTERNS:
                if re.search(pat, a):
                    fail(f"{path}: added line looks like a credential")

    if NEW_FILE not in seen:
        fail(f"patch does not create {NEW_FILE}")
    print(f"OK: patch touches only {sorted(seen)}")


if __name__ == "__main__":
    main()
