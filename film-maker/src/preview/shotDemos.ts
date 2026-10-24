/**
 * Library shot studies: looping camera moves on Sati in the light city.
 * Times are seconds. Orbits and the dolly zoom are baked into many keys so
 * linear sampling stays on the curve (a smooth ease would bend it again).
 */
import type { CameraClip, CameraKey, Expression, Pose, Shot, Vec3 } from '../model/schema';

export const SHOT_ENV = 'light_city';
export const SHOT_CHARACTER = 'sati';

export interface ShotDemo {
  id: string;
  name: string;
  lens: string;
  note: string;
  duration: number;
  camera: CameraClip;
  positions: Shot['positions'];
  expressions?: Shot['expressions'];
  poses?: Shot['poses'];
}

const rad = (d: number) => (d * Math.PI) / 180;
const smooth = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const HEAD: Vec3 = [0, 1.05, 0];

const stand = (rotationY = 0, expression: Expression = 'neutral', pose?: Pose): Pick<ShotDemo, 'positions' | 'expressions' | 'poses'> => ({
  positions: { [SHOT_CHARACTER]: { position: [0, 0, 0], rotationY } },
  expressions: { [SHOT_CHARACTER]: [{ t: 0, expression }] },
  poses: pose ? { [SHOT_CHARACTER]: [{ t: 0, pose }] } : undefined,
});

function clip(duration: number, ease: CameraClip['ease'], label: string, keys: CameraKey[]): CameraClip {
  return { id: label, start: 0, duration, ease, label, keys };
}

function samples(n: number, duration: number, at: (k: number, t: number) => Omit<CameraKey, 't'>): CameraKey[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n;
    return { t: duration * k, ...at(k, duration * k) };
  });
}

/** Orbit whose radius, height and lens all close in. */
function tighten(duration: number, a0: number, a1: number, r0: number, r1: number, h0: number, h1: number, fov0: number, fov1: number, target: Vec3 = HEAD): CameraKey[] {
  return samples(24, duration, (k) => {
    const a = rad(lerp(a0, a1, k));
    const r = lerp(r0, r1, k);
    return {
      position: [target[0] + Math.sin(a) * r, lerp(h0, h1, k), target[2] + Math.cos(a) * r],
      target,
      fov: lerp(fov0, fov1, k),
    };
  });
}

const crane = clip(8, 'smooth', 'crane', [
  { t: 0, position: [0.35, 0.28, 2.4], target: [0, 0.9, 0], fov: 68 },
  { t: 2.2, position: [0.6, 0.7, 4.2], target: [0, 1.1, -1], fov: 62 },
  { t: 5, position: [-3.5, 4.5, 11], target: [0, 2.2, -6], fov: 52 },
  { t: 8, position: [-7, 11, 18], target: [0, 4, -10], fov: 46 },
]);

const tele = clip(7, 'smooth', 'telephoto', [
  { t: 0, position: [-3.2, 1.2, 16], target: HEAD, fov: 11 },
  { t: 7, position: [3.4, 1.05, 15.2], target: [0.15, 1.02, 0], fov: 12 },
]);

const orbit = clip(9, 'linear', 'orbit-in', tighten(9, -30, 250, 9.5, 1.65, 3.2, 1.15, 52, 24));

const pan = clip(7, 'linear', 'pan', [
  { t: 0, position: [-0.4, 1.8, 8], target: [-9, 7, -18], fov: 44 },
  { t: 1.3, position: [-0.4, 1.8, 8], target: [-9, 7, -18], fov: 44 },
  { t: 2.5, position: [-0.4, 1.8, 8], target: HEAD, fov: 40 },
  { t: 4.6, position: [-0.4, 1.8, 8], target: HEAD, fov: 36 },
  { t: 5.8, position: [-0.4, 1.8, 8], target: [10, 8, -16], fov: 48 },
  { t: 7, position: [-0.4, 1.8, 8], target: [10, 8, -16], fov: 48 },
]);

/** Hitchcock: dolly in while the lens widens, so she stays the same size and the city stretches. */
const dollyZoom = (() => {
  const duration = 6;
  const d0 = 14;
  const d1 = 2.6;
  const fov0 = 12;
  const keep = d0 * Math.tan(rad(fov0 / 2));
  return clip(duration, 'linear', 'dolly-zoom', samples(20, duration, (k) => {
    const s = smooth(k);
    const d = lerp(d0, d1, s);
    return {
      position: [0, 1.05, d],
      target: HEAD,
      fov: (2 * Math.atan(keep / d) * 180) / Math.PI,
    };
  }));
})();

