/**
 * Procedural placeholder media for the Mili · Sati · Bit story:
 *   characters (glowing white sphere-headed figures), light-city and dark-world set
 *   pieces, protocol props, a marble texture and SFX. All glTF 2.0 / WAV, deterministic.
 */
import * as THREE from 'three';
import { encodeWav } from '../src/audio/wav';
import { mulberry32 } from '../src/score/compose';
import { encodePng, writeGlb, type GlbMaterial, type GlbPart } from './lib/glb';
import { merge, placed, write } from './gen-assets';

// ---------------------------------------------------------------- materials

const SKIN: GlbMaterial = { name: 'glow_skin', color: [1, 0.97, 0.93], roughness: 0.55, emissive: [1, 0.86, 0.68], emissiveStrength: 0.45 };
const EYE: GlbMaterial = { name: 'eye', color: [0.015, 0.012, 0.012], roughness: 0.08 };
const SHINE: GlbMaterial = { name: 'eye_shine', color: [1, 1, 1], emissive: [1, 1, 1], emissiveStrength: 2 };
const LINE: GlbMaterial = { name: 'face_line', color: [0.12, 0.08, 0.07], roughness: 0.6 };
const MARBLE: GlbMaterial = { name: 'marble', color: [0.93, 0.92, 0.9], roughness: 0.35 };
const OBSIDIAN: GlbMaterial = { name: 'obsidian', color: [0.018, 0.018, 0.022], roughness: 0.22, metallic: 0.35 };
const GLASS: GlbMaterial = { name: 'glass', color: [0.86, 0.9, 1], roughness: 0.04, metallic: 0.1, opacity: 0.22 };

const sphere = (r: number, x = 0, y = 0, z = 0, w = 32, h = 20) => placed(new THREE.SphereGeometry(r, w, h), x, y, z);
const capsule = (r: number, len: number, x = 0, y = 0, z = 0, rz = 0, rx = 0) => placed(new THREE.CapsuleGeometry(r, len, 6, 16), x, y, z, rx, 0, rz);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => placed(new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry);

// ---------------------------------------------------------------- characters

interface Build {
  headR: number;
  headY: number;
  eye: number; // eye radius as a fraction of the head
  eyeSpread: number;
  body: THREE.BufferGeometry[];
  /** limbs are separate nodes pivoting at the shoulder / hip so the preview can animate them */
  arms: Limb;
  legs: Limb;
  brows?: 'determined' | 'soft';
  smile?: number; // smile width as a fraction of the head
  extra?: GlbPart[];
}

/**
 * Face parts are separate nodes, each pivoting about its own centre, so the preview can
 * pose expressions: eye_l/eye_r (+ shine_l/shine_r sharing the eye pivot), brow_l/brow_r, mouth.
 */
