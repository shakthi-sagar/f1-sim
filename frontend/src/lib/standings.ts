import type { Driver, LapRec, RaceData } from './../types';
import { telEndTime } from './telemetry';

export interface StandingRow {
  d: Driver;
  pos: number;
  gapLeader: number; // seconds behind current leader
  interval: number | null; // seconds behind car directly ahead
  lapsDown: number;
  currentLap: number;
  lastLap: number | null;
  bestLap: number | null;
  isRaceFastest: boolean;
  compound: string;
  tyreLife: number | null;
  pitStopsSoFar: number;
  inPit: boolean;
  retired: boolean;
  finished: boolean;
  posDelta: number; // + means gained vs grid
}

function frameIdx(race: RaceData, d: Driver, t: number): number {
  return Math.max(0, Math.min(d.tel.n - 1, Math.round((t - race.t0) / race.dt)));
}

function lapAt(d: Driver, t: number): LapRec | null {
  let last: LapRec | null = null;
  for (const lp of d.laps) {
    if (lp.start != null && lp.start <= t) last = lp;
    else break;
  }
  return last;
}

/** Compute the full live leaderboard at session time t. */
export function standings(race: RaceData, t: number): StandingRow[] {
  const rows: StandingRow[] = [];

  // race-fastest lap completed so far
  let raceBest = Infinity;
  let raceBestDrv = '';
  for (const d of race.drivers) {
    for (const lp of d.laps) {
      if (lp.time != null && lp.lap > 1 && lp.end != null && lp.end <= t && lp.time < raceBest) {
        raceBest = lp.time;
        raceBestDrv = d.number;
      }
    }
  }

  let leaderProg = 0;
  for (const d of race.drivers) {
    const f = frameIdx(race, d, t);
    if (d.tel.prog[f] > leaderProg) leaderProg = d.tel.prog[f];
  }

  for (const d of race.drivers) {
    const f = frameIdx(race, d, t);
    const tel = d.tel;
    const ended = t > telEndTime(race, d) + race.dt;
    const retired = ended && d.dnf;
    const finished = ended && !d.dnf;

    let lastLap: number | null = null;
    let bestLap: number | null = null;
    for (const lp of d.laps) {
      if (lp.end != null && lp.end <= t && lp.time != null) {
        lastLap = lp.time;
        if (bestLap == null || lp.time < bestLap) bestLap = lp.time;
      }
    }

    const cur = lapAt(d, t) ?? d.laps[0] ?? null;
    // in pit: between pit entry and the following pit exit
    let inPit = false;
    for (let i = 0; i < d.laps.length; i++) {
      const pin = d.laps[i].pitIn;
      if (pin == null || pin > t) continue;
      const pout = d.laps[i + 1]?.pitOut;
      if (pout != null ? t <= pout : t - pin < 35) inPit = true;
    }

    let pitStopsSoFar = 0;
    for (const lp of d.laps) {
      if (lp.pitIn != null && lp.pitIn <= t) pitStopsSoFar++;
    }

    const prog = tel.prog[f];
    rows.push({
      d,
      pos: tel.pos[f],
      gapLeader: tel.gap[f],
      interval: null,
      lapsDown: Math.max(0, Math.floor(leaderProg - prog)),
      currentLap: Math.min(race.totalLaps, Math.floor(prog) + 1),
      lastLap,
      bestLap,
      isRaceFastest: raceBestDrv === d.number && isFinite(raceBest),
      compound: cur?.compound ?? '?',
      tyreLife: cur?.tyreLife ?? null,
      pitStopsSoFar,
      inPit,
      retired,
      finished,
      posDelta: retired ? 0 : d.grid - tel.pos[f],
    });
  }

  rows.sort((a, b) => {
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    return a.pos - b.pos;
  });

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.retired && !rows[i - 1].retired) {
      r.interval = Math.max(0, r.gapLeader - rows[i - 1].gapLeader);
    }
  }
  return rows;
}
