import { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import type { RaceData } from '../../types';
import { toWorld, type World } from '../../lib/telemetry';

const TRACK_HALF_W = 6.5; // metres
const EDGE_W = 0.9;

type P3 = [number, number, number];

function smoothPts(pts: P3[], win = 2): P3[] {
  const out: P3[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sz = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      const j = (i + k + n) % n;
      sx += pts[j][0];
      sy += pts[j][1];
      sz += pts[j][2];
      c++;
    }
    out.push([sx / c, sy / c, sz / c]);
  }
  return out;
}

/** Build a flat ribbon following `pts` (closed loop if closed=true). */
function buildRibbon(pts: P3[], inner: number, outer: number, yLift: number, closed: boolean): THREE.BufferGeometry {
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[2] - prev[2];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const nx = -tz;
    const nz = tx;
    const p = pts[i];
    positions.set([p[0] + nx * inner, p[1] + yLift, p[2] + nz * inner], i * 6);
    positions.set([p[0] + nx * outer, p[1] + yLift, p[2] + nz * outer], i * 6 + 3);
    if (i < n - 1 || closed) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Short ribbon segment crossing the track at pts[idx] — for start line / sector marks. */
function crossBar(pts: P3[], idx: number, halfW: number, length: number, yLift: number): THREE.BufferGeometry {
  const n = pts.length;
  const p = pts[idx];
  const prev = pts[(idx - 1 + n) % n];
  const next = pts[(idx + 1) % n];
  let tx = next[0] - prev[0];
  let tz = next[2] - prev[2];
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;
  const nx = -tz;
  const nz = tx;
  const geo = new THREE.BufferGeometry();
  const h = length / 2;
  const positions = new Float32Array([
    p[0] - tx * h + nx * halfW, p[1] + yLift, p[2] - tz * h + nz * halfW,
    p[0] - tx * h - nx * halfW, p[1] + yLift, p[2] - tz * h - nz * halfW,
    p[0] + tx * h + nx * halfW, p[1] + yLift, p[2] + tz * h + nz * halfW,
    p[0] + tx * h - nx * halfW, p[1] + yLift, p[2] + tz * h - nz * halfW,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

function nearestIdx(pts: P3[], wx: number, wz: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i][0] - wx) ** 2 + (pts[i][2] - wz) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

const SECTOR_COLORS = ['#ff3b3b', '#4d8dff', '#ffd12e'];

export default function TrackMesh({ race, world }: { race: RaceData; world: World }) {
  const built = useMemo(() => {
    const raw = race.track.centerline.map(([x, y, z]) => toWorld(world, x, y, z));
    raw.pop(); // drop duplicated closing point
    const pts = smoothPts(raw, 2);

    const asphalt = buildRibbon(pts, -TRACK_HALF_W, TRACK_HALF_W, 0, true);
    const edgeL = buildRibbon(pts, TRACK_HALF_W, TRACK_HALF_W + EDGE_W, 0.06, true);
    const edgeR = buildRibbon(pts, -TRACK_HALF_W - EDGE_W, -TRACK_HALF_W, 0.06, true);
    const startLine = crossBar(pts, 0, TRACK_HALF_W, 2.4, 0.09);

    const sectorBars = race.track.sectors.map(([sx, sy], i) => {
      const [wx, , wz] = toWorld(world, sx, sy, world.zMin);
      return { geo: crossBar(pts, nearestIdx(pts, wx, wz), TRACK_HALF_W, 1.4, 0.08), color: SECTOR_COLORS[i + 1] };
    });

    // corner labels, pushed outward from the track
    const centroid = pts.reduce((a, p) => [a[0] + p[0], a[1], a[2] + p[2]], [0, 0, 0] as P3);
    centroid[0] /= pts.length;
    centroid[2] /= pts.length;
    const corners = race.track.corners.map((c) => {
      const [wx, , wz] = toWorld(world, c.x, c.y, world.zMin);
      const i = nearestIdx(pts, wx, wz);
      const py = pts[i][1];
      let dx = wx - centroid[0];
      let dz = wz - centroid[2];
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      return {
        n: `${c.n}${c.letter}`,
        pos: [wx + dx * 22, py + 0.5, wz + dz * 22] as P3,
      };
    });

    let pitGeo: THREE.BufferGeometry | null = null;
    if (race.track.pitlane.length > 5) {
      const ppts = race.track.pitlane.map(([x, y, z]) => toWorld(world, x, y, z));
      pitGeo = buildRibbon(smoothPts(ppts, 2), -2.6, 2.6, -0.04, false);
    }

    return { pts, asphalt, edgeL, edgeR, startLine, sectorBars, corners, pitGeo };
  }, [race, world]);

  return (
    <group>
      {/* ground */}
      <mesh rotation-x={-Math.PI / 2} position-y={-1.5} receiveShadow>
        <planeGeometry args={[world.radius * 8, world.radius * 8]} />
        <meshStandardMaterial color="#0b0e13" />
      </mesh>

      {built.pitGeo && (
        <mesh geometry={built.pitGeo}>
          <meshStandardMaterial color="#1c2028" roughness={0.95} />
        </mesh>
      )}

      <mesh geometry={built.asphalt} receiveShadow>
        <meshStandardMaterial color="#484d56" roughness={0.85} metalness={0} />
      </mesh>
      <mesh geometry={built.edgeL}>
        <meshStandardMaterial color="#d8d8dc" roughness={0.6} />
      </mesh>
      <mesh geometry={built.edgeR}>
        <meshStandardMaterial color="#d8d8dc" roughness={0.6} />
      </mesh>
      <mesh geometry={built.startLine}>
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {built.sectorBars.map((s, i) => (
        <mesh key={i} geometry={s.geo}>
          <meshBasicMaterial color={s.color} transparent opacity={0.85} />
        </mesh>
      ))}

      {built.corners.map((c, i) => (
        <Text
          key={i}
          position={c.pos}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={9}
          color="#5a6070"
          anchorX="center"
          anchorY="middle"
        >
          {c.n}
        </Text>
      ))}
    </group>
  );
}