function face(b: Build) {
  const { headR: R, headY: Y } = b;
  const parts: GlbPart[] = [];
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'l' : 'r';
    const dir = new THREE.Vector3(side * b.eyeSpread, 0.08, 1).normalize();
    const p = dir.clone().multiplyScalar(R * 0.97);
    const er = R * b.eye;
    const g = new THREE.SphereGeometry(er, 20, 14).scale(0.82, 1.08, 0.45);
    g.lookAt(dir);
    const at: [number, number, number] = [p.x, Y + p.y, p.z];
    parts.push({ name: `eye_${s}`, geometry: g, material: EYE, translation: at });
    parts.push({ name: `shine_${s}`, geometry: sphere(er * 0.28, side * er * 0.25, er * 0.4, er * 0.35, 10, 8), material: SHINE, translation: at });
    if (b.brows) {
      const tilt = b.brows === 'determined' ? -side * 0.35 : side * 0.12;
      parts.push({ name: `brow_${s}`, geometry: placed(new THREE.CapsuleGeometry(R * 0.035, er * 1.1, 4, 8), 0, 0, 0, 0, 0, Math.PI / 2 + tilt), material: LINE, translation: [p.x, Y + p.y + er * 1.55, p.z * 0.98] });
    }
  }
  if (b.smile) {
    const sw = R * b.smile;
    const g = new THREE.TorusGeometry(sw, R * 0.028, 6, 20, Math.PI * 0.8);
    g.rotateZ(Math.PI + Math.PI * 0.1);
    // pivot on the arc itself, so flipping Y turns the smile into a frown in place
    g.translate(0, sw * 0.65, 0);
    const at: [number, number, number] = [0, Y - R * 0.18 + sw * 0.6 - sw * 0.65, R * 0.93];
    parts.push({ name: 'mouth', geometry: g, material: LINE, translation: at });
    // Extra shapes from the mouth sheet. The preview scales these to 0 unless the expression needs them.
    const hole = new THREE.SphereGeometry(sw * 0.7, 18, 12).scale(1.2, 0.95, 0.32);
    parts.push({ name: 'mouth_open', geometry: hole, material: { name: 'mouth_hole', color: [0.06, 0.035, 0.03], roughness: 0.9 }, translation: [at[0], at[1] - sw * 0.02, at[2] + R * 0.015] });
    const tongue = new THREE.SphereGeometry(sw * 0.36, 12, 8).scale(0.65, 1.2, 0.4);
    parts.push({ name: 'mouth_tongue', geometry: tongue, material: { name: 'tongue', color: [0.86, 0.4, 0.45], roughness: 0.45 }, translation: [at[0], at[1] - sw * 0.42, at[2] + R * 0.03] });
    const teeth = merge([-1.5, -0.5, 0.5, 1.5].map((i) => box(sw * 0.16, sw * 0.2, sw * 0.07, i * sw * 0.22, sw * 0.22, 0)));
    parts.push({ name: 'mouth_teeth', geometry: teeth, material: { name: 'teeth', color: [0.97, 0.96, 0.93], roughness: 0.3 }, translation: [at[0], at[1], at[2] + R * 0.02] });
  }
  return parts;
}

/** A pair of limbs: pivot at [±x, y, z], hanging `len` metres, splayed outward by `splay` rad, with an optional round end (hand/foot). */
interface Limb { at: [number, number, number]; r: number; len: number; splay?: number; end?: number }

/** Tapered bone hanging from its origin (y = 0) down to y = -len. Thicker at the top. */
function taperedBone(rTop: number, rBot: number, len: number) {
  const h = Math.max(0.001, len);
  const cyl = new THREE.CylinderGeometry(rTop, rBot, h, 12);
  cyl.translate(0, -h / 2, 0);
  const capTop = new THREE.SphereGeometry(rTop, 12, 8);
  const capBot = new THREE.SphereGeometry(rBot, 12, 8).translate(0, -h, 0);
  return merge([cyl, capTop, capBot]);
}

/**
 * Two-bone limbs. The shoulder/hip node keeps the old name and pivots there; the forearm
 * or shin is a child whose origin is the elbow or knee, so the preview can bend it.
 * Splay is baked into both segments so the rest pose still hangs outward.
 */
