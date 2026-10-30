"""Collect every external source link the dashboard cites.

Used by scripts/archive_sources.py (Wayback Machine copies) and scripts/check_links.py
(monthly link check). Links come from the data files' "url" fields and from href attributes
in the pages; links to the dashboard itself are skipped.
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILES = ["data/states.json", "data/state_inventory.json", "data/spp.json", "data/staffing.json", "data/reading.json", "data/news.json", "data/composition.json"]
PAGES = ["index.html", "provenance.html", "reading.html", "news.html"]
SELF = ("shortages.paul-bruno.com", "www.paul-bruno.com", "paul-bruno.com")


def _walk(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("url", "source_url", "source_page") and isinstance(v, str):
                out.append(v)
            else:
                _walk(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, out)


def collect():
    """Return cited links, in first-seen order, without duplicates."""
    found = []
    for f in DATA_FILES:
        path = os.path.join(ROOT, f)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                _walk(json.load(fh), found)
    for f in PAGES:
        with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
            found += re.findall(r'href="(https?://[^"]+)"', fh.read())
    seen, out = set(), []
    for u in found:
        u = u.strip().replace("&amp;", "&")
        host = re.sub(r"^https?://", "", u).split("/")[0].lower()
        if not u.startswith("http") or host in SELF or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


if __name__ == "__main__":
    links = collect()
    print(f"{len(links)} links")
    for u in links:
        print(u)
