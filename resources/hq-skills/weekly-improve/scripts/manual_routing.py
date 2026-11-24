#!/usr/bin/env python3
"""Manual routing (HQ+ 17.11): how often the owner moved work between chats by hand — «передай»,
«запиши», «проверь», «ну что?», «что дальше?», a bare «да / погнали» after «Дальше по плану», a
handoff started by hand, an answer passed with «Send to chat» — and what Orca+ did by itself
instead (Approve, Codex fixing chats, answers passed by rule, the session dispatcher).

  manual_routing.py --since 2026-10-16 [--until 2026-10-23]   → JSON to stdout, per day and in total

Read-only over agent transcripts (~/.claude/projects) and Orca+'s pulse database; collect.py --day
puts the same block into the day's journal for daily-review.
"""
import argparse
import collections
import glob
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect  # noqa: E402

SAMPLES = 3
SHORT = 80

# Orca+'s own prompts that carry what the owner did with a button, or what a rule did instead.
REPLY_BUTTON = re.compile(r"^orca\+ · (an answer the user passed|the user passed you an answer|answer from slack)", re.I)
INTAKE_BUTTON = re.compile(r"^orca\+ · the user sent you a slack message", re.I)
BY_RULE = re.compile(r"^orca\+ · (an answer to your question.{0,80}routing rule|codex: починить|ты ведёшь нить|ещё находки codex)", re.I)
HANDOFF_PICKUP = re.compile(r"^continue from \S*handoff", re.I)
# The handoff file a «Continue from …» line or an `orca agent launch` command names, by its file name:
# chats name it relatively (`.claude/handoff/handoff-<id>.md`) or read it into `$P` first (24.11).
HANDOFF_FILE = re.compile(r"handoff-[A-Za-z0-9_-]+\.md")
# Why: a chat that writes its handoff and then runs `orca agent launch` starts its own successor, even
# when the command only names the file in a variable set by an earlier call.
OWN_LAUNCH_SECS = 15 * 60

NOTE = re.compile(r"\bзапиш|в заметк|в ноутс|\bв notes\b|сохрани (это )?в замет|добавь (это )?в замет", re.I)
RELAY = re.compile(
    r"^(?!(я|ты|мы|он|вы) )(\S+\s){1,3}(ответил|ответила|ответили|написал|написала|прислал|прислала)\b|"
    r"\bпередай\b|\bперешли\b|(отправь|напиши|скажи) (в )?(ту|той|другую|другой|соседн\w*) сесси|в (ту|другую) сессию",
    re.I,
)
STATUS = re.compile(r"^(ну что|ну\?|что тут|тут\?|что там|как там|ну как|готово\??$|закончил|агент закончил|где мы|статус\??$)|агент закончил", re.I)
NEXT = re.compile(r"что (дальше|далее)|^(дальше|далее)\?", re.I)
CHECK = re.compile(r"^(проверь|посмотри)\b|\bпроверь\b", re.I)
GO_ON = re.compile(
    r"^(да|ок|окей|ok|го|давай|погнали|поехали|делай|продолжай|продолжи|выкатывай|вперёд|вперед)"
    r"([ ,.!]+(да|давай|погнали|делай|далее|дальше|сделай|go))*[ .!]*$",
    re.I,
)
# The agent's turn ended inviting the next step — the owner's bare «да» answers that, not a question of substance.
ASKED_NEXT = re.compile(r"(Дальше по плану|Следующий шаг|Начинать\?|Продолжать\?|Делать\?|Делаем\?|погнали\?|Запускаю\?)", re.I)
STOPS_THE_OWNER_RESTARTS = {"network", "other"}

OWNER_KINDS = (
    "relay", "note", "check", "status", "next", "go_on", "continue_after_stop",
    "reply_button", "intake_button", "handoff_pickup",
)


