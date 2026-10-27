/**
 * Season 1 v3 world: the Bitcoin world (a node's city of light, its core with the timechain
 * helix, the network void between nodes) and the human world (a dark small town where only the
 * Bitcoin parts give off light). No colour anywhere: white, grey and black, brightness = value.
 *
 * Visual language follows the Anatomy of Bitcoin explorer (../explorer/js):
 *   block       glass cube 3×3×3 + header bar + tx slabs        (block.js)
 *   timechain   descending helix of discs                       (blockchain.js)
 *   mempool     flat spiral of slabs                            (mempool.js)
 *   node        translucent membrane sphere with organelles     (node.js)
 *   network     dots + faint lines between nodes                (network.js)
 *
 *   genV3World()        set meshes + character meshes (called by `npm run seed` and `npm run gen:envs`)
 *   V3_ASSETS / V3_ENVIRONMENTS
 */
import * as THREE from 'three';
import type { Asset, Environment, Vec3 } from '../src/model/schema';
import { SCHEMAS } from '../src/model/schema';
import { mulberry32 } from '../src/score/compose';
import { writeGlb, type GlbMaterial, type GlbPart } from './lib/glb';
import { merge, placed, write } from './gen-assets';
import { character } from './gen-story-assets';

type RGB = [number, number, number];
const W = (k: number): RGB => [k, k, k];
const glow = (name: string, k = 1, strength = 2, opacity?: number): GlbMaterial => ({ name, color: W(k), emissive: W(k), emissiveStrength: strength, ...(opacity ? { opacity } : {}) });
const GLASS: GlbMaterial = { name: 'white_glass', color: [0.96, 0.97, 1], roughness: 0.05, metallic: 0.05, opacity: 0.18 };
const WHITE: GlbMaterial = { name: 'white', color: W(0.95), roughness: 0.35 };
const PALE: GlbMaterial = { name: 'pale', color: W(0.86), roughness: 0.5 };
const DARK: GlbMaterial = { name: 'night', color: W(0.035), roughness: 0.9 };
const DARKER: GlbMaterial = { name: 'night_deep', color: W(0.015), roughness: 0.95 };
const sphere = (r: number, x = 0, y = 0, z = 0, w = 24, h = 16) => placed(new THREE.SphereGeometry(r, w, h), x, y, z);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0) => placed(new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry);
const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, seg = 24) => placed(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z);
const glb = (name: string, parts: GlbPart[]) => write(`media/meshes/${name}.glb`, writeGlb(name, parts));

// ---------------------------------------------------------------- sets

