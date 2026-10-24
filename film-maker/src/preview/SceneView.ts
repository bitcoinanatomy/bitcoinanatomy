/**
 * Three.js preview of a shot: environment (background, fog, lights, props),
 * characters and assets as glTF meshes (or coloured placeholders), and the shot camera.
 * "Pilot" mode hands the camera to OrbitControls so you can frame a new keyframe.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { mediaUrl } from '../lib/api';
import { applyFlatPalette, contactShadow, FLAT_DARK, FLAT_LIGHT, flatUniforms, GLOW_SLOTS, illustratedKey, isDarkHex, isPainted, lightningTrail, paintedSky, plantShadow, stylizeFlat, type FlatPalette, type GlowSource, type Look } from './look';
import type { Blocking, CameraKey, Environment, Expression, ExpressionKey, Pose, PoseKey, ProjectData, Shot, Vec3 } from '../model/schema';
import { EXPRESSIONS } from '../model/schema';
import { blockingFor, bodyPoseAt, expressionAt, poseAt } from '../model/timeline';

const loader = new GLTFLoader();

/** Neutral studio reflections so metallic PBR materials (gold, coins) don't render black. */
function studioEnv(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
}
const gltfCache = new Map<string, Promise<GLTF | null>>();
export function loadGltf(url: string) {
  if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url).catch(() => null));
  return gltfCache.get(url)!;
}

export interface SceneContent {
  envId?: string;
  assets: string[];
  characters: string[];
  positions?: Shot['positions'];
  expressions?: Shot['expressions'];
  poses?: Shot['poses'];
  /** shot-local [start, end) seconds each character is speaking */
  talk?: Record<string, [number, number][]>;
}

/** Shadows: everything opaque casts (characters, sets), floors and big skies only receive. Flat restyles after. */
function shade(obj: THREE.Object3D | null, kind: string, look: Look = 'cinematic', palette?: FlatPalette) {
  const illustrated = isPainted(look);
  if (!obj) return obj;
  if (illustrated) stylizeFlat(obj, kind === 'character' ? 'character' : 'set', palette, look === 'toon');
  const noCast = /floor|cloud|motes|embers|light_shaft|floor_ring/.test(kind);
  obj.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!illustrated && mat.emissiveIntensity > 2.5) mat.emissiveIntensity = 2.5;
    m.castShadow = look !== 'flat' && !noCast && !mat.transparent;
    m.receiveShadow = !mat.transparent;
  });
  return obj;
}

/** Dark worlds are lit by their glows, light worlds by the sky; `env.flat` overrides either. */
function flatPalette(env?: Environment): FlatPalette {
  const base = isDarkHex(env?.background) ? FLAT_DARK : FLAT_LIGHT;
  const o = env?.flat;
  return o ? { ...base, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) } : base;
}

/** Face-rig targets per expression: eye scale, mouth-arc scale (negative y = frown), open-mouth / tongue / teeth visibility, brow lift (m) and inner-brow tilt (rad, + = worried). */
interface FacePose { eye: [number, number]; mouth: [number, number]; open: number; tongue: number; teeth: number; browUp: number; browTilt: number }
const off = { open: 0, tongue: 0, teeth: 0 };
const FACES: Record<Expression, FacePose> = {
  neutral: { eye: [1, 1], mouth: [1, 1], ...off, browUp: 0, browTilt: 0 },
  happy: { eye: [1.05, 0.55], mouth: [1.25, 1.6], ...off, browUp: 0.012, browTilt: 0 },
  grin: { eye: [1.08, 0.42], mouth: [1.5, 0.7], open: 0, tongue: 0, teeth: 1, browUp: 0.008, browTilt: 0 },
  laugh: { eye: [1.12, 0.28], mouth: [0, 0], open: 1.2, tongue: 1, teeth: 0.9, browUp: 0.016, browTilt: 0 },
  smirk: { eye: [1, 0.8], mouth: [0.62, 0.95], ...off, browUp: 0.004, browTilt: -0.28 },
  tongue: { eye: [1.05, 0.7], mouth: [1.15, 1.15], open: 0.35, tongue: 1, teeth: 0, browUp: 0.01, browTilt: 0 },
  ooh: { eye: [1.12, 1.15], mouth: [0, 0], open: 0.5, tongue: 0, teeth: 0, browUp: 0.02, browTilt: 0.05 },
  surprised: { eye: [1.25, 1.3], mouth: [0, 0], open: 0.85, tongue: 0, teeth: 0, browUp: 0.03, browTilt: 0.1 },
  shout: { eye: [1.3, 1.25], mouth: [0, 0], open: 1.4, tongue: 0.35, teeth: 0.55, browUp: 0.028, browTilt: -0.15 },
  grimace: { eye: [1.05, 0.55], mouth: [1.4, 0.2], open: 0, tongue: 0, teeth: 1, browUp: -0.008, browTilt: -0.2 },
  pout: { eye: [1.04, 1.05], mouth: [0.4, 0.5], ...off, browUp: 0.006, browTilt: 0.22 },
  worried: { eye: [1.05, 1.1], mouth: [0.8, -0.7], ...off, browUp: 0.01, browTilt: 0.4 },
  determined: { eye: [1, 0.72], mouth: [0.7, 0.35], ...off, browUp: -0.012, browTilt: -0.35 },
  sad: { eye: [1, 0.85], mouth: [0.9, -0.8], ...off, browUp: -0.004, browTilt: 0.3 },
};

/** The posable face nodes of a character mesh, with their rest transforms. */
interface FaceRig {
  nodes: { node: THREE.Object3D; kind: 'eye' | 'brow' | 'mouth' | 'open' | 'tongue' | 'teeth'; side: number; pos: THREE.Vector3; rotZ: number }[];
  pose: FacePose;
  height: number;
  phase: number;
}

export function rigFace(obj: THREE.Object3D, phase = 0): FaceRig {
  const nodes: FaceRig['nodes'] = [];
  obj.traverse((n) => {
    const m = /^(eye|shine|brow)_(l|r)$|^(mouth)(?:_(open|tongue|teeth))?$/.exec(n.name);
    if (!m) return;
    const kind = (m[1] === 'shine' ? 'eye' : m[4] ? m[4] : m[1] ?? 'mouth') as FaceRig['nodes'][number]['kind'];
    nodes.push({ node: n, kind, side: m[2] === 'l' ? -1 : 1, pos: n.position.clone(), rotZ: n.rotation.z });
  });
  const height = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y || 1;
  return { nodes, pose: { ...FACES.neutral, eye: [1, 1], mouth: [1, 1] }, height, phase };
}