function limbs(kind: 'arm' | 'leg', l: Limb, mat: GlbMaterial): GlbPart[] {
  return [-1, 1].flatMap((side) => {
    const s = side < 0 ? 'l' : 'r';
    const ang = side * (l.splay ?? 0);
    const upper = l.len * 0.52;
    const lower = l.len * 0.48;
    const r = l.r;
    const lowerParts = [taperedBone(r * 0.9, r * 0.58, lower)];
    if (l.end && kind === 'arm') lowerParts.push(sphere(l.end, 0, -lower + l.end * 0.45, 0, 16, 12));
    const elbow: [number, number, number] = [Math.sin(ang) * upper, -Math.cos(ang) * upper, 0];
    const ankle: [number, number, number] = [Math.sin(ang) * lower, -Math.cos(ang) * lower, 0];
    const upperName = `${kind}_${s}`;
    const lowerName = `${kind === 'arm' ? 'forearm' : 'shin'}_${s}`;
    const parts: GlbPart[] = [
      { name: upperName, geometry: taperedBone(r * 1.12, r * 0.92, upper).rotateZ(ang), material: mat, translation: [side * l.at[0], l.at[1], l.at[2]] },
      { name: lowerName, geometry: merge(lowerParts).rotateZ(ang), material: mat, translation: elbow, parent: upperName },
    ];
    // Feet are their own ankle joint: both point +Z and sit on the same sole, so a knee bend can be cancelled without yawing one foot out.
    if (kind === 'leg' && l.end) {
      const sole = l.end * 0.42;
      const foot = sphere(l.end, 0, -sole * 0.55, l.end * 0.2, 16, 12).scale(1.05, 0.42, 1.35);
      parts.push({ name: `foot_${s}`, geometry: foot, material: mat, translation: ankle, parent: lowerName });
    }
    return parts;
  });
}

function character(name: string, b: Build, skinMat = SKIN) {
  const neckR = b.headR * 0.28;
  const neck = capsule(neckR, b.headR * 0.42, 0, b.headY - b.headR * 0.78);
  const skin = merge([sphere(b.headR, 0, b.headY, 0, 48, 32), neck, ...b.body]);
  write(`media/meshes/${name}.glb`, writeGlb(name, [{ name: 'body', geometry: skin, material: skinMat }, ...limbs('arm', b.arms, skinMat), ...limbs('leg', b.legs, skinMat), ...face(b), ...(b.extra ?? [])]));
}

/** Generic background folk: dimmer, simpler glows so the trio stay the brightest thing in frame. */
const FOLK: GlbMaterial = { name: 'folk_skin', color: [0.86, 0.86, 0.88], roughness: 0.6, emissive: [0.8, 0.82, 0.9], emissiveStrength: 0.18 };

export function genExtras() {
  // tall and thin
  character('folk_tall', {
    headR: 0.2, headY: 1.12, eye: 0.13, eyeSpread: 0.32, smile: 0.2, brows: 'soft',
    body: [capsule(0.11, 0.55, 0, 0.62)],
    arms: { at: [0.12, 0.86, 0], r: 0.035, len: 0.44, splay: 0.16, end: 0.045 }, legs: { at: [0.07, 0.38, 0], r: 0.045, len: 0.38 },
  }, FOLK);
  // round and stout
  character('folk_round', {
    headR: 0.24, headY: 0.82, eye: 0.14, eyeSpread: 0.34, smile: 0.26, brows: 'soft',
    body: [new THREE.SphereGeometry(0.3, 32, 20).scale(1, 0.95, 0.9).translate(0, 0.4, 0)],
    arms: { at: [0.26, 0.55, 0], r: 0.06, len: 0.27, splay: 0.45 }, legs: { at: [0.12, 0.19, 0], r: 0.07, len: 0.19 },
  }, FOLK);
  // a little one
  character('folk_small', {
    headR: 0.17, headY: 0.42, eye: 0.17, eyeSpread: 0.36, smile: 0.28, brows: 'soft',
    body: [capsule(0.08, 0.12, 0, 0.2)],
    arms: { at: [0.075, 0.28, 0], r: 0.028, len: 0.14, splay: 0.55 }, legs: { at: [0.045, 0.11, 0], r: 0.035, len: 0.11 },
  }, FOLK);
}