/** She sprints down the avenue; the camera chases, weaves, and drops to her shoulder. */
const follow = (() => {
  const duration = 6.5;
  const from: Vec3 = [2.4, 0, 6];
  const to: Vec3 = [2.4, 0, -9];
  return clip(duration, 'linear', 'follow', samples(26, duration, (k) => {
    const s = smooth(k);
    const x = lerp(from[0], to[0], s);
    const z = lerp(from[2], to[2], s);
    const weave = Math.sin(k * Math.PI * 2) * 1.6;
    const behind = lerp(4.2, 1.7, k);
    const height = 2.1 - Math.sin(k * Math.PI) * 1.15;
    return {
      position: [x + weave, height, z + behind],
      target: [x + weave * 0.15, 0.9, z - 2.2],
      fov: lerp(50, 32, k),
    };
  }));
})();

const hero = clip(5.5, 'smooth', 'low-angle', [
  { t: 0, position: [0.15, 0.12, 3.1], target: [0, 1.5, 0], fov: 74 },
  { t: 2.4, position: [0.45, 0.22, 1.7], target: [0, 1.35, 0], fov: 64 },
  { t: 5.5, position: [0.2, 0.55, 1.15], target: [0, 1.15, 0], fov: 48 },
]);

const whip = clip(5, 'linear', 'whip-pan', [
  { t: 0, position: [0, 1.6, 6.5], target: [-12, 2, -6], fov: 56 },
  { t: 1.1, position: [0, 1.6, 6.5], target: [-12, 2, -6], fov: 56 },
  { t: 1.35, position: [0, 1.6, 6.5], target: HEAD, fov: 42 },
  { t: 2.8, position: [0, 1.6, 6.5], target: HEAD, fov: 38 },
  { t: 3.05, position: [0, 1.6, 6.5], target: [12, 6, -14], fov: 58 },
  { t: 5, position: [0, 1.6, 6.5], target: [12, 6, -14], fov: 58 },
]);

const crash = clip(5, 'linear', 'crash-zoom', [
  { t: 0, position: [0.2, 1.25, 9], target: HEAD, fov: 48 },
  { t: 1.7, position: [0.2, 1.25, 9], target: HEAD, fov: 48 },
  { t: 1.95, position: [0.2, 1.2, 8.6], target: HEAD, fov: 10 },
  { t: 5, position: [0.35, 1.12, 8.2], target: [0.05, 1.02, 0], fov: 10 },
]);

const arc = clip(7, 'linear', 'arc-push', tighten(7, 100, 8, 6.5, 1.35, 1.7, 1.08, 42, 20));

/** Straight down on the plaza, then the boom falls and tips up to her face. */
const bird = clip(7, 'smooth', 'birds-eye', [
  { t: 0, position: [0.2, 24, 0.4], target: [0, 0, 0], fov: 50 },
  { t: 2.4, position: [1.5, 12, 2], target: [0, 0.4, 0], fov: 46 },
  { t: 4.6, position: [2.2, 3.2, 5], target: [0, 0.9, 0], fov: 40 },
  { t: 7, position: [1.1, 1.35, 3.4], target: HEAD, fov: 32 },
]);

/** She sprints across the avenue; the camera stays ahead of her and low. */
const lead = (() => {
  const duration = 5.5;
  return clip(duration, 'linear', 'lead', samples(22, duration, (k) => {
    const s = smooth(k);
    const x = lerp(-8, 8, s);
    const z = 1.2;
    return {
      position: [x + 2.6, 0.55 + Math.sin(k * Math.PI) * 0.35, z + 1.8],
      target: [x - 0.4, 0.85, z],
      fov: lerp(62, 40, k),
    };
  }));
})();

const slider = clip(6, 'smooth', 'slider', [
  { t: 0, position: [-7.5, 1.5, 2.2], target: [-10, 3, -8], fov: 48 },
  { t: 1.2, position: [-6.2, 1.45, 2.6], target: [-8, 2.2, -6], fov: 46 },
  { t: 3.4, position: [-1.2, 1.3, 4.2], target: HEAD, fov: 38 },
  { t: 6, position: [1.6, 1.15, 3.2], target: [0.1, 1.02, 0], fov: 28 },
]);

const spiralOut = clip(8, 'linear', 'spiral-out', tighten(8, 10, -220, 1.45, 13, 1.12, 9, 16, 58));

