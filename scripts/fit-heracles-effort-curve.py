#!/usr/bin/env python3
"""
Heracles Training Load's effort curve, refitted from PMData (docs/heracles-training-load.md).

PMData (Thambawita et al. 2020, https://osf.io/vx4bk, CC BY-NC 4.0): 16 athletes over five
months, session RPE (CR-10) beside Fitbit heart rate. Each session-RPE report is matched to the
Fitbit exercise it rates (same kind of sport, ending in the 12 h before the report, length within
0.6-1.6x), the session's COROS-style TRIMP per minute (minutes x HRr x 0.2445 e^(3.411 HRr)) is
read back to the steady HRr that gives it, and HRr is regressed on RPE with a per-person level:
the slope within a person, the level the people's mean. The engine's HRR_AT_REST_RPE and
HRR_PER_RPE are what this prints.

Fetch from OSF, per participant: pmsys/srpe.csv, fitbit/heart_rate.json,
fitbit/resting_heart_rate.json, fitbit/exercise.json, and participant-overview.xlsx.
Usage: python3 scripts/fit-heracles-effort-curve.py <path to the pmdata folder>
HRMAX=nes takes every max HR from age (Nes et al. 2013) instead of the measured ones.
"""

import csv, json, math, os, re, sys, zipfile, statistics
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from bisect import bisect_left, bisect_right
from collections import defaultdict

ROOT = sys.argv[1]
OSLO = ZoneInfo("Europe/Oslo")
STEADY = {"Run", "Treadmill", "Outdoor Bike", "Bike", "Spinning", "Elliptical", "Cross Country Skiing", "Hike", "Swim"}
LIFT = {"Weights", "Workout", "Circuit Training"}

def overview():
    z = zipfile.ZipFile(os.path.join(ROOT, "participant-overview.xlsx"))
    shared = re.findall(r"<t[^>]*>([^<]*)</t>", z.read("xl/sharedStrings.xml").decode())
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", sheet):
        cells = {}
        for ref, attrs, v in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(?:<f>[^<]*</f>)?<v>([^<]*)</v>', row):
            cells[ref] = shared[int(v)] if 't="s"' in attrs else v
        rows.append(cells)
    return rows

def weight(hrr):
    return hrr * 0.2445 * math.exp(3.411 * hrr)

def kind(names):
    n = names.lower()
    has = lambda w: w in n
    if has("strength") and not has("running") and not has("endurance"): return "lift"
    if (has("running") or has("endurance")) and not has("strength") and not has("soccer"): return "steady"
    return None