export function genCharacters() {
  // Mili — smallest (~0.55m), big curious eyes, lightning trail
  const trail: THREE.BufferGeometry[] = [];
  const rnd = mulberry32(7);
  for (let k = 0; k < 3; k++) {
    let x = -0.12;
    let y = 0.2 + k * 0.1;
    for (let i = 0; i < 6; i++) {
      const nx = x - 0.07 - rnd() * 0.04;
      const ny = y + (i % 2 ? 0.05 : -0.05);
      const len = Math.hypot(nx - x, ny - y);
      const g = new THREE.CylinderGeometry(0.006, 0.006, len, 4);
      g.rotateZ(Math.atan2(ny - y, nx - x) - Math.PI / 2);
      trail.push(g.translate((x + nx) / 2, (y + ny) / 2, -0.15 - k * 0.03));
      x = nx;
      y = ny;
    }
  }
  character('mili', {
    headR: 0.22, headY: 0.33, eye: 0.19, eyeSpread: 0.36, smile: 0.32, brows: 'soft',
    body: [capsule(0.075, 0.08, 0, 0.15)],
    arms: { at: [0.09, 0.08, 0], r: 0.026, len: 0.07, splay: 0.35, end: 0.032 }, legs: { at: [0.04, 0.1, 0], r: 0.032, len: 0.1, end: 0.036 },
    extra: [{ name: 'lightning', geometry: merge(trail), material: { name: 'lightning', color: [1, 0.78, 0.45], emissive: [1, 0.7, 0.35], emissiveStrength: 4, opacity: 0.85 } }],
  });

  // Sati — the hero (~0.9m), steady eyes, determined brows
  character('sati', {
    headR: 0.32, headY: 0.58, eye: 0.15, eyeSpread: 0.34, brows: 'determined', smile: 0.18,
    body: [capsule(0.12, 0.14, 0, 0.27)],
    arms: { at: [0.15, 0.16, 0], r: 0.04, len: 0.12, splay: 0.22, end: 0.048 }, legs: { at: [0.06, 0.16, 0], r: 0.05, len: 0.16, end: 0.055 },
  });

  // Bit — the muscle (~2.1m), broad torso, huge arms, a big round head with small friendly eyes
  const torso = new THREE.SphereGeometry(0.42, 40, 28).scale(1.15, 1.05, 0.9).translate(0, 0.66, 0);
  character('bit', {
    headR: 0.6, headY: 1.5, eye: 0.12, eyeSpread: 0.3, smile: 0.3, brows: 'soft',
    body: [torso, sphere(0.2, -0.5, 0.86), sphere(0.2, 0.5, 0.86)],
    arms: { at: [0.56, 0.86, 0], r: 0.17, len: 0.66, splay: 0.16, end: 0.17 }, legs: { at: [0.2, 0.34, 0], r: 0.14, len: 0.34, end: 0.15 },
  });
}

// ---------------------------------------------------------------- sets & props