const smash = clip(5.5, 'linear', 'smash-out', [
  { t: 0, position: [0.15, 1.08, 2.4], target: HEAD, fov: 14 },
  { t: 1.6, position: [0.15, 1.08, 2.5], target: HEAD, fov: 14 },
  { t: 1.9, position: [-2, 4.5, 12], target: [0, 2, -6], fov: 72 },
  { t: 5.5, position: [-4, 7, 16], target: [0, 3, -10], fov: 64 },
]);

/** Side truck on a walk, medium-long lens, profile held in frame. */
const truck = (() => {
  const duration = 8;
  return clip(duration, 'linear', 'truck', samples(24, duration, (k) => {
    const s = smooth(k);
    const z = lerp(4, -5, s);
    return {
      position: [3.1, 1.15, z + 0.15],
      target: [0, 1.0, z],
      fov: 27,
    };
  }));
})();

/** From behind her shoulder, through her, and on into the arch. */
const pushPast = clip(6.5, 'smooth', 'push-past', [
  { t: 0, position: [0.35, 1.7, -4.2], target: [0, 1.15, 1], fov: 36 },
  { t: 2.2, position: [0.7, 1.45, -1.1], target: [0, 1.2, 2], fov: 42 },
  { t: 4, position: [1.1, 1.35, 1.6], target: [0, 2.4, -8], fov: 52 },
  { t: 6.5, position: [1.4, 1.6, 4.5], target: [0, 3.5, -14], fov: 58 },
]);

/** She spins one way, the camera the other, so the colonnade streaks. */
const counter = (() => {
  const duration = 7;
  return clip(duration, 'linear', 'counter', samples(28, duration, (k) => {
    const a = rad(lerp(200, -160, k));
    const r = 3.6;
    return {
      position: [Math.sin(a) * r, 1.25 + Math.sin(k * Math.PI * 2) * 0.35, Math.cos(a) * r],
      target: HEAD,
      fov: lerp(34, 46, 0.5 - 0.5 * Math.cos(k * Math.PI * 2)),
    };
  }));
})();

const worm = clip(7, 'linear', 'worm', tighten(7, -80, 200, 2.6, 1.35, 0.16, 0.22, 82, 70, [0, 0.75, 0]));

/** Long lens, she runs straight at the camera and fills the frame late. */
const approach = (() => {
  const duration = 6;
  return clip(duration, 'linear', 'approach', samples(20, duration, (k) => {
    const s = smooth(k);
    const z = lerp(-9, 2.2, s);
    return {
      position: [lerp(-0.8, 0.6, k), lerp(1.05, 1.35, k), 16],
      target: [0, 0.95, z],
      fov: lerp(9, 14, k),
    };
  }));
})();

