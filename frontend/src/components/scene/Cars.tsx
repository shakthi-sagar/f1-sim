import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import type { Driver, RaceData } from '../../types';
import { sampleCar, type World } from '../../lib/telemetry';
import { clock, useStore } from '../../store';

const CAR_SCALE = 1.7; // visual exaggeration so cars read from overview

function CarBody({ color }: { color: string }) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }),
    [color],
  );
  const dark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.7 }),
    [],
  );
  return (
    <group scale={CAR_SCALE}>
      {/* main body */}
      <mesh material={mat} position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[1.5, 0.55, 3.6]} />
      </mesh>
      {/* nose */}
      <mesh material={mat} position={[0, 0.35, 2.35]}>
        <boxGeometry args={[0.55, 0.3, 1.4]} />
      </mesh>
      {/* front wing */}
      <mesh material={mat} position={[0, 0.18, 2.85]}>
        <boxGeometry args={[1.9, 0.12, 0.55]} />
      </mesh>
      {/* rear wing */}
      <mesh material={mat} position={[0, 0.95, -1.75]}>
        <boxGeometry args={[1.75, 0.45, 0.25]} />
      </mesh>
      {/* halo/cockpit */}
      <mesh material={dark} position={[0, 0.82, 0.35]}>
        <boxGeometry args={[0.7, 0.4, 1.0]} />
      </mesh>
      {/* wheels */}
      {[
        [-0.95, 1.35], [0.95, 1.35], [-0.95, -1.45], [0.95, -1.45],
      ].map(([x, z], i) => (
        <mesh key={i} material={dark} position={[x, 0.4, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.42, 0.42, 0.42, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function Car({ race, world, driver }: { race: RaceData; world: World; driver: Driver }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const select = useStore((s) => s.select);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const s = sampleCar(race, world, driver, clock.t);
    if (!s) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(s.x, s.y + 0.15, s.z);
    // damped heading to avoid jitter at low speed
    const cur = g.rotation.y;
    let delta = s.heading - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    g.rotation.y = cur + delta * 0.35;

    const st = useStore.getState();
    const isSel = st.selected === driver.number;
    const onboardSelf = isSel && st.view === 'onboard';
    if (ring.current) ring.current.visible = isSel && st.view !== 'onboard';
    if (label.current) {
      const dist = camera.position.distanceTo(g.position);
      const sc = Math.max(0.55, Math.min(3.2, dist / 320));
      label.current.scale.setScalar(sc);
      label.current.visible =
        !onboardSelf && (st.view === 'overview' || isSel || dist < 450);
    }
  });

  return (
    <group ref={group} onClick={(e) => { e.stopPropagation(); select(driver.number); }}>
      <CarBody color={driver.color} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[4.4, 5.4, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
      </mesh>
      <group ref={label}>
        <Billboard position={[0, 9, 0]}>
          <Text
            fontSize={7}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.55}
            outlineColor="#000000"
            fontWeight="bold"
          >
            {driver.abbrev}
          </Text>
          <mesh position={[0, -4.6, 0]}>
            <planeGeometry args={[16, 1.1]} />
            <meshBasicMaterial color={driver.color} />
          </mesh>
        </Billboard>
      </group>
    </group>
  );
}

export default function Cars({ race, world }: { race: RaceData; world: World }) {
  return (
    <group>
      {race.drivers.map((d) => (
        <Car key={d.number} race={race} world={world} driver={d} />
      ))}
    </group>
  );
}
