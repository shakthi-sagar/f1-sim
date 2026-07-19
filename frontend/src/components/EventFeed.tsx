import { useMemo } from 'react';
import { useStore } from '../store';
import { fmtClock } from '../lib/format';
import type { EventType } from '../types';

const EVENT_META: Record<EventType, { icon: string; cls: string }> = {
  start: { icon: '🏁', cls: 'ev-green' },
  overtake: { icon: '⚔', cls: 'ev-white' },
  position: { icon: '▲', cls: 'ev-white' },
  pit: { icon: '⛽', cls: 'ev-blue' },
  fastest: { icon: '⏱', cls: 'ev-purple' },
  sc: { icon: '🚨', cls: 'ev-yellow' },
  vsc: { icon: 'VSC', cls: 'ev-yellow' },
  yellow: { icon: '⚠', cls: 'ev-yellow' },
  red: { icon: '⛔', cls: 'ev-red' },
  green: { icon: '🟢', cls: 'ev-green' },
  retire: { icon: '✖', cls: 'ev-red' },
  penalty: { icon: '⚖', cls: 'ev-orange' },
};

export default function EventFeed() {
  const race = useStore((s) => s.race);
  const t = useStore((s) => s.uiTime);
  const seek = useStore((s) => s.seek);
  const select = useStore((s) => s.select);

  const visible = useMemo(() => {
    if (!race) return [];
    const past = race.events.filter((e) => e.t <= t);
    return past.slice(-40).reverse();
  }, [race, t]);

  if (!race) return null;

  return (
    <div className="panel eventfeed">
      <div className="ef-head">Race feed</div>
      <div className="ef-rows">
        {visible.length === 0 && <div className="ef-empty">Waiting for lights out…</div>}
        {visible.map((e, i) => {
          const meta = EVENT_META[e.type] ?? { icon: '·', cls: 'ev-white' };
          return (
            <button
              key={`${e.t}-${i}`}
              className={`ef-row ${meta.cls} ${i === 0 ? 'newest' : ''}`}
              onClick={() => {
                seek(e.t - 4);
                if (e.driver) select(e.driver);
              }}
              title="Jump to this moment"
            >
              <span className="ef-icon">{meta.icon}</span>
              <span className="ef-msg">{e.msg}</span>
              <span className="ef-time">
                {e.lap != null ? `L${e.lap}` : fmtClock(e.t - race.raceStart)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
