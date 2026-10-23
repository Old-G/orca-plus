#!/usr/bin/env python3
"""Codex reviews the owner's new commits in every local git project of the HQ registry.

Only problems surface: a P0/P1 finding becomes an HQ report (HQ/updates/codex-review-<time>.md),
which Orca+ turns into a bell item, a banner and a phone push. Clean commits leave only a log line.

  review.py run [--max N]   review up to N new commits (default 6), oldest first
  review.py daily           one review per project of all its new commits (the evening run)
  review.py baseline        mark every current commit as seen, review nothing
  review.py status          print the queue size per project, review nothing

State (seen commits by sha and patch-id) lives in HQ/codex-review/state.json, outside git.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hq-setup"))
from hq_location import hq_dir  # noqa: E402

HQ = Path(hq_dir())
STATE = HQ / "codex-review" / "state.json"
UPDATES = HQ / "updates"
MODEL = os.environ.get("CODEX_REVIEW_MODEL", "gpt-6-sol")
WINDOW_DAYS = 3
PER_BRANCH = 40
REVIEW_TIMEOUT = 600
DAILY_TIMEOUT = 1500
DAILY_MAX_COMMITS = 40
KEEP_SEEN = 20000
FINDING = re.compile(r"^- \[P([0-3])\] (.+?) — (.+?)\s*$")
LIMIT_HIT = re.compile(r"usage limit|rate limit|quota|429", re.I)


def git(repo, *args, timeout=60):
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=timeout)
    return out.stdout if out.returncode == 0 else ""


def registry():
    """Local git projects: [{slug, path}] from registry.yaml (one JSON-quoted value per line)."""
    projects, cur = [], {}
    for line in (HQ / "registry.yaml").read_text().splitlines():
        m = re.match(r'^\s*(-\s+)?(\w+):\s*(".*")\s*$', line)
        if not m:
            continue
        if m.group(1) and cur:
            projects.append(cur)
            cur = {}
        cur[m.group(2)] = json.loads(m.group(3))
    if cur:
        projects.append(cur)
    return [p for p in projects if p.get("kind") == "git" and p.get("host") == "local" and Path(p.get("path", "")).is_dir()]


def owner_emails(repo):
    emails = {git(repo, "config", "user.email").strip(), git(repo, "config", "--global", "user.email").strip()}
    return {e.lower() for e in emails if e}


def candidates(repo):
    """The owner's non-merge commits of the last days on any local branch: [(sha, subject)], oldest first."""
    emails = owner_emails(repo)
    since = int(time.time()) - WINDOW_DAYS * 86400
    seen, found = set(), []
    for line in git(repo, "for-each-ref", "refs/heads", "--format=%(objectname) %(committerdate:unix)").splitlines():
        sha, when = line.split()
        if int(when) < since:
            continue
        log = git(repo, "log", "--no-merges", f"--since={since}", f"--max-count={PER_BRANCH}", "--format=%H%x09%ae%x09%ct%x09%s", sha)
        for row in log.splitlines():
            h, email, ct, subject = (row.split("\t", 3) + [""])[:4]
            if h in seen or email.lower() not in emails:
                continue
            seen.add(h)
            found.append((int(ct), h, subject))
    return [(h, s) for _, h, s in sorted(found)]


def patch_id(repo, sha):
    show = subprocess.run(["git", "-C", repo, "show", sha], capture_output=True, timeout=60)
    pid = subprocess.run(["git", "patch-id", "--stable"], input=show.stdout, capture_output=True, timeout=60)
    return pid.stdout.decode().split(" ")[0] if pid.stdout else ""


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return None


def save_state(state):
    state["shas"] = state["shas"][-KEEP_SEEN:]
    state["patches"] = state["patches"][-KEEP_SEEN:]
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1) + "\n")
    tmp.replace(STATE)


