/**
 * Environments for the Mili · Sati · Bit story: procedural HDRI skies (Radiance .hdr, one per
 * mood), extra set-dressing meshes, and the environment definitions themselves.
 *
 *   npm run gen:envs     regenerate skies + set meshes and rewrite environments/ and the set assets
 *                        (episodes and scenes are untouched; `npm run seed` also uses these)
 * Deterministic: re-running produces identical files.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import type { Asset, Environment, Vec3 } from '../src/model/schema';
import { SCHEMAS } from '../src/model/schema';
import { mulberry32 } from '../src/score/compose';
import { PROJECT_DIR, saveDoc } from '../server/projectFs';
import { writeGlb, type GlbMaterial, type GlbPart } from './lib/glb';
import { merge, placed, write } from './gen-assets';

// ---------------------------------------------------------------- HDRI skies

type RGB = [number, number, number];
const lin = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
};
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const addc = (a: RGB, b: RGB, k = 1): RGB => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (x: number, y: number, z: number, oct = 5) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++, a *= 0.5, f *= 2.03) s += a * noise3(x * f, y * f, z * f);
  return s;
};

interface Sky {
  zenith: string;
  horizon: string;
  ground: string;
  /** sun/moon: azimuth & elevation in degrees, HDR intensity, angular size (deg) */
  sun?: { az: number; el: number; color: string; power: number; size: number; halo?: number };
  clouds?: { amount: number; color: string; shade: string; scale?: number };
  stars?: number;
  aurora?: { color: string; color2: string; power: number };
  /** vertical light pillars on the horizon */
  pillars?: { count: number; color: string; power: number; seed: number };
  /** distant silhouettes on the horizon: towers (light city) or monoliths (dark world) */
  skyline?: { kind: 'towers' | 'monoliths'; color: string; height: number; seed: number };
  /** a broad glow band around the horizon or overhead */
  glow?: { color: string; power: number; el: number; width: number };
  nebula?: { color: string; color2: string; power: number };
}

