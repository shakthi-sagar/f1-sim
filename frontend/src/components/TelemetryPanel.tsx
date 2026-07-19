import { useMemo } from 'react';
import { useStore } from '../store';
import { sampleCar } from '../lib/telemetry';
import { compoundColor, fmtGap, fmtLapTime, fmtSector } from '../lib/format';
import type { LapRec } from '../types';

export default function TelemetryPanel() {
  const race = useStore((s) => s.race);
  const world = useStore((s) => s.world);
  const t = useStore((s) => s.uiTime);
  const selected = useStore((s) => s.selected);

  const d = race?.drivers.find((x) => x.number === selected);

  // session-best sector times so far (for colouring)
  const sessionBest = useMemo(() => {
    if (!race) return { s1: Infinity, s2: Infinity, s3: Infinity };
    const best = { s1: Infinity, s2: Infinity, s3: Infinity };
    for (const dr of race.drivers) {
      for (const lp of dr.laps) {
        if (lp.end == null || lp.end > t) continue;
        if (lp.s1 != null && lp.s1 < best.s1) best.s1 = lp.s1;
        if (lp.s2 != null && lp.s2 < best.s2) best.s2 = lp.s2;
        if (lp.s3 != null && lp.s3 < best.s3) best.s3 = lp.s3;
      }
    }
    return best;
  }, [race, t]);

  if (!race || !world || !d) return null;
  const s = sampleCar(race, world, d, t);

  let curLap: LapRec | null = null;
  let prevLap: LapRec | null = null;
  let bestLap: LapRec | null = null;
  for (const lp of d.laps) {
    if (lp.start != null && lp.start <= t) {
      prevLap = curLap && (curLap.end == null || curLap.end <= t) ? curLap : prevLap;
      curLap = lp;
    }
    if (lp.end != null && lp.end <= t && lp.time != null && (bestLap?.time == null || lp.time < bestLap.time)) {
      bestLap = lp;
    }
  }
  const running = curLap?.start != null ? Math.max(0, t - curLap.start) : 0;
  const lapDone = curLap?.end != null && curLap.end <= t;

  const retired = !s && d.dnf;
  const gear = s && s.gear > 0 ? String(Math.round(s.gear)) : 'N';

  const sectorCell = (lp: LapRec | null, key: 's1' | 's2' | 's3') => {
    const v = lp?.[key] ?? null;
    const isBest = v != null && v <= sessionBest[key] + 1e-4;
    return (
      <span className={`sec ${isBest ? 'purple' : ''}`} key={key}>
        {fmtSector(v)}
      </span>
    );
  };

  const ahead = s
    ? race.drivers
        .map((dr) => ({ dr, ss: sampleCar(race, world, dr, t) }))
        .find((x) => x.ss && s && x.ss.pos === s.pos - 1)
    : null;

  return (
    <div className="panel telemetry">
      <div className="tp-head" style={{ borderColor: d.color }}>
        <div>
          <div className="tp-name">{d.name}</div>
          <div className="tp-team" style={{ color: d.color }}>{d.team}</div>
        </div>
        <div className="tp-posbox">
          <span className="tp-pos">{retired ? 'DNF' : s ? `P${s.pos}` : '—'}</span>
          <span className="tp-lap">
            {retired ? d.status : s ? `LAP ${Math.min(race.totalLaps, Math.floor(s.prog) + 1)}` : ''}
          </span>
        </div>
      </div>

      {s && !retired ? (
        <>
          <div className="tp-speedrow">
            <div className="tp-speed">
              <b>{Math.round(s.speed)}</b>
              <span>km/h</span>
            </div>
            <div className="tp-gear">
              <b>{gear}</b>
              <span>gear</span>
            </div>
            <div className={`tp-drs ${s.drs ? 'open' : ''}`}>DRS</div>
          </div>

          <div className="tp-bars">
            <div className="bar-row">
              <label>THR</label>
              <div className="bar"><i style={{ width: `${s.throttle}%`, background: '#2ecc71' }} /></div>
            </div>
            <div className="bar-row">
              <label>BRK</label>
              <div className="bar"><i style={{ width: s.brake ? '100%' : '0%', background: '#ff3b3b' }} /></div>
            </div>
            <div className="bar-row">
              <label>RPM</label>
              <div className="bar"><i style={{ width: `${Math.min(100, (s.rpm / 12500) * 100)}%`, background: '#4d8dff' }} /></div>
              <em>{Math.round(s.rpm)}</em>
            </div>
          </div>

          <div className="tp-grid">
            <div className="cell">
              <label>Tyre</label>
              <span style={{ color: compoundColor(curLap?.compound ?? '?') }}>
                {curLap?.compound ?? '?'} · {curLap?.tyreLife ?? '—'} laps
              </span>
            </div>
            <div className="cell">
              <label>Pit stops</label>
              <span>{d.laps.filter((lp) => lp.pitIn != null && lp.pitIn <= t).length}</span>
            </div>
            <div className="cell">
              <label>Gap to leader</label>
              <span>{s.pos === 1 ? 'LEADER' : fmtGap(s.gap)}</span>
            </div>
            <div className="cell">
              <label>Gap ahead</label>
              <span>{s.pos === 1 ? '—' : ahead?.ss ? fmtGap(s.gap - ahead.ss.gap) : '—'}</span>
            </div>
          </div>

          <div className="tp-laps">
            <div className="lap-row">
              <label>Current</label>
              <span className="mono">{lapDone ? '—' : fmtLapTime(running)}</span>
            </div>
            <div className="lap-row">
              <label>Last</label>
              <span className="mono">{fmtLapTime(prevLap?.time ?? (lapDone ? curLap?.time ?? null : null))}</span>
            </div>
            <div className="lap-row">
              <label>Best</label>
              <span className="mono best">{fmtLapTime(bestLap?.time ?? null)}</span>
            </div>
            <div className="tp-sectors">
              <label>Last sectors</label>
              <div>
                {(['s1', 's2', 's3'] as const).map((k) =>
                  sectorCell(lapDone ? curLap : prevLap, k),
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="tp-retired">
          {retired ? `Retired — ${d.status || 'DNF'}` : 'No data'}
        </div>
      )}
    </div>
  );
}