function genSets() {
  const rnd = mulberry32(1729);

  // ---- Bitcoin world (inside a node): bright, white, glass
  glb('light_floor', [{ name: 'floor', geometry: new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), material: { name: 'white_floor', color: W(0.72), roughness: 0.25, metallic: 0.1 } }]);
  // a block of the city: a cluster of white glass towers with brighter window bands (data)
  const towers = (seed: number) => {
    const r = mulberry32(seed);
    const solid: THREE.BufferGeometry[] = [];
    const bands: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const w = 1.2 + r() * 1.6;
      const h = 4 + r() * 14;
      const x = (r() - 0.5) * 7;
      const z = (r() - 0.5) * 7;
      solid.push(box(w, h, w, x, h / 2, z));
      for (let y = 1; y < h; y += 0.9 + r()) bands.push(box(w * 1.02, 0.06, w * 1.02, x, y, z));
    }
    return [
      { name: 'towers', geometry: merge(solid), material: { ...GLASS, name: 'tower_glass', opacity: 0.32 } },
      { name: 'bands', geometry: merge(bands), material: glow('data_bands', 1, 0.7) },
    ];
  };
  glb('city_block', towers(3));
  glb('city_block_b', towers(11));
  // streams of data: thin bright filaments arching between towers
  glb('data_stream', [{ name: 'stream', geometry: merge(Array.from({ length: 14 }, (_, i) => {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-12, 3 + (i % 4), (i - 7) * 1.4), new THREE.Vector3(0, 9 + (i % 5) * 1.2, (i - 7) * 1.1), new THREE.Vector3(12, 3 + ((i + 2) % 4), (i - 7) * 1.4));
    return new THREE.TubeGeometry(curve, 40, 0.025, 4, false);
  })), material: glow('stream', 1, 1.4, 0.6) }]);
  // the timechain: a descending helix of discs (blockchain.js), with a white spine
  {
    const discs: THREE.BufferGeometry[] = [];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 90; i++) {
      const t = i * 0.16;
      const x = Math.cos(t * 2.2) * 3.2;
      const z = Math.sin(t * 2.2) * 3.2;
      const y = 14 - t * 0.9;
      pts.push(new THREE.Vector3(x, y, z));
      discs.push(placed(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), x, y, z));
    }
    glb('timechain_helix', [
      { name: 'discs', geometry: merge(discs), material: glow('blocks', 0.9, 0.6) },
      { name: 'spine', geometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.03, 6, false), material: glow('spine', 1, 1.5) },
    ]);
  }
  // the core: a translucent sphere at the heart of the node (also the portal to the human world)
  glb('core_sphere', [
    { name: 'shell', geometry: sphere(1, 0, 0, 0, 64, 48), material: { ...GLASS, name: 'core_glass', opacity: 0.14, doubleSided: true } },
    { name: 'rings', geometry: merge([new THREE.TorusGeometry(1.01, 0.004, 6, 128), new THREE.TorusGeometry(1.01, 0.004, 6, 128).rotateX(Math.PI / 2), new THREE.TorusGeometry(1.01, 0.004, 6, 128).rotateY(Math.PI / 2)]), material: glow('core_rings', 1, 3) },
  ]);
  // a node seen from the void: membrane sphere with organelles on a Fibonacci sphere (node.js)
  {
    const organelles: THREE.BufferGeometry[] = [];
    const n = 60;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rr = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      organelles.push(box(0.09, 0.09, 0.03, Math.cos(a) * rr * 0.72, y * 0.72, Math.sin(a) * rr * 0.72));
    }
    glb('node_sphere', [
      { name: 'membrane', geometry: sphere(1, 0, 0, 0, 64, 48), material: { ...GLASS, name: 'membrane', opacity: 0.2, doubleSided: true } },
      { name: 'organelles', geometry: merge(organelles), material: glow('organelles', 1, 2) },
      { name: 'heart', geometry: sphere(0.12, 0, 0, 0, 16, 12), material: glow('node_heart', 1, 4) },
    ]);
  }
  // a block: glass cube with a header bar on top (block.js); its contents are the nonce cubes, which are characters
  {
    glb('block_cube', [
      { name: 'glass', geometry: box(3, 3, 3, 0, 1.5, 0), material: { ...GLASS, name: 'block_glass', opacity: 0.16, doubleSided: true } },
      { name: 'edges', geometry: merge([-1.5, 1.5].flatMap((a) => [-1.5, 1.5].flatMap((b) => [box(3, 0.03, 0.03, 0, 1.5 + a, b), box(0.03, 3, 0.03, a, 1.5, b), box(0.03, 0.03, 3, a, 1.5 + b, 0)]))), material: glow('block_edges', 1, 2) },
      { name: 'header', geometry: box(2.46, 0.12, 0.3, 0, 3.08, 0), material: glow('header', 1, 4) },
    ]);
  }
  // the mempool: a flat spiral of waiting slabs (mempool.js), brighter = higher fee
  {
    const hi: THREE.BufferGeometry[] = [];
    const lo: THREE.BufferGeometry[] = [];
    let a = 0;
    for (let i = 0; i < 520; i++) {
      const r = 2 + a * 0.32;
      a += 0.3 / r * 3.2;
      const h = 0.06 + rnd() * 0.5;
      const g = box(0.56, h, 0.07, Math.cos(a) * r, 1.2 - h / 2, Math.sin(a) * r, -a);
      (rnd() < 0.35 ? hi : lo).push(g);
    }
    glb('mempool_spiral', [
      { name: 'high_fee', geometry: merge(hi), material: glow('fee_high', 1, 1.4) },
      { name: 'low_fee', geometry: merge(lo), material: { name: 'fee_low', color: W(0.55), roughness: 0.4, opacity: 0.7 } },
    ]);
  }
  // resting coins in the UTXO district: glowing spheres sized by value
  glb('utxo_field', [{ name: 'coins', geometry: merge(Array.from({ length: 160 }, () => {
    const a = rnd() * Math.PI * 2;
    const d = 4 + rnd() * 26;
    const r = 0.06 + Math.pow(rnd(), 3) * 0.6;
    return sphere(r, Math.cos(a) * d, r, Math.sin(a) * d - 6, 12, 8);
  })), material: glow('utxos', 1, 3.5) }]);
  // the miner's console in the core: a desk of dim slabs
  glb('hash_console', [
    { name: 'desk', geometry: merge([box(2.4, 0.9, 0.8, 0, 0.45, 0), box(2.6, 0.06, 1, 0, 0.93, 0)]), material: PALE },
    { name: 'screen', geometry: box(2, 0.9, 0.04, 0, 1.5, -0.3), material: glow('hash_screen', 1, 2.2) },
  ]);
  // the Validator's gate: two pillars and a scanning bar
  glb('validator_gate', [
    { name: 'pillars', geometry: merge([box(0.6, 6, 0.6, -2.6, 3, 0), box(0.6, 6, 0.6, 2.6, 3, 0), box(5.8, 0.5, 0.7, 0, 6.2, 0)]), material: WHITE },
    { name: 'scan', geometry: box(4.6, 0.04, 0.08, 0, 2.2, 0), material: glow('scan', 1, 5) },
  ]);

  // ---- the network void (between nodes): a constellation of node dots and faint links
  {
    const r = mulberry32(21);
    const pts: THREE.Vector3[] = Array.from({ length: 140 }, () => new THREE.Vector3((r() - 0.5) * 120, (r() - 0.5) * 50, -20 - r() * 120));
    const dots = merge(pts.map((p) => sphere(0.12 + r() * 0.25, p.x, p.y, p.z, 8, 6)));
    const links: THREE.BufferGeometry[] = [];
    for (let i = 0; i < pts.length; i++) for (let k = 0; k < 2; k++) {
      const j = Math.floor(r() * pts.length);
      const c = new THREE.LineCurve3(pts[i], pts[j]);
      links.push(new THREE.TubeGeometry(c, 1, 0.02, 3, false));
    }
    glb('network_web', [
      { name: 'nodes', geometry: dots, material: glow('peer_dots', 1, 4) },
      { name: 'links', geometry: merge(links), material: glow('peer_links', 1, 1.2, 0.12) },
    ]);
  }
  // the Rewriter's hidden chain: a line of black blocks with no light at all
  glb('dark_chain', [{ name: 'blocks', geometry: merge(Array.from({ length: 9 }, (_, i) => box(2.6, 2.6, 2.6, i * 3.4, 1.3 + Math.sin(i) * 0.3, -i * 1.2, i * 0.2))), material: { name: 'void_black', color: W(0.005), roughness: 0.3, metallic: 0.6 } }]);

  // ---- the human world: dark; only Bitcoin parts emit light
  glb('night_ground', [{ name: 'ground', geometry: new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), material: DARKER }]);
  const house = (w: number, h: number, d: number) => merge([box(w, h, d, 0, h / 2, 0), placed(new THREE.ConeGeometry(Math.max(w, d) * 0.75, h * 0.5, 4), 0, h + h * 0.25, 0, 0, Math.PI / 4)]);
  glb('house', [{ name: 'house', geometry: house(4, 3, 5), material: DARK }]);
  glb('house_tall', [{ name: 'house', geometry: house(5, 7, 5), material: DARK }]);
  glb('car', [{ name: 'car', geometry: merge([box(1.8, 0.7, 4.2, 0, 0.55, 0), box(1.6, 0.6, 2.2, 0, 1.15, -0.2), ...[-1, 1].flatMap((sx) => [-1.3, 1.3].map((z) => placed(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14), sx * 0.85, 0.34, z, 0, 0, Math.PI / 2)))]), material: DARK }]);
  glb('street_lamp', [{ name: 'lamp', geometry: merge([cyl(0.06, 0.08, 4.5, 0, 2.25, 0, 8), box(0.8, 0.08, 0.1, 0.35, 4.5, 0)]), material: DARK }]); // off: the town's lights are out
  glb('power_line', [{ name: 'poles', geometry: merge([cyl(0.1, 0.12, 8, 0, 4, 0, 8), box(1.6, 0.1, 0.1, 0, 7.6, 0), new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.7, 7.6, 0), new THREE.Vector3(-0.7, 6.4, -12), new THREE.Vector3(-0.7, 7.6, -24)), 20, 0.015, 3, false), new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.7, 7.6, 0), new THREE.Vector3(0.7, 6.4, -12), new THREE.Vector3(0.7, 7.6, -24)), 20, 0.015, 3, false)]), material: DARK }]);
  // the garage: dark shell, light leaking from the door seam and the high window
  glb('garage', [
    { name: 'shell', geometry: merge([box(7, 3.6, 8, 0, 1.8, 0), placed(new THREE.CylinderGeometry(4.2, 4.2, 8, 3, 1, false, 0, Math.PI), 0, 3.6, 0, Math.PI / 2, 0, Math.PI / 2).scale(1, 0.35, 1)]), material: DARK },
    { name: 'seam', geometry: merge([box(4, 0.05, 0.05, 0, 0.05, 4.01), box(0.05, 3, 0.05, -2, 1.5, 4.01), box(0.05, 3, 0.05, 2, 1.5, 4.01), box(1.6, 0.4, 0.05, 2.2, 3, 4.01)]), material: glow('garage_seam', 1, 5) },
  ]);
  // inside the garage: rig racks with bright fans, the node box with one LED, a phone
  glb('mining_rig', [
    { name: 'rack', geometry: merge([box(1.2, 1.8, 0.6, 0, 0.9, 0), box(1.3, 0.05, 0.7, 0, 1.82, 0)]), material: DARK },
    { name: 'fans', geometry: merge(Array.from({ length: 6 }, (_, i) => placed(new THREE.RingGeometry(0.1, 0.16, 20), -0.3 + (i % 2) * 0.6, 0.35 + Math.floor(i / 2) * 0.55, 0.31))), material: { ...glow('fan_glow', 1, 4), doubleSided: true } },
  ]);
  glb('node_box', [
    { name: 'box', geometry: box(0.36, 0.08, 0.26, 0, 0.04, 0), material: DARK },
    { name: 'led', geometry: sphere(0.012, 0.15, 0.06, 0.13, 8, 6), material: glow('node_led', 1, 8) },
  ]);
  glb('shelf', [{ name: 'shelf', geometry: merge([box(2.4, 0.05, 0.4, 0, 1.2, 0), box(2.4, 0.05, 0.4, 0, 1.8, 0), box(0.05, 1.9, 0.4, -1.2, 0.95, 0), box(0.05, 1.9, 0.4, 1.2, 0.95, 0)]), material: DARK }]);
  glb('chair_desk', [{ name: 'furniture', geometry: merge([box(1.6, 0.05, 0.8, 0, 0.75, 0), box(0.05, 0.75, 0.75, -0.75, 0.375, 0), box(0.05, 0.75, 0.75, 0.75, 0.375, 0), box(0.5, 0.05, 0.5, 0, 0.45, 0.8), box(0.5, 0.6, 0.05, 0, 0.75, 1.05)]), material: DARK }]);
  glb('phone', [{ name: 'screen', geometry: box(0.08, 0.005, 0.16, 0, 0.003, 0), material: glow('phone_screen', 1, 6) }]);
  // the river dam that powers the town: dark concrete, a turbine house with a bright doorway
  glb('river_dam', [
    { name: 'wall', geometry: merge([box(30, 9, 3, 0, 4.5, 0), box(6, 3, 4, 8, 10.5, 0)]), material: DARK },
    { name: 'turbine_light', geometry: merge([box(1.2, 1.8, 0.05, 8, 9.9, 2.01), ...Array.from({ length: 5 }, (_, i) => box(0.6, 0.08, 0.05, -10 + i * 2.5, 7.8, 1.51))]), material: glow('dam_lights', 1, 4) },
    { name: 'water', geometry: new THREE.PlaneGeometry(30, 40).rotateX(-Math.PI / 2).translate(0, 0.05, 22), material: { name: 'river', color: W(0.05), roughness: 0.05, metallic: 0.4 } },
  ]);
  // light particles: emitted energy, a few or many
  const motes = (seed: number, n: number, spread: number, height: number) => {
    const r = mulberry32(seed);
    return merge(Array.from({ length: n }, () => sphere(0.01 + r() * 0.03, (r() - 0.5) * spread, r() * height, (r() - 0.5) * spread, 6, 4)));
  };
  glb('light_particles', [{ name: 'particles', geometry: motes(4, 140, 18, 8), material: glow('particles', 1, 6) }]);
  glb('light_particles_few', [{ name: 'particles', geometry: motes(8, 30, 10, 4), material: glow('particles_few', 1, 6) }]);
}

