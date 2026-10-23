#!/usr/bin/env python3
"""SessionStart hook (HQ+ 17.4): a new Orca+ chat starts knowing its room and project — the room's
notes (HQ/workspaces/<room>/context.md) and the project card (`orca hq context --session-start`).
Outside Orca+ chats, or when Orca+ does not answer within 3 s, it prints nothing.

Install: a SessionStart hook running `python3 <this file>`. On trial in the DEV build only until the
owner switches it on (HQ_CONTEXT_HOOK_ANYWHERE=1 lifts the DEV-only gate).
"""
import os
import shutil
import subprocess
import sys


def main():
    if not os.environ.get("ORCA_AGENT_SESSION_ID"):
        return 0
    # Why: on trial in the DEV build only — the working Orca+ has no `orca hq context` yet.
    dev = os.environ.get("ORCA_USER_DATA_PATH", "").rstrip("/").endswith("orca-dev-custom")
    if not dev and os.environ.get("HQ_CONTEXT_HOOK_ANYWHERE") != "1":
        return 0
    cli = shutil.which("orca") or shutil.which("orca-plus")
    if not cli:
        return 0
    try:
        run = subprocess.run(
            [cli, "hq", "context", "--session-start"],
            capture_output=True, text=True, timeout=3, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return 0
    if run.returncode == 0 and run.stdout.strip():
        sys.stdout.write(run.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
