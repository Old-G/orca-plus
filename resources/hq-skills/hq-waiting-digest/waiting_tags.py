"""Tags HQ+ and the evening check keep at the end of a waiting's detail (same format as Orca+'s
src/shared/hq-waiting-tags.ts): `Task: DEV-123`, `Snoozed until: 2026-10-27`, `Nudged: 2026-10-24`,
`Checked: 2026-10-24 18:05 — no answer yet`."""
import datetime
import re

TAGS = {"task": "Task", "snoozed": "Snoozed until", "nudged": "Nudged", "checked": "Checked"}
LINE = re.compile(r"^(%s): (.+)$" % "|".join(re.escape(v) for v in TAGS.values()))


def read(detail):
    tags = {key: None for key in TAGS}
    rest = []
    for line in (detail or "").split("\n"):
        match = LINE.match(line.strip())
        key = next((k for k, v in TAGS.items() if match and v == match.group(1)), None)
        if key:
            tags[key] = match.group(2).strip()
        else:
            rest.append(line)
    tags["text"] = "\n".join(rest).strip() or None
    return tags


def write(detail, key, value):
    kept = [l for l in (detail or "").split("\n") if not (LINE.match(l.strip()) and LINE.match(l.strip()).group(1) == TAGS[key])]
    if value:
        kept.append(f"{TAGS[key]}: {' '.join(value.split())}")
    return "\n".join(kept).strip() or None


def day(value):
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        return None