// ---------------------------------------------------------------- characters

const bright = (name: string, k = 1, s = 0.9): GlbMaterial => ({ name, color: W(k), roughness: 0.5, emissive: W(k), emissiveStrength: s });

function genCast() {
  // the Coinbase: a silent giant, brightest thing in the season (~9m)
  character('coinbase', {
    headR: 2.2, headY: 7.5, eye: 0.11, eyeSpread: 0.3, smile: 0.22, brows: 'soft',
    body: [new THREE.SphereGeometry(1.7, 40, 28).scale(1.1, 1.25, 0.9).translate(0, 3.9, 0), placed(new THREE.CapsuleGeometry(0.5, 0.8, 6, 16), 0, 5.6, 0)],
    arms: { at: [1.75, 4.8, 0], r: 0.38, len: 2.7, splay: 0.14, end: 0.42 }, legs: { at: [0.7, 1.9, 0], r: 0.48, len: 1.9, end: 0.5 },
  }, bright('coinbase_light', 1, 0.9));

  // the crew (inside the miner's node): program parts, not coins. Matte graphite bodies, flat
  // machine heads (box / cylinder) and one glowing tool or badge each; coins are glowing spheres.
  const crewSkin = (name: string, k: number): GlbMaterial => ({ name, color: W(k), roughness: 0.55, metallic: 0.35 });
  const badge = (y: number, z: number, w = 0.1) => ({ name: 'badge', geometry: box(w, w * 0.6, 0.02, 0, y, z), material: glow('crew_badge', 1, 4) });
  // the Node: a floating eye of light with orbit rings; its body is the whole sphere around us
  character('node_avatar', {
    headR: 0.8, headY: 2.4, eye: 0.13, eyeSpread: 0.3, smile: 0.2, brows: 'soft',
    body: [],
    arms: { at: [0.1, 2.0, 0], r: 0.01, len: 0.02 }, legs: { at: [0.05, 1.7, 0], r: 0.01, len: 0.02 },
    extra: [{ name: 'orbits', geometry: merge([new THREE.TorusGeometry(1.15, 0.015, 6, 96).rotateX(1.2).translate(0, 2.4, 0), new THREE.TorusGeometry(1.35, 0.012, 6, 96).rotateX(-1).rotateY(0.6).translate(0, 2.4, 0)]), material: glow('node_orbits', 1, 3) }],
    head: 'cylinder',
  }, crewSkin('node_shell', 0.42));
  // the Validator: tall, stern, a crest like a gate
  character('validator', {
    headR: 0.22, headY: 1.5, eye: 0.13, eyeSpread: 0.3, smile: 0.16, brows: 'determined',
    body: [placed(new THREE.CapsuleGeometry(0.15, 0.7, 6, 16), 0, 0.92, 0)],
    arms: { at: [0.19, 1.2, 0], r: 0.04, len: 0.58, splay: 0.08, end: 0.05 }, legs: { at: [0.07, 0.5, 0], r: 0.055, len: 0.5, end: 0.06 },
    extra: [{ name: 'crest', geometry: merge([box(0.05, 0.22, 0.3, 0, 1.8, 0), box(0.5, 0.04, 0.06, 0, 1.2, 0.15)]), material: glow('validator_crest', 1, 3) }, badge(1.05, 0.16)],
    head: 'box',
  }, crewSkin('validator_skin', 0.3));
  // the Gossip: small and quick, two antennae
  character('gossip', {
    headR: 0.2, headY: 0.56, eye: 0.17, eyeSpread: 0.36, smile: 0.34, brows: 'soft',
    body: [placed(new THREE.CapsuleGeometry(0.08, 0.12, 6, 12), 0, 0.26, 0)],
    arms: { at: [0.09, 0.32, 0], r: 0.025, len: 0.14, splay: 0.4, end: 0.03 }, legs: { at: [0.04, 0.16, 0], r: 0.03, len: 0.16, end: 0.035 },
    extra: [{ name: 'antennae', geometry: merge([-1, 1].flatMap((s) => [placed(new THREE.CylinderGeometry(0.006, 0.006, 0.25, 5), s * 0.08, 0.82, 0, 0, 0, -s * 0.3), sphere(0.03, s * 0.12, 0.94, 0, 8, 6)])), material: glow('gossip_tips', 1, 5) }, badge(0.3, 0.085, 0.07)],
    head: 'cylinder',
  }, crewSkin('gossip_skin', 0.4));
  // the Hasher: stocky foreman with big fists
  character('hasher', {
    headR: 0.27, headY: 1.02, eye: 0.12, eyeSpread: 0.32, smile: 0.22, brows: 'determined',
    body: [new THREE.SphereGeometry(0.4, 28, 20).scale(1.15, 1, 0.9).translate(0, 0.6, 0)],
    arms: { at: [0.42, 0.78, 0], r: 0.075, len: 0.42, splay: 0.3, end: 0.1 }, legs: { at: [0.15, 0.28, 0], r: 0.08, len: 0.28, end: 0.09 },
    extra: [{ name: 'visor', geometry: box(0.46, 0.06, 0.02, 0, 1.14, 0.27), material: glow('hasher_visor', 1, 4) }, badge(0.7, 0.37, 0.14)],
    head: 'box',
  }, crewSkin('hasher_skin', 0.28));
  // the Mempool host: round and welcoming, a slab under one arm
  character('mempool_host', {
    headR: 0.28, headY: 0.98, eye: 0.14, eyeSpread: 0.34, smile: 0.34, brows: 'soft',
    body: [new THREE.SphereGeometry(0.42, 28, 20).translate(0, 0.46, 0)],
    arms: { at: [0.38, 0.62, 0], r: 0.055, len: 0.3, splay: 0.5, end: 0.06 }, legs: { at: [0.14, 0.16, 0], r: 0.065, len: 0.16, end: 0.07 },
    extra: [{ name: 'slab', geometry: box(0.06, 0.4, 0.3, -0.48, 0.55, 0.05), material: glow('host_slab', 1, 3) }, badge(0.62, 0.41, 0.12)],
    head: 'cylinder',
  }, crewSkin('host_skin', 0.38));
  // the Script clerk: thin, round spectacles, reads locks
  character('script_clerk', {
    headR: 0.2, headY: 1.18, eye: 0.14, eyeSpread: 0.33, smile: 0.18, brows: 'soft',
    body: [placed(new THREE.CapsuleGeometry(0.09, 0.62, 6, 14), 0, 0.68, 0)],
    arms: { at: [0.11, 0.92, 0], r: 0.03, len: 0.45, splay: 0.1, end: 0.035 }, legs: { at: [0.045, 0.38, 0], r: 0.04, len: 0.38, end: 0.045 },
    extra: [{ name: 'spectacles', geometry: merge([-1, 1].map((s) => placed(new THREE.TorusGeometry(0.055, 0.007, 6, 24), s * 0.066, 1.2, 0.215))), material: glow('specs', 1, 4) }, badge(0.9, 0.1, 0.08)],
    head: 'box',
  }, crewSkin('clerk_skin', 0.34));

  // the villains and others
  // the Rewriter: a tall black silhouette; only two glints for eyes
  character('rewriter', {
    headR: 0.3, headY: 2.05, eye: 0.11, eyeSpread: 0.3, brows: 'determined',
    body: [placed(new THREE.CapsuleGeometry(0.2, 1.1, 6, 16), 0, 1.25, 0), new THREE.ConeGeometry(0.55, 1.2, 20).translate(0, 0.6, 0)],
    arms: { at: [0.24, 1.65, 0], r: 0.045, len: 0.95, splay: 0.06, end: 0.05 }, legs: { at: [0.1, 0.6, 0], r: 0.06, len: 0.6, end: 0.07 },
  }, { name: 'void_skin', color: W(0.01), roughness: 0.25, metallic: 0.5 });
  // the Counterfeiter: over-bright, glossy, a ring of fake coins
  character('counterfeiter', {
    headR: 0.21, headY: 1.3, eye: 0.13, eyeSpread: 0.3, smile: 0.38, brows: 'determined',
    body: [placed(new THREE.CapsuleGeometry(0.1, 0.62, 6, 14), 0, 0.74, 0), new THREE.ConeGeometry(0.24, 0.5, 24).translate(0, 0.5, 0)],
    arms: { at: [0.12, 1.02, 0], r: 0.03, len: 0.56, splay: 0.12, end: 0.04 }, legs: { at: [0.06, 0.4, 0], r: 0.04, len: 0.4, end: 0.05 },
    extra: [{ name: 'fake_coins', geometry: merge(Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2;
      return placed(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 20), Math.cos(a) * 0.34, 1.62 + Math.sin(a * 2) * 0.03, Math.sin(a) * 0.34, Math.PI / 2, a, 0);
    })), material: { name: 'fake_shine', color: W(1), metallic: 1, roughness: 0.1, emissive: W(1), emissiveStrength: 2.5 } }],
  }, { name: 'gloss', color: W(1), roughness: 0.1, metallic: 0.6, emissive: W(1), emissiveStrength: 1.3 });
  // Pip: a tiny round coin, very much alive
  character('pip', {
    headR: 0.18, headY: 0.29, eye: 0.2, eyeSpread: 0.38, smile: 0.36, brows: 'soft',
    body: [placed(new THREE.CapsuleGeometry(0.05, 0.05, 4, 10), 0, 0.1, 0)],
    arms: { at: [0.055, 0.12, 0], r: 0.016, len: 0.06, splay: 0.6, end: 0.02 }, legs: { at: [0.025, 0.06, 0], r: 0.02, len: 0.06, end: 0.022 },
  }, bright('pip_light', 1, 1.2));
  // humans: dark, unlit bodies; the world only shows them by the light of their Bitcoin things
  const HUMAN: GlbMaterial = { name: 'human', color: W(0.025), roughness: 0.9 };
  const human = (name: string, extra: GlbPart[] = []) =>
    character(name, {
      headR: 0.11, headY: 1.62, eye: 0.12, eyeSpread: 0.36, smile: 0.26, brows: 'soft',
      body: [placed(new THREE.CapsuleGeometry(0.15, 0.48, 6, 16), 0, 1.18, 0), placed(new THREE.CapsuleGeometry(0.04, 0.08, 4, 8), 0, 1.47, 0)],
      arms: { at: [0.19, 1.43, 0], r: 0.04, len: 0.62, splay: 0.08, end: 0.045 }, legs: { at: [0.08, 0.86, 0], r: 0.06, len: 0.84, end: 0.07 },
      extra,
    }, HUMAN);
  human('ana', [{ name: 'phone_glow', geometry: box(0.07, 0.13, 0.01, 0.24, 0.9, 0.12), material: glow('phone', 1, 5) }]);
  human('thief', [{ name: 'hood', geometry: sphere(0.13, 0, 1.64, -0.02, 16, 12).scale(1, 1.1, 1.1), material: HUMAN }, { name: 'screen_glow', geometry: box(0.07, 0.13, 0.01, -0.24, 0.9, 0.12), material: glow('thief_phone', 1, 5) }]);

  // the nonce cubes: plain glowing cubes that shuffle while the Hasher searches
  glb('nonce_cube', [{ name: 'cube', geometry: box(0.5, 0.5, 0.5, 0, 0.25, 0), material: { ...glow('nonce', 1, 0.7), opacity: 0.85 } }]);
}