/** Ease the face toward `expression` and blink every few seconds. */
export function poseFace(rig: FaceRig, expression: Expression, now: number, talking = false) {
  const target = FACES[expression];
  const k = 0.18;
  const f = rig.pose;
  f.eye = [f.eye[0] + (target.eye[0] - f.eye[0]) * k, f.eye[1] + (target.eye[1] - f.eye[1]) * k];
  f.mouth = [f.mouth[0] + (target.mouth[0] - f.mouth[0]) * k, f.mouth[1] + (target.mouth[1] - f.mouth[1]) * k];
  f.open += (target.open - f.open) * k;
  f.tongue += (target.tongue - f.tongue) * k;
  f.teeth += (target.teeth - f.teeth) * k;
  f.browUp += (target.browUp - f.browUp) * k;
  f.browTilt += (target.browTilt - f.browTilt) * k;
  const blink = (now + rig.phase * 1.3) % 3.7 < 0.12 ? 0.1 : 1;
  const s = rig.height; // scale rig offsets with character size
  for (const n of rig.nodes) {
    if (n.kind === 'eye') n.node.scale.set(f.eye[0], f.eye[1] * blink, 1);
    else if (n.kind === 'mouth' || n.kind === 'open' || n.kind === 'tongue' || n.kind === 'teeth') {
      // talking: the mouth narrows and opens on syllable-ish beats
      const flap = talking ? Math.abs(Math.sin((now + rig.phase) * 13)) * (0.6 + 0.4 * Math.sin((now + rig.phase) * 3.1)) : 0;
      const show = (v: number) => (v < 0.04 ? 0 : v);
      if (n.kind === 'mouth') n.node.scale.set(show(f.mouth[0]) * (1 - flap * 0.25), f.mouth[1] + flap * 1.6 * Math.sign(f.mouth[1] || 1), show(Math.abs(f.mouth[0])) ? 1 + flap : 0);
      else if (n.kind === 'open') n.node.scale.setScalar(show(f.open) * (talking ? 1 + flap * 0.3 : 1));
      else if (n.kind === 'tongue') n.node.scale.setScalar(show(f.tongue));
      else n.node.scale.setScalar(show(f.teeth));
    }
    else {
      n.node.position.set(n.pos.x, n.pos.y + f.browUp * s, n.pos.z);
      n.node.rotation.z = n.rotZ - n.side * f.browTilt;
    }
  }
}

// ---------------------------------------------------------------- body rig

/** Limb targets in radians: arms [forward (−) / back (+), outward raise], elbow and knee flex, legs forward/back, body lean and squash. */
interface BodyPose { armL: [number, number]; armR: [number, number]; elbowL: number; elbowR: number; legL: number; legR: number; kneeL: number; kneeR: number; lean: number; squash: number }
const BODY: Record<Pose, BodyPose> = {
  idle: { armL: [0, 0], armR: [0, 0], elbowL: 0.22, elbowR: 0.22, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: 0, squash: 0 },
  wave: { armL: [0.05, 0], armR: [-0.3, 2.5], elbowL: 0.2, elbowR: 0.45, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: -0.03, squash: 0 },
  point: { armL: [0.1, 0], armR: [-1.5, 0.15], elbowL: 0.3, elbowR: 0.12, legL: -0.15, legR: 0.1, kneeL: 0.12, kneeR: 0.08, lean: 0.06, squash: 0 },
  cheer: { armL: [-0.4, 2.6], armR: [-0.4, 2.6], elbowL: 0.4, elbowR: 0.4, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: -0.08, squash: -0.04 },
  think: { armL: [-0.9, -0.55], armR: [-2.3, -0.45], elbowL: 0.9, elbowR: 1.55, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: 0.04, squash: 0 },
  shrug: { armL: [-0.5, 0.9], armR: [-0.5, 0.9], elbowL: 0.55, elbowR: 0.55, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: -0.04, squash: 0.04 },
  reach: { armL: [-1.4, 0.15], armR: [-1.4, 0.15], elbowL: 0.35, elbowR: 0.35, legL: -0.25, legR: 0.25, kneeL: 0.2, kneeR: 0.15, lean: 0.18, squash: 0 },
  lift: { armL: [-2.95, 0.25], armR: [-2.95, 0.25], elbowL: 0.18, elbowR: 0.18, legL: -0.2, legR: 0.2, kneeL: 0.25, kneeR: 0.25, lean: -0.05, squash: 0.07 },
  crouch: { armL: [-0.7, 0.25], armR: [-0.7, 0.25], elbowL: 0.6, elbowR: 0.6, legL: -0.4, legR: -0.4, kneeL: 1.15, kneeR: 1.15, lean: 0.28, squash: 0.16 },
  arms_crossed: { armL: [-1.25, -0.95], armR: [-1.15, -1], elbowL: 1.45, elbowR: 1.45, legL: 0, legR: 0, kneeL: 0, kneeR: 0, lean: -0.02, squash: 0 },
};

interface BodyRig {
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  foreL?: THREE.Object3D;
  foreR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  shinL?: THREE.Object3D;
  shinR?: THREE.Object3D;
  footL?: THREE.Object3D;
  footR?: THREE.Object3D;
  baseScale: number;
}

export function rigBody(obj: THREE.Object3D): BodyRig {
  const rig: BodyRig = { baseScale: obj.scale.x };
  obj.traverse((n) => {
    if (n.name === 'arm_l') rig.armL = n;
    else if (n.name === 'arm_r') rig.armR = n;
    else if (n.name === 'forearm_l') rig.foreL = n;
    else if (n.name === 'forearm_r') rig.foreR = n;
    else if (n.name === 'leg_l') rig.legL = n;
    else if (n.name === 'leg_r') rig.legR = n;
    else if (n.name === 'shin_l') rig.shinL = n;
    else if (n.name === 'shin_r') rig.shinR = n;
    else if (n.name === 'foot_l') rig.footL = n;
    else if (n.name === 'foot_r') rig.footR = n;
  });
  obj.rotation.order = 'YXZ'; // yaw, then lean, then waddle
  return rig;
}

