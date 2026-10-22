"""Set the date stamps in the hand-curated state files when their content changes.

Run by .github/workflows/stamp-dates.yml after each push to main. For each file,
compares the pushed version with the version before the push, ignoring the date
fields. If anything else changed and the date was not already changed by hand,
sets the date to today (U.S. Central time). Only the date line is rewritten, so
the file's layout is kept. Standard library only.

Usage: python scripts/stamp_dates.py <commit before the push> [YYYY-MM-DD]
"""
import datetime
import json
import subprocess
import sys

FILES = {"data/states.json": "updated", "data/state_inventory.json": "as_of"}
DATE_FIELDS = {"updated", "verified", "as_of"}


def at(rev, path):
    """The file as of a commit, or None if it (or the commit) is not available."""
    r = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, encoding="utf-8")
    return json.loads(r.stdout) if r.returncode == 0 else None


def without_dates(d):
    return {k: v for k, v in d.items() if k not in DATE_FIELDS}


def main(before, today):
    for path, field in FILES.items():
        old = at(before, path)
        if old is None:
            print(f"{path}: no earlier version to compare; left as is.")
            continue
        raw = open(path, encoding="utf-8", newline="").read()
        new = json.loads(raw)
        if old.get(field) != new.get(field):
            print(f"{path}: {field} was set by hand ({new.get(field)}); left as is.")
        elif without_dates(old) == without_dates(new):
            print(f"{path}: no content change.")
        elif new.get(field) == today:
            print(f"{path}: {field} is already {today}.")
        else:
            line = f'"{field}": "{new[field]}"'
            assert raw.count(line) == 1, f"{path}: expected one {line}"
            raw = raw.replace(line, f'"{field}": "{today}"')
            open(path, "w", encoding="utf-8", newline="").write(raw)
            print(f"{path}: {field} set to {today}.")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        today = sys.argv[2]
    else:
        from zoneinfo import ZoneInfo
        today = datetime.datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
    main(sys.argv[1], today)
