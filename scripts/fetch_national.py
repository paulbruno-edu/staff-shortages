"""Fetch national labor-market data for the School Staff Shortages dashboard.

Pulls economy-wide series from FRED (public CSV, no key) and JOLTS industry
series from the BLS Public Data API (v2; key optional via BLS_API_KEY), then
writes data/national.json and data/national_monthly.csv.

Standard library only, so it runs unchanged on a laptop or in GitHub Actions.
Nothing is interpolated: a value missing at the source is written as null.
If any fetch fails, the script exits non-zero WITHOUT touching the existing
data files, so the live site keeps serving the last good pull.

Usage:  python scripts/fetch_national.py
"""

import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
START = "2000-12-01"  # first JOLTS reference month

# --- FRED: economy-wide series (all seasonally adjusted as published) --------
FRED_SERIES = {
    "JTSJOR": "All-sector openings rate (%)",
    "JTSJOL": "All-sector openings level (thousands)",
    "JTSHIR": "All-sector hires rate (%)",
    "JTSQUR": "All-sector quits rate (%)",
    "JTSLDR": "All-sector layoffs & discharges rate (%)",
    "PAYEMS": "Total nonfarm employment (thousands)",
    "UNRATE": "Unemployment rate (%)",
    "UNEMPLOY": "Unemployed persons (thousands)",
    "CES9093161101": "Local government education employment (thousands)",
    "CES9092161101": "State government education employment (thousands)",
}

# --- BLS JOLTS ---------------------------------------------------------------
# Series ID: JT + S/U (seasonal) + 6-digit industry + 000000000 + data element.
# (The middle zeros are state 00, area 00000, size class 00.)
ELEMENTS = ["JOL", "JOR", "HIR", "QUR", "LDR"]

# Monthly history (SA) for the education comparison charts.
HISTORY_INDUSTRIES = {
    "923000": "SLED",   # state & local government education
    "929000": "SLXED",  # state & local government excluding education
}
# October benchmarks (NOT seasonally adjusted) to sit beside the state snapshots.
NSA_SERIES = {
    "JTU923000000000000JOR": "sled_nsa",
    "JTU000000000000000JOR": "total_nsa",
}

# Latest-month industry table. (name, code, indent level, coverage note)
INDUSTRIES = [
    ("All sectors (total nonfarm)", "000000", 0, ""),
    ("Total private", "100000", 0, ""),
    ("Construction", "230000", 1, ""),
    ("Manufacturing", "300000", 1, ""),
    ("Trade, transportation & utilities", "400000", 1, ""),
    ("Wholesale trade", "420000", 2, ""),
    ("Retail trade", "440000", 2, ""),
    ("Information", "510000", 1, ""),
    ("Finance & insurance", "520000", 1, ""),
    ("Real estate & rental/leasing", "530000", 1, ""),
    ("Professional & business services", "600000", 1, ""),
    ("Educational services (private)", "610000", 1,
     "Private education only: private K-12, private colleges, tutoring and trade schools"),
    ("Health care & social assistance", "620000", 1, ""),
    ("Leisure & hospitality", "700000", 1, ""),
    ("Arts, entertainment & recreation", "710000", 2, ""),
    ("Accommodation & food services", "720000", 2, ""),
    ("Other services", "810000", 1, ""),
    ("Government", "900000", 0, ""),
    ("State & local government", "920000", 1, ""),
    ("State & local education", "923000", 2,
     "Public school districts + public colleges and universities, all staff, not teachers only"),
    ("State & local, excluding education", "929000", 2,
     "All other state and local government: transit, public safety, administration, etc."),
]

BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; staff-shortages-dashboard/1.0)"}


def http_get(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  retry after error: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


def fetch_fred():
    ids = ",".join(FRED_SERIES)
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}&cosd={START}"
    print("FRED:", url)
    text = http_get(url)
    rows = list(csv.DictReader(io.StringIO(text)))
    date_col = [k for k in rows[0] if k not in FRED_SERIES][0]
    out = {}
    for row in rows:
        month = row[date_col][:7]
        out[month] = {}
        for sid in FRED_SERIES:
            v = (row.get(sid) or "").strip()
            out[month][sid] = float(v) if v not in ("", ".") else None
    return out