export const SHOT_DEMOS: ShotDemo[] = [
  { id: 'crane', name: 'Crane reveal', lens: 'Wide 68° → 46°', note: 'Starts on the marble at her feet and rises to take in the avenue, the arch and the towers.', ...stand(0, 'determined'), duration: 8, camera: crane },
  { id: 'tele', name: 'Telephoto slide', lens: 'Long 11°', note: 'A long lens from down the avenue. She barely moves in frame; the colonnade stacks flat behind her.', ...stand(12, 'smirk'), duration: 7, camera: tele },
  { id: 'orbit', name: 'Tightening orbit', lens: 'Wide 52° → 24°', note: 'A full sweep that spirals in, dropping from a high wide to an eye-level close view.', ...stand(20, 'grin'), duration: 9, camera: orbit },
  { id: 'pan', name: 'Pan to subject', lens: 'Wide 44°', note: 'The head is locked. The frame pans off the skyline, settles on her wave, then carries on to the towers.', ...stand(-8, 'happy', 'wave'), duration: 7, camera: pan },
  { id: 'dolly', name: 'Dolly zoom', lens: '11° → ~55°', note: 'Dolly in, zoom out. Her size in frame holds while the city behind her stretches — the vertigo shot.', ...stand(0, 'worried'), duration: 6, camera: dollyZoom },
  {
    id: 'follow', name: 'Running follow', lens: 'Wide 50° → 32°', note: 'She sprints the avenue. The camera chases from behind, weaves, and drops onto her shoulder.',
    duration: 6.5,
    camera: follow,
    positions: { [SHOT_CHARACTER]: { position: [2.4, 0, 6], rotationY: 180, moves: [{ t: 6.5, position: [2.4, 0, -9], rotationY: 180 }] } },
    expressions: { [SHOT_CHARACTER]: [{ t: 0, expression: 'determined' }] },
    poses: { [SHOT_CHARACTER]: [{ t: 0, pose: 'idle' }] },
  },
  { id: 'hero', name: 'Low-angle push', lens: 'Ultra-wide 74°', note: 'On the ground, looking up. A wide lens pushes in as she cheers — the hero frame.', ...stand(0, 'shout', 'cheer'), duration: 5.5, camera: hero },
  { id: 'whip', name: 'Whip pan', lens: 'Wide 56°', note: 'Holds on the left colonnade, snaps across her face, and lands on the far towers.', ...stand(0, 'surprised'), duration: 5, camera: whip },
  { id: 'crash', name: 'Crash zoom', lens: '48° → 10°', note: 'A wide hold, then the lens punches into her eyes and creeps closer.', ...stand(0, 'ooh'), duration: 5, camera: crash },
  { id: 'arc', name: 'Arc into close-up', lens: '42° → 20°', note: 'Swings off her profile and pushes in, narrowing from a normal lens to a short telephoto.', ...stand(-30, 'happy'), duration: 7, camera: arc },
  { id: 'bird', name: "Bird's-eye drop", lens: '50° → 32°', note: 'Opens straight down on the plaza, then the boom falls and tips up onto her face.', ...stand(0, 'surprised', 'reach'), duration: 7, camera: bird },
  {
    id: 'lead', name: 'Leading run', lens: 'Wide 62° → 40°', note: 'She sprints across the avenue. The camera stays low and ahead, looking back as she catches it.',
    duration: 5.5,
    camera: lead,
    positions: { [SHOT_CHARACTER]: { position: [-8, 0, 1.2], rotationY: 90, moves: [{ t: 5.5, position: [8, 0, 1.2], rotationY: 90 }] } },
    expressions: { [SHOT_CHARACTER]: [{ t: 0, expression: 'grin' }] },
  },
  { id: 'slider', name: 'Slider reveal', lens: '48° → 28°', note: 'A lateral slide out from the colonnade. The city gives way and she is there, already waving.', ...stand(25, 'happy', 'wave'), duration: 6, camera: slider },
  { id: 'spiral', name: 'Spiral out', lens: '16° → 58°', note: 'Starts on a tight telephoto and unwinds upward until the whole avenue is in frame.', ...stand(0, 'neutral', 'think'), duration: 8, camera: spiralOut },
  { id: 'smash', name: 'Smash zoom out', lens: '14° → 72°', note: 'Holds on her eyes, then rips wide and back so she is suddenly small in the city.', ...stand(0, 'ooh'), duration: 5.5, camera: smash },
  {
    id: 'truck', name: 'Profile truck', lens: 'Medium 27°', note: 'She walks the avenue. A medium lens tracks beside her and keeps the profile locked.',
    duration: 8,
    camera: truck,
    positions: { [SHOT_CHARACTER]: { position: [0, 0, 4], rotationY: 180, moves: [{ t: 8, position: [0, 0, -5], rotationY: 180 }] } },
    expressions: { [SHOT_CHARACTER]: [{ t: 0, expression: 'smirk' }] },
  },
  { id: 'past', name: 'Push past', lens: '36° → 58°', note: 'From behind her shoulder, through her, and on down the avenue to the arch.', ...stand(180, 'determined'), duration: 6.5, camera: pushPast },
  {
    id: 'counter', name: 'Counter-orbit', lens: '34° → 46°', note: 'She turns one way and the camera whips the other, so the columns streak around her.',
    duration: 7,
    camera: counter,
    positions: { [SHOT_CHARACTER]: { position: [0, 0, 0], rotationY: 0, moves: [{ t: 7, position: [0, 0, 0], rotationY: -360 }] } },
    expressions: { [SHOT_CHARACTER]: [{ t: 0, expression: 'laugh' }] },
    poses: { [SHOT_CHARACTER]: [{ t: 0, pose: 'cheer' }] },
  },
  { id: 'worm', name: "Worm's-eye orbit", lens: 'Ultra-wide 82°', note: 'Circles her at ankle height on a very wide lens, looking up the whole way.', ...stand(0, 'shout', 'arms_crossed'), duration: 7, camera: worm },
  {
    id: 'approach', name: 'Long-lens approach', lens: 'Long 9°', note: 'She runs straight at a distant telephoto. Compression holds her small, then she fills the frame.',
    duration: 6,
    camera: approach,
    positions: { [SHOT_CHARACTER]: { position: [0, 0, -9], rotationY: 0, moves: [{ t: 6, position: [0, 0, 2.2], rotationY: 0 }] } },
    expressions: { [SHOT_CHARACTER]: [{ t: 0, expression: 'determined' }] },
  },
];