def owner_kind(text, prev, first):
    """The kind of manual routing a message of the owner is, or None for ordinary work."""
    low = text.lower().strip()
    if REPLY_BUTTON.match(low):
        return "reply_button"
    if INTAKE_BUTTON.match(low):
        return "intake_button"
    if first and HANDOFF_PICKUP.match(low):
        return "handoff_pickup"
    if collect.AUTOMATED.match(text):
        return None
    if prev and prev[0].startswith("stop:") and prev[0][5:] in STOPS_THE_OWNER_RESTARTS and collect.CONTINUE.match(low):
        return "continue_after_stop"
    head = low[:200]
    if NOTE.search(head):
        return "note"
    if RELAY.search(head):
        return "relay"
    if len(low) <= SHORT and STATUS.search(low):
        return "status"
    if len(low) <= SHORT and NEXT.search(low):
        return "next"
    if len(low) <= SHORT and CHECK.search(low):
        return "check"
    if len(low) <= 40 and GO_ON.match(collect.canon(low)) and prev and prev[0] == "assistant" and ASKED_NEXT.search(prev[1][-500:]):
        return "go_on"
    return None


def _at(stamp):
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() if stamp else 0
    except ValueError:
        return 0


def _tool_uses(entry):
    for part in entry.get("message", {}).get("content", []) or []:
        if isinstance(part, dict) and part.get("type") == "tool_use":
            yield part.get("name"), part.get("input") or {}


def _launched_handoffs(entry):
    """Handoff files a chat names in an `orca agent launch` command — its own successor's start."""
    files = []
    for name, tool_input in _tool_uses(entry):
        command = str(tool_input.get("command", "")) if name == "Bash" else ""
        if "agent launch" in command:
            files.extend(HANDOFF_FILE.findall(command))
    return files


def _launches(entry):
    """Whether the entry runs `orca agent launch`."""
    return any(name == "Bash" and "agent launch" in str(tool_input.get("command", "")) for name, tool_input in _tool_uses(entry))


def _written_handoffs(entry):
    """Handoff files the entry writes."""
    files = []
    for name, tool_input in _tool_uses(entry):
        if name in ("Write", "Edit", "MultiEdit"):
            path = str(tool_input.get("file_path", ""))
            if "/.claude/handoff/" in path:
                files.extend(HANDOFF_FILE.findall(path))
    return files


def _assistant_text(entry):
    return " ".join(
        part.get("text", "") for part in entry.get("message", {}).get("content", []) or []
        if isinstance(part, dict) and part.get("type") == "text"
    )