def queue(state):
    """New commits per project; a rebased copy of a reviewed commit (same patch-id) is marked seen."""
    shas, patches = set(state["shas"]), set(state["patches"])
    todo = []
    for p in registry():
        for sha, subject in candidates(p["path"]):
            if sha in shas:
                continue
            pid = patch_id(p["path"], sha)
            if pid and pid in patches:
                state["shas"].append(sha)
                shas.add(sha)
                continue
            todo.append({"slug": p["slug"], "name": p.get("name", p["slug"]), "repo": p["path"], "sha": sha, "subject": subject, "patch": pid})
    return todo


def parse(text):
    """Codex's review comments: [{level, title, where, detail}]."""
    out, cur = [], None
    for line in text.splitlines():
        m = FINDING.match(line)
        if m:
            cur = {"level": int(m.group(1)), "title": m.group(2), "where": m.group(3), "detail": ""}
            out.append(cur)
        elif cur and line.startswith("  "):
            cur["detail"] = (cur["detail"] + " " + line.strip()).strip()
    return out


def review(item):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("ORCA", "CLAUDE"))}
    run = subprocess.run(
        ["codex", "review", "--commit", item["sha"], "--title", item["subject"][:120],
         "-c", f"model={MODEL}", "-c", 'sandbox_mode="read-only"'],
        cwd=item["repo"], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=REVIEW_TIMEOUT)
    if run.returncode != 0:
        tail = (run.stderr or run.stdout)[-400:]
        return None, ("limit" if LIMIT_HIT.search(tail) else "error") + ": " + tail.strip().replace("\n", " ")[-200:]
    return parse(run.stdout), None


def daily_prompt(items):
    lines = [
        "Review, as one change, only the commits listed below (oldest first). Read each with "
        "`git show <sha>`; ignore uncommitted changes and every other commit. A later commit in the "
        "list may already fix an earlier one — report only what is still wrong after the last of them.",
        "",
    ]
    lines += [f"- {it['sha']} {it['subject']}" for it in items]
    return "\n".join(lines)


def review_daily(items):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("ORCA", "CLAUDE"))}
    run = subprocess.run(
        ["codex", "review", "-c", f"model={MODEL}", "-c", 'sandbox_mode="read-only"', "-"],
        cwd=items[0]["repo"], env=env, input=daily_prompt(items), capture_output=True, text=True,
        timeout=DAILY_TIMEOUT)
    if run.returncode != 0:
        tail = (run.stderr or run.stdout)[-400:]
        return None, ("limit" if LIMIT_HIT.search(tail) else "error") + ": " + tail.strip().replace("\n", " ")[-200:]
    return parse(run.stdout), None


def write_daily_report(problems):
    stamp = datetime.now()
    serious = sum(f["level"] <= 1 for p in problems for f in p["findings"])
    lines = [
        f"# Codex за день — {', '.join(p['name'] for p in problems)} — {stamp:%d.%m}",
        "",
        f"Вечернее ревью всех коммитов дня, по проекту разом. Серьёзных (P0/P1): {serious}; "
        "P2 — мелочи, по желанию. Правится в чате проекта.",
        "",
    ]
    for p in problems:
        lines.append(f"## {p['name']} · коммитов: {len(p['items'])}")
        lines.append("")
        for f in p["findings"]:
            lines.append(f"- **[P{f['level']}] {f['title']}** — `{short_where(f['where'], p['repo'])}`")
            if f["detail"]:
                lines.append(f"  {f['detail']}")
        lines.append("")
        lines.append("Коммиты: " + ", ".join(f"`{it['sha'][:10]}`" for it in p["items"]))
        lines.append("")
    UPDATES.mkdir(parents=True, exist_ok=True)
    path = UPDATES / f"codex-review-{stamp:%Y-%m-%dT%H-%M}.md"
    path.write_text("\n".join(lines))
    return path


