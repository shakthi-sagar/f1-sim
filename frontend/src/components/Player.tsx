import { useEffect } from 'react';
import { clock, useStore } from '../store';

/** Invisible component that drives playback time and keyboard shortcuts. */
export default function Player() {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const race = useStore((s) => s.race);

  useEffect(() => {
    if (!race) return;
    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing) {
        clock.t += dt * speed;
        if (clock.t >= race.raceEnd) {
          clock.t = race.raceEnd;
          useStore.getState().setPlaying(false);
        }
      }
      if (now - lastPublish > 200) {
        lastPublish = now;
        if (Math.abs(useStore.getState().uiTime - clock.t) > 0.01) {
          useStore.getState().setUiTime(clock.t);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, race]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.race || st.showBrowser) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          st.setPlaying(!st.playing);
          break;
        case 'ArrowLeft':
          st.seek(clock.t - (e.shiftKey ? 60 : 10));
          break;
        case 'ArrowRight':
          st.seek(clock.t + (e.shiftKey ? 60 : 10));
          break;
        case 'Escape':
          st.select(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
