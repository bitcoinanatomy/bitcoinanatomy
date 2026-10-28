/** Camera move presets for generated shots (Y-up metres; three.js convention). */
import type { CameraClip, Vec3 } from '../../src/model/schema';
import { uid } from '../../src/model/timeline';

const id = (p: string) => uid(p);

// camera moves (Y-up, metres)
export const cam = {
  push: (target: Vec3, from: number, to: number, height = 0.4, fov = 35) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'push-in',
    keys: [
      { t: 0, position: [target[0], target[1] + height, target[2] + from], target, fov },
      { t: d, position: [target[0], target[1] + height * 0.6, target[2] + to], target, fov },
    ],
  }),
  orbit: (target: Vec3, r: number, h: number, a0: number, a1: number, fov = 40) => (d: number): CameraClip => {
    const at = (a: number): Vec3 => [target[0] + Math.sin((a * Math.PI) / 180) * r, target[1] + h, target[2] + Math.cos((a * Math.PI) / 180) * r];
    return {
      id: id('cam'), start: 0, duration: d, ease: 'linear', label: 'orbit',
      keys: [0, 0.5, 1].map((k) => ({ t: d * k, position: at(a0 + (a1 - a0) * k), target, fov })),
    };
  },
  pull: (target: Vec3, from: number, to: number, fov = 45) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'pull-out',
    keys: [
      { t: 0, position: [target[0], target[1] + 0.3, target[2] + from], target, fov },
      { t: d, position: [target[0], target[1] + from * 0.35, target[2] + to], target, fov },
    ],
  }),
  still: (pos: Vec3, target: Vec3, fov = 40) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'linear', label: 'static', keys: [{ t: 0, position: pos, target, fov }],
  }),
  /** generic move between two framings */
  move: (from: Vec3, to: Vec3, targetFrom: Vec3, targetTo: Vec3 = targetFrom, fov = 40, label = 'move') => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label,
    keys: [
      { t: 0, position: from, target: targetFrom, fov },
      { t: d, position: to, target: targetTo, fov },
    ],
  }),
  /** rise up from low to high while looking at the target (establishing shots) */
  crane: (target: Vec3, dist: number, h0: number, h1: number, fov = 45) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'crane',
    keys: [
      { t: 0, position: [target[0], h0, target[2] + dist], target, fov },
      { t: d, position: [target[0], h1, target[2] + dist * 0.85], target, fov },
    ],
  }),
  /** lateral follow: the camera slides alongside a walker, `side` metres off their path */
  track: (from: Vec3, to: Vec3, side = 3, height = 0.5, fov = 38) => (d: number): CameraClip => {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dz) || 1;
    const n: Vec3 = [-dz / len, 0, dx / len];
    const off = (p: Vec3): Vec3 => [p[0] + n[0] * side, p[1] + height, p[2] + n[2] * side];
    return {
      id: id('cam'), start: 0, duration: d, ease: 'linear', label: 'track',
      keys: [
        { t: 0, position: off(from), target: from, fov },
        { t: d, position: off(to), target: to, fov },
      ],
    };
  },
  /** nervous handheld: small deterministic drift around a framing (`amp` metres), keyed ~3× a second */
  handheld: (pos: Vec3, target: Vec3, fov = 35, amp = 0.05, seed = 1) => (d: number): CameraClip => {
    const n = Math.max(2, Math.round(d * 3));
    const j = (k: number, a: number) => Math.sin(k * 12.9898 + seed * 78.233 + a) * amp;
    return {
      id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'handheld',
      keys: Array.from({ length: n + 1 }, (_, k) => ({
        t: (d * k) / n,
        position: [pos[0] + j(k, 0), pos[1] + j(k, 1.7) * 0.6, pos[2] + j(k, 3.1) * 0.5] as Vec3,
        target: [target[0] + j(k, 4.2) * 0.4, target[1] + j(k, 5.3) * 0.4, target[2]] as Vec3,
        fov,
      })),
    };
  },
  /** vertigo: dolly in while the lens widens, so the subject holds size and the world stretches behind */
  dollyZoom: (target: Vec3, from: number, to: number, fov0 = 24, fov1 = 50, height = 0.1) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'dolly-zoom',
    keys: [
      { t: 0, position: [target[0], target[1] + height, target[2] + from], target, fov: fov0 },
      { t: d, position: [target[0], target[1] + height, target[2] + to], target, fov: fov1 },
    ],
  }),
  /** low angle looking up at `target` (makes them big); `dist` along +Z, slow creep in */
  lowHero: (target: Vec3, dist = 2.2, fov = 42, ground = 0.12) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'low-angle',
    keys: [
      { t: 0, position: [target[0] + 0.2, ground, target[2] + dist], target, fov },
      { t: d, position: [target[0] + 0.1, ground, target[2] + dist * 0.88], target, fov },
    ],
  }),
  /** high angle looking down on `target` (makes them small and alone) */
  highSmall: (target: Vec3, dist = 3, height = 3, fov = 40) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'high-angle',
    keys: [
      { t: 0, position: [target[0], target[1] + height, target[2] + dist], target, fov },
      { t: d, position: [target[0], target[1] + height * 1.12, target[2] + dist * 1.1], target, fov },
    ],
  }),
  /** start tight on a detail, pull back and up to reveal the whole place */
  reveal: (detail: Vec3, wide: Vec3, fromPos: Vec3, toPos: Vec3, fov0 = 30, fov1 = 48) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'smooth', label: 'reveal',
    keys: [
      { t: 0, position: fromPos, target: detail, fov: fov0 },
      { t: d * 0.25, position: fromPos, target: detail, fov: fov0 },
      { t: d, position: toPos, target: wide, fov: fov1 },
    ],
  }),
  /** fast pan between two targets from one spot (settles on the second) */
  whip: (pos: Vec3, a: Vec3, b: Vec3, fov = 38, at = 0.15) => (d: number): CameraClip => ({
    id: id('cam'), start: 0, duration: d, ease: 'linear', label: 'whip-pan',
    keys: [
      { t: 0, position: pos, target: a, fov },
      { t: Math.min(d * at, 0.35), position: pos, target: b, fov },
      { t: d, position: pos, target: b, fov },
    ],
  }),
};
