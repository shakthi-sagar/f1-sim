import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RaceData } from '../../types';
import { toWorld, type World } from '../../lib/telemetry';

/** OSM-derived surroundings: terrain, buildings, water, woods/parks, roads. */
interface EnvBuilding { p: number[][]; h: number; k: string; z: number }
interface EnvArea { p: number[][]; z: number; t?: number }
interface EnvRoad { p: number[][]; w: number; z: number }
interface EnvTerrain {
  x0: number; y0: number; dx: number; dy: number;
  nx: number; ny: number; z: number[];
}
interface EnvData {
  slug: string;
  fitResidual: number;
  terrain: EnvTerrain | null;
  buildings: EnvBuilding[];
  water: EnvArea[];
  green: EnvArea[];
  roads: EnvRoad[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Bilinear world-height lookup over the terrain grid (inputs in FastF1 dm). */
type HeightFn = (x: number, y: number) => number;

function makeHeightFn(terrain: EnvTerrain | null, world: World): HeightFn {
  if (!terrain) return () => -2;
  const { x0, y0, dx, dy, nx, ny, z } = terrain;
  return (x: number, y: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / dx));
    const fy = Math.max(0, Math.min(ny - 1.001, (y - y0) / dy));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ux = fx - ix;
    const uy = fy - iy;
    const v00 = z[iy * nx + ix];
    const v10 = z[iy * nx + ix + 1];
    const v01 = z[(iy + 1) * nx + ix];
    const v11 = z[(iy + 1) * nx + ix + 1];
    const zv = v00 * (1 - ux) * (1 - uy) + v10 * ux * (1 - uy) + v01 * (1 - ux) * uy + v11 * ux * uy;
    return (zv - world.zMin) / 10; // world metres
  };
}

function terrainGeometry(terrain: EnvTerrain, world: World): THREE.BufferGeometry {
  const { x0, y0, dx, dy, nx, ny, z } = terrain;
  const positions = new Float32Array(nx * ny * 3);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const fx = x0 + ix * dx;
      const fy = y0 + iy * dy;
      const [wx, , wz] = toWorld(world, fx, fy, world.zMin);
      const i = (iy * nx + ix) * 3;
      positions[i] = wx;
      positions[i + 1] = (z[iy * nx + ix] - world.zMin) / 10;
      positions[i + 2] = wz;
    }
  }
  const indices: number[] = [];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iy * nx + ix;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // FastF1 y maps to world -z, so wind CCW seen from +y
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Flat polygon draped per-vertex onto the terrain. */
function drapedAreaGeometry(
  areas: EnvArea[],
  world: World,
  height: HeightFn,
  lift: number,
  flatten: boolean,
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  areas.forEach((a, ai) => {
    if (a.p.length < 3) return;
    const shape = new THREE.Shape();
    a.p.forEach(([x, y], i) => {
      const [wx, , wz] = toWorld(world, x, y, world.zMin);
      if (i === 0) shape.moveTo(wx, -wz);
      else shape.lineTo(wx, -wz);
    });
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (flatten) {
      // water: one flat level per polygon (min terrain over the ring)
      let base = Infinity;
      for (const [x, y] of a.p) base = Math.min(base, height(x, y));
      for (let i = 0; i < pos.count; i++) pos.setY(i, base + lift);
    } else {
      for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i);
        const wz = pos.getZ(i);
        // back from world to FastF1 dm for the height lookup
        const fx = wx * 10 + world.cx;
        const fy = -wz * 10 + world.cy;
        pos.setY(i, height(fx, fy) + lift + ai * 0.015);
      }
    }
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}

function buildingGeometry(
  buildings: EnvBuilding[],
  world: World,
  height: HeightFn,
  kind: string,
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const b of buildings) {
    if ((b.k === 'grandstand') !== (kind === 'grandstand')) continue;
    if (b.p.length < 3) continue;
    const shape = new THREE.Shape();
    b.p.forEach(([x, y], i) => {
      const [wx, , wz] = toWorld(world, x, y, world.zMin);
      if (i === 0) shape.moveTo(wx, -wz);
      else shape.lineTo(wx, -wz);
    });
    shape.closePath();
    // ground the footprint on the lowest terrain point under it, sunk slightly
    let base = Infinity;
    for (const [x, y] of b.p) base = Math.min(base, height(x, y));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.h + 1.2, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base - 0.8, 0);
    geos.push(g);
  }
  if (!geos.length) return null;
  return mergeGeometries(geos);
}

