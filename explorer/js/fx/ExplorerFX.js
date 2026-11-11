/**
 * ExplorerFX — lightweight cinematic post-processing shared by all explorer pages.
 * Exposed as window.ExplorerFX. Depends on window.THREE (r158) and, optionally,
 * window.ExplorerSettings for its configuration.
 *
 *   ExplorerFX.render(renderer, scene, camera, opts?)  drop-in for renderer.render()
 *   ExplorerFX.addBackdrop(scene)                       faint nebula sphere (render() adds it automatically)
 *   ExplorerFX.overlay()                                CSS grain/vignette for non-WebGL pages
 *
 * Pipeline (desktop, all effects on): scene → HalfFloat MSAA target holding
 * sRGB-encoded colour → bloom (threshold + 4-level dual-filter blur) → one
 * composite pass doing chromatic aberration, bloom add, vignette and film grain.
 * WebXR sessions bypass everything and render directly.
 *
 * opts: { bloomThreshold?: number } — per-page override (pages heavy in white text).
 */
(function () {
    'use strict';

    var BLOOM_LEVELS = 4;
    var DEFAULT_THRESHOLD = 0.85;   // in sRGB-encoded values
    var states = new Map();   // renderer -> state
    var reducedMotion = false;
    try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

    function settings() {
        if (window.ExplorerSettings) return ExplorerSettings.all();
        return { postprocessing: true, grain: 0.06, vignette: 0.45, bloom: 0.8, chromatic: false, backdrop: true, antialias: true, showFps: false };
    }

    // ---- shaders -----------------------------------------------------------

    var VERT = [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = position.xy * 0.5 + 0.5;',
        '  gl_Position = vec4(position.xy, 0.0, 1.0);',
        '}'
    ].join('\n');

    // Threshold + 4-tap box downsample from the full-res scene.
    var BRIGHT_FRAG = [
        'uniform sampler2D tSrc;',
        'uniform vec2 texel;',
        'uniform float threshold;',
        'varying vec2 vUv;',
        'vec3 pick(vec2 uv) {',
        '  vec3 c = texture2D(tSrc, uv).rgb;',
        '  float l = max(c.r, max(c.g, c.b));',
        '  return c * smoothstep(threshold, threshold + 0.25, l);',
        '}',
        'void main() {',
        '  vec2 h = texel * 0.5;',
        '  vec3 c = pick(vUv + vec2(-h.x, -h.y)) + pick(vUv + vec2(h.x, -h.y))',
        '         + pick(vUv + vec2(-h.x, h.y)) + pick(vUv + vec2(h.x, h.y));',
        '  gl_FragColor = vec4(min(c * 0.25, vec3(8.0)), 1.0);',
        '}'
    ].join('\n');

    // Dual-Kawase downsample.
    var DOWN_FRAG = [
        'uniform sampler2D tSrc;',
        'uniform vec2 texel;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 h = texel * 0.5;',
        '  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;',
        '  s += texture2D(tSrc, vUv - h).rgb;',
        '  s += texture2D(tSrc, vUv + h).rgb;',
        '  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb;',
        '  s += texture2D(tSrc, vUv - vec2(h.x, -h.y)).rgb;',
        '  gl_FragColor = vec4(s / 8.0, 1.0);',
        '}'
    ].join('\n');

    // Dual-Kawase upsample, additively blended onto the next larger level.
    var UP_FRAG = [
        'uniform sampler2D tSrc;',
        'uniform vec2 texel;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 h = texel * 0.5;',
        '  vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;',
        '  s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;',
        '  s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;',
        '  s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;',
        '  s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;',
        '  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;',
        '  s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;',
        '  s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;',
        '  gl_FragColor = vec4(s / 12.0, 1.0);',
        '}'
    ].join('\n');

    var COMPOSITE_FRAG = [
        'uniform sampler2D tScene;',
        'uniform sampler2D tBloom;',
        'uniform float bloomStrength;',
        'uniform float chroma;',
        'uniform float vignette;',
        'uniform float grain;',
        'uniform float seed;',
        'uniform float aspect;',
        'varying vec2 vUv;',
        'float hash(vec2 p) {',
        '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
        '  p3 += dot(p3, p3.yzx + 33.33);',
        '  return fract((p3.x + p3.y) * p3.z);',
        '}',
        'void main() {',
        '  vec2 d = vUv - 0.5;',
        '  float r2 = dot(d, d);',
        '  vec3 col;',
        '  if (chroma > 0.0) {',
        '    vec2 off = d * r2 * chroma;',
        '    col.r = texture2D(tScene, vUv + off).r;',
        '    col.g = texture2D(tScene, vUv).g;',
        '    col.b = texture2D(tScene, vUv - off).b;',
        '  } else {',
        '    col = texture2D(tScene, vUv).rgb;',
        '  }',
        '  if (bloomStrength > 0.0) col += texture2D(tBloom, vUv).rgb * bloomStrength;',
        '  vec3 o = max(col, vec3(0.0));',
        '  vec2 dv = d * vec2(mix(1.0, aspect, 0.5), 1.0);',
        '  float v = smoothstep(0.95, 0.2, length(dv) * 1.25);',
        '  o *= mix(1.0, v, vignette);',
        '  float n = hash(gl_FragCoord.xy + seed * 61.7) - 0.5;',
        '  float luma = dot(o, vec3(0.299, 0.587, 0.114));',
        '  o += n * (grain * (1.0 - 0.6 * luma) + 1.0 / 255.0);',
        '  gl_FragColor = vec4(o, 1.0);',
        '}'
    ].join('\n');

    // Neutral nebula on a camera-centred unit sphere.
    var BACKDROP_VERT = [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = normalize(position);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');

    var BACKDROP_FRAG = [
        'varying vec3 vDir;',
        'float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
        'float vnoise(vec3 x) {',
        '  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),',
        '             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);',
        '}',
        'float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float neb = fbm(d * 2.2 + vec3(4.1, 1.7, 9.3));',
        '  neb = smoothstep(0.42, 0.85, neb) * (0.6 + 0.4 * fbm(d * 7.0));',
        '  vec3 col = vec3(neb * 0.0055);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <colorspace_fragment>',
        '}'
    ].join('\n');

    // ---- per-renderer state ------------------------------------------------

    function makeTarget(w, h, samples, sceneTarget) {
        var rt = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: !!sceneTarget,
            samples: samples > 0 ? samples : 0
        });
        rt.texture.generateMipmaps = false;
        if (sceneTarget) {
            // Make three treat this target like the canvas: materials output sRGB-encoded
            // colour (and tone mapping applies), so transparent objects blend in the same
            // space as direct rendering and pages look identical with FX on or off.
            // With HalfFloat the GL format stays RGBA16F, so nothing is decoded on sampling.
            // (r158 reads this flag only for output colour space / tone mapping.)
            rt.texture.colorSpace = THREE.SRGBColorSpace;
            rt.isXRRenderTarget = true;
        }
        return rt;
    }

    function passMaterial(frag, uniforms, additive) {
        return new THREE.ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: frag,
            uniforms: uniforms,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
            transparent: !!additive
        });
    }

    function createState(renderer) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        var quad = new THREE.Mesh(geo);
        quad.frustumCulled = false;
        var quadScene = new THREE.Scene();
        quadScene.add(quad);

        var st = {
            renderer: renderer,
            quad: quad,
            quadScene: quadScene,
            quadCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
            sceneRT: null,
            mips: [],
            width: 0, height: 0, samples: -1,
            lastScene: null,
            prevCam: new THREE.Matrix4(),
            prevScene: new THREE.Matrix4(),
            lastMove: -1e9,
            applied: false,
            pageShadows: renderer.shadowMap.enabled,
            bright: passMaterial(BRIGHT_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: DEFAULT_THRESHOLD } }),
            down: passMaterial(DOWN_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } }),
            up: passMaterial(UP_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } }, true),
            composite: passMaterial(COMPOSITE_FRAG, {
                tScene: { value: null }, tBloom: { value: null },
                bloomStrength: { value: 0 }, chroma: { value: 0 }, vignette: { value: 0 },
                grain: { value: 0 }, seed: { value: 0 }, aspect: { value: 1 }
            })
        };
        states.set(renderer, st);
        return st;
    }

    function disposeTargets(st) {
        if (st.sceneRT) st.sceneRT.dispose();
        st.mips.forEach(function (m) { m.dispose(); });
        st.sceneRT = null;
        st.mips = [];
    }

    var _size = null;
    function ensureTargets(st, wantBloom, samples) {
        _size = _size || new THREE.Vector2();
        st.renderer.getDrawingBufferSize(_size);
        var w = Math.max(1, _size.x), h = Math.max(1, _size.y);
        if (st.sceneRT && st.width === w && st.height === h && st.samples === samples) {
            if (!wantBloom || st.mips.length) return;
        }
        if (!st.sceneRT || st.width !== w || st.height !== h || st.samples !== samples) {
            disposeTargets(st);
            st.sceneRT = makeTarget(w, h, samples, true);
            st.width = w; st.height = h; st.samples = samples;
        }
        if (wantBloom && !st.mips.length) {
            var mw = w, mh = h;
            for (var i = 0; i < BLOOM_LEVELS; i++) {
                mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
                st.mips.push(makeTarget(mw, mh, 0, false));
            }
        }
    }

    function blit(st, material, target) {
        st.quad.material = material;
        st.renderer.setRenderTarget(target);
        st.renderer.render(st.quadScene, st.quadCam);
    }

    // ---- FPS meter ---------------------------------------------------------

    var fps = { el: null, frames: 0, last: 0 };
    function tickFps(show) {
        if (!show) {
            if (fps.el) { fps.el.remove(); fps.el = null; }
            return;
        }
        if (!fps.el) {
            fps.el = document.createElement('div');
            fps.el.className = 'fx-fps';
            fps.el.textContent = '— fps';
            document.body.appendChild(fps.el);
            fps.last = performance.now();
            fps.frames = 0;
        }
        fps.frames++;
        var now = performance.now();
        if (now - fps.last >= 500) {
            fps.el.textContent = Math.round(fps.frames * 1000 / (now - fps.last)) + ' fps';
            fps.frames = 0;
            fps.last = now;
        }
    }

    // ---- public API --------------------------------------------------------

    // Every rendered scene gets the backdrop; it is re-attached if a page's
    // teardown/reload code strips scene.children.
    function syncBackdrop(scene, s, presenting) {
        if (!scene || !scene.isScene) return;
        var bd = scene.userData.__fxBackdrop;
        if (!bd && !s.backdrop) return;
        if (!bd || bd.parent !== scene) bd = addBackdrop(scene);
        bd.visible = !!s.backdrop && !presenting;
    }

    function render(renderer, scene, camera, opts) {
        var s = settings();
        var presenting = !!(renderer.xr && renderer.xr.isPresenting);
        var st = states.get(renderer) || createState(renderer);
        st.lastScene = scene;
        if (!st.applied) {
            st.applied = true;
            applySettings(st, s);
        }
        syncBackdrop(scene, s, presenting);
        tickFps(s.showFps && !presenting);

        if (presenting || !s.postprocessing || !renderer.capabilities.isWebGL2) {
            renderer.render(scene, camera);
            return;
        }

        var bloom = +s.bloom || 0;
        var samples = s.antialias ? 4 : 0;
        ensureTargets(st, bloom > 0, samples);

        var prevTarget = renderer.getRenderTarget();
        var prevAutoClear = renderer.autoClear;

        renderer.setRenderTarget(st.sceneRT);
        renderer.render(scene, camera);

        // View motion = camera moved or the scene itself was rotated (e.g. network montage).
        var now = performance.now();
        if (!st.prevCam.equals(camera.matrixWorld) || !st.prevScene.equals(scene.matrixWorld)) {
            st.lastMove = now;
            st.prevCam.copy(camera.matrixWorld);
            st.prevScene.copy(scene.matrixWorld);
        }
        // Grain is always drawn; in motion-only mode its pattern freezes while the view is still.
        var animateGrain = !reducedMotion && (!s.grainMotionOnly || now - st.lastMove < 120);
        if (animateGrain || st.seed == null) st.seed = Math.floor(now / 41.67) % 997; // ~24 fps film grain

        renderer.autoClear = false;
        if (bloom > 0) {
            var m = st.mips;
            st.bright.uniforms.tSrc.value = st.sceneRT.texture;
            st.bright.uniforms.texel.value.set(1 / st.width, 1 / st.height);
            st.bright.uniforms.threshold.value = (opts && opts.bloomThreshold != null) ? opts.bloomThreshold : DEFAULT_THRESHOLD;
            blit(st, st.bright, m[0]);
            for (var i = 1; i < m.length; i++) {
                st.down.uniforms.tSrc.value = m[i - 1].texture;
                st.down.uniforms.texel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height);
                blit(st, st.down, m[i]);
            }
            for (var j = m.length - 1; j > 0; j--) {
                st.up.uniforms.tSrc.value = m[j].texture;
                st.up.uniforms.texel.value.set(1 / m[j].width, 1 / m[j].height);
                blit(st, st.up, m[j - 1]);
            }
        }

        var u = st.composite.uniforms;
        u.tScene.value = st.sceneRT.texture;
        u.tBloom.value = bloom > 0 ? st.mips[0].texture : null;
        u.bloomStrength.value = bloom * 0.9;
        u.chroma.value = s.chromatic ? 0.012 : 0;
        u.vignette.value = +s.vignette || 0;
        u.grain.value = +s.grain || 0;
        u.seed.value = st.seed;
        u.aspect.value = st.width / st.height;
        blit(st, st.composite, prevTarget);

        renderer.autoClear = prevAutoClear;
    }

    function applySettings(st, s) {
        var r = st.renderer;
        if (window.ExplorerSettings) ExplorerSettings.applyToRenderer(r);
        // Shadows can only be switched off; "on" restores the page's own default.
        var wantShadows = s.shadows ? st.pageShadows : false;
        // Lit materials recompile on their own when the light/shadow state changes,
        // so no material traversal is needed (network has ~100k node materials).
        if (r.shadowMap.enabled !== wantShadows) r.shadowMap.enabled = wantShadows;
        if (!s.bloom && st.mips.length) {
            st.mips.forEach(function (m) { m.dispose(); });
            st.mips = [];
        }
    }

    function addBackdrop(scene) {
        if (!scene || typeof THREE === 'undefined') return null;
        var existing = scene.userData.__fxBackdrop;
        if (existing) {
            if (existing.parent !== scene) scene.add(existing);
            return existing;
        }

        var mat = new THREE.ShaderMaterial({
            vertexShader: BACKDROP_VERT,
            fragmentShader: BACKDROP_FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            fog: false
        });
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
        mesh.name = 'fx-backdrop';
        mesh.frustumCulled = false;
        mesh.renderOrder = -1e9;
        mesh.matrixAutoUpdate = false;
        mesh.raycast = function () { /* never pickable */ };
        var camPos = new THREE.Vector3();
        mesh.onBeforeRender = function (r, sc, cam) {
            cam.getWorldPosition(camPos);
            var radius = (cam.far || 1000) * 0.5;
            mesh.matrixWorld.makeScale(radius, radius, radius).setPosition(camPos);
        };
        scene.add(mesh);
        scene.userData.__fxBackdrop = mesh;
        return mesh;
    }

    // ---- CSS overlay for non-WebGL pages -----------------------------------

    var overlayEl = null;
    function grainTile() {
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
            "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
            "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.4 -1.2'/></filter>" +
            "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
        return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
    }

    function syncOverlay(s) {
        if (!overlayEl) return;
        var on = !!s.postprocessing;
        overlayEl.style.display = on ? '' : 'none';
        overlayEl.classList.toggle('fx-overlay-still', !!s.grainMotionOnly);
        overlayEl.querySelector('.fx-overlay-grain').style.opacity = String(Math.min(1, (+s.grain || 0) * 2.2));
        overlayEl.querySelector('.fx-overlay-vignette').style.opacity = String(Math.min(1, (+s.vignette || 0) * 1.6));
    }

    function overlay() {
        if (overlayEl) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.className = 'fx-overlay';
        overlayEl.setAttribute('aria-hidden', 'true');
        overlayEl.innerHTML = '<div class="fx-overlay-grain"></div><div class="fx-overlay-vignette"></div>';
        overlayEl.querySelector('.fx-overlay-grain').style.backgroundImage = grainTile();
        document.body.appendChild(overlayEl);
        syncOverlay(settings());
        return overlayEl;
    }

    if (window.ExplorerSettings) {
        ExplorerSettings.onChange(function (s) {
            states.forEach(function (st) { applySettings(st, s); });
            syncOverlay(s);
            if (!s.showFps) tickFps(false);
        });
    }

    function dispose(renderer) {
        var st = states.get(renderer);
        if (!st) return;
        disposeTargets(st);
        [st.bright, st.down, st.up, st.composite].forEach(function (m) { m.dispose(); });
        st.quad.geometry.dispose();
        states.delete(renderer);
    }

    window.ExplorerFX = {
        render: render,
        addBackdrop: addBackdrop,
        overlay: overlay,
        dispose: dispose,
        setSize: function () { /* targets track the drawing buffer automatically */ }
    };
})();
