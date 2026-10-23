#!/usr/bin/env python3
"""Set or clear one tag on an open waiting, keeping the rest of its detail.

  tag.py <waiting-id> task DEV-123        link a task (the waiting moves to Tracked in HQ+)
  tag.py <waiting-id> nudged 2026-10-24   a reminder went out today
  tag.py <waiting-id> checked "2026-10-24 18:05 — no answer yet"
  tag.py <waiting-id> snoozed -           clear a tag
"""
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import waiting_tags  # noqa: E402

ORCA = os.environ.get("ORCA_CLI_COMMAND") or ("orca-plus" if shutil.which("orca-plus") else "orca")


def main():
    if len(sys.argv) != 4 or sys.argv[2] not in waiting_tags.TAGS:
        sys.exit(__doc__)
    waiting_id, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
    out = subprocess.run([ORCA, "pulse", "wait", "list", "--json"], capture_output=True, text=True, check=True)
    result = json.loads(out.stdout)["result"]
    waitings = result["waitings"] if isinstance(result, dict) else result
    found = next((w for w in waitings if w["id"] == waiting_id), None)
    if not found:
        sys.exit(f"no open waiting {waiting_id}")
    detail = waiting_tags.write(found.get("detail"), key, None if value == "-" else value)
    subprocess.run([ORCA, "pulse", "wait", "update", waiting_id, "--detail", detail or "none"], check=True,
                   capture_output=True)
    print(json.dumps({"id": waiting_id, "detail": detail}, ensure_ascii=False))


if __name__ == "__main__":
    main()
