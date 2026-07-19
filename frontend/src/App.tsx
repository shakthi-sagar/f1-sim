import { useEffect } from 'react';
import { loadManifest, useStore } from './store';
import Player from './components/Player';
import Scene from './components/scene/Scene';
import TopBar from './components/TopBar';
import Leaderboard from './components/Leaderboard';
import TelemetryPanel from './components/TelemetryPanel';
import EventFeed from './components/EventFeed';
import Timeline from './components/Timeline';
import RaceBrowser from './components/RaceBrowser';

export default function App() {
  const race = useStore((s) => s.race);
  const selected = useStore((s) => s.selected);
  const showBrowser = useStore((s) => s.showBrowser);

  useEffect(() => {
    loadManifest();
  }, []);

  return (
    <div className="app">
      <Player />
      {race && (
        <>
          <Scene />
          <TopBar />
          <div className="left-stack">
            <Leaderboard />
          </div>
          <div className="right-stack">
            {selected && <TelemetryPanel />}
            <EventFeed />
          </div>
          <div className="bottom-stack">
            <Timeline />
          </div>
        </>
      )}
      {(showBrowser || !race) && <RaceBrowser />}
    </div>
  );
}
