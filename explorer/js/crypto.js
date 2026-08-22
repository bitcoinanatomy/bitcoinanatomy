// Bitcoin Explorer — secp256k1 curve lesson (family / domain / group / scalar)
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
        this.isRotating = true;
        this.isPerspective = true;
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
        this.primeIndex = 0;
        this.groupOp = 'add';
        this.scalarK = 1;
        this.scalarPlaying = false;
        this.scalarTimer = 0;
        this.selectedSliceZ = 0;
        this.familySliceCount = 45;
        this.hudOp = '—';
        this.useColor = false;
        this.showGrid = true;
        this.drawCap = (window.ECC && ECC.INSTANCE_CAP) || 1500;
        this._primeNextTimer = null;
        this._realKey = null;

        this._fieldCache = null;
        this._domainState = null;
        this._pointMeshes = [];
        this._zoomDots = [];
        this._lastDotZoom = -1;

        const params = new URLSearchParams(window.location.search);
        const v = (params.get('view') || '').toLowerCase();
        if (window.ECC && ECC.VIEWS.indexOf(v) >= 0) this.view = v;

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
        this.setupPanelToggle();
        this.setupExplainers();
        this.rebuildView();
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
        const dim = ECC.DIM_NAMES[this.dimIndex] || '';
        const prime = ECC.PRIME_LADDER[this.primeIndex];
        return {
            title: 'Curve',
            identity: this.view.charAt(0).toUpperCase() + this.view.slice(1),
            stats: [
                'Domain: ' + dim,
                'Field: ' + (prime ? prime.label : ''),
                this._curveTotalLabel(),
                this.view === 'family' || this.view === 'domain' || this.view === 'group' ? 'Op: ' + this.hudOp : (this.view === 'scalar' ? 'k = ' + this.scalarK : 'y² = x³ + 7')
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
            this.controls.distance *= (e.deltaY > 0 ? 1.08 : 0.92);
            this.controls.distance = Math.max(0.6, Math.min(80, this.controls.distance));
            this.controls.update();
            this._applyDotZoom();
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

    _growDrawCap() {
        const max = ECC.INSTANCE_CAP_MAX;
        if (this.drawCap >= max) return false;
        this.drawCap = Math.min(max, Math.max(this.drawCap, 1) * 2);
        return true;
    }

    addMorePoints() {
        if (!this._growDrawCap()) return;
        this._fieldCache = null;
        if (this.view === 'family') this.setView('domain');
        else this.rebuildView();
    }

    setupControls() {
        this._bind('view-family', () => this.setView('family'));
        this._bind('view-domain', () => this.setView('domain'));
        this._bind('view-group', () => this.setView('group'));
        this._bind('view-scalar', () => this.setView('scalar'));
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
        const views = ['family', 'domain', 'group', 'scalar'];
        views.forEach((v) => this._setPressed('view-' + v, view === v));

        const showGlueField = view === 'domain';
        const showOps = view === 'family' || view === 'domain' || view === 'group';
        const showPlay = view === 'scalar';
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
        const drawnRow = document.getElementById('crypto-drawn-row');
        if (sliceRow) sliceRow.hidden = view !== 'family';
        if (drawnRow) drawnRow.hidden = view === 'family';
        this._syncSliceSlider();
    }

    _setupSliceSlider() {
        const slider = document.getElementById('crypto-slice-slider');
        if (!slider) return;
        this._syncSliceSlider();
        let timer = null;
        const apply = () => {
            const n = parseInt(slider.value, 10);
            if (!Number.isFinite(n)) return;
            this.familySliceCount = n;
            this._syncSliceSlider();
            if (this.view === 'family' && n !== this._builtSliceCount) this.rebuildView();
        };
        slider.addEventListener('input', () => {
            const n = parseInt(slider.value, 10);
            if (Number.isFinite(n)) this.familySliceCount = n;
            this._syncSliceSlider();
            clearTimeout(timer);
            timer = setTimeout(apply, 40);
        }, { signal: this._ac.signal });
        slider.addEventListener('change', apply, { signal: this._ac.signal });
    }

    _syncSliceSlider() {
        const slider = document.getElementById('crypto-slice-slider');
        const valueEl = document.getElementById('crypto-slice-value');
        const rangeEl = document.getElementById('crypto-slice-range');
        const r = this._familyZRange();
        if (valueEl) valueEl.textContent = String(r.n);
        if (rangeEl) rangeEl.textContent = this._formatZRange(r);
        if (!slider) return;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const minV = Number.isFinite(min) ? min : 1;
        const maxV = Number.isFinite(max) ? max : 89;
        const pct = maxV === minV ? 100 : ((r.n - minV) / (maxV - minV)) * 100;
        slider.value = String(r.n);
        slider.style.setProperty('--slider-pct', pct + '%');
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

    setView(view) {
        if (ECC.VIEWS.indexOf(view) < 0) return;
        this.view = view;
        if (view === 'group' || view === 'scalar') {
            this.primeIndex = 0;
        }
        this._pushViewUrl();
        this.rebuildView();
        this._syncVrMenu();
    }

    stepDim(dir) {
        const next = Math.max(0, Math.min(ECC.DIM_STEPS - 1, this.dimIndex + dir));
        if (next === this.dimIndex) return;
        this.morphFrom = this.morphT;
        this.morphTo = ECC.dimIndexToT(next);
        this.dimIndex = next;
        this.morphing = true;
        this.morphElapsed = 0;
        if (this.view === 'family') this.setView('domain');
        else {
            this.updatePanel();
            this._syncVrMenu();
        }
    }

    stepPrime(dir) {
        if (this.view === 'group' || this.view === 'scalar') return;
        const next = Math.max(0, Math.min(ECC.PRIME_LADDER.length - 1, this.primeIndex + dir));
        let changed = next !== this.primeIndex;
        this.primeIndex = next;
        if (dir > 0) changed = this._growDrawCap() || changed;
        if (!changed) return;
        this._fieldCache = null;
        if (this.view === 'family') this.setView('domain');
        else {
            this.rebuildView();
            this._syncVrMenu();
        }
    }

    setGroupOp(op) {
        this.groupOp = this.groupOp === op ? null : op;
        this.rebuildView();
        if (this.vrManager && this.vrManager.navMenu && this.vrManager.navMenu._refreshAllToggles) {
            this.vrManager.navMenu._refreshAllToggles();
        }
    }

    toggleScalarPlay() {
        if (this.view !== 'scalar') this.setView('scalar');
        this.scalarPlaying = !this.scalarPlaying;
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

    async _seedToPriv(text) {
        const t = (text || '').trim();
        if (!t) throw new Error('Paste a key, seed, or phrase.');
        const compact = t.replace(/\s+/g, '');
        if (/^(0x)?[0-9a-f]{64}$/i.test(compact)) {
            return { priv: this._hexToBytes(compact.replace(/^0x/i, '')), source: 'hex k' };
        }
        if (/^(0x)?[0-9a-f]{128}$/i.test(compact)) {
            const seed = this._hexToBytes(compact.replace(/^0x/i, ''));
            const I = await this._hmacSha512(new TextEncoder().encode('Bitcoin seed'), seed);
            return { priv: I.slice(0, 32), source: 'BIP32 master' };
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
        return { priv: new Uint8Array(digest), source: 'SHA-256(text)' };
    }

    openSeedModal() {
        if (this.view !== 'scalar') this.setView('scalar');
        const modal = document.getElementById('seed-modal');
        const input = document.getElementById('seed-input');
        const err = document.getElementById('seed-modal-error');
        if (!modal) return;
        modal.hidden = false;
        modal.style.display = 'block';
        if (err) { err.hidden = true; err.textContent = ''; }
        if (input) input.focus();
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
                if (input) input.value = '0000000000000000000000000000000000000000000000000000000000000001';
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

    async loadSeed(text) {
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
            source: parsed.source
        };
        this.scalarPlaying = false;
        this.scalarK = r === 0 ? order : r;
        this.closeSeedModal();
        if (this.view !== 'scalar') this.setView('scalar');
        else this.rebuildView();
    }

    _pushViewUrl() {
        const url = 'crypto.html?view=' + this.view;
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
        else if (this.view === 'domain') this.buildDomain();
        else if (this.view === 'group') this.buildGroup();
        else this.buildScalar();
        this.updatePanel();
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
        this._drawFamilyGroupOp();
    }

    _addFamilyGrid() {
        if (!this.showGrid) return;
        const SC = this._familySC || 0.42;
        const col = new THREE.Color(this._tone('grid'));
        const xMin = -56, xMax = 56;
        const yMin = -80, yMax = 80;
        const step = 2;
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
            this.content.add(new THREE.Line(g, this._matLine(col, 1, { vertexColors: true })));
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
        this.content.add(new THREE.Line(g, this._matLine(color, 1, { vertexColors: true })));
    }

    _addFamilyPoint(pt, color, label) {
        const w = this._familyWorld(pt.x, pt.y);
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 14, 12),
            new THREE.MeshBasicMaterial({ color: color })
        );
        mesh.position.copy(w);
        mesh.userData = { isCurvePoint: true, label: label, x: pt.x, y: pt.y };
        this.content.add(mesh);
        this._trackZoomDot(mesh);
        const sprite = this._makeLabelSprite(label, color);
        sprite.position.set(w.x, w.y + 0.22, w.z);
        this.content.add(sprite);
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
        const ops = ECC.demoRealOps();
        const P = ops.P, Q = ops.Q;
        const op = this.groupOp;

        if (op === 'add') {
            const chord = this._extendThrough(P, ops.Rp, 140);
            this._addFamilyLine(chord.a, chord.b, this._tone('chord'));
            const refl = this._extendThrough(ops.Rp, ops.R, 120);
            this._addFamilyLine(refl.a, refl.b, this._tone('reflect'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(Q, this._tone('ptQ'), 'Q');
            this._addFamilyPoint(ops.Rp, this._tone('ptRp'), "R′");
            this._addFamilyPoint(ops.R, this._tone('ptR'), 'R');
            this.hudOp = 'R = P ⊕ Q on secp256k1 (z = 0)';
        } else if (op === 'double') {
            const t = { x: P.x + 1, y: P.y + ops.R2.lam };
            const chord = this._extendThrough(P, t, 140);
            this._addFamilyLine(chord.a, chord.b, this._tone('tangent'));
            const refl = this._extendThrough(ops.R2p, ops.R2, 120);
            this._addFamilyLine(refl.a, refl.b, this._tone('reflect'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(ops.R2p, this._tone('ptRp'), "R′");
            this._addFamilyPoint(ops.R2, this._tone('ptR'), '2P');
            this.hudOp = '2P = P ⊕ P on secp256k1 (z = 0)';
        } else if (op === 'inverse') {
            this._addFamilyLine({ x: P.x, y: 160 }, { x: P.x, y: -160 }, this._tone('chord'));
            this._addFamilyPoint(P, this._tone('white'), 'P');
            this._addFamilyPoint(ops.nP, this._tone('ptQ'), '−P');
            const inf = this._familyWorld(P.x, 160);
            const spr = this._makeLabelSprite('𝒪', 0xffffff);
            spr.position.set(inf.x, inf.y + 0.2, inf.z);
            this.content.add(spr);
            this.hudOp = 'P ⊕ (−P) = 𝒪 on secp256k1 (z = 0)';
        } else {
            const chord = this._extendThrough(P, ops.nQ, 140);
            this._addFamilyLine(chord.a, chord.b, this._tone('chord'));
            const refl = this._extendThrough(ops.Sp, ops.S, 120);
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

    _buildDomainSurface(group, t) {
        const nu = 40, nv = 20;
        const verts = [];
        const idx = [];
        let i, j, u, v, p, a, b, c, d;
        for (j = 0; j <= nv; j++) {
            for (i = 0; i <= nu; i++) {
                u = i / nu;
                v = j / nv;
                p = ECC.sampleDomain(u, v, t);
                verts.push(p.x, p.y, p.z);
            }
        }
        for (j = 0; j < nv; j++) {
            for (i = 0; i < nu; i++) {
                a = j * (nu + 1) + i;
                b = a + 1;
                c = a + (nu + 1);
                d = c + 1;
                idx.push(a, b, b, d, d, c, c, a);
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setIndex(idx);
        let mesh = null;
        if (this.showGrid) {
            mesh = new THREE.LineSegments(geom, this._matLine(this._tone('grid'), 0.45));
            group.add(mesh);
        }

        const edgeA = [];
        const edgeB = [];
        for (i = 0; i <= 64; i++) {
            const ua = i / 64;
            edgeA.push(this._v3(ECC.sampleDomain(ua, 0, t)));
            edgeB.push(this._v3(ECC.sampleDomain(0, ua, t)));
        }
        const geoA = new THREE.BufferGeometry().setFromPoints(edgeA);
        const geoB = new THREE.BufferGeometry().setFromPoints(edgeB);
        group.add(new THREE.Line(geoA, this._matLine(this._tone('edgeA'), 0.95)));
        group.add(new THREE.Line(geoB, this._matLine(this._tone('edgeB'), 0.95)));

        const mid = [];
        for (i = 0; i <= 64; i++) mid.push(this._v3(ECC.sampleDomain(i / 64, 0.5, t)));
        const geoMid = new THREE.BufferGeometry().setFromPoints(mid);
        group.add(new THREE.Line(geoMid, this._matLine(this._tone('mid'), 0.9)));

        return { geom: geom, nu: nu, nv: nv, mesh: mesh, geoA: geoA, geoB: geoB, geoMid: geoMid };
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
                p = ECC.sampleDomain(u, v, t);
                pos.setXYZ(n++, p.x, p.y, p.z);
            }
        }
        pos.needsUpdate = true;
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
        const t = this.morphT;
        const field = this._ensureField();
        const surf = this._buildDomainSurface(this.content, t);
        const r = field.exact ? (field.p <= 17 ? 0.028 : field.p <= 251 ? 0.014 : 0.007) : 0.0055;
        const inst = this._makeInstances(field.points.length, r);
        this.content.add(inst);
        this._placeInstances(inst, field.points, t, -1);
        this._domainState = {
            geom: surf.geom,
            nu: surf.nu,
            nv: surf.nv,
            instances: inst,
            points: field.points,
            geoA: surf.geoA,
            geoB: surf.geoB,
            geoMid: surf.geoMid
        };
        if (this.dimIndex === 0 && field.exact && field.p === 17) {
            this._addRealCurveOverlay(0.15);
        }
        this._drawFieldGroupOp();
    }

    _addRealCurveOverlay(opacity) {
        const sampled = ECC.sampleRealCurve(-2.2, 4.5, 160);
        const map = (pt) => {
            const u = (pt.x + 2.2) / 6.6;
            const v = (pt.y + 5) / 10;
            return this._v3(ECC.sampleDomain(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)), this.morphT));
        };
        const up = sampled.upper.map(map);
        const lo = sampled.lower.map(map);
        if (up.length > 1) {
            this.content.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(up),
                this._matLine(0xffffff, opacity)
            ));
        }
        if (lo.length > 1) {
            this.content.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(lo),
                this._matLine(0xffffff, opacity)
            ));
        }
    }

    _fieldOpP() {
        const field = this._ensureField();
        if (field && field.exact && field.p) return field.p;
        return 17;
    }

    _addLabeledPoint(pt, color, label, extra) {
        if (!pt || pt.inf) return null;
        const p = this._fieldOpP();
        const pos = ECC.sampleDomain(pt.x / p, pt.y / p, this.morphT);
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 14, 12),
            new THREE.MeshBasicMaterial({ color: color })
        );
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.userData = Object.assign({ isCurvePoint: true, label: label, x: pt.x, y: pt.y }, extra || {});
        this.content.add(mesh);
        this._trackZoomDot(mesh);
        const sprite = this._makeLabelSprite(label, color);
        sprite.position.set(pos.x, pos.y + 0.16, pos.z);
        this.content.add(sprite);
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

    _addWrappedChord(P, Q, color) {
        if (!P || !Q || P.inf || Q.inf) return;
        const p = this._fieldOpP();
        const extend = 2;
        const dx = Q.x - P.x;
        const dy = Q.y - P.y;
        if (dx === 0 && dy === 0) return;
        const x0 = P.x - dx * extend;
        const y0 = P.y - dy * extend;
        const x1 = Q.x + dx * extend;
        const y1 = Q.y + dy * extend;
        const steps = 192;
        const col = new THREE.Color(color);
        let pts = [];
        let rgb = [];
        let prevU = null;
        let prevV = null;
        const flush = () => {
            if (pts.length < 2) {
                pts = [];
                rgb = [];
                return;
            }
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
            this.content.add(new THREE.Line(g, this._matLine(0xffffff, 1, { vertexColors: true })));
            pts = [];
            rgb = [];
        };
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;
            const u = ECC.mod(x, p) / p;
            const v = ECC.mod(y, p) / p;
            if (prevU != null && (Math.abs(u - prevU) > 0.45 || Math.abs(v - prevV) > 0.45)) flush();
            const edge = Math.min(t, 1 - t) * 2;
            const along = Math.pow(Math.min(1, edge / 0.38), 1.85);
            pts.push(this._v3(ECC.sampleDomain(u, v, this.morphT)));
            rgb.push(col.r * along, col.g * along, col.b * along);
            prevU = u;
            prevV = v;
        }
        flush();
    }

    _addVerticalToInfinity(P) {
        if (!P || P.inf) return;
        const p = this._fieldOpP();
        const nP = ECC.negPt(P, p);
        this._addWrappedChord(P, nP, this._tone('chord'));
        const top = ECC.sampleDomain(P.x / p, 0.98, this.morphT);
        const spr = this._makeLabelSprite('𝒪', 0xffffff);
        spr.position.set(top.x, top.y + 0.2, top.z);
        this.content.add(spr);
        this.hudOp = 'P ⊕ (−P) = 𝒪';
    }

    buildGroup() {
        this.primeIndex = 0;
        this._fieldCache = null;
        const field = this._ensureField();
        const surf = this._buildDomainSurface(this.content, this.morphT);
        const inst = this._makeInstances(field.points.length, 0.02);
        this.content.add(inst);
        this._placeInstances(inst, field.points, this.morphT, -1);
        this._domainState = {
            geom: surf.geom, nu: surf.nu, nv: surf.nv,
            instances: inst, points: field.points,
            geoA: surf.geoA, geoB: surf.geoB, geoMid: surf.geoMid
        };

        this._drawFieldGroupOp();
    }

    _drawFieldGroupOp() {
        if (!this.groupOp) {
            this.hudOp = '—';
            return;
        }
        const field = this._ensureField();
        if (!field.exact || !field.p) {
            this.hudOp = '—';
            return;
        }
        const p = field.p;
        const demo = ECC.demoAddPair(p);
        const P = demo.P;
        const Q = demo.Q;
        let R, Rp, nQ;

        if (this.groupOp === 'add') {
            R = demo.R;
            Rp = demo.Rp;
            this._addWrappedChord(P, Q, this._tone('chord'));
            if (!R.inf && !Rp.inf) this._addWrappedChord(Rp, R, this._tone('reflect'));
            this._addLabeledPoint(P, this._tone('white'), 'P');
            this._addLabeledPoint(Q, this._tone('ptQ'), 'Q');
            if (!Rp.inf) this._addLabeledPoint(Rp, this._tone('ptRp'), "R′");
            if (!R.inf) this._addLabeledPoint(R, this._tone('ptR'), 'R');
            this.hudOp = R.inf ? 'P ⊕ Q = 𝒪' : 'R = P ⊕ Q  (wraps on this domain)';
        } else if (this.groupOp === 'double') {
            R = ECC.sumDoubleFp(P, p);
            Rp = R.inf ? ECC.INF : { x: R.x, y: ECC.mod(-R.y, p) };
            const Q2 = { x: ECC.mod(P.x + 1, p), y: P.y };
            this._addWrappedChord(P, R.inf ? Q2 : Rp, this._tone('tangent'));
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
            this._addWrappedChord(P, nQ, this._tone('chord'));
            if (!R.inf && !Rp.inf) this._addWrappedChord(Rp, R, this._tone('reflect'));
            this._addLabeledPoint(P, this._tone('white'), 'P');
            this._addLabeledPoint(Q, this._tone('muted'), 'Q');
            this._addLabeledPoint(nQ, this._tone('ptQ'), '−Q');
            if (!R.inf) this._addLabeledPoint(R, this._tone('ptR'), 'P−Q');
            this.hudOp = R.inf ? 'P − Q = 𝒪' : 'P − Q = P ⊕ (−Q)  (wraps on this domain)';
        }
    }

    buildScalar() {
        this.primeIndex = 0;
        this.dimIndex = 4;
        this.morphT = 1;
        this._fieldCache = null;
        const field = this._ensureField();
        const surf = this._buildDomainSurface(this.content, 1);
        const inst = this._makeInstances(field.points.length, 0.02);
        this.content.add(inst);
        this._placeInstances(inst, field.points, 1, -1);
        this._domainState = {
            geom: surf.geom, nu: surf.nu, nv: surf.nv,
            instances: inst, points: field.points,
            geoA: surf.geoA, geoB: surf.geoB, geoMid: surf.geoMid
        };

        const G = ECC.F17.G;
        const order = ECC.F17.order;
        const hops = ECC.multiplesOf(G, 17, order);
        this._scalarHops = hops;
        hops.forEach((h) => {
            if (h.inf) return;
            const p = ECC.sampleDomain(h.x / 17, h.y / 17, 1);
            const m = new THREE.Mesh(
                new THREE.SphereGeometry(0.024, 10, 8),
                new THREE.MeshBasicMaterial({ color: this._tone('hop') })
            );
            m.position.set(p.x, p.y, p.z);
            this.content.add(m);
            this._trackZoomDot(m);
        });
        this._scalarHighlight = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 14, 12),
            new THREE.MeshBasicMaterial({ color: this._tone('hopActive') })
        );
        this._trackZoomDot(this._scalarHighlight);
        this.content.add(this._scalarHighlight);
        this._scalarLabel = this._makeLabelSprite('G', this._tone('hopActive'));
        this.content.add(this._scalarLabel);
        this._updateScalarHighlight();
        this.hudOp = 'kG on 𝔽₁₇  (order ' + order + ')';
    }

    _updateScalarHighlight() {
        if (!this._scalarHops || !this._scalarHighlight) return;
        const hops = this._scalarHops;
        if (this.scalarK > hops.length) this.scalarK = 1;
        const h = hops[this.scalarK - 1];
        if (!h || h.inf) {
            this._scalarHighlight.visible = false;
            this._scalarLabel.position.set(0, 2.2, 0);
            const canvas = this._scalarLabel.material.map.image;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '28px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('𝒪', 64, 32);
            this._scalarLabel.material.map.needsUpdate = true;
            this.hudOp = this.scalarK + 'G = 𝒪';
            return;
        }
        this._scalarHighlight.visible = true;
        const p = ECC.sampleDomain(h.x / 17, h.y / 17, this.morphT);
        this._scalarHighlight.position.set(p.x, p.y, p.z);
        this._scalarLabel.position.set(p.x, p.y + 0.18, p.z);
        const canvas = this._scalarLabel.material.map.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.scalarK === 1 ? 'G' : (this.scalarK + 'G'), 64, 32);
        this._scalarLabel.material.map.needsUpdate = true;
        this.hudOp = this.scalarK + 'G';
    }

    _pointCountLabel() {
        if (this.view === 'family') {
            const r = this._familyZRange();
            return r.n + (r.n === 1 ? ' curve ' : ' curves ') + this._formatZRange(r);
        }
        const field = this._ensureField();
        return field.count + (field.exact ? '' : ' schematic');
    }

    _curveTotalLabel() {
        if (this.view === 'family') return 'ℝ curves, not 𝔽_p';
        const field = this._ensureField();
        const bits = field.bits || (ECC.PRIME_LADDER[this.primeIndex] && ECC.PRIME_LADDER[this.primeIndex].bits);
        if (field.exact && field.total != null) {
            const extra = field.total > field.count ? ' (capped draw)' : '';
            return field.total + extra;
        }
        return '~' + ECC.formatPow2(bits);
    }

    updatePanel() {
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        const names = { family: 'Family', domain: 'Domain', group: 'Group', scalar: 'Scalar' };
        const entry = ECC.PRIME_LADDER[this.primeIndex];
        const scale = ECC.fieldScale(entry);
        set('crypto-view-label', names[this.view] || this.view);
        set('crypto-dim-label', ECC.DIM_NAMES[this.dimIndex]);
        set('crypto-prime-label', (entry.bits ? entry.bits + '-bit ' : '') + entry.label);
        set('crypto-point-count', this._pointCountLabel());
        set('crypto-curve-total', this._curveTotalLabel());
        set('crypto-entropy', scale.entropy);
        set('crypto-search', scale.search);
        set('crypto-atoms', scale.atoms);
        set('crypto-op-label', this.hudOp);
        const key = this._realKey;
        const kRow = document.getElementById('crypto-k-row');
        const qRow = document.getElementById('crypto-q-row');
        if (kRow) kRow.hidden = !key;
        if (qRow) qRow.hidden = !key;
        if (key) {
            set('crypto-k-label', this._shortHex(key.kHex, 8, 8) + '  (' + key.source + ')');
            set('crypto-q-label', this._shortHex(key.pubHex, 8, 8));
            const kEl = document.getElementById('crypto-k-label');
            const qEl = document.getElementById('crypto-q-label');
            if (kEl) kEl.setAttribute('title', key.kHex);
            if (qEl) qEl.setAttribute('title', key.pubHex);
        }
        set('crypto-subtitle', 'y² = x³ + 7  ·  ' + names[this.view]);
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
                if (this.view === 'group' || this.view === 'domain') this.rebuildView();
                else this.updatePanel();
            }
        }
        if (this.view === 'scalar' && this.scalarPlaying && this._scalarHops) {
            this.scalarTimer += dt;
            if (this.scalarTimer > 0.55) {
                this.scalarTimer = 0;
                this.scalarK += 1;
                if (this.scalarK > this._scalarHops.length) this.scalarK = 1;
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
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    resetCamera() {
        if (!this.controls) return;
        this.isRotating = false;
        if (typeof setRotationButtonState === 'function') setRotationButtonState(false);
        this.controls.target.set(0, 0, 0);
        this.controls.phi = Math.PI / 2;
        this.controls.theta = Math.PI / 2;
        this.controls.distance = this.view === 'family' ? 42 : 8;
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
    zoomIn() { this.controls.distance *= 0.85; this.controls.distance = Math.max(0.6, this.controls.distance); this.controls.update(); this._applyDotZoom(); }
    zoomOut() { this.controls.distance *= 1.15; this.controls.distance = Math.min(80, this.controls.distance); this.controls.update(); this._applyDotZoom(); }
}

window.ExplorerPages = window.ExplorerPages || {};
window.ExplorerPages['crypto.html'] = {
    panelTitle: 'Curve',
    panelDomId: 'crypto-info',
    create: function (opts) { return new BitcoinCryptoExplorer(opts); }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.__softNav) return;
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        return;
    }
    window.__explorer = new BitcoinCryptoExplorer();
});