def bls_query(series_ids, start_year, end_year, key):
    payload = {"seriesid": series_ids, "startyear": str(start_year), "endyear": str(end_year)}
    if key:
        payload["registrationkey"] = key
    body = json.dumps(payload).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                BLS_URL, data=body, headers={**UA, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                res = json.loads(r.read().decode())
            if res.get("status") != "REQUEST_SUCCEEDED":
                raise RuntimeError(f"BLS API: {res.get('status')} {res.get('message')}")
            return res["Results"]["series"]
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f"  retry after error: {e}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))


def fetch_bls(series_ids, start_year, end_year, key):
    """Return {series_id: {"YYYY-MM": (value, preliminary)}} across year windows."""
    span = 20 if key else 10        # API limit on years per request
    per_req = 50 if key else 25     # API limit on series per request
    out = {s: {} for s in series_ids}
    for i in range(0, len(series_ids), per_req):
        chunk = series_ids[i:i + per_req]
        y = start_year
        while y <= end_year:
            y2 = min(y + span - 1, end_year)
            print(f"BLS: {len(chunk)} series, {y}-{y2}")
            for s in bls_query(chunk, y, y2, key):
                for d in s["data"]:
                    if not d["period"].startswith("M") or d["period"] == "M13":
                        continue
                    month = f"{d['year']}-{d['period'][1:]}"
                    val = d["value"].strip()
                    prelim = any(f.get("code") == "P" for f in d.get("footnotes", []) if f)
                    out[s["seriesID"]][month] = (float(val) if val not in ("", "-") else None, prelim)
            y = y2 + 1
            time.sleep(1)
    return out


def main():
    key = os.environ.get("BLS_API_KEY", "").strip()
    this_year = dt.date.today().year

    fred = fetch_fred()

    hist_ids = [f"JTS{code}000000000{el}" for code in HISTORY_INDUSTRIES for el in ELEMENTS]
    hist = fetch_bls(hist_ids + list(NSA_SERIES), 2000, this_year, key)

    ind_ids = [f"JTS{code}000000000{el}" for _, code, _, _ in INDUSTRIES for el in ELEMENTS]
    ind = fetch_bls(ind_ids, this_year - 1, this_year, key)

    # ---- monthly panel -------------------------------------------------------
    months = sorted(m for m in fred if m >= START[:7])
    # Trim trailing months where the headline JOLTS rate has not been released yet.
    while months and fred[months[-1]]["JTSJOR"] is None:
        months.pop()
    if not months:
        raise RuntimeError("FRED returned no JOLTS observations")
    latest = months[-1]

    series = {sid: [fred[m][sid] for m in months] for sid in FRED_SERIES}
    for code, tag in HISTORY_INDUSTRIES.items():
        for el in ELEMENTS:
            sid = f"JTS{code}000000000{el}"
            series[f"{tag}_{el}"] = [hist[sid].get(m, (None, False))[0] for m in months]

    # Derived, computed from published levels (labeled as such on the page).
    series["VU"] = [
        round(o / u, 3) if o is not None and u else None
        for o, u in zip(series["JTSJOL"], series["UNEMPLOY"])
    ]

    if series["SLED_JOR"][-1] is None:
        raise RuntimeError(f"BLS state & local education rate missing for {latest}; refusing to publish a mismatched month")

    # ---- October NSA benchmarks ---------------------------------------------
    october = []
    for year in range(2001, this_year + 1):
        m = f"{year}-10"
        row = {"year": year, "school_year": f"{year}-{str(year + 1)[2:]}"}
        for sid, tag in NSA_SERIES.items():
            row[tag] = hist[sid].get(m, (None, False))[0]
        if row["sled_nsa"] is not None or row["total_nsa"] is not None:
            october.append(row)

    # ---- industry table, latest month common to all rows ---------------------
    ind_month = latest
    industries = []
    for name, code, indent, note in INDUSTRIES:
        row = {"name": name, "code": code, "indent": indent, "note": note}
        for el in ELEMENTS:
            v = ind[f"JTS{code}000000000{el}"].get(ind_month)
            row[el] = v[0] if v else None
            if el == "JOR":
                row["preliminary"] = bool(v and v[1])
        industries.append(row)
    missing = [r["name"] for r in industries if r["JOR"] is None]
    if len(missing) > 3:
        raise RuntimeError(f"Industry rows missing for {ind_month}: {missing}")

    out = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "latest_month": latest,
        "latest_preliminary": bool(hist["JTS923000000000000JOR"].get(latest, (None, False))[1]),
        "series_labels": {**FRED_SERIES,
                          **{f"{t}_{el}": f"JTS{c}000000000{el}" for c, t in HISTORY_INDUSTRIES.items() for el in ELEMENTS},
                          "VU": "Openings per unemployed person (JTSJOL / UNEMPLOY, computed)"},
        "months": months,
        "series": series,
        "october_nsa": october,
        "industry_month": ind_month,
        "industries": industries,
    }

    # ---- write (only after everything above succeeded) ------------------------
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = os.path.join(DATA_DIR, "national.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, os.path.join(DATA_DIR, "national.json"))

    cols = list(series)
    with open(os.path.join(DATA_DIR, "national_monthly.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["month"] + cols)
        for i, m in enumerate(months):
            w.writerow([m] + ["" if series[c][i] is None else series[c][i] for c in cols])

    print(f"OK: {len(months)} months through {latest}; industries for {ind_month}; "
          f"{len(october)} October benchmarks")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"FAILED, existing data left untouched: {e}", file=sys.stderr)
        sys.exit(1)
