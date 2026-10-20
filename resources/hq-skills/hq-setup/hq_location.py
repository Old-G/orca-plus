#!/usr/bin/env python3
"""Where the Orca+ HQ folder is, for the HQ skills' scripts.

$HQ_DIR → the current folder when it is an HQ (has registry.yaml) → the pointer Orca+ writes from
Settings → HQ Folder (~/.config/orca-plus/hq.json). Prints the path; exits 1 when none is known.

    from hq_location import hq_dir          # sys.path: ~/.claude/skills/hq-setup
    python3 ~/.claude/skills/hq-setup/hq_location.py
"""
import json
import os
import sys

POINTER = os.path.join(os.path.expanduser("~"), ".config", "orca-plus", "hq.json")
NOT_SET = "Папка HQ не задана: Orca+ → Настройки → HQ Folder (или переменная HQ_DIR)."


def hq_dir():
    env = os.environ.get("HQ_DIR")
    if env:
        return os.path.expanduser(env)
    if os.path.isfile("registry.yaml"):
        return os.getcwd()
    try:
        with open(POINTER, encoding="utf-8") as handle:
            path = json.load(handle).get("hqPath")
    except (OSError, ValueError, AttributeError):
        path = None
    if path and os.path.isdir(path):
        return path
    raise SystemExit(NOT_SET)


def config(name):
    """<HQ>/config/<name>.json — the owner's settings for one skill; {} when absent."""
    try:
        with open(os.path.join(hq_dir(), "config", f"{name}.json"), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


if __name__ == "__main__":
    print(hq_dir())
    sys.exit(0)
