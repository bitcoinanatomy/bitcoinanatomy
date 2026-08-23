// Bitcoin Explorer — secp256k1 curve lesson (family / domain; kG overlay)
const CRYPTO_DEMO_MNEMONIC = 'crush miracle lawsuit inspire bomb into assist album surface will fuel control';
const CRYPTO_DEMO_PATH = "m/84'/0'/0'/0/0";
const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const BIP32_HARDENED = 0x80000000;

class BitcoinCryptoExplorer {
    constructor(opts) {
        opts = opts || {};
        this._shell = opts.shell || null;
        this._ac = new AbortController();
        this._disposed = false;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.vrManager = null;
        this.isRotating = false;
        this.isPerspective = true;
        this.orthographicZoom = 42;
        this.clock = new THREE.Clock();
        this.content = null;

        this.view = 'family';
        this.dimIndex = 0;
        this.morphT = 0;
        this.morphFrom = 0;
        this.morphTo = 0;
        this.morphing = false;
        this.morphElapsed = 0;
        this.morphDuration = 0.6;
        this._torusSubdiv = 0;
        this._torusSubdiving = false;
        this._subdivElapsed = 0;
        this._subdivDuration = 1.4;
        this._subdivFrom = 0;
        this._subdivTo = 1;
        this._pendingUnglue = null;
        this.primeIndex = 0;
        this.groupOp = 'add';
        this._groupToy = false;
        this.scalarK = 1;
        this.scalarPlaying = false;
        this.scalarTimer = 0;
        this._kgOverlay = false;
        this.selectedSliceZ = 0;
        this.familySliceCount = 45;
        this.lineLen = 50;
        this.familyPX = 2;
        this.familyPPlaying = false;
        this.familyPDir = 1;
        this._familyPDragging = false;
        this._familyOpRoot = null;
        this._fieldOpRoot = null;
        this._familyPAnimAcc = 0;
        this.fieldPIndex = 0;
        this.fieldPPlaying = false;
        this._fieldPBoundFor = null;
        this._fieldPAnimAcc = 0;
        this._sliderSync = 0;
        this.hudOp = '—';
        this.useColor = false;
        this.showGrid = true;
        this.drawCap = (window.ECC && ECC.INSTANCE_CAP) || 192000;
        this._primeNextTimer = null;
        this._realKey = null;

        this._fieldCache = null;
        this._opPtsCache = null;
        this._domainState = null;
        this._pointMeshes = [];
        this._zoomDots = [];
        this._lastDotZoom = -1;

        const params = new URLSearchParams(window.location.search);
        const v = (params.get('view') || '').toLowerCase();
        if (v === 'group') {
            this.view = 'domain';
            this.groupOp = 'add';
            this._groupToy = true;
        } else if (v === 'scalar') {
            this.view = 'domain';
            this._kgOverlay = true;
            this._groupToy = true;
        } else if (window.ECC && ECC.VIEWS.indexOf(v) >= 0) {
            this.view = v;
        }

        this.init();
    }

    init() {
        this.setupThreeJS();
        if (this._shell && this._shell.vrManager) {
            this.vrManager = this._shell.vrManager;
        } else if (typeof VRManager !== 'undefined') {
            this.vrManager = new VRManager(this, { panelTitle: 'Curve', panelDomId: 'crypto-info' });
            this.vrManager.init();
        }
        this.setupOrbitControls();
        this.setupControls();
        if (typeof setRotationButtonState === 'function') setRotationButtonState(this.isRotating);
        this.setupPanelToggle();
        this.setupExplainers();
        this.rebuildView();
        if (this._kgOverlay) this._ensureDemoKey();
        this.renderer.setAnimationLoop(() => this.animate());
    }

    isVRSelectable(obj) {
        if (!obj || !obj.userData) return false;
        return !!(obj.userData.isSlice || obj.userData.isCurvePoint);
    }

    onVRSelect(obj) {
        if (obj && obj.userData && obj.userData.isSlice) {
            this.selectedSliceZ = obj.userData.z;
            this.updatePanel();
        }
    }

    getVRPageHud() {
        const prime = ECC.PRIME_LADDER[this.primeIndex];
        return {
            title: 'Curve',
            identity: this.view.charAt(0).toUpperCase() + this.view.slice(1),
            stats: [
                'Domain: ' + this._domainLabel(),
                'Field: ' + (prime ? prime.label : ''),
                this._curveTotalLabel(),
                this.view === 'family' || this.view === 'domain' ? 'Op: ' + this.hudOp : 'y² = x³ + 7'
            ]
        };
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._ac.abort();
        if (this._explainerEl && this._explainerEl.parentNode) {
            this._explainerEl.parentNode.removeChild(this._explainerEl);
            this._explainerEl = null;
        }
        this._clearContent();
        if (!this.isPerspective) this._setPerspectiveCamera(true);
    }

