"""Save private copies of the source files behind the dashboard's figures.

Downloads every cited PDF and spreadsheet (see scripts/source_links.py), plus files the
computed figures rely on that the pages do not link directly, into a folder OUTSIDE the
repository (the copies are for checking figures later, not for republishing). Writes
manifest.csv there with each file's source URL, download date, size, and SHA-256 checksum.
Files that cannot be downloaded automatically are listed at the end so they can be saved by hand.

Files already saved are kept unless --refresh is given, so reruns only fetch new sources.

Usage:  python scripts/download_sources.py [destination] [--refresh]   (default: ../staff-shortages-sources)
"""

import csv
import datetime as dt
import hashlib
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from source_links import ROOT, collect  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
FILE_RE = re.compile(r"\.(pdf|xlsx?|csv|zip|docx?)(\?|#|$)|Download\.aspx\?SourceUrl=", re.I)

# Files behind computed figures that the pages do not link directly.
EXTRA = [
    # Pennsylvania: earlier-year vacancy and staff-summary workbooks used for the computed rates.
    "https://www.pa.gov/content/dam/copapwp-pagov/en/education/documents/data-and-reporting/professional-and-support-personnel/vacancysummary2023-24.xlsx",
    "https://www.pa.gov/content/dam/copapwp-pagov/en/education/documents/data-and-reporting/professional-and-support-personnel/2024-25-professional-staff-vacancy-report-q1.xlsx",
    "https://www.pa.gov/content/dam/copapwp-pagov/en/education/documents/data-and-reporting/professional-and-support-personnel/prof-staff-summary/2023-24%20professional%20staff%20summary%20report.xlsx",
    "https://www.pa.gov/content/dam/copapwp-pagov/en/education/documents/data-and-reporting/professional-and-support-personnel/prof-staff-summary/2024-25%20professional%20staff%20summary%20report.xlsx",
    # Illinois: Report Card trend workbook (statewide enrollment used for the staffing chart).
    "https://www.isbe.net/_layouts/Download.aspx?SourceUrl=/Documents/rc-trend-data.xlsx",
    # Illinois: ISBE unfilled-position definition guidance.
    "https://www.isbe.net/Documents/EIS-Unfilled-Positions-Webinar-QA.pdf",
    "https://www.isbe.net/Documents/SY26-Opening-Webinar-QA.pdf",
]


def filename(url):
    p = urllib.parse.urlparse(url)
    q = urllib.parse.parse_qs(p.query).get("SourceUrl", [""])[0]
    base = os.path.basename(urllib.parse.unquote(q or p.path)) or "file"
    host = p.hostname.replace("www.", "")
    return re.sub(r"[^\w.\-]+", "_", f"{host}__{base}")[:180]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dest = os.path.abspath(args[0] if args else os.path.join(ROOT, "..", "staff-shortages-sources"))
    os.makedirs(dest, exist_ok=True)
    urls = [u for u in collect() if FILE_RE.search(u)] + [u for u in EXTRA]
    urls = list(dict.fromkeys(urls))
    rows, failed = [], []
    refresh = "--refresh" in sys.argv
    old = {}
    mpath = os.path.join(dest, "manifest.csv")
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as f:
            old = {r["source_url"]: r for r in csv.DictReader(f)}
    for url in urls:
        name = filename(url)
        if not refresh and url in old and os.path.exists(os.path.join(dest, old[url]["file"])):
            r0 = old[url]
            rows.append([r0["file"], url, r0["downloaded"], r0["bytes"], r0["sha256"]])
            continue  # keep the copy already saved; --refresh replaces it
        # A Wayback Machine link serves the archive's viewer; "id_" requests the original file.
        fetch = re.sub(r"(web\.archive\.org/web/\d+)/", r"\g<1>id_/", url) if "web.archive.org/web/" in url and "id_/" not in url else url
        try:
            with urllib.request.urlopen(urllib.request.Request(fetch, headers=UA), timeout=180) as r:
                body = r.read()
            if body[:15].lstrip().lower().startswith((b"<!doctype", b"<html")):
                raise ValueError("server returned a web page, not the file")
            with open(os.path.join(dest, name), "wb") as f:
                f.write(body)
            rows.append([name, url, dt.date.today().isoformat(), len(body), hashlib.sha256(body).hexdigest()])
            print(f"saved {name} ({len(body):,} bytes)")
        except Exception as e:  # noqa: BLE001
            failed.append((url, str(e)[:120]))
            print(f"FAILED {url}: {e}")
        time.sleep(1)
    # Keep manifest entries for files saved some other way (e.g., web pages saved by hand).
    rows += [[r["file"], u, r["downloaded"], r["bytes"], r["sha256"]] for u, r in old.items() if u not in urls]
    with open(os.path.join(dest, "manifest.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "source_url", "downloaded", "bytes", "sha256"])
        w.writerows(rows)
    with open(os.path.join(dest, "README.txt"), "w", encoding="utf-8") as f:
        f.write("Private copies of the source files behind shortages.paul-bruno.com, made by\n"
                "scripts/download_sources.py in the staff-shortages repository. Not for republication.\n"
                "manifest.csv lists each file's source URL, download date, size, and SHA-256 checksum.\n"
                "Files that could not be downloaded automatically should be saved here by hand:\n"
                + "".join(f"  {u}\n" for u, _ in failed))
    print(f"\nSaved {len(rows)} of {len(urls)} files to {dest}")
    if failed:
        print("Save these by hand:")
        for u, e in failed:
            print(f"  {u}  ({e})")


if __name__ == "__main__":
    main()
