/**
 * Preview art direction. Cinematic keeps the Pixar-style PBR preview.
 * Shaded keeps that lighting and swaps the finish pass for a graded, textured image.
 * Flat restyles the same meshes as a vector illustration: toon bands, solid skies,
 * an orthographic frame that matches the shot camera, cream characters.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';

export type Look = 'cinematic' | 'shaded' | 'flat';
export const LOOKS: Look[] = ['cinematic', 'shaded', 'flat'];
export const LOOK_LABEL: Record<Look, string> = { cinematic: 'Pixar', shaded: 'Shaded', flat: 'Flat' };
export const LOOK_KEY = 'fm.look';
const LOOK_EVENT = 'fm-look';

export function readLook(): Look {
  const stored = localStorage.getItem(LOOK_KEY);
  return stored === 'flat' || stored === 'shaded' ? stored : 'cinematic';
}

/** Shared with the timeline monitor, the character lineup, and environment previews. */
export function useLook(): [Look, (look: Look) => void] {
  const [look, set] = useState<Look>(readLook);
  useEffect(() => {
    const on = () => set(readLook());
    window.addEventListener(LOOK_EVENT, on);
    return () => window.removeEventListener(LOOK_EVENT, on);
  }, []);
  const setLook = (next: Look) => {
    localStorage.setItem(LOOK_KEY, next);
    set(next);
    window.dispatchEvent(new Event(LOOK_EVENT));
  };
  return [look, setLook];
}

export const FLAT = {
  blue: '#2489F5',
  lightBlue: '#65B5FF',
  pale: '#D7EAFF',
  navy: '#0B1936',
  deep: '#153B73',
  white: '#FFFDF5',
  yellow: '#FFD12F',
  warm: '#FF9564',
  sky: '#F4F9FF',
} as const;

let gradient: THREE.DataTexture | undefined;

/** Three hard bands so MeshToonMaterial does not smooth into a gradient. */
export function toonGradient() {
  if (gradient) return gradient;
  const data = new Uint8Array([
    0xb4, 0xc8, 0xe6, 255,
    0xe4, 0xee, 0xf8, 255,
    0xff, 0xff, 0xff, 255,
  ]);
  gradient = new THREE.DataTexture(data, 3, 1);
  gradient.magFilter = THREE.NearestFilter;
  gradient.minFilter = THREE.NearestFilter;
  gradient.colorSpace = THREE.SRGBColorSpace;
  gradient.needsUpdate = true;
  return gradient;
}

export function isDarkHex(hex?: string) {
  if (!hex) return true;
  const c = new THREE.Color(hex);
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 < 0.28;
}

const FACE = /eye|mouth|brow|shine/;

/** Replace PBR materials with flat toon or basic fills. Characters become cream mascots. */
export function stylizeFlat(obj: THREE.Object3D, role: 'character' | 'set') {
  const bands = toonGradient();
  obj.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((src) => flatMaterial(src as THREE.MeshStandardMaterial, mesh.name, role, bands));
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

function flatMaterial(src: THREE.MeshStandardMaterial, name: string, role: 'character' | 'set', bands: THREE.DataTexture) {
  const face = FACE.test(name);
  const color = new THREE.Color();
  if (role === 'character' && face) color.set(src.color?.getHexString() ? `#${src.color.getHexString()}` : '#111111');
  else if (role === 'character') color.set(FLAT.white);
  else if (src.color) color.copy(src.color);
  else color.set(FLAT.lightBlue);
  if (src.transparent && src.opacity < 0.92) {
    return new THREE.MeshBasicMaterial({
      color: role === 'set' ? new THREE.Color(FLAT.lightBlue) : color,
      transparent: true,
      opacity: Math.min(0.45, src.opacity),
      depthWrite: false,
      side: src.side,
    });
  }
  if (face) return new THREE.MeshBasicMaterial({ color, side: src.side });
  const toon = new THREE.MeshToonMaterial({ color, gradientMap: bands, side: src.side });
  if (role === 'character') {
    toon.emissive = new THREE.Color(FLAT.pale);
    toon.emissiveIntensity = 0.08;
  } else if (src.emissive && src.emissiveIntensity > 0.15) {
    toon.emissive = new THREE.Color(FLAT.lightBlue);
    toon.emissiveIntensity = 0.35;
  }
  return toon;
}

export function contactShadow() {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({ color: '#0B1936', transparent: true, opacity: 0.18, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.name = 'contact';
  return mesh;
}

/** Body points the speed-force arcs jump between. Local metres on Mili. */
const SPARK_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0.48, 0.02],
  [-0.1, 0.36, 0],
  [0.1, 0.36, 0],
  [0, 0.24, 0.05],
  [-0.14, 0.16, 0.06],
  [0.16, 0.14, 0.02],
  [-0.05, 0.05, 0.02],
  [0.06, 0.04, -0.02],
];

const BOLT_COUNT = 16;
const BOLT_SEGS = 7;

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ribbon(points: THREE.Vector3[], halfWidth: number, positions: Float32Array) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(n - 1, i + 1)]!;
    let px = -(next.y - prev.y);
    let py = next.x - prev.x;
    let pz = (next.z - prev.z) * 0.25;
    const len = Math.hypot(px, py, pz) || 1;
    const w = halfWidth * (i === 0 || i === n - 1 ? 0.15 : 1);
    const o = i * 6;
    positions[o] = points[i]!.x + (px / len) * w;
    positions[o + 1] = points[i]!.y + (py / len) * w;
    positions[o + 2] = points[i]!.z + (pz / len) * w;
    positions[o + 3] = points[i]!.x - (px / len) * w;
    positions[o + 4] = points[i]!.y - (py / len) * w;
    positions[o + 5] = points[i]!.z - (pz / len) * w;
  }
}