const mixPose = (a: BodyPose, b: BodyPose, k: number): BodyPose => {
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    armL: [m(a.armL[0], b.armL[0]), m(a.armL[1], b.armL[1])], armR: [m(a.armR[0], b.armR[0]), m(a.armR[1], b.armR[1])],
    elbowL: m(a.elbowL, b.elbowL), elbowR: m(a.elbowR, b.elbowR),
    legL: m(a.legL, b.legL), legR: m(a.legR, b.legR), kneeL: m(a.kneeL, b.kneeL), kneeR: m(a.kneeR, b.kneeR),
    lean: m(a.lean, b.lean), squash: m(a.squash, b.squash),
  };
};
const ease = (k: number) => k * k * (3 - 2 * k);

/** Character-detail loop: a walk, then each posed gesture, so elbows and knees stay in view. */
const DEMO_POSES: { pose: Pose; walk: boolean }[] = [
  { pose: 'idle', walk: false },
  { pose: 'wave', walk: false },
  { pose: 'cheer', walk: false },
  { pose: 'think', walk: false },
  { pose: 'arms_crossed', walk: false },
  { pose: 'crouch', walk: false },
  { pose: 'idle', walk: true },
  { pose: 'point', walk: false },
  { pose: 'reach', walk: false },
  { pose: 'lift', walk: false },
];
function demoPose(now: number) {
  const slot = 3.2;
  const i = Math.floor(now / slot) % DEMO_POSES.length;
  const cur = DEMO_POSES[i];
  const prev = DEMO_POSES[(i + DEMO_POSES.length - 1) % DEMO_POSES.length];
  const poseOf = (d: { pose: Pose; walk: boolean }) => (d.walk ? 'idle' : d.pose);
  return { pose: poseOf(cur), prev: poseOf(prev), since: now % slot, walk: cur.walk ? 1 : 0 };
}

export interface BodyState {
  /** current pose, the one it's blending from, seconds since it changed */
  pose: Pose;
  prev: Pose;
  since: number;
  /** 0..1 how much the character is walking, and metres walked (stride phase) */
  walk: number;
  travelled: number;
  /** speaking right now */
  talking: boolean;
  /** clock for idle/talk/wave oscillation */
  now: number;
}

/**
 * Pose the body: blend the held pose, add a stride (legs swing, arms counter-swing, bob,
 * forward lean and waddle) while walking, breathing at rest and beat gestures while talking.
 * Returns the root offsets for the caller to apply on top of the blocking.
 */
export function poseBody(obj: THREE.Object3D, rig: BodyRig, h: number, phase: number, s: BodyState) {
  const b = mixPose(BODY[s.prev], BODY[s.pose], ease(Math.min(1, s.since / 0.35)));
  const t = s.now + phase;
  const w = s.walk;
  // stride: one full cycle every two steps; small characters take quicker, shorter steps
  const stride = (s.travelled / Math.max(0.12, h * 0.42)) * Math.PI;
  const swing = Math.sin(stride);
  const legAmp = 0.65 * w;
  const armAmp = 0.5 * w;
  // pose-specific motion
  let waveZ = 0;
  if (s.pose === 'wave') waveZ = Math.sin(t * 9) * 0.4 * ease(Math.min(1, s.since / 0.35));
  const cheerHop = s.pose === 'cheer' ? Math.abs(Math.sin(t * 7)) * 0.06 * h : 0;
  // talking: beat gestures with the free arm and a little nod
  let talkX = 0, talkZ = 0, nod = 0;
  if (s.talking) {
    const beat = Math.sin(t * 4.3) * 0.5 + Math.sin(t * 2.7 + 1) * 0.5;
    if (s.pose === 'idle') {
      talkX = -0.35 - 0.3 * Math.max(0, beat);
      talkZ = 0.2 + 0.15 * beat;
    }
    nod = Math.sin(t * 5.1) * 0.035;
  }
  const breathe = Math.sin(t * 1.9) * 0.012;
  const idleSway = Math.sin(t * 1.3) * 0.05 * (1 - w);
  const set = (n: THREE.Object3D | undefined, x: number, z: number) => n && n.rotation.set(x, 0, z);
  set(rig.armL, b.armL[0] + swing * armAmp + idleSway, -(b.armL[1] + (s.talking ? talkZ * 0.3 : 0)));
  set(rig.armR, b.armR[0] - swing * armAmp - idleSway + talkX, b.armR[1] + waveZ + talkZ);
  set(rig.legL, b.legL - swing * legAmp, 0);
  set(rig.legR, b.legR + swing * legAmp, 0);
  // rear half of the stride flexes the knee; the arm swinging back picks up a little elbow
  set(rig.foreL, b.elbowL + Math.max(0, swing) * 0.35 * w, 0);
  set(rig.foreR, b.elbowR + Math.max(0, -swing) * 0.35 * w, 0);
  set(rig.shinL, b.kneeL + Math.max(0, -swing) * 0.7 * w, 0);
  set(rig.shinR, b.kneeR + Math.max(0, swing) * 0.7 * w, 0);
  // soles stay level and parallel: cancel the thigh and knee pitch so both feet point +Z
  const plant = (foot: THREE.Object3D | undefined, thigh?: THREE.Object3D, shin?: THREE.Object3D) =>
    foot && foot.rotation.set(-((thigh?.rotation.x ?? 0) + (shin?.rotation.x ?? 0)), 0, 0);
  plant(rig.footL, rig.legL, rig.shinL);
  plant(rig.footR, rig.legR, rig.shinR);
  // squash & stretch: crouch/lift squash down, each footfall compresses slightly
  const step = Math.abs(Math.cos(stride));
  const squash = b.squash + breathe * (1 - w) + w * (1 - step) * 0.05;
  const k = rig.baseScale;
  obj.scale.set(k * (1 + squash * 0.5), k * (1 - squash), k * (1 + squash * 0.5));
  obj.rotation.x = b.lean + w * 0.12 + nod;
  obj.rotation.z = Math.sin(stride) * 0.07 * w;
  return { lift: step * 0.07 * h * w + cheerHop };
}