export function genV3World() {
  genSets();
  genCast();
}

// ---------------------------------------------------------------- assets

const A = (id: string, name: string, kind: Asset['kind'], description: string, tags: string[]) =>
  [id, SCHEMAS.asset.parse({ id, name, kind, description, color: tags.includes('human') ? '#202020' : '#f2f2f2', mesh: `media/meshes/${id}.glb`, tags })] as const;

export const V3_ASSETS: Record<string, Asset> = Object.fromEntries([
  A('light_floor', 'Light Floor', 'set', 'Glossy white ground of the Bitcoin world.', ['bitcoin']),
  A('city_block', 'City Block', 'set', 'A cluster of white glass towers banded with bright data lines.', ['bitcoin']),
  A('city_block_b', 'City Block B', 'set', 'A second, different cluster of glass towers.', ['bitcoin']),
  A('data_stream', 'Data Stream', 'fx', 'Bright filaments arching over the city: data moving.', ['bitcoin']),
  A('timechain_helix', 'Timechain Helix', 'set', 'Descending helix of block discs with a white spine (explorer blockchain page).', ['bitcoin', 'core']),
  A('core_sphere', 'Core Sphere', 'set', 'Translucent sphere at the centre of the node: the timechain lives in it, and it is the portal to the human world.', ['bitcoin', 'core']),
  A('node_sphere', 'Node Sphere', 'set', 'A node seen from the void: membrane sphere with organelles (explorer node page).', ['bitcoin', 'void']),
  A('block_cube', 'Block', 'prop', 'Glass cube with a header bar and transaction slabs (explorer block page).', ['bitcoin']),
  A('mempool_spiral', 'Mempool Spiral', 'set', 'Flat spiral of waiting transactions; brighter = higher fee (explorer mempool page).', ['bitcoin']),
  A('utxo_field', 'UTXO Field', 'fx', 'Resting coins: glowing spheres sized by value.', ['bitcoin']),
  A('hash_console', 'Hash Console', 'prop', 'The Hasher’s desk and screen.', ['bitcoin', 'core']),
  A('validator_gate', 'Validator Gate', 'set', 'Two pillars and a scanning bar every transaction passes through.', ['bitcoin']),
  A('network_web', 'Network Web', 'fx', 'Constellation of nodes and faint links (explorer network page).', ['void']),
  A('dark_chain', 'Dark Chain', 'set', 'The Rewriter’s hidden chain: black blocks, no light at all.', ['void']),
  A('night_ground', 'Night Ground', 'set', 'Unlit ground of the human world.', ['human']),
  A('house', 'House', 'set', 'Dark house.', ['human']),
  A('house_tall', 'Tall House', 'set', 'Dark two-storey building.', ['human']),
  A('car', 'Car', 'vehicle', 'Dark parked car.', ['human']),
  A('street_lamp', 'Street Lamp', 'prop', 'Street lamp, switched off.', ['human']),
  A('power_line', 'Power Line', 'set', 'Pole with two sagging cables.', ['human']),
  A('garage', 'Garage', 'set', 'Dark workshop; white light leaks from the door seam and window.', ['human']),
  A('mining_rig', 'Mining Rig', 'prop', 'Dark rack, bright fans.', ['human', 'bitcoin']),
  A('node_box', 'Node Box', 'prop', 'Small dark box with one white LED: the miner’s node.', ['human', 'bitcoin']),
  A('shelf', 'Shelf', 'prop', 'Dark shelving.', ['human']),
  A('chair_desk', 'Desk & Chair', 'prop', 'Dark desk and chair.', ['human']),
  A('phone', 'Phone', 'prop', 'A phone face-up, screen glowing.', ['human', 'bitcoin']),
  A('river_dam', 'River Dam', 'set', 'Small dam that powers the town; the turbine house glows.', ['human']),
  A('light_particles', 'Light Particles', 'fx', 'Many points of emitted light.', ['bitcoin', 'human']),
  A('light_particles_few', 'Few Particles', 'fx', 'A few points of emitted light.', ['bitcoin', 'human']),
]);

