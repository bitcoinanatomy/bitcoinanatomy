/**
 * Preview art direction. Cinematic keeps the Pixar-style PBR preview.
 * Flat uses illustrated materials, white characters, and a disc shadow.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';

export type Look = 'cinematic' | 'flat';
export const LOOKS: Look[] = ['cinematic', 'flat'];
export const LOOK_LABEL: Record<Look, string> = { cinematic: 'Pixar', flat: 'Flat' };
export const LOOK_KEY = 'fm.look';
const LOOK_EVENT = 'fm-look';

export function readLook(): Look {
  const stored = localStorage.getItem(LOOK_KEY);
  return stored === 'flat' ? stored : 'cinematic';
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

/** Softened blue family with warm accents (cream cores, warm-white character tops). */
export const FLAT = {
  blue: '#4A86D8',
  lightBlue: '#8EBBEA',
  pale: '#DCE8F6',
  navy: '#0E1630',
  deep: '#1C2F5C',
  white: '#FFFFFF',
  yellow: '#FFE2A8',
  warm: '#FFB98A',
  sky: '#F2F6FB',
} as const;

/** World-space key direction shared by every illustrated material. */
export const illustratedKey = { value: new THREE.Vector3(0.32, 0.86, 0.4).normalize() };

/** Max glowing objects that light the painted world at once (nearest/biggest win each frame). */
export const GLOW_SLOTS = 8;

/**
 * The painted world's light, as plain colours. Dark worlds are lit by their glows; light worlds by the sky.
 * SceneView fills one per environment; character cards use the defaults.
 */
export interface FlatPalette {
  skyTop: string;
  horizon: string;
  /** what lit faces multiply by */
  light: string;
  /** what faces turned from the key multiply by: a hue shift, not just darker */
  shade: string;
  /** nothing in the frame goes below this */
  ink: string;
  /** dark navy albedo the black set pieces get repainted with */
  set: string;
  floor: string;
  glass: string;
  glassRim: string;
  /** distance haze 0..1 */
  haze: number;
  hazeNear: number;
  hazeFar: number;
  /** 0..1 procedural stars in the sky */
  stars: number;
  /** multiplier on the glow lights */
  glow: number;
}

export const FLAT_DARK: FlatPalette = {
  skyTop: '#050A1C', horizon: '#173470', light: '#E6EEFF', shade: '#262C6E', ink: '#070C20', set: '#24489A', floor: '#183B82',
  glass: '#4A92F0', glassRim: '#E2F3FF', haze: 0.35, hazeNear: 22, hazeFar: 110, stars: 0.7, glow: 1,
};
export const FLAT_LIGHT: FlatPalette = {
  skyTop: '#7FB2EC', horizon: '#E4EFFB', light: '#FFF9F0', shade: '#7F8CCB', ink: '#3E4D86', set: '#D3E0F2', floor: '#DCE6F3',
  glass: '#4D93EC', glassRim: '#F2F9FF', haze: 0.3, hazeNear: 25, hazeFar: 130, stars: 0, glow: 0.6,
};

const col = (hex: string) => new THREE.Color(hex);
/** Shared by every illustrated material; SceneView copies its own state in before each frame. */
export const flatUniforms = {
  uKeyDir: illustratedKey,
  uSkyTop: { value: col(FLAT_DARK.skyTop) },
  uHorizon: { value: col(FLAT_DARK.horizon) },
  uLight: { value: col(FLAT_DARK.light) },
  uShade: { value: col(FLAT_DARK.shade) },
  uInk: { value: col(FLAT_DARK.ink) },
  uGlass: { value: col(FLAT_DARK.glass) },
  uGlassRim: { value: col(FLAT_DARK.glassRim) },
  uHaze: { value: new THREE.Vector3(0, 6, 46) },
  uGlowPos: { value: Array.from({ length: GLOW_SLOTS }, () => new THREE.Vector4()) },
  uGlowCol: { value: Array.from({ length: GLOW_SLOTS }, () => new THREE.Vector4()) },
  uGlowCount: { value: 0 },
};