function marbleTexture() {
  const N = 512;
  const px = new Uint8Array(N * N * 4);
  const rnd = mulberry32(11);
  const veins = Array.from({ length: 6 }, () => ({ a: rnd() * 6, f: 2 + rnd() * 4, o: rnd() * N }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 236 + rnd() * 6;
      if (x % 128 < 2 || y % 128 < 2) v -= 26; // tile seams
      for (const w of veins) {
        const d = Math.abs(((x * Math.cos(w.a) + y * Math.sin(w.a) + Math.sin((x + y) / (40 * w.f)) * 30 + w.o) % 160) - 80);
        if (d < 1.2) v -= 14;
      }
      px.set([v, v, v - 3, 255], (y * N + x) * 4);
    }
  const png = encodePng(N, N, px);
  write('media/textures/marble.png', png);
  return png;
}

const edges = (w: number, h: number, d: number, t: number) => {
  const g: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) g.push(box(w + t, t, t, 0, (sy * h) / 2, (sz * d) / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.push(box(t, h + t, t, (sx * w) / 2, 0, (sz * d) / 2));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.push(box(t, t, d + t, (sx * w) / 2, (sy * h) / 2, 0));
  return merge(g);
};

export function genSets() {
  const tex = marbleTexture();
  const glb = (name: string, parts: GlbPart[]) => write(`media/meshes/${name}.glb`, writeGlb(name, parts));

  // light city
  const floor = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2);
  const uv = floor.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 16, uv.getY(i) * 16);
  glb('marble_floor', [{ name: 'floor', geometry: floor, material: { ...MARBLE, name: 'marble_tiles', texture: tex, roughness: 0.18 } }]);
  glb('marble_block', [{ name: 'block', geometry: box(1, 1, 1, 0, 0.5, 0), material: MARBLE }]);
  glb('marble_steps', [{ name: 'steps', geometry: merge([0, 1, 2, 3].map((i) => box(4, 0.25 * (i + 1), 1 - 0, 0, 0.125 * (i + 1), -i))), material: MARBLE }]);
  const archTop = new THREE.TorusGeometry(1.6, 0.35, 12, 40, Math.PI).translate(0, 3.2, 0);
  glb('arch', [{ name: 'arch', geometry: merge([box(0.7, 3.2, 0.7, -1.6, 1.6, 0), box(0.7, 3.2, 0.7, 1.6, 1.6, 0), archTop]), material: MARBLE }]);
  glb('tower', [{ name: 'tower', geometry: merge([box(2, 12, 2, 0, 6, 0), box(1.5, 3, 1.5, 0, 13.5, 0), box(0.8, 2, 0.8, 0, 16, 0), box(2.3, 0.2, 2.3, 0, 12, 0)]), material: MARBLE }]);
  glb('tree', [
    { name: 'trunk', geometry: placed(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 8), 0, 0.8, 0), material: { name: 'bark', color: [0.32, 0.25, 0.2], roughness: 0.9 } },
    { name: 'leaves', geometry: merge([sphere(0.7, 0, 1.9, 0, 12, 8), sphere(0.55, 0.45, 1.6, 0.2, 12, 8), sphere(0.5, -0.4, 1.7, -0.2, 12, 8)]), material: { name: 'leaves', color: [0.38, 0.56, 0.32], roughness: 0.8 } },
  ]);
  glb('glass_sphere', [{ name: 'glass', geometry: sphere(1, 0, 0, 0, 48, 32), material: GLASS }]);

  // dark world
  glb('obsidian_floor', [{ name: 'floor', geometry: new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), material: { ...OBSIDIAN, roughness: 0.12 } }]);
  glb('monolith', [{ name: 'monolith', geometry: box(1.6, 5, 1.6, 0, 2.5, 0), material: OBSIDIAN }]);
  glb('monolith_cube', [{ name: 'cube', geometry: box(2, 2, 2, 0, 1, 0), material: OBSIDIAN }]);
  glb('light_shaft', [{ name: 'shaft', geometry: placed(new THREE.CylinderGeometry(0.9, 1.4, 24, 32, 1, true), 0, 12, 0), material: { name: 'shaft', color: [1, 1, 1], emissive: [0.9, 0.95, 1], emissiveStrength: 1.5, opacity: 0.12, doubleSided: true } }]);
  const hex: THREE.BufferGeometry[] = [];
  const corner = (i: number, y: number) => new THREE.Vector3(Math.cos((i * Math.PI) / 3) * 0.8, y, Math.sin((i * Math.PI) / 3) * 0.8);
  const rod = (a: THREE.Vector3, b: THREE.Vector3) => {
    const g = new THREE.CylinderGeometry(0.025, 0.025, a.distanceTo(b), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    const m = a.clone().add(b).multiplyScalar(0.5);
    return g.translate(m.x, m.y, m.z);
  };
  for (let i = 0; i < 6; i++) {
    hex.push(rod(corner(i, 0), corner(i + 1, 0)), rod(corner(i, 1.6), corner(i + 1, 1.6)), rod(corner(i, 0), corner(i, 1.6)));
  }
  glb('hex_beacon', [
    { name: 'frame', geometry: merge(hex).translate(0, 0.4, 0), material: { name: 'beacon', color: [0.9, 0.95, 1], emissive: [0.75, 0.88, 1], emissiveStrength: 4 } },
    { name: 'core', geometry: sphere(0.22, 0, 1.2, 0), material: { name: 'beacon_core', color: [1, 1, 1], emissive: [0.85, 0.93, 1], emissiveStrength: 6 } },
  ]);

  // protocol props
  glb('tx_orb', [
    { name: 'orb', geometry: sphere(0.18), material: { name: 'tx', color: [1, 0.85, 0.55], emissive: [1, 0.72, 0.35], emissiveStrength: 4 } },
    { name: 'ring', geometry: new THREE.TorusGeometry(0.28, 0.012, 6, 48).rotateX(1.2), material: { name: 'tx_ring', color: [1, 0.9, 0.7], emissive: [1, 0.8, 0.5], emissiveStrength: 2 } },
  ]);
  glb('hash_block', [
    { name: 'block', geometry: box(1.2, 1.2, 1.2, 0, 0.6, 0), material: { ...OBSIDIAN, name: 'hash_block' } },
    { name: 'edges', geometry: edges(1.2, 1.2, 1.2, 0.03).translate(0, 0.6, 0), material: { name: 'hash_edges', color: [0.9, 0.95, 1], emissive: [0.6, 0.75, 1], emissiveStrength: 2.5 } },
  ]);
  glb('mempool_bubble', [
    { name: 'bubble', geometry: sphere(0.5, 0, 0, 0, 32, 20), material: { ...GLASS, name: 'bubble', opacity: 0.18 } },
    { name: 'tx', geometry: sphere(0.08), material: { name: 'bubble_tx', color: [1, 0.85, 0.55], emissive: [1, 0.72, 0.35], emissiveStrength: 3 } },
  ]);
}

