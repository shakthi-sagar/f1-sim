import { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import type { RaceData } from '../../types';
import { toWorld, type World } from '../../lib/telemetry';

const TRACK_HALF_W = 6.5; // metres
const EDGE_W = 0.9;
const KERB_W = 1.4;
const GRASS_W = 26;

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

function tangentAt(pts: P3[], i: number, closed: boolean): [number, number] {
  const n = pts.length;
  const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  let tx = next[0] - prev[0];
  let tz = next[2] - prev[2];
  const len = Math.hypot(tx, tz) || 1;
  return [tx / len, tz / len];
}

/** Flat ribbon following `pts`, with UVs (u across, v = metres * vScale). */
function buildRibbon(
  pts: P3[],
  inner: number,
  outer: number,
  yLift: number,
  closed: boolean,
  vScale = 0.15,
): THREE.BufferGeometry {
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const [tx, tz] = tangentAt(pts, i, closed);
    const nx = -tz;
    const nz = tx;
    const p = pts[i];
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
    positions.set([p[0] + nx * inner, p[1] + yLift, p[2] + nz * inner], i * 6);
    positions.set([p[0] + nx * outer, p[1] + yLift, p[2] + nz * outer], i * 6 + 3);
    uvs.set([0, dist * vScale], i * 4);
    uvs.set([1, dist * vScale], i * 4 + 2);
    if (i < n - 1 || closed) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Short ribbon segment crossing the track at pts[idx] — for start line / sector marks. */
function crossBar(pts: P3[], idx: number, halfW: number, length: number, yLift: number): THREE.BufferGeometry {
  const n = pts.length;
  const p = pts[idx];
  const [tx, tz] = tangentAt(pts, idx, true);
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
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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

/** Contiguous index runs where the track curves tightly (for kerbs). */
function cornerRuns(pts: P3[]): number[][] {
  const n = pts.length;
  const sharp: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const [t0x, t0z] = tangentAt(pts, (i - 1 + n) % n, true);
    const [t1x, t1z] = tangentAt(pts, (i + 1) % n, true);
    const dot = Math.max(-1, Math.min(1, t0x * t1x + t0z * t1z));
    const dTheta = Math.acos(dot);
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const ds = Math.hypot(next[0] - prev[0], next[2] - prev[2]) || 1;
    if (dTheta / ds > 1 / 150) sharp[i] = true; // corner radius < ~150 m
  }
  // dilate by 2 points
  const dilated = sharp.slice();
  for (let i = 0; i < n; i++) {
    if (sharp[i]) {
      for (let k = -2; k <= 2; k++) dilated[(i + k + n) % n] = true;
    }
  }
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < n; i++) {
    if (dilated[i]) cur.push(i);
    else if (cur.length) {
      if (cur.length >= 3) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 3) runs.push(cur);
  return runs;
}

// ---------------------------------------------------------------- textures
function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4b5058';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 60 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeKerbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8352a';
  g.fillRect(0, 0, 8, 32);
  g.fillStyle = '#e8e6e0';
  g.fillRect(0, 32, 8, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// ---------------------------------------------------------------- sky dome
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = `
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 zenith = vec3(0.22, 0.45, 0.78);
  vec3 mid = vec3(0.60, 0.76, 0.92);
  vec3 horizon = vec3(0.94, 0.93, 0.86);
  vec3 col = mix(mid, zenith, smoothstep(0.08, 0.55, h));
  col = mix(horizon, col, smoothstep(0.0, 0.12, h));
  gl_FragColor = vec4(col, 1.0);
}`;

const SECTOR_COLORS = ['#ff3b3b', '#4d8dff', '#ffd12e'];

export default function TrackMesh({ race, world }: { race: RaceData; world: World }) {
  const built = useMemo(() => {
    const raw = race.track.centerline.map(([x, y, z]) => toWorld(world, x, y, z));
    raw.pop(); // drop duplicated closing point
    const pts = smoothPts(raw, 2);

    const grass = buildRibbon(pts, -GRASS_W, GRASS_W, -0.12, true);
    const asphalt = buildRibbon(pts, -TRACK_HALF_W, TRACK_HALF_W, 0, true, 1 / 9);
    const edgeL = buildRibbon(pts, TRACK_HALF_W, TRACK_HALF_W + EDGE_W, 0.05, true);
    const edgeR = buildRibbon(pts, -TRACK_HALF_W - EDGE_W, -TRACK_HALF_W, 0.05, true);
    const startLine = crossBar(pts, 0, TRACK_HALF_W, 3.2, 0.09);

    // kerbs on both edges through tight corners
    const kerbGeos: THREE.BufferGeometry[] = [];
    for (const run of cornerRuns(pts)) {
      const seg = run.map((i) => pts[i]);
      kerbGeos.push(buildRibbon(seg, TRACK_HALF_W + EDGE_W, TRACK_HALF_W + EDGE_W + KERB_W, 0.07, false, 1 / 6));
      kerbGeos.push(buildRibbon(seg, -TRACK_HALF_W - EDGE_W - KERB_W, -TRACK_HALF_W - EDGE_W, 0.07, false, 1 / 6));
    }

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
        pos: [wx + dx * 30, py + 0.5, wz + dz * 30] as P3,
      };
    });

    let pitGeo: THREE.BufferGeometry | null = null;
    if (race.track.pitlane.length > 5) {
      const ppts = race.track.pitlane.map(([x, y, z]) => toWorld(world, x, y, z));
      pitGeo = buildRibbon(smoothPts(ppts, 2), -2.6, 2.6, -0.04, false);
    }

    // start/finish gantry frame
    const p0 = pts[0];
    const [t0x, t0z] = tangentAt(pts, 0, true);
    const gantry = {
      pos: [p0[0], p0[1], p0[2]] as P3,
      rotY: Math.atan2(t0x, t0z),
      span: (TRACK_HALF_W + 2.5) * 2,
    };

    return { pts, grass, asphalt, edgeL, edgeR, startLine, kerbGeos, sectorBars, corners, pitGeo, gantry };
  }, [race, world]);

  const asphaltTex = useMemo(makeAsphaltTexture, []);
  const kerbTex = useMemo(makeKerbTexture, []);
  const checkerTex = useMemo(makeCheckerTexture, []);

  return (
    <group>
      {/* sky dome */}
      <mesh>
        <sphereGeometry args={[world.radius * 14, 32, 16]} />
        <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      {/* ground plane lives in Environment (it knows the terrain depth) */}

      {/* grass verge around the circuit — matches the terrain colour so it
          reads as continuous ground, not an outline */}
      <mesh geometry={built.grass} receiveShadow>
        <meshStandardMaterial color="#84a06b" roughness={1} />
      </mesh>

      {built.pitGeo && (
        <mesh geometry={built.pitGeo}>
          <meshStandardMaterial color="#71767f" roughness={0.95} />
        </mesh>
      )}

      <mesh geometry={built.asphalt} receiveShadow>
        <meshStandardMaterial map={asphaltTex} color="#c9ced8" roughness={0.78} metalness={0} />
      </mesh>
      <mesh geometry={built.edgeL}>
        <meshBasicMaterial color="#f4f6f8" />
      </mesh>
      <mesh geometry={built.edgeR}>
        <meshBasicMaterial color="#f4f6f8" />
      </mesh>

      {built.kerbGeos.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={kerbTex} roughness={0.7} />
        </mesh>
      ))}

      <mesh geometry={built.startLine}>
        <meshBasicMaterial map={checkerTex} />
      </mesh>
      {built.sectorBars.map((s, i) => (
        <mesh key={i} geometry={s.geo}>
          <meshBasicMaterial color={s.color} transparent opacity={0.85} />
        </mesh>
      ))}

      {/* start/finish gantry */}
      <group position={built.gantry.pos} rotation-y={built.gantry.rotY}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (built.gantry.span / 2), 4.5, 0]} castShadow>
            <cylinderGeometry args={[0.45, 0.55, 9, 10]} />
            <meshStandardMaterial color="#1c2028" roughness={0.6} metalness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 9.4, 0]} castShadow>
          <boxGeometry args={[built.gantry.span + 2, 1.9, 2.4]} />
          <meshStandardMaterial color="#1c2028" roughness={0.6} metalness={0.4} />
        </mesh>
        <mesh position={[0, 8.35, 0]} rotation-x={Math.PI / 2}>
          <planeGeometry args={[built.gantry.span + 2, 2.2]} />
          <meshBasicMaterial color="#fff6e8" />
        </mesh>
      </group>

      {built.corners.map((c, i) => (
        <Text
          key={i}
          position={c.pos}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={10}
          color="#2c3648"
          anchorX="center"
          anchorY="middle"
        >
          {c.n}
        </Text>
      ))}
    </group>
  );
}