/** Point the shared uniforms at a palette. `haze` false for close-up cards (no distance to fade). */
export function applyFlatPalette(p: FlatPalette, haze = true) {
  const u = flatUniforms;
  u.uSkyTop.value.set(p.skyTop);
  u.uHorizon.value.set(p.horizon);
  u.uLight.value.set(p.light);
  u.uShade.value.set(p.shade);
  u.uInk.value.set(p.ink);
  u.uGlass.value.set(p.glass);
  u.uGlassRim.value.set(p.glassRim);
  u.uHaze.value.set(haze ? p.haze : 0, p.hazeNear, p.hazeFar);
}

const FLAT_VERTEX = `
  #include <project_vertex>
  vFlatWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FLAT_COMMON = `
  uniform vec3 uKeyDir; uniform vec3 uSkyTop; uniform vec3 uHorizon; uniform vec3 uLight; uniform vec3 uShade; uniform vec3 uInk;
  uniform vec3 uGlass; uniform vec3 uGlassRim; uniform vec3 uHaze;
  uniform vec4 uGlowPos[${GLOW_SLOTS}]; uniform vec4 uGlowCol[${GLOW_SLOTS}]; uniform int uGlowCount;
  varying vec3 vFlatWorld;
  // soft light from the glowing objects; wrap 1 lights faces turned away too
  vec3 flatGlow(vec3 p, vec3 wn, float wrap) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${GLOW_SLOTS}; i++) {
      if (i >= uGlowCount) break;
      vec3 L = uGlowPos[i].xyz - p;
      float d = max(length(L), 1e-3);
      float r = uGlowPos[i].w;
      float x = max(d - r, 0.0) / (r * 2.2 + 0.4);
      float nl = mix(max(dot(wn, L / d), 0.0), dot(wn, L / d) * 0.5 + 0.5, wrap);
      sum += uGlowCol[i].rgb * uGlowCol[i].w * nl / (1.0 + x * x * 3.0);
    }
    return sum;
  }
  vec3 flatHaze(vec3 c, float amount) {
    float dist = length(vFlatWorld - cameraPosition);
    float far = smoothstep(uHaze.y, uHaze.z, dist);
    // low-lying haze: the ground melts into the horizon before the sky does
    float low = exp(-max(vFlatWorld.y, 0.0) / 3.0) * smoothstep(uHaze.y * 0.5, uHaze.z, dist) * 0.12;
    // a deeper horizon, so silhouettes stay darker than the sky behind them
    return mix(c, uHorizon * 0.62, clamp((far + low) * uHaze.x * amount, 0.0, 1.0));
  }
`;

// cel step with a slightly soft, painted edge
const CEL = `
  float cel(float x, float edge) { return smoothstep(edge - 0.035, edge + 0.035, x); }
`;

const FLAT_FRAGMENT = `
  vec3 n = normalize(normal);
  vec3 vd = normalize(vViewPosition);
  vec3 wn = normalize((vec4(n, 0.0) * viewMatrix).xyz);
  float facing = clamp(abs(dot(n, vd)), 0.0, 1.0);
  float key = dot(wn, uKeyDir) * 0.5 + 0.5;
  vec3 albedo = diffuseColor.rgb;
  vec3 c;
  #ifdef ILLUSTRATED_CHARACTER
    // white clay: two tones with a crisp lavender terminator, a glow rim on the edge
    float lit = cel(key, 0.42);
    c = mix(vec3(0.72, 0.76, 0.94), vec3(0.93, 0.925, 0.91), lit) * albedo;
    vec3 bounce = flatGlow(vFlatWorld, wn, 0.8);
    float rim = cel(1.0 - facing, 0.72) * min(1.0, dot(bounce, vec3(0.4)));
    c = mix(c, vec3(0.92, 0.96, 1.0), rim * 0.8);
    c = min(c, vec3(0.93));
    c = flatHaze(c, 0.4);
  #elif defined(ILLUSTRATED_GLASS)
    // bubble: solid blue fill lighter at the top, bright rim line, crisp highlight strokes
    float top = n.y * 0.5 + 0.5;
    c = mix(uGlass * 0.7, min(uGlass * 1.12, vec3(0.95)), smoothstep(0.2, 0.9, top));
    float edge = 1.0 - facing;
    c = mix(c, min(uGlass * 1.2 + 0.04, vec3(0.98)), cel(edge, 0.66) * 0.55);
    c = mix(c, uGlassRim * 1.25, cel(edge, 0.9));
    vec2 dir = normalize(vec2(-0.6, 0.8));
    float side = dot(normalize(n.xy + 1e-4), dir);
    float stroke = cel(edge, 0.5) * (1.0 - cel(edge, 0.7)) * cel(side, 0.8);
    float dash = cel(dot(n, normalize(vec3(0.42, -0.35, 0.84))), 0.975);
    c = mix(c, uGlassRim * 0.95, max(stroke, dash * 0.8) * 0.8);
    diffuseColor.a = mix(0.82, 1.0, cel(edge, 0.62));
    c = flatHaze(c, 0.5);
  #else
    // sets and floors: three cel tones (lit tops, mid faces, navy sides) and stepped pools of glow light
    float t = 0.5 * cel(key, 0.52) + 0.5 * cel(key, 0.84);
    c = albedo * mix(uShade, uLight, t);
    vec3 g = flatGlow(vFlatWorld, wn, 0.1);
    float gl = dot(g, vec3(0.333));
    vec3 hue = g / max(gl, 1e-3) * 0.333;
    float pool = 0.5 * cel(gl, 0.25) + 0.5 * cel(gl, 0.7);
    c += (albedo * 1.6 + 0.04) * hue * pool;
    c = max(c, uInk);
    c = flatHaze(c, 1.0);
  #endif
  outgoingLight = c;