// ---------------------------------------------------------------- sfx

export function genStorySfx() {
  const sr = 44100;
  const rnd = mulberry32(99);
  const make = (name: string, seconds: number, fn: (t: number) => number) => {
    const n = Math.floor(seconds * sr);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = Math.max(-1, Math.min(1, fn(i / sr)));
    write(`media/audio/sfx/${name}.wav`, encodeWav([buf], sr));
  };
  make('zap', 0.7, (t) => {
    const crackle = rnd() < 0.25 ? rnd() * 2 - 1 : 0;
    const f = 600 + 2400 * t;
    return (Math.sin(2 * Math.PI * f * t) * 0.3 + crackle * 0.5) * Math.exp(-t * 5) * Math.min(1, t * 200);
  });
  make('thud', 0.9, (t) => Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 18)) * t) * Math.exp(-t * 6) * 0.9 + (rnd() * 2 - 1) * Math.exp(-t * 40) * 0.25);
  make('chime', 2.5, (t) => [1, 2.76, 5.4].reduce((s, h, i) => s + Math.sin(2 * Math.PI * 784 * h * t) * Math.exp(-t * (1.5 + i)) / (i + 1), 0) * 0.35 * Math.min(1, t * 300));
  make('sparkle', 1.4, (t) => {
    let s = 0;
    for (let k = 0; k < 8; k++) {
      const at = k * 0.13;
      if (t > at) s += Math.sin(2 * Math.PI * (1800 + k * 310) * (t - at)) * Math.exp(-(t - at) * 14);
    }
    return s * 0.18;
  });
  let lp = 0;
  make('stone_grind', 2, (t) => {
    lp += 0.03 * (rnd() * 2 - 1 - lp);
    return lp * 2.4 * Math.sin(Math.PI * Math.min(1, t / 2)) * (0.7 + 0.3 * Math.sin(t * 40));
  });
  make('pulse', 2.4, (t) => Math.sin(2 * Math.PI * 110 * t) * Math.sin(Math.PI * t / 2.4) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) * 0.5);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  genCharacters();
  genExtras();
  genSets();
  genStorySfx();
}