def run_daily(state, todo):
    by_repo = {}
    for item in todo:
        by_repo.setdefault(item["repo"], []).append(item)
    problems, done = [], 0
    for repo, items in by_repo.items():
        items = items[-DAILY_MAX_COMMITS:]
        findings, err = review_daily(items)
        if err:
            print(f"{items[0]['slug']} {len(items)} commits {err}")
            if err.startswith("limit"):
                break
            continue
        done += len(items)
        for item in by_repo[repo]:
            state["shas"].append(item["sha"])
            if item["patch"]:
                state["patches"].append(item["patch"])
        state["reviews"] = (state.get("reviews", []) + [{
            "at": datetime.now().isoformat(timespec="seconds"), "slug": items[0]["slug"],
            "sha": items[-1]["sha"], "commits": len(items), "levels": [f["level"] for f in findings]}])[-500:]
        print(f"{items[0]['slug']} {len(items)} commits findings={[f['level'] for f in findings]}")
        if any(f["level"] <= 2 for f in findings):
            problems.append({"name": items[0]["name"], "repo": repo, "items": items,
                             "findings": sorted((f for f in findings if f["level"] <= 2), key=lambda f: f["level"])})
        save_state(state)
    if problems:
        print(f"report: {write_daily_report(problems)}")
    print(f"reviewed {done} commits in {len(by_repo)} projects")
    return 0


def short_where(where, repo):
    return where.replace(repo.rstrip("/") + "/", "")


def write_report(problems):
    projects = sorted({p["name"] for p in problems})
    stamp = datetime.now()
    lines = [
        f"# Codex нашёл проблемы — {', '.join(projects)} — {stamp:%d.%m %H:%M}",
        "",
        f"Фоновое ревью новых коммитов, серьёзных замечаний (P0/P1): {sum(f['level'] <= 1 for p in problems for f in p['findings'])}. "
        "Проверь и поправь в проекте; P2 — мелочи, по желанию.",
        "",
    ]
    for p in problems:
        lines.append(f"## {p['name']} · `{p['sha'][:10]}` {p['subject']}")
        lines.append("")
        for f in p["findings"]:
            lines.append(f"- **[P{f['level']}] {f['title']}** — `{short_where(f['where'], p['repo'])}`")
            if f["detail"]:
                lines.append(f"  {f['detail']}")
        lines.append("")
    UPDATES.mkdir(parents=True, exist_ok=True)
    path = UPDATES / f"codex-review-{stamp:%Y-%m-%dT%H-%M}.md"
    path.write_text("\n".join(lines))
    return path


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    limit = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 6
    state = load_state()
    if cmd == "baseline" or state is None:
        state = {"shas": [], "patches": [], "reviews": []}
        for item in queue(state):
            state["shas"].append(item["sha"])
            if item["patch"]:
                state["patches"].append(item["patch"])
        save_state(state)
        print(f"baseline: {len(state['shas'])} commits marked seen")
        return 0
    todo = queue(state)
    if cmd == "status":
        by = {}
        for item in todo:
            by[item["slug"]] = by.get(item["slug"], 0) + 1
        print(json.dumps({"queued": len(todo), "byProject": by}, ensure_ascii=False))
        save_state(state)
        return 0
    if cmd == "daily":
        return run_daily(state, todo)
    problems, done = [], 0
    for item in todo[:limit]:
        findings, err = review(item)
        if err:
            print(f"{item['slug']} {item['sha'][:10]} {err}")
            if err.startswith("limit"):
                break
            continue
        done += 1
        state["shas"].append(item["sha"])
        if item["patch"]:
            state["patches"].append(item["patch"])
        serious = [f for f in findings if f["level"] <= 1]
        state["reviews"] = (state.get("reviews", []) + [{
            "at": datetime.now().isoformat(timespec="seconds"), "slug": item["slug"], "sha": item["sha"],
            "levels": [f["level"] for f in findings]}])[-500:]
        print(f"{item['slug']} {item['sha'][:10]} findings={[f['level'] for f in findings]}")
        if serious:
            problems.append({**item, "findings": sorted(findings, key=lambda f: f["level"])})
        save_state(state)
    if problems:
        print(f"report: {write_report(problems)}")
    print(f"reviewed {done}, queued {max(len(todo) - done, 0)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
