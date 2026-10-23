#!/usr/bin/env python3
"""Background jobs of the HQ skills: install, list, remove. macOS: launchd; Linux: the user's crontab;
Windows: not supported (the jobs are bash scripts).

    schedule.py status                         which jobs are installed
    schedule.py install JOB [JOB ...] [--dry-run]
    schedule.py remove JOB [JOB ...]

Jobs run the skills' own run.sh from ~/.claude/skills, where Orca+ keeps them up to date.
"""
import os
import platform
import subprocess
import sys
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent
LOGS = Path.home() / "Library" / "Logs"
# name → (skill folder, schedule): an int is an interval in seconds, a tuple is a daily (hour, minute).
JOBS = {
    "commit-review": ("hq-commit-review", (18, 30)),
    "tone-rollup": ("hq-tone-rollup", (20, 45)),
    "triage-rollup": ("hq-triage-rollup", (20, 50)),
}


def label(job):
    return f"com.orca-plus.{job}"


def plist_path(job):
    return Path.home() / "Library" / "LaunchAgents" / f"{label(job)}.plist"


def plist(job):
    folder, when = JOBS[job]
    script = SKILLS / folder / "run.sh"
    log = LOGS / f"orca-plus-{job}.launchd.log"
    if isinstance(when, int):
        timing = f"\t<key>StartInterval</key>\n\t<integer>{when}</integer>\n"
    else:
        timing = (f"\t<key>StartCalendarInterval</key>\n\t<dict>\n\t\t<key>Hour</key>\n\t\t<integer>{when[0]}</integer>\n"
                  f"\t\t<key>Minute</key>\n\t\t<integer>{when[1]}</integer>\n\t</dict>\n")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label(job)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>{script}</string>
	</array>
	<key>RunAtLoad</key>
	<false/>
	<key>StandardOutPath</key>
	<string>{log}</string>
	<key>StandardErrorPath</key>
	<string>{log}</string>
{timing}</dict>
</plist>
"""


def cron_line(job):
    folder, when = JOBS[job]
    timing = f"*/{when // 60} * * * *" if isinstance(when, int) else f"{when[1]} {when[0]} * * *"
    return f"{timing} /bin/bash {SKILLS / folder / 'run.sh'} # {label(job)}"


def read_crontab():
    r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    # Why: "no crontab for user" is an empty table, not an error.
    return r.stdout.splitlines() if r.returncode == 0 else []


def write_crontab(lines):
    r = subprocess.run(["crontab", "-"], input="".join(f"{line}\n" for line in lines), capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"crontab: {r.stderr.strip()}")


def without_jobs(lines, names):
    return [line for line in lines if not any(line.endswith(f"# {label(job)}") for job in names)]


def platform_kind():
    system = platform.system()
    if system == "Windows":
        sys.exit("Фоновые задачи HQ — bash-скрипты, на Windows их не поставить. Запускай скиллы руками или из WSL.")
    return "launchd" if system == "Darwin" else "cron"


def jobs_from(args):
    names = [a for a in args if not a.startswith("--")]
    unknown = [n for n in names if n not in JOBS]
    if not names or unknown:
        sys.exit(f"задачи: {', '.join(JOBS)}" + (f"; не знаю: {', '.join(unknown)}" if unknown else ""))
    return names


def launchctl(*args):
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def install(names, dry_run):
    if platform_kind() == "cron":
        lines = [cron_line(job) for job in names]
        if dry_run:
            print("\n".join(lines))
            return
        write_crontab(without_jobs(read_crontab(), names) + lines)
        for job in names:
            print(f"{job}: установлена (crontab)")
        return
    domain = f"gui/{os.getuid()}"
    for job in names:
        if dry_run:
            print(f"# {plist_path(job)}\n{plist(job)}")
            continue
        path = plist_path(job)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(plist(job), encoding="utf-8")
        launchctl("bootout", domain, str(path))
        r = launchctl("bootstrap", domain, str(path))
        print(f"{job}: {'установлена' if r.returncode == 0 else 'ошибка: ' + r.stderr.strip()}")


def remove(names):
    if platform_kind() == "cron":
        write_crontab(without_jobs(read_crontab(), names))
        for job in names:
            print(f"{job}: убрана")
        return
    domain = f"gui/{os.getuid()}"
    for job in names:
        path = plist_path(job)
        launchctl("bootout", domain, str(path))
        path.unlink(missing_ok=True)
        print(f"{job}: убрана")


def status():
    cron = read_crontab() if platform_kind() == "cron" else []
    for job, (folder, _) in JOBS.items():
        installed = any(line.endswith(f"# {label(job)}") for line in cron) or plist_path(job).exists()
        state = "установлена" if installed else "нет"
        if not (SKILLS / folder / "run.sh").exists():
            state += " (скилла нет)"
        print(f"{job}\t{state}\t{label(job)}")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        status()
    elif cmd == "install":
        install(jobs_from(sys.argv[2:]), "--dry-run" in sys.argv)
    elif cmd == "remove":
        remove(jobs_from(sys.argv[2:]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
