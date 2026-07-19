import { useMemo } from 'react';
import { useStore } from '../store';
import { standings } from '../lib/standings';
import { compoundColor, fmtGap, fmtLapTime } from '../lib/format';

export default function Leaderboard() {
  const race = useStore((s) => s.race);
  const t = useStore((s) => s.uiTime);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const gapMode = useStore((s) => s.gapMode);
  const setGapMode = useStore((s) => s.setGapMode);

  const rows = useMemo(() => (race ? standings(race, t) : []), [race, t]);
  if (!race) return null;

  return (
    <div className="panel leaderboard">
      <div className="lb-head">
        <span className="lb-title">Classification</span>
        <div className="lb-toggle">
          <button
            className={gapMode === 'interval' ? 'on' : ''}
            onClick={() => setGapMode('interval')}
          >
            INT
          </button>
          <button
            className={gapMode === 'leader' ? 'on' : ''}
            onClick={() => setGapMode('leader')}
          >
            GAP
          </button>
        </div>
      </div>
      <div className="lb-rows">
        {rows.map((r, i) => {
          const out = r.retired;
          let gapText: string;
          if (out) gapText = 'OUT';
          else if (i === 0) gapText = fmtLapTime(r.lastLap);
          else if (r.lapsDown > 0) gapText = `+${r.lapsDown} LAP${r.lapsDown > 1 ? 'S' : ''}`;
          else gapText = fmtGap(gapMode === 'interval' ? r.interval : r.gapLeader);

          return (
            <button
              key={r.d.number}
              className={`lb-row ${selected === r.d.number ? 'sel' : ''} ${out ? 'out' : ''}`}
              onClick={() => select(selected === r.d.number ? null : r.d.number)}
              title={`${r.d.name} — ${r.d.team}`}
            >
              <span className="lb-pos">{out ? '—' : i + 1}</span>
              <span className="lb-team" style={{ background: r.d.color }} />
              <span className="lb-abbrev">{r.d.abbrev}</span>
              <span
                className={`lb-delta ${r.posDelta > 0 ? 'up' : r.posDelta < 0 ? 'down' : ''}`}
              >
                {out || r.posDelta === 0 ? '' : r.posDelta > 0 ? `▲${r.posDelta}` : `▼${-r.posDelta}`}
              </span>
              <span className="lb-tyre" style={{ color: compoundColor(r.compound) }}>
                {r.compound}
                <em>{r.tyreLife ?? ''}</em>
              </span>
              <span className="lb-pit">{r.pitStopsSoFar > 0 ? r.pitStopsSoFar : ''}</span>
              <span className={`lb-gap ${r.isRaceFastest && !out ? 'fastest' : ''}`}>
                {r.inPit && !out ? <span className="pit-badge">PIT</span> : gapText}
              </span>
            </button>
          );
        })}
      </div>
      <div className="lb-foot">
        <span><i className="dot" style={{ background: '#b400ff' }} /> fastest lap</span>
        <span>tyre · age · stops</span>
      </div>
    </div>
  );
}
