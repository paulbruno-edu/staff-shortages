"""Monthly maintenance checklist for the by-hand parts of the site.

The calendar below is the single list of recurring by-hand work. It is used by
.github/workflows/monthly-checklist.yml, which opens a GitHub issue with the
checklist on the 1st of each month, and by the monthly maintenance task, which
checks the sources due that month. README.md ("Keeping it current") explains
how to make each update.

Usage: python scripts/monthly_checklist.py [MONTH] [YEAR]   (defaults to the current month)
Prints the issue title on the first line and the Markdown body after it.
"""

import datetime as dt
import sys

EVERY_MONTH = [
    "Review the weekly news drafts (`news.html?drafts`); approve or drop each one.",
    "Check that this month's link check (the 3rd) passed; fix or re-point any dead links.",
    "Check recent \"Archive cited sources\" runs for links that could not be archived; save those by hand at web.archive.org.",
    "Read the maintenance task's findings in `maintenance-log.md` (local) and act on any new releases.",
    "Run `python scripts/download_sources.py` to keep private copies of newly cited PDFs and spreadsheets.",
]

CALENDAR = {
    1: [
        "Michigan: Michigan Teacher Shortage Study (EPIC/MSU), statewide vacancy rate for the prior fall.",
        "Iowa: Teacher Shortage Areas release and district spreadsheet (check the posting window; plot one school year earlier than the label).",
        "Nebraska: NDE Teacher Vacancy Survey summary.",
        "Pennsylvania: PDE Professional Staff Vacancy workbook (October 1 quarter) and Professional Staff Summary, if not yet entered.",
        "Virginia: VDOE Positions & Exits rate from the December Board meeting, if not yet entered.",
        "News page: refresh \"What the coverage shows so far\" if new entries change its patterns.",
    ],
    2: [
        "Maryland: MSDE State Board workforce presentation (first-day teacher vacancies; conditional licenses).",
        "Illinois: ISBE Unfilled Positions data and IWERC report (watch from now through spring).",
        "South Carolina: CERRA Educator Supply & Demand tables, Table 5 (watch from now through spring).",
        "Pennsylvania: vacancy workbook and staff summary, if still pending.",
    ],
    3: [
        "Illinois and South Carolina: new releases, if not yet entered.",
        "BLS OEWS: the new national estimates may appear late this month (see April).",
    ],
    4: [
        "BLS OEWS: if the new estimates are out, update `data/composition.json` (see its `_note`) and the provenance \"Employment composition\" row; change `reference` only with new data.",
        "Maryland: MSDE Professional Staff by Assignment report (October teacher count needed for Maryland's latest rate).",
        "Illinois, South Carolina, Colorado: new releases, if not yet entered.",
        "News page: refresh \"What the coverage shows so far\" if new entries change its patterns.",
    ],
    5: [
        "Colorado: CDE Educator Shortage Survey results and workbook (watch through summer).",
        "Maryland: staff report, if not yet out in April.",
    ],
    6: [
        "Colorado: Educator Shortage Survey, if not yet entered.",
    ],
    7: [
        "Learning Policy Institute's annual state vacancy scan: note changes to cross-check in the inventory review.",
        "News page: refresh \"What the coverage shows so far\" if new entries change its patterns.",
    ],
    8: [
        "50-state inventory: start the annual full review (protocol in `data/state_inventory.json`); watch Ohio and Texas's new collections.",
        "Colorado: Educator Shortage Survey, if still pending.",
    ],
    9: [
        "50-state inventory: finish the full review and set `full_review` to the completion date.",
        "North Carolina: NC School Superintendents' Association start-of-year vacancy survey (inventory entry).",
    ],
    10: [
        "Maryland: first-day vacancy count for the new school year (MSDE or governor's release).",
        "Illinois: add statewide enrollment from the new Illinois Report Card data set (`illinois_enrollment` in `data/states.json`).",
        "News page: refresh \"What the coverage shows so far\" if new entries change its patterns.",
    ],
    11: [
        "Illinois: Report Card enrollment, if not yet added.",
        "Pennsylvania: PDE vacancy workbook (October 1 quarter), late fall onward.",
    ],
    12: [
        "Virginia: VDOE Positions & Exits rate (December Board of Education meeting).",
        "Pennsylvania: vacancy workbook, if out.",
        "State panels: October JOLTS benchmarks arrive automatically in early December; check they appear.",
    ],
}


def checklist(month, year):
    name = dt.date(year, month, 1).strftime("%B %Y")
    lines = [f"Site maintenance: {name}", "",
             "Recurring by-hand work for https://shortages.paul-bruno.com this month. "
             "How to make each update: README.md, \"Keeping it current\". Close this issue when done; "
             "note anything left for next month in a comment.", "",
             "**This month**", ""]
    lines += [f"- [ ] {t}" for t in CALENDAR[month]]
    lines += ["", "**Every month**", ""]
    lines += [f"- [ ] {t}" for t in EVERY_MONTH]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    today = dt.date.today()
    month = int(sys.argv[1]) if len(sys.argv) > 1 else today.month
    year = int(sys.argv[2]) if len(sys.argv) > 2 else today.year
    sys.stdout.write(checklist(month, year))
