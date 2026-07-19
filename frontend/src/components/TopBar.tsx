import { useStore } from '../store';
import { leaderLap, trackStatusAt } from '../lib/telemetry';
import type { ViewMode } from '../types';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  green: { text: 'TRACK CLEAR', cls: 'st-green' },
  yellow: { text: 'YELLOW FLAG', cls: 'st-yellow' },
  sc: { text: 'SAFETY CAR', cls: 'st-yellow' },
  vsc: { text: 'VIRTUAL SAFETY CAR', cls: 'st-yellow' },
  red: { text: 'RED FLAG', cls: 'st-red' },
};

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'follow', label: 'Chase' },
  { id: 'onboard', label: 'Onboard' },
];

export default function TopBar() {
  const race = useStore((s) => s.race);
  const t = useStore((s) => s.uiTime);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setShowBrowser = useStore((s) => s.setShowBrowser);
  if (!race) return null;

  const lap = leaderLap(race, t);
  const status = t >= race.raceStart ? trackStatusAt(race, t) : 'green';
  const sl = STATUS_LABEL[status];
  const finished = t >= race.raceEnd - 1;

  return (
    <div className="topbar">
      <div className="tb-left">
        <span className="tb-logo">F1<span>SIM</span></span>
        <div className="tb-race">
          <b>{race.name}</b>
          <span>
            {race.location}, {race.country} · {race.season} · {race.session}
          </span>
        </div>
      </div>
      <div className="tb-center">
        <span className="tb-lap">
          {t < race.raceStart ? 'GRID' : finished ? 'FINISH' : `LAP ${lap} / ${race.totalLaps}`}
        </span>
        <span className={`tb-status ${finished ? 'st-chequered' : sl.cls}`}>
          {finished ? '🏁 CHEQUERED FLAG' : sl.text}
        </span>
      </div>
      <div className="tb-right">
        <div className="tb-views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'on' : ''}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button className="tb-browse" onClick={() => setShowBrowser(true)}>
          Races
        </button>
      </div>
    </div>
  );
}