// ---------------------------------------------------------------- environments

type P = Environment['props'][number];
const p = (assetId: string, position: Vec3 = [0, 0, 0], scale = 1, rotationY = 0): P => ({ assetId, position, scale, rotationY });
const cityRing = (seed: number, n: number, rMin: number, rMax: number, cz = -4): P[] => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r() * 0.4;
    const d = rMin + r() * (rMax - rMin);
    return p(i % 2 ? 'city_block' : 'city_block_b', [Math.cos(a) * d, 0, Math.sin(a) * d + cz], 0.8 + r() * 0.8, r() * 90);
  }).filter((q) => !(Math.abs(q.position[0]) < 5 && q.position[2] > -10));
};
// the Bitcoin world is bright: white ground, pale sky, soft white light
const BTC = { lighting: { ambient: 0.35, key: 0.9, keyColor: '#ffffff', keyPosition: [4, 10, 6] as Vec3 }, post: { bloom: 0.25, vignette: 0.35, grain: 0.03, exposure: 0.55 } };
// the human world is dark: almost no ambient, a faint moon; light comes from Bitcoin things
const HUMAN = { lighting: { ambient: 0.06, key: 0.25, keyColor: '#ffffff', keyPosition: [-6, 12, 4] as Vec3 }, post: { bloom: 1.1, vignette: 0.55, grain: 0.07, exposure: 1 } };

