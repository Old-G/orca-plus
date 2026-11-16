#!/usr/bin/env python3
"""Whether a background job may start now: Orca+ holds background work while the selected Claude
account has used 95% of its weekly limit, and writes that answer to claude-background-pause.json in
its data folder. Exit 0 = run, 75 = paused (one «paused 95%» line on stdout and in the logs).
No file, or one that cannot be read, means run: an unknown limit never stops work. The pause lasts only
until the reset time the file names, so the job starts again by itself after the reset."""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

PAUSED_EXIT = 75
# A pause with no reset time is trusted only while Orca+ checked it recently.
NO_RESET_MAX_AGE_S = 6 * 60 * 60


def user_data_dir() -> str:
    override = os.environ.get("HQ_ORCA_USER_DATA")
    if override:
        return override
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/orca-plus")
    return os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "orca-plus")


def iso(ms) -> str:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds")
    return stamp.replace("+00:00", "Z")


def read_pause(path: str, now_ms: float):
    try:
        with open(path, encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(state, dict) or state.get("paused") is not True:
        return None
    percent = state.get("weeklyPercent")
    resumes = state.get("resumesAt")
    checked = state.get("checkedAt")
    if not isinstance(percent, (int, float)):
        return None
    if isinstance(resumes, (int, float)):
        return (percent, resumes) if resumes > now_ms else None
    if isinstance(checked, (int, float)) and now_ms - checked <= NO_RESET_MAX_AGE_S * 1000:
        return (percent, None)
    return None


def append(path: str, line: str) -> None:
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--log", help="the job's own log, gets the same line")
    args = parser.parse_args()
    data = user_data_dir()
    now_ms = time.time() * 1000
    stamp = iso(now_ms)
    gate_log = os.path.join(data, "claude-background-pause.log")
    held = os.path.join(data, "claude-background-pause.held", args.job.replace("/", "_"))
    pause = read_pause(os.path.join(data, "claude-background-pause.json"), now_ms)
    if pause:
        percent, resumes = pause
        until = iso(resumes) if resumes is not None else "unknown"
        line = f"paused 95% (weekly {round(percent)}%, until {until})"
        print(line)
        for log in filter(None, [args.log, gate_log]):
            append(log, f"{stamp} skip {args.job}: {line}")
        try:
            os.makedirs(os.path.dirname(held), exist_ok=True)
            open(held, "w").close()
        except OSError:
            pass
        return PAUSED_EXIT
    if os.path.exists(held):
        for log in filter(None, [args.log, gate_log]):
            append(log, f"{stamp} run {args.job}: background on again")
        try:
            os.remove(held)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