interface Actor {
  obj: THREE.Object3D;
  id: string;
  /** Flat-look disc. Lives on the stage, not under the body. */
  shadow?: THREE.Object3D;
  blocking: Blocking;
  expressions?: ExpressionKey[];
  poses?: PoseKey[];
  talk: [number, number][];
  face: FaceRig;
  body: BodyRig;
}

/** Props that move on their own: hovering glass, spinning orbs, pulsing beacons, drifting motes. */
interface Animated { obj: THREE.Object3D; kind: string; base: THREE.Vector3; rotY: number; phase: number }
const ANIMATED: Record<string, (a: Animated, t: number) => void> = {
  glass_sphere: (a, t) => void (a.obj.position.y = a.base.y + Math.sin(t * 0.6 + a.phase) * 0.15),
  mempool_bubble: (a, t) => {
    a.obj.position.y = a.base.y + Math.sin(t * 0.8 + a.phase) * 0.18;
    a.obj.position.x = a.base.x + Math.sin(t * 0.35 + a.phase * 2) * 0.12;
  },
  tx_orb: (a, t) => {
    a.obj.rotation.y = a.rotY + t * 1.2;
    a.obj.position.y = a.base.y + Math.sin(t * 1.4 + a.phase) * 0.06;
  },
  hex_beacon: (a, t) => {
    a.obj.rotation.y = a.rotY + t * 0.25;
    const core = a.obj.getObjectByName('core');
    if (core) core.scale.setScalar(1 + Math.max(0, Math.sin(t * 2.6)) ** 4 * 0.6);
  },
  halo_ring: (a, t) => {
    a.obj.rotation.set(Math.PI / 2 + Math.sin(t * 0.5 + a.phase) * 0.15, a.rotY + t * 0.4, 0);
  },
  cloud: (a, t) => void (a.obj.position.x = a.base.x + Math.sin(t * 0.04 + a.phase) * 3),
  floating_isle: (a, t) => void (a.obj.position.y = a.base.y + Math.sin(t * 0.3 + a.phase) * 0.4),
  motes: (a, t) => {
    a.obj.rotation.y = a.rotY + t * 0.03;
    a.obj.position.y = a.base.y + Math.sin(t * 0.25 + a.phase) * 0.3;
  },
  embers: (a, t) => {
    a.obj.rotation.y = a.rotY - t * 0.05;
    a.obj.position.y = a.base.y + ((t * 0.25 + a.phase) % 2) - 1;
  },
  banner: (a, t) => {
    const cloth = a.obj.getObjectByName('cloth');
    if (cloth) cloth.rotation.y = Math.sin(t * 1.3 + a.phase) * 0.25;
  },
  crystal: (a, t) => void a.obj.scale.setScalar(a.obj.userData.s * (1 + Math.sin(t * 1.7 + a.phase) * 0.03)),
};
ANIMATED.crystal_gold = ANIMATED.crystal;

// ---------------------------------------------------------------- HDRI, post

const hdrLoader = new HDRLoader();
const hdrCache = new Map<string, Promise<THREE.DataTexture | null>>();
function loadHdr(url: string) {
  if (!hdrCache.has(url))
    hdrCache.set(
      url,
      hdrLoader.loadAsync(url).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
      }).catch(() => null),
    );
  return hdrCache.get(url)!;
}