function roadGeometry(roads: EnvRoad[], world: World, height: HeightFn): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const r of roads) {
    if (r.p.length < 2) continue;
    const pts = r.p.map(([x, y]) => {
      const [wx, , wz] = toWorld(world, x, y, world.zMin);
      return [wx, height(x, y) + 0.42, wz] as [number, number, number];
    });
    const n = pts.length;
    const half = r.w / 2;
    const positions = new Float32Array(n * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0];
      let tz = next[2] - prev[2];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz;
      const nz = tx;
      const p = pts[i];
      positions.set([p[0] + nx * half, p[1], p[2] + nz * half], i * 6);
      positions.set([p[0] - nx * half, p[1], p[2] - nz * half], i * 6 + 3);
      if (i < n - 1) {
        const a = i * 2;
        const b = a + 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(indices);
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  return merged;
}

/** Instanced low-poly trees scattered inside wooded polygons. */
function treeTransforms(green: EnvArea[], world: World, height: HeightFn, cap = 700): THREE.Matrix4[] {
  const wooded = green.filter((g) => g.t === 1);
  const out: THREE.Matrix4[] = [];
  const rng = (() => {
    let s = 1234567;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  const areas = wooded.map((g) => {
    const p = g.p;
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2) / 100; // m²
  });
  const totalArea = areas.reduce((a, b) => a + b, 0) || 1;

  for (let w = 0; w < wooded.length; w++) {
    const g = wooded[w];
    const count = Math.min(140, Math.round((areas[w] / totalArea) * cap));
    if (!count) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of g.p) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    let placed = 0;
    for (let tries = 0; tries < count * 8 && placed < count; tries++) {
      const x = minX + rng() * (maxX - minX);
      const y = minY + rng() * (maxY - minY);
      let inside = false;
      for (let i = 0, j = g.p.length - 1; i < g.p.length; j = i++) {
        const [xi, yi] = g.p[i];
        const [xj, yj] = g.p[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (!inside) continue;
      const [wx, , wz] = toWorld(world, x, y, world.zMin);
      const h = 7 + rng() * 8;
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(wx, height(x, y) + h / 2 - 0.4, wz),
        new THREE.Quaternion(),
        new THREE.Vector3(1 + rng() * 0.7, h / 10, 1 + rng() * 0.7),
      );
      out.push(m);
      placed++;
    }
  }
  return out;
}

export default function Environment({ race, world }: { race: RaceData; world: World }) {
  const [env, setEnv] = useState<EnvData | null>(null);

  useEffect(() => {
    let alive = true;
    setEnv(null);
    fetch(`data/env/${slugify(race.location)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setEnv(d))
      .catch(() => alive && setEnv(null));
    return () => {
      alive = false;
    };
  }, [race.location]);

  const built = useMemo(() => {
    if (!env) return null;
    const height = makeHeightFn(env.terrain ?? null, world);
    return {
      terrain: env.terrain ? terrainGeometry(env.terrain, world) : null,
      minY: env.terrain
        ? (Math.min(...env.terrain.z) - world.zMin) / 10
        : -2,
      buildings: buildingGeometry(env.buildings, world, height, 'building'),
      grandstands: buildingGeometry(env.buildings, world, height, 'grandstand'),
      water: drapedAreaGeometry(env.water, world, height, 0.18, true),
      green: drapedAreaGeometry(env.green, world, height, 0.22, false),
      roads: roadGeometry(env.roads, world, height),
      trees: treeTransforms(env.green, world, height),
    };
  }, [env, world]);

  const treeMesh = useMemo(() => {
    if (!built || built.trees.length === 0) return null;
    const geo = new THREE.ConeGeometry(3.4, 10, 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#2e6b39', roughness: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, built.trees.length);
    built.trees.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [built]);

  // distant horizon fill below/beyond the terrain patch
  const horizonY = built ? built.minY - 1.2 : -2;

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={horizonY}>
        <planeGeometry args={[world.radius * 14, world.radius * 14]} />
        <meshStandardMaterial color="#7f9c68" roughness={1} />
      </mesh>

      {built?.terrain && (
        <mesh geometry={built.terrain} receiveShadow>
          <meshStandardMaterial color="#84a06b" roughness={1} />
        </mesh>
      )}
      {built?.green && (
        <mesh geometry={built.green}>
          <meshStandardMaterial color="#5b9552" roughness={1} side={THREE.DoubleSide} />
        </mesh>
      )}
      {built?.water && (
        <mesh geometry={built.water}>
          <meshStandardMaterial color="#3f86c9" roughness={0.15} metalness={0.1} side={THREE.DoubleSide} />
        </mesh>
      )}
      {built?.roads && (
        <mesh geometry={built.roads}>
          <meshStandardMaterial color="#767b85" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
      {built?.buildings && (
        <mesh geometry={built.buildings} castShadow receiveShadow>
          <meshStandardMaterial color="#c3c7ce" roughness={0.85} flatShading />
        </mesh>
      )}
      {built?.grandstands && (
        <mesh geometry={built.grandstands} castShadow receiveShadow>
          <meshStandardMaterial color="#8a97b8" roughness={0.7} flatShading />
        </mesh>
      )}
      {treeMesh && <primitive object={treeMesh} />}
    </group>
  );
}