`;

/** Unlit glow (emissive props): stays bright but still sinks into the haze. Additive glows fade out instead. */
const GLOW_FRAGMENT = `
  #ifdef GLOW_ADDITIVE
    outgoingLight *= 1.0 - length(flatHaze(vec3(0.0), 0.8)) / max(length(uHorizon * 0.62), 1e-3);
    // light shafts: bright at the base, gone by the top
    outgoingLight *= exp(-max(vFlatWorld.y, 0.0) / 6.0);
  #else
    outgoingLight = flatHaze(outgoingLight, 0.55);
  #endif
`;

function paintShader(mat: THREE.Material, fragment: string) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flatUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlatWorld;')
      .replace('#include <project_vertex>', FLAT_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FLAT_COMMON}\n${CEL}`)
      .replace('#include <opaque_fragment>', `${fragment}\n#include <opaque_fragment>`);
  };
}

function illustratedPaint(color: THREE.Color, side: THREE.Side, kind: 'character' | 'floor' | 'glass' | 'set') {
  const glass = kind === 'glass';
  // toon only for its normal/view varyings: the fragment replaces all of three's lighting
  const mat = new THREE.MeshToonMaterial({ color, side, transparent: glass, depthWrite: !glass, fog: false });
  mat.userData.illustrated = true;
  const define = kind === 'character' ? 'ILLUSTRATED_CHARACTER' : kind === 'floor' ? 'ILLUSTRATED_FLOOR' : glass ? 'ILLUSTRATED_GLASS' : '';
  if (define) mat.defines = { [define]: 1 };
  mat.customProgramCacheKey = () => `painted-${kind}`;
  paintShader(mat, FLAT_FRAGMENT);
  return mat;
}

function glowMaterial(color: THREE.Color, side: THREE.Side, opacity = 1) {
  const additive = opacity < 0.95;
  const mat = new THREE.MeshBasicMaterial({
    color, side, toneMapped: true, fog: false,
    // opaque cores are still 'transparent' so they sort after (and draw over) the bubble around them
    transparent: true, opacity: additive ? opacity * 0.6 : 1,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive,
  });
  mat.userData.illustrated = true;
  if (additive) mat.defines = { GLOW_ADDITIVE: 1 };
  mat.customProgramCacheKey = () => `painted-glow-${additive}`;
  paintShader(mat, GLOW_FRAGMENT);
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

/** Painted look: soft gradients that shift blue in shadow, light from the glows, haze. Characters read as white clay. */
export function stylizeFlat(obj: THREE.Object3D, role: 'character' | 'set', palette: FlatPalette = FLAT_DARK) {
  obj.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map((src) => illustratedMaterial(src as THREE.MeshStandardMaterial, mesh.name, role, palette));
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
    if (next.some((m) => m.userData.glow && (m as THREE.Material).blending === THREE.NormalBlending)) mesh.renderOrder = 2;
  });
}

/**
 * What a painted material contributes as a light (`userData.glow`): colour and strength.
 * SceneView turns these into the glow slots.
 */
