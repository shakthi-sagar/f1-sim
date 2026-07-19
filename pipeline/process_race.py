#!/usr/bin/env python3
"""
Process an F1 race session with FastF1 into a frontend-friendly JSON bundle.

Usage:
    python process_race.py <season> <round-or-name> [session]

Examples:
    python process_race.py 2024 Silverstone R
    python process_race.py 2024 12 R

Output:
    ../frontend/public/data/races/<season>_<round>_<session>.json
    ../frontend/public/data/manifest.json   (updated)

All times in the output are seconds of FastF1 "SessionTime".
Coordinates are in decimetres (FastF1 native units).
"""

import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

import fastf1  # noqa: E402

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent / "frontend" / "public" / "data"
CACHE_DIR = ROOT / ".fastf1_cache"

DT = 0.25  # resample step, seconds
PRE_START = 35.0  # seconds of grid/pre-race shown before lights out

COMPOUND_SHORT = {
    "SOFT": "S", "MEDIUM": "M", "HARD": "H",
    "INTERMEDIATE": "I", "WET": "W",
    "SUPERSOFT": "S", "ULTRASOFT": "S", "HYPERSOFT": "S", "TEST_UNKNOWN": "?",
}


def td_s(v):
    """Timedelta -> float seconds (or None)."""
    if v is None or (isinstance(v, float) and math.isnan(v)) or pd.isna(v):
        return None
    return float(v.total_seconds())


def rnd(v, n=3):
    if v is None:
        return None
    return round(float(v), n)


