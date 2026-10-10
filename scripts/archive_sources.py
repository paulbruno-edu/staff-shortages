"""Save a Wayback Machine copy of every cited source and record it in data/archive.json.

For each link cited by the dashboard (see scripts/source_links.py), asks the Internet Archive's
"Save Page Now" service for a fresh copy. If that fails (some sites block archiving), it falls
back to the most recent existing copy, if any. Links already archived are skipped unless
--refresh is given, so later runs only handle new sources.

The free service is rate-limited and a save can take a minute, so a full first run takes a
while. Progress is written to data/archive.json after every link, so the run can be
interrupted and resumed.

Usage:  python scripts/archive_sources.py [--refresh]
"""

import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from source_links import ROOT, collect  # noqa: E402

OUT = os.path.join(ROOT, "data", "archive.json")
UA = {"User-Agent": "staff-shortages-dashboard source archiver (https://shortages.paul-bruno.com)"}
PAUSE = 8  # seconds between saves, to stay within the anonymous rate limit


def save(url):
    """Ask Save Page Now for a fresh copy; return the snapshot URL or None."""
    req = urllib.request.Request("https://web.archive.org/save/" + url, headers=UA)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                final = r.geturl()
            if "/web/" in final:
                return final
            return None
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limited: wait and retry
                time.sleep(60 * (attempt + 1))
                continue
            return None
        except Exception:  # noqa: BLE001 - timeouts and resets: one more try
            time.sleep(15)
    return None


def existing(url):
    """Most recent existing Wayback copy, or None."""
    q = "https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe="")
    try:
        with urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=60) as r:
            snap = json.load(r).get("archived_snapshots", {}).get("closest")
        if snap and snap.get("available") and str(snap.get("status", "")).startswith(("2", "3")):
            return snap["url"].replace("http://", "https://", 1)
    except Exception:  # noqa: BLE001
        pass
    return None


def stamp(snapshot_url):
    """'20261010164735' -> '2026-10-10'."""
    try:
        ts = snapshot_url.split("/web/")[1].split("/")[0][:8]
        return f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
    except Exception:  # noqa: BLE001
        return None


def main():
    refresh = "--refresh" in sys.argv
    archive = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            archive = json.load(f).get("links", {})
    links = collect()
    todo = [u for u in links if refresh or not (archive.get(u, {}).get("archive_url") or "doi.org/" in u)]
    print(f"{len(links)} cited links; {len(todo)} to archive")
    for n, url in enumerate(todo, 1):
        if "web.archive.org/web/" in url:  # already an Internet Archive copy
            archive[url] = {"archive_url": url, "archived": stamp(url), "method": "is an archived copy"}
            write(archive, links)
            continue
        if "doi.org/" in url:  # DOIs are designed to keep resolving; the pages do not show archive links for them
            archive[url] = {"archive_url": None, "archived": None, "method": "DOI (not archived)"}
            write(archive, links)
            continue
        snap, how = save(url), "saved"
        if not snap:
            snap, how = existing(url), "existing copy"
        archive[url] = {"archive_url": snap, "archived": stamp(snap) if snap else None,
                        "method": how if snap else "not archived"}
        print(f"[{n}/{len(todo)}] {archive[url]['method']}: {url}")
        write(archive, links)
        time.sleep(PAUSE)
    write(archive, links)
    missing = [u for u in links if not archive.get(u, {}).get("archive_url") and "doi.org/" not in u]
    print(f"Done. {len(links) - len(missing)} of {len(links)} links have an archived copy.")
    for u in missing:
        print("  not archived:", u)


def write(archive, links):
    out = {
        "_readme": "Wayback Machine copies of every source the dashboard cites, made by scripts/archive_sources.py. "
                   "method: 'saved' = fresh copy made by the script; 'existing copy' = the site refused a new save, "
                   "so the most recent earlier copy is used; 'not archived' = no copy exists (save these by hand).",
        "updated": dt.date.today().isoformat(),
        "links": {u: archive[u] for u in links if u in archive},
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    os.replace(tmp, OUT)


if __name__ == "__main__":
    main()