export const V3_ENVIRONMENTS: Record<string, Environment> = Object.fromEntries(
  [
    {
      id: 'node_city', name: 'Node City', world: 'node', description: 'Inside the miner’s node: a city of white light. Glass towers banded with data, filaments of data overhead, the core glowing at the centre.',
      ...BTC, background: '#b9bdc3', fog: { color: '#c3c7cc', near: 30, far: 120 },
      preview: { position: [3, 2, 10], target: [0, 3, -10], fov: 55 },
      props: [p('light_floor'), ...cityRing(5, 22, 10, 40), p('data_stream', [0, 0, -12], 1.4), p('core_sphere', [0, 9, -40], 9), p('timechain_helix', [0, -1, -40], 0.9), p('validator_gate', [0, 0, -8]), p('light_particles', [0, 0, -6])],
    },
    {
      id: 'node_core', name: 'The Core', world: 'core', description: 'The heart of the node: inside the core sphere the timechain helix turns; the Hasher’s console faces the grid where cubes shuffle for the nonce.',
      ...BTC, background: '#aeb2b8', fog: { color: '#b6babf', near: 20, far: 90 },
      preview: { position: [0, 2.4, 9], target: [0, 3, -4], fov: 52 },
      props: [p('light_floor'), p('timechain_helix', [0, -2, -9], 1), p('core_sphere', [0, 5, -9], 14), p('hash_console', [3.2, 0, 1.8], 1, -30), p('block_cube', [0, 0, -3.2], 1), p('light_particles', [0, 0, -4])],
    },
    {
      id: 'utxo_district', name: 'UTXO District', world: 'node', description: 'Where unspent coins rest: a field of glowing spheres, brighter the more they hold, under the towers.',
      ...BTC, background: '#b4b8be', fog: { color: '#bdc1c6', near: 24, far: 100 },
      preview: { position: [2, 1.6, 8], target: [0, 1, -6], fov: 50 },
      props: [p('light_floor'), p('utxo_field'), ...cityRing(9, 16, 16, 44, -8), p('data_stream', [0, 2, -18], 1.2), p('light_particles_few', [0, 0, -2])],
    },
    {
      id: 'mempool_hall', name: 'Mempool', world: 'node', description: 'The waiting room: a vast flat spiral of waiting transactions, the bright ones bid more.',
      ...BTC, background: '#b2b6bc', fog: { color: '#babec3', near: 20, far: 90 },
      preview: { position: [0, 6, 14], target: [0, 0.6, -2], fov: 50 },
      props: [p('light_floor'), p('mempool_spiral', [0, 0, -4], 1.6), ...cityRing(13, 12, 26, 46, -6), p('light_particles', [0, 0, -2])],
    },
    {
      id: 'network_void', name: 'Network Void', world: 'void', description: 'Outside every node: black space strung with thousands of node spheres and faint links (explorer network page).',
      background: '#000000', fog: { color: '#000000', near: 60, far: 220 }, lighting: { ambient: 0.2, key: 0.6, keyColor: '#ffffff', keyPosition: [3, 8, 6] as Vec3 }, post: { bloom: 1.2, vignette: 0.45, grain: 0.05, exposure: 1.1 },
      preview: { position: [0, 2, 16], target: [0, 0, -30], fov: 55 },
      props: [p('network_web'), p('node_sphere', [0, 0, -14], 9), p('node_sphere', [-30, 6, -60], 6), p('node_sphere', [36, -8, -80], 7), p('node_sphere', [-12, -14, -110], 5), p('node_sphere', [18, 14, -130], 4)],
    },
    {
      id: 'dark_chain', name: 'The Dark Chain', world: 'void', description: 'A blind spot in the void where the Rewriter builds his hidden chain: blocks that give off no light.',
      background: '#000000', fog: { color: '#000000', near: 20, far: 90 }, lighting: { ambient: 0.12, key: 0.4, keyColor: '#ffffff', keyPosition: [2, 6, 4] as Vec3 }, post: { bloom: 1, vignette: 0.6, grain: 0.08, exposure: 1 },
      preview: { position: [-4, 2, 10], target: [10, 1.5, -6], fov: 50 },
      props: [p('network_web', [0, 0, 20], 1), p('dark_chain'), p('light_particles_few', [6, 0, -2])],
    },
    {
      id: 'town_night', name: 'Town at Night', world: 'human', description: 'A small town at the edge of a river, at night. Dark houses, dark cars, streetlights off. One garage glows.',
      ...HUMAN, background: '#010102', fog: { color: '#020203', near: 25, far: 110 },
      preview: { position: [-14, 9, 30], target: [6, 0, -6], fov: 45 },
      props: [p('night_ground'), p('garage', [8, 0, -6], 1, -20), p('house', [-6, 0, -4], 1, 10), p('house', [-14, 0, -10], 1.1, -5), p('house_tall', [-2, 0, -18], 1), p('house', [16, 0, -20], 1, 30), p('house_tall', [-22, 0, -24], 1.2), p('car', [3, 0, 1], 1, 80), p('car', [-9, 0, 3], 1, 95),
        p('street_lamp', [-3, 0, 4]), p('street_lamp', [6, 0, 5]), p('street_lamp', [-15, 0, 2]), p('power_line', [-26, 0, 6], 1, 90), p('river_dam', [40, 0, -60], 1, -40), p('light_particles_few', [8, 0, -2])],
    },
    {
      id: 'garage', name: 'The Garage', world: 'human', description: 'Inside Ana’s garage: rigs hum with bright fans, the node box blinks on a shelf, her phone glows on the desk. Everything else is dark.',
      ...HUMAN, background: '#010101', fog: { color: '#020202', near: 6, far: 26 }, lighting: { ambient: 0.02, key: 0.1, keyColor: '#ffffff', keyPosition: [2, 3, 3] as Vec3 },
      preview: { position: [1.8, 1.5, 4], target: [0, 1.1, -1], fov: 46 },
      props: [p('night_ground'), p('mining_rig', [-1.6, 0, -1.8], 1, 10), p('mining_rig', [-0.2, 0, -2.1], 1), p('mining_rig', [1.2, 0, -2], 1, -10), p('shelf', [2.8, 0, -1.2], 1, -60), p('node_box', [2.75, 1.25, -1.15], 1, -60), p('chair_desk', [0.4, 0, 0.6], 1, 180), p('phone', [0.2, 0.78, 0.5], 1, 20), p('light_particles_few', [0, 0, -1.5], 0.4)],
    },
    {
      id: 'river_dam', name: 'River Dam', world: 'human', description: 'The little dam that powers the town and Ana’s rigs. In a storm, its lights are the only lights.',
      ...HUMAN, background: '#010102', fog: { color: '#030304', near: 20, far: 90 },
      preview: { position: [-8, 4, 26], target: [4, 6, 0], fov: 50 },
      props: [p('night_ground', [0, -0.5, 0]), p('river_dam'), p('power_line', [-18, 0, 12], 1, 30), p('house', [-24, 0, 26], 1, 40), p('light_particles_few', [8, 8, 2], 0.8)],
    },
  ].map((e) => [e.id, SCHEMAS.environment.parse({ color: '#888888', ...e })]),
);
