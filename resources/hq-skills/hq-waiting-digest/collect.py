#!/usr/bin/env python3
"""Open «on-them» waitings from Orca+ pulse, grouped by person, for the evening digest.

Prints JSON: {"date", "team_channel", "team", "direct"}, where person = {name, slack_user_id,
department, items: [{task, title, project, link, since, replied}]}. Read-only.

Settings: <HQ>/config/waiting-digest.json — {"team_channel": "C…", "team_channel_name": "#team",
"team_departments": ["IT"], "owner_slack_id": "U…", "clickup_team_id": "…",
"slack_workspace_url": "https://<workspace>.slack.com"}. Without it everyone goes to a direct message.
"""
import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hq-setup"))
from hq_location import config  # noqa: E402

CONFIG = config("waiting-digest")
ORCA = os.environ.get("ORCA_CLI_COMMAND") or "orca"
TASK = re.compile(r"(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d+\b")


def orca(*args):
    out = subprocess.run([ORCA, *args, "--json"], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["result"]


def link(ref):
    if not ref:
        return None
    if ref.startswith("http"):
        return ref
    parts = ref.split(":")
    if parts[0] == "clickup" and len(parts) > 1:
        task, team = parts[1], CONFIG.get("clickup_team_id")
        return f"https://app.clickup.com/t/{team}/{task}" if team and TASK.fullmatch(task) else f"https://app.clickup.com/t/{task}"
    if parts[0] == "slack" and len(parts) > 2 and CONFIG.get("slack_workspace_url"):
        return f"{CONFIG['slack_workspace_url']}/archives/{parts[1]}/p{parts[2].replace('.', '')}"
    return None


def task_of(waiting):
    found = TASK.search(f"{waiting['title']} {waiting.get('sourceRef') or ''}")
    return found.group(0) if found else None


def main():
    result = orca("pulse", "wait", "list", "--direction", "on-them")
    waitings = result["waitings"] if isinstance(result, dict) else result
    people = {}
    for w in waitings:
        if not w.get("personId"):
            continue
        if w["personId"] not in people:
            person = orca("pulse", "person", "show", "--person", w["personId"])["person"]
            role = person.get("role") or ""
            people[w["personId"]] = {
                "name": person["name"],
                "slack_user_id": person.get("slackUserId"),
                "department": role.split("·")[-1].strip() if "·" in role else None,
                "items": [],
            }
        people[w["personId"]]["items"].append({
            "task": task_of(w),
            "title": w["title"],
            "project": w.get("project"),
            "link": link(w.get("sourceRef")),
            "since": datetime.datetime.fromtimestamp(w["createdAt"] / 1000).strftime("%d.%m"),
            "replied": w.get("repliedAt") is not None,
        })
    owner = CONFIG.get("owner_slack_id")
    listed = [p for p in people.values() if not owner or p["slack_user_id"] != owner]
    departments = CONFIG.get("team_departments") or []
    team = [p for p in listed if CONFIG.get("team_channel") and p["department"] in departments]
    direct = [p for p in listed if p not in team]
    json.dump({
        "date": datetime.date.today().strftime("%d.%m"),
        "team_channel": CONFIG.get("team_channel"),
        "team_channel_name": CONFIG.get("team_channel_name"),
        "team": team,
        "direct": direct,
    }, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