def owner_counts(cut, end, started_by_orca=frozenset()):
    """Manual routing in the owner's chats between cut and end (epoch s), by kind and by day.

    `started_by_orca` — handoff file names whose successor Orca+ started by itself."""
    by_kind, by_day, rule_prompts = collections.Counter(), collections.Counter(), 0
    samples = collections.defaultdict(list)
    # Why (01.11): a chat that starts its successor itself is not the owner's hand; its handoff counts
    # once every transcript is read, since the successor's may come first.
    pickups, launched_by_agent = collections.defaultdict(list), collections.Counter()

    def count(kind, at, sample):
        by_kind[kind] += 1
        by_day[datetime.fromtimestamp(at).strftime("%Y-%m-%d")] += 1
        if len(samples[kind]) < SAMPLES:
            samples[kind].append(sample)

    for path in glob.glob(os.path.join(collect.HOME, ".claude", "projects", "*", "*.jsonl")):
        if os.path.getmtime(path) < cut:
            continue
        project = os.path.basename(os.path.dirname(path)).split("-Projects-")[-1] or "home"
        if collect.SANDBOX_PROJECT.search(project):
            continue
        prev, first = None, True
        written = {}
        with open(path, encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                if '"isSidechain":true' in line:
                    continue
                is_user = '"type":"user"' in line
                if not is_user and '"type":"assistant"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if entry.get("type") == "assistant":
                    at = _at(entry.get("timestamp"))
                    named = _launched_handoffs(entry)
                    launched_by_agent.update(named)
                    for name in _written_handoffs(entry):
                        written.setdefault(name, at)
                    if not named and _launches(entry):
                        launched_by_agent.update(
                            name for name, wrote in written.items() if 0 <= at - wrote < OWN_LAUNCH_SECS)
                        written.clear()
                    if entry.get("isApiErrorMessage"):
                        prev = ("stop:" + collect.stop_kind(entry), "")
                    else:
                        text = _assistant_text(entry)
                        if text:
                            prev = ("assistant", text)
                    continue
                if entry.get("type") != "user" or entry.get("isMeta"):
                    continue
                text = collect.norm(collect.user_text(entry))
                if not text:
                    continue
                at = _at(entry.get("timestamp"))
                kind = owner_kind(text, prev, first)
                if BY_RULE.match(text.lower()) and cut <= at < end:
                    rule_prompts += 1
                first, prev = False, ("user", text)
                if kind is None or not (cut <= at < end):
                    continue
                sample = {"project": project, "at": datetime.fromtimestamp(at).strftime("%d.%m %H:%M"), "text": text[:120]}
                if kind == "handoff_pickup":
                    name = HANDOFF_FILE.search(text)
                    pickups[name.group(0) if name else None].append((at, sample))
                    continue
                count(kind, at, sample)
    # Why per file: one handoff may be started by Orca+ and by its own chat (01.11: 01:27 and 01:28);
    # each start by the chat or by Orca+ takes one of its pickups off, the rest are the owner's hand.
    by_agent = by_orca = 0
    for name, starts in pickups.items():
        agent = min(launched_by_agent[name], len(starts)) if name else 0
        orca = min(1 if name in started_by_orca else 0, len(starts) - agent)
        by_agent += agent
        by_orca += orca
        for at, sample in sorted(starts, key=lambda start: start[0])[: len(starts) - agent - orca]:
            count("handoff_pickup", at, sample)
    return {
        "by_kind": {kind: by_kind.get(kind, 0) for kind in OWNER_KINDS},
        "by_day": dict(sorted(by_day.items())),
        "rule_prompts": rule_prompts,
        "samples": dict(samples),
        "handoffs_by_agent": by_agent,
        "handoffs_by_orca": by_orca,
    }


def automated_counts(cut, end):
    """What Orca+ proposed or did by itself in the window, and how the owner took it."""
    try:
        db = sqlite3.connect(f"{Path(collect.PULSE_DB).as_uri()}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error as error:
        return {"error": str(error)}
    lo, hi = int(cut * 1000), int(end * 1000)

    def one(sql, *params):
        return db.execute(sql, params).fetchone()[0] or 0

    def journal(where, *params):
        return one(f"SELECT count(*) FROM journal WHERE at >= ? AND at < ? AND {where}", lo, hi, *params)

    try:
        approvals = dict(db.execute(
            "SELECT outcome, count(*) FROM decisions WHERE kind = 'approval' AND decided_at >= ? AND decided_at < ?"
            " GROUP BY outcome", (lo, hi)).fetchall())
        codex = "kind = 'routing.action' AND source = 'hq-routing' AND coalesce(ref_kind, '') != 'waiting-reply'"
        reply = "kind = 'routing.action' AND source = 'hq-routing' AND ref_kind = 'waiting-reply'"
        result = {
            "approve": {
                "proposed": sum(approvals.values()),
                "approved": approvals.get("approved", 0),
                "edited": approvals.get("edited", 0),
                "rejected": approvals.get("rejected", 0),
            },
            "codex": {
                "chats_opened": journal(f"{codex} AND title LIKE 'Codex: починить%'"),
                "handed_more": journal(f"{codex} AND title LIKE 'Codex: % more handed to %'"),
                "asked_owner": journal(f"{codex} AND needs = 'owner:decide'"),
                "fixed": journal("kind = 'entry.settled' AND title LIKE 'Fixed:%'"),
                "no_fix_needed": journal("kind = 'entry.settled' AND title LIKE 'No fix needed:%'"),
            },
            "replies": {
                "passed_by_rule": journal(f"{reply} AND title LIKE '% by rule'"),
                "left_as_card": journal(f"{reply} AND needs = 'owner:decide'"),
                # Answers delivered into a chat at all; minus the ones passed by rule = the owner's «Send to chat».
                "delivered": one(
                    "SELECT count(*) FROM waitings WHERE reply_delivered_at >= ? AND reply_delivered_at < ?", lo, hi),
            },
            "dispatcher": {
                "would_do": journal("kind = 'session.plan'"),
                "opened": journal("kind = 'session.open' AND coalesce(dedupe_key, '') NOT LIKE 'session.open:handoff:%'"),
                "continued": journal("kind = 'session.continue'"),
                "queued": journal("kind = 'session.queued'"),
                "closed": journal("kind = 'session.close'"),
                "handoffs_started": journal("kind = 'session.open' AND dedupe_key LIKE 'session.open:handoff:%'"),
            },
        }
    except sqlite3.Error as error:
        return {"error": str(error)}
    finally:
        db.close()
    replies = result["replies"]
    replies["sent_by_hand"] = max(replies["delivered"] - replies["passed_by_rule"], 0)
    return result


def handoffs_started_by_orca(cut, end):
    """Handoff file names whose successor Orca+ started by itself: its `session.open:handoff:<session>`
    rows, the offer id being the session the file is named after."""
    try:
        db = sqlite3.connect(f"{Path(collect.PULSE_DB).as_uri()}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return frozenset()
    try:
        rows = db.execute(
            "SELECT dedupe_key FROM journal WHERE kind = 'session.open' AND dedupe_key LIKE 'session.open:handoff:%'"
            " AND at >= ? AND at < ?", (int(cut * 1000), int(end * 1000))).fetchall()
    except sqlite3.Error:
        return frozenset()
    finally:
        db.close()
    return frozenset(f"handoff-{row[0].rsplit(':', 1)[-1]}.md" for row in rows)


def manual_routing(cut, end):
    """The day's (or window's) manual routing next to what Orca+ did by itself."""
    # Why the files: the dispatcher's own start opens the next chat with the same «Continue from …» line;
    # the chat's own start too — each is matched to its handoff file, not subtracted as a day's total.
    owner = owner_counts(cut, end, handoffs_started_by_orca(cut, end))
    auto = automated_counts(cut, end)
    kinds = owner["by_kind"]
    if isinstance(auto.get("dispatcher"), dict):
        auto["dispatcher"]["handoffs_by_agent"] = owner["handoffs_by_agent"]
        auto["dispatcher"]["handoffs_by_orca_matched"] = owner["handoffs_by_orca"]
    return {
        "window": {
            "from": datetime.fromtimestamp(cut).isoformat(timespec="minutes"),
            "to": datetime.fromtimestamp(end).isoformat(timespec="minutes"),
            "days": round((end - cut) / 86400, 2),
        },
        "manual_total": sum(kinds.values()),
        "manual": kinds,
        "manual_by_day": owner["by_day"],
        "manual_samples": owner["samples"],
        "orca_by_itself": auto,
        "rule_prompts_in_chats": owner["rule_prompts"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", required=True, help="first local day, YYYY-MM-DD")
    parser.add_argument("--until", help="day after the last one, YYYY-MM-DD (default: now)")
    args = parser.parse_args()
    cut = datetime.strptime(args.since, "%Y-%m-%d").timestamp()
    end = datetime.strptime(args.until, "%Y-%m-%d").timestamp() if args.until else datetime.now().timestamp()
    json.dump(collect.redact(manual_routing(cut, end)), sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