export interface GlowSource { color: THREE.Color; strength: number }

function illustratedMaterial(src: THREE.MeshStandardMaterial, name: string, role: 'character' | 'set', palette: FlatPalette) {
  if (src?.userData?.illustrated) return src;
  const face = FACE.test(name);
  const side = src?.side ?? THREE.FrontSide;
  if (face) {
    const ink = new THREE.MeshBasicMaterial({ color: src?.color ? `#${src.color.getHexString()}` : '#141820', side });
    ink.userData.illustrated = true;
    return ink;
  }
  const emissive = src?.emissive && src.emissive.getHex() !== 0 ? src.emissive.clone().multiplyScalar(Math.min(src.emissiveIntensity, 4)) : null;
  const translucent = !!src?.transparent && (src.opacity ?? 1) < 0.92;
  if (role !== 'character' && emissive && (src.emissiveIntensity > 1.5 || (translucent && src.emissiveIntensity > 0.5))) {
    // cores glow above white so they bloom; translucent shafts add
    // transaction cubes read as flat cream paint; beacons, rings and strips glow past white so they bloom
    const c = translucent ? src.emissive.clone() : name === 'tx' ? src.emissive.clone().lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(1.05) : src.emissive.clone().multiplyScalar(1.6);
    const glow = glowMaterial(c, side, translucent ? src.opacity : 1);
    glow.userData.glow = { color: src.emissive.clone(), strength: translucent ? 0.1 : Math.min(1.5, src.emissiveIntensity * 0.3) } satisfies GlowSource;
    return glow;
  }
  const floor = role !== 'character' && FLOOR_NAME.test(name);
  const glass = role !== 'character' && !floor && (GLASS_NAME.test(name) || translucent);
  const color = new THREE.Color();
  if (role === 'character') color.set(FLAT.white);
  else if (glass) color.set(palette.glass);
  else if (floor) {
    color.copy(src?.color ?? new THREE.Color(palette.floor));
    if (isDarkHex(`#${color.getHexString()}`)) color.set(palette.floor);
  } else if (src?.color) {
    color.copy(src.color);
    // in dark worlds set pieces become navy silhouettes (keeping a hint of their hue); black ones fully
    if (isDarkHex(palette.skyTop)) color.lerp(new THREE.Color(palette.set), isDarkHex(`#${color.getHexString()}`) ? 0.85 : 0.75);
  } else color.set(FLAT.lightBlue);
  const kind = role === 'character' ? 'character' : floor ? 'floor' : glass ? 'glass' : 'set';
  const mat = illustratedPaint(color, side, kind);
  if (glass) mat.userData.glow = { color: new THREE.Color(palette.glassRim).lerp(new THREE.Color(palette.glass), 0.4), strength: 0.5 } satisfies GlowSource;
  return mat;
}

/** Painted sky: deep top, glowing horizon matched to the haze, soft fixed stars. Drawn at the far plane around the camera. */
export function paintedSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSkyTop: flatUniforms.uSkyTop, uHorizon: flatUniforms.uHorizon, uStars: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uSkyTop; uniform vec3 uHorizon; uniform float uStars; varying vec3 vDir;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uSkyTop, pow(smoothstep(-0.02, 0.6, up), 0.7));
        // stars on a lat-long grid, fewer near the horizon
        vec2 uv = vec2(atan(d.z, d.x) * 60.0, asin(clamp(d.y, -1.0, 1.0)) * 60.0);
        vec2 cell = floor(uv);
        vec2 f = fract(uv) - 0.5 - (vec2(h21(cell), h21(cell + 7.3)) - 0.5) * 0.7;
        float star = step(0.93, h21(cell + 1.7)) * smoothstep(0.16, 0.0, length(f)) * h21(cell + 3.1);
        c += star * uStars * smoothstep(0.08, 0.4, up) * vec3(0.85, 0.92, 1.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  sky.name = 'painted_sky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** Soft oval on the ground. `radius` is half the character's width. Not parented to the body, so hops do not lift it. */
export function contactShadow(radius = 0.42) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.ShaderMaterial({
      uniforms: { uInk: flatUniforms.uInk },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uInk; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uInk * 0.7, 0.5 * (1.0 - smoothstep(0.35, 1.0, r))); }`,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(radius * 1.25, radius * 0.7, 1);
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