/** Render an equirectangular sky. Direction convention matches three.js equirect mapping. */
function renderSky(sky: Sky, W = 1024, H = 512) {
  const px = new Float32Array(W * H * 3);
  const Z = lin(sky.zenith), Hz = lin(sky.horizon), G = lin(sky.ground);
  const sunDir = sky.sun ? dirOf(sky.sun.az, sky.sun.el) : null;
  const sunC = sky.sun ? lin(sky.sun.color) : null;
  const rnd = mulberry32(sky.pillars?.seed ?? 1);
  const pillars = Array.from({ length: sky.pillars?.count ?? 0 }, () => ({ phi: rnd() * Math.PI * 2, w: 0.004 + rnd() * 0.01, h: 0.3 + rnd() * 0.9, k: 0.4 + rnd() * 0.6 }));
  const skyRnd = mulberry32(sky.skyline?.seed ?? 3);
  const bars = Array.from({ length: 140 }, () => ({ phi: skyRnd() * Math.PI * 2, w: 0.008 + skyRnd() * 0.03, h: skyRnd() ** 2, tip: skyRnd() }));
  for (let j = 0; j < H; j++) {
    const v = 1 - (j + 0.5) / H;
    const theta = (v - 0.5) * Math.PI;
    for (let i = 0; i < W; i++) {
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const d: RGB = [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
      const y = d[1];
      let c: RGB;
      if (y >= 0) {
        c = mix(Hz, Z, Math.pow(sstep(0, 1, y), 0.55));
        if (sky.glow) c = addc(c, lin(sky.glow.color), sky.glow.power * Math.exp(-(((theta * 180) / Math.PI - sky.glow.el) ** 2) / (2 * sky.glow.width ** 2)));
        if (sky.nebula) {
          const n = fbm(d[0] * 2.2 + 7, d[1] * 2.2, d[2] * 2.2, 6);
          const m = sstep(0.45, 0.8, n) * sstep(0, 0.3, y);
          c = addc(c, mix(lin(sky.nebula.color), lin(sky.nebula.color2), sstep(0.5, 0.75, fbm(d[0] * 4, d[1] * 4 + 3, d[2] * 4, 3))), m * sky.nebula.power);
        }
        if (sky.stars) {
          const sx = Math.floor((d[0] + 1) * 300), sy = Math.floor((d[1] + 1) * 300), sz = Math.floor((d[2] + 1) * 300);
          const h = hash3(sx, sy, sz);
          if (h > 1 - sky.stars * 0.004) c = addc(c, [1, 1, 1], (0.6 + 4 * hash3(sz, sx, sy)) * sstep(0.02, 0.2, y));
        }
        if (sky.aurora) {
          const curtain = Math.sin(phi * 3 + 1.3 * Math.sin(phi * 7)) * 0.5 + 0.5;
          const band = Math.exp(-(((theta * 180) / Math.PI - 28 - 10 * curtain) ** 2) / 120);
          const streak = 0.4 + 0.6 * fbm(phi * 14, 1, 2, 3);
          c = addc(c, mix(lin(sky.aurora.color), lin(sky.aurora.color2), curtain), band * streak * sky.aurora.power);
        }
        if (sky.clouds && y > 0.015) {
          const s = sky.clouds.scale ?? 1;
          const cx = (d[0] / (y + 0.08)) * 0.9 * s, cz = (d[2] / (y + 0.08)) * 0.9 * s;
          const n = fbm(cx, 0.5, cz, 6);
          const cov = sstep(1 - sky.clouds.amount, 1 - sky.clouds.amount + 0.25, n) * sstep(0.015, 0.12, y);
          const lit = sunDir ? clamp01(0.5 + 0.5 * (d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2])) : 0.6;
          const cc = mix(lin(sky.clouds.shade), lin(sky.clouds.color), lit * 0.8 + (n - 0.5) * 0.6);
          c = mix(c, cc, cov * 0.92);
        }
        if (sky.skyline) {
          let hh = 0, tip = 0;
          for (const b of bars) {
            const dp = Math.abs(((phi - b.phi + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (dp < b.w) {
              const top = sky.skyline.height * (0.25 + b.h);
              if (sky.skyline.kind === 'towers') {
                // stepped tower: narrower crown above 80% height
                const crown = dp < b.w * 0.45 ? top * 1.18 : top;
                hh = Math.max(hh, crown);
                if (dp < b.w * 0.12) tip = Math.max(tip, top * (1.35 + b.tip * 0.3));
              } else hh = Math.max(hh, top);
            }
          }
          const el = (theta * 180) / Math.PI;
          if (el < Math.max(hh, tip) && (el < hh || tip > 0)) c = mix(c, lin(sky.skyline.color), 0.85 * (1 - sstep(0, Math.max(hh, tip) + 0.01, el) * 0.3));
        }
      } else {
        c = mix(Hz, G, sstep(0, 0.25, -y));
      }
      for (const p of pillars) {
        const dp = Math.abs(((phi - p.phi + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const el = (theta * 180) / Math.PI;
        const k = Math.exp(-((dp / p.w) ** 2)) * (1 - sstep(0, 70 * p.h, el)) * (el > -2 ? 1 : 0);
        if (k > 0.001) c = addc(c, lin(sky.pillars!.color), k * p.k * sky.pillars!.power);
      }
      if (sunDir && sunC && sky.sun) {
        const cosA = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
        const ang = (Math.acos(Math.min(1, cosA)) * 180) / Math.PI;
        if (ang < sky.sun.size) c = addc(c, sunC, sky.sun.power);
        c = addc(c, sunC, (sky.sun.halo ?? 0.6) * Math.exp(-ang / 6) + (sky.sun.halo ?? 0.6) * 0.25 * Math.exp(-ang / 30));
      }
      px.set(c, (j * W + i) * 3);
    }
  }
  return encodeHdr(W, H, px);
}

/** Unit direction for an azimuth (deg, 0 = +Z, 90 = +X) and elevation (deg), in three.js world space. */
function dirOf(az: number, el: number): RGB {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
/** Azimuth/elevation of a key light position, so the visible sun matches the shadows. */
const sunFrom = (p: Vec3, el?: number) => ({ az: (Math.atan2(p[0], p[2]) * 180) / Math.PI, el: el ?? (Math.atan2(p[1], Math.hypot(p[0], p[2])) * 180) / Math.PI });

/** Radiance RGBE, new-style RLE scanlines (literal runs only — valid for every reader). */
function encodeHdr(W: number, H: number, px: Float32Array) {
  const head = Buffer.from(`#?RADIANCE\n# film-maker procedural sky\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
  const out: Buffer[] = [head];
  const line = new Uint8Array(W * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 3;
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const m = Math.max(r, g, b);
      if (m < 1e-32) line.set([0, 0, 0, 0], i * 4);
      else {
        const e = Math.ceil(Math.log2(m) + 1e-9);
        const f = 256 / 2 ** e;
        line.set([Math.min(255, Math.floor(r * f)), Math.min(255, Math.floor(g * f)), Math.min(255, Math.floor(b * f)), e + 128], i * 4);
      }
    }
    const enc: number[] = [2, 2, W >> 8, W & 255];
    for (let ch = 0; ch < 4; ch++)
      for (let i = 0; i < W; i += 128) {
        const n = Math.min(128, W - i);
        enc.push(n);
        for (let k = 0; k < n; k++) enc.push(line[(i + k) * 4 + ch]);
      }
    out.push(Buffer.from(enc));
  }
  return new Uint8Array(Buffer.concat(out));
}

const SKIES: Record<string, Sky> = {
  // light city at golden dawn: warm low sun, pink-gold cumulus, a hazy marble skyline
  dawn: {
    zenith: '#5d86c4', horizon: '#ffd9b0', ground: '#d8d2c8',
    sun: { ...sunFrom([6, 10, 5], 14), color: '#ffcf96', power: 22, size: 1.6, halo: 0.45 },
    clouds: { amount: 0.42, color: '#fff1e0', shade: '#c79db0' },
    skyline: { kind: 'towers', color: '#e7cdb6', height: 7, seed: 11 },
    glow: { color: '#ffb27a', power: 0.5, el: 4, width: 8 },
  },
  // the plaza at bright midday: deep blue, big white cumulus
  noon: {
    zenith: '#2f6fc9', horizon: '#cfe3f5', ground: '#e2e4e6',
    sun: { ...sunFrom([-5, 9, 6], 58), color: '#fff6e8', power: 25, size: 1.2, halo: 0.25 },
    clouds: { amount: 0.5, color: '#ffffff', shade: '#9fb3cc', scale: 1.3 },
    skyline: { kind: 'towers', color: '#cbd9e8', height: 6, seed: 4 },
  },
  // the sealed gate: heavy overcast, cold and still
  overcast: {
    zenith: '#6c7684', horizon: '#c4c9cf', ground: '#9ea3a8',
    clouds: { amount: 0.85, color: '#d5d9de', shade: '#5e6672', scale: 0.7 },
    sun: { ...sunFrom([5, 9, 6], 35), color: '#f4f1ea', power: 2, size: 4, halo: 0.6 },
    skyline: { kind: 'towers', color: '#a7adb5', height: 8, seed: 21 },
  },
  // the open gate: glorious golden hour pouring through the arch
  golden: {
    zenith: '#4a73b8', horizon: '#ffc27a', ground: '#d6b994',
    sun: { ...sunFrom([0, 4, -10], 9), color: '#ffb35c', power: 30, size: 2, halo: 0.7 },
    clouds: { amount: 0.36, color: '#ffe0b8', shade: '#b07a8a', scale: 0.8 },
    skyline: { kind: 'towers', color: '#e9b98c', height: 6, seed: 9 },
    glow: { color: '#ff9d4d', power: 0.4, el: 3, width: 7 },
  },
  // the city edge at dusk: violet-orange sky above, the void below
  dusk: {
    zenith: '#2a2c5c', horizon: '#ff9a6a', ground: '#0a0a12',
    sun: { ...sunFrom([-6, 8, 4], 3), color: '#ff7a45', power: 20, size: 2.2, halo: 0.7 },
    clouds: { amount: 0.33, color: '#ffb48f', shade: '#3d2f5c', scale: 0.9 },
    stars: 0.4,
    glow: { color: '#ff6a3a', power: 0.7, el: 2, width: 6 },
    pillars: { count: 1, color: '#cfe0ff', power: 2, seed: 5 },
  },
  // the world below: cold moon, stars, a ring of distant monoliths
  moon: {
    zenith: '#020308', horizon: '#121a2c', ground: '#010102',
    sun: { ...sunFrom([-3, 10, 3], 38), color: '#cfdcff', power: 14, size: 1.8, halo: 0.25 },
    stars: 1, skyline: { kind: 'monoliths', color: '#05070c', height: 9, seed: 42 },
    glow: { color: '#2a3c66', power: 0.25, el: 2, width: 10 },
    pillars: { count: 3, color: '#a9c2ff', power: 0.8, seed: 7 },
  },
  // the signal chamber: aurora curtains over the dark
  aurora: {
    zenith: '#010308', horizon: '#0b1622', ground: '#010102',
    stars: 0.8, aurora: { color: '#3dffb0', color2: '#4f8bff', power: 1.6 },
    skyline: { kind: 'monoliths', color: '#03060a', height: 7, seed: 7 },
  },
  // network awake: dozens of light pillars rising from distant peers
  network: {
    zenith: '#03050c', horizon: '#18233d', ground: '#020204',
    stars: 1.2, pillars: { count: 38, color: '#bcd2ff', power: 3, seed: 13 },
    glow: { color: '#3a5aa8', power: 0.45, el: 0, width: 9 },
    skyline: { kind: 'monoliths', color: '#04060c', height: 6, seed: 13 },
  },
  // the mempool sea: deep teal nebula, drifting
  teal: {
    zenith: '#01060a', horizon: '#0c2a33', ground: '#010304',
    stars: 0.7, nebula: { color: '#1f8f9a', color2: '#ffcf8a', power: 0.55 },
    glow: { color: '#1b6b78', power: 0.35, el: 2, width: 12 },
  },
  // the mining hall: amber forge haze and embers
  forge: {
    zenith: '#050302', horizon: '#3a1d0c', ground: '#030101',
    glow: { color: '#ff7a2a', power: 0.9, el: 3, width: 9 },
    nebula: { color: '#7a2a0a', color2: '#ffb35c', power: 0.35 },
    stars: 0.5, skyline: { kind: 'monoliths', color: '#080403', height: 8, seed: 77 },
    pillars: { count: 9, color: '#ffb066', power: 1.5, seed: 77 },
  },
  // block found: a golden burst from overhead
  gold: {
    zenith: '#1a1204', horizon: '#120c06', ground: '#020101',
    sun: { az: 0, el: 89, color: '#ffd38a', power: 80, size: 5, halo: 2.5 },
    glow: { color: '#ffb84d', power: 0.5, el: 60, width: 20 },
    stars: 0.9, pillars: { count: 14, color: '#ffd28a', power: 1.4, seed: 3 },
    skyline: { kind: 'monoliths', color: '#060403', height: 6, seed: 3 },
  },
};

export function genSkies() {
  for (const [name, sky] of Object.entries(SKIES)) write(`media/hdri/${name}.hdr`, renderSky(sky));
}

// ---------------------------------------------------------------- set dressing meshes

const MARBLE: GlbMaterial = { name: 'marble', color: [0.93, 0.92, 0.9], roughness: 0.35 };
const GOLD: GlbMaterial = { name: 'gold_trim', color: [1, 0.78, 0.4], metallic: 1, roughness: 0.25 };
const OBSIDIAN: GlbMaterial = { name: 'obsidian', color: [0.018, 0.018, 0.022], roughness: 0.22, metallic: 0.35 };
const LEAVES: GlbMaterial = { name: 'leaves', color: [0.38, 0.56, 0.32], roughness: 0.8 };
const glow = (name: string, c: RGB, k = 3, opacity?: number): GlbMaterial => ({ name, color: c, emissive: c, emissiveStrength: k, ...(opacity ? { opacity } : {}) });
const sphere = (r: number, x = 0, y = 0, z = 0, w = 24, h = 16) => placed(new THREE.SphereGeometry(r, w, h), x, y, z);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => placed(new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry);
const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 24) => placed(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z);

export function genSetDressing() {
  const glb = (name: string, parts: GlbPart[]) => write(`media/meshes/${name}.glb`, writeGlb(name, parts));
  const rnd = mulberry32(2024);

  // ---- light city
  const flutes: THREE.BufferGeometry[] = [cyl(0.32, 0.36, 4.4, 0, 2.6, 0, 20), box(0.95, 0.2, 0.95, 0, 0.1, 0), cyl(0.45, 0.45, 0.2, 0, 0.3, 0), cyl(0.5, 0.36, 0.3, 0, 4.95, 0), box(1, 0.2, 1, 0, 5.2, 0)];
  glb('column', [{ name: 'column', geometry: merge(flutes), material: MARBLE }, { name: 'band', geometry: cyl(0.38, 0.38, 0.06, 0, 4.7, 0), material: GOLD }]);
  glb('lamp_post', [
    { name: 'post', geometry: merge([cyl(0.04, 0.06, 2.6, 0, 1.3, 0, 10), cyl(0.14, 0.14, 0.08, 0, 0.04, 0, 12), box(0.5, 0.04, 0.04, 0, 2.55, 0)]), material: GOLD },
    { name: 'lamp', geometry: merge([sphere(0.13, -0.22, 2.4, 0), sphere(0.13, 0.22, 2.4, 0)]), material: glow('lamp_glow', [1, 0.86, 0.6], 6) },
  ]);
  glb('bench', [{ name: 'bench', geometry: merge([box(1.6, 0.1, 0.5, 0, 0.45, 0), box(0.15, 0.4, 0.45, -0.65, 0.2, 0), box(0.15, 0.4, 0.45, 0.65, 0.2, 0)]), material: MARBLE }]);
  glb('planter', [
    { name: 'pot', geometry: merge([box(1, 0.55, 1, 0, 0.275, 0), box(1.1, 0.08, 1.1, 0, 0.56, 0)]), material: MARBLE },
    { name: 'bush', geometry: merge([sphere(0.42, 0, 0.85, 0), sphere(0.3, 0.25, 0.75, 0.15), sphere(0.28, -0.22, 0.78, -0.12)]), material: LEAVES },
  ]);
  const basin = new THREE.TorusGeometry(2.2, 0.22, 10, 48).rotateX(Math.PI / 2).translate(0, 0.45, 0);
  glb('fountain', [
    { name: 'basin', geometry: merge([basin, cyl(2.2, 2.3, 0.3, 0, 0.15, 0, 48), cyl(0.35, 0.5, 2, 0, 1, 0), cyl(0.9, 0.3, 0.25, 0, 2.1, 0), cyl(0.18, 0.25, 0.9, 0, 2.6, 0)]), material: MARBLE },
    { name: 'water', geometry: cyl(2.05, 2.05, 0.04, 0, 0.5, 0, 48), material: { name: 'water', color: [0.6, 0.8, 1], roughness: 0.02, metallic: 0.2, opacity: 0.55 } },
    { name: 'spout', geometry: merge([sphere(0.25, 0, 3.15, 0), cyl(0.04, 0.12, 0.6, 0, 3.5, 0, 8)]), material: glow('fountain_glow', [0.8, 0.92, 1], 2.5, 0.8) },
  ]);
  glb('cloud', [{ name: 'cloud', geometry: merge(Array.from({ length: 9 }, (_, i) => sphere(0.9 + rnd() * 0.9, (i - 4) * 0.9 + rnd() * 0.4, rnd() * 0.5, rnd() * 0.8 - 0.4, 16, 12).scale(1, 0.7, 1))), material: { name: 'cloud', color: [1, 0.98, 0.96], roughness: 1, emissive: [1, 0.95, 0.9], emissiveStrength: 0.35 } }]);
  const isle = new THREE.ConeGeometry(2.4, 3.4, 9, 3).rotateX(Math.PI).translate(0, -1.7, 0);
  const pos = isle.getAttribute('position');
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.1) pos.setX(i, pos.getX(i) * (0.8 + rnd() * 0.4));
  isle.computeVertexNormals();
  glb('floating_isle', [
    { name: 'rock', geometry: isle, material: { ...MARBLE, name: 'isle_rock', color: [0.82, 0.8, 0.76], roughness: 0.7 } },
    { name: 'turf', geometry: cyl(2.4, 2.4, 0.18, 0, 0.05, 0, 18), material: LEAVES },
    { name: 'tree', geometry: merge([sphere(0.8, 0.3, 1.8, 0, 12, 8), sphere(0.6, -0.4, 1.5, 0.3, 12, 8)]), material: LEAVES },
    { name: 'trunk', geometry: cyl(0.08, 0.14, 1.4, 0.1, 0.7, 0, 8), material: { name: 'bark', color: [0.32, 0.25, 0.2], roughness: 0.9 } },
  ]);
  glb('obelisk', [
    { name: 'obelisk', geometry: merge([box(1.6, 0.6, 1.6, 0, 0.3, 0), cyl(0.35, 0.65, 9, 0, 5.1, 0, 4).rotateY(Math.PI / 4)]), material: MARBLE },
    { name: 'tip', geometry: placed(new THREE.ConeGeometry(0.36, 0.9, 4), 0, 10.05, 0, 0, Math.PI / 4), material: GOLD },
  ]);
  glb('wall', [{ name: 'wall', geometry: merge([box(12, 7, 1.4, 0, 3.5, 0), box(12.4, 0.5, 1.8, 0, 7.2, 0), ...Array.from({ length: 6 }, (_, i) => box(0.9, 0.8, 1.6, -5 + i * 2, 7.85, 0)), box(12.4, 0.6, 1.8, 0, 0.3, 0)]), material: MARBLE }]);
  glb('balustrade', [{ name: 'rail', geometry: merge([box(6, 0.12, 0.3, 0, 0.95, 0), box(6, 0.12, 0.35, 0, 0.06, 0), ...Array.from({ length: 13 }, (_, i) => cyl(0.06, 0.1, 0.8, -2.85 + i * 0.475, 0.5, 0, 8))]), material: MARBLE }]);
  glb('statue', [
    { name: 'plinth', geometry: merge([box(1.4, 1.6, 1.4, 0, 0.8, 0), box(1.6, 0.15, 1.6, 0, 1.65, 0)]), material: MARBLE },
    { name: 'figure', geometry: merge([sphere(0.55, 0, 3.4, 0, 32, 20), placed(new THREE.CapsuleGeometry(0.32, 0.6, 6, 16), 0, 2.35, 0), placed(new THREE.CapsuleGeometry(0.11, 0.7, 4, 10), -0.42, 2.9, 0, 0, 0, -2.6), placed(new THREE.CapsuleGeometry(0.11, 0.5, 4, 10), 0.42, 2.3, 0, 0, 0, 0.3)]), material: { ...MARBLE, name: 'statue_marble', roughness: 0.5 } },
  ]);
  glb('banner', [
    { name: 'pole', geometry: merge([cyl(0.05, 0.05, 6, 0, 3, 0, 8), sphere(0.12, 0, 6.05, 0)]), material: GOLD },
    { name: 'cloth', geometry: placed(new THREE.PlaneGeometry(1.2, 3, 4, 8), 0.65, 4.4, 0), material: { name: 'banner_cloth', color: [0.95, 0.6, 0.2], roughness: 0.8, doubleSided: true } },
  ]);

  // ---- dark world
  const shard = (s: number) => {
    const g = new THREE.OctahedronGeometry(1, 0).scale(0.45, 2.2, 0.45);
    return placed(g, 0, 2, 0, 0.12 * s, 0.4 * s, 0.18 * s);
  };
  glb('rock_shard', [{ name: 'shard', geometry: merge([shard(1), placed(shard(-1), 0.9, -0.6, 0.3).scale(0.7, 0.7, 0.7), placed(shard(0.5), -0.7, -0.9, -0.2).scale(0.55, 0.55, 0.55)]), material: OBSIDIAN }]);
  const crystals = (k: number) => merge(Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2;
    const h = 0.6 + ((i * 37 + k) % 5) * 0.25;
    return placed(new THREE.OctahedronGeometry(1, 0).scale(0.14, h, 0.14), Math.cos(a) * 0.25 * (i ? 1 : 0), h * 0.8, Math.sin(a) * 0.25 * (i ? 1 : 0), Math.cos(a) * 0.35 * (i ? 1 : 0), 0, Math.sin(a) * 0.35 * (i ? 1 : 0));
  }));
  glb('crystal', [{ name: 'crystal', geometry: crystals(1), material: glow('crystal_cyan', [0.45, 0.9, 1], 3.5, 0.85) }]);
  glb('crystal_gold', [{ name: 'crystal', geometry: crystals(3), material: glow('crystal_gold', [1, 0.75, 0.35], 3.5, 0.85) }]);
  glb('pylon', [
    { name: 'pylon', geometry: merge([box(0.7, 14, 0.7, 0, 7, 0), box(1.2, 0.4, 1.2, 0, 0.2, 0)]), material: OBSIDIAN },
    { name: 'strip', geometry: merge([box(0.06, 12, 0.72, 0, 7.4, 0), box(0.72, 12, 0.06, 0, 7.4, 0)]), material: glow('pylon_strip', [0.6, 0.78, 1], 4) },
  ]);
  glb('floor_ring', [{ name: 'ring', geometry: merge([new THREE.RingGeometry(2.8, 3, 64).rotateX(-Math.PI / 2), new THREE.RingGeometry(1.7, 1.78, 64).rotateX(-Math.PI / 2), ...Array.from({ length: 12 }, (_, i) => box(0.06, 0.005, 1, Math.sin((i * Math.PI) / 6) * 2.35, 0, Math.cos((i * Math.PI) / 6) * 2.35, (i * Math.PI) / 6))]).translate(0, 0.012, 0), material: glow('rune', [0.55, 0.8, 1], 3) }]);
  const motes = (seed: number) => {
    const r = mulberry32(seed);
    return merge(Array.from({ length: 90 }, () => sphere(0.012 + r() * 0.025, (r() - 0.5) * 16, 0.3 + r() * 6, (r() - 0.5) * 16, 6, 4)));
  };
  glb('motes', [{ name: 'motes', geometry: motes(5), material: glow('motes', [0.85, 0.92, 1], 5) }]);
  glb('embers', [{ name: 'embers', geometry: motes(9), material: glow('embers', [1, 0.55, 0.2], 6) }]);
  glb('miner_rig', [
    { name: 'rack', geometry: merge([box(1.6, 3, 0.9, 0, 1.5, 0), box(1.7, 0.1, 1, 0, 3.05, 0)]), material: OBSIDIAN },
    { name: 'slots', geometry: merge(Array.from({ length: 8 }, (_, i) => box(1.3, 0.06, 0.02, 0, 0.4 + i * 0.33, 0.46))), material: glow('rig_glow', [1, 0.6, 0.25], 4) },
  ]);
  glb('pedestal', [
    { name: 'steps', geometry: merge([cyl(3.4, 3.6, 0.3, 0, 0.15, 0, 8), cyl(2.6, 2.8, 0.3, 0, 0.45, 0, 8), cyl(1.8, 2, 0.3, 0, 0.75, 0, 8)]), material: OBSIDIAN },
    { name: 'trim', geometry: merge([new THREE.TorusGeometry(3.5, 0.025, 4, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8).translate(0, 0.3, 0), new THREE.TorusGeometry(2.7, 0.025, 4, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8).translate(0, 0.6, 0), new THREE.TorusGeometry(1.9, 0.025, 4, 8).rotateX(Math.PI / 2).rotateY(Math.PI / 8).translate(0, 0.9, 0)]), material: glow('pedestal_trim', [1, 0.8, 0.45], 4) },
  ]);
  glb('halo_ring', [{ name: 'halo', geometry: new THREE.TorusGeometry(2.4, 0.05, 8, 96), material: glow('halo', [1, 0.85, 0.55], 5) }]);
}

// ---------------------------------------------------------------- assets

const A = (id: string, name: string, kind: Asset['kind'], description: string, color: string, tags: string[]) =>
  [id, SCHEMAS.asset.parse({ id, name, kind, description, color, mesh: `media/meshes/${id}.glb`, tags })] as const;

export const SET_ASSETS: Record<string, Asset> = Object.fromEntries([
  A('column', 'Column', 'set', '5.3m marble column with a gold band.', '#eeeeee', ['light']),
  A('lamp_post', 'Lamp Post', 'prop', 'Gold double lamp post with glowing globes.', '#ffdf9e', ['light']),
  A('bench', 'Bench', 'prop', 'Marble bench.', '#eeeeee', ['light']),
  A('planter', 'Planter', 'prop', 'Marble planter with a round bush.', '#7aa86a', ['light']),
  A('fountain', 'Fountain', 'set', 'Round marble fountain with a glowing spout.', '#dfe9ff', ['light']),
  A('cloud', 'Cloud', 'fx', 'Soft white cloud bank, floats at any height.', '#ffffff', ['light']),
  A('floating_isle', 'Floating Isle', 'set', 'Inverted rock island with turf and a tree.', '#cfc9bd', ['light']),
  A('obelisk', 'Obelisk', 'set', '10m marble obelisk with a gold tip.', '#eeeeee', ['light']),
  A('wall', 'Wall', 'set', '12m crenellated marble city wall.', '#eeeeee', ['light']),
  A('balustrade', 'Balustrade', 'prop', '6m marble railing.', '#eeeeee', ['light']),
  A('statue', 'Statue', 'set', 'Marble statue of a sphere-headed figure on a plinth.', '#eeeeee', ['light']),
  A('banner', 'Banner', 'prop', 'Tall gold pole with an orange banner.', '#f29a33', ['light']),
  A('rock_shard', 'Rock Shard', 'set', 'Cluster of tilted obsidian spikes.', '#151515', ['dark']),
  A('crystal', 'Crystal', 'fx', 'Glowing cyan crystal cluster.', '#7fe6ff', ['dark']),
  A('crystal_gold', 'Gold Crystal', 'fx', 'Glowing amber crystal cluster.', '#ffc066', ['dark']),
  A('pylon', 'Pylon', 'set', '14m obsidian pylon with glowing strips.', '#99c4ff', ['dark']),
  A('floor_ring', 'Floor Ring', 'fx', 'Glowing rune circle on the floor, 6m.', '#8cc8ff', ['dark']),
  A('motes', 'Motes', 'fx', 'Floating light motes over 16m.', '#e0ecff', ['dark', 'light']),
  A('embers', 'Embers', 'fx', 'Drifting embers over 16m.', '#ff8a33', ['dark']),
  A('miner_rig', 'Miner Rig', 'prop', 'Obsidian rack with glowing slots.', '#ff9a40', ['dark', 'protocol']),
  A('pedestal', 'Pedestal', 'set', 'Stepped octagonal dais with glowing trim.', '#ffcc73', ['dark']),
  A('halo_ring', 'Halo Ring', 'fx', 'Floating golden ring.', '#ffd58c', ['dark']),
]);

// ---------------------------------------------------------------- environments

type P = Environment['props'][number];
const p = (assetId: string, position: Vec3 = [0, 0, 0], scale = 1, rotationY = 0): P => ({ assetId, position, scale, rotationY });
const ring = (assetId: string, n: number, r: number, y = 0, scale = 1, cz = 0, phase = 0, face = true): P[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return p(assetId, [Math.sin(a) * r, y, Math.cos(a) * r + cz], scale, face ? (a * 180) / Math.PI : 0);
  });
const row = (assetId: string, from: Vec3, step: Vec3, n: number, scale = 1, rotationY = 0): P[] =>
  Array.from({ length: n }, (_, i) => p(assetId, [from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i], scale, rotationY));
/** random scatter in an annulus that keeps the stage (|x| < clear, z > -clear*2) empty */
const scatter = (seed: number, ids: string[], n: number, rMin: number, rMax: number, s: [number, number], cz = -3, y = 0): P[] => {
  const r = mulberry32(seed);
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = rMin + r() * (rMax - rMin);
    out.push(p(ids[Math.floor(r() * ids.length)], [Math.cos(a) * d, y, Math.sin(a) * d + cz], s[0] + r() * (s[1] - s[0]), r() * 360));
  }
  return out;
};

// shared light-city dressing: a colossal skyline, floating isles and cloud banks
const skyline: P[] = [p('tower', [-14, 0, -26], 1.8), p('tower', [9, 0, -30], 2.4), p('tower', [22, 0, -18], 1.4, 20), p('tower', [-24, 0, -14], 1.6, 10), p('tower', [0, 0, -44], 3), p('tower', [-34, 0, -36], 2.2), p('tower', [32, 0, -40], 2.6, 15)];
const isles: P[] = [p('floating_isle', [-12, 9, -18], 1.1, 20), p('floating_isle', [14, 13, -26], 1.6, 140), p('floating_isle', [3, 18, -38], 2.2, 70)];
const clouds = (y = 0): P[] => [p('cloud', [-20, 14 + y, -34], 2.2, 10), p('cloud', [18, 20 + y, -40], 3, 60), p('cloud', [-4, 26 + y, -55], 4, 120), p('cloud', [26, 8 + y, -22], 1.6, 30)];
const floaters: P[] = [p('glass_sphere', [3.2, 2.6, -3], 0.6), p('glass_sphere', [-5, 4.5, -8], 1.2), p('glass_sphere', [8, 6.5, -12], 1.7), p('glass_sphere', [-2.4, 1.6, -1.5], 0.3)];
const monoliths = (seed: number, n: number, radius: number, tall = 1): P[] => {
  const out: P[] = [];
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = radius * (0.45 + r() * 0.9);
    const pos: Vec3 = [Math.cos(a) * d, 0, Math.sin(a) * d - 3];
    if (Math.abs(pos[0]) < 2.6 && pos[2] > -7) continue; // keep the stage clear
    out.push(p(r() < 0.65 ? 'monolith' : 'monolith_cube', pos, (0.6 + r() * 1.4) * (r() < 0.2 ? tall : 1), r() * 90));
  }
  return out;
};
const light = { lighting: { ambient: 0.3, key: 1.6, keyColor: '#ffe9cc', keyPosition: [6, 10, 5] as Vec3 }, refs: ['media/refs/light_environments.png'] };
const dark = { fog: { color: '#05070c', near: 10, far: 48 }, refs: ['media/refs/dark_environments.png'] };

export const ENVIRONMENTS: Record<string, Environment> = Object.fromEntries(
  [
    {
      id: 'light_city', name: 'Light City', description: 'Grand marble avenue at golden dawn: colonnades, lamps, a fountain, colossal towers and floating isles.',
      ...light, lighting: { ambient: 0.25, key: 2, keyColor: '#ffc68a', keyPosition: [6, 6, 5] }, background: '#f2d9bf', fog: { color: '#f3cfa8', near: 30, far: 140 }, hdri: 'media/hdri/dawn.hdr', hdriIntensity: 0.55,
      post: { bloom: 0.8, vignette: 0.35, grain: 0.03, exposure: 0.8 },
      preview: { position: [5, 1.6, 12], target: [0, 4.5, -8], fov: 55 },
      props: [p('marble_floor'), p('arch', [0, 0, -9], 2), p('fountain', [0, 0, -4.5]),
        ...row('column', [-4.5, 0, 2], [0, 0, -3.5], 6), ...row('column', [4.5, 0, 2], [0, 0, -3.5], 6),
        ...row('lamp_post', [-3, 0, 0], [0, 0, -5], 3), ...row('lamp_post', [3, 0, 0], [0, 0, -5], 3),
        p('bench', [-3.2, 0, -2.5], 1, 90), p('bench', [3.2, 0, -2.5], 1, -90), p('planter', [-6.5, 0, -1]), p('planter', [6.5, 0, -1]),
        p('tree', [-7, 0, -6], 1.4), p('tree', [7.5, 0, -7], 1.6), p('marble_steps', [0, 0, -12], 1.5),
        p('obelisk', [-9, 0, -16], 1.2), p('obelisk', [9, 0, -16], 1.2), p('banner', [-2, 0, -8.6]), p('banner', [2, 0, -8.6]),
        ...skyline, ...isles, ...clouds(), ...floaters, p('motes', [0, 0, -4], 1)],
    },
    {
      id: 'light_plaza', name: 'Light Plaza', description: 'Sunlit puzzle plaza: stepping blocks over a sunken court, ringed by a colonnade under a blue midday sky.',
      ...light, lighting: { ambient: 0.35, key: 1.8, keyColor: '#fff4e2', keyPosition: [-5, 12, 6] },
      background: '#cfe3f5', fog: { color: '#cfe1f2', near: 30, far: 140 }, hdri: 'media/hdri/noon.hdr', hdriIntensity: 0.55,
      post: { bloom: 0.5, vignette: 0.3, grain: 0.03, exposure: 0.8 },
      preview: { position: [-6, 3, 10], target: [0.5, 2.5, -6], fov: 55 },
      props: [p('marble_floor'), p('marble_block', [-1.5, 0, -1.5], 0.5), p('marble_block', [-0.3, 0, -2.6], 0.5), p('marble_block', [1, 0, -3.8], 0.5), p('marble_block', [2.4, 0, -5], 0.5),
        p('marble_steps', [0, 0, -8], 1.2), p('statue', [0, 0.95, -11.5], 1.4), p('floor_ring', [0.4, 0, -3.3], 0.9),
        ...ring('column', 14, 10, 0, 0.9, -4, 0.22).filter((c) => c.position[2] < 3), p('tree', [-5, 0, -6], 1.2), p('tree', [5.5, 0, -7], 1.5),
        p('planter', [-3.5, 0, 0.5]), p('planter', [4, 0, 0]), p('bench', [-6, 0, -2], 1, 70), p('banner', [-4.5, 0, -9]), p('banner', [4.5, 0, -9]),
        p('fountain', [-9, 0, -12], 0.8), ...skyline, ...isles, ...clouds(4), ...floaters],
    },
    {
      id: 'sealed_gate', name: 'Sealed Gate', description: 'A colossal city wall under a heavy overcast sky; its great arch is blocked by a giant marble block. Statues stand guard.',
      ...light, lighting: { ambient: 0.45, key: 0.9, keyColor: '#e9eef5', keyPosition: [5, 9, 6] },
      background: '#c4c9cf', fog: { color: '#b4bac3', near: 22, far: 90 }, hdri: 'media/hdri/overcast.hdr', hdriIntensity: 0.6,
      post: { bloom: 0.2, vignette: 0.55, grain: 0.06, exposure: 0.8 },
      preview: { position: [3, 1.6, 9], target: [0, 3.5, -4], fov: 50 },
      props: [p('marble_floor'), p('arch', [0, 0, -4], 2.2), p('marble_block', [0, 0, -4], 4.4), p('wall', [-9.6, 0, -4], 1.1), p('wall', [9.6, 0, -4], 1.1),
        p('statue', [-4.6, 0, -2.6], 1.3, 15), p('statue', [4.6, 0, -2.6], 1.3, -15), p('obelisk', [-7, 0, 1], 0.8), p('obelisk', [7, 0, 1], 0.8),
        p('tree', [-6, 0, 3], 1.1), p('lamp_post', [-2.8, 0, 0.5]), p('lamp_post', [2.8, 0, 0.5]), ...skyline.map((t) => ({ ...t, position: [t.position[0], 0, t.position[2] - 10] as Vec3 })), ...clouds(6)],
    },
    {
      id: 'open_gate', name: 'Open Gate', description: 'Bit holds the block overhead — golden-hour light pours through the open arch from the city beyond.',
      ...light, lighting: { ambient: 0.35, key: 2.2, keyColor: '#ffb066', keyPosition: [-3, 5, -10] },
      background: '#ffc27a', fog: { color: '#f5c08a', near: 26, far: 110 }, hdri: 'media/hdri/golden.hdr', hdriIntensity: 0.55,
      post: { bloom: 1, vignette: 0.4, grain: 0.04, exposure: 0.8 },
      preview: { position: [-5, 1.8, 9], target: [0, 4, -10], fov: 55 },
      props: [p('marble_floor'), p('arch', [0, 0, -4], 2.2), p('marble_block', [1.4, 1.45, -1.3], 1.3, 12), p('wall', [-9.6, 0, -4], 1.1), p('wall', [9.6, 0, -4], 1.1),
        p('statue', [-4.6, 0, -2.6], 1.3, 15), p('statue', [4.6, 0, -2.6], 1.3, -15), p('light_shaft', [0, 0, -6], 1.4), p('fountain', [0, 0, -14], 1.2),
        ...row('column', [-3.5, 0, -9], [0, 0, -4], 5), ...row('column', [3.5, 0, -9], [0, 0, -4], 5), p('motes', [0, 0, -5]),
        ...skyline.map((t) => ({ ...t, position: [t.position[0], 0, t.position[2] - 10] as Vec3 })), ...isles, ...clouds(2)],
    },
    {
      id: 'city_edge', name: 'City Edge', description: 'A balustraded terrace at the rim of the light city, at dusk. Below, the dark world; far away, a lone beacon pulses.',
      lighting: { ambient: 0.3, key: 1.5, keyColor: '#ff9a6a', keyPosition: [-6, 8, 4] }, background: '#2a2c5c',
      fog: { color: '#3b2f4f', near: 30, far: 120 }, hdri: 'media/hdri/dusk.hdr', hdriIntensity: 0.7,
      post: { bloom: 0.8, vignette: 0.45, grain: 0.05, exposure: 1 },
      preview: { position: [2.5, 3.2, 6.5], target: [0, -7, -32], fov: 55 },
      props: [p('marble_floor', [0, 0, 37.5]), ...row('balustrade', [-12, 0, -2.4], [6, 0, 0], 5), p('marble_block', [-3, 0, -1], 0.6), p('marble_block', [3.2, 0, -1.2], 0.8),
        p('lamp_post', [-5, 0, -1.6]), p('lamp_post', [5, 0, -1.6]), p('statue', [-9, 0, -0.5], 1.2, 20), p('bench', [2, 0, 1.5]),
        p('obsidian_floor', [0, -14, -40]), p('hex_beacon', [0, -14, -32], 5), p('light_shaft', [0, -14, -32], 2.6), p('floor_ring', [0, -14, -32], 3),
        ...monoliths(3, 26, 22, 3).map((m) => ({ ...m, position: [m.position[0], -14, m.position[2] - 32] as Vec3 })),
        ...skyline.slice(0, 4).map((t) => ({ ...t, position: [t.position[0], 0, t.position[2] + 40] as Vec3 })), p('floating_isle', [-14, -2, -16], 1.2), p('floating_isle', [16, 2, -24], 1.8, 90)],
    },
    {
      id: 'dark_monoliths', name: 'Dark Monoliths', description: 'The world below: a moonlit forest of black glossy monoliths and spires, shafts of light, drifting motes, silence.',
      ...dark, background: '#020308', lighting: { ambient: 0.12, key: 1.1, keyColor: '#cfdcff', keyPosition: [-3, 10, 3] },
      hdri: 'media/hdri/moon.hdr', hdriIntensity: 1.2, post: { bloom: 0.9, vignette: 0.55, grain: 0.06, exposure: 1.1 },
      preview: { position: [0.5, 1.8, 7], target: [0, 3, -14], fov: 60 },
      props: [p('obsidian_floor'), ...monoliths(42, 34, 20, 3.5), ...scatter(4, ['rock_shard'], 10, 7, 20, [0.8, 2.2]), ...scatter(8, ['pylon'], 5, 16, 28, [0.8, 1.4]),
        p('light_shaft', [5, 0, -12], 1.2), p('light_shaft', [-7, 0, -18], 0.9), p('light_shaft', [12, 0, -24], 1.6), p('glass_sphere', [-3, 3, -9], 0.8),
        p('crystal', [-3.4, 0, -4], 0.8), p('crystal', [4, 0, -6], 1.1, 40), p('motes', [0, 0, -5]), p('motes', [0, 0, -16], 1.4)],
    },
    {
      id: 'signal_chamber', name: 'Signal Chamber', description: 'A ring of glowing pylons around a lonely hex beacon — a brand-new node — under aurora curtains.',
      ...dark, fog: { color: '#03080c', near: 10, far: 50 }, background: '#010308', lighting: { ambient: 0.12, key: 0.8, keyColor: '#9fffd8', keyPosition: [2, 9, 4] },
      hdri: 'media/hdri/aurora.hdr', hdriIntensity: 1.3, post: { bloom: 1.1, vignette: 0.5, grain: 0.06, exposure: 1.1 },
      preview: { position: [0, 3, 9], target: [0, 1.6, -4], fov: 55 },
      props: [p('obsidian_floor'), p('hex_beacon', [0, 0, -4], 1.4), p('light_shaft', [0, 0, -4], 0.7), p('floor_ring', [0, 0, -4], 1), p('floor_ring', [0, 0, -4], 2.2),
        ...ring('pylon', 8, 9, 0, 0.6, -4, 0.4), ...ring('crystal', 6, 4.5, 0, 0.7, -4, 0.9, false), ...monoliths(7, 18, 18, 2), ...scatter(12, ['rock_shard'], 8, 12, 22, [0.6, 1.6]), p('motes', [0, 0, -4])],
    },
    {
      id: 'network_awake', name: 'Network Awake', description: 'After the handshake: light shafts rise from peers all the way to the horizon, rune rings glow — the network is connected.',
      ...dark, fog: { color: '#070c1a', near: 14, far: 70 }, background: '#03050c', lighting: { ambient: 0.25, key: 1.3, keyColor: '#dfe8ff', keyPosition: [2, 9, 4] },
      hdri: 'media/hdri/network.hdr', hdriIntensity: 1.3, post: { bloom: 1.2, vignette: 0.4, grain: 0.05, exposure: 1.15 },
      preview: { position: [0, 4, 10], target: [0, 2, -10], fov: 58 },
      props: [p('obsidian_floor'), p('hex_beacon', [0, 0, -4], 1.4), p('floor_ring', [0, 0, -4], 2.2), ...monoliths(7, 26, 22, 2.5),
        ...monoliths(7, 26, 22, 2.5).filter((_, i) => i % 2 === 0).map((m) => p('light_shaft', m.position, 0.6)),
        ...scatter(21, ['hex_beacon'], 9, 10, 26, [0.8, 1.4]), ...ring('pylon', 6, 12, 0, 0.5, -4, 0.2), p('motes', [0, 0, -4], 1.2), p('motes', [0, 0, -18], 1.6)],
    },
    {
      id: 'mempool_sea', name: 'Mempool Sea', description: 'Hundreds of glass bubbles drifting over a mirror-black sea under a teal nebula, each holding a waiting transaction.',
      ...dark, fog: { color: '#04121a', near: 10, far: 55 }, background: '#01060a', lighting: { ambient: 0.22, key: 1.0, keyColor: '#ffe9cf', keyPosition: [3, 8, 5] },
      hdri: 'media/hdri/teal.hdr', hdriIntensity: 1.3, post: { bloom: 1, vignette: 0.45, grain: 0.05, exposure: 1.1 },
      preview: { position: [-2, 2.4, 8], target: [0, 2.4, -8], fov: 55 },
      props: [p('obsidian_floor'), p('tx_orb', [0.4, 1.5, 0.6], 1.2), p('light_shaft', [-6, 0, -10], 1), ...monoliths(19, 12, 24, 2),
        ...Array.from({ length: 60 }, (_, i) => p('mempool_bubble', [Math.sin(i * 2.4) * (3 + (i % 7) * 2.2), 0.8 + ((i * 7) % 13) * 0.55, -2 - ((i * 5) % 17) * 1.6], 0.5 + ((i * 3) % 5) * 0.22)),
        ...scatter(31, ['crystal'], 6, 6, 16, [0.6, 1.2]), p('motes', [0, 0, -6], 1.3)],
    },
    {
      id: 'mining_hall', name: 'Mining Hall', description: 'A vast forge-lit hall: rows of glowing miner rigs and hash blocks, embers drifting under towering pylons.',
      ...dark, fog: { color: '#120804', near: 10, far: 55 }, background: '#050302', lighting: { ambient: 0.18, key: 1.2, keyColor: '#ffb070', keyPosition: [4, 10, 2] },
      hdri: 'media/hdri/forge.hdr', hdriIntensity: 1.2, post: { bloom: 1, vignette: 0.5, grain: 0.07, exposure: 1.05 },
      preview: { position: [3, 2.6, 9], target: [0, 1.4, -8], fov: 55 },
      props: [p('obsidian_floor'), ...monoliths(77, 12, 24, 2),
        ...Array.from({ length: 14 }, (_, i) => p('hash_block', [((i % 7) - 3) * 2.1, 0, -3 - Math.floor(i / 7) * 3], 1 + (i % 3) * 0.25, i * 13)),
        p('hash_block', [0.9, 0, 0.4], 0.8, 20),
        ...row('miner_rig', [-9, 0, 2], [0, 0, -3], 7, 1, 90), ...row('miner_rig', [9, 0, 2], [0, 0, -3], 7, 1, -90),
        ...row('pylon', [-12, 0, 0], [0, 0, -8], 4, 0.8), ...row('pylon', [12, 0, 0], [0, 0, -8], 4, 0.8), p('embers', [0, 0, -4], 1.2), p('embers', [0, 0, -16], 1.6)],
    },
    {
      id: 'block_found', name: 'Block Found', description: 'The winning block on a glowing dais: a golden shaft of light opens from above and the transaction is sealed inside.',
      ...dark, fog: { color: '#0c0804', near: 12, far: 60 }, background: '#120c06', lighting: { ambient: 0.3, key: 1.8, keyColor: '#fff2dd', keyPosition: [0, 12, 4] },
      hdri: 'media/hdri/gold.hdr', hdriIntensity: 1.2, post: { bloom: 1.3, vignette: 0.45, grain: 0.05, exposure: 1.1 },
      preview: { position: [0, 2.8, 9], target: [0, 1.8, -3], fov: 52 },
      props: [p('obsidian_floor'), p('pedestal', [0, 0, -3]), ...monoliths(77, 14, 22, 2), p('hash_block', [0, 0.9, -3], 1.6), p('light_shaft', [0, 0, -3], 1.6), p('tx_orb', [0, 2.3, -3], 1.4),
        p('halo_ring', [0, 3.6, -3], 1), p('halo_ring', [0, 5, -3], 1.4), ...ring('crystal_gold', 8, 5.2, 0, 0.8, -3, 0.2, false),
        ...Array.from({ length: 6 }, (_, i) => p('hash_block', [(i - 2.5) * 2.6, 0, -9], 1, i * 17)), p('embers', [0, 0, -3])],
    },
  ].map((e) => [e.id, SCHEMAS.environment.parse({ color: '#888888', ...e })]),
);

if (import.meta.url === `file://${process.argv[1]}`) {
  genSkies();
  genSetDressing();
  for (const a of Object.values(SET_ASSETS)) saveDoc({ kind: 'asset', id: a.id }, a);
  for (const e of Object.values(ENVIRONMENTS)) {
    // keep any hand-placed character marks
    const file = path.join(PROJECT_DIR, 'environments', `${e.id}.json`);
    const marks = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).marks ?? []) : [];
    saveDoc({ kind: 'environment', id: e.id }, { ...e, marks: e.marks.length ? e.marks : marks });
  }
  console.log(`✓ ${Object.keys(ENVIRONMENTS).length} environments, ${Object.keys(SET_ASSETS).length} set assets, ${Object.keys(SKIES).length} skies`);
}
