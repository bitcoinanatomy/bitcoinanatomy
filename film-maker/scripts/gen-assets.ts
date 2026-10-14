/**
 * Generates placeholder media for the test project:
 *   project/media/meshes/*.glb   (glTF 2.0, PBR metal-rough — three.js + Blender)
 *   project/media/textures/grid.png
 *   project/media/audio/sfx/*.wav (procedural, CC0)
 * Deterministic: re-running produces identical files.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { encodeWav } from '../src/audio/wav';
import { mulberry32 } from '../src/score/compose';
import { PROJECT_DIR } from '../server/projectFs';
import { encodePng, writeGlb } from './lib/glb';

export const write = (rel: string, bytes: Uint8Array) => {
  const p = path.join(PROJECT_DIR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  console.log('  wrote', rel, `${(bytes.byteLength / 1024).toFixed(1)} KB`);
};

export const merge = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos, false)!;
export const placed = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
  return g;
};

export function genTextures() {
  const N = 256;
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const line = x % 32 < 2 || y % 32 < 2;
      const major = x % 128 < 3 || y % 128 < 3;
      const v = major ? 255 : line ? 140 : 18;
      const i = (y * N + x) * 4;
      px.set([v * 0.97, v * 0.6, v * 0.15, 255], i);
    }
  const png = encodePng(N, N, px);
  write('media/textures/grid.png', png);
  return png;
}

export function genMeshes() {
  const grid = genTextures();

  // A bitcoin node: dark chassis + glowing white screen with UI bars + status LED
  const screenUI = merge([
    placed(new THREE.BoxGeometry(1.3, 0.06, 0.01), 0, 0.22, 0.081),
    placed(new THREE.BoxGeometry(0.9, 0.04, 0.01), -0.2, 0.08, 0.081),
    placed(new THREE.BoxGeometry(1.1, 0.04, 0.01), -0.1, -0.04, 0.081),
    placed(new THREE.BoxGeometry(0.6, 0.04, 0.01), -0.35, -0.16, 0.081),
  ]);
  write('media/meshes/node_box.glb', writeGlb('node_box', [
    { name: 'chassis', geometry: placed(new THREE.BoxGeometry(1.6, 0.8, 0.14)), material: { name: 'chassis', color: [0.04, 0.04, 0.05], roughness: 0.35, metallic: 0.6 } },
    { name: 'screen', geometry: placed(new THREE.PlaneGeometry(1.45, 0.65), 0, 0, 0.0705), material: { name: 'screen', color: [0.9, 0.92, 1], emissive: [0.85, 0.9, 1], emissiveStrength: 1.5 } },
    { name: 'ui', geometry: screenUI, material: { name: 'ui', color: [0.1, 0.1, 0.12], roughness: 0.8 } },
    { name: 'led', geometry: placed(new THREE.SphereGeometry(0.025, 12, 8), 0.68, -0.3, 0.085), material: { name: 'led', color: [1, 0.55, 0.1], emissive: [1, 0.55, 0.1], emissiveStrength: 4 } },
  ]));

  // Network sphere: nodes on an icosphere joined by thin links
  const ico = new THREE.IcosahedronGeometry(2.4, 2);
  const p = ico.getAttribute('position');
  const verts: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(',');
  const seen = new Map<string, number>();
  const edges = new Set<string>();
  const idx = (i: number) => {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = key(v);
    if (!seen.has(k)) {
      seen.set(k, verts.length);
      verts.push(v);
    }
    return seen.get(k)!;
  };
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [idx(i), idx(i + 1), idx(i + 2)];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edges.add(x < y ? `${x}-${y}` : `${y}-${x}`);
  }
  const nodes = merge(verts.map((v) => placed(new THREE.SphereGeometry(0.07, 10, 6), v.x, v.y, v.z)));
  const up = new THREE.Vector3(0, 1, 0);
  const links = merge(
    [...edges].map((e) => {
      const [a, b] = e.split('-').map(Number);
      const va = verts[a];
      const vb = verts[b];
      const len = va.distanceTo(vb);
      const g = new THREE.CylinderGeometry(0.008, 0.008, len, 4, 1, true);
      const q = new THREE.Quaternion().setFromUnitVectors(up, vb.clone().sub(va).normalize());
      g.applyQuaternion(q);
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      return g.translate(mid.x, mid.y, mid.z);
    }),
  );
  write('media/meshes/network_sphere.glb', writeGlb('network_sphere', [
    { name: 'peers', geometry: nodes, material: { name: 'peer', color: [1, 0.6, 0.15], emissive: [1, 0.55, 0.1], emissiveStrength: 2 } },
    { name: 'links', geometry: links, material: { name: 'link', color: [0.5, 0.55, 0.7], emissive: [0.25, 0.3, 0.45] } },
  ]));

  // Gold bar (trapezoid prism)
  const bar = new THREE.CylinderGeometry(0.7, 1, 0.35, 4, 1);
  bar.rotateY(Math.PI / 4).scale(1, 1, 0.45).translate(0, 0.175, 0);
  const barFlat = bar.toNonIndexed(); // flat shading for the hard edges
  barFlat.computeVertexNormals();
  write('media/meshes/gold_bar.glb', writeGlb('gold_bar', [
    { name: 'bar', geometry: barFlat, material: { name: 'gold', color: [1, 0.76, 0.33], metallic: 1, roughness: 0.25 } },
  ]));

  // Coin
  const coin = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 48);
  coin.rotateX(Math.PI / 2);
  write('media/meshes/coin.glb', writeGlb('coin', [
    { name: 'coin', geometry: coin, material: { name: 'coin', color: [0.97, 0.58, 0.1], metallic: 1, roughness: 0.3 } },
  ]));

  // Floor with the procedural grid texture (tests texture round-trip)
  const floor = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2);
  const uv = floor.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 10);
  write('media/meshes/grid_floor.glb', writeGlb('grid_floor', [
    { name: 'floor', geometry: floor, material: { name: 'grid', color: [1, 1, 1], roughness: 0.9, texture: grid } },
  ]));
}

export function genSfx() {
  const sr = 44100;
  const rnd = mulberry32(1234);
  const make = (name: string, seconds: number, fn: (t: number, i: number) => number) => {
    const n = Math.floor(seconds * sr);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = fn(i / sr, i);
    write(`media/audio/sfx/${name}.wav`, encodeWav([buf], sr));
  };
  let lp = 0;
  make('whoosh', 1.6, (t) => {
    const env = Math.sin(Math.PI * Math.min(1, t / 1.6)) ** 2;
    const k = 0.02 + 0.2 * env;
    lp += k * (rnd() * 2 - 1 - lp);
    return lp * env * 1.6;
  });
  make('blip', 0.25, (t) => Math.sin(2 * Math.PI * (880 + 440 * (t < 0.08 ? 0 : 1)) * t) * Math.exp(-t * 18) * 0.5);
  make('ping', 1.4, (t) =>
    (Math.sin(2 * Math.PI * 1318.5 * t) * 0.6 + Math.sin(2 * Math.PI * 1975.5 * t) * 0.3) * Math.exp(-t * 4) * Math.min(1, t * 400) * 0.45);
  make('impact', 1.8, (t) => {
    const ph = 2 * Math.PI * (40 * t + (60 / 12) * (1 - Math.exp(-t * 12)));
    return (Math.sin(ph) * Math.exp(-t * 3) + (rnd() * 2 - 1) * Math.exp(-t * 25) * 0.4) * 0.8;
  });
  lp = 0;
  make('hum', 4, (t) => {
    lp += 0.01 * (rnd() * 2 - 1 - lp);
    const env = Math.min(1, t / 0.5) * Math.min(1, (4 - t) / 0.5);
    return (Math.sin(2 * Math.PI * 55 * t) * 0.3 + Math.sin(2 * Math.PI * 110.4 * t) * 0.15 + lp * 0.5) * env;
  });
  make('click', 0.08, (t) => (rnd() * 2 - 1) * Math.exp(-t * 120) * 0.7);
  make('coin_drop', 1.2, (t) => {
    const hits = [0, 0.22, 0.38, 0.5, 0.58];
    let s = 0;
    hits.forEach((h, i) => {
      if (t >= h) s += Math.sin(2 * Math.PI * 3100 * (t - h)) * Math.exp(-(t - h) * 18) * (1 - i * 0.15);
    });
    return s * 0.35;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  genMeshes();
  genSfx();
}
