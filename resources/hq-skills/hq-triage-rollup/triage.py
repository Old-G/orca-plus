#!/usr/bin/env python3
"""Triage roll-up helper: the owner's decisions on ClickUp change cards not yet folded into HQ/triage/<slug>.md.

  triage.py pending        new decisions and draft edits since the last roll-up: count, then one JSON line each
  triage.py done AT_MS     mark everything up to AT_MS (the newest folded) as rolled up

Works in the HQ folder ($TRIAGE_HQ, else the Orca+ HQ folder — hq-setup/hq_location.py).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hq-setup"))
from hq_location import hq_dir  # noqa: E402

DECISIONS = os.path.join("slack-scout", "decisions.json")
CORRECTIONS = os.path.join("slack-scout", "corrections.jsonl")
STATE = os.path.join("slack-scout", "triage-rollup-state.json")
PREFIX = "clickup-change:"
# Why: what each answer to a card tells the triage about its verdict.
MEANING = {
    "rejected": "Skip / Got it — не нужно было показывать или ответ не тот",
    "taken": "Do — это просьба к нам, взял задачу в работу",
    "answered": "ответил через Just reply",
}


def last_at():
    try:
        return int(json.load(open(STATE, encoding="utf-8")).get("lastAt", 0))
    except (OSError, ValueError, TypeError):
        return 0


def pending():
    since = last_at()
    rows = []
    try:
        decisions = json.load(open(DECISIONS, encoding="utf-8"))
    except (OSError, ValueError):
        decisions = {}
    for card, entry in (decisions.items() if isinstance(decisions, dict) else []):
        if not card.startswith(PREFIX) or not isinstance(entry, dict) or int(entry.get("at", 0)) <= since:
            continue
        verdict = "review" if entry.get("needsReview") else {"answer": "known", "fyi": "info"}.get(entry.get("kind"), "?")
        rows.append({
            "at": int(entry["at"]),
            "card": card,
            "project": entry.get("project"),
            "verdict": verdict,
            "decision": entry.get("decision"),
            "meaning": MEANING.get(entry.get("decision"), ""),
            "what": entry.get("title"),
            "task": entry.get("permalink"),
        })
    try:
        for line in open(CORRECTIONS, encoding="utf-8"):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if (isinstance(entry, dict) and str(entry.get("id", "")).startswith(PREFIX)
                    and int(entry.get("at", 0)) > since and entry.get("draft") and entry.get("sent")):
                rows.append({"at": int(entry["at"]), "card": entry["id"], "edit": True,
                             "draft": entry["draft"], "sent": entry["sent"]})
    except OSError:
        pass
    rows.sort(key=lambda row: row["at"])
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
    os.chdir(os.environ.get("TRIAGE_HQ") or hq_dir())
    if len(sys.argv) >= 2 and sys.argv[1] == "pending":
        pending()
    elif len(sys.argv) == 3 and sys.argv[1] == "done":
        done(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
