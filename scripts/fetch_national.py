"""Fetch national labor-market data for the School Staff Shortages dashboard.

Pulls every series from the BLS Public Data API (v2; key optional via
BLS_API_KEY) and writes data/national.json and data/national_monthly.csv.
(Earlier versions used FRED's public CSV for the economy-wide series, but FRED
does not answer requests from GitHub's servers. These are all BLS series, so
the dashboard now gets them from BLS directly; the FRED-style names are kept
as keys so the page and downloads are unchanged.)

Standard library only, so it runs unchanged on a laptop or in GitHub Actions.
Nothing is interpolated: a value missing at the source is written as null.
If any fetch fails, the script exits non-zero WITHOUT touching the existing
data files, so the live site keeps serving the last good pull.

Usage:  python scripts/fetch_national.py
"""

import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
START = "2000-12"  # first JOLTS reference month

# --- Economy-wide series (all seasonally adjusted as published) --------------
# key used in national.json (the FRED name) -> (BLS series ID, description)
NATIONAL_SERIES = {
    "JTSJOR": ("JTS000000000000000JOR", "All-sector openings rate (%)"),
    "JTSJOL": ("JTS000000000000000JOL", "All-sector openings level (thousands)"),
    "JTSHIR": ("JTS000000000000000HIR", "All-sector hires rate (%)"),
    "JTSQUR": ("JTS000000000000000QUR", "All-sector quits rate (%)"),
    "JTSLDR": ("JTS000000000000000LDR", "All-sector layoffs & discharges rate (%)"),
    "PAYEMS": ("CES0000000001", "Total nonfarm employment (thousands)"),
    "UNRATE": ("LNS14000000", "Unemployment rate (%)"),
    "UNEMPLOY": ("LNS13000000", "Unemployed persons (thousands)"),
    "CES9093161101": ("CES9093161101", "Local government education employment (thousands)"),
    "CES9092161101": ("CES9092161101", "State government education employment (thousands)"),
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
    ("Mining & logging", "110099", 1, ""),
    ("Construction", "230000", 1, ""),
    ("Manufacturing", "300000", 1, ""),
    ("Trade, transportation & utilities", "400000", 1, ""),
    ("Wholesale trade", "420000", 2, ""),
    ("Retail trade", "440000", 2, ""),
    ("Transportation, warehousing & utilities", "480099", 2, ""),
    ("Information", "510000", 1, ""),
    ("Financial activities", "510099", 1, ""),
    ("Finance & insurance", "520000", 2, ""),
    ("Real estate & rental/leasing", "530000", 2, ""),
    ("Professional & business services", "540099", 1, ""),
    ("Private education & health services", "600000", 1, ""),
    ("Educational services (private)", "610000", 2,
     "Private education only: private K-12, private colleges, tutoring and trade schools"),
    ("Health care & social assistance", "620000", 2, ""),
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


def common_industry_month(ind, latest, max_lag=2):
    """Latest month, no later than the headline month, in which every industry series shown has
    every measure (openings level and the four rates). Refuses to publish an industry table more
    than max_lag months older than the headline month, so the site keeps the last good data."""
    ids = [f"JTS{code}000000000{el}" for _, code, _, _ in INDUSTRIES for el in ELEMENTS]
    months = sorted({m for sid in ids for m in ind[sid] if m <= latest}, reverse=True)
    for m in months:
        if all(ind[sid].get(m, (None, False))[0] is not None for sid in ids):
            y, mo = map(int, latest.split("-"))
            y2, mo2 = map(int, m.split("-"))
            if (y - y2) * 12 + (mo - mo2) > max_lag:
                break
            return m
    raise RuntimeError(f"No month within {max_lag} months of {latest} has every industry measure")


def main():
    key = os.environ.get("BLS_API_KEY", "").strip()
    this_year = dt.date.today().year

    # One batch for all monthly history: 10 economy-wide + 10 education + 2 October NSA series.
    nat_ids = [bls_id for bls_id, _ in NATIONAL_SERIES.values()]
    hist_ids = [f"JTS{code}000000000{el}" for code in HISTORY_INDUSTRIES for el in ELEMENTS]
    hist = fetch_bls(nat_ids + hist_ids + list(NSA_SERIES), 2000, this_year, key)

    ind_ids = [f"JTS{code}000000000{el}" for _, code, _, _ in INDUSTRIES for el in ELEMENTS]
    ind = fetch_bls(ind_ids, this_year - 1, this_year, key)

    # ---- monthly panel -------------------------------------------------------
    headline = hist[NATIONAL_SERIES["JTSJOR"][0]]
    months = sorted(m for m, (v, _) in headline.items() if m >= START and v is not None)
    if not months:
        raise RuntimeError("BLS returned no JOLTS observations")
    latest = months[-1]

    series = {k: [hist[bls_id].get(m, (None, False))[0] for m in months]
              for k, (bls_id, _) in NATIONAL_SERIES.items()}
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
    ind_month = common_industry_month(ind, latest)
    industries = []
    for name, code, indent, note in INDUSTRIES:
        row = {"name": name, "code": code, "indent": indent, "note": note}
        for el in ELEMENTS:
            v = ind[f"JTS{code}000000000{el}"].get(ind_month)
            row[el] = v[0] if v else None
            if el == "JOR":
                row["preliminary"] = bool(v and v[1])
        industries.append(row)

    out = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "latest_month": latest,
        "latest_preliminary": bool(hist["JTS923000000000000JOR"].get(latest, (None, False))[1]),
        "source": "BLS Public Data API v2 (https://api.bls.gov/publicAPI/v2/timeseries/data/)",
        "series_labels": {**{k: f"{desc} [BLS {bls_id}]" for k, (bls_id, desc) in NATIONAL_SERIES.items()},
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
