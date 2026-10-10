"""Check that every source the dashboard cites still resolves.

Run monthly by .github/workflows/check-links.yml. Exits non-zero (so GitHub emails the repository
owner) only for clear signs a link is dead: 404 or 410, a host that no longer exists, or a server
error on both of two tries. Sites that refuse automated requests (401, 403, 429) or time out are
listed as "could not check" but do not fail the run, since many agency sites block automated
traffic. For each problem link, prints the Wayback Machine copy from data/archive.json, if any.

Usage:  python scripts/check_links.py
"""

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from source_links import ROOT, collect  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      "Accept": "text/html,application/pdf,application/xhtml+xml,*/*"}
DEAD = {404, 410}
BLOCKED = {401, 403, 405, 406, 429}


def status(url):
    """Return ('ok'|'dead'|'blocked'|'error', detail)."""
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read(1024)
                return "ok", str(r.status)
        except urllib.error.HTTPError as e:
            if e.code in DEAD:
                return "dead", str(e.code)
            if e.code in BLOCKED:
                return "blocked", str(e.code)
            last = ("error", str(e.code))
        except urllib.error.URLError as e:
            if isinstance(e.reason, socket.gaierror):
                return "dead", "host not found"
            last = ("blocked", f"no response ({e.reason})")
        except Exception as e:  # noqa: BLE001 - timeouts, resets
            last = ("blocked", f"no response ({type(e).__name__})")
        time.sleep(10)
    return last


def main():
    archive = {}
    path = os.path.join(ROOT, "data", "archive.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            archive = json.load(f).get("links", {})
    results = {"ok": [], "dead": [], "blocked": [], "error": []}
    links = collect()
    for url in links:
        kind, detail = status(url)
        results[kind].append((url, detail))
        time.sleep(1)
    print(f"Checked {len(links)} links: {len(results['ok'])} OK, {len(results['dead'])} dead, "
          f"{len(results['error'])} server errors, {len(results['blocked'])} could not be checked automatically.")
    for kind, label in (("dead", "DEAD"), ("error", "SERVER ERROR"), ("blocked", "could not check")):
        for url, detail in results[kind]:
            arch = (archive.get(url) or {}).get("archive_url") or "no archived copy"
            print(f"  {label} ({detail}): {url}\n      archived: {arch}")
    sys.exit(1 if results["dead"] or results["error"] else 0)


if __name__ == "__main__":
    main()
