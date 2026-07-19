#!/usr/bin/env python3
"""
Fetch OpenStreetMap surroundings for a processed race and register them onto the
FastF1 coordinate frame.

Usage:
    python fetch_environment.py <race_json>          e.g. ../frontend/public/data/races/2024_16_R.json

How it works:
 1. Geocode the event location (Nominatim), find nearby `highway=raceway` ways
    (Overpass) and cluster them into candidate circuits.
 2. Fit the FastF1 centerline onto each candidate with a similarity transform
    (rotation × optional mirror × translation, mini-ICP refinement); keep the
    best-fitting circuit.
 3. Download buildings / water / woodland / roads around the circuit and map
    them through the inverse transform into FastF1 coordinates (decimetres).
 4. Write frontend/public/data/env/<location-slug>.json for the frontend.

Output geometry gets its ground height from the nearest track point, so the
environment follows the circuit's real elevation profile.
"""

import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
ENV_DIR = ROOT.parent / "frontend" / "public" / "data" / "env"

UA = {"User-Agent": "f1-sim-local-project/1.0 (personal educational use)"}
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OSM_CACHE = ROOT / ".osm_cache"

MAX_BUILDINGS = 2600
BBOX_MARGIN_M = 1100.0


def slugify(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def http_json(url: str, data: str | None = None, timeout: int = 240):
    req = urllib.request.Request(url, data=data.encode() if data else None, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def geocode(query: str):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1}
    )
    res = http_json(url)
    if not res:
        return None
    return float(res[0]["lat"]), float(res[0]["lon"])


def overpass(query: str):
    """Query Overpass with a local disk cache and endpoint fallback."""
    import hashlib

    OSM_CACHE.mkdir(exist_ok=True)
    key = hashlib.sha256(query.encode()).hexdigest()[:24]
    cache_file = OSM_CACHE / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    last_err: Exception | None = None
    for attempt in range(4):
        url = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        try:
            res = http_json(url, data="data=" + urllib.parse.quote(query))
            cache_file.write_text(json.dumps(res))
            return res
        except Exception as e:
            last_err = e
            wait = 15 * (attempt + 1)
            print(f"    overpass failed ({e}); retrying in {wait}s ...")
            time.sleep(wait)
    raise last_err  # type: ignore[misc]


def project(lat, lon, lat0, lon0):
    """Equirectangular local projection → metres (x east, y north)."""
    x = (lon - lon0) * 111320.0 * math.cos(math.radians(lat0))
    y = (lat - lat0) * 110540.0
    return x, y


def densify(pts: np.ndarray, step=8.0) -> np.ndarray:
    """Resample a polyline at ~step metre spacing (OSM nodes can be 100s of m apart)."""
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    if total < step:
        return pts
    s = np.arange(0, total, step)
    x = np.interp(s, cum, pts[:, 0])
    y = np.interp(s, cum, pts[:, 1])
    return np.column_stack([x, y])


def cluster_raceways(elements, lat0, lon0):
    """Group raceway ways into spatial clusters; return list of point arrays."""
    ways = []
    for el in elements:
        if el.get("type") == "way" and "geometry" in el:
            pts = np.array(
                [project(g["lat"], g["lon"], lat0, lon0) for g in el["geometry"]]
            )
            if len(pts) >= 2:
                ways.append(densify(pts))
    clusters: list[list[np.ndarray]] = []
    centers: list[np.ndarray] = []
    for w in ways:
        c = w.mean(axis=0)
        placed = False
        for i, cc in enumerate(centers):
            if np.linalg.norm(c - cc) < 1500:
                clusters[i].append(w)
                centers[i] = np.vstack([p for p in clusters[i]]).mean(axis=0)
                placed = True
                break
        if not placed:
            clusters.append([w])
            centers.append(c)
    out = []
    for cl in clusters:
        pts = np.vstack(cl)
        length = sum(
            float(np.sum(np.linalg.norm(np.diff(w, axis=0), axis=1))) for w in cl
        )
        out.append({"pts": pts, "length": length, "center": pts.mean(axis=0)})
    return out


