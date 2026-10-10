"""Fetch NCES public school staffing and enrollment (Digest of Education Statistics, Table 213.10).

Downloads the newest available edition of Digest Table 213.10, "Staff employed in public
elementary and secondary school systems, by type of assignment," and writes data/staffing.json
with, for each fall from 2000 on:
  - full-time-equivalent (FTE) staff: total, teachers, instructional aides, support staff, and
    administrators (district officials and administrators plus principals and assistant principals)
  - pupils per teacher and pupils per staff member, as published by NCES
  - enrollment, computed as teachers x pupils per teacher (the same Common Core of Data counts
    NCES uses for its ratios)

Staff and enrollment both come from the NCES Common Core of Data, so the units are consistent:
FTE staff and fall membership, 50 states and DC.

Requires openpyxl. If the download or parse fails, the script exits non-zero and leaves the
existing data/staffing.json untouched.

Usage:  python scripts/fetch_staffing.py
"""

import datetime as dt
import io
import json
import os
import re
import sys
import urllib.request

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "staffing.json")
# Newest edition first; NCES posts each edition under its own path.
EDITIONS = ["d26", "d25", "d24", "d23"]
URL = "https://nces.ed.gov/programs/digest/{ed}/tables/xls/tabn213.10.xlsx"
PAGE = "https://nces.ed.gov/programs/digest/{ed}/tables/dt{yy}_213.10.asp"
UA = {"User-Agent": "Mozilla/5.0 (compatible; staff-shortages-dashboard/1.0)"}
FIRST_FALL = 2000

# Column positions in the table (checked against the header row below).
COLS = {"total": 1, "officials": 3, "principals": 6, "teachers": 7, "aides": 8, "support": 11}
EXPECT = {"total": "Total", "officials": "Officials", "principals": "Principals", "teachers": "Teachers",
          "aides": "Instructional aides", "support": "Support staff"}


def download():
    for ed in EDITIONS:
        url = URL.format(ed=ed)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                body = r.read()
        except Exception:  # noqa: BLE001 - try the next edition
            continue
        if body[:2] == b"PK":  # an .xlsx file, not an HTML error page
            return ed, url, body
    raise RuntimeError("no edition of Digest Table 213.10 could be downloaded")


def fall_year(label):
    m = re.match(r"Fall (\d{4})", str(label or ""))
    return int(m.group(1)) if m else None


def main():
    ed, url, body = download()
    ws = openpyxl.load_workbook(io.BytesIO(body), read_only=True, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    title = str(rows[0][0])
    hdr = next(r for r in rows if r and r[0] == "School year" and r[COLS["teachers"]] == "Teachers")
    for k, i in COLS.items():
        if not str(hdr[i]).startswith(EXPECT[k]):
            raise RuntimeError(f"Table 213.10 layout changed: column {i} is {hdr[i]!r}, expected {EXPECT[k]!r}")

    section, counts, ratios = None, {}, {}
    for r in rows:
        if not r:
            continue
        # Section labels ("Number", "Pupils per staff member", ...) sit in an otherwise empty row.
        label = next((str(c).strip() for c in r if c is not None), "")
        if label in ("Number", "Percentage distribution", "Pupils per staff member"):
            section = label
            continue
        y = fall_year(r[0])
        if y is None or y < FIRST_FALL:
            continue
        vals = {k: (float(r[i]) if isinstance(r[i], (int, float)) else None) for k, i in COLS.items()}
        if section == "Number":
            counts[y] = vals
        elif section == "Pupils per staff member":
            ratios[y] = vals

    years = sorted(y for y in counts if y in ratios and counts[y]["teachers"] and ratios[y]["teachers"])
    if len(years) < 10:
        raise RuntimeError(f"Table 213.10: only {len(years)} usable years found")

    def col(k):
        return [round(counts[y][k], 2) if counts[y][k] is not None else None for y in years]

    admin = [round(counts[y]["officials"] + counts[y]["principals"], 2)
             if counts[y]["officials"] is not None and counts[y]["principals"] is not None else None for y in years]
    out = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source_url": url,
        "source_page": PAGE.format(ed=ed, yy=ed[1:]),
        "table": title,
        "edition": ed,
        "unit": "Full-time equivalents (staff); fall membership (enrollment); 50 states and DC",
        "years": years,
        "enrollment": [round(counts[y]["teachers"] * ratios[y]["teachers"]) for y in years],
        "staff_total": col("total"),
        "teachers": col("teachers"),
        "aides": col("aides"),
        "support": col("support"),
        "administrators": admin,
        "pupils_per_teacher": [round(ratios[y]["teachers"], 3) for y in years],
        "pupils_per_staff": [round(ratios[y]["total"], 3) for y in years],
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, OUT)
    last = -1
    print(f"OK: {ed}, falls {years[0]}-{years[-1]} ({len(years)} years); fall {years[last]}: "
          f"{out['enrollment'][last]:,} students, {out['teachers'][last]:,.0f} teacher FTE, "
          f"{out['staff_total'][last]:,.0f} staff FTE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"FAILED, existing data left untouched: {e}", file=sys.stderr)
        sys.exit(1)
