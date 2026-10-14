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
};
