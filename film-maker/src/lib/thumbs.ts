import type { Scene, Shot } from '../model/schema';

const isImage = (p: string) => !!p && !/\.(mp4|webm|mov)$/i.test(p);
export const shotThumb = (s: Shot) => s.tracks.storyboard.find((c) => isImage(c.image))?.image;
export const sceneThumb = (sc: Scene) => sc.shots.map(shotThumb).find(Boolean);
