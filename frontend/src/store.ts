import { create } from 'zustand';
import type { Manifest, RaceData, ViewMode } from './types';
import { computeWorld, type World } from './lib/telemetry';

/**
 * High-frequency playback time lives outside React in this mutable clock;
 * the 3D scene reads it every frame. React panels subscribe to `uiTime`,
 * which the player loop publishes at ~5 Hz.
 */
export const clock = {
  t: 0,
};

interface AppState {
  manifest: Manifest | null;
  race: RaceData | null;
  world: World | null;
  loading: string | null; // loading message, null when idle
  error: string | null;

  uiTime: number;
  playing: boolean;
  speed: number;
  selected: string | null; // driver number
  view: ViewMode;
  showBrowser: boolean;
  gapMode: 'interval' | 'leader';

  setManifest: (m: Manifest) => void;
  setRace: (r: RaceData | null) => void;
  setLoading: (msg: string | null) => void;
  setError: (msg: string | null) => void;
  setUiTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  select: (driver: string | null) => void;
  setView: (v: ViewMode) => void;
  setShowBrowser: (b: boolean) => void;
  setGapMode: (g: 'interval' | 'leader') => void;
  seek: (t: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  race: null,
  world: null,
  loading: null,
  error: null,

  uiTime: 0,
  playing: false,
  speed: 8,
  selected: null,
  view: 'overview',
  showBrowser: true,
  gapMode: 'interval',

  setManifest: (m) => set({ manifest: m }),
  setRace: (r) => {
    if (r) {
      const t = r.raceStart - 12;
      clock.t = t;
      set({
        race: r,
        world: computeWorld(r),
        uiTime: t,
        playing: true,
        selected: null,
        view: 'overview',
        showBrowser: false,
      });
    } else {
      set({ race: null, world: null, playing: false });
    }
  },
  setLoading: (msg) => set({ loading: msg }),
  setError: (msg) => set({ error: msg }),
  setUiTime: (t) => set({ uiTime: t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  select: (driver) =>
    set((st) => ({
      selected: driver,
      view: driver == null ? 'overview' : st.view === 'overview' ? 'follow' : st.view,
    })),
  setView: (v) =>
    set((st) => {
      if (v !== 'overview' && !st.selected && st.race) {
        // need a driver to follow: pick the current leader
        const r = st.race;
        let best = r.drivers[0];
        let bp = -1;
        for (const d of r.drivers) {
          const f = Math.max(0, Math.min(d.tel.n - 1, Math.round((clock.t - r.t0) / r.dt)));
          if (d.tel.prog[f] > bp) {
            bp = d.tel.prog[f];
            best = d;
          }
        }
        return { view: v, selected: best.number };
      }
      return { view: v };
    }),
  setShowBrowser: (b) => set({ showBrowser: b }),
  setGapMode: (g) => set({ gapMode: g }),
  seek: (t) => {
    const r = get().race;
    if (!r) return;
    const clamped = Math.max(r.t0, Math.min(r.raceEnd, t));
    clock.t = clamped;
    set({ uiTime: clamped });
  },
}));

export async function loadManifest() {
  const st = useStore.getState();
  try {
    const res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    st.setManifest(await res.json());
  } catch {
    st.setError(
      'No race data found. Generate some with: pipeline/.venv/bin/python pipeline/process_race.py 2024 Silverstone R',
    );
  }
}

export async function loadRace(file: string, label: string) {
  const st = useStore.getState();
  st.setLoading(`Loading ${label}…`);
  st.setError(null);
  try {
    const res = await fetch(`data/${file}`);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const mb = (received / 1e6).toFixed(1);
      st.setLoading(
        total
          ? `Loading ${label}… ${Math.round((received / total) * 100)}%`
          : `Loading ${label}… ${mb} MB`,
      );
    }
    const buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    st.setLoading(`Parsing ${label}…`);
    const data: RaceData = JSON.parse(new TextDecoder().decode(buf));
    st.setRace(data);
  } catch (e) {
    st.setError(`Failed to load race: ${e}`);
  } finally {
    st.setLoading(null);
  }
}
