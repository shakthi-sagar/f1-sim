import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import type { Driver, RaceData } from '../../types';
import { sampleCar, type World } from '../../lib/telemetry';
import { clock, useStore } from '../../store';

const CAR_SCALE = 1.7; // visual exaggeration so cars read from overview

let blobTex: THREE.CanvasTexture | null = null;
function getBlobTexture(): THREE.CanvasTexture {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  return blobTex;
}

function Wheel({ x, z, tire, rim }: { x: number; z: number; tire: THREE.Material; rim: THREE.Material }) {
  return (
    <group position={[x, 0.46, z]}>
      <mesh material={tire} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.46, 0.46, 0.42, 18]} />
      </mesh>
      <mesh material={rim} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.28, 0.28, 0.44, 14]} />
      </mesh>
    </group>
  );
}

function CarBody({ color }: { color: string }) {
  const mats = useMemo(() => {
    const body = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.32,
      metalness: 0.25,
      emissive: color,
      emissiveIntensity: 0.12,
    });
    const carbon = new THREE.MeshStandardMaterial({ color: '#16171c', roughness: 0.55, metalness: 0.35 });
    const tire = new THREE.MeshStandardMaterial({ color: '#242830', roughness: 0.9 });
    const rim = new THREE.MeshStandardMaterial({ color: '#b9bfc9', roughness: 0.3, metalness: 0.85 });
    const helmet = new THREE.MeshStandardMaterial({
      color: '#e8e8e8',
      roughness: 0.25,
      metalness: 0.1,
    });
    return { body, carbon, tire, rim, helmet };
  }, [color]);

  return (
    <group scale={CAR_SCALE}>
      {/* floor */}
      <mesh material={mats.carbon} position={[0, 0.14, -0.1]}>
        <boxGeometry args={[1.85, 0.09, 4.6]} />
      </mesh>

      {/* chassis centre section */}
      <mesh material={mats.body} position={[0, 0.46, 0.55]} castShadow>
        <boxGeometry args={[0.85, 0.52, 2.2]} />
      </mesh>
      {/* sidepods, tapering rear */}
      <mesh material={mats.body} position={[0, 0.42, -0.45]} castShadow>
        <boxGeometry args={[1.55, 0.44, 1.5]} />
      </mesh>
      <mesh material={mats.body} position={[0, 0.38, -1.35]}>
        <boxGeometry args={[1.05, 0.34, 0.9]} />
      </mesh>

      {/* nose cone */}
      <mesh material={mats.body} position={[0, 0.42, 1.85]} rotation-x={-Math.PI / 2} castShadow>
        <coneGeometry args={[0.24, 1.5, 12]} />
      </mesh>

      {/* engine cover + shark fin */}
      <mesh material={mats.body} position={[0, 0.78, -0.55]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.3, 2.2, 10]} />
      </mesh>
      <mesh material={mats.carbon} position={[0, 0.98, -1.45]}>
        <boxGeometry args={[0.05, 0.42, 1.0]} />
      </mesh>

      {/* halo */}
      <mesh material={mats.carbon} position={[0, 0.88, 0.62]} rotation-x={-0.15}>
        <torusGeometry args={[0.38, 0.05, 8, 18, Math.PI]} />
      </mesh>
      <mesh material={mats.carbon} position={[0, 0.75, 0.95]}>
        <cylinderGeometry args={[0.04, 0.05, 0.4, 8]} />
      </mesh>
      {/* helmet */}
      <mesh material={mats.helmet} position={[0, 0.72, 0.5]}>
        <sphereGeometry args={[0.19, 12, 10]} />
      </mesh>

      {/* front wing: main plane, flap, endplates */}
      <mesh material={mats.carbon} position={[0, 0.16, 2.55]} castShadow>
        <boxGeometry args={[2.0, 0.05, 0.62]} />
      </mesh>
      <mesh material={mats.body} position={[0, 0.27, 2.68]} rotation-x={0.35}>
        <boxGeometry args={[1.9, 0.04, 0.3]} />
      </mesh>
      {[-0.99, 0.99].map((x) => (
        <mesh key={x} material={mats.body} position={[x, 0.3, 2.55]}>
          <boxGeometry args={[0.05, 0.32, 0.62]} />
        </mesh>
      ))}

      {/* rear wing: beam, main plane, DRS flap, endplates */}
      <mesh material={mats.carbon} position={[0, 0.72, -2.1]}>
        <boxGeometry args={[1.35, 0.05, 0.35]} />
      </mesh>
      <mesh material={mats.body} position={[0, 1.06, -2.15]}>
        <boxGeometry args={[1.45, 0.06, 0.42]} />
      </mesh>
      <mesh material={mats.body} position={[0, 1.2, -2.28]} rotation-x={0.45}>
        <boxGeometry args={[1.4, 0.04, 0.26]} />
      </mesh>
      {[-0.76, 0.76].map((x) => (
        <mesh key={x} material={mats.carbon} position={[x, 0.95, -2.15]}>
          <boxGeometry args={[0.05, 0.62, 0.66]} />
        </mesh>
      ))}

      {/* wheels */}
      <Wheel x={-0.92} z={1.55} tire={mats.tire} rim={mats.rim} />
      <Wheel x={0.92} z={1.55} tire={mats.tire} rim={mats.rim} />
      <Wheel x={-0.92} z={-1.7} tire={mats.tire} rim={mats.rim} />
      <Wheel x={0.92} z={-1.7} tire={mats.tire} rim={mats.rim} />
    </group>
  );
}