def step_interp(t_grid, t_src, v_src):
    """Previous-value (step) interpolation for discrete channels."""
    idx = np.searchsorted(t_src, t_grid, side="right") - 1
    idx = np.clip(idx, 0, len(v_src) - 1)
    return v_src[idx]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    season = int(sys.argv[1])
    gp_arg = sys.argv[2]
    ses_name = sys.argv[3] if len(sys.argv) > 3 else "R"
    try:
        gp = int(gp_arg)
    except ValueError:
        gp = gp_arg

    CACHE_DIR.mkdir(exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))

    print(f"Loading {season} {gp} {ses_name} ...")
    session = fastf1.get_session(season, gp, ses_name)
    session.load(laps=True, telemetry=True, weather=False, messages=True)
    laps_all = session.laps
    results = session.results
    event = session.event

    # ------------------------------------------------------------------ drivers
    drivers = {}
    for num, row in results.iterrows():
        num = str(num)
        color = row.get("TeamColor")
        if not isinstance(color, str) or len(color) < 6:
            color = "808080"
        status = str(row.get("Status") or "")
        classified = str(row.get("ClassifiedPosition") or "")
        finished = status.startswith("Finished") or status.startswith("+")
        drivers[num] = {
            "number": num,
            "abbrev": str(row.get("Abbreviation") or f"#{num}"),
            "name": str(row.get("FullName") or ""),
            "team": str(row.get("TeamName") or ""),
            "color": "#" + color.lstrip("#"),
            "grid": int(row.get("GridPosition") or 0) or 99,
            "finishPos": int(float(classified)) if classified.replace(".", "").isdigit() else None,
            "status": status,
            "dnf": not finished,
            "points": float(row.get("Points") or 0),
        }

    # keep only drivers that actually have position telemetry and started the race
    pos_data = session.pos_data
    car_data = session.car_data
    drivers = {n: d for n, d in drivers.items() if n in pos_data and len(pos_data[n]) > 10}
    drivers = {n: d for n, d in drivers.items() if d["status"] != "Did not start"}
    dnums = list(drivers.keys())
    print(f"  {len(dnums)} drivers with telemetry")

    # ------------------------------------------------------------------ timing
    lap1 = laps_all[laps_all["LapNumber"] == 1]
    race_start = float(np.nanmin([td_s(v) or np.nan for v in lap1["LapStartTime"]]))
    total_laps = int(laps_all["LapNumber"].max())

    lap_end_times = [td_s(v) for v in laps_all["Time"] if td_s(v) is not None]
    race_end = max(lap_end_times) + 5.0

    grid_t0 = math.floor(race_start - PRE_START)
    n_frames = int(math.ceil((race_end - grid_t0) / DT)) + 1
    t_grid = grid_t0 + np.arange(n_frames) * DT
    print(f"  race_start={race_start:.1f}s  race_end={race_end:.1f}s  frames={n_frames}")

    # ------------------------------------------------- per-driver laps / stints
    driver_laps = {}
    for num in dnums:
        dl = laps_all[laps_all["DriverNumber"] == num].sort_values("LapNumber")
        out = []
        for _, lp in dl.iterrows():
            start = td_s(lp["LapStartTime"])
            end = td_s(lp["Time"])
            lt = td_s(lp["LapTime"])
            if start is None:
                continue
            if end is None and lt is not None:
                end = start + lt
            compound = str(lp.get("Compound") or "")
            out.append({
                "lap": int(lp["LapNumber"]),
                "start": rnd(start, 2),
                "end": rnd(end, 2),
                "time": rnd(lt, 3),
                "s1": rnd(td_s(lp.get("Sector1Time")), 3),
                "s2": rnd(td_s(lp.get("Sector2Time")), 3),
                "s3": rnd(td_s(lp.get("Sector3Time")), 3),
                "compound": COMPOUND_SHORT.get(compound, compound[:1] or "?"),
                "tyreLife": int(lp["TyreLife"]) if not pd.isna(lp.get("TyreLife")) else None,
                "stint": int(lp["Stint"]) if not pd.isna(lp.get("Stint")) else None,
                "position": int(lp["Position"]) if not pd.isna(lp.get("Position")) else None,
                "pitIn": rnd(td_s(lp.get("PitInTime")), 2),
                "pitOut": rnd(td_s(lp.get("PitOutTime")), 2),
            })
        driver_laps[num] = out

    # ------------------------------------------------------------- telemetry
    # Resample car + pos data onto the uniform grid, per driver.
    tel = {}
    prog = np.zeros((len(dnums), n_frames))  # race progress in laps (float)
    active_until = {}

    for di, num in enumerate(dnums):
        pos = pos_data[num]
        car = car_data[num]

        tp = pos["SessionTime"].dt.total_seconds().to_numpy()
        tc = car["SessionTime"].dt.total_seconds().to_numpy()
        ok_p = ~np.isnan(tp)
        ok_c = ~np.isnan(tc)
        pos, tp = pos[ok_p], tp[ok_p]
        car, tc = car[ok_c], tc[ok_c]

        x = np.interp(t_grid, tp, pos["X"].to_numpy(dtype=float))
        y = np.interp(t_grid, tp, pos["Y"].to_numpy(dtype=float))
        z = np.interp(t_grid, tp, pos["Z"].to_numpy(dtype=float))

        speed = np.interp(t_grid, tc, car["Speed"].to_numpy(dtype=float))
        rpm = np.interp(t_grid, tc, car["RPM"].to_numpy(dtype=float))
        throttle = np.interp(t_grid, tc, car["Throttle"].to_numpy(dtype=float))
        gear = step_interp(t_grid, tc, car["nGear"].to_numpy(dtype=float))
        brake = step_interp(t_grid, tc, car["Brake"].to_numpy(dtype=float))
        drs_raw = step_interp(t_grid, tc, car["DRS"].to_numpy(dtype=float))
        drs = (drs_raw >= 10).astype(int)

        # cumulative distance from integrated speed (for progress fractions)
        v_ms = car["Speed"].to_numpy(dtype=float) / 3.6
        cd = np.concatenate([[0.0], np.cumsum(0.5 * (v_ms[1:] + v_ms[:-1]) * np.diff(tc))])
        dist_grid = np.interp(t_grid, tc, cd)

        # progress: laps completed + distance fraction within current lap
        p = np.zeros(n_frames)
        laps = driver_laps[num]
        for li, lp in enumerate(laps):
            s, e = lp["start"], lp["end"]
            if s is None or e is None or e <= s:
                continue
            i0 = np.searchsorted(t_grid, s)
            i1 = np.searchsorted(t_grid, e)
            if i1 <= i0:
                continue
            d0 = np.interp(s, t_grid, dist_grid)
            d1 = np.interp(e, t_grid, dist_grid)
            span = max(d1 - d0, 1.0)
            frac = np.clip((dist_grid[i0:i1] - d0) / span, 0, 1)
            p[i0:i1] = (lp["lap"] - 1) + frac
        # after final lap: freeze at final value
        if laps:
            last_end = laps[-1]["end"] or laps[-1]["start"]
            i1 = np.searchsorted(t_grid, last_end)
            if i1 < n_frames:
                p[i1:] = laps[-1]["lap"] if laps[-1]["end"] else p[max(i1 - 1, 0)]
        prog[di] = p

        # driver data window (telemetry availability)
        data_end = min(tp[-1], tc[-1])
        if drivers[num]["dnf"]:
            if laps:
                data_end = min(data_end, (laps[-1]["end"] or laps[-1]["start"]) + 3.0)
            else:
                data_end = race_start  # never took the start

        active_until[num] = data_end

        tel[num] = {
            "x": x, "y": y, "z": z, "speed": speed, "rpm": rpm,
            "throttle": throttle, "gear": gear, "brake": brake, "drs": drs,
        }

    # ------------------------------------------------------ positions & gaps
    active = np.zeros((len(dnums), n_frames), dtype=bool)
    for di, num in enumerate(dnums):
        active[di] = t_grid <= active_until[num] + DT

    # rank by progress (grid order before start)
    grid_order = np.array([drivers[n]["grid"] for n in dnums], dtype=float)
    sort_key = np.where(active, prog, -1e9) * 1e6 - grid_order[:, None]
    rank = np.zeros((len(dnums), n_frames), dtype=int)
    order = np.argsort(-sort_key, axis=0, kind="stable")
    for f in range(n_frames):
        rank[order[:, f], f] = np.arange(1, len(dnums) + 1)

    # gap to leader: t - (time when the current leader reached my progress)
    leader_idx = order[0]
    gap = np.zeros((len(dnums), n_frames))
    seg_start = 0
    for f in range(1, n_frames + 1):
        if f == n_frames or leader_idx[f] != leader_idx[seg_start]:
            L = leader_idx[seg_start]
            pL = prog[L]
            # leader progress must be monotonic for inverse interp
            pL_mono = np.maximum.accumulate(pL)
            sl = slice(seg_start, f)
            for di in range(len(dnums)):
                t_at_p = np.interp(prog[di, sl], pL_mono, t_grid)
                gap[di, sl] = t_grid[sl] - t_at_p
            seg_start = f
    gap = np.clip(gap, 0, None)

    # --------------------------------------------------------------- track
    fl = laps_all.pick_fastest()
    fl_drv = str(fl["DriverNumber"])
    fl_start, fl_end = td_s(fl["LapStartTime"]), td_s(fl["Time"])
    fp = pos_data[fl_drv]
    fpt = fp["SessionTime"].dt.total_seconds().to_numpy()
    m = (fpt >= fl_start) & (fpt <= fl_end)
    cl_x = fp["X"].to_numpy(dtype=float)[m]
    cl_y = fp["Y"].to_numpy(dtype=float)[m]
    cl_z = fp["Z"].to_numpy(dtype=float)[m]
    cl_t = fpt[m]
    # close the loop
    centerline = [[round(float(a)), round(float(b)), round(float(c))]
                  for a, b, c in zip(cl_x, cl_y, cl_z)]
    centerline.append(centerline[0])

    # track length: from integrated fastest-lap distance
    fc = car_data[fl_drv]
    fct = fc["SessionTime"].dt.total_seconds().to_numpy()
    fcm = (fct >= fl_start) & (fct <= fl_end)
    v = fc["Speed"].to_numpy(dtype=float)[fcm] / 3.6
    tt = fct[fcm]
    track_len = float(np.sum(0.5 * (v[1:] + v[:-1]) * np.diff(tt))) if len(tt) > 2 else 5000.0

    # sector boundary points (position of fastest driver at s1/s2 elapsed time)
    sectors = []
    s1, s2 = td_s(fl.get("Sector1Time")), td_s(fl.get("Sector2Time"))
    if s1 and s2:
        for t_split in (fl_start + s1, fl_start + s1 + s2):
            sx = float(np.interp(t_split, cl_t, cl_x))
            sy = float(np.interp(t_split, cl_t, cl_y))
            sectors.append([round(sx), round(sy)])

    # corners
    corners = []
    try:
        ci = session.get_circuit_info()
        for _, c in ci.corners.iterrows():
            corners.append({
                "n": int(c["Number"]),
                "letter": str(c.get("Letter") or ""),
                "x": round(float(c["X"])),
                "y": round(float(c["Y"])),
            })
    except Exception as e:
        print(f"  (no circuit info: {e})")

    # pit lane polyline: telemetry of some driver while in the pit lane
    pitlane = []
    try:
        cand = laps_all[laps_all["PitInTime"].notna()]
        for _, lp in cand.iterrows():
            num = str(lp["DriverNumber"])
            if num not in pos_data:
                continue
            t_in = td_s(lp["PitInTime"])
            nxt = laps_all[(laps_all["DriverNumber"] == num) &
                           (laps_all["LapNumber"] == lp["LapNumber"] + 1)]
            if len(nxt) == 0:
                continue
            t_out = td_s(nxt.iloc[0]["PitOutTime"])
            if t_in is None or t_out is None or t_out - t_in > 90:
                continue
            pp = pos_data[num]
            ppt = pp["SessionTime"].dt.total_seconds().to_numpy()
            pm = (ppt >= t_in) & (ppt <= t_out)
            if pm.sum() < 10:
                continue
            px = pp["X"].to_numpy(dtype=float)[pm]
            py = pp["Y"].to_numpy(dtype=float)[pm]
            pz = pp["Z"].to_numpy(dtype=float)[pm]
            pitlane = [[round(float(a)), round(float(b)), round(float(c))]
                       for a, b, c in zip(px, py, pz)]
            break
    except Exception as e:
        print(f"  (no pit lane: {e})")

    # ------------------------------------------------------------- events
    events = []

    def ev(t, etype, msg, driver=None, lap=None):
        events.append({"t": rnd(max(t, grid_t0), 2), "type": etype, "msg": msg,
                       "driver": driver, "lap": lap})

    ev(race_start, "start", "Lights out — race start")

    # pit stops
    pit_counts = {n: 0 for n in dnums}
    for num in dnums:
        d = drivers[num]
        for i, lp in enumerate(driver_laps[num]):
            if lp["pitIn"] is not None:
                pit_counts[num] += 1
                dur = None
                if i + 1 < len(driver_laps[num]):
                    po = driver_laps[num][i + 1]["pitOut"]
                    if po is not None:
                        dur = po - lp["pitIn"]
                extra = f" ({dur:.1f}s pit lane)" if dur and dur < 90 else ""
                ev(lp["pitIn"], "pit",
                   f"{d['abbrev']} pits — stop {pit_counts[num]}, lap {lp['lap']}{extra}",
                   driver=num, lap=lp["lap"])

    # fastest lap progression
    best = None
    fl_rows = []
    for num in dnums:
        for lp in driver_laps[num]:
            if lp["time"] is not None and lp["lap"] > 1:
                fl_rows.append((lp["end"] or 0, lp["time"], num, lp["lap"]))
    for t_end, lt, num, lapn in sorted(fl_rows):
        if best is None or lt < best:
            best = lt
            mm, ss = divmod(lt, 60)
            ev(t_end, "fastest",
               f"{drivers[num]['abbrev']} sets the fastest lap — {int(mm)}:{ss:06.3f} (lap {lapn})",
               driver=num, lap=lapn)

    # overtakes / position changes at lap boundaries
    pos_by_lap = {}
    for num in dnums:
        for lp in driver_laps[num]:
            if lp["position"] is not None:
                pos_by_lap.setdefault(lp["lap"], {})[num] = (lp["position"], lp["end"] or lp["start"])
    for lapn in sorted(pos_by_lap):
        if lapn == 1 or (lapn - 1) not in pos_by_lap:
            continue
        prev, cur = pos_by_lap[lapn - 1], pos_by_lap[lapn]
        for num, (p_now, t_end) in cur.items():
            if num not in prev:
                continue
            p_prev = prev[num][0]
            if p_now < p_prev:
                gained = p_prev - p_now
                victim = next((n for n, (pp, _) in prev.items()
                               if pp == p_now and n in cur and cur[n][0] > p_now), None)
                d = drivers[num]
                in_pit_window = any(abs((lp["pitOut"] or -1e9) - (t_end or 0)) < 120
                                    for lp in driver_laps[num])
                if victim and gained == 1 and not in_pit_window:
                    ev(t_end, "overtake",
                       f"{d['abbrev']} passes {drivers[victim]['abbrev']} for P{p_now}",
                       driver=num, lap=lapn)
                elif gained >= 3:
                    ev(t_end, "position",
                       f"{d['abbrev']} gains {gained} places — up to P{p_now}",
                       driver=num, lap=lapn)

    # track status periods (SC / VSC / yellow / red)
    periods = []
    try:
        ts = session.track_status
        code_map = {"2": "yellow", "4": "sc", "5": "red", "6": "vsc"}
        cur_state, cur_start = None, None
        for _, row in ts.iterrows():
            t = td_s(row["Time"])
            if t is None:
                continue
            t = max(t, grid_t0)
            code = str(row["Status"])
            state = code_map.get(code)
            if code in ("1", "7") or (state and state != cur_state):
                if cur_state is not None:
                    periods.append({"start": rnd(cur_start, 1), "end": rnd(t, 1), "type": cur_state})
                    label = {"sc": "Safety car in", "vsc": "Virtual safety car ending",
                             "yellow": "Track clear", "red": "Session resumed"}[cur_state]
                    ev(t, "green", label)
                cur_state, cur_start = None, None
            if state and cur_state is None:
                cur_state, cur_start = state, t
                label = {"sc": "Safety car deployed", "vsc": "Virtual safety car deployed",
                         "yellow": "Yellow flag", "red": "Red flag"}[state]
                ev(t, state, label)
        if cur_state is not None:
            periods.append({"start": rnd(cur_start, 1), "end": rnd(race_end, 1), "type": cur_state})
    except Exception as e:
        print(f"  (no track status: {e})")

    # retirements
    for num in dnums:
        d = drivers[num]
        if d["dnf"]:
            t_ret = active_until[num]
            last_lap = driver_laps[num][-1]["lap"] if driver_laps[num] else None
            ev(t_ret, "retire", f"{d['abbrev']} retires — {d['status'] or 'DNF'}",
               driver=num, lap=last_lap)

    # penalties from race control
    try:
        rcm = session.race_control_messages
        t0d = session.t0_date
        for _, row in rcm.iterrows():
            msg = str(row["Message"])
            if "PENALTY" in msg.upper() or "BLACK AND WHITE" in msg.upper():
                t = (row["Time"] - t0d).total_seconds()
                ev(t, "penalty", msg.title(), lap=int(row["Lap"]) if not pd.isna(row.get("Lap")) else None)
    except Exception as e:
        print(f"  (no race control messages: {e})")

    events.sort(key=lambda e: e["t"])

    # ---------------------------------------------------------- serialize
    def col_i(a):
        return [int(round(float(v))) for v in a]

    drivers_out = []
    for di, num in enumerate(dnums):
        i0 = 0  # all start at grid_t0
        i1 = min(n_frames, int(math.ceil((active_until[num] - grid_t0) / DT)) + 1)
        T = tel[num]
        d = dict(drivers[num])
        d["pitStops"] = pit_counts[num]
        d["laps"] = driver_laps[num]
        d["tel"] = {
            "i0": i0,
            "n": i1,
            "x": col_i(T["x"][:i1]),
            "y": col_i(T["y"][:i1]),
            "z": col_i(T["z"][:i1]),
            "speed": col_i(T["speed"][:i1]),
            "rpm": col_i(T["rpm"][:i1]),
            "throttle": col_i(T["throttle"][:i1]),
            "gear": col_i(T["gear"][:i1]),
            "brake": col_i(T["brake"][:i1]),
            "drs": col_i(T["drs"][:i1]),
            "pos": col_i(rank[di][:i1]),
            "prog": [round(float(v), 4) for v in prog[di][:i1]],
            "gap": [round(float(v), 2) for v in gap[di][:i1]],
        }
        drivers_out.append(d)

    race_id = f"{season}_{int(event['RoundNumber']):02d}_{ses_name}"
    out = {
        "id": race_id,
        "season": season,
        "round": int(event["RoundNumber"]),
        "name": str(event["EventName"]),
        "officialName": str(event.get("OfficialEventName") or ""),
        "location": str(event["Location"]),
        "country": str(event["Country"]),
        "date": str(event.get("EventDate"))[:10],
        "session": session.name,
        "totalLaps": total_laps,
        "trackLength": round(track_len),
        "t0": grid_t0,
        "dt": DT,
        "nFrames": n_frames,
        "raceStart": rnd(race_start, 2),
        "raceEnd": rnd(race_end, 2),
        "track": {
            "centerline": centerline,
            "sectors": sectors,
            "corners": corners,
            "pitlane": pitlane,
        },
        "periods": periods,
        "events": events,
        "drivers": drivers_out,
    }

    races_dir = DATA_DIR / "races"
    races_dir.mkdir(parents=True, exist_ok=True)
    out_path = races_dir / f"{race_id}.json"
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_mb = out_path.stat().st_size / 1e6
    print(f"  wrote {out_path} ({size_mb:.1f} MB)")

    # ------------------------------------------------------------ manifest
    manifest_path = DATA_DIR / "manifest.json"
    manifest = {"races": [], "schedules": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest["races"] = [r for r in manifest["races"] if r["id"] != race_id]
    manifest["races"].append({
        "id": race_id, "season": season, "round": out["round"],
        "name": out["name"], "location": out["location"], "country": out["country"],
        "date": out["date"], "session": out["session"], "laps": total_laps,
        "winner": next((d["abbrev"] for d in drivers_out if d["finishPos"] == 1), None),
        "file": f"races/{race_id}.json",
    })
    manifest["races"].sort(key=lambda r: (r["season"], r["round"]))

    # season schedule (for the race browser)
    try:
        sched = fastf1.get_event_schedule(season, include_testing=False)
        manifest["schedules"][str(season)] = [
            {"round": int(r["RoundNumber"]), "name": str(r["EventName"]),
             "location": str(r["Location"]), "country": str(r["Country"]),
             "date": str(r["EventDate"])[:10]}
            for _, r in sched.iterrows()
        ]
    except Exception as e:
        print(f"  (schedule fetch failed: {e})")

    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(f"  updated {manifest_path}")
    print("Done.")


if __name__ == "__main__":
    main()