def nn_dist(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """For each point in a, distance to nearest point in b (brute force, chunked)."""
    out = np.empty(len(a))
    for i in range(0, len(a), 256):
        chunk = a[i : i + 256]
        d = np.linalg.norm(chunk[:, None, :] - b[None, :, :], axis=2)
        out[i : i + 256] = d.min(axis=1)
    return out


def fit_track(track_m: np.ndarray, cloud: np.ndarray):
    """
    Fit track points (centred, metres) onto OSM cloud with rotation+mirror+translation.
    Returns (residual, params) where params maps track->cloud frame.
    """
    t_c = track_m - track_m.mean(axis=0)
    cloud_c = cloud.mean(axis=0)
    sample = t_c[:: max(1, len(t_c) // 200)]

    def nn_pairs(p: np.ndarray):
        nn = np.empty_like(p)
        dists = np.empty(len(p))
        for i in range(0, len(p), 256):
            chunk = p[i : i + 256]
            d = np.linalg.norm(chunk[:, None, :] - cloud[None, :, :], axis=2)
            idx = d.argmin(axis=1)
            nn[i : i + 256] = cloud[idx]
            dists[i : i + 256] = d.min(axis=1)
        return nn, dists

    def rigid_icp(mirror: float, deg0: float):
        """Untrimmed rigid ICP — trimming lets bad fits lock onto subsets."""
        pts_m = sample * np.array([1.0, mirror])
        th = math.radians(deg0)
        R = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
        trans = cloud_c.copy()
        for _ in range(18):
            p = pts_m @ R.T + trans
            nn, _dists = nn_pairs(p)
            src, dst = pts_m, nn
            sc, dc = src.mean(axis=0), dst.mean(axis=0)
            s0, d0 = src - sc, dst - dc
            num = float(np.sum(s0[:, 0] * d0[:, 1] - s0[:, 1] * d0[:, 0]))
            den = float(np.sum(s0[:, 0] * d0[:, 0] + s0[:, 1] * d0[:, 1]))
            a = math.atan2(num, den)
            R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
            trans = dc - R @ sc
        p = pts_m @ R.T + trans
        _, d_all = nn_pairs(p)
        return float(np.median(d_all)), R, trans

    # exhaustive multi-start: full ICP from every 10°.
    # FastF1's frame is consistently un-mirrored vs geography (verified on
    # Monza + Interlagos), so only mirror=+1 is searched — mirrored false
    # optima otherwise win on circuits with multiple layouts (Silverstone).
    best = (1e18, None)
    mirror = 1.0
    for deg0 in range(0, 360, 10):
        resid, R, trans = rigid_icp(mirror, deg0)
        if resid < best[0]:
            best = (resid, (mirror, R, trans))
    rigid_resid, (mirror, R, trans) = best

    # affine polish (absorbs the slight skew of F1's local frame), alternating
    # with cloud pruning so alternate circuit layouts sharing the venue
    # (e.g. Silverstone National/Stowe) stop attracting the fit
    pts_m = sample * np.array([1.0, mirror])
    A = R.copy()
    b = trans.copy()
    work = cloud
    affine_resid = rigid_resid
    d_all = None
    for _round in range(3):
        for _ in range(8):
            p = pts_m @ A.T + b
            nn = np.empty_like(p)
            dists = np.empty(len(p))
            for i in range(0, len(p), 256):
                chunk = p[i : i + 256]
                d = np.linalg.norm(chunk[:, None, :] - work[None, :, :], axis=2)
                idx = d.argmin(axis=1)
                nn[i : i + 256] = work[idx]
                dists[i : i + 256] = d.min(axis=1)
            keep = dists <= np.percentile(dists, 80)
            src, dst = pts_m[keep], nn[keep]
            M = np.hstack([src, np.ones((len(src), 1))])
            sol, *_ = np.linalg.lstsq(M, dst, rcond=None)
            A = sol[:2].T
            b = sol[2]
        p = pts_m @ A.T + b
        d_all = nn_dist(p, work)
        affine_resid = float(np.median(d_all))
        # prune the cloud to points near the fitted track for the next round
        cd = nn_dist(work, p)
        thresh = max(25.0, 2.5 * affine_resid)
        work = work[cd < thresh]
        if len(work) < 100:
            break
    sx, sy = float(np.linalg.norm(A[:, 0])), float(np.linalg.norm(A[:, 1]))
    if not (0.9 < sx < 1.1 and 0.9 < sy < 1.1 and affine_resid < rigid_resid + 1):
        A, b = R, trans  # affine went degenerate; fall back to the rigid fit
        affine_resid = rigid_resid
        p = pts_m @ A.T + b
        _, d_all = nn_pairs(p)

    return affine_resid, {
        "mirror": mirror,
        "theta": math.atan2(A[1, 0], A[0, 0]),
        "scale": (sx + sy) / 2,
        "A": A,
        "b": b,
        "track_mean": track_m.mean(axis=0),
        "p90": float(np.percentile(d_all, 90)),
    }


# ---------------------------------------------------------------- terrain
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TERRAIN_ZOOM = 13
TERRAIN_N = 96  # heightmap grid resolution


def fetch_terrain_tile(z: int, x: int, y: int):
    from PIL import Image
    import io

    OSM_CACHE.mkdir(exist_ok=True)
    cache_file = OSM_CACHE / f"terrarium_{z}_{x}_{y}.png"
    if not cache_file.exists():
        req = urllib.request.Request(TERRARIUM_URL.format(z=z, x=x, y=y), headers=UA)
        with urllib.request.urlopen(req, timeout=60) as resp:
            cache_file.write_bytes(resp.read())
    img = Image.open(io.BytesIO(cache_file.read_bytes())).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    # terrarium encoding: elevation = R*256 + G + B/256 - 32768
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768


class ElevationSampler:
    """Bilinear elevation lookup over AWS terrarium tiles (metres ASL)."""

    def __init__(self):
        self.tiles: dict[tuple[int, int], np.ndarray] = {}

    def _px(self, gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
        out = np.empty(len(gx))
        tx, ty = gx // 256, gy // 256
        for key in set(zip(tx.tolist(), ty.tolist())):
            if key not in self.tiles:
                self.tiles[key] = fetch_terrain_tile(TERRAIN_ZOOM, key[0], key[1])
            m = (tx == key[0]) & (ty == key[1])
            out[m] = self.tiles[key][gy[m] % 256, gx[m] % 256]
        return out

    def sample(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        n = 2**TERRAIN_ZOOM
        xt = (lon + 180.0) / 360.0 * n
        yt = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n
        gx = xt * 256 - 0.5
        gy = yt * 256 - 0.5
        x0 = np.floor(gx).astype(int)
        y0 = np.floor(gy).astype(int)
        fx, fy = gx - x0, gy - y0
        v00 = self._px(x0, y0)
        v10 = self._px(x0 + 1, y0)
        v01 = self._px(x0, y0 + 1)
        v11 = self._px(x0 + 1, y0 + 1)
        return (
            v00 * (1 - fx) * (1 - fy)
            + v10 * fx * (1 - fy)
            + v01 * (1 - fx) * fy
            + v11 * fx * fy
        )


def make_forward(params):
    """Return fn mapping FastF1 metres -> OSM local metres."""
    A = params["A"]
    mirror = params["mirror"]
    b = params["b"]
    mean = params["track_mean"]

    def fwd(pts: np.ndarray) -> np.ndarray:
        q = (pts - mean) * np.array([1.0, mirror])
        return q @ A.T + b

    return fwd


def make_inverse(params):
    """Return fn mapping OSM local metres -> FastF1 metres."""
    A_inv = np.linalg.inv(params["A"])
    mirror = params["mirror"]
    b = params["b"]
    mean = params["track_mean"]

    def inv(pts: np.ndarray) -> np.ndarray:
        q = (pts - b) @ A_inv.T
        q = q * np.array([1.0, mirror])
        return q + mean

    return inv


def poly_simplify(pts: np.ndarray, tol=3.0):
    if len(pts) < 3:
        return pts
    keep = [pts[0]]
    for p in pts[1:]:
        if np.linalg.norm(p - keep[-1]) >= tol:
            keep.append(p)
    return np.array(keep)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    race_path = Path(sys.argv[1])
    race = json.loads(race_path.read_text())
    location, country = race["location"], race["country"]
    slug = slugify(location)
    track_len = race["trackLength"]

    # FastF1 centerline in metres
    cl = np.array([[p[0] / 10.0, p[1] / 10.0] for p in race["track"]["centerline"]])
    cl_z = np.array([p[2] / 10.0 for p in race["track"]["centerline"]])

    print(f"Geocoding {location}, {country} ...")
    loc = geocode(f"{location}, {country}")
    if not loc:
        loc = geocode(f"{race['name']}")
    if not loc:
        print("geocoding failed")
        sys.exit(1)
    lat0, lon0 = loc
    print(f"  -> {lat0:.5f}, {lon0:.5f}")
    time.sleep(1)

    print("Finding raceway on OSM ...")
    q = f'[out:json][timeout:120];way[highway=raceway](around:25000,{lat0},{lon0});out geom;'
    res = overpass(q)
    clusters = cluster_raceways(res.get("elements", []), lat0, lon0)
    cands = [c for c in clusters if 0.4 * track_len < c["length"] < 4.0 * track_len]
    if not cands:
        cands = clusters
    if not cands:
        print("no raceway found on OSM near this location")
        sys.exit(1)
    print(f"  {len(clusters)} raceway clusters, {len(cands)} candidates")

    best = (1e18, None, None)
    for c in cands:
        resid, params = fit_track(cl, c["pts"])
        print(f"    candidate len={c['length']:.0f}m  residual={resid:.1f}m")
        if resid < best[0]:
            best = (resid, params, c)
    resid, params, chosen = best
    print(
        f"  best fit median {resid:.1f} m, p90 {params.get('p90', 0):.1f} m "
        f"(mirror={params['mirror']}, theta={math.degrees(params['theta']):.1f}°, "
        f"scale={params.get('scale', 1.0):.4f})"
    )
    if resid > 60:
        print("  WARNING: poor fit — environment may be misaligned")
    inv = make_inverse(params)

    # bbox around chosen circuit in lat/lon
    cx, cy = chosen["pts"].mean(axis=0)
    ext = chosen["pts"].max(axis=0) - chosen["pts"].min(axis=0)
    half = ext / 2 + BBOX_MARGIN_M
    dlat = half[1] / 110540.0
    dlon = half[0] / (111320.0 * math.cos(math.radians(lat0)))
    clat = lat0 + cy / 110540.0
    clon = lon0 + cx / (111320.0 * math.cos(math.radians(lat0)))
    bbox = f"{clat - dlat},{clon - dlon},{clat + dlat},{clon + dlon}"

    print("Downloading surroundings (buildings, water, woods, roads) ...")
    q = f"""[out:json][timeout:180];
(
  way[building]({bbox});
  way[natural=water]({bbox});
  way[waterway=riverbank]({bbox});
  way[natural=wood]({bbox});
  way[landuse~"^(forest|grass|meadow|recreation_ground)$"]({bbox});
  way[leisure~"^(park|pitch|garden)$"]({bbox});
  way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]({bbox});
  way[aeroway~"^(runway|taxiway)$"]({bbox});
);
out geom;"""
    res = overpass(q)
    els = res.get("elements", [])
    print(f"  {len(els)} osm ways")

    def to_local(way):
        return np.array([project(g["lat"], g["lon"], lat0, lon0) for g in way["geometry"]])

    # nearest-track elevation lookup (FastF1 metres)
    def base_height(pts_f1: np.ndarray) -> float:
        c = pts_f1.mean(axis=0)
        d = np.linalg.norm(cl - c, axis=1)
        return float(cl_z[d.argmin()])

    buildings, water, green, roads = [], [], [], []
    track_min = cl.min(axis=0) - 200
    track_max = cl.max(axis=0) + 200

    def dm(pts):  # decimetre ints
        return [[int(round(x * 10)), int(round(y * 10))] for x, y in pts]

    for el in els:
        if el.get("type") != "way" or "geometry" not in el or len(el["geometry"]) < 2:
            continue
        tags = el.get("tags", {})
        pts = inv(to_local(el))
        # cheap crop: skip features fully outside the padded track bbox
        if (pts.max(axis=0) < track_min).any() or (pts.min(axis=0) > track_max).any():
            pass  # keep; bbox already limits extent
        if "building" in tags:
            pts_s = poly_simplify(pts, 2.0)
            if len(pts_s) < 3:
                continue
            levels = tags.get("building:levels")
            try:
                h = max(3.5, min(45.0, float(levels) * 3.1)) if levels else 0
            except ValueError:
                h = 0
            if not h:
                h = 9.0 if tags.get("building") in ("grandstand", "stadium") else 5.0
            kind = "grandstand" if tags.get("building") in ("grandstand", "stadium") else "building"
            buildings.append({"p": dm(pts_s), "h": round(h, 1), "k": kind, "z": round(base_height(pts_s), 1)})
        elif tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
            pts_s = poly_simplify(pts, 4.0)
            if len(pts_s) >= 3:
                water.append({"p": dm(pts_s), "z": round(base_height(pts_s), 1)})
        elif "highway" in tags or "aeroway" in tags:
            pts_s = poly_simplify(pts, 5.0)
            if len(pts_s) >= 2:
                if tags.get("aeroway") == "runway":
                    w = 32
                elif tags.get("aeroway") == "taxiway":
                    w = 12
                elif tags.get("highway") in ("motorway", "trunk", "primary"):
                    w = 9
                else:
                    w = 6
                roads.append({"p": dm(pts_s), "w": w, "z": round(base_height(pts_s), 1)})
        else:
            pts_s = poly_simplify(pts, 5.0)
            if len(pts_s) >= 3:
                wooded = tags.get("natural") == "wood" or tags.get("landuse") == "forest"
                green.append({"p": dm(pts_s), "t": 1 if wooded else 0, "z": round(base_height(pts_s), 1)})

    # keep the largest buildings if there are too many
    if len(buildings) > MAX_BUILDINGS:
        def area(b):
            p = np.array(b["p"], dtype=float)
            x, y = p[:, 0], p[:, 1]
            return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        buildings.sort(key=area, reverse=True)
        buildings = buildings[:MAX_BUILDINGS]

    # ------------------------------------------------------------- terrain
    terrain = None
    try:
        print("Building terrain heightmap (AWS terrain tiles) ...")
        fwd = make_forward(params)
        sampler = ElevationSampler()

        def latlon_of(pts_f1_m: np.ndarray):
            q = fwd(pts_f1_m)
            lat = lat0 + q[:, 1] / 110540.0
            lon = lon0 + q[:, 0] / (111320.0 * math.cos(math.radians(lat0)))
            return lat, lon

        # vertical datum: align terrain ASL to the track's telemetry Z
        lat_t, lon_t = latlon_of(cl)
        elev_track = sampler.sample(lat_t, lon_t)
        datum = float(np.median(elev_track - cl_z))
        print(f"  vertical datum offset {datum:.1f} m")

        lo = cl.min(axis=0) - BBOX_MARGIN_M
        hi = cl.max(axis=0) + BBOX_MARGIN_M
        gx = np.linspace(lo[0], hi[0], TERRAIN_N)
        gy = np.linspace(lo[1], hi[1], TERRAIN_N)
        GX, GY = np.meshgrid(gx, gy)
        nodes = np.column_stack([GX.ravel(), GY.ravel()])
        lat_n, lon_n = latlon_of(nodes)
        elev = sampler.sample(lat_n, lon_n) - datum

        # blend the terrain onto the track's own elevation near the circuit so
        # the racing surface never ends up buried or floating
        d_track = np.empty(len(nodes))
        nearest_z = np.empty(len(nodes))
        for i in range(0, len(nodes), 512):
            chunk = nodes[i : i + 512]
            d = np.linalg.norm(chunk[:, None, :] - cl[None, :, :], axis=2)
            idx = d.argmin(axis=1)
            d_track[i : i + 512] = d.min(axis=1)
            nearest_z[i : i + 512] = cl_z[idx]
        w = np.clip((d_track - 50.0) / 150.0, 0.0, 1.0)
        # sink the terrain well below the racing surface near the circuit so
        # coarse grid interpolation can never poke through the track ribbon
        sink = 1.8 * (1 - w) + 0.35
        z_final = nearest_z * (1 - w) + elev * w - sink

        terrain = {
            "x0": int(round(lo[0] * 10)),
            "y0": int(round(lo[1] * 10)),
            "dx": round((gx[1] - gx[0]) * 10, 2),
            "dy": round((gy[1] - gy[0]) * 10, 2),
            "nx": TERRAIN_N,
            "ny": TERRAIN_N,
            "z": [int(round(v * 10)) for v in z_final],
        }
        print(f"  terrain grid {TERRAIN_N}x{TERRAIN_N}, relief {z_final.min():.0f}..{z_final.max():.0f} m")
    except Exception as e:
        print(f"  (terrain failed: {e})")

    out = {
        "slug": slug,
        "location": location,
        "fitResidual": round(resid, 1),
        "terrain": terrain,
        "buildings": buildings,
        "water": water,
        "green": green,
        "roads": roads,
    }
    ENV_DIR.mkdir(parents=True, exist_ok=True)
    out_path = ENV_DIR / f"{slug}.json"
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"  wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB): "
        f"{len(buildings)} buildings, {len(water)} water, {len(green)} green, {len(roads)} roads"
    )


if __name__ == "__main__":
    main()