/** Vignette, film grain and a whisper of chromatic fringing, applied after tone mapping. */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.35 }, grain: { value: 0.04 }, time: { value: 0 }, paper: { value: 0 }, toe: { value: new THREE.Vector4(0, 0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float grain; uniform float time; uniform float paper; uniform vec4 toe; varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(rand(i), rand(i + vec2(1, 0)), f.x), mix(rand(i + vec2(0, 1)), rand(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.15, r2 * 1.6), vignette);
      c += (rand(vUv * 913.0 + fract(time * 7.0)) - 0.5) * grain;
      // painted look: blacks lift into a milky blue toe, fixed paper tooth (same every frame)
      c = c + toe.rgb * toe.a * (1.0 - c);
      vec2 px = gl_FragCoord.xy;
      c *= 1.0 + (vnoise(px / 2.5) * 0.55 + vnoise(px / 9.0) * 0.3 + vnoise(px / 40.0) * 0.15 - 0.5) * paper;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Flat v2: inverted-hull outlines drawn over the render, coloured per material (`userData.outlineParameters`). */
class OutlinePass extends RenderPass {
  private effect: OutlineEffect;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    super(scene, camera);
    this.effect = new OutlineEffect(renderer, { defaultThickness: 0.003, defaultColor: [0, 0, 0], defaultAlpha: 1 });
    this.needsSwap = false;
    this.clear = false;
  }
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mats = m ? (Array.isArray(m) ? m : [m]) : [];
      // only materials that asked for a line get one
      for (const mat of mats) mat.userData.outlineParameters ??= { visible: false };
      if (o.visible && (o as THREE.Mesh).isMesh && !mats.some((x) => x.userData.outlineOccluder)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    // depth of the see-through bubbles, so lines behind them stay hidden
    const { background, overrideMaterial } = this.scene;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.scene.background = null;
    this.scene.overrideMaterial = this.depthOnly;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = overrideMaterial;
    this.scene.background = background;
    renderer.autoClear = autoClear;
    for (const o of hidden) o.visible = true;
    this.effect.renderOutline(this.scene, this.camera);
  }
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 500);
  private look: Look = 'cinematic';
  private palette: FlatPalette = FLAT_DARK;
  private sky = paintedSky();
  /** painted-look meshes that light the world (bubbles, beacons, shafts) */
  private glows: { mesh: THREE.Mesh; source: GlowSource; r: number }[] = [];
  private lookTarget = new THREE.Vector3(0, 1, 0);
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private outlinePass: OutlinePass;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private studio: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private envMaps = new Map<string, THREE.Texture>();
  private root = new THREE.Group();
  private contentKey = '';
  private ro: ResizeObserver;
  private pilot = false;
  /** Library character page: cycle poses and a walk so the limb skeleton reads. */
  private skeletonDemo = false;
  private disposed = false;
  /** characters in the current shot: blocked, moving and emoting by shot time */
  private actors: Actor[] = [];
  private animated: Animated[] = [];
  /** shot-local seconds that drive movement and expressions */
  private shotTime = 0;
  /** Runs at the start of each frame (library shot demos drive the camera from here). */
  onFrame: ((now: number) => void) | null = null;
  /** the current environment's establishing camera, if it has one */
  previewCamera?: Environment['preview'];
  aspect = 16 / 9;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.studio = studioEnv(this.renderer);
    this.scene.environment = this.studio;
    this.scene.environmentIntensity = 0.5;
    this.scene.add(this.root);
    this.sky.visible = false;
    this.scene.add(this.sky);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.outlinePass = new OutlinePass(this.renderer, this.scene, this.camera);
    this.outlinePass.enabled = false;
    this.composer.addPass(this.outlinePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.07, 0.25, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  /** Draw one frame (animation loop, or on demand for thumbnails). */
  render(now = performance.now() / 1000) {
    this.onFrame?.(now);
    if (this.pilot) this.controls.update();
    this.animateActors(now);
    for (const a of this.animated) ANIMATED[a.kind]?.(a, now);
    this.finish.uniforms.time.value = now;
    if (isPainted(this.look)) this.paintFrame();
    this.composer.render();
  }

  /** Several views share the painted uniforms, so each one loads its palette and nearest glows right before drawing. */
  private paintFrame() {
    applyFlatPalette(this.palette);
    this.sky.position.copy(this.camera.position);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uStars!.value = this.palette.stars;
    const cam = this.camera.position;
    const v = new THREE.Vector3();
    const ranked = this.glows.map((g) => {
      g.mesh.updateWorldMatrix(true, false);
      const sphere = g.mesh.geometry.boundingSphere!;
      const p = v.copy(sphere.center).applyMatrix4(g.mesh.matrixWorld).clone();
      const r = sphere.radius * g.mesh.matrixWorld.getMaxScaleOnAxis();
      return { g, p, r, score: (g.source.strength * Math.min(r, 3)) / (1 + p.distanceTo(cam) * 0.15) };
    }).sort((a, b) => b.score - a.score);
    const n = Math.min(GLOW_SLOTS, ranked.length);
    for (let i = 0; i < n; i++) {
      const { g, p, r } = ranked[i]!;
      flatUniforms.uGlowPos.value[i]!.set(p.x, p.y, p.z, Math.min(r, 3));
      const c = g.source.color;
      flatUniforms.uGlowCol.value[i]!.set(c.r, c.g, c.b, g.source.strength * this.palette.glow);
    }
    flatUniforms.uGlowCount.value = n;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pixar PBR, or the flat illustration. Clears content so the next setContent restyles meshes. */
  setLook(look: Look) {
    if (this.look === look) return;
    this.look = look;
    this.contentKey = '';
    this.renderer.toneMapping = isPainted(look) ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    // v1 has no cast shadows (disc only); v2 steps a real shadow map in the cel shader
    this.renderer.shadowMap.enabled = look !== 'flat';
    this.sky.visible = isPainted(look);
    this.outlinePass.enabled = look === 'toon';
    this.finish.uniforms.paper.value = 0;
    this.finish.uniforms.toe.value.set(0, 0, 0, 0);
  }

  /** Resolves once every mesh of the current content has loaded. */
  ready: Promise<void> = Promise.resolve();

  setContent(data: ProjectData, content: SceneContent) {
    const loads: Promise<unknown>[] = [];
    const env = content.envId ? data.environments[content.envId] : undefined;
    const key = JSON.stringify([env, content.assets.map((a) => data.assets[a]), content.characters.map((c) => data.characters[c]), content]);
    if (key === this.contentKey) return this.ready;
    this.contentKey = key;
    this.root.clear();
    this.actors = [];
    this.animated = [];
    this.glows = [];
    this.palette = flatPalette(env);
    this.previewCamera = env?.preview;
    loads.push(this.applyEnvironment(env));
    const place = (obj: THREE.Object3D | null, pos: Vec3, rotY = 0, scale = 1, kind?: string) => {
      if (!obj) return;
      obj.position.set(...pos);
      obj.rotation.y = THREE.MathUtils.degToRad(rotY);
      obj.scale.multiplyScalar(scale);
      this.root.add(obj);
      if (kind && ANIMATED[kind]) {
        obj.userData.s = obj.scale.x;
        this.animated.push({ obj, kind, base: obj.position.clone(), rotY: obj.rotation.y, phase: pos[0] * 1.7 + pos[2] * 0.9 });
      }
    };
    for (const p of env?.props ?? []) {
      const a = data.assets[p.assetId];
      if (a) loads.push(this.addMesh(a.mesh, a.color, a.scale * p.scale, 'box').then((o) => {
        shade(o, p.assetId, this.look, this.palette);
        place(o, p.position, p.rotationY, 1, p.assetId);
      }));
    }
    content.assets.forEach((id, i) => {
      const a = data.assets[id];
      if (a) loads.push(this.addMesh(a.mesh, a.color, a.scale, 'box').then((o) => {
        shade(o, id, this.look, this.palette);
        place(o, [2 + i * 1.5, 0, 1], 0, 1, id);
      }));
    });
    blockingFor({ characters: content.characters, positions: content.positions }, env).forEach((b, i) => {
      const c = data.characters[b.id];
      if (!c) return;
      loads.push(this.addMesh(c.mesh, c.color, c.scale, 'capsule').then((o) => {
        if (!o) return;
        shade(o, 'character', this.look, this.palette);
        let shadow: THREE.Object3D | undefined;
        if (isPainted(this.look)) {
          const box = new THREE.Box3().setFromObject(o);
          const radius = Math.max(0.18, box.getSize(new THREE.Vector3()).x * 0.46);
          shadow = contactShadow(radius);
          plantShadow(shadow, b.position[0], b.position[1], b.position[2]);
          this.root.add(shadow);
        }
        if (b.id === 'mili') {
          const baked = o.getObjectByName('lightning');
          if (baked) baked.visible = false;
          o.add(lightningTrail());
        }
        place(o, b.position, b.rotationY);
        this.actors.push({ id: b.id, obj: o, shadow, blocking: b, expressions: content.expressions?.[b.id], poses: content.poses?.[b.id], talk: content.talk?.[b.id] ?? [], face: rigFace(o, i * 1.7), body: rigBody(o) });
      }));
    });
    this.ready = Promise.all(loads).then(() => {
      if (isPainted(this.look)) this.collectGlows();
    });
    return this.ready;
  }

  private collectGlows() {
    this.glows = [];
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const source = mesh.isMesh ? ((mesh.material as THREE.Material).userData?.glow as GlowSource | undefined) : undefined;
      if (!source) return;
      mesh.geometry.computeBoundingSphere();
      this.glows.push({ mesh, source, r: mesh.geometry.boundingSphere!.radius });
    });
  }

  /** Point the camera at everything in the scene (meshes only, lights ignored). */
  frame(dir: Vec3 = [0.55, 0.35, 1], fill = 1) {
    const box = new THREE.Box3();
    this.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'trail') return;
      box.expandByObject(o);
    });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(0.3, size.length() * 0.5);
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.85 / fill;
    this.camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(dist));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20 + 100;
    this.camera.updateProjectionMatrix();
    this.lookTarget.copy(c);
    this.camera.lookAt(c);
    this.controls.target.copy(c);
  }

  /** Frame an environment from its establishing camera (or a default eye-level view of the stage). */
  frameEnvironment() {
    const k = this.previewCamera ?? { position: [0, 2.2, 10] as Vec3, target: [0, 1.4, -4] as Vec3, fov: 50 };
    this.camera.near = 0.1;
    this.camera.far = 600;
    this.setCamera({ t: 0, ...k }, true);
  }

  /** Shot-local time for character movement and expressions. */
  setShotTime(t: number) {
    this.shotTime = t;
  }

  /** Retarget the characters already on stage. Used by the shot gallery, which shares one context. */
  setPerformance(content: Pick<SceneContent, 'positions' | 'expressions' | 'poses'>) {
    const blocks = blockingFor({ characters: this.actors.map((a) => a.id), positions: content.positions });
    for (const a of this.actors) {
      const b = blocks.find((x) => x.id === a.id);
      if (b) a.blocking = b;
      a.expressions = content.expressions?.[a.id];
      a.poses = content.poses?.[a.id];
    }
  }

  private animateActors(now: number) {
    const demo = this.skeletonDemo ? demoPose(now) : null;
    for (const a of this.actors) {
      const p = poseAt(a.blocking, this.shotTime);
      const { height: h, phase } = a.face;
      const bp = demo ?? bodyPoseAt(a.poses, this.shotTime);
      const talking = !demo && a.talk.some(([s, e]) => this.shotTime >= s && this.shotTime < e);
      const walk = demo ? demo.walk : Math.min(1, p.speed / Math.max(0.25, h * 0.9));
      const trail = a.obj.getObjectByName('trail');
      const tick = trail?.userData.tick as ((now: number, running: boolean) => void) | undefined;
      if (tick) tick(now, walk > 0.15);
      const travelled = demo ? (demo.walk ? now * h * 0.9 : 0) : p.travelled;
      const { lift } = poseBody(a.obj, a.body, h, phase, { ...bp, walk, travelled, talking, now });
      a.obj.position.set(p.position[0], p.position[1] + lift, p.position[2]);
      a.obj.rotation.y = THREE.MathUtils.degToRad(p.rotationY);
      if (a.shadow) plantShadow(a.shadow, p.position[0], p.position[1], p.position[2]);
      poseFace(a.face, expressionAt(a.expressions, this.shotTime).expression, now, talking);
    }
  }

  private async applyEnvironment(env?: Environment) {
    const contentKey = this.contentKey;
    if (isPainted(this.look)) return this.applyFlatEnvironment(env, contentKey);
    const post = env?.post ?? { bloom: 0.6, vignette: 0.35, grain: 0.04, exposure: 1 };
    // UnrealBloom sums five mips, so env `bloom` 1 ≈ a gentle halo rather than full strength
    this.bloom.strength = post.bloom * 0.12;
    this.bloom.threshold = 1.2;
    this.finish.uniforms.vignette.value = post.vignette;
    this.finish.uniforms.grain.value = post.grain;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1 * post.exposure;
    this.scene.fog = env?.fog ? new THREE.Fog(env.fog.color, env.fog.near, env.fog.far) : null;
    const l = env?.lighting ?? { ambient: 0.3, key: 1.2, keyColor: '#ffffff', keyPosition: [4, 6, 3] as Vec3 };
    const hdr = env?.hdri ? await loadHdr(mediaUrl(env.hdri)!) : null;
    if (contentKey !== this.contentKey || this.disposed) return;
    if (hdr && env) {
      let pm = this.envMaps.get(env.hdri!);
      if (!pm) this.envMaps.set(env.hdri!, (pm = this.pmrem.fromEquirectangular(hdr).texture));
      const rot = THREE.MathUtils.degToRad(env.hdriRotation);
      this.scene.environment = pm;
      this.scene.environmentIntensity = env.hdriIntensity;
      this.scene.environmentRotation.set(0, rot, 0);
      this.scene.background = env.hdriBackground ? hdr : new THREE.Color(env.background);
      this.scene.backgroundIntensity = env.hdriIntensity;
      this.scene.backgroundRotation.set(0, rot, 0);
    } else {
      this.scene.environment = this.studio;
      this.scene.environmentIntensity = 0.5;
      this.scene.background = new THREE.Color(env?.background ?? '#05060a');
    }
    // with an HDRI the sky already fills the shadows, so ambient is only a lift
    this.root.add(new THREE.AmbientLight('#ffffff', l.ambient * (hdr ? 0.8 : 2)));
    const key = new THREE.DirectionalLight(l.keyColor, l.key * 2);
    key.position.set(...l.keyPosition).normalize().multiplyScalar(30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 4;
    key.target.position.set(0, 0, -3);
    this.root.add(key, key.target);
    const rim = new THREE.DirectionalLight('#6688ff', 0.4);
    rim.position.set(-4, 2, -5);
    this.root.add(rim);
  }

  /** Painted sky + haze, glows light the world, wide soft bloom, milky toe and paper tooth. Three's lights are unused. */
  private async applyFlatEnvironment(env: Environment | undefined, contentKey: string) {
    const dark = isDarkHex(env?.background);
    this.bloom.strength = dark ? 0.42 : 0.2;
    this.bloom.radius = 0.3;
    this.bloom.threshold = 1;
    this.finish.uniforms.vignette.value = dark ? 0.38 : 0.18;
    this.finish.uniforms.grain.value = 0;
    this.finish.uniforms.paper.value = 0.015;
    this.finish.uniforms.toe.value.set(...(dark ? [0.1, 0.13, 0.26] : [0.55, 0.6, 0.75]) as [number, number, number], dark ? 0.05 : 0.03);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene.environment = null;
    this.scene.background = new THREE.Color(this.palette.horizon);
    this.scene.fog = null;
    if (contentKey !== this.contentKey || this.disposed) return;
    illustratedKey.value.set(...(env?.lighting.keyPosition ?? [4, 8, 6])).normalize();
    if (this.look !== 'toon') return;
    // v2: a shadow-only key along the painted key direction; the cel shader steps its shadow map
    const key = new THREE.DirectionalLight('#ffffff', 0);
    key.position.copy(illustratedKey.value).multiplyScalar(30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.07;
    key.shadow.radius = 1;
    key.target.position.set(0, 0, 0);
    this.root.add(key, key.target);
  }

  private async addMesh(mesh: string | undefined, color: string, scale: number, fallback: 'box' | 'capsule') {
    const contentKey = this.contentKey;
    let obj: THREE.Object3D | null = null;
    if (mesh) {
      const gltf = await loadGltf(mediaUrl(mesh)!);
      if (gltf) obj = gltf.scene.clone(true);
    }
    if (!obj) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.08 });
      const g = fallback === 'capsule' ? new THREE.CapsuleGeometry(0.28, 1.1, 6, 16).translate(0, 0.83, 0) : new THREE.BoxGeometry(0.6, 0.6, 0.6).translate(0, 0.3, 0);
      obj = new THREE.Mesh(g, mat);
    }
    obj.scale.setScalar(scale);
    // content changed while loading: drop it
    if (contentKey !== this.contentKey || this.disposed) return null;
    return obj;
  }

  setCamera(k: CameraKey, force = false) {
    if (this.pilot && !force) return;
    this.lookTarget.set(...k.target);
    this.camera.position.set(...k.position);
    this.camera.fov = k.fov;
    this.camera.lookAt(this.lookTarget);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.lookTarget);
  }

  /** Cycle body poses and a walk in place. Used by the character detail viewer. */
  setSkeletonDemo(on: boolean) {
    this.skeletonDemo = on;
  }

  setPilot(on: boolean) {
    this.pilot = on;
    this.controls.enabled = on;
  }

  /** Pause the render loop (off-screen library cards). The last frame stays on the canvas. */
  setLoop(on: boolean) {
    this.renderer.setAnimationLoop(on ? () => this.render() : null);
  }

  getKey(): Omit<CameraKey, 't'> {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const p = this.camera.position;
    const t = this.controls.target;
    return { position: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)], fov: r(this.camera.fov) };
  }

  snapshot(type = 'image/jpeg') {
    return this.renderer.domElement.toDataURL(type, 0.85);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ---------------------------------------------------------------- thumbnails

let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbCache = new Map<string, Promise<string>>();

/** Render a glb to a small PNG data URL (one shared WebGL context for all cards). */
export function glbThumbnail(mesh: string | undefined, color: string, size: [number, number] = [320, 200], look: Look = 'cinematic') {
  const key = `${look}|${mesh}|${color}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(
      key,
      (async () => {
        thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbRenderer.setSize(size[0], size[1]);
        thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
        thumbRenderer.toneMapping = isPainted(look) ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
        thumbRenderer.toneMappingExposure = isPainted(look) ? 1.05 : 1.1;
        const scene = new THREE.Scene();
        let obj: THREE.Object3D;
        const gltf = mesh ? await loadGltf(mediaUrl(mesh)!) : null;
        if (gltf) obj = gltf.scene.clone(true);
        else obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 6, 16), new THREE.MeshStandardMaterial({ color }));
        if (isPainted(look)) {
          stylizeFlat(obj, 'character');
          scene.add(new THREE.HemisphereLight('#c5ddff', '#1a3f78', 0.45));
          const keyLight = new THREE.DirectionalLight('#fff6ea', 1.25);
          keyLight.position.set(3, 5, 4);
          scene.add(keyLight);
        } else {
          scene.environment = studioEnv(thumbRenderer);
          scene.environmentIntensity = 0.7;
          scene.add(new THREE.AmbientLight('#ffffff', 0.8));
          const d = new THREE.DirectionalLight('#ffffff', 2.5);
          d.position.set(3, 5, 4);
          scene.add(d);
        }
        scene.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3());
        const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
        const cam = new THREE.PerspectiveCamera(35, size[0] / size[1], 0.01, 1000);
        cam.position.copy(c).add(new THREE.Vector3(0.9, 0.6, 1.4).normalize().multiplyScalar(r * 3));
        cam.lookAt(c);
        if (isPainted(look)) {
          applyFlatPalette(FLAT_DARK, false);
          flatUniforms.uGlowCount.value = 0;
        }
        thumbRenderer.render(scene, cam);
        return thumbRenderer.domElement.toDataURL('image/png');
      })(),
    );
  }
  return thumbCache.get(key)!;
}

// One hidden SceneView renders environment thumbnails one at a time (a single WebGL context).
let envThumbView: SceneView | null = null;
let envThumbQueue: Promise<unknown> = Promise.resolve();

/** Render a whole environment (background, fog, lights, props) to a JPEG data URL. */
export function envThumbnail(data: ProjectData, envId: string, size: [number, number] = [320, 200], look: Look = 'cinematic'): Promise<string> {
  const job = envThumbQueue.then(async () => {
    if (!envThumbView) {
      const host = document.createElement('div');
      host.style.cssText = `position:fixed;left:-10000px;top:0;width:${size[0]}px;height:${size[1]}px;pointer-events:none`;
      document.body.appendChild(host);
      envThumbView = new SceneView(host);
      envThumbView.renderer.setAnimationLoop(null);
    }
    const v = envThumbView;
    v.setLook(look);
    v.resize();
    await v.setContent(data, { envId, assets: [], characters: [] });
    v.frameEnvironment();
    v.render(0);
    return v.snapshot();
  });
  envThumbQueue = job.catch(() => undefined);
  return job;
}

// ---------------------------------------------------------------- live character cards

/** What a card shows: a fixed expression and/or one kind of movement (default: sway while cycling expressions). */
export type CardMotion = 'sway' | 'idle' | 'walk' | 'turn';
export interface CardOptions { expression?: Expression; motion?: CardMotion; /** frame the head instead of the whole body */ face?: boolean }
interface Card { canvas: HTMLCanvasElement; scene: THREE.Scene; camera: THREE.PerspectiveCamera; obj: THREE.Object3D; shadow?: THREE.Object3D; rig: FaceRig; body: BodyRig; phase: number; opts: CardOptions; look: Look }
const cards = new Set<Card>();
const CARD_POSES: Pose[] = ['idle', 'wave', 'idle', 'cheer', 'idle', 'think', 'idle', 'shrug'];
let cardRenderer: THREE.WebGLRenderer | null = null;

function renderCards() {
  const r = cardRenderer!;
  const now = performance.now() / 1000;
  const dpr = Math.min(2, window.devicePixelRatio);
  for (const c of cards) {
    const w = Math.round(c.canvas.clientWidth * dpr);
    const h = Math.round(c.canvas.clientHeight * dpr);
    if (!w || !h) continue;
    const rect = c.canvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // off screen
    if (c.canvas.width !== w || c.canvas.height !== h) Object.assign(c.canvas, { width: w, height: h });
    const { motion = 'sway', expression } = c.opts;
    const ht = c.rig.height;
    // same body rig as the shot preview (SceneView.animateActors): walk in place, or idle with a cycling gesture
    const walking = motion === 'walk';
    const pose = motion === 'sway' ? CARD_POSES[Math.floor((now + c.phase) / 3) % CARD_POSES.length] : 'idle';
    const { lift } = poseBody(c.obj, c.body, ht, c.phase, { pose, prev: 'idle', since: ((now + c.phase) % 3), walk: walking ? 1 : 0, travelled: now * ht * 0.9, talking: false, now });
    const tick = c.obj.getObjectByName('trail')?.userData.tick as ((now: number, running: boolean) => void) | undefined;
    if (tick) tick(now, walking);
    c.obj.position.y = lift;
    if (c.shadow) plantShadow(c.shadow, 0, 0, 0);
    c.obj.rotation.y = walking ? 0.9 : motion === 'turn' ? now * 0.8 + c.phase : motion === 'idle' ? 0.25 : Math.sin(now * 0.5 + c.phase) * 0.6;
    poseFace(c.rig, expression ?? EXPRESSIONS[Math.floor((now + c.phase) / 2.2) % EXPRESSIONS.length], now);
    c.camera.aspect = w / h;
    c.camera.updateProjectionMatrix();
    if (isPainted(c.look)) {
      applyFlatPalette(FLAT_DARK, false);
      flatUniforms.uGlowCount.value = 0;
    }
    r.toneMapping = isPainted(c.look) ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = isPainted(c.look) ? 1.05 : 1.1;
    r.setSize(w, h, false);
    r.render(c.scene, c.camera);
    const ctx = c.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, 0);
  }
}

/** Draw a live, gently animated character into `canvas`; one shared WebGL context serves every card. Returns an unmount. */
export function mountCharacterCard(canvas: HTMLCanvasElement, mesh: string | undefined, color: string, phase = 0, opts: CardOptions = {}, look: Look = 'cinematic') {
  let card: Card | null = null;
  let live = true;
  void (async () => {
    const gltf = mesh ? await loadGltf(mediaUrl(mesh)!) : null;
    if (!live) return;
    if (!cardRenderer) {
      cardRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      cardRenderer.outputColorSpace = THREE.SRGBColorSpace;
      cardRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      cardRenderer.toneMappingExposure = 1.1;
      cardRenderer.setAnimationLoop(() => cards.size && renderCards());
    }
    const scene = new THREE.Scene();
    const obj = gltf ? gltf.scene.clone(true) : new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 6, 16).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color }));
    let shadow: THREE.Object3D | undefined;
    if (isPainted(look)) {
      stylizeFlat(obj, 'character', FLAT_DARK, look === 'toon');
      const box = new THREE.Box3().setFromObject(obj);
      shadow = contactShadow(Math.max(0.18, box.getSize(new THREE.Vector3()).x * 0.46));
      scene.add(shadow);
      scene.add(new THREE.HemisphereLight('#c5ddff', '#1a3f78', 0.45));
      const key = new THREE.DirectionalLight('#fff6ea', 1.25);
      key.position.set(3, 5, 4);
      scene.add(key);
    } else {
      scene.environment = studioEnv(cardRenderer);
      scene.environmentIntensity = 0.7;
      scene.add(new THREE.AmbientLight('#ffffff', 0.8));
      const d = new THREE.DirectionalLight('#ffffff', 2.5);
      d.position.set(3, 5, 4);
      scene.add(d);
    }
    if (mesh?.includes('mili.glb')) {
      const baked = obj.getObjectByName('lightning');
      if (baked) baked.visible = false;
      obj.add(lightningTrail());
    }
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const ctr = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(30, 1.6, 0.01, 100);
    if (opts.face) {
      // head close-up: the top ~45% of the figure
      const look = new THREE.Vector3(ctr.x, box.max.y - size.y * 0.25, ctr.z);
      const dist = (Math.max(size.y * 0.45, size.x / 1.6) * 0.62) / Math.tan(THREE.MathUtils.degToRad(15));
      camera.position.set(look.x, look.y + size.y * 0.03, box.max.z + dist);
      camera.lookAt(look);
    } else {
      const dist = (Math.max(size.y, size.x / 1.6) * 0.62) / Math.tan(THREE.MathUtils.degToRad(15));
      camera.position.set(ctr.x + dist * 0.25, ctr.y + size.y * 0.12, ctr.z + dist);
      camera.lookAt(ctr);
    }
    card = { canvas, scene, camera, obj, shadow, rig: rigFace(obj, phase), body: rigBody(obj), phase, opts, look };
    cards.add(card);
  })();
  return () => {
    live = false;
    if (card) cards.delete(card);
  };
}
