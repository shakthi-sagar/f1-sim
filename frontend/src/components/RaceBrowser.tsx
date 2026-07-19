import { useMemo, useState } from 'react';
import { loadRace, useStore } from '../store';
import type { ManifestRace, ScheduleEntry } from '../types';

export default function RaceBrowser() {
  const manifest = useStore((s) => s.manifest);
  const race = useStore((s) => s.race);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const setShowBrowser = useStore((s) => s.setShowBrowser);

  const seasons = useMemo(() => {
    const set = new Set<number>();
    manifest?.races.forEach((r) => set.add(r.season));
    Object.keys(manifest?.schedules ?? {}).forEach((s) => set.add(Number(s)));
    return [...set].sort((a, b) => b - a);
  }, [manifest]);

  const [season, setSeason] = useState<number | null>(null);
  const activeSeason = season ?? seasons[0] ?? null;

  const entries = useMemo(() => {
    if (!manifest || activeSeason == null) return [];
    const processed = new Map<number, ManifestRace>();
    manifest.races
      .filter((r) => r.season === activeSeason)
      .forEach((r) => processed.set(r.round, r));
    const sched: ScheduleEntry[] = manifest.schedules[String(activeSeason)] ?? [];
    if (sched.length === 0) {
      return [...processed.values()].map((r) => ({ entry: r as ScheduleEntry & ManifestRace, race: r }));
    }
    return sched.map((e) => ({ entry: e, race: processed.get(e.round) ?? null }));
  }, [manifest, activeSeason]);

  return (
    <div className="browser-overlay">
      <div className="browser">
        <div className="br-head">
          <div>
            <h1>
              F1<span>SIM</span> Race Replay
            </h1>
            <p>Historical Formula 1 races, rebuilt from real telemetry.</p>
          </div>
          {race && (
            <button className="br-close" onClick={() => setShowBrowser(false)}>
              ✕
            </button>
          )}
        </div>

        {error && <div className="br-error">{error}</div>}
        {loading && <div className="br-loading">{loading}</div>}

        <div className="br-seasons">
          {seasons.map((s) => (
            <button
              key={s}
              className={s === activeSeason ? 'on' : ''}
              onClick={() => setSeason(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="br-sessions">
          <span className="chip on">Race</span>
          <span className="chip off" title="Coming soon">Qualifying</span>
          <span className="chip off" title="Coming soon">Sprint</span>
        </div>

        <div className="br-grid">
          {entries.map(({ entry, race: pr }) => (
            <button
              key={entry.round}
              className={`br-card ${pr ? '' : 'disabled'}`}
              disabled={!pr || !!loading}
              onClick={() => pr && loadRace(pr.file, pr.name)}
              title={
                pr
                  ? `Watch ${pr.name}`
                  : `Not processed yet — run:\npipeline/.venv/bin/python pipeline/process_race.py ${activeSeason} ${entry.round} R`
              }
            >
              <span className="br-round">R{String(entry.round).padStart(2, '0')}</span>
              <span className="br-name">{entry.name}</span>
              <span className="br-loc">
                {entry.location}, {entry.country}
              </span>
              <span className="br-meta">
                {pr ? (
                  <>
                    {pr.laps} laps{pr.winner ? ` · 🏆 ${pr.winner}` : ''} <b>WATCH ▸</b>
                  </>
                ) : (
                  <>not processed</>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="br-foot">
          Add more races: <code>pipeline/.venv/bin/python pipeline/process_race.py &lt;season&gt; &lt;round|name&gt; R</code>
        </div>
      </div>
    </div>
  );
}