def run(ages, maxhr):
    out = []
    for pid in sorted(p for p in os.listdir(ROOT) if re.match(r"p\d\d$", p)):
        base = os.path.join(ROOT, pid)
        data = json.load(open(os.path.join(base, "fitbit", "heart_rate.json")))
        times = [datetime.strptime(i["dateTime"], "%Y-%m-%d %H:%M:%S").timestamp() for i in data]
        bpm = [i["value"]["bpm"] for i in data]
        del data
        rest = {}
        rp = os.path.join(base, "fitbit", "resting_heart_rate.json")
        if os.path.exists(rp):
            for i in json.load(open(rp)):
                if i["value"].get("value"): rest[i["dateTime"][:10]] = i["value"]["value"]
        fallback_rest = sorted(bpm)[len(bpm) // 50]
        age = ages.get(pid)
        # Measured where the overview has it, else Nes et al. 2013 (HUNT, 3,320 adults).
        hrmax = maxhr.get(pid) or (211 - 0.64 * age)
        if os.environ.get("HRMAX") == "nes": hrmax = 211 - 0.64 * age
        exercises = []
        for x in json.load(open(os.path.join(base, "fitbit", "exercise.json"))):
            start = datetime.strptime(x["startTime"], "%Y-%m-%d %H:%M:%S")
            exercises.append((start, start + timedelta(milliseconds=x["duration"]), x["activityName"]))
        used = set()
        for r in csv.DictReader(open(os.path.join(base, "pmsys", "srpe.csv"))):
            k = kind(r["activity_names"])
            if not k: continue
            try:
                rpe = float(r["perceived_exertion"]); minutes = float(r["duration_min"])
            except ValueError:
                continue
            if minutes < 10: continue
            report = datetime.strptime(r["end_date_time"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).astimezone(OSLO).replace(tzinfo=None)
            names = STEADY if k == "steady" else LIFT
            best = None
            for idx, (start, end, name) in enumerate(exercises):
                if idx in used or name not in names: continue
                if not (report - timedelta(hours=12) <= end <= report + timedelta(minutes=15)): continue
                ratio = (end - start).total_seconds() / 60 / minutes
                if not (0.6 <= ratio <= 1.6): continue
                gap = abs((report - end).total_seconds())
                if best is None or gap < best[0]: best = (gap, idx, start, end, name)
            if not best: continue
            _, idx, start, end, name = best
            used.add(idx)
            a, b = start.timestamp(), end.timestamp()
            lo, hi = bisect_left(times, a), bisect_right(times, b)
            hrrest = rest.get(start.strftime("%Y-%m-%d"), fallback_rest)
            trimp = covered = 0.0; hrrs = []
            for i in range(lo, hi - 1):
                dt = min(times[i + 1] - times[i], 30.0)
                hrr = max(0.0, min(1.0, (bpm[i] - hrrest) / (hrmax - hrrest)))
                trimp += dt / 60 * weight(hrr); covered += dt; hrrs.append(hrr)
            span = (b - a)
            if span <= 0 or covered < 0.8 * span: continue
            out.append(dict(pid=pid, kind=k, fitbit=name, rpe=rpe, minutes=covered / 60, perMin=trimp / (covered / 60), hrr=statistics.mean(hrrs)))
    return out

ov = overview()
ages = {}; maxhr = {}
for row in ov:
    pid = row.get("A", "")
    if re.match(r"p\d\d$", pid):
        if (row.get("B") or "").strip(): ages[pid] = float(row["B"])
        if (row.get("F") or "").strip(): maxhr[pid] = float(row["F"])
print("ages", ages); print("measured max HR", maxhr)
rows = run(ages, maxhr)

# --- The curve: steady sessions only; a lifting session's heart rate is what is being corrected ---
rows = [r for r in rows if r["kind"] == "steady" and r["perMin"] > 0]
def w(h): return h * 0.2445 * math.exp(3.411 * h)
def winv(y):
    lo, hi = 0.0, 1.5
    for _ in range(60):
        mid = (lo + hi) / 2
        if w(mid) < y: lo = mid
        else: hi = mid
    return (lo + hi) / 2
# Effective HRr of each session (the steady HRr giving its TRIMP per minute).
for r in rows: r["heff"] = winv(r["perMin"])
by = defaultdict(list)
for r in rows: by[r["pid"]].append(r)
# Within-person slope: regress heff on RPE with a per-person intercept (fixed effects).
num = den = 0.0
for pid, rs in by.items():
    if len(rs) < 3: continue
    mr = statistics.mean(r["rpe"] for r in rs); mh = statistics.mean(r["heff"] for r in rs)
    for r in rs:
        num += (r["rpe"] - mr) * (r["heff"] - mh); den += (r["rpe"] - mr) ** 2
slope = num / den
# Population intercept: each person's level at their own mean RPE, put back to RPE 0, people weighted equally.
intercepts = []
for pid, rs in by.items():
    if len(rs) < 3: continue
    intercepts.append(statistics.mean(r["heff"] for r in rs) - slope * statistics.mean(r["rpe"] for r in rs))
c0 = statistics.mean(intercepts)
print("people", len(intercepts), "within-person slope %.4f, population intercept %.4f (person SD %.3f)" % (slope, c0, statistics.pstdev(intercepts)))
for rpe in [1.5, 3, 5, 6, 7, 8, 9, 10]:
    h = c0 + slope * rpe
    print("  RPE %4.1f  HRr %.3f  TL/min %.2f" % (rpe, h, w(h)))
print("per-RPE geometric mean of TL/min (pooled):")
g = defaultdict(list)
for r in rows: g[int(round(r["rpe"]))].append(math.log(r["perMin"]))
for k in sorted(g): print("  RPE %d n=%d  %.2f" % (k, len(g[k]), math.exp(statistics.mean(g[k]))))
# Per person slopes, to see the spread
print("per-person slopes:")
for pid, rs in sorted(by.items()):
    if len(rs) < 8 or len({r['rpe'] for r in rs}) < 3: continue
    mr = statistics.mean(r["rpe"] for r in rs); mh = statistics.mean(r["heff"] for r in rs)
    n = sum((r["rpe"] - mr) * (r["heff"] - mh) for r in rs); d = sum((r["rpe"] - mr) ** 2 for r in rs)
    print("  %s n=%d slope %.4f" % (pid, len(rs), n / d))
