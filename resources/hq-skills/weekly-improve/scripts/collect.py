#!/usr/bin/env python3
"""Weekly self-improvement: gathers what the owner did over the last N days into one JSON digest.

  collect.py [--days 7] [--hq <HQ folder>]            → writes HQ/improvements/<YYYY-Www>-input.json, prints its path
  collect.py --day 2026-10-18                         → the work journal of one day: HQ/journal/<date>.json

Read-only over agent transcripts (~/.claude/projects), HQ files, the git log of HQ's registry
projects and (for --day) Orca+'s pulse database. No network, no writes outside HQ/improvements and
HQ/journal.
"""
import argparse
import collections
import difflib
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "hq-setup"))
from hq_location import hq_dir  # noqa: E402

HOME = os.path.expanduser("~")
TEXT_MAX = 300
SAMPLE_MAX = 350
# Why: prompts Orca+ or an agent wrote, not the owner — handoffs, automations, HQ buttons, wrappers.
AUTOMATED = re.compile(
    r"^(continue from |продолжаем orca|прогони разведчика|собери утренний брифинг|собери превью|"
    r"ночной садовник|спроси hq \(скилл|статус \w+ \(скилл|<|\[orca|caveat:|this session is being continued|"
    r"you are |задача от \w+ \(передал|name this chat from|review this change for security|"
    r"orca restarted, which stopped|\[request interrupted|use the bash tool to run|ask \w+ in slack whether|"
    # Orca+ buttons and background jobs (W42: the feed prompt alone was 49 «messages»), test pings.
    r"ты пишешь ленту|ответь за \w+ в тред|перепиши надиктованное в задание|сверни новые правки \w+|"
    r"недельный разбор по скиллу|задай мне один вопрос через инструмент|работай в этом репо \(|"
    r"reply with (just|the single word)|call the tool |просто тестовое сообщение|"
    # Orca+ notices, scheduled runs and relayed answers (19.10: 10 of 106 «messages»).
    r"orca\+ перезапущена на|the scheduled upstream sync|итоги (дня|месяца) по скиллу|"
    r"вечерняя сводка «кого ждём»|ответь одним словом|[^\n]{1,80}? ответила? по нашему ожиданию)",
    re.I,
)


# A bare "go on" — what limit-guard sends (CLAUDE_LIMIT_CONTINUE_PROMPT) and what the owner types after a stop.
CONTINUE = re.compile(r"^(продолжай|продолжи|продолжаем|продолжить|давай дальше|дальше|continue|go on)\b.{0,25}$", re.I)
# limit-guard (Orca+ src/main/claude-limit-guard) nudges after these; network stops wait for the owner.
GUARD_CONTINUES = {"limit", "auth"}
# The owner's one-word commands; a typo («продолажй», «провреь») is counted as the word it meant.
SHORT_WORDS = ("продолжай", "проверь", "выкатывай", "погнали", "делай")


def canon(text):
    """A one-word message with a typo → the word it meant; anything else unchanged."""
    word = text.lower().strip(" .!?,")
    if " " in word or len(word) < 5:
        return text
    best = max(SHORT_WORDS, key=lambda w: difflib.SequenceMatcher(None, word, w).ratio())
    return best if difflib.SequenceMatcher(None, word, best).ratio() >= 0.75 else text
# The owner pushing back on what the agent just did — a stumble signal for the skill that ran before it.
CORRECTION = re.compile(r"(^нет\b|не так|не то\b|неправильно|не надо|зачем|почему|ты же|я же|опять|снова|^стоп\b|подожди|блять|ну так|а как мы|надо было|а не )", re.I)
NETWORK = re.compile(r"ENOTFOUND|ECONNRESET|ETIMEDOUT|Can't reach the API|Connection (dropped|lost|error)|socket hang up|fetch failed", re.I)


def stop_kind(entry):
    """Why the assistant turn stopped on an API error: limit / network / auth / other."""
    text = " ".join(p.get("text", "") for p in entry.get("message", {}).get("content", []) or [] if isinstance(p, dict))
    if entry.get("error") == "rate_limit" or entry.get("apiError") == "usage_limit_reached" or "hit your" in text:
        return "limit"
    if NETWORK.search(text):
        return "network"
    if entry.get("error") == "authentication_failed":
        return "auth"
    return "other"


def minutes_between(start, end):
    try:
        a = datetime.fromisoformat(start.replace("Z", "+00:00"))
        b = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return round((b - a).total_seconds() / 60, 1)


