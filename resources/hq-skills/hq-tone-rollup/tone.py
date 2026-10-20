#!/usr/bin/env python3
"""Tone roll-up helper: which of the owner's edits to drafted replies are not yet folded into wiki/tone.md.

  tone.py pending        new corrections since the last roll-up: count, then one JSON line each
  tone.py done AT_MS     mark every correction up to AT_MS (the newest folded) as rolled up

Works in the HQ folder ($TONE_HQ, else the Orca+ HQ folder — hq-setup/hq_location.py).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hq-setup"))
from hq_location import hq_dir  # noqa: E402

CORRECTIONS = os.path.join("slack-scout", "corrections.jsonl")
STATE = os.path.join("slack-scout", "tone-state.json")


def last_at():
    try:
        return int(json.load(open(STATE, encoding="utf-8")).get("lastAt", 0))
    except (OSError, ValueError, TypeError):
        return 0


def pending():
    since = last_at()
    rows = []
    try:
        for line in open(CORRECTIONS, encoding="utf-8"):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict) and int(entry.get("at", 0)) > since and entry.get("draft") and entry.get("sent"):
                rows.append({k: entry.get(k) for k in ("at", "source", "draft", "sent")})
    except OSError:
        pass
    print(f"pending: {len(rows)}")
    for row in rows:
        print(json.dumps(row, ensure_ascii=False))


def done(at):
    temp = f"{STATE}.{os.getpid()}.tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump({"lastAt": max(int(at), last_at())}, handle)
    os.replace(temp, STATE)
    print(f"rolled up to {at}")


def main():
    os.chdir(os.environ.get("TONE_HQ") or hq_dir())
    if len(sys.argv) >= 2 and sys.argv[1] == "pending":
        pending()
    elif len(sys.argv) == 3 and sys.argv[1] == "done":
        done(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
