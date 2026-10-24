/**
 * Preview art direction. Cinematic keeps the Pixar-style PBR preview.
 * Shaded keeps that lighting and swaps the finish pass for a graded, textured image.
 * Flat uses the same illustrated materials, white characters, and a disc shadow.
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
  white: '#FFFFFF',
  yellow: '#FFD12F',
  warm: '#FF9564',
  sky: '#F4F9FF',
} as const;

/** World-space key direction shared by every illustrated material. */
export const illustratedKey = { value: new THREE.Vector3(0.32, 0.86, 0.4).normalize() };

function ramp(stops: number[]) {
  const tex = new THREE.DataTexture(new Uint8Array(stops), stops.length, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Plateaus with soft steps. Characters stay near white. Sets keep form. Floors stay matte. */
const SOFT_RAMP = ramp([232, 238, 244, 250, 253, 255, 255, 255]);
const FORM_RAMP = ramp([150, 170, 196, 220, 236, 246, 252, 255]);
const FLOOR_RAMP = ramp([214, 222, 232, 242, 248, 252, 255, 255]);

const ILLUSTRATED_SNIPPET = `
  vec3 n = normalize(normal);
  vec3 vd = normalize(vViewPosition);
  vec3 keyV = normalize(mat3(viewMatrix) * uKeyDir);
  float fres = pow(1.0 - clamp(dot(n, vd), 0.0, 1.0), 2.4);
  vec3 halfV = normalize(keyV + vd);
  float spec = pow(clamp(dot(n, halfV), 0.0, 1.0), mix(28.0, 80.0, uGloss));
  float luma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  #ifdef ILLUSTRATED_CHARACTER
    outgoingLight = mix(vec3(0.84, 0.9, 0.99), vec3(1.0), smoothstep(0.32, 0.88, luma));
    outgoingLight += fres * vec3(0.05, 0.07, 0.1);
  #elif defined(ILLUSTRATED_FLOOR)
    outgoingLight = mix(outgoingLight, vec3(0.9, 0.94, 0.99), 0.35);
  #elif defined(ILLUSTRATED_GLASS)
    outgoingLight = mix(outgoingLight * vec3(0.55, 0.75, 1.15), outgoingLight, smoothstep(0.12, 0.6, luma));
    outgoingLight += uRim * fres;
    outgoingLight += spec * vec3(1.05, 1.03, 0.98);
    diffuseColor.a = mix(0.5, 0.92, fres);
    outgoingLight += vec3(0.2, 0.45, 0.9) * (1.0 - fres) * 0.22;
  #else
    outgoingLight = mix(outgoingLight * vec3(0.72, 0.82, 1.05), outgoingLight, smoothstep(0.15, 0.62, luma));
    outgoingLight += uRim * fres * 0.35;
  #endif
`;

function illustratedToon(color: THREE.Color, side: THREE.Side, rampTex: THREE.DataTexture, kind: 'character' | 'floor' | 'glass' | 'set') {
  const glass = kind === 'glass';
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: rampTex,
    side,
    transparent: glass,
    opacity: glass ? 0.78 : 1,
    depthWrite: !glass,
  });
  mat.userData.illustrated = true;
  const define = kind === 'character' ? 'ILLUSTRATED_CHARACTER' : kind === 'floor' ? 'ILLUSTRATED_FLOOR' : kind === 'glass' ? 'ILLUSTRATED_GLASS' : '';
  if (define) mat.defines = { [define]: 1 };
  mat.customProgramCacheKey = () => `illustrated-${kind}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uKeyDir = illustratedKey;
    shader.uniforms.uGloss = { value: glass ? 1 : 0 };
    shader.uniforms.uRim = { value: new THREE.Color(glass ? '#eaf4ff' : '#f4f8ff') };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uKeyDir;
         uniform float uGloss;
         uniform vec3 uRim;`,
      )
      .replace('#include <opaque_fragment>', `${ILLUSTRATED_SNIPPET}\n#include <opaque_fragment>`);
  };
  return mat;
}

export function isDarkHex(hex?: string) {
  if (!hex) return true;
  const c = new THREE.Color(hex);
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 < 0.28;
}

const FACE = /eye|mouth|brow|shine/;

const GLASS_NAME = /bubble|glass|sphere|orb/;
const FLOOR_NAME = /floor|ground|sea|deck|plaza|dais/;

/** Soft 3-tone toon, cool shadows, a rim, and a restrained specular. Characters read as white. */
export function stylizeFlat(obj: THREE.Object3D, role: 'character' | 'set') {
  obj.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((src) => illustratedMaterial(src as THREE.MeshStandardMaterial, mesh.name, role));
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

function illustratedMaterial(src: THREE.MeshStandardMaterial, name: string, role: 'character' | 'set') {
  if (src?.userData?.illustrated) return src;
  const face = FACE.test(name);
  const side = src?.side ?? THREE.FrontSide;
  if (face) {
    const ink = new THREE.MeshBasicMaterial({
      color: src?.color ? `#${src.color.getHexString()}` : '#141820',
      side,
    });
    ink.userData.illustrated = true;
    return ink;
  }
  if (src?.emissive && src.emissiveIntensity > 1.5 && src.emissive.getHex() !== 0) {
    const glow = new THREE.MeshBasicMaterial({ color: src.emissive, toneMapped: false, side });
    glow.userData.illustrated = true;
    return glow;
  }
  const floor = role !== 'character' && FLOOR_NAME.test(name);
  const glass = role !== 'character' && !floor && (GLASS_NAME.test(name) || (!!src?.transparent && (src.opacity ?? 1) < 0.92));
  const color = new THREE.Color();
  if (role === 'character') color.set(FLAT.white);
  else if (glass) color.set('#3b8cff');
  else if (floor) {
    color.copy(src?.color ?? new THREE.Color('#d5e6fb'));
    if (isDarkHex(`#${color.getHexString()}`)) color.lerp(new THREE.Color('#16325f'), 0.45);
  }
  else if (src?.color) color.copy(src.color);
  else color.set(FLAT.lightBlue);
  const kind = role === 'character' ? 'character' : floor ? 'floor' : glass ? 'glass' : 'set';
  const rampTex = kind === 'character' ? SOFT_RAMP : kind === 'floor' ? FLOOR_RAMP : FORM_RAMP;
  return illustratedToon(color, side, rampTex, kind);
}

/** Soft oval on the ground. `radius` is half the character's width. Not parented to the body, so hops do not lift it. */
export function contactShadow(radius = 0.42) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: '#0B1936', transparent: true, opacity: 0.22, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(radius * 1.05, radius * 0.55, 1);
  mesh.position.y = 0.012;
  mesh.name = 'contact';
  mesh.renderOrder = 1;
  return mesh;
}

/** Keep the disc flat on the floor under a character, ignoring lift, lean, and squash. */
export function plantShadow(shadow: THREE.Object3D, x: number, groundY: number, z: number) {
  shadow.position.set(x, groundY + 0.012, z);
  shadow.rotation.set(-Math.PI / 2, 0, 0);
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