# Secrets pasted into chats must not land in the input file (a client secret once did).
SECRET = re.compile(
    r"WPL_AP\d\.[\w+/=.-]+|sk-[\w-]{16,}|gh[pousr]_\w{20,}|glpat-[\w-]{16,}|xox[abpr]-[\w-]{10,}|"
    r"AKIA[0-9A-Z]{16}|\b\d{8,10}:AA[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|"
    r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"
)


def norm(text):
    return SECRET.sub("[redacted]", re.sub(r"\s+", " ", text).strip())


def redact(value):
    """Every free-text field of a digest with secrets masked, whatever source it came from."""
    if isinstance(value, str):
        return SECRET.sub("[redacted]", value)
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    return value


def median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else round((ordered[mid - 1] + ordered[mid]) / 2, 1)


def week_label(now):
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def user_text(entry):
    content = entry.get("message", {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def transcripts(cut, end=None):
    prompts, skills, commands, per_project = [], collections.Counter(), collections.Counter(), collections.Counter()
    # "продолжай" right after an API-error stop, by stop kind; after limit/auth it is limit-guard's, not the owner's.
    after_error, after_error_waits = collections.Counter(), collections.defaultdict(list)
    # Per skill: the owner's first message after it ran in the same chat (weekly-improve §2а).
    followups = collections.defaultdict(lambda: {"corrections": 0, "after": []})
    for path in glob.glob(os.path.join(HOME, ".claude", "projects", "*", "*.jsonl")):
        if os.path.getmtime(path) < cut:
            continue
        project = os.path.basename(os.path.dirname(path)).split("-Projects-")[-1] or "home"
        last_stop = None  # (kind, timestamp) of the latest main-thread assistant error, until the next turn
        last_skill = None
        with open(path, encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                api_error = '"isApiErrorMessage":true' in line
                if '"type":"assistant"' in line and not api_error and '"isSidechain":false' in line:
                    last_stop = None
                if '"type":"user"' not in line and '"tool_use"' not in line and not api_error:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if api_error and entry.get("type") == "assistant" and not entry.get("isSidechain"):
                    last_stop = (stop_kind(entry), entry.get("timestamp"))
                    continue
                stamp = entry.get("timestamp")
                try:
                    at = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() if stamp else 0
                except ValueError:
                    at = 0
                in_week = not (at and (at < cut or (end is not None and at >= end)))
                if entry.get("type") == "user" and not entry.get("isSidechain") and not entry.get("isMeta"):
                    text = canon(norm(user_text(entry)))
                    if not text:
                        continue
                    stop, last_stop = last_stop, None
                    if not in_week:
                        continue
                    if stop and CONTINUE.match(text):
                        after_error[stop[0]] += 1
                        wait = minutes_between(stop[1], stamp)
                        if wait is not None:
                            after_error_waits[stop[0]].append(wait)
                        if stop[0] in GUARD_CONTINUES:
                            continue
                    if not AUTOMATED.match(text) and len(text) < 4000:
                        prompts.append({"at": stamp, "project": project, "text": text[:TEXT_MAX]})
                        per_project[project] += 1
                        if last_skill:
                            row = followups[last_skill]
                            row["corrections"] += bool(CORRECTION.search(text[:160]))
                            if len(row["after"]) < 12:
                                row["after"].append({"at": stamp, "project": project, "text": text[:200]})
                            last_skill = None
                if not in_week:
                    continue
                if entry.get("type") == "assistant":
                    for part in entry.get("message", {}).get("content", []) or []:
                        if not isinstance(part, dict) or part.get("type") != "tool_use":
                            continue
                        if part.get("name") == "Skill" and not entry.get("isSidechain"):
                            last_skill = str(part.get("input", {}).get("skill", "?"))
                            skills[last_skill] += 1
                        elif part.get("name") == "Skill":
                            skills[str(part.get("input", {}).get("skill", "?"))] += 1
                        elif part.get("name") == "Bash":
                            command = norm(str(part.get("input", {}).get("command", "")))
                            words = re.sub(r"^(cd \S+ && |export \S+ |rtk )+", "", command).split(" ")
                            commands[" ".join(words[:2])[:60]] += 1
    seen, unique = set(), []
    for prompt in sorted(prompts, key=lambda p: p["at"] or "", reverse=True):
        key = prompt["text"][:120].lower()
        if key not in seen:
            seen.add(key)
            unique.append(prompt)
    starts = collections.Counter(" ".join(p["text"].lower().split()[:6]) for p in prompts)
    return {
        "owner_messages": len(prompts),
        "by_project": per_project.most_common(),
        "repeated_starts": [[start, count] for start, count in starts.most_common(60) if count > 1],
        "recent_messages": unique[:SAMPLE_MAX],
        "skills_used": skills.most_common(),
        "frequent_commands": commands.most_common(40),
        # limit/auth → sent by Orca+ limit-guard, excluded from owner_messages; network/other → typed by the owner.
        "skill_followups": {
            name: {"uses": uses, **followups[name]} for name, uses in skills.most_common(5) if name in followups
        },
        "continue_after_error": {
            kind: {"count": count, "median_wait_min": median(after_error_waits[kind])}
            for kind, count in after_error.most_common()
        },
    }


def registry_projects(hq):
    rows, current = [], {}
    try:
        lines = open(os.path.join(hq, "registry.yaml"), encoding="utf-8").read().splitlines()
    except OSError:
        return rows
    for line in lines + ["  - "]:
        if line.startswith("  - "):
            if current.get("path"):
                rows.append(current)
            current = {}
            line = "    " + line[4:]
        match = re.match(r'^\s+(slug|path):\s*"?(.*?)"?\s*$', line)
        if match:
            current[match.group(1)] = match.group(2)
    return rows


def commits(hq, days, since=None, until=None):
    window = [f"--since={since}", f"--until={until}"] if since else [f"--since={days}.days"]
    out = {}
    for row in registry_projects(hq):
        path = os.path.expanduser(row["path"])
        if not os.path.isdir(os.path.join(path, ".git")) and not os.path.isfile(os.path.join(path, ".git")):
            continue
        try:
            log = subprocess.run(
                ["git", "-C", path, "log", *window, "--no-merges", "--format=%s", "-n", "40"],
                capture_output=True, text=True, timeout=20,
            ).stdout.splitlines()
        except (OSError, subprocess.TimeoutExpired):
            continue
        if log:
            out[row.get("slug") or path] = log
    return out


def skills_inventory():
    rows = []
    for path in sorted(glob.glob(os.path.join(HOME, ".claude", "skills", "*", "SKILL.md"))):
        try:
            head = open(path, encoding="utf-8").read(1500)
        except OSError:
            continue
        match = re.search(r"^description:\s*(.+)$", head, re.M)
        rows.append({"name": os.path.basename(os.path.dirname(path)), "description": (match.group(1) if match else "")[:200]})
    return rows


def hq_signals(hq, cut, end=None):
    scout = os.path.join(hq, "slack-scout")
    decisions = {}
    try:
        decisions = json.load(open(os.path.join(scout, "decisions.json"), encoding="utf-8"))
    except (OSError, ValueError):
        pass
    week = [
        v for v in decisions.values()
        if isinstance(v, dict) and v.get("at", 0) / 1000 >= cut and (end is None or v.get("at", 0) / 1000 < end)
    ]
    corrections = []
    try:
        for line in open(os.path.join(scout, "corrections.jsonl"), encoding="utf-8"):
            corrections.append(json.loads(line))
    except (OSError, ValueError):
        pass
    return {
        "scout_decisions": collections.Counter(v.get("decision") for v in week).most_common(),
        "scout_skipped_titles": [v.get("title") for v in week if v.get("decision") == "rejected"][:40],
        "tone_corrections": len(corrections),
        "wiki_changed": subprocess.run(
            ["git", "-C", hq, "log", f"--since={datetime.fromtimestamp(cut).isoformat(timespec='seconds')}",
             *([f"--until={datetime.fromtimestamp(end).isoformat(timespec='seconds')}"] if end else []),
             "--name-only", "--format=", "--", "wiki"],
            capture_output=True, text=True, timeout=20,
        ).stdout.split()[:80],
    }


PULSE_DB_FILE = "orca-plus-pulse.db"


def pulse_db_path():
    """orca-plus-pulse.db in Orca+'s profile: ORCA_USER_DATA_PATH in its terminals, else <appData>/orca-plus."""
    env = os.environ.get("ORCA_USER_DATA_PATH")
    # Why the check: a stock Orca terminal sets the same variable to stock Orca's profile.
    if env and os.path.isfile(os.path.join(env, PULSE_DB_FILE)):
        return os.path.join(env, PULSE_DB_FILE)
    if sys.platform == "darwin":
        app_data = os.path.join(HOME, "Library", "Application Support")
    elif sys.platform == "win32":
        app_data = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
    else:
        app_data = os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config")
    return os.path.join(app_data, "orca-plus", PULSE_DB_FILE)


PULSE_DB = pulse_db_path()


def pulse_day(cut, end):
    """What Orca+ recorded that day: what went out after Approve, decisions, the feed, open waitings."""
    try:
        db = sqlite3.connect(f"{Path(PULSE_DB).as_uri()}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error as error:
        return {"error": str(error)}
    lo, hi = int(cut * 1000), int(end * 1000)
    try:
        def rows(sql, *params):
            cursor = db.execute(sql, params)
            names = [column[0] for column in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]

        people = {row["id"]: row["name"] for row in rows("SELECT id, name FROM people")}
        decisions = rows(
            "SELECT kind, title, substr(body, 1, 300) AS body, outcome, project, person_id, source, decided_at"
            " FROM decisions WHERE decided_at >= ? AND decided_at < ? ORDER BY decided_at", lo, hi)
        feed = rows(
            "SELECT source, kind, at, title, substr(coalesce(post, body), 1, 300) AS text, project, person"
            " FROM feed WHERE at >= ? AND at < ? ORDER BY at", lo, hi)
        # Why: open at the day's end (however old) plus those opened or closed that day.
        waitings = rows(
            "SELECT direction, title, project, person_id, source, status, created_at, resolved_at FROM waitings"
            " WHERE created_at < ? AND (resolved_at IS NULL OR resolved_at >= ?)"
            " ORDER BY created_at", hi, lo)
    except sqlite3.Error as error:
        return {"error": str(error)}
    finally:
        db.close()
    for row in decisions + waitings:
        row["person"] = people.get(row.pop("person_id", None))
    return {
        "decisions": decisions,
        "feed_by_kind": collections.Counter(f"{row['source']}:{row['kind']}" for row in feed).most_common(),
        "feed": feed[:300],
        "waitings": waitings,
    }


def day_main(args):
    start = datetime.strptime(args.day, "%Y-%m-%d")
    cut, end = start.timestamp(), (start + timedelta(days=1)).timestamp()
    since, until = start.isoformat(timespec="seconds"), (start + timedelta(days=1)).isoformat(timespec="seconds")
    digest = {
        "day": args.day,
        "weekday": start.strftime("%A"),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "transcripts": transcripts(cut, end),
        "commits": commits(args.hq, 1, since, until),
        "pulse": pulse_day(cut, end),
        "hq": hq_signals(args.hq, cut, end),
    }
    out_dir = os.path.join(args.hq, "journal")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{args.day}.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(redact(digest), handle, ensure_ascii=False, indent=1)
    t, p = digest["transcripts"], digest["pulse"]
    print(out)
    print(f"owner messages {t['owner_messages']}, projects {len(t['by_project'])}, skills used {len(t['skills_used'])}, "
          f"repos with commits {len(digest['commits'])}, decisions {len(p.get('decisions', []))}, "
          f"feed {len(p.get('feed', []))}, size {os.path.getsize(out) // 1024} KB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--day", help="one local day, YYYY-MM-DD: the work journal for daily-review")
    parser.add_argument("--hq")
    args = parser.parse_args()
    args.hq = os.path.expanduser(args.hq) if args.hq else hq_dir()
    if args.day:
        day_main(args)
        return
    now = datetime.now()
    cut = time.time() - args.days * 86400
    digest = {
        "week": week_label(now),
        "days": args.days,
        "generated_at": now.isoformat(timespec="seconds"),
        "transcripts": transcripts(cut),
        "commits": commits(args.hq, args.days),
        "skills": skills_inventory(),
        "hq": hq_signals(args.hq, cut),
    }
    out_dir = os.path.join(args.hq, "improvements")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{digest['week']}-input.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(redact(digest), handle, ensure_ascii=False, indent=1)
    t = digest["transcripts"]
    print(out)
    print(f"owner messages {t['owner_messages']}, unique sampled {len(t['recent_messages'])}, "
          f"projects {len(t['by_project'])}, skills used {len(t['skills_used'])}, "
          f"repos with commits {len(digest['commits'])}, size {os.path.getsize(out) // 1024} KB")
    print("continue after error stop:", json.dumps(t["continue_after_error"], ensure_ascii=False))


if __name__ == "__main__":
    main()
