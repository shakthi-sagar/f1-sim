import { useMemo, useRef } from 'react';
import { clock, useStore } from '../store';
import { fmtClock } from '../lib/format';
import { lapStartTimes } from '../lib/telemetry';
import type { EventType } from '../types';

const SPEEDS = [1, 2, 4, 8, 16, 30, 60];

const MARKER_COLORS: Partial<Record<EventType, string>> = {
  pit: '#4d8dff',
  overtake: '#e8e8e8',
  fastest: '#b400ff',
  sc: '#ffd12e',
  vsc: '#ffd12e',
  red: '#ff3b3b',
  retire: '#ff3b3b',
  penalty: '#ff9f40',
};

const PERIOD_COLORS: Record<string, string> = {
  yellow: 'rgba(255,209,46,0.35)',
  sc: 'rgba(255,209,46,0.6)',
  vsc: 'rgba(255,209,46,0.45)',
  red: 'rgba(255,59,59,0.55)',
};

export default function Timeline() {
  const race = useStore((s) => s.race);
  const t = useStore((s) => s.uiTime);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const seek = useStore((s) => s.seek);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const lapStarts = useMemo(() => (race ? lapStartTimes(race) : []), [race]);
  if (!race) return null;

  const t0 = race.t0;
  const t1 = race.raceEnd;
  const span = t1 - t0;
  const frac = Math.max(0, Math.min(1, (t - t0) / span));

  const timeFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return t;
    const r = el.getBoundingClientRect();
    return t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  };

  const jumpLap = (lap: number) => {
    const ts = lapStarts[lap];
    if (ts != null && isFinite(ts)) seek(ts - 1);
  };

  const curLap = (() => {
    let l = 1;
    for (let i = 1; i < lapStarts.length; i++) {
      if (isFinite(lapStarts[i]) && lapStarts[i] <= t) l = i;
    }
    return l;
  })();

  return (
    <div className="panel timeline">
      <div className="tl-controls">
        <button className="tl-btn" onClick={() => seek(race.raceStart - 12)} title="Restart">
          ⟲
        </button>
        <button className="tl-btn" onClick={() => seek(clock.t - 30)} title="Back 30 s">
          «
        </button>
        <button className="tl-btn play" onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="tl-btn" onClick={() => seek(clock.t + 30)} title="Forward 30 s">
          »
        </button>
        <div className="tl-speeds">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              className={`tl-speed ${speed === sp ? 'on' : ''}`}
              onClick={() => setSpeed(sp)}
            >
              {sp}×
            </button>
          ))}
        </div>
        <div className="tl-lapjump">
          <label>Lap</label>
          <select value={curLap} onChange={(e) => jumpLap(Number(e.target.value))}>
            {Array.from({ length: race.totalLaps }, (_, i) => i + 1).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <span className="tl-clock mono">
          {t < race.raceStart ? '-' : ''}
          {fmtClock(Math.abs(t - race.raceStart))}
        </span>
      </div>

      <div
        ref={barRef}
        className="tl-bar"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seek(timeFromEvent(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) seek(timeFromEvent(e.clientX));
        }}
        onPointerUp={() => (dragging.current = false)}
      >
        {/* SC / VSC / yellow / red bands */}
        {race.periods.map((p, i) => (
          <div
            key={i}
            className="tl-band"
            style={{
              left: `${((p.start - t0) / span) * 100}%`,
              width: `${Math.max(0.15, ((p.end - p.start) / span) * 100)}%`,
              background: PERIOD_COLORS[p.type],
            }}
          />
        ))}
        {/* lap ticks every 5 laps */}
        {lapStarts.map((ts, lap) =>
          lap > 0 && lap % 5 === 0 && isFinite(ts) ? (
            <div key={lap} className="tl-tick" style={{ left: `${((ts - t0) / span) * 100}%` }}>
              <span>{lap}</span>
            </div>
          ) : null,
        )}
        {/* event markers */}
        {race.events.map((e, i) => {
          const c = MARKER_COLORS[e.type];
          if (!c) return null;
          return (
            <div
              key={i}
              className="tl-marker"
              title={e.msg}
              style={{ left: `${((e.t - t0) / span) * 100}%`, background: c }}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                seek(e.t - 4);
              }}
            />
          );
        })}
        <div className="tl-fill" style={{ width: `${frac * 100}%` }} />
        <div className="tl-thumb" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
