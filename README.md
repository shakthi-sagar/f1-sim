# F1 Race Sim

An interactive Formula 1 race replay built from **real historical telemetry** via the
[FastF1](https://docs.fastf1.dev) API. It recreates full grands prix — car positions,
lap timing, tyre strategy, pit stops, safety cars, overtakes — as a broadcast-style
3D experience with a live leaderboard, telemetry panels, and a scrubbable timeline.

## Structure

```
f1-sim/
├── pipeline/            Python + FastF1 data processing
│   ├── process_race.py  CLI: race session → compact JSON bundle
│   └── .venv/           Python virtualenv (fastf1 installed)
└── frontend/            React + TypeScript + Vite + Three.js (R3F)
    └── public/data/     Pre-generated race JSON + manifest (consumed by the app)
```

## Quick start

```bash
# 1. frontend
cd frontend
npm install
npm run dev            # open the printed URL

# 2. (optional) process more races
cd ..
pipeline/.venv/bin/python pipeline/process_race.py 2024 "Sao Paulo" R
pipeline/.venv/bin/python pipeline/process_race.py 2023 22 R     # round number works too

# 3. (optional) fetch OSM surroundings (buildings, water, woods, roads) for a circuit
pipeline/.venv/bin/python pipeline/fetch_environment.py frontend/public/data/races/2024_21_R.json
```

Three 2024 races ship pre-processed: **British GP** (Hamilton's home win in mixed
conditions), **Italian GP**, and **São Paulo GP** (Verstappen P17 → P1, rain, safety
cars and a red flag).

If `pipeline/.venv` does not exist yet:

```bash
python3 -m venv pipeline/.venv
pipeline/.venv/bin/pip install fastf1
```

FastF1 downloads are cached in `pipeline/.fastf1_cache/`, so reprocessing a race is fast.

## Features

- **3D circuit** generated from telemetry: elevation, track ribbon, edge lines,
  start/finish, sector boundaries, corner numbers, pit lane.
- **20 cars** moving on interpolated 4 Hz position data with team colours and labels.
- **View modes**: full-track overview (orbit/zoom), TV chase cam, onboard cam
  (FOV scales with speed). Click a car or leaderboard row to select a driver.
- **Live leaderboard**: interval/gap toggle, tyre compound + age, pit stop count,
  positions gained/lost, PIT / OUT / +n LAPS states, fastest-lap highlight.
- **Driver telemetry**: speed, gear, RPM, throttle, brake, DRS, current/last/best
  lap, last sector times (purple = session best), gap to leader and car ahead.
- **Race events**: overtakes, pit stops (with pit-lane time), fastest laps, safety
  car / VSC / yellow / red flag periods, retirements, penalties — in a live feed
  and as clickable timeline markers with status-period bands.
- **Playback**: play/pause, restart, ±30 s, 1×–60× speed, timeline scrubbing,
  jump-to-lap. Keyboard: `space` play/pause, `←/→` ±10 s (`shift` ±60 s), `esc`
  deselect.
- **Race browser**: season schedule with processed races playable; qualifying and
  sprint sessions are structurally supported for later.

## Data pipeline

`process_race.py` loads a session with FastF1, then:

1. Resamples every driver's position + car telemetry onto a uniform 0.25 s grid
   (columnar integer arrays for compactness).
2. Computes per-frame race progress (laps + in-lap distance fraction from
   integrated speed), live positions, and gap-to-leader via inverse interpolation
   of the leader's progress curve.
3. Extracts the circuit centerline (fastest-lap trace with elevation), sector
   boundary points, corner markers and a pit-lane polyline.
4. Derives events from lap tables, track status and race control messages.
5. Writes `frontend/public/data/races/<id>.json` (~20 MB per race) and updates
   `manifest.json` (+ the season schedule for the race browser).

All output times are FastF1 *SessionTime* seconds; coordinates are decimetres.

## OSM environment

`fetch_environment.py` geocodes the circuit (Nominatim), pulls the mapped
`highway=raceway` from OpenStreetMap (Overpass, disk-cached in
`pipeline/.osm_cache/`), and registers the FastF1 telemetry frame onto real
geography: exhaustive multi-start rigid ICP followed by an affine polish and
cloud pruning (fit residual ~3 m at Monza/Interlagos). Surrounding buildings,
grandstands, water, woodland and roads are then mapped through the inverse
transform and rendered in 3D, with ground heights sampled from the track's
elevation profile. Output: `frontend/public/data/env/<location>.json`, loaded
automatically when a race at that circuit is opened.

## Known limitations

- Position order during red-flag stoppages is approximate (progress freezes while
  cars are parked in the pit lane).
- Pit-lane geometry comes from one car's pit-stop trace, so it starts/ends on the
  racing line.
- Overtake events are derived from lap-boundary position changes, so mid-lap swaps
  are timestamped at the end of the lap.
