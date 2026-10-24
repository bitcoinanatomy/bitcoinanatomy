/**
 * Minimal glTF 2.0 binary (.glb) writer for three.js BufferGeometry.
 * Avoids GLTFExporter's browser dependencies so placeholder meshes can be
 * generated in Node. Output imports cleanly into three.js and Blender.
 */
import zlib from 'node:zlib';
import type { BufferGeometry } from 'three';

export interface GlbMaterial {
  name: string;
  color: [number, number, number, number?];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  emissiveStrength?: number;
  /** PNG bytes used as baseColorTexture */
  texture?: Uint8Array;
  /** < 1 makes the material alpha-blended (glass, light shafts) */
  opacity?: number;
  doubleSided?: boolean;
}
export interface GlbPart {
  name: string;
  geometry: BufferGeometry;
  material: GlbMaterial;
  translation?: [number, number, number];
  /** Parent part name. Omitted parts hang off the root. */
  parent?: string;
}

export function writeGlb(rootName: string, parts: GlbPart[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const pad4 = () => {
    const p = (4 - (offset % 4)) % 4;
    if (p) {
      chunks.push(new Uint8Array(p));
      offset += p;
    }
  };
  const addView = (bytes: Uint8Array, target?: number) => {
    pad4();
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    offset += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (arr: Float32Array | Uint32Array, type: 'VEC3' | 'VEC2' | 'SCALAR', withBounds = false) => {
    const isIndex = arr instanceof Uint32Array;
    const view = addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), isIndex ? 34963 : 34962);
    const size = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const acc: Record<string, unknown> = {
      bufferView: view,
      componentType: isIndex ? 5125 : 5126,
      count: arr.length / size,
      type,
    };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity].slice(0, size);
      const max = [-Infinity, -Infinity, -Infinity].slice(0, size);
      for (let i = 0; i < arr.length; i++) {
        const c = i % size;
        min[c] = Math.min(min[c], arr[i]);
        max[c] = Math.max(max[c], arr[i]);
      }
      Object.assign(acc, { min, max });
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const materials: object[] = [];
  const images: object[] = [];
  const textures: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [{ name: rootName, children: [] as number[] }];
  const matIndex = new Map<string, number>();
  const extensionsUsed = new Set<string>();

  for (const part of parts) {
    const g = part.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const nor = g.getAttribute('normal')?.array as Float32Array | undefined;
    const uv = g.getAttribute('uv')?.array as Float32Array | undefined;
    const attributes: Record<string, number> = { POSITION: addAccessor(new Float32Array(pos), 'VEC3', true) };
    if (nor) attributes.NORMAL = addAccessor(new Float32Array(nor), 'VEC3');
    if (uv) attributes.TEXCOORD_0 = addAccessor(new Float32Array(uv), 'VEC2');
    const prim: Record<string, unknown> = { attributes };
    if (g.index) prim.indices = addAccessor(new Uint32Array(g.index.array), 'SCALAR');

    const m = part.material;
    if (!matIndex.has(m.name)) {
      const mat: Record<string, unknown> = {
        name: m.name,
        pbrMetallicRoughness: {
          baseColorFactor: [m.color[0], m.color[1], m.color[2], m.opacity ?? m.color[3] ?? 1],
          metallicFactor: m.metallic ?? 0,
          roughnessFactor: m.roughness ?? 0.6,
        },
      };
      if ((m.opacity ?? 1) < 1) mat.alphaMode = 'BLEND';
      if (m.doubleSided) mat.doubleSided = true;
      if (m.emissive) {
        mat.emissiveFactor = m.emissive;
        if ((m.emissiveStrength ?? 1) !== 1) {
          mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.emissiveStrength } };
          extensionsUsed.add('KHR_materials_emissive_strength');
        }
      }
      if (m.texture) {
        images.push({ bufferView: addView(m.texture), mimeType: 'image/png' });
        textures.push({ source: images.length - 1, sampler: 0 });
        (mat.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = { index: textures.length - 1 };
      }
      materials.push(mat);
      matIndex.set(m.name, materials.length - 1);
    }
    prim.material = matIndex.get(m.name);
    meshes.push({ name: part.name, primitives: [prim] });
    nodes.push({ name: part.name, mesh: meshes.length - 1, ...(part.translation ? { translation: part.translation } : {}) });
    (nodes[0] as { children: number[] }).children.push(nodes.length - 1);
  }
  const byName = new Map<string, number>();
  nodes.forEach((n, i) => {
    if (i) byName.set((n as { name: string }).name, i);
  });
  for (const part of parts) {
    if (!part.parent) continue;
    const child = byName.get(part.name);
    const parent = byName.get(part.parent);
    if (child == null || parent == null) continue;
    const rootKids = (nodes[0] as { children: number[] }).children;
    const at = rootKids.indexOf(child);
    if (at >= 0) rootKids.splice(at, 1);
    const p = nodes[parent] as { children?: number[] };
    (p.children ??= []).push(child);
  }
  pad4();

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'film-maker' },
    scene: 0,
    scenes: [{ name: rootName, nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  };
  if (images.length) Object.assign(gltf, { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] });
  if (extensionsUsed.size) gltf.extensionsUsed = [...extensionsUsed];

  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jpad = (4 - (json.byteLength % 4)) % 4;
  if (jpad) {
    const j = new Uint8Array(json.byteLength + jpad).fill(0x20);
    j.set(json);
    json = j;
  }
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, json.byteLength, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  const b = 20 + json.byteLength;
  v.setUint32(b, bin.byteLength, true);
  v.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  return out;
}

// ---------------------------------------------------------------- PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Encode RGBA pixels as PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    const td = new Uint8Array(4 + data.length);
    td.set(new TextEncoder().encode(type));
    td.set(data, 4);
    out.set(td, 4);
    v.setUint32(8 + data.length, crc32(td));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ];
  const len = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}
