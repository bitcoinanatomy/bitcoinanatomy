/**
 * Shaded preview grade, used only when the look is `shaded`.
 * Blue noise, an edge-weighted spectral fringe, a diagonal falloff,
 * and one tetrahedral LUT. Pixar keeps FinishShader.
 */
import * as THREE from 'three';

const LUT_SIZE = 16;

function blueNoiseTexture() {
  const n = 64;
  const src = new Float32Array(n * n);
  for (let i = 0; i < src.length; i++) src[i] = Math.random();
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      let w = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ww = 1 / (1 + dx * dx + dy * dy);
          s += src[((y + dy + n) % n) * n + ((x + dx + n) % n)] * ww;
          w += ww;
        }
      }
      const hp = src[y * n + x] - s / w + 0.5;
      out[y * n + x] = Math.max(0, Math.min(255, Math.round(hp * 255)));
    }
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A cool, slightly contrasty grade baked into a 2D slice of a 3D LUT (x = r + b * size, y = g). */
function filmLutTexture() {
  const size = LUT_SIZE;
  const data = new Uint8Array(size * size * size * 4);
  const curve = (x: number) => {
    const y = x - 0.5;
    return Math.min(1, Math.max(0, x + y * 0.16 - y * y * y * 0.35));
  };
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        let R = curve(r / (size - 1));
        let G = curve(g / (size - 1));
        let B = curve(b / (size - 1));
        const l = (R + G + B) / 3;
        const cool = 1 - l;
        R = R * (1 - 0.07 * cool) + 0.015 * l;
        G = G * (1 - 0.02 * cool);
        B = Math.min(1, B * (1 + 0.1 * cool) + 0.01 * cool);
        const o = ((g * size * size) + (b * size) + r) * 4;
        data[o] = Math.round(R * 255);
        data[o + 1] = Math.round(G * 255);
        data[o + 2] = Math.round(B * 255);
        data[o + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, size * size, size);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const blue = blueNoiseTexture();
const lut = filmLutTexture();

export function shadedUniforms() {
  return {
    tDiffuse: { value: null as THREE.Texture | null },
    tBlue: { value: blue },
    tLUT: { value: lut },
    uLUTSize: { value: LUT_SIZE },
    uBlueOffset: { value: new THREE.Vector2() },
  };
}

const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBlue;
  uniform sampler2D tLUT;
  uniform float uLUTSize;
  uniform vec2 uBlueOffset;
  varying vec2 vUv;

  vec3 spectrum(float t) {
    return clamp(vec3(
      1.5 - abs(4.0 * t - 0.5),
      1.5 - abs(4.0 * t - 2.0),
      1.5 - abs(4.0 * t - 3.5)
    ), 0.0, 1.0);
  }

  vec2 barrel(vec2 uv, float amt) {
    vec2 d = uv - 0.5;
    return uv + d * dot(d, d) * amt;
  }

  vec3 fringe(vec2 uv, float maxDistort, float bend) {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 5; i++) {
      float t = float(i) / 4.0;
      vec3 w = spectrum(t);
      sum += w * texture2D(tDiffuse, barrel(uv, bend * maxDistort * t)).rgb;
      wsum += dot(w, vec3(1.0));
    }
    return sum / max(wsum, 0.0001);
  }

  vec3 lutAt(float r, float g, float b) {
    vec2 uv = vec2((r + b * uLUTSize + 0.5) / (uLUTSize * uLUTSize), (g + 0.5) / uLUTSize);
    return texture2D(tLUT, uv).rgb;
  }

  vec3 applyLut(vec3 color) {
    float scale = uLUTSize - 1.0;
    vec3 rgb = clamp(color, 0.0, 1.0) * scale;
    vec3 p = floor(rgb);
    vec3 f = rgb - p;
    float r0 = p.r;
    float g0 = p.g;
    float b0 = p.b;
    float r1 = min(p.r + 1.0, scale);
    float g1 = min(p.g + 1.0, scale);
    float b1 = min(p.b + 1.0, scale);
    vec3 c000 = lutAt(r0, g0, b0);
    vec3 c100 = lutAt(r1, g0, b0);
    vec3 c010 = lutAt(r0, g1, b0);
    vec3 c001 = lutAt(r0, g0, b1);
    vec3 c110 = lutAt(r1, g1, b0);
    vec3 c101 = lutAt(r1, g0, b1);
    vec3 c011 = lutAt(r0, g1, b1);
    vec3 c111 = lutAt(r1, g1, b1);
    vec3 result;
    if (f.r >= f.g) {
      if (f.g >= f.b) result = c000 + (c100 - c000) * f.r + (c110 - c100) * f.g + (c111 - c110) * f.b;
      else if (f.r >= f.b) result = c000 + (c100 - c000) * f.r + (c111 - c101) * f.g + (c101 - c100) * f.b;
      else result = c000 + (c101 - c001) * f.r + (c111 - c101) * f.g + (c001 - c000) * f.b;
    } else {
      if (f.b >= f.g) result = c000 + (c111 - c011) * f.r + (c011 - c001) * f.g + (c001 - c000) * f.b;
      else if (f.r >= f.b) result = c000 + (c110 - c010) * f.r + (c010 - c000) * f.g + (c111 - c110) * f.b;
      else result = c000 + (c111 - c011) * f.r + (c010 - c000) * f.g + (c011 - c010) * f.b;
    }
    return mix(color, result, 0.85);
  }

  void main() {
    vec2 d = abs(vUv * 2.0 - 1.0);
    float edge = smoothstep(0.2, 1.0, max(d.x, d.y));
    float n = texture2D(tBlue, gl_FragCoord.xy / 64.0 + uBlueOffset).r;
    vec3 color = fringe(vUv, edge * 0.04, mix(0.35, 1.0, n));
    color += (n - 0.5) * 0.035;
    color *= mix(0.82, 1.0, (vUv.x + vUv.y) * 0.5);
    gl_FragColor = vec4(applyLut(color), 1.0);
  }
`;

export const ShadedShader = {
  uniforms: shadedUniforms(),
  vertexShader,
  fragmentShader,
};

/** One full-screen pass for thumbnails and character cards, which do not use the composer. */
let blitMat: THREE.ShaderMaterial | null = null;
let blitScene: THREE.Scene | null = null;
let blitCam: THREE.Camera | null = null;
let blitTarget: THREE.WebGLRenderTarget | null = null;

export function renderShaded(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  if (!blitTarget) blitTarget = new THREE.WebGLRenderTarget(size.x, size.y);
  if (blitTarget.width !== size.x || blitTarget.height !== size.y) blitTarget.setSize(size.x, size.y);
  if (!blitMat) {
    blitMat = new THREE.ShaderMaterial({
      uniforms: shadedUniforms(),
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
    blitScene = new THREE.Scene();
    blitScene.add(quad);
    blitCam = new THREE.Camera();
  }
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(blitTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(prev);
  blitMat.uniforms.tDiffuse.value = blitTarget.texture;
  (blitMat.uniforms.uBlueOffset.value as THREE.Vector2).set(Math.random() * 8, Math.random() * 8);
  renderer.render(blitScene!, blitCam!);
}
