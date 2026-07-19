import { Canvas } from '@react-three/fiber';
import { useStore } from '../../store';
import TrackMesh from './TrackMesh';
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
      gl={{ antialias: true }}
      onPointerMissed={() => select(null)}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#07090d']} />
      <fog attach="fog" args={['#07090d', world.radius * 3, world.radius * 9]} />
      <hemisphereLight args={['#aebbd6', '#171a20', 1.15]} />
      <directionalLight
        position={[world.radius, world.radius * 1.4, world.radius * 0.5]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-world.radius * 1.5}
        shadow-camera-right={world.radius * 1.5}
        shadow-camera-top={world.radius * 1.5}
        shadow-camera-bottom={-world.radius * 1.5}
        shadow-camera-far={world.radius * 5}
      />
      <TrackMesh race={race} world={world} />
      <Cars race={race} world={world} />
      <CameraRig race={race} world={world} />
    </Canvas>
  );
}
