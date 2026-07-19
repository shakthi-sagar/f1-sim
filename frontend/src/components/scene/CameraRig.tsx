import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RaceData } from '../../types';
import { sampleCar, type World } from '../../lib/telemetry';
import { clock, useStore } from '../../store';

export default function CameraRig({ race, world }: { race: RaceData; world: World }) {
  const view = useStore((s) => s.view);
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const smooth = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false });

  // initial overview framing
  useEffect(() => {
    if (view === 'overview') {
      const r = world.radius;
      camera.position.set(0, r * 1.75, r * 1.05);
      camera.fov = 50;
      camera.near = 1;
      camera.far = r * 30;
      camera.updateProjectionMatrix();
      controls.current?.target.set(0, 0, 0);
      smooth.current.init = false;
    }
  }, [view, camera, world]);

  useFrame((state, delta) => {
    if (view === 'overview') return;
    const st = useStore.getState();
    const d = race.drivers.find((x) => x.number === st.selected);
    if (!d) return;
    const s = sampleCar(race, world, d, clock.t);
    if (!s) return;

    const sin = Math.sin(s.heading);
    const cos = Math.cos(s.heading);
    const carPos = new THREE.Vector3(s.x, s.y, s.z);

    let targetPos: THREE.Vector3;
    let lookAt: THREE.Vector3;
    let fov: number;
    if (view === 'follow') {
      // TV-style chase: high behind the car
      targetPos = carPos.clone().add(new THREE.Vector3(-sin * 46, 24, -cos * 46));
      lookAt = carPos.clone().add(new THREE.Vector3(sin * 25, 0, cos * 25));
      fov = 47;
    } else {
      // onboard-ish: low and close, fov widens with speed
      targetPos = carPos.clone().add(new THREE.Vector3(-sin * 11, 4.2, -cos * 11));
      lookAt = carPos.clone().add(new THREE.Vector3(sin * 32, 1.5, cos * 32));
      fov = 62 + (s.speed / 340) * 28;
    }

    const sm = smooth.current;
    if (!sm.init) {
      sm.pos.copy(targetPos);
      sm.look.copy(lookAt);
      sm.init = true;
    }
    const k = 1 - Math.exp(-delta * (view === 'onboard' ? 14 : 5));
    sm.pos.lerp(targetPos, k);
    sm.look.lerp(lookAt, 1 - Math.exp(-delta * 16));

    camera.position.copy(sm.pos);
    if (view === 'onboard') {
      // high-frequency shake scaled by speed for a sense of pace
      const tt = state.clock.elapsedTime;
      const amp = (s.speed / 320) ** 2 * 0.16;
      camera.position.x += Math.sin(tt * 53.3) * amp;
      camera.position.y += Math.sin(tt * 41.7 + 1.3) * amp * 0.7;
      camera.position.z += Math.cos(tt * 47.9 + 0.6) * amp;
    }
    camera.lookAt(sm.look);
    if (view === 'onboard') {
      camera.rotateZ(Math.sin(state.clock.elapsedTime * 31) * 0.006 * (s.speed / 320));
    }
    camera.fov += (fov - camera.fov) * Math.min(1, delta * 6);
    camera.updateProjectionMatrix();
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={view === 'overview'}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.15}
      minDistance={60}
      maxDistance={world.radius * 6}
      makeDefault
    />
  );
}