function Car({ race, world, driver }: { race: RaceData; world: World; driver: Driver }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const brakeMat = useRef<THREE.MeshStandardMaterial>(null);
  const select = useStore((s) => s.select);

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g) return;
    const s = sampleCar(race, world, driver, clock.t);
    if (!s) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(s.x, s.y + 0.15, s.z);
    // framerate-independent damped heading to avoid jitter at low speed
    const cur = g.rotation.y;
    let delta = s.heading - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    g.rotation.y = cur + delta * (1 - Math.exp(-dt * 12));

    if (brakeMat.current) {
      brakeMat.current.emissiveIntensity = s.brake ? 4 : 0.12;
    }

    const st = useStore.getState();
    const isSel = st.selected === driver.number;
    const onboardSelf = isSel && st.view === 'onboard';
    if (ring.current) ring.current.visible = isSel && st.view !== 'onboard';
    if (label.current) {
      const dist = camera.position.distanceTo(g.position);
      const overview = st.view === 'overview';
      // overview: labels grow with distance so they stay readable;
      // camera views: labels shrink near the camera so they don't fill the screen
      const sc = overview
        ? Math.max(0.55, Math.min(3.2, dist / 320))
        : Math.max(0.22, Math.min(0.8, dist / 620));
      label.current.scale.setScalar(sc);
      label.current.visible = !onboardSelf && (overview || isSel || dist < 380);
    }
  });

  return (
    <group ref={group} onClick={(e) => { e.stopPropagation(); select(driver.number); }}>
      <CarBody color={driver.color} />
      {/* soft contact shadow to separate the car from the asphalt */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <planeGeometry args={[9, 9]} />
        <meshBasicMaterial map={getBlobTexture()} transparent depthWrite={false} />
      </mesh>
      {/* brake / rain light */}
      <mesh position={[0, 1.05 * CAR_SCALE, -1.92 * CAR_SCALE]}>
        <boxGeometry args={[0.3 * CAR_SCALE, 0.3 * CAR_SCALE, 0.12 * CAR_SCALE]} />
        <meshStandardMaterial
          ref={brakeMat}
          color="#4a0505"
          emissive="#ff2211"
          emissiveIntensity={0.12}
        />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.06}>
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
