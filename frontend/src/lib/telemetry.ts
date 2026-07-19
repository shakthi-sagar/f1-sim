import type { Driver, RaceData } from '../types';

/**
 * World-space conventions:
 *  - FastF1 coordinates are decimetres in a plan view (X east-ish, Y north-ish).
 *  - Three.js world: x = (X - cx) / 10, z = -(Y - cy) / 10, y = (Z - zMin) / 10.
 *  - One world unit = one metre.
 */
export interface World {
  cx: number;
  cy: number;
  zMin: number;
  radius: number; // rough half-extent of the track, metres
}

export function computeWorld(race: RaceData): World {
  const pts = race.track.centerline;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, zMin = Infinity;
  for (const [x, y, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < zMin) zMin = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.max(maxX - minX, maxY - minY) / 2 / 10;
  return { cx, cy, zMin, radius };
}

export function toWorld(w: World, x: number, y: number, z: number): [number, number, number] {
  return [(x - w.cx) / 10, (z - w.zMin) / 10, -(y - w.cy) / 10];
}

export interface CarSample {
  x: number; // world metres
  y: number;
  z: number;
  speed: number;
  rpm: number;
  throttle: number;
  gear: number;
  brake: number;
  drs: number;
  pos: number;
  prog: number;
  gap: number;
  heading: number; // radians, world XZ plane
  ended: boolean; // past the end of this driver's telemetry
}

function lerp(arr: number[], f: number): number {
  const i = Math.floor(f);
  if (i >= arr.length - 1) return arr[arr.length - 1];
  if (i < 0) return arr[0];
  const u = f - i;
  return arr[i] * (1 - u) + arr[i + 1] * u;
}

function step(arr: number[], f: number): number {
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  return arr[i];
}

export function telEndTime(race: RaceData, d: Driver): number {
  return race.t0 + (d.tel.n - 1) * race.dt;
}

/** Sample a driver's state at session time t. Returns null when the car should be hidden. */
export function sampleCar(race: RaceData, world: World, d: Driver, t: number): CarSample | null {
  const tel = d.tel;
  const f = (t - race.t0) / race.dt;
  const ended = f > tel.n - 1;
  if (ended && d.dnf) return null; // retired: car disappears

  const fc = Math.max(0, Math.min(tel.n - 1, f));
  const rx = lerp(tel.x, fc);
  const ry = lerp(tel.y, fc);
  const rz = lerp(tel.z, fc);
  const [wx, wy, wz] = toWorld(world, rx, ry, rz);

  // heading from a slightly forward sample
  const fAhead = Math.min(tel.n - 1, fc + 1.6);
  const ax = lerp(tel.x, fAhead);
  const ay = lerp(tel.y, fAhead);
  const dx = (ax - rx) / 10;
  const dz = -(ay - ry) / 10;
  const heading = Math.abs(dx) + Math.abs(dz) > 1e-4 ? Math.atan2(dx, dz) : 0;

  return {
    x: wx, y: wy, z: wz,
    speed: lerp(tel.speed, fc),
    rpm: lerp(tel.rpm, fc),
    throttle: lerp(tel.throttle, fc),
    gear: step(tel.gear, fc),
    brake: step(tel.brake, fc),
    drs: step(tel.drs, fc),
    pos: step(tel.pos, fc),
    prog: lerp(tel.prog, fc),
    gap: lerp(tel.gap, fc),
    heading,
    ended,
  };
}

/** Session time at which lap `n` begins (first car across the line). */
export function lapStartTimes(race: RaceData): number[] {
  const starts: number[] = new Array(race.totalLaps + 1).fill(Infinity);
  for (const d of race.drivers) {
    for (const lp of d.laps) {
      if (lp.start != null && lp.lap <= race.totalLaps && lp.start < starts[lp.lap]) {
        starts[lp.lap] = lp.start;
      }
    }
  }
  return starts;
}

/** Current leader lap number at time t (for the "LAP n/total" display). */
export function leaderLap(race: RaceData, t: number): number {
  let best = 0;
  for (const d of race.drivers) {
    const f = Math.max(0, Math.min(d.tel.n - 1, (t - race.t0) / race.dt));
    const p = lerp(d.tel.prog, f);
    if (p > best) best = p;
  }
  return Math.max(1, Math.min(race.totalLaps, Math.floor(best) + 1));
}

export function trackStatusAt(race: RaceData, t: number): 'green' | 'sc' | 'vsc' | 'yellow' | 'red' {
  for (const p of race.periods) {
    if (t >= p.start && t <= p.end) return p.type;
  }
  return 'green';
}
