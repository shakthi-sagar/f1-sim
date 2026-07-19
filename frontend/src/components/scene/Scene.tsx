import { Canvas } from '@react-three/fiber';
import { useStore } from '../../store';
import TrackMesh from './TrackMesh';
import Environment from './Environment';
import Cars from './Cars';
import CameraRig from './CameraRig';

export default function Scene() {
  const race = useStore((s) => s.race);
  const world = useStore((s) => s.world);
  const select = useStore((s) => s.select);
  if (!race || !world) return null;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      onPointerMissed={() => select(null)}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#a9cbea']} />
      <fog attach="fog" args={['#cfe2f2', world.radius * 3, world.radius * 12]} />
      <hemisphereLight args={['#cfe4ff', '#7d8f6e', 1.0]} />
      {/* bright morning sun */}
      <directionalLight
        color="#fff3dd"
        position={[world.radius * 0.9, world.radius * 1.15, world.radius * 0.6]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-world.radius * 1.5}
        shadow-camera-right={world.radius * 1.5}
        shadow-camera-top={world.radius * 1.5}
        shadow-camera-bottom={-world.radius * 1.5}
        shadow-camera-far={world.radius * 6}
      />
      {/* soft sky fill */}
      <directionalLight
        color="#bcd6f5"
        position={[-world.radius, world.radius * 0.9, -world.radius * 0.6]}
        intensity={0.55}
      />
      <TrackMesh race={race} world={world} />
      <Environment race={race} world={world} />
      <Cars race={race} world={world} />
      <CameraRig race={race} world={world} />
    </Canvas>
  );
}