/**
 * Animated speed-force arcs around Mili. Idle: a short crackle every few seconds.
 * Running: always on, denser, and trailing behind her.
 */
export function lightningTrail() {
  const g = new THREE.Group();
  g.name = 'trail';
  const coreMat = new THREE.MeshBasicMaterial({
    color: '#fff6c8',
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: '#ffb02a',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const bolts = Array.from({ length: BOLT_COUNT }, () => {
    const positions = new Float32Array((BOLT_SEGS + 1) * 2 * 3);
    const index = new Uint16Array(BOLT_SEGS * 6);
    for (let i = 0; i < BOLT_SEGS; i++) {
      const a = i * 2;
      const b = a + 2;
      const o = i * 6;
      index[o] = a;
      index[o + 1] = b;
      index[o + 2] = a + 1;
      index[o + 3] = a + 1;
      index[o + 4] = b;
      index[o + 5] = b + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const glowGeo = geo.clone();
    const core = new THREE.Mesh(geo, coreMat);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    core.renderOrder = 10;
    glow.renderOrder = 9;
    core.frustumCulled = false;
    glow.frustumCulled = false;
    core.visible = false;
    glow.visible = false;
    g.add(glow, core);
    return { positions, glowPositions: glowGeo.getAttribute('position').array as Float32Array, geo, glowGeo, core, glow };
  });
  const scratch: THREE.Vector3[] = Array.from({ length: BOLT_SEGS + 1 }, () => new THREE.Vector3());
  const body = SPARK_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));

  g.userData.tick = (now: number, running: boolean) => {
    const cycle = 3.6;
    const burst = (now % cycle) < 0.32;
    const on = running || burst;
    if (!on) {
      for (const b of bolts) {
        b.core.visible = false;
        b.glow.visible = false;
      }
      return;
    }
    const count = running ? BOLT_COUNT : 6;
    const reach = running ? 0.42 : 0.22;
    const flicker = 0.75 + Math.sin(now * 48) * 0.25;
    coreMat.opacity = flicker;
    glowMat.opacity = 0.45 + flicker * 0.3;
    for (let i = 0; i < bolts.length; i++) {
      const bolt = bolts[i]!;
      if (i >= count) {
        bolt.core.visible = false;
        bolt.glow.visible = false;
        continue;
      }
      const seed = i * 17.3 + Math.floor(now * (running ? 14 : 9));
      const from = body[Math.floor(hash01(seed) * body.length)]!;
      const other = body[Math.floor(hash01(seed + 8) * body.length)]!;
      const side = i % 2 === 0 ? 1 : -1;
      const to = new THREE.Vector3();
      if (!running || i < 8) {
        // Jump to a nearby body point, then kick the end out past the silhouette
        // so the arc reads from the front of the character page.
        to.lerpVectors(from, other, 0.65);
        to.x += side * (0.12 + hash01(seed + 1) * reach);
        to.y += (hash01(seed + 2) - 0.35) * reach;
        to.z += 0.06 + hash01(seed + 3) * 0.16;
      } else {
        to.set(
          from.x + side * hash01(seed + 4) * 0.22,
          Math.max(0.02, from.y + (hash01(seed + 5) - 0.2) * 0.3),
          from.z - 0.2 - hash01(seed + 6) * 0.55,
        );
      }
      if (to.distanceTo(from) < 0.1) to.x += side * 0.18;
      for (let s = 0; s <= BOLT_SEGS; s++) {
        const t = s / BOLT_SEGS;
        const p = scratch[s]!;
        p.lerpVectors(from, to, t);
        if (s > 0 && s < BOLT_SEGS) {
          const amp = Math.sin(t * Math.PI) * (running ? 0.09 : 0.06);
          const wobble = Math.sin(now * 55 + seed + s * 2.1);
          p.x += (hash01(seed + s) - 0.5) * 2 * amp + wobble * amp * 0.65;
          p.y += (hash01(seed + s + 3) - 0.5) * 2 * amp;
          p.z += (hash01(seed + s + 6) - 0.5) * amp;
        }
      }
      ribbon(scratch, running ? 0.022 : 0.016, bolt.positions);
      ribbon(scratch, running ? 0.05 : 0.034, bolt.glowPositions);
      bolt.geo.attributes.position!.needsUpdate = true;
      bolt.glowGeo.attributes.position!.needsUpdate = true;
      bolt.geo.computeBoundingSphere();
      bolt.glowGeo.computeBoundingSphere();
      bolt.core.visible = true;
      bolt.glow.visible = true;
    }
  };
  return g;
}