    _clearContent() {
        if (this._domainState && this._domainState.instances) {
            const inst = this._domainState.instances;
            if (inst.parent) inst.parent.remove(inst);
            if (inst.geometry) inst.geometry.dispose();
            if (inst.material) inst.material.dispose();
        }
        this._domainState = null;
        this._zoomDots = [];
        this._lastDotZoom = -1;
        this._familyOpRoot = null;
        this._fieldOpRoot = null;
        this._scalarHopGroup = null;
        this._pointMeshes.forEach((m) => {
            if (m.parent) m.parent.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
                if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
                else m.material.dispose();
            }
        });
        this._pointMeshes = [];
        if (this.content) {
            this.content.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                    else child.material.dispose();
                }
            });
            if (this.content.parent) this.content.parent.remove(this.content);
            this.content = null;
        }
    }

    setupThreeJS() {
        const signal = this._ac.signal;
        if (this._shell) {
            this.scene = this._shell.scene;
            this.camera = this._shell.camera;
            this.renderer = this._shell.renderer;
            this.scene.background = new THREE.Color(0x000000);
            if (this.camera.isPerspectiveCamera) {
                this.camera.fov = 50;
                this.camera.near = 0.1;
                this.camera.far = 1000;
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
            }
            this.camera.position.set(8, 6, 12);
            this.camera.lookAt(0, 0, 0);
            window.addEventListener('resize', () => this.onWindowResize(), { signal });
            return;
        }
        const container = document.getElementById('scene');
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(8, 6, 12);
        this.camera.lookAt(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);
        window.addEventListener('resize', () => this.onWindowResize(), { signal });
    }

    addLights() {
        const amb = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(amb);
        this._pointMeshes.push(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.7);
        dir.position.set(6, 12, 8);
        this.scene.add(dir);
        this._pointMeshes.push(dir);
    }

    setupOrbitControls() {
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 42,
            phi: Math.PI / 2,
            theta: Math.PI / 2,
            isMouseDown: false,
            lastMouseX: 0,
            lastMouseY: 0,
            update: () => {
                this.camera.position.x = this.controls.target.x + this.controls.distance * Math.sin(this.controls.phi) * Math.cos(this.controls.theta);
                this.camera.position.y = this.controls.target.y + this.controls.distance * Math.cos(this.controls.phi);
                this.camera.position.z = this.controls.target.z + this.controls.distance * Math.sin(this.controls.phi) * Math.sin(this.controls.theta);
                this.camera.lookAt(this.controls.target);
            }
        };
        this.controls.update();
        const el = this.renderer.domElement;
        const signal = this._ac.signal;
        el.addEventListener('mousedown', (e) => {
            this.controls.isMouseDown = true;
            this.controls.lastMouseX = e.clientX;
            this.controls.lastMouseY = e.clientY;
            this.isRotating = false;
        }, { signal });
        window.addEventListener('mouseup', () => { this.controls.isMouseDown = false; }, { signal });
        window.addEventListener('mousemove', (e) => {
            if (!this.controls.isMouseDown) return;
            if (this.renderer.xr && this.renderer.xr.isPresenting) return;
            const dx = e.clientX - this.controls.lastMouseX;
            const dy = e.clientY - this.controls.lastMouseY;
            this.controls.theta -= dx * 0.008;
            this.controls.phi -= dy * 0.008;
            this.controls.phi = Math.max(0.12, Math.min(Math.PI - 0.12, this.controls.phi));
            this.controls.lastMouseX = e.clientX;
            this.controls.lastMouseY = e.clientY;
            this.controls.update();
        }, { signal });
        el.addEventListener('wheel', (e) => {
            if (this.renderer.xr && this.renderer.xr.isPresenting) return;
            e.preventDefault();
            const f = e.deltaY > 0 ? 1.08 : 0.92;
            this._zoomBy(f);
        }, { signal, passive: false });
    }

    _bind(id, fn) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', fn, { signal: this._ac.signal });
    }

    _bindPrimeNext() {
        const el = document.getElementById('prime-next');
        if (!el) return;
        const signal = this._ac.signal;
        el.addEventListener('click', () => {
            clearTimeout(this._primeNextTimer);
            this._primeNextTimer = setTimeout(() => this.stepPrime(1), 280);
        }, { signal });
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            clearTimeout(this._primeNextTimer);
            this.addMorePoints();
        }, { signal });
    }

    addMorePoints() {
        const max = ECC.INSTANCE_CAP_MAX;
        if (this.drawCap >= max) return;
        this.drawCap = Math.min(max, this.drawCap * 2);
        this._fieldCache = null;
        this._opPtsCache = null;
        if (this.view === 'family') return;
        this.rebuildView();
    }

    setupControls() {
        this._bind('view-family', () => this.setView('family'));
        this._bind('view-domain', () => {
            if (this.view === 'domain' && this._kgOverlay) {
                this._kgOverlay = false;
                this.scalarPlaying = false;
                this._unpinGroupToy();
                if (!this.groupOp) this.groupOp = 'add';
                this.rebuildView();
                this._syncToolbar();
                this._syncVrMenu();
                this._pushViewUrl();
                return;
            }
            this.setView('domain');
        });
        this._bind('dim-prev', () => this.stepDim(-1));
        this._bind('dim-next', () => this.stepDim(1));
        this._bind('prime-prev', () => this.stepPrime(-1));
        this._bindPrimeNext();
        this._bind('op-add', () => this.setGroupOp('add'));
        this._bind('op-double', () => this.setGroupOp('double'));
        this._bind('op-inverse', () => this.setGroupOp('inverse'));
        this._bind('op-sub', () => this.setGroupOp('sub'));
        this._bind('scalar-play', () => this.toggleScalarPlay());
        this._bind('scalar-load-seed', () => this.openSeedModal());
        this._bind('toggle-color', () => this.toggleColor());
        this._bind('toggle-grid', () => this.toggleGrid());
        this._bind('toggle-rotation', () => {
            this.isRotating = !this.isRotating;
            if (typeof setRotationButtonState === 'function') setRotationButtonState(this.isRotating);
        });
        this._bind('toggle-view', () => this.toggleCameraView());
        this._bind('reset-camera', () => this.resetCamera());
        this._bind('rotate-left', () => this.rotateLeft());
        this._bind('rotate-right', () => this.rotateRight());
        this._bind('rotate-up', () => this.rotateUp());
        this._bind('rotate-down', () => this.rotateDown());
        this._bind('pan-left', () => this.panBy(-1, 0));
        this._bind('pan-right', () => this.panBy(1, 0));
        this._bind('pan-up', () => this.panBy(0, 1));
        this._bind('pan-down', () => this.panBy(0, -1));
        this._bind('zoom-in', () => this.zoomIn());
        this._bind('zoom-out', () => this.zoomOut());
        this._setupSeedModal();
        this._setupSliceSlider();
        this._setupPSlider();
        this._setupLineSlider();
        this._syncToolbar();
    }

    _setClusterHidden(id, hidden) {
        const el = document.getElementById(id);
        if (el) el.hidden = hidden;
    }

    _setPressed(id, on) {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    _setDisabled(id, disabled) {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    }

    _syncToolbar() {
        const view = this.view;
        const views = ['family', 'domain'];
        views.forEach((v) => this._setPressed('view-' + v, view === v));

        const showGlueField = view === 'domain' && !this._kgOverlay;
        const showOps = view === 'family' || (view === 'domain' && !this._kgOverlay);
        const showPlay = view === 'domain';
        this._setClusterHidden('crypto-cluster-glue', !showGlueField);
        this._setClusterHidden('crypto-cluster-field', !showGlueField);
        this._setClusterHidden('crypto-cluster-ops', !showOps);
        this._setClusterHidden('crypto-cluster-play', !showPlay);

        this._setDisabled('dim-prev', this.dimIndex <= 0);
        this._setDisabled('dim-next', this.dimIndex >= ECC.DIM_STEPS - 1);
        this._setDisabled('prime-prev', this.primeIndex <= 0);
        this._setDisabled('prime-next', this.primeIndex >= ECC.PRIME_LADDER.length - 1 && this.drawCap >= ECC.INSTANCE_CAP_MAX);

        const op = this.groupOp;
        this._setPressed('op-add', op === 'add');
        this._setPressed('op-double', op === 'double');
        this._setPressed('op-inverse', op === 'inverse');
        this._setPressed('op-sub', op === 'sub');
        this._setPressed('scalar-play', !!this.scalarPlaying);
        const play = document.getElementById('scalar-play');
        if (play) play.textContent = this.scalarPlaying ? 'Pause kG' : 'Play kG';
        this._syncColorButton();
        this._setPressed('toggle-grid', !!this.showGrid);
        const sliceRow = document.getElementById('crypto-slice-row');
        const pRow = document.getElementById('crypto-p-row');
        const lineRow = document.getElementById('crypto-line-row');
        const drawnRow = document.getElementById('crypto-drawn-row');
        if (sliceRow) sliceRow.hidden = view !== 'family';
        if (pRow) pRow.hidden = view !== 'family' && !this._domainPSliderVisible();
        if (lineRow) lineRow.hidden = !this._lineSliderVisible();
        if (drawnRow) drawnRow.hidden = view === 'family';
        this._syncSliceSlider();
        this._syncPSlider();
        this._syncLineSlider();
    }

    _setupSliceSlider() {
        const slider = document.getElementById('crypto-slice-slider');
        if (!slider) return;
        this._syncSliceSlider();
        let timer = null;
        const apply = () => {
            if (this._sliderSync) return;
            const n = parseInt(slider.value, 10);
            if (!Number.isFinite(n)) return;
            this.familySliceCount = n;
            this._syncSliceSlider();
            if (this.view === 'family' && n !== this._builtSliceCount) this.rebuildView();
        };
        slider.addEventListener('input', () => {
            if (this._sliderSync) return;
            const n = parseInt(slider.value, 10);
            if (Number.isFinite(n)) this.familySliceCount = n;
            this._syncSliceSlider();
            clearTimeout(timer);
            timer = setTimeout(apply, 40);
        }, { signal: this._ac.signal });
        slider.addEventListener('change', apply, { signal: this._ac.signal });
    }

    _familyPRange() {
        const xNode = Math.cbrt(-7);
        return { lo: xNode + 0.14, hi: 8 };
    }

    _familyPXFromSlider(t) {
        const r = this._familyPRange();
        const u = Math.max(0, Math.min(1, t / 1000));
        return r.lo + u * (r.hi - r.lo);
    }

    _familySliderFromPX(x) {
        const r = this._familyPRange();
        const span = r.hi - r.lo;
        const u = span <= 0 ? 0 : (x - r.lo) / span;
        return Math.round(Math.max(0, Math.min(1, u)) * 1000);
    }

    _fmtPCoord(n) {
        if (!Number.isFinite(n)) return '—';
        const s = n.toFixed(2);
        return n < 0 ? '−' + s.slice(1) : s;
    }

    _setupPSlider() {
        const slider = document.getElementById('crypto-p-slider');
        if (!slider) return;
        this._syncPSlider();
        const setFromSlider = () => {
            if (this._sliderSync) return;
            const t = parseInt(slider.value, 10);
            if (!Number.isFinite(t)) return;
            if (this.view === 'domain' && !this._kgOverlay) {
                this.fieldPIndex = t;
                this._syncPSlider();
                this._redrawFieldGroupOp();
                return;
            }
            this.familyPX = this._familyPXFromSlider(t);
            this._syncPSlider();
            if (this.view === 'family') this._redrawFamilyOp();
        };
        slider.addEventListener('pointerdown', () => {
            this._familyPDragging = true;
            this.familyPPlaying = false;
            this.fieldPPlaying = false;
            this._syncPSlider();
        }, { signal: this._ac.signal });
        slider.addEventListener('pointerup', () => {
            this._familyPDragging = false;
        }, { signal: this._ac.signal });
        slider.addEventListener('pointercancel', () => {
            this._familyPDragging = false;
        }, { signal: this._ac.signal });
        slider.addEventListener('input', setFromSlider, { signal: this._ac.signal });
        slider.addEventListener('change', setFromSlider, { signal: this._ac.signal });
        slider.addEventListener('dblclick', () => {
            if (this.view === 'domain' && !this._kgOverlay) this.fieldPPlaying = true;
            else if (this.view === 'family') this.familyPPlaying = true;
            this._syncPSlider();
        }, { signal: this._ac.signal });
        const rangeEl = document.getElementById('crypto-p-range');
        if (rangeEl) {
            rangeEl.style.cursor = 'pointer';
            rangeEl.addEventListener('click', () => {
                if (this.view === 'domain' && !this._kgOverlay) this.fieldPPlaying = !this.fieldPPlaying;
                else if (this.view === 'family') this.familyPPlaying = !this.familyPPlaying;
                this._syncPSlider();
            }, { signal: this._ac.signal });
        }
    }

    _domainPSliderVisible() {
        return this.view === 'domain' && !this._kgOverlay && !!this.groupOp && this._fieldOpP() != null;
    }

    _lineSliderVisible() {
        if (this._kgOverlay) return false;
        if (!this.groupOp) return false;
        return this.view === 'family' || this.view === 'domain';
    }

    _lineLenFactor() {
        const t = Math.max(1, Math.min(1000, this.lineLen | 0));
        return t / 50;
    }

    _setupLineSlider() {
        const slider = document.getElementById('crypto-line-slider');
        if (!slider) return;
        this._syncLineSlider();
        const apply = () => {
            if (this._sliderSync) return;
            const n = parseInt(slider.value, 10);
            if (!Number.isFinite(n)) return;
            this.lineLen = n;
            this._syncLineSlider();
            if (this.view === 'family') this._redrawFamilyOp({ quiet: true });
            else if (this.view === 'domain' && !this._kgOverlay) this._redrawFieldGroupOp({ quiet: true });
        };
        slider.addEventListener('input', apply, { signal: this._ac.signal });
        slider.addEventListener('change', apply, { signal: this._ac.signal });
    }

    _syncLineSlider() {
        const slider = document.getElementById('crypto-line-slider');
        const valueEl = document.getElementById('crypto-line-value');
        const f = this._lineLenFactor();
        if (valueEl) valueEl.textContent = f.toFixed(2) + '×';
        if (!slider) return;
        this._sliderSync++;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const minV = Number.isFinite(min) ? min : 1;
        const maxV = Number.isFinite(max) ? max : 1000;
        const n = Math.max(minV, Math.min(maxV, this.lineLen | 0));
        const pct = maxV === minV ? 100 : ((n - minV) / (maxV - minV)) * 100;
        slider.value = String(n);
        slider.style.setProperty('--slider-pct', pct + '%');
        requestAnimationFrame(() => { this._sliderSync = Math.max(0, this._sliderSync - 1); });
    }

    _fmtFieldCoord(n) {
        if (n == null) return '—';
        if (typeof n === 'bigint') {
            const h = n.toString(16);
            return h.length <= 8 ? '0x' + h : '0x' + h.slice(0, 4) + '…' + h.slice(-4);
        }
        if (typeof n === 'number' && n > 999) {
            const h = n.toString(16);
            return h.length <= 8 ? '0x' + h : '0x' + h.slice(0, 4) + '…' + h.slice(-4);
        }
        return String(n);
    }

    _fmtFieldCoordFull(n) {
        if (n == null) return '—';
        if (typeof n === 'bigint') return '0x' + n.toString(16);
        if (typeof n === 'number' && n > 999) return '0x' + n.toString(16);
        return String(n);
    }

    _fieldCoordIsWide(n) {
        if (n == null) return false;
        if (typeof n === 'bigint') return n.toString(16).length > 8;
        if (typeof n === 'number') return n > 999 && n.toString(16).length > 8;
        return false;
    }

    _fmtFieldPointLabel(P) {
        if (!P) return { text: '—', title: '' };
        const p = this._fieldOpP();
        if (p != null && (this._fieldCoordIsWide(P.x) || this._fieldCoordIsWide(P.y))) {
            const u = ECC.toUnit(P.x, p);
            const v = ECC.toUnit(P.y, p);
            return {
                text: '(' + u.toFixed(2) + ', ' + v.toFixed(2) + ')',
                title: 'x = ' + this._fmtFieldCoordFull(P.x) + '\ny = ' + this._fmtFieldCoordFull(P.y)
            };
        }
        return {
            text: '(' + this._fmtFieldCoord(P.x) + ', ' + this._fmtFieldCoord(P.y) + ')',
            title: ''
        };
    }

    _fieldOpPoints() {
        const p = this._fieldOpP();
        if (p == null) return [];
        const key = String(p);
        if (this._opPtsCache && this._opPtsCache.key === key) return this._opPtsCache.pts;
        const lim = ECC.ENUM_MAX_P || 70000;
        let raw;
        if (typeof p === 'number' && p <= lim) {
            raw = (p === 17 && ECC.F17 && ECC.F17.points) ? ECC.F17.points.slice() : ECC.toyCurvePoints(p);
            if (raw.length > 160) {
                const cap = 128;
                const step = raw.length / cap;
                const slim = [];
                for (let i = 0; i < cap; i++) slim.push(raw[Math.floor(i * step)]);
                raw = slim;
            }
        } else {
            raw = ECC.sampleCurvePoints(p, 96);
        }
        if (typeof p === 'number') raw.sort((a, b) => a.x - b.x || a.y - b.y);
        this._opPtsCache = { key: key, pts: raw };
        return raw;
    }

    _ensureFieldPIndex(pts) {
        const p = this._fieldOpP();
        if (this._fieldPBoundFor === p && this.fieldPIndex >= 0 && this.fieldPIndex < pts.length) return;
        this._fieldPBoundFor = p;
        let i = 0;
        if (p === 17) {
            for (let k = 0; k < pts.length; k++) {
                if (pts[k].x === 2) { i = k; break; }
            }
        }
        this.fieldPIndex = i;
    }

    _fieldP() {
        const pts = this._fieldOpPoints();
        if (!pts.length) return null;
        this._ensureFieldPIndex(pts);
        if (this.fieldPIndex < 0 || this.fieldPIndex >= pts.length) this.fieldPIndex = 0;
        return pts[this.fieldPIndex];
    }

    _fieldQ(P) {
        const pts = this._fieldOpPoints();
        if (!pts.length || !P) return null;
        const n = pts.length;
        const start = (this.fieldPIndex + Math.max(2, Math.floor(n / 3))) % n;
        for (let i = 0; i < n; i++) {
            const Q = pts[(start + i) % n];
            if (Q.x !== P.x) return Q;
        }
        return pts[(this.fieldPIndex + 1) % n] || pts[0];
    }

    _syncPSlider() {
        const slider = document.getElementById('crypto-p-slider');
        const valueEl = document.getElementById('crypto-p-value');
        const rangeEl = document.getElementById('crypto-p-range');
        if (this.view === 'domain' && !this._kgOverlay) {
            const pts = this._fieldOpPoints();
            this._ensureFieldPIndex(pts);
            const P = pts[this.fieldPIndex];
            if (valueEl) {
                const lab = this._fmtFieldPointLabel(P);
                valueEl.textContent = lab.text;
                if (lab.title) valueEl.setAttribute('title', lab.title);
                else valueEl.removeAttribute('title');
            }
            if (rangeEl) rangeEl.textContent = this.fieldPPlaying && !this._familyPDragging ? 'hold' : 'walk';
            if (!slider) return;
            this._sliderSync++;
            const max = Math.max(0, pts.length - 1);
            slider.min = '0';
            slider.max = String(max);
            slider.value = String(this.fieldPIndex);
            slider.style.setProperty('--slider-pct', max === 0 ? '100%' : ((this.fieldPIndex / max) * 100) + '%');
            requestAnimationFrame(() => { this._sliderSync = Math.max(0, this._sliderSync - 1); });
            return;
        }
        this._sliderSync++;
        if (slider) {
            slider.min = '0';
            slider.max = '1000';
        }
        const y = (window.ECC && ECC.yUpperReal) ? ECC.yUpperReal(this.familyPX) : null;
        if (valueEl) {
            valueEl.textContent = y == null
                ? '(' + this._fmtPCoord(this.familyPX) + ')'
                : '(' + this._fmtPCoord(this.familyPX) + ', ' + this._fmtPCoord(y) + ')';
            valueEl.removeAttribute('title');
        }
        if (rangeEl) rangeEl.textContent = this.familyPPlaying && !this._familyPDragging ? 'hold' : 'walk';
        if (!slider) {
            requestAnimationFrame(() => { this._sliderSync = Math.max(0, this._sliderSync - 1); });
            return;
        }
        const t = this._familySliderFromPX(this.familyPX);
        slider.value = String(t);
        slider.style.setProperty('--slider-pct', (t / 10) + '%');
        requestAnimationFrame(() => { this._sliderSync = Math.max(0, this._sliderSync - 1); });
    }

    _syncSliceSlider() {
        const slider = document.getElementById('crypto-slice-slider');
        const valueEl = document.getElementById('crypto-slice-value');
        const rangeEl = document.getElementById('crypto-slice-range');
        const r = this._familyZRange();
        if (valueEl) valueEl.textContent = String(r.n);
        if (rangeEl) rangeEl.textContent = this._formatZRange(r);
        if (!slider) return;
        this._sliderSync++;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const minV = Number.isFinite(min) ? min : 1;
        const maxV = Number.isFinite(max) ? max : 89;
        const pct = maxV === minV ? 100 : ((r.n - minV) / (maxV - minV)) * 100;
        slider.value = String(r.n);
        slider.style.setProperty('--slider-pct', pct + '%');
        requestAnimationFrame(() => { this._sliderSync = Math.max(0, this._sliderSync - 1); });
    }

    _familyZRange() {
        const STEP = 0.5;
        const n = Math.max(1, this.familySliceCount | 0);
        if (n <= 0) return { n: 0, lo: 0, hi: 0, step: STEP, zs: [] };
        if (n === 1) return { n: 1, lo: 0, hi: 0, step: STEP, zs: [0] };
        const extra = n - 1;
        const negSteps = Math.round(extra * 12 / 22);
        const posSteps = extra - negSteps;
        const lo = -negSteps * STEP;
        const hi = posSteps * STEP;
        const zs = [];
        for (let i = 0; i < n; i++) {
            const z = lo + i * STEP;
            zs.push(Math.abs(z) < 1e-9 ? 0 : z);
        }
        return { n, lo, hi, step: STEP, zs };
    }

    _formatZRange(r) {
        const fmt = (z) => (z < 0 ? '−' : '') + String(Math.abs(z));
        if (!r || r.n <= 0) return 'z ∈ ∅';
        if (r.n === 1) return 'z = 0';
        return 'z ∈ [' + fmt(r.lo) + ', ' + fmt(r.hi) + ']';
    }

    _syncVrMenu() {
        const menu = this.vrManager && this.vrManager.navMenu;
        if (!menu || typeof menu.rebuild !== 'function') return;
        const wasOpen = !!(menu.group && menu.group.visible);
        menu.rebuild();
        if (wasOpen && typeof menu.show === 'function') menu.show();
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._setPressed('toggle-grid', this.showGrid);
        this.rebuildView();
    }

    toggleColor() {
        this.useColor = !this.useColor;
        this._syncColorButton();
        this.rebuildView();
    }

    _syncColorButton() {
        const btn = document.getElementById('toggle-color');
        if (!btn) return;
        btn.textContent = this.useColor ? 'Grey' : 'Color';
        btn.setAttribute('aria-pressed', this.useColor ? 'true' : 'false');
    }

    _tone(name) {
        const color = {
            secp: 0xdc2626,
            edgeA: 0x06b6d4,
            edgeB: 0xdc2626,
            mid: 0xf97316,
            grid: 0x64748b,
            chord: 0x06b6d4,
            reflect: 0xf97316,
            tangent: 0x7c3aed,
            pt: 0xeeeeee,
            ptQ: 0x93c5fd,
            ptRp: 0xfbbf24,
            ptR: 0xf97316,
            hop: 0x334155,
            hopActive: 0xf97316,
            plane: 0xdc2626,
            white: 0xffffff,
            muted: 0x64748b
        };
        const grey = {
            secp: 0xffffff,
            edgeA: 0xcccccc,
            edgeB: 0xffffff,
            mid: 0x888888,
            grid: 0x555555,
            chord: 0xdddddd,
            reflect: 0xaaaaaa,
            tangent: 0x999999,
            pt: 0xffffff,
            ptQ: 0xbbbbbb,
            ptRp: 0x999999,
            ptR: 0xffffff,
            hop: 0x444444,
            hopActive: 0xffffff,
            plane: 0xffffff,
            white: 0xffffff,
            muted: 0x666666
        };
        const table = this.useColor ? color : grey;
        return table[name] != null ? table[name] : 0xffffff;
    }

    setupExplainers() {
        const signal = this._ac.signal;
        const tip = document.createElement('div');
        tip.className = 'explainer-tooltip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
        this._explainerEl = tip;

        const hide = () => { tip.style.display = 'none'; };
        const show = (el) => {
            const text = el.getAttribute('data-tip');
            if (!text) return;
            tip.textContent = text;
            tip.style.display = 'block';
            const gap = 10;
            const pad = 12;
            const rect = el.getBoundingClientRect();
            const w = tip.offsetWidth;
            const h = tip.offsetHeight;
            let x = rect.left;
            if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
            if (x < pad) x = pad;
            let y = rect.top - h - gap;
            if (y < pad) y = pad;
            tip.style.left = Math.round(x) + 'px';
            tip.style.top = Math.round(y) + 'px';
        };

        const root = document.getElementById('ui');
        if (!root) return;
        root.querySelectorAll('[data-tip]').forEach((el) => {
            el.addEventListener('mouseenter', () => show(el), { signal });
            el.addEventListener('mouseleave', hide, { signal });
            el.addEventListener('blur', hide, { signal });
            el.addEventListener('click', hide, { signal });
        });
    }

    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('crypto-info');
        if (!toggleBtn || !panelContent) return;
        toggleBtn.addEventListener('click', () => {
            const isMinimized = panelContent.classList.contains('minimized');
            const icon = toggleBtn.querySelector('.panel-toggle-icon');
            if (isMinimized) {
                panelContent.classList.remove('minimized');
                if (icon) icon.src = 'imgs/icons/chevron-up.svg';
                toggleBtn.title = 'Minimize';
            } else {
                panelContent.classList.add('minimized');
                if (icon) icon.src = 'imgs/icons/chevron-down.svg';
                toggleBtn.title = 'Maximize';
            }
        }, { signal: this._ac.signal });
    }

    _carryFamilyToField() {
        const pts = this._fieldOpPoints();
        if (!pts.length) return;
        const p = this._fieldOpP();
        const x = this.familyPX;
        let want = null;
        if (typeof p === 'number' && Number.isFinite(x)) want = ECC.mod(Math.round(x), p);
        let best = 0;
        let bestScore = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const q = pts[i];
            let dx;
            if (want != null && typeof q.x === 'number') {
                const d = Math.abs(q.x - want);
                dx = Math.min(d, p - d);
            } else {
                const uWant = want != null && typeof p === 'number' ? want / p : 0.5;
                dx = Math.abs(ECC.toUnit(q.x, p) - uWant);
                dx = Math.min(dx, 1 - dx);
            }
            const upper = (typeof p === 'number' && typeof q.y === 'number')
                ? q.y <= p / 2
                : ECC.toUnit(q.y, p) <= 0.5;
            const score = dx * 10 + (upper ? 0 : 1);
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        this.fieldPIndex = best;
        this._fieldPBoundFor = p;
    }

    _carryFieldToFamily() {
        const pts = this._fieldOpPoints();
        if (!pts.length) return;
        this._ensureFieldPIndex(pts);
        const P = pts[this.fieldPIndex];
        if (!P || P.inf) return;
        const r = this._familyPRange();
        let x;
        if (typeof P.x === 'number' && Number.isFinite(P.x) && P.x <= r.hi + 4) x = P.x;
        else x = r.lo + ECC.toUnit(P.x, this._fieldOpP()) * (r.hi - r.lo);
        this.familyPX = Math.max(r.lo, Math.min(r.hi, x));
    }

    setView(view) {
        const pinGroup = view === 'group';
        if (view === 'scalar') {
            view = 'domain';
            this._kgOverlay = true;
            this._pinGroupToy();
        }
        if (pinGroup) view = 'domain';
        if (ECC.VIEWS.indexOf(view) < 0) return;
        const prev = this.view;
        if (prev === 'family' && view === 'domain') this._carryFamilyToField();
        if (prev === 'domain' && view === 'family') this._carryFieldToFamily();
        this.view = view;
        if (pinGroup) {
            this.groupOp = this.groupOp || 'add';
            this._pinGroupToy();
        } else if (view !== 'domain') {
            this._unpinGroupToy();
            this.fieldPPlaying = false;
            this._kgOverlay = false;
            this.scalarPlaying = false;
        }
        this._pushViewUrl();
        this.rebuildView();
        this._syncVrMenu();
        if (this._kgOverlay) this._ensureDemoKey();
    }

    stepDim(dir) {
        if (this.view === 'family') return;
        const next = Math.max(0, Math.min(ECC.DIM_STEPS - 1, this.dimIndex + dir));
        if (dir > 0 && this._pendingUnglue != null) {
            this._pendingUnglue = null;
            this._startTorusSubdiv(1);
            return;
        }
        if (dir < 0 && this.morphT >= 0.999 && !this.morphing && this._torusSubdiv > 0.02) {
            this._pendingUnglue = next;
            this._startTorusSubdiv(0);
            return;
        }
        if (next === this.dimIndex) return;
        this.morphFrom = this.morphT;
        this.morphTo = ECC.dimIndexToT(next);
        this.dimIndex = next;
        this.morphing = true;
        this.morphElapsed = 0;
        this.updatePanel();
        this._syncVrMenu();
    }

    _startTorusSubdiv(to) {
        this._subdivFrom = this._torusSubdiv;
        this._subdivTo = to;
        this._torusSubdiving = true;
        this._subdivElapsed = 0;
        this._applyTorusSubdiv();
    }

    _applyTorusSubdiv() {
        const st = this._domainState;
        if (!st || !st.geom) return;
        this._updateSurfacePositions(st.geom, st.nu, st.nv, this.morphT);
        if (st.fillGeom) this._updateSurfacePositions(st.fillGeom, st.fillNu, st.fillNv, this.morphT);
        this._syncGridOpacity();
    }

    _ensureTorusSubdiv() {
        if (this.morphT >= 0.999 && !this._torusSubdiving && this._pendingUnglue == null) {
            this._torusSubdiv = 1;
        }
    }

    stepPrime(dir) {
        if (this.view !== 'domain' || this._kgOverlay) return;
        const wasToy = this._groupToy;
        if (wasToy) this._unpinGroupToy();
        const next = Math.max(0, Math.min(ECC.PRIME_LADDER.length - 1, this.primeIndex + dir));
        if (next === this.primeIndex && !wasToy) return;
        this.primeIndex = next;
        this._fieldCache = null;
        this._opPtsCache = null;
        this.rebuildView();
        this._syncVrMenu();
    }

    _canLabelGroupOp() {
        const field = this._ensureField();
        return !!(field && field.exact && field.p && field.p <= 17);
    }

    _pinGroupToy() {
        this._groupToy = true;
    }

    _unpinGroupToy() {
        this._groupToy = false;
    }

    _ensureToyField() {
        if (this._toyCache) return this._toyCache;
        const raw = ECC.F17.points;
        const pts = raw.map((q) => ({ x: q.x, y: q.y, u: q.x / 17, v: q.y / 17 }));
        this._toyCache = {
            points: pts,
            count: pts.length,
            total: raw.length,
            exact: true,
            p: 17,
            bits: 5,
            toy: true
        };
        return this._toyCache;
    }

    _domainDrawField() {
        return this._groupToy ? this._ensureToyField() : this._ensureField();
    }

    setGroupOp(op) {
        if (this._kgOverlay) {
            this._kgOverlay = false;
            this.scalarPlaying = false;
            this._unpinGroupToy();
        }
        this.groupOp = this.groupOp === op ? null : op;
        this.rebuildView();
        if (this.vrManager && this.vrManager.navMenu && this.vrManager.navMenu._refreshAllToggles) {
            this.vrManager.navMenu._refreshAllToggles();
        }
    }

    toggleScalarPlay() {
        if (this.view !== 'domain') this.setView('domain');
        const needBuild = !this._kgOverlay || !this._scalarHops;
        this._kgOverlay = true;
        this._pinGroupToy();
        this.groupOp = null;
        const starting = !this.scalarPlaying;
        if (starting && this._realKey && this.scalarK === this._realKey.toyR) {
            this.scalarK = 1;
        }
        this.scalarPlaying = starting;
        if (needBuild) this.rebuildView();
        else if (starting) this._updateScalarHighlight();
        this._pushViewUrl();
        this._syncToolbar();
        if (this.vrManager && this.vrManager.navMenu && this.vrManager.navMenu._refreshAllToggles) {
            this.vrManager.navMenu._refreshAllToggles();
        }
    }

    _hexToBytes(hex) {
        const h = hex.replace(/^0x/i, '');
        if (h.length % 2) return null;
        const out = new Uint8Array(h.length / 2);
        for (let i = 0; i < out.length; i++) {
            const n = parseInt(h.slice(i * 2, i * 2 + 2), 16);
            if (Number.isNaN(n)) return null;
            out[i] = n;
        }
        return out;
    }

    _bytesToHex(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
        return s;
    }

    _shortHex(hex, head, tail) {
        if (!hex || hex.length <= head + tail) return hex;
        return hex.slice(0, head) + '…' + hex.slice(-tail);
    }

    async _hmacSha512(keyBytes, msgBytes) {
        const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-512' },
            false,
            ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
        return new Uint8Array(sig);
    }

    _concatBytes() {
        let n = 0;
        let i;
        for (i = 0; i < arguments.length; i++) n += arguments[i].length;
        const out = new Uint8Array(n);
        let o = 0;
        for (i = 0; i < arguments.length; i++) {
            out.set(arguments[i], o);
            o += arguments[i].length;
        }
        return out;
    }

    _ser32(n) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, n >>> 0);
        return b;
    }

    _bigintTo32(n) {
        let hex = n.toString(16);
        if (hex.length > 64) throw new Error('Integer does not fit in 32 bytes.');
        return this._hexToBytes(hex.padStart(64, '0'));
    }

    _parseBip32Path(path) {
        const raw = String(path || '').trim();
        if (!raw || raw === 'm') return [];
        const body = raw.replace(/^m\/?/i, '');
        if (!body) return [];
        return body.split('/').map((part) => {
            const hard = /['hH]$/.test(part);
            const num = parseInt(hard ? part.slice(0, -1) : part, 10);
            if (!Number.isFinite(num) || num < 0) throw new Error('Bad BIP32 path: ' + path);
            return hard ? (num + BIP32_HARDENED) >>> 0 : num >>> 0;
        });
    }

    _mnemonicPhrase(text) {
        const words = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        const n = words.length;
        if (n === 12 || n === 15 || n === 18 || n === 21 || n === 24) return words.join(' ');
        return null;
    }

    async _mnemonicToSeed(mnemonic, passphrase) {
        const enc = new TextEncoder();
        const pw = enc.encode(mnemonic.normalize('NFKD'));
        const salt = enc.encode(('mnemonic' + (passphrase || '')).normalize('NFKD'));
        const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            hash: 'SHA-512',
            salt: salt,
            iterations: 2048
        }, key, 512);
        return new Uint8Array(bits);
    }

    async _bip32Master(seed) {
        const I = await this._hmacSha512(new TextEncoder().encode('Bitcoin seed'), seed);
        return { key: I.slice(0, 32), chain: I.slice(32) };
    }

    async _ckdPriv(parent, index) {
        const secp = window.nobleSecp;
        const hardened = index >= BIP32_HARDENED;
        const data = hardened
            ? this._concatBytes(new Uint8Array([0]), parent.key, this._ser32(index))
            : this._concatBytes(secp.getPublicKey(parent.key, true), this._ser32(index));
        const I = await this._hmacSha512(parent.chain, data);
        const il = I.slice(0, 32);
        const ir = I.slice(32);
        const ilN = BigInt('0x' + this._bytesToHex(il));
        if (ilN >= SECP256K1_N || ilN === 0n) throw new Error('BIP32 child IL is not a valid key.');
        const ki = (ilN + BigInt('0x' + this._bytesToHex(parent.key))) % SECP256K1_N;
        if (ki === 0n) throw new Error('BIP32 child key is zero.');
        return { key: this._bigintTo32(ki), chain: ir };
    }

    async _derivePath(master, path) {
        const idx = this._parseBip32Path(path);
        let node = master;
        for (let i = 0; i < idx.length; i++) node = await this._ckdPriv(node, idx[i]);
        return node;
    }

    async _seedToPriv(text) {
        const t = (text || '').trim();
        if (!t) throw new Error('Paste seed words, a key, or a hex seed.');
        const mnemonic = this._mnemonicPhrase(t);
        if (mnemonic) {
            const seed = await this._mnemonicToSeed(mnemonic, '');
            const master = await this._bip32Master(seed);
            const child = await this._derivePath(master, CRYPTO_DEMO_PATH);
            return {
                priv: child.key,
                source: 'BIP39 index 0',
                mnemonic: mnemonic,
                path: CRYPTO_DEMO_PATH
            };
        }
        const compact = t.replace(/\s+/g, '');
        if (/^(0x)?[0-9a-f]{64}$/i.test(compact)) {
            return { priv: this._hexToBytes(compact.replace(/^0x/i, '')), source: 'hex k' };
        }
        if (/^(0x)?[0-9a-f]{128}$/i.test(compact)) {
            const seed = this._hexToBytes(compact.replace(/^0x/i, ''));
            const master = await this._bip32Master(seed);
            return { priv: master.key, source: 'BIP32 master', path: 'm' };
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
        return { priv: new Uint8Array(digest), source: 'SHA-256(text)' };
    }

    async _ensureDemoKey() {
        if (this._realKey || this._demoKeyLoading) return;
        this._demoKeyLoading = true;
        try {
            await this.loadSeed(CRYPTO_DEMO_MNEMONIC, { silent: true });
        } catch (e) {
            console.warn('[Curve] demo seed failed', e);
        } finally {
            this._demoKeyLoading = false;
        }
    }

    openSeedModal() {
        if (this.view !== 'domain') this.setView('domain');
        this._kgOverlay = true;
        this._pinGroupToy();
        this.groupOp = null;
        if (!this._scalarHops) this.rebuildView();
        const modal = document.getElementById('seed-modal');
        const input = document.getElementById('seed-input');
        const err = document.getElementById('seed-modal-error');
        if (!modal) return;
        modal.hidden = false;
        modal.style.display = 'block';
        if (err) { err.hidden = true; err.textContent = ''; }
        if (input) {
            input.value = (this._realKey && this._realKey.mnemonic) || CRYPTO_DEMO_MNEMONIC;
            input.focus();
            input.select();
        }
    }

    closeSeedModal() {
        const modal = document.getElementById('seed-modal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.hidden = true;
    }

    _setupSeedModal() {
        const modal = document.getElementById('seed-modal');
        const form = document.getElementById('seed-form');
        const input = document.getElementById('seed-input');
        const err = document.getElementById('seed-modal-error');
        const close = document.getElementById('seed-modal-close');
        const example = document.getElementById('seed-modal-example');
        if (!modal) return;
        const signal = this._ac.signal;
        const hide = () => this.closeSeedModal();
        if (close) close.addEventListener('click', hide, { signal });
        modal.addEventListener('click', (e) => { if (e.target === modal) hide(); }, { signal });
        if (example) {
            example.addEventListener('click', () => {
                if (input) input.value = CRYPTO_DEMO_MNEMONIC;
            }, { signal });
        }
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.loadSeed(input ? input.value : '').catch((ex) => {
                    if (err) {
                        err.hidden = false;
                        err.textContent = ex.message || String(ex);
                    }
                });
            }, { signal });
        }
    }

    async loadSeed(text, opts) {
        opts = opts || {};
        const secp = window.nobleSecp;
        if (!secp || typeof secp.getPublicKey !== 'function') {
            throw new Error('secp256k1 library not loaded yet.');
        }
        const parsed = await this._seedToPriv(text);
        if (!parsed.priv || parsed.priv.length !== 32) throw new Error('Need a 32-byte key.');
        let pub;
        try {
            pub = secp.getPublicKey(parsed.priv, true);
        } catch (e) {
            throw new Error('Not a valid secp256k1 private key (k must be in 1…n−1).');
        }
        const kHex = this._bytesToHex(parsed.priv);
        const k = BigInt('0x' + kHex);
        const order = ECC.F17 && ECC.F17.order ? ECC.F17.order : 18;
        const r = Number(k % BigInt(order));
        this._realKey = {
            kHex: kHex,
            pubHex: this._bytesToHex(pub),
            source: parsed.source,
            mnemonic: parsed.mnemonic || null,
            path: parsed.path || null,
            toyR: r === 0 ? order : r
        };
        this.scalarPlaying = false;
        this.scalarK = this._realKey.toyR;
        this._kgOverlay = true;
        this._pinGroupToy();
        if (!opts.silent) this.closeSeedModal();
        if (this.view !== 'domain') this.setView('domain');
        else this.rebuildView();
    }

    _pushViewUrl() {
        const q = this._kgOverlay ? 'scalar' : this.view;
        const url = 'curve.html?view=' + q;
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', url);
        }
    }

    rebuildView() {
        this._clearContent();
        this.addLights();
        this.content = new THREE.Group();
        this.scene.add(this.content);
        if (this.view === 'family') this.buildFamily();
        else this.buildDomain();
        this.updatePanel();
    }

    _gridCoarseOpacity() {
        const t = Math.min(1, Math.max(0, this.morphT));
        return 0.45 * (1 - 0.5 * t);
    }

    _gridExtraOpacity() {
        return 0.14 * this._torusSubdiv;
    }

    _syncGridOpacity() {
        const st = this._domainState;
        if (!st) return;
        if (st.gridCoarseMat) st.gridCoarseMat.opacity = this._gridCoarseOpacity();
        if (st.gridExtraMat) st.gridExtraMat.opacity = this._gridExtraOpacity();
    }

    _matLine(color, opacity, opts) {
        opts = opts || {};
        return new THREE.LineBasicMaterial({
            color: opts.vertexColors ? 0xffffff : color,
            vertexColors: !!opts.vertexColors,
            transparent: opacity < 1 || !!opts.vertexColors,
            opacity: opacity,
            depthWrite: opacity >= 0.95 && !opts.vertexColors
        });
    }

    buildFamily() {
        const r = this._familyZRange();
        this._builtSliceCount = r.n;
        const Z_LO = r.lo, Z_HI = r.hi, zs = r.zs;
        const SC = 0.42;
        this._familySC = SC;
        const Y_MAX = 160;
        const STEPS = 960;
        for (let i = 0; i < zs.length; i++) {
            const zR = zs[i];
            const b = 7 + zR;
            const xRoot = Math.cbrt(-b);
            const xMax = Math.cbrt(Y_MAX * Y_MAX - b);
            if (!(xMax > xRoot)) continue;
            const upper = [];
            const lower = [];
            let k, x, y2, y;
            for (k = 0; k <= STEPS; k++) {
                x = xRoot + (k / STEPS) * (xMax - xRoot);
                y2 = x * x * x + b;
                y = y2 <= 0 ? 0 : Math.sqrt(y2);
                upper.push(new THREE.Vector3(x * SC, y * SC, zR * SC));
                lower.push(new THREE.Vector3(x * SC, -y * SC, zR * SC));
            }
            if (upper.length < 2) continue;
            const span = Math.max(Math.abs(Z_LO), Math.abs(Z_HI), 1e-9);
            const dist = Math.min(1, Math.abs(zR) / span);
            const fade = zR === 0 ? 1 : Math.pow(1 - dist, 2.4);
            let col, op;
            if (zR === 0) {
                col = new THREE.Color(this._tone('secp'));
                op = 1;
            } else if (zR < 0) {
                const u = 0.2 + 0.8 * (1 - dist);
                if (this.useColor) {
                    col = new THREE.Color(6 / 255, (80 + 102 * u) / 255, (140 + 72 * u) / 255);
                } else {
                    const g = 0.16 + 0.7 * fade;
                    col = new THREE.Color(g, g, g);
                }
                op = 0.04 + 0.55 * fade;
            } else {
                if (this.useColor) {
                    const t = dist;
                    col = new THREE.Color((180 + 69 * t) / 255, (90 + 25 * t) / 255, (20 + 5 * t) / 255);
                } else {
                    const g = 0.16 + 0.7 * fade;
                    col = new THREE.Color(g, g, g);
                }
                op = 0.04 + 0.55 * fade;
            }
            const mk = (arr) => {
                const n = arr.length;
                const colors = new Float32Array(n * 3);
                for (let k = 0; k < n; k++) {
                    const t = n <= 1 ? 1 : k / (n - 1);
                    let along = 1;
                    if (t > 0.42) {
                        const u = (t - 0.42) / 0.58;
                        along = Math.pow(1 - u, 2.1);
                    }
                    colors[k * 3] = col.r * along;
                    colors[k * 3 + 1] = col.g * along;
                    colors[k * 3 + 2] = col.b * along;
                }
                const g = new THREE.BufferGeometry().setFromPoints(arr);
                g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                const line = new THREE.Line(g, this._matLine(col, op, { vertexColors: true }));
                line.userData = { isSlice: true, z: zR, b: b };
                this.content.add(line);
            };
            mk(upper);
            mk(lower);
        }
        this._addFamilyGrid();
        this._redrawFamilyOp();
    }

    _clearFamilyOp() {
        if (!this._familyOpRoot) return;
        const gone = new Set();
        this._familyOpRoot.traverse((child) => gone.add(child));
        this._zoomDots = this._zoomDots.filter((m) => !gone.has(m));
        this._familyOpRoot.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                else child.material.dispose();
            }
        });
        if (this._familyOpRoot.parent) this._familyOpRoot.parent.remove(this._familyOpRoot);
        this._familyOpRoot = null;
    }

    _redrawFamilyOp(opts) {
        opts = opts || {};
        this._clearFamilyOp();
        if (!this.content) return;
        this._familyOpRoot = new THREE.Group();
        this.content.add(this._familyOpRoot);
        this._drawFamilyGroupOp();
        if (opts.quiet) {
            this._syncPSlider();
            const opEl = document.getElementById('crypto-op-label');
            if (opEl) opEl.textContent = this.hudOp;
        } else {
            this.updatePanel();
        }
    }

    _opAdd(obj) {
        (this._familyOpRoot || this.content).add(obj);
    }

    _addFamilyGrid() {
        if (!this.showGrid) return;
        const SC = this._familySC || 0.42;
        const col = new THREE.Color(this._tone('grid'));
        const xMin = -56, xMax = 56;
        const yMin = -80, yMax = 80;
        const step = 1;
        const rMax = 78;
        const addFadeLine = (x0, y0, x1, y1, axisBoost) => {
            const steps = 96;
            const pts = [];
            const colors = new Float32Array((steps + 1) * 3);
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = x0 + (x1 - x0) * t;
                const y = y0 + (y1 - y0) * t;
                pts.push(new THREE.Vector3(x * SC, y * SC, 0));
                const r = Math.hypot(x, y);
                const dist = Math.min(1, r / rMax);
                const fade = Math.pow(1 - dist, 2.2) * axisBoost;
                colors[i * 3] = col.r * fade;
                colors[i * 3 + 1] = col.g * fade;
                colors[i * 3 + 2] = col.b * fade;
            }
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            this.content.add(new THREE.Line(g, this._matLine(col, 0.5, { vertexColors: true })));
        };
        for (let x = Math.ceil(xMin / step) * step; x <= xMax + 1e-9; x += step) {
            addFadeLine(x, yMin, x, yMax, x === 0 ? 1 : 0.42);
        }
        for (let y = Math.ceil(yMin / step) * step; y <= yMax + 1e-9; y += step) {
            addFadeLine(xMin, y, xMax, y, y === 0 ? 1 : 0.42);
        }
    }

    _familyWorld(x, y) {
        const sc = this._familySC || 0.48;
        return new THREE.Vector3(x * sc, y * sc, 0);
    }

    _addFamilyLine(a, b, color) {
        const steps = 64;
        const pts = [];
        const colors = new Float32Array((steps + 1) * 3);
        const col = new THREE.Color(color);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;
            pts.push(this._familyWorld(x, y));
            const edge = Math.min(t, 1 - t) * 2;
            const along = Math.pow(Math.min(1, edge / 0.28), 1.6);
            colors[i * 3] = col.r * along;
            colors[i * 3 + 1] = col.g * along;
            colors[i * 3 + 2] = col.b * along;
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this._opAdd(new THREE.Line(g, this._matLine(color, 1, { vertexColors: true })));
    }

    _addFamilyPoint(pt, color, label) {
        const w = this._familyWorld(pt.x, pt.y);
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 14, 12),
            new THREE.MeshBasicMaterial({ color: color })
        );
        mesh.position.copy(w);
        mesh.userData = { isCurvePoint: true, label: label, x: pt.x, y: pt.y };
        this._opAdd(mesh);
        this._trackZoomDot(mesh);
        const sprite = this._makeLabelSprite(label, color);
        sprite.position.set(w.x, w.y + 0.22, w.z);
        this._opAdd(sprite);
    }

    _extendThrough(P, Q, len) {
        const dx = Q.x - P.x;
        const dy = Q.y - P.y;
        const n = Math.hypot(dx, dy) || 1;
        const ux = dx / n, uy = dy / n;
        return {
            a: { x: P.x - ux * len, y: P.y - uy * len },
            b: { x: Q.x + ux * len, y: Q.y + uy * len }
        };
    }

    _drawFamilyGroupOp() {
        if (!this.groupOp) {
            this.hudOp = '—';
            return;
        }
        const ops = ECC.demoRealOps(this.familyPX);
        const P = ops.P, Q = ops.Q;
        const op = this.groupOp;

        const f = this._lineLenFactor();
        const chordLen = 140 * f;
        const reflLen = 120 * f;
        const infY = 160 * Math.max(0.35, f);

        if (op === 'add') {
            const chord = this._extendThrough(P, ops.Rp, chordLen);
            this._addFamilyLine(chord.a, chord.b, this._tone('chord'));
            const refl = this._extendThrough(ops.Rp, ops.R, reflLen);
            this._addFamilyLine(refl.a, refl.b, this._tone('reflect'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(Q, this._tone('ptQ'), 'Q');
            this._addFamilyPoint(ops.Rp, this._tone('ptRp'), "R′");
            this._addFamilyPoint(ops.R, this._tone('ptR'), 'R');
            this.hudOp = 'R = P ⊕ Q on secp256k1 (z = 0)';
        } else if (op === 'double') {
            if (!ops.R2) {
                this._addFamilyPoint(P, this._tone('white'), 'P');
                this.hudOp = '2P = 𝒪 (tangent vertical)';
            } else {
                const t = { x: P.x + 1, y: P.y + ops.R2.lam };
                const chord = this._extendThrough(P, t, chordLen);
                this._addFamilyLine(chord.a, chord.b, this._tone('tangent'));
                const refl = this._extendThrough(ops.R2p, ops.R2, reflLen);
                this._addFamilyLine(refl.a, refl.b, this._tone('reflect'));
                this._addFamilyPoint(P, this._tone('white'), 'P');
                this._addFamilyPoint(ops.R2p, this._tone('ptRp'), "R′");
                this._addFamilyPoint(ops.R2, this._tone('ptR'), '2P');
                this.hudOp = '2P = P ⊕ P on secp256k1 (z = 0)';
            }
        } else if (op === 'inverse') {
            this._addFamilyLine({ x: P.x, y: infY }, { x: P.x, y: -infY }, this._tone('chord'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(ops.nP, this._tone('ptQ'), '−P');
            const inf = this._familyWorld(P.x, infY);
            const spr = this._makeLabelSprite('𝒪', 0xffffff);
            spr.position.set(inf.x, inf.y + 0.2, inf.z);
            this._opAdd(spr);
            this.hudOp = 'P ⊕ (−P) = 𝒪 on secp256k1 (z = 0)';
        } else {
            const chord = this._extendThrough(P, ops.nQ, chordLen);
            this._addFamilyLine(chord.a, chord.b, this._tone('chord'));
            const refl = this._extendThrough(ops.Sp, ops.S, reflLen);
            this._addFamilyLine(refl.a, refl.b, this._tone('reflect'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(Q, this._tone('muted'), 'Q');
            this._addFamilyPoint(ops.nQ, this._tone('ptQ'), '−Q');
            this._addFamilyPoint(ops.S, this._tone('ptR'), 'P−Q');
            this.hudOp = 'P − Q = P ⊕ (−Q) on secp256k1 (z = 0)';
        }
    }

    _ensureField() {
        if (this._fieldCache && this._fieldCache.primeIndex === this.primeIndex && this._fieldCache.drawCap === this.drawCap) {
            return this._fieldCache;
        }
        const entry = ECC.PRIME_LADDER[this.primeIndex];
        const packed = ECC.fieldPointsForPrime(entry, this.drawCap);
        this._fieldCache = Object.assign({ primeIndex: this.primeIndex, drawCap: this.drawCap, entry: entry }, packed);
        return this._fieldCache;
    }

    _priorFieldScatter() {
        if (this.primeIndex <= 0) return [];
        const prev = ECC.PRIME_LADDER[this.primeIndex - 1];
        const packed = ECC.fieldPointsForPrime(prev, this.drawCap);
        return packed.points || [];
    }

    _domainGridRes() {
        if (this.morphT >= 0.999 || this._torusSubdiving) return { nu: 80, nv: 40 };
        return { nu: 40, nv: 20 };
    }

    _domainPoint(u, v, t) {
        const p1 = ECC.sampleDomain(u, v, t);
        const s = this._torusSubdiv;
        if (t < 0.999 || s >= 0.999) return p1;
        const nu = 40, nv = 20;
        const fu = u * nu, fv = v * nv;
        const i0 = Math.floor(fu), j0 = Math.floor(fv);
        const i1 = Math.min(nu, i0 + 1), j1 = Math.min(nv, j0 + 1);
        const su = fu - i0, sv = fv - j0;
        const a = ECC.sampleDomain(i0 / nu, j0 / nv, t);
        const b = ECC.sampleDomain(i1 / nu, j0 / nv, t);
        const c = ECC.sampleDomain(i0 / nu, j1 / nv, t);
        const d = ECC.sampleDomain(i1 / nu, j1 / nv, t);
        const k = s * s * (3 - 2 * s);
        const p0x = a.x + (b.x - a.x) * su + (c.x - a.x) * sv + (a.x - b.x - c.x + d.x) * su * sv;
        const p0y = a.y + (b.y - a.y) * su + (c.y - a.y) * sv + (a.y - b.y - c.y + d.y) * su * sv;
        const p0z = a.z + (b.z - a.z) * su + (c.z - a.z) * sv + (a.z - b.z - c.z + d.z) * su * sv;
        return {
            x: p0x + (p1.x - p0x) * k,
            y: p0y + (p1.y - p0y) * k,
            z: p0z + (p1.z - p0z) * k
        };
    }

    _buildDomainSurface(group, t) {
        const res = this._domainGridRes();
        const nu = res.nu, nv = res.nv;
        const verts = [];
        let i, j, u, v, p, a, b, c;
        for (j = 0; j <= nv; j++) {
            for (i = 0; i <= nu; i++) {
                u = i / nu;
                v = j / nv;
                p = this._domainPoint(u, v, t);
                verts.push(p.x, p.y, p.z);
            }
        }
        const coarseIdx = [];
        const extraIdx = [];
        const split = nu > 40;
        for (j = 0; j <= nv; j++) {
            for (i = 0; i < nu; i++) {
                a = j * (nu + 1) + i;
                b = a + 1;
                if (split && (j % 2 === 1)) extraIdx.push(a, b);
                else coarseIdx.push(a, b);
            }
        }
        for (j = 0; j < nv; j++) {
            for (i = 0; i <= nu; i++) {
                a = j * (nu + 1) + i;
                c = a + (nu + 1);
                if (split && (i % 2 === 1)) extraIdx.push(a, c);
                else coarseIdx.push(a, c);
            }
        }
        const idx = coarseIdx.concat(extraIdx);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setIndex(idx);
        let mesh = null;
        let gridCoarseMat = null;
        let gridExtraMat = null;
        if (this.showGrid) {
            gridCoarseMat = this._matLine(this._tone('grid'), this._gridCoarseOpacity());
            if (extraIdx.length) {
                geom.addGroup(0, coarseIdx.length, 0);
                geom.addGroup(coarseIdx.length, extraIdx.length, 1);
                gridExtraMat = this._matLine(this._tone('grid'), this._gridExtraOpacity());
                mesh = new THREE.LineSegments(geom, [gridCoarseMat, gridExtraMat]);
            } else {
                mesh = new THREE.LineSegments(geom, gridCoarseMat);
            }
            group.add(mesh);
        }

        let geoA = null, geoB = null, geoMid = null;
        if (this.showGrid) {
            const edgeA = [];
            const edgeB = [];
            const mid = [];
            for (i = 0; i <= 64; i++) {
                const ua = i / 64;
                edgeA.push(this._v3(ECC.sampleDomain(ua, 0, t)));
                edgeB.push(this._v3(ECC.sampleDomain(0, ua, t)));
                mid.push(this._v3(ECC.sampleDomain(ua, 0.5, t)));
            }
            geoA = new THREE.BufferGeometry().setFromPoints(edgeA);
            geoB = new THREE.BufferGeometry().setFromPoints(edgeB);
            geoMid = new THREE.BufferGeometry().setFromPoints(mid);
            group.add(new THREE.Line(geoA, this._matLine(this._tone('edgeA'), 0.95)));
            group.add(new THREE.Line(geoB, this._matLine(this._tone('edgeB'), 0.95)));
            group.add(new THREE.Line(geoMid, this._matLine(this._tone('mid'), 0.9)));
        }

        return { geom: geom, nu: nu, nv: nv, mesh: mesh, geoA: geoA, geoB: geoB, geoMid: geoMid, gridCoarseMat: gridCoarseMat, gridExtraMat: gridExtraMat };
    }

    _makeDomainFillGeom(nu, nv, t) {
        const verts = [];
        const uvs = [];
        const idx = [];
        let i, j, u, v, p, a, b, c, d;
        for (j = 0; j <= nv; j++) {
            for (i = 0; i <= nu; i++) {
                u = i / nu;
                v = j / nv;
                p = this._domainPoint(u, v, t);
                verts.push(p.x, p.y, p.z);
                uvs.push(u, v);
            }
        }
        for (j = 0; j < nv; j++) {
            for (i = 0; i < nu; i++) {
                a = j * (nu + 1) + i;
                b = a + 1;
                c = a + (nu + 1);
                d = c + 1;
                idx.push(a, c, b, b, c, d);
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(idx);
        geom.computeVertexNormals();
        return geom;
    }

    _domainFillMaterial() {
        const rim = this.useColor ? new THREE.Color(0xeaf8ff) : new THREE.Color(0xffffff);
        const core = this.useColor ? new THREE.Color(0xb7d0de) : new THREE.Color(0xd8d8dc);
        return new THREE.ShaderMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uRim: { value: rim },
                uCore: { value: core }
            },
            vertexShader: [
                'varying vec3 vWorldPos;',
                'varying vec3 vWorldN;',
                'void main() {',
                '  vec4 wp = modelMatrix * vec4(position, 1.0);',
                '  vWorldPos = wp.xyz;',
                '  vWorldN = normalize(mat3(modelMatrix) * normal);',
                '  gl_Position = projectionMatrix * viewMatrix * wp;',
                '}'
            ].join('\n'),
            fragmentShader: [
                'uniform vec3 uRim;',
                'uniform vec3 uCore;',
                'varying vec3 vWorldPos;',
                'varying vec3 vWorldN;',
                'float hash(vec2 p) {',
                '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
                '}',
                'float noise(vec2 p) {',
                '  vec2 i = floor(p);',
                '  vec2 f = fract(p);',
                '  f = f * f * (3.0 - 2.0 * f);',
                '  float a = hash(i);',
                '  float b = hash(i + vec2(1.0, 0.0));',
                '  float c = hash(i + vec2(0.0, 1.0));',
                '  float d = hash(i + vec2(1.0, 1.0));',
                '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
                '}',
                'float fbm(vec2 p) {',
                '  return 0.50 * noise(p) + 0.25 * noise(p * 2.13 + 1.7) + 0.125 * noise(p * 4.27 - 3.1);',
                '}',
                'void main() {',
                '  vec3 N = normalize(vWorldN);',
                '  if (!gl_FrontFacing) N = -N;',
                '  vec3 V = normalize(cameraPosition - vWorldPos);',
                '  float ndv = abs(dot(N, V));',
                '  float fres = pow(1.0 - ndv, 1.6);',
                '  vec3 w = abs(N);',
                '  w /= (w.x + w.y + w.z);',
                '  float sc = 14.0;',
                '  float grain = fbm(vWorldPos.yz * sc) * w.x + fbm(vWorldPos.zx * sc) * w.y + fbm(vWorldPos.xy * sc) * w.z;',
                '  float speck = hash(floor(vWorldPos.yz * 90.0)) * w.x + hash(floor(vWorldPos.zx * 90.0)) * w.y + hash(floor(vWorldPos.xy * 90.0)) * w.z;',
                '  vec3 col = mix(uCore, uRim, clamp(fres * 0.7 + 0.38, 0.0, 1.0));',
                '  col += (grain - 0.45) * 0.14;',
                '  col += (speck - 0.5) * 0.04;',
                '  float alpha = 0.78 + 0.18 * fres;',
                '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);',
                '}'
            ].join('\n')
        });
    }

    _addDomainFill(group, t) {
        const nu = 128, nv = 64;
        const geom = this._makeDomainFillGeom(nu, nv, t);
        const mesh = new THREE.Mesh(geom, this._domainFillMaterial());
        mesh.renderOrder = -1;
        group.add(mesh);
        return { geom: geom, mesh: mesh, nu: nu, nv: nv };
    }

    _v3(p) {
        return new THREE.Vector3(p.x, p.y, p.z);
    }

    _updateSurfacePositions(geom, nu, nv, t) {
        const pos = geom.attributes.position;
        let i, j, u, v, p, n = 0;
        for (j = 0; j <= nv; j++) {
            for (i = 0; i <= nu; i++) {
                u = i / nu;
                v = j / nv;
                p = this._domainPoint(u, v, t);
                pos.setXYZ(n++, p.x, p.y, p.z);
            }
        }
        pos.needsUpdate = true;
        if (geom.attributes.normal) geom.computeVertexNormals();
        geom.computeBoundingSphere();
    }

    _dotZoomScale() {
        const d = (this.controls && this.controls.distance) || 16;
        return Math.max(0.05, Math.min(1, d / 16));
    }

    _trackZoomDot(mesh) {
        if (!mesh) return mesh;
        this._zoomDots.push(mesh);
        mesh.scale.setScalar(this._dotZoomScale());
        return mesh;
    }

    _applyDotZoom() {
        const z = this._dotZoomScale();
        if (Math.abs(z - this._lastDotZoom) < 0.002) return;
        this._lastDotZoom = z;
        const st = this._domainState;
        if (st && st.instances && st.points) {
            this._placeInstances(st.instances, st.points, this.morphT, st.highlightIndex == null ? -1 : st.highlightIndex);
        }
        let i;
        for (i = 0; i < this._zoomDots.length; i++) {
            if (this._zoomDots[i]) this._zoomDots[i].scale.setScalar(z);
        }
    }

    _makeInstances(count, radius) {
        const geo = new THREE.SphereGeometry(radius, 10, 8);
        const mat = new THREE.MeshBasicMaterial({ color: this._tone('pt') });
        const inst = new THREE.InstancedMesh(geo, mat, count);
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        inst.frustumCulled = false;
        return inst;
    }

    _placeInstances(inst, points, t, highlightIndex) {
        const dummy = new THREE.Object3D();
        const n = Math.min(points.length, inst.count);
        const z = this._dotZoomScale();
        let i, p, q, s;
        for (i = 0; i < n; i++) {
            q = points[i];
            p = ECC.sampleDomain(q.u, q.v, t);
            s = ((i === highlightIndex) ? 1.8 : 1) * z;
            dummy.position.set(p.x, p.y, p.z);
            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
        }
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
        this._lastDotZoom = z;
    }

    buildDomain() {
        this._ensureTorusSubdiv();
        const t = this.morphT;
        const field = this._domainDrawField();
        const surf = this._buildDomainSurface(this.content, t);
        let inst = null;
        const dots = field.solid ? this._priorFieldScatter() : field.points;
        if (dots && dots.length) {
            const r = field.solid
                ? 0.0055
                : (field.exact ? (field.p <= 17 ? 0.028 : field.p <= 251 ? 0.014 : 0.007) : 0.0055);
            inst = this._makeInstances(dots.length, r);
            this.content.add(inst);
            this._placeInstances(inst, dots, t, -1);
        }
        const fill = field.solid ? this._addDomainFill(this.content, t) : null;
        this._domainState = {
            geom: surf.geom,
            nu: surf.nu,
            nv: surf.nv,
            instances: inst,
            points: dots,
            geoA: surf.geoA,
            geoB: surf.geoB,
            geoMid: surf.geoMid,
            fillGeom: fill && fill.geom,
            fillNu: fill && fill.nu,
            fillNv: fill && fill.nv,
            gridCoarseMat: surf.gridCoarseMat,
            gridExtraMat: surf.gridExtraMat
        };
        this._fieldOpRoot = new THREE.Group();
        this.content.add(this._fieldOpRoot);
        this._drawFieldGroupOp();
        if (this._kgOverlay) this._buildKgOverlay();
    }

    _fieldOpP() {
        if (this._groupToy || this._kgOverlay) return 17;
        const field = this._ensureField();
        if (field && field.p != null) return field.p;
        const entry = ECC.PRIME_LADDER[this.primeIndex];
        return ECC.entryPrime ? ECC.entryPrime(entry) : (entry && entry.p);
    }

    _addLabeledPoint(pt, color, label, extra) {
        if (!pt || pt.inf) return null;
        const p = this._fieldOpP();
        const pos = ECC.sampleDomain(ECC.toUnit(pt.x, p), ECC.toUnit(pt.y, p), this.morphT);
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 14, 12),
            new THREE.MeshBasicMaterial({ color: color })
        );
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.userData = Object.assign({ isCurvePoint: true, label: label, x: pt.x, y: pt.y }, extra || {});
        const parent = this._fieldOpRoot || this.content;
        parent.add(mesh);
        this._trackZoomDot(mesh);
        const sprite = this._makeLabelSprite(label, color);
        sprite.position.set(pos.x, pos.y + 0.16, pos.z);
        parent.add(sprite);
        return mesh;
    }

    _makeLabelSprite(text, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(0.45, 0.22, 1);
        spr.userData._cryptoSprite = true;
        return spr;
    }

    _foldChartUV(u, v, dirU, dirV, isEnd) {
        const uInt = Math.abs(u - Math.round(u)) < 1e-8;
        const vInt = Math.abs(v - Math.round(v)) < 1e-8;
        let fu = u - Math.floor(u);
        let fv = v - Math.floor(v);
        if (fu < 0) fu += 1;
        if (fv < 0) fv += 1;
        if (fu >= 1) fu = 0;
        if (fv >= 1) fv = 0;
        if (uInt) fu = (isEnd ? dirU >= 0 : dirU < 0) ? 1 : 0;
        if (vInt) fv = (isEnd ? dirV >= 0 : dirV < 0) ? 1 : 0;
        return { u: fu, v: fv };
    }

    _chartCellSegments(u0, v0, u1, v1) {
        const du = u1 - u0;
        const dv = v1 - v0;
        const dirU = du > 0 ? 1 : du < 0 ? -1 : 0;
        const dirV = dv > 0 ? 1 : dv < 0 ? -1 : 0;
        const eps = 1e-10;
        const segs = [];
        let t = 0;
        let guard = 0;
        while (t < 1 - eps && guard++ < 512) {
            const u = u0 + t * du;
            const v = v0 + t * dv;
            let tNext = 1;
            if (dirU) {
                const nextInt = dirU > 0 ? Math.floor(u + eps) + 1 : Math.ceil(u - eps) - 1;
                const tn = (nextInt - u0) / du;
                if (tn > t + eps && tn < tNext) tNext = tn;
            }
            if (dirV) {
                const nextInt = dirV > 0 ? Math.floor(v + eps) + 1 : Math.ceil(v - eps) - 1;
                const tn = (nextInt - v0) / dv;
                if (tn > t + eps && tn < tNext) tNext = tn;
            }
            if (tNext <= t + eps) tNext = Math.min(1, t + 0.02);
            segs.push({
                u0: u0 + t * du,
                v0: v0 + t * dv,
                u1: u0 + tNext * du,
                v1: v0 + tNext * dv,
                dirU: dirU,
                dirV: dirV
            });
            t = tNext;
        }
        return segs;
    }

    _addWrappedChord(P, Q, color, dest) {
        if (!P || !Q || P.inf || Q.inf) return;
        const fieldP = this._fieldOpP();
        const u0 = ECC.toUnit(P.x, fieldP);
        const v0 = ECC.toUnit(P.y, fieldP);
        const u1 = ECC.toUnit(Q.x, fieldP);
        const v1 = ECC.toUnit(Q.y, fieldP);
        const du = u1 - u0;
        const dv = v1 - v0;
        if (du === 0 && dv === 0) return;
        const span = Math.hypot(du, dv) || 1e-9;
        const f = this._lineLenFactor();
        const extra = Math.max(0, (Math.max(span, 3.6 * f) - span) / 2);
        const ux = du / span, uy = dv / span;
        const aU = u0 - ux * extra;
        const aV = v0 - uy * extra;
        const bU = u1 + ux * extra;
        const bV = v1 + uy * extra;
        const col = new THREE.Color(color);
        const parent = (dest && dest.isObject3D) ? dest : (this._fieldOpRoot || this.content);
        const tMorph = this.morphT;
        const segs = this._chartCellSegments(aU, aV, bU, bV);
        for (let s = 0; s < segs.length; s++) {
            const seg = segs[s];
            const a = this._foldChartUV(seg.u0, seg.v0, seg.dirU, seg.dirV, false);
            const b = this._foldChartUV(seg.u1, seg.v1, seg.dirU, seg.dirV, true);
            const dist = Math.hypot(b.u - a.u, b.v - a.v);
            const steps = Math.max(12, Math.min(96, Math.ceil(dist * 80)));
            const pts = [];
            for (let i = 0; i <= steps; i++) {
                const k = i / steps;
                const u = a.u + (b.u - a.u) * k;
                const v = a.v + (b.v - a.v) * k;
                pts.push(this._v3(ECC.sampleDomain(u, v, tMorph)));
            }
            if (pts.length < 2) continue;
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            parent.add(new THREE.Line(g, this._matLine(col, 1)));
        }
    }

    _addVerticalToInfinity(P) {
        if (!P || P.inf) return;
        const p = this._fieldOpP();
        const nP = ECC.negPt(P, p);
        this._addWrappedChord(P, nP, this._tone('chord'));
        const top = ECC.sampleDomain(ECC.toUnit(P.x, p), 0.98, this.morphT);
        const spr = this._makeLabelSprite('𝒪', 0xffffff);
        spr.position.set(top.x, top.y + 0.2, top.z);
        (this._fieldOpRoot || this.content).add(spr);
        this.hudOp = 'P ⊕ (−P) = 𝒪';
    }

    _clearFieldOp() {
        if (!this._fieldOpRoot) return;
        const gone = new Set();
        this._fieldOpRoot.traverse((child) => gone.add(child));
        this._zoomDots = this._zoomDots.filter((m) => !gone.has(m));
        this._fieldOpRoot.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        });
        if (this._fieldOpRoot.parent) this._fieldOpRoot.parent.remove(this._fieldOpRoot);
        this._fieldOpRoot = null;
    }

    _redrawFieldGroupOp(opts) {
        opts = opts || {};
        this._clearFieldOp();
        if (!this.content) return;
        this._fieldOpRoot = new THREE.Group();
        this.content.add(this._fieldOpRoot);
        this._drawFieldGroupOp();
        if (opts.quiet) {
            this._syncPSlider();
            const opEl = document.getElementById('crypto-op-label');
            if (opEl) opEl.textContent = this.hudOp;
        } else {
            this.updatePanel();
        }
    }

    _drawFieldGroupOp() {
        if (!this.groupOp) {
            this.hudOp = '—';
            return;
        }
        const p = this._fieldOpP();
        const P = this._fieldP();
        const Q = this._fieldQ(P);
        if (!P) {
            this.hudOp = '—';
            return;
        }
        let R, Rp, nQ;

        if (this.groupOp === 'add') {
            R = Q ? ECC.addFp(P, Q, p) : ECC.INF;
            Rp = R.inf ? ECC.INF : { x: R.x, y: ECC.mod(-R.y, p) };
            this._addWrappedChord(P, Q, this._tone('chord'), Rp.inf ? [] : [Rp]);
            if (!R.inf && !Rp.inf) this._addWrappedChord(Rp, R, this._tone('reflect'));
            this._addLabeledPoint(P, this._tone('white'), 'P');
            this._addLabeledPoint(Q, this._tone('ptQ'), 'Q');
            if (!Rp.inf) this._addLabeledPoint(Rp, this._tone('ptRp'), "R′");
            if (!R.inf) this._addLabeledPoint(R, this._tone('ptR'), 'R');
            this.hudOp = R.inf ? 'P ⊕ Q = 𝒪' : 'R = P ⊕ Q  (wraps on this domain)';
        } else if (this.groupOp === 'double') {
            R = ECC.sumDoubleFp(P, p);
            Rp = R.inf ? ECC.INF : { x: R.x, y: ECC.mod(-R.y, p) };
            const one = typeof P.x === 'bigint' ? 1n : 1;
            const Q2 = { x: ECC.mod(P.x + one, p), y: P.y };
            this._addWrappedChord(P, R.inf ? Q2 : Rp, this._tone('tangent'), R.inf ? [] : [Rp]);
            if (!R.inf && !Rp.inf) this._addWrappedChord(Rp, R, this._tone('reflect'));
            this._addLabeledPoint(P, this._tone('white'), 'P');
            if (!Rp.inf) this._addLabeledPoint(Rp, this._tone('ptRp'), "R′");
            if (!R.inf) this._addLabeledPoint(R, this._tone('ptR'), '2P');
            this.hudOp = R.inf ? '2P = 𝒪' : '2P = P ⊕ P  (wraps on this domain)';
        } else if (this.groupOp === 'inverse') {
            this._addLabeledPoint(P, this._tone('white'), 'P');
            this._addLabeledPoint(ECC.negPt(P, p), this._tone('ptQ'), '−P');
            this._addVerticalToInfinity(P);
        } else {
            nQ = ECC.negPt(Q, p);
            R = ECC.addFp(P, nQ, p);
            Rp = R.inf ? ECC.INF : { x: R.x, y: ECC.mod(-R.y, p) };
            this._addWrappedChord(P, nQ, this._tone('chord'), Rp.inf ? [] : [Rp]);
            if (!R.inf && !Rp.inf) this._addWrappedChord(Rp, R, this._tone('reflect'));
            this._addLabeledPoint(P, this._tone('white'), 'P');
            this._addLabeledPoint(Q, this._tone('muted'), 'Q');
            this._addLabeledPoint(nQ, this._tone('ptQ'), '−Q');
            if (!R.inf) this._addLabeledPoint(R, this._tone('ptR'), 'P−Q');
            this.hudOp = R.inf ? 'P − Q = 𝒪' : 'P − Q = P ⊕ (−Q)  (wraps on this domain)';
        }
    }

    _clearScalarHopGroup() {
        const g = this._scalarHopGroup;
        if (!g) return;
        while (g.children.length) {
            const c = g.children[0];
            g.remove(c);
            this._zoomDots = this._zoomDots.filter((x) => x !== c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
                if (c.material.map) c.material.map.dispose();
                c.material.dispose();
            }
        }
    }

    _addScalarHopMarkers(hops) {
        let i, h, p, m;
        for (i = 0; i < hops.length; i++) {
            h = hops[i];
            if (!h || h.inf) continue;
            p = ECC.sampleDomain(h.x / 17, h.y / 17, this.morphT);
            m = new THREE.Mesh(
                new THREE.SphereGeometry(0.032, 10, 8),
                new THREE.MeshBasicMaterial({
                    color: this._tone('hop'),
                    transparent: true,
                    opacity: 0.7
                })
            );
            m.position.set(p.x, p.y, p.z);
            this.content.add(m);
            this._trackZoomDot(m);
        }
        if (ECC.F17.G && !ECC.F17.G.inf) {
            this._addLabeledPoint(ECC.F17.G, this._tone('white'), 'G');
        }
    }

    buildScalar() {
        this.dimIndex = ECC.DIM_STEPS - 1;
        this.morphT = 1;
        this._ensureTorusSubdiv();
        const field = this._ensureToyField();
        const surf = this._buildDomainSurface(this.content, 1);
        const inst = this._makeInstances(field.points.length, 0.016);
        this.content.add(inst);
        this._placeInstances(inst, field.points, 1, -1);
        this._domainState = {
            geom: surf.geom, nu: surf.nu, nv: surf.nv,
            instances: inst, points: field.points,
            geoA: surf.geoA, geoB: surf.geoB, geoMid: surf.geoMid,
            gridCoarseMat: surf.gridCoarseMat,
            gridExtraMat: surf.gridExtraMat
        };

        const G = ECC.F17.G;
        const order = ECC.F17.order;
        const hops = ECC.multiplesOf(G, 17, order);
        this._scalarHops = hops;
        this._scalarTrail = [];
        this._addScalarHopMarkers(hops);
        this._scalarHopGroup = new THREE.Group();
        this.content.add(this._scalarHopGroup);
        this._scalarHighlight = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 14, 12),
            new THREE.MeshBasicMaterial({ color: this._tone('hopActive') })
        );
        this._trackZoomDot(this._scalarHighlight);
        this.content.add(this._scalarHighlight);
        this._scalarLabel = this._makeLabelSprite('G', this._tone('hopActive'));
        this.content.add(this._scalarLabel);
        if (this._realKey && this._realKey.toyR) this.scalarK = this._realKey.toyR;
        this._updateScalarHighlight();
    }

    _buildKgOverlay() {
        const G = ECC.F17.G;
        const order = ECC.F17.order;
        const hops = ECC.multiplesOf(G, 17, order);
        this._scalarHops = hops;
        this._scalarTrail = [];
        this._addScalarHopMarkers(hops);
        this._scalarHopGroup = new THREE.Group();
        this.content.add(this._scalarHopGroup);
        this._scalarHighlight = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 14, 12),
            new THREE.MeshBasicMaterial({ color: this._tone('hopActive') })
        );
        this._trackZoomDot(this._scalarHighlight);
        this.content.add(this._scalarHighlight);
        this._scalarLabel = this._makeLabelSprite('G', this._tone('hopActive'));
        this.content.add(this._scalarLabel);
        if (this._realKey && this._realKey.toyR) this.scalarK = this._realKey.toyR;
        this._updateScalarHighlight();
    }

    _setScalarLabel(text) {
        const canvas = this._scalarLabel.material.map.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 32);
        this._scalarLabel.material.map.needsUpdate = true;
    }

    _updateScalarHighlight() {
        if (!this._scalarHops || !this._scalarHighlight) return;
        const hops = this._scalarHops;
        if (this.scalarK > hops.length) this.scalarK = 1;
        const h = hops[this.scalarK - 1];
        const prev = this.scalarK > 1 ? hops[this.scalarK - 2] : null;
        this._clearScalarHopGroup();
        const key = this._realKey;
        const dest = key && key.toyR === this.scalarK;
        if (prev && h && !prev.inf && !h.inf) {
            this._addWrappedChord(prev, h, this._tone('chord'), this._scalarHopGroup);
        }
        if (!h || h.inf) {
            this._scalarHighlight.visible = false;
            this._scalarLabel.position.set(0, 2.2, 0);
            this._setScalarLabel('𝒪');
            this.hudOp = this.scalarK + 'G = 𝒪';
            return;
        }
        this._scalarHighlight.visible = true;
        const p = ECC.sampleDomain(h.x / 17, h.y / 17, this.morphT);
        this._scalarHighlight.position.set(p.x, p.y, p.z);
        this._scalarLabel.position.set(p.x, p.y + 0.2, p.z);
        const tag = this.scalarK === 1 ? 'G' : (this.scalarK + 'G');
        this._setScalarLabel(dest ? ('r=' + this.scalarK) : tag);
        if (key) {
            this.hudOp = dest
                ? ('k ≡ ' + this.scalarK + ' (mod n₁₇)')
                : (tag + '  →  r = ' + key.toyR);
        } else {
            this.hudOp = tag + '  (add G)';
        }
    }

    _releaseScalarMesh(m) {
        if (!m) return;
        this._zoomDots = this._zoomDots.filter((x) => x !== m);
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }

    _pushScalarTrail(k) {
        const hops = this._scalarHops;
        if (!hops || !this.content) return;
        const h = hops[k - 1];
        if (!h || h.inf) return;
        const p = ECC.sampleDomain(h.x / 17, h.y / 17, this.morphT);
        const m = new THREE.Mesh(
            new THREE.SphereGeometry(0.028, 10, 8),
            new THREE.MeshBasicMaterial({
                color: this._tone('hop'),
                transparent: true,
                opacity: 0.85
            })
        );
        m.position.set(p.x, p.y, p.z);
        this.content.add(m);
        this._trackZoomDot(m);
        if (!this._scalarTrail) this._scalarTrail = [];
        this._scalarTrail.push(m);
        const max = 6;
        while (this._scalarTrail.length > max) this._releaseScalarMesh(this._scalarTrail.shift());
        const n = this._scalarTrail.length;
        for (let i = 0; i < n; i++) {
            const u = (i + 1) / n;
            this._scalarTrail[i].material.opacity = 0.18 + 0.55 * u;
            this._scalarTrail[i].scale.setScalar(0.65 + 0.35 * u);
        }
    }

    _pointCountLabel() {
        if (this.view === 'family') {
            const r = this._familyZRange();
            return r.n + (r.n === 1 ? ' curve ' : ' curves ') + this._formatZRange(r);
        }
        if (this._kgOverlay) {
            const toy = this._ensureToyField();
            return toy.count + ' hops on 𝔽₁₇';
        }
        const field = this.view === 'domain' ? this._domainDrawField() : this._ensureField();
        if (field.solid) {
            const n = (this._domainState && this._domainState.points && this._domainState.points.length) || 0;
            return n ? 'full surface · ' + n + ' prior sample' : 'full surface';
        }
        return field.count + (field.exact ? '' : ' schematic') + (field.toy ? ' · 𝔽₁₇' : '');
    }

    _domainLabel() {
        if (this.view === 'family') return 'Cartesian';
        return ECC.DIM_NAMES[this.dimIndex] || '';
    }

    _curveTotalLabel() {
        if (this.view === 'family') return 'ℝ curves, not 𝔽_p';
        if (this._kgOverlay && this._realKey) return '~' + ECC.formatPow2(256);
        const field = this.view === 'domain' ? this._domainDrawField() : this._ensureField();
        const bits = field.bits || (ECC.PRIME_LADDER[this.primeIndex] && ECC.PRIME_LADDER[this.primeIndex].bits);
        if (field.exact && field.total != null) {
            const extra = field.total > field.count ? ' (capped draw)' : '';
            return field.total + extra + (field.toy ? ' on 𝔽₁₇' : '');
        }
        return '~' + ECC.formatPow2(bits);
    }

    updatePanel() {
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        const names = { family: 'Family', domain: this._kgOverlay ? 'Domain · kG' : 'Domain' };
        const entry = (this._kgOverlay && this._realKey)
            ? ECC.PRIME_LADDER[ECC.PRIME_LADDER.length - 1]
            : ECC.PRIME_LADDER[this.primeIndex];
        const scale = ECC.fieldScale(entry);
        set('crypto-view-label', names[this.view] || this.view);
        set('crypto-dim-label', this._domainLabel());
        set('crypto-prime-label', this._kgOverlay
            ? (this._realKey ? '256-bit secp256k1  ·  hops on 𝔽₁₇' : '𝔽₁₇ (kG toy)')
            : (this._groupToy ? '𝔽₁₇ (labels)' : (entry.bits ? entry.bits + '-bit ' : '') + entry.label));
        set('crypto-point-count', this._pointCountLabel());
        set('crypto-curve-total', this._curveTotalLabel());
        set('crypto-entropy', scale.entropy);
        set('crypto-search', scale.search);
        set('crypto-atoms', scale.atoms);
        set('crypto-op-label', this.hudOp);
        const key = this._realKey;
        const seedRow = document.getElementById('crypto-seed-row');
        const pathRow = document.getElementById('crypto-path-row');
        const kRow = document.getElementById('crypto-k-row');
        const qRow = document.getElementById('crypto-q-row');
        const showKey = this._kgOverlay && key;
        if (seedRow) seedRow.hidden = !(showKey && key.mnemonic);
        if (pathRow) pathRow.hidden = !(showKey && key.path);
        if (kRow) kRow.hidden = !showKey;
        if (qRow) qRow.hidden = !showKey;
        if (key) {
            if (key.mnemonic) set('crypto-seed-label', key.mnemonic);
            if (key.path) set('crypto-path-label', key.path + '  (index 0)');
            set('crypto-k-label', this._shortHex(key.kHex, 8, 8) + '  (' + key.source + ')');
            set('crypto-q-label', this._shortHex(key.pubHex, 8, 8) + '  (Q = kG)');
            const kEl = document.getElementById('crypto-k-label');
            const qEl = document.getElementById('crypto-q-label');
            if (kEl) kEl.setAttribute('title', key.kHex);
            if (qEl) qEl.setAttribute('title', key.pubHex);
        }
        set('crypto-subtitle', this.view === 'family'
            ? 'y² = x³ + 7'
            : (this._kgOverlay
                ? 'kG  ·  toy r ≡ k (mod n₁₇)'
                : 'z = 0 over ' + ((entry && entry.label) || '𝔽_p')));
        const play = document.getElementById('scalar-play');
        if (play) play.textContent = this.scalarPlaying ? 'Pause kG' : 'Play kG';
        this._syncToolbar();
    }

    _setLinePoints(geom, pts) {
        const pos = geom.attributes.position;
        for (let i = 0; i < pts.length; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
        pos.needsUpdate = true;
        geom.computeBoundingSphere();
    }

    _applyMorphT(t) {
        this.morphT = t;
        if (!this._domainState) return;
        this._updateSurfacePositions(this._domainState.geom, this._domainState.nu, this._domainState.nv, t);
        if (this._domainState.fillGeom) {
            this._updateSurfacePositions(this._domainState.fillGeom, this._domainState.fillNu, this._domainState.fillNv, t);
        }
        if (this._domainState.instances && this._domainState.points) {
            this._placeInstances(this._domainState.instances, this._domainState.points, t, -1);
        }
        const st = this._domainState;
        if (st.geoA) {
            const edgeA = [], edgeB = [], mid = [];
            for (let i = 0; i <= 64; i++) {
                const ua = i / 64;
                edgeA.push(this._v3(ECC.sampleDomain(ua, 0, t)));
                edgeB.push(this._v3(ECC.sampleDomain(0, ua, t)));
                mid.push(this._v3(ECC.sampleDomain(ua, 0.5, t)));
            }
            this._setLinePoints(st.geoA, edgeA);
            this._setLinePoints(st.geoB, edgeB);
            this._setLinePoints(st.geoMid, mid);
        }
        this._syncGridOpacity();
    }

    animate() {
        if (this._disposed) return;
        const dt = this.clock.getDelta();
        if (this.vrManager && this.renderer.xr && this.renderer.xr.isPresenting) {
            this.vrManager.update();
        } else if (this.isRotating) {
            this.controls.theta += 0.0015;
            this.controls.update();
        }
        if (this.morphing) {
            this.morphElapsed += dt;
            const u = Math.min(1, this.morphElapsed / this.morphDuration);
            const s = u * u * (3 - 2 * u);
            this._applyMorphT(this.morphFrom + (this.morphTo - this.morphFrom) * s);
            if (u >= 1) {
                this.morphing = false;
                this.morphT = this.morphTo;
                if (this.morphTo >= 1 && this.morphFrom < 1) {
                    this._torusSubdiv = 0;
                    this._subdivFrom = 0;
                    this._subdivTo = 1;
                    this._torusSubdiving = true;
                    this._subdivElapsed = 0;
                }
                if (this.view === 'domain') this.rebuildView();
                else this.updatePanel();
            }
        }
        if (this._torusSubdiving && !this.morphing) {
            this._subdivElapsed += dt;
            const su = Math.min(1, this._subdivElapsed / this._subdivDuration);
            const s = su * su * (3 - 2 * su);
            this._torusSubdiv = this._subdivFrom + (this._subdivTo - this._subdivFrom) * s;
            this._applyTorusSubdiv();
            if (su >= 1) {
                this._torusSubdiving = false;
                this._torusSubdiv = this._subdivTo;
                if (this._pendingUnglue != null) {
                    const next = this._pendingUnglue;
                    this._pendingUnglue = null;
                    this.morphFrom = this.morphT;
                    this.morphTo = ECC.dimIndexToT(next);
                    this.dimIndex = next;
                    this.morphing = true;
                    this.morphElapsed = 0;
                    this.updatePanel();
                    this._syncVrMenu();
                }
            }
        }
        if (this.view === 'domain' && this.fieldPPlaying && !this._familyPDragging && this.groupOp && !this.morphing) {
            this._fieldPAnimAcc = (this._fieldPAnimAcc || 0) + dt;
            if (this._fieldPAnimAcc >= 0.42) {
                this._fieldPAnimAcc = 0;
                const pts = this._fieldOpPoints();
                if (pts.length) {
                    this.fieldPIndex = (this.fieldPIndex + 1) % pts.length;
                    this._redrawFieldGroupOp({ quiet: true });
                }
            }
        }
        if (this.view === 'family' && this.familyPPlaying && !this._familyPDragging && this.groupOp) {
            const r = this._familyPRange();
            this.familyPX += this.familyPDir * dt * 0.9;
            if (this.familyPX >= r.hi) {
                this.familyPX = r.hi;
                this.familyPDir = -1;
            } else if (this.familyPX <= r.lo) {
                this.familyPX = r.lo;
                this.familyPDir = 1;
            }
            this._familyPAnimAcc = (this._familyPAnimAcc || 0) + dt;
            if (this._familyPAnimAcc >= 1 / 30) {
                this._familyPAnimAcc = 0;
                this._redrawFamilyOp({ quiet: true });
            }
        }
        if (this._kgOverlay && this.scalarPlaying && this._scalarHops) {
            this.scalarTimer += dt;
            if (this.scalarTimer > 0.48) {
                this.scalarTimer = 0;
                this._pushScalarTrail(this.scalarK);
                this.scalarK += 1;
                if (this.scalarK > this._scalarHops.length) this.scalarK = 1;
                if (this._realKey && this.scalarK === this._realKey.toyR) this.scalarPlaying = false;
                this._updateScalarHighlight();
                this.updatePanel();
            }
        }
        this._applyDotZoom();
        if (!this.renderer.xr || !this.renderer.xr.isPresenting) {
            this.renderer.render(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    onWindowResize() {
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this._updateCameraProjection();
    }

    _updateCameraProjection() {
        if (!this.camera) return;
        const aspect = window.innerWidth / window.innerHeight;
        if (this.isPerspective && this.camera.isPerspectiveCamera) {
            this.camera.aspect = aspect;
            this.camera.updateProjectionMatrix();
            return;
        }
        if (!this.isPerspective && this.camera.isOrthographicCamera) {
            const z = this.orthographicZoom;
            this.camera.left = -z * aspect / 2;
            this.camera.right = z * aspect / 2;
            this.camera.top = z / 2;
            this.camera.bottom = -z / 2;
            this.camera.updateProjectionMatrix();
        }
    }

    _adoptCamera(cam) {
        this.camera = cam;
        if (this._shell) this._shell.camera = cam;
        if (this.vrManager) this.vrManager.camera = cam;
    }

    _setPerspectiveCamera(keepPose) {
        const aspect = window.innerWidth / window.innerHeight;
        const pos = keepPose && this.camera ? this.camera.position.clone() : null;
        const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
        if (pos) cam.position.copy(pos);
        this.isPerspective = true;
        this._adoptCamera(cam);
        if (this.controls) {
            cam.lookAt(this.controls.target);
            this.controls.update();
        }
        this._updateViewButton();
    }

    toggleCameraView() {
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
        const aspect = window.innerWidth / window.innerHeight;
        const pos = this.camera.position.clone();
        const target = this.controls ? this.controls.target.clone() : new THREE.Vector3();
        if (this.isPerspective) {
            this.orthographicZoom = Math.max(0.8, this.controls ? this.controls.distance * 0.95 : 12);
            const z = this.orthographicZoom;
            const cam = new THREE.OrthographicCamera(
                -z * aspect / 2, z * aspect / 2, z / 2, -z / 2, 0.1, 1000
            );
            cam.position.copy(pos);
            this.isPerspective = false;
            this._adoptCamera(cam);
        } else {
            const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
            cam.position.copy(pos);
            this.isPerspective = true;
            this._adoptCamera(cam);
        }
        if (this.controls) {
            this.controls.target.copy(target);
            this.camera.lookAt(this.controls.target);
            this.controls.update();
        }
        this._updateViewButton();
        this._applyDotZoom();
    }

    _updateViewButton() {
        const btn = document.getElementById('toggle-view');
        if (!btn) return;
        const icon = document.getElementById('toggle-view-icon');
        if (this.isPerspective) {
            if (icon) icon.src = 'imgs/icons/orthographic.svg';
            btn.title = 'Switch to orthographic';
            btn.setAttribute('aria-label', 'Orthographic view');
        } else {
            if (icon) icon.src = 'imgs/icons/perspective.svg';
            btn.title = 'Switch to perspective';
            btn.setAttribute('aria-label', 'Perspective view');
        }
    }

    _zoomBy(f) {
        this.controls.distance *= f;
        this.controls.distance = Math.max(0.6, Math.min(80, this.controls.distance));
        if (!this.isPerspective) {
            this.orthographicZoom *= f;
            this.orthographicZoom = Math.max(0.8, Math.min(80, this.orthographicZoom));
            this._updateCameraProjection();
        }
        this.controls.update();
        this._applyDotZoom();
    }

    resetCamera() {
        if (!this.controls) return;
        this.isRotating = false;
        if (typeof setRotationButtonState === 'function') setRotationButtonState(false);
        this.controls.target.set(0, 0, 0);
        this.controls.phi = Math.PI / 2;
        this.controls.theta = Math.PI / 2;
        this.controls.distance = this.view === 'family' ? 42 : 8;
        if (!this.isPerspective) {
            this.orthographicZoom = this.controls.distance * 0.95;
            this._updateCameraProjection();
        }
        this.controls.update();
        this._applyDotZoom();
    }

    panBy(dx, dy) {
        if (!this.controls || !this.camera) return;
        this.isRotating = false;
        if (typeof setRotationButtonState === 'function') setRotationButtonState(false);
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        right.crossVectors(fwd, this.camera.up).normalize();
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        up.copy(this.camera.up).normalize();
        const step = this.controls.distance * 0.06;
        this.controls.target.addScaledVector(right, dx * step);
        this.controls.target.addScaledVector(up, dy * step);
        this.controls.update();
    }

    rotateLeft() { this.isRotating = false; this.controls.theta -= 0.2; this.controls.update(); }
    rotateRight() { this.isRotating = false; this.controls.theta += 0.2; this.controls.update(); }
    rotateUp() {
        this.isRotating = false;
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    rotateDown() {
        this.isRotating = false;
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    zoomIn() { this._zoomBy(0.85); }
    zoomOut() { this._zoomBy(1.15); }
}

window.ExplorerPages = window.ExplorerPages || {};
window.ExplorerPages['curve.html'] = {
    panelTitle: 'Curve',
    panelDomId: 'crypto-info',
    create: function (opts) { return new BitcoinCryptoExplorer(opts); }
};
window.ExplorerPages['crypto.html'] = window.ExplorerPages['curve.html'];

document.addEventListener('DOMContentLoaded', () => {
    if (window.__softNav) return;
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        return;
    }
    window.__explorer = new BitcoinCryptoExplorer();
});
