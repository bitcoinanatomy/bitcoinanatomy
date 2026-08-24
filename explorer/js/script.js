// Bitcoin Explorer — Script stack lesson
// Placeholder keys kA=1, kB=2, kC=3 (secp256k1). Pubkeys are n·G. CHECKSIG is pedagogical.

const DEMO = {
    kA: '0000000000000000000000000000000000000000000000000000000000000001',
    kB: '0000000000000000000000000000000000000000000000000000000000000002',
    kC: '0000000000000000000000000000000000000000000000000000000000000003',
    pubA: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    pubB: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
    pubC: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
    h160A: '751e76e8199196d454941c45d1b3a323f1433bd6',
    h160B: '06afd46bcdfd22ef94ac122aa11f241244a37ecc',
    h160C: '7dd65592d0ab2fe0d0257d571abf032cd9db93dc',
    redeem: '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac',
    redeemH160: 'cd7b44d0b03f2d026d1e586d7ae18903b0d385f6',
    ms: '52210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817982102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee52102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f953ae',
    msSha256: '12c2ffbc6ec1cf5d746dfbd49b1063356212ea55f43023ffc0145934af20c572',
    sigA: '30450220584eaaa1de4190e2fd8d148f6129c640f13a83429d2136373cf207e7738eaf4e0221009fdf2cf5feb9243d3f7b735c0aaebcbf1dc4d0e331f48abfdbc97dab62ac8db901',
    sigC: '304502210084ba003d1862d62a012ab5a2312b797594748696d47aac141b2afdf66559bcf40220685d95b7ed4551f8ca6d76e2fa54a2dd574ec394dc4a8e8678d97a8f9f79264201',
    schnorr: '787a848e71043d280c50470e8e1532b2dd5d20ee912a45dbdd2bd1dfbf187d8606980f5cbea4c1473b313a444f9e9e5ad102f56a9391cf337a33cf46a4a9a79d',
    q: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    opreturn: '616e61746f6d792d6f662d626974636f696e2d7363726970742d64656d6f',
    trueHex: '01'
};

DEMO.HASH160 = {};
DEMO.HASH160[DEMO.pubA] = DEMO.h160A;
DEMO.HASH160[DEMO.pubB] = DEMO.h160B;
DEMO.HASH160[DEMO.pubC] = DEMO.h160C;
DEMO.HASH160[DEMO.redeem] = DEMO.redeemH160;
DEMO.SHA256 = {};
DEMO.SHA256[DEMO.ms] = DEMO.msSha256;

function truncHex(h) {
    if (!h) return '';
    const s = String(h).toLowerCase();
    if (s.length <= 18) return s;
    return s.slice(0, 8) + '…' + s.slice(-8);
}

const SCRIPT_TYPES = {
    p2pk: {
        name: 'P2PK',
        subtitle: 'Pay to public key',
        note: 'Placeholder kA = …0001. Locking script holds compressed 1·G. Unlocking script is a DER signature over SHA256("anatomy-of-bitcoin-script-demo"). CHECKSIG is pedagogical.',
        tokens: [
            { phase: 'unlock', kind: 'push', role: 'SIG', hex: DEMO.sigA },
            { phase: 'lock', kind: 'push', role: 'PUBKEY', hex: DEMO.pubA },
            { phase: 'lock', kind: 'op', name: 'OP_CHECKSIG' }
        ]
    },
    p2pkh: {
        name: 'P2PKH',
        subtitle: 'Pay to public key hash',
        note: 'kA = …0001. HASH160(compressed 1·G) = 751e76e8…1433bd6. DUP, HASH160, EQUALVERIFY, CHECKSIG.',
        tokens: [
            { phase: 'unlock', kind: 'push', role: 'SIG', hex: DEMO.sigA },
            { phase: 'unlock', kind: 'push', role: 'PUBKEY', hex: DEMO.pubA },
            { phase: 'lock', kind: 'op', name: 'OP_DUP' },
            { phase: 'lock', kind: 'op', name: 'OP_HASH160' },
            { phase: 'lock', kind: 'push', role: 'HASH160', hex: DEMO.h160A },
            { phase: 'lock', kind: 'op', name: 'OP_EQUALVERIFY' },
            { phase: 'lock', kind: 'op', name: 'OP_CHECKSIG' }
        ]
    },
    p2ms: {
        name: 'P2MS',
        subtitle: '2-of-3 multisig',
        note: '2-of-3 with kA,kB,kC = 1,2,3. Dummy OP_0 accounts for the CHECKMULTISIG extra pop. Signatures A and C follow pubkey order.',
        tokens: [
            { phase: 'unlock', kind: 'op', name: 'OP_0' },
            { phase: 'unlock', kind: 'push', role: 'SIG A', hex: DEMO.sigA },
            { phase: 'unlock', kind: 'push', role: 'SIG C', hex: DEMO.sigC },
            { phase: 'lock', kind: 'op', name: 'OP_2' },
            { phase: 'lock', kind: 'push', role: 'PK A', hex: DEMO.pubA },
            { phase: 'lock', kind: 'push', role: 'PK B', hex: DEMO.pubB },
            { phase: 'lock', kind: 'push', role: 'PK C', hex: DEMO.pubC },
            { phase: 'lock', kind: 'op', name: 'OP_3' },
            { phase: 'lock', kind: 'op', name: 'OP_CHECKMULTISIG' }
        ]
    },
    p2sh: {
        name: 'P2SH',
        subtitle: 'Pay to script hash',
        note: 'Redeem script is P2PKH for kA. Script hash HASH160(76a914…88ac). After EQUALVERIFY the inner P2PKH runs.',
        tokens: [
            { phase: 'unlock', kind: 'push', role: 'SIG', hex: DEMO.sigA },
            { phase: 'unlock', kind: 'push', role: 'PUBKEY', hex: DEMO.pubA },
            { phase: 'unlock', kind: 'push', role: 'REDEEM', hex: DEMO.redeem },
            { phase: 'lock', kind: 'op', name: 'OP_HASH160' },
            { phase: 'lock', kind: 'push', role: 'SCRIPT HASH', hex: DEMO.redeemH160 },
            { phase: 'lock', kind: 'op', name: 'OP_EQUALVERIFY' },
            { phase: 'inner', kind: 'op', name: 'OP_DUP' },
            { phase: 'inner', kind: 'op', name: 'OP_HASH160' },
            { phase: 'inner', kind: 'push', role: 'HASH160', hex: DEMO.h160A },
            { phase: 'inner', kind: 'op', name: 'OP_EQUALVERIFY' },
            { phase: 'inner', kind: 'op', name: 'OP_CHECKSIG' }
        ]
    },
    p2wpkh: {
        name: 'P2WPKH',
        subtitle: 'SegWit v0 pay to public key hash',
        note: 'SegWit v0: SIG and PUBKEY in the witness. ScriptPubKey is OP_0 + HASH160(1·G). Implied script is P2PKH.',
        tokens: [
            { phase: 'witness', kind: 'push', role: 'SIG', hex: DEMO.sigA },
            { phase: 'witness', kind: 'push', role: 'PUBKEY', hex: DEMO.pubA },
            { phase: 'implied', kind: 'op', name: 'OP_DUP' },
            { phase: 'implied', kind: 'op', name: 'OP_HASH160' },
            { phase: 'implied', kind: 'push', role: 'HASH160', hex: DEMO.h160A },
            { phase: 'implied', kind: 'op', name: 'OP_EQUALVERIFY' },
            { phase: 'implied', kind: 'op', name: 'OP_CHECKSIG' }
        ]
    },
    p2wsh: {
        name: 'P2WSH',
        subtitle: 'SegWit v0 pay to script hash',
        note: 'Witness: dummy, SIG A, SIG C, 2-of-3 script. SHA256(script) = 12c2ffbc…af20c572. Inner CHECKMULTISIG after the hash check.',
        tokens: [
            { phase: 'witness', kind: 'op', name: 'OP_0' },
            { phase: 'witness', kind: 'push', role: 'SIG A', hex: DEMO.sigA },
            { phase: 'witness', kind: 'push', role: 'SIG C', hex: DEMO.sigC },
            { phase: 'witness', kind: 'push', role: 'WITSCRIPT', hex: DEMO.ms },
            { phase: 'lock', kind: 'op', name: 'OP_DUP' },
            { phase: 'lock', kind: 'op', name: 'OP_SHA256' },
            { phase: 'lock', kind: 'push', role: 'SHA256', hex: DEMO.msSha256 },
            { phase: 'lock', kind: 'op', name: 'OP_EQUALVERIFY' },
            { phase: 'lock', kind: 'op', name: 'OP_DROP' },
            { phase: 'inner', kind: 'op', name: 'OP_2' },
            { phase: 'inner', kind: 'push', role: 'PK A', hex: DEMO.pubA },
            { phase: 'inner', kind: 'push', role: 'PK B', hex: DEMO.pubB },
            { phase: 'inner', kind: 'push', role: 'PK C', hex: DEMO.pubC },
            { phase: 'inner', kind: 'op', name: 'OP_3' },
            { phase: 'inner', kind: 'op', name: 'OP_CHECKMULTISIG' }
        ]
    },
    p2tr: {
        name: 'P2TR',
        subtitle: 'Taproot key-path spend',
        note: 'Key-path: BIP-340 Schnorr (key 1, empty-message test vector) and x-only 1·G as Q (untweaked demo). CHECKSIG is pedagogical.',
        tokens: [
            { phase: 'witness', kind: 'push', role: 'SCHNORR', hex: DEMO.schnorr },
            { phase: 'lock', kind: 'push', role: 'Q', hex: DEMO.q },
            { phase: 'implied', kind: 'op', name: 'OP_CHECKSIG' }
        ]
    },
    opreturn: {
        name: 'OP_RETURN',
        subtitle: 'Unspendable data output',
        note: 'OP_RETURN fails immediately. Data is ASCII “anatomy-of-bitcoin-script-demo” (never executed).',
        tokens: [
            { phase: 'lock', kind: 'op', name: 'OP_RETURN' },
            { phase: 'lock', kind: 'push', role: 'DATA', hex: DEMO.opreturn }
        ]
    }
};

class BitcoinScriptExplorer {
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
        this.clock = new THREE.Clock();
        this.content = null;
        this.stackGroup = null;
        this.plates = new Map();
        this._id = 1;
        this._emptyMesh = null;

        this.typeId = 'p2pkh';
        this.pc = 0;
        this.stack = [];
        this.failed = false;
        this.done = false;
        this.playing = false;
        this.playTimer = 0;
        this.playInterval = 1.15;
        this.lastOp = '—';
        this.busyUntil = 0;
        this.actionQueue = [];
        this._crush = null;

        const params = new URLSearchParams(window.location.search);
        const t = (params.get('type') || '').toLowerCase();
        if (SCRIPT_TYPES[t]) this.typeId = t;

        this.init();
    }

    init() {
        this.setupThreeJS();
        if (this._shell && this._shell.vrManager) {
            this.vrManager = this._shell.vrManager;
        } else if (typeof VRManager !== 'undefined') {
            this.vrManager = new VRManager(this, { panelTitle: 'Script', panelDomId: 'script-info' });
            this.vrManager.init();
        }
        this.setupOrbitControls();
        this.setupControls();
        this.setupPanelToggle();
        this._buildStage();
        this.reset();
        this.renderer.setAnimationLoop(() => this.animate());
    }

    isVRSelectable() { return false; }
    onVRSelect() {}

    getVRPageHud() {
        const t = SCRIPT_TYPES[this.typeId];
        return {
            title: 'Script',
            identity: t.name,
            stats: [
                'Op: ' + this.lastOp,
                'Stack: ' + this.stack.length,
                'Result: ' + this._resultText()
            ]
        };
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._ac.abort();
        this._disposeStage();
    }

    _disposeObj(obj) {
        if (!obj) return;
        obj.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            }
        });
        if (obj.parent) obj.parent.remove(obj);
    }

    _disposeStage() {
        this.plates.forEach((p) => this._disposeObj(p.group));
        this.plates.clear();
        this._disposeObj(this.content);
        this.content = null;
        this.stackGroup = null;
        this._emptyMesh = null;
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
            this.camera.position.set(0, 6.5, 17);
            this.camera.lookAt(0, 3.8, 0);
            this._applyPixelRatio();
            window.addEventListener('resize', () => this.onWindowResize(), { signal });
            return;
        }
        const container = document.getElementById('scene');
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 6.5, 17);
        this.camera.lookAt(0, 3.8, 0);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this._applyPixelRatio();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);
        window.addEventListener('resize', () => this.onWindowResize(), { signal });
    }

    _applyPixelRatio() {
        if (!this.renderer) return;
        const cap = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.setPixelRatio(cap);
    }

    setupOrbitControls() {
        this.controls = {
            target: new THREE.Vector3(0, 3.8, 0),
            distance: 18,
            phi: 1.22,
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
            if (typeof setRotationButtonState === 'function') setRotationButtonState(false);
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
            this.controls.distance = Math.max(5, Math.min(40, this.controls.distance));
            this.controls.update();
        }, { signal, passive: false });
    }

    _bind(id, fn) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', fn, { signal: this._ac.signal });
    }

    setupControls() {
        this._bind('type-p2pk', () => this.selectType('p2pk'));
        this._bind('type-p2pkh', () => this.selectType('p2pkh'));
        this._bind('type-p2ms', () => this.selectType('p2ms'));
        this._bind('type-p2sh', () => this.selectType('p2sh'));
        this._bind('type-p2wpkh', () => this.selectType('p2wpkh'));
        this._bind('type-p2wsh', () => this.selectType('p2wsh'));
        this._bind('type-p2tr', () => this.selectType('p2tr'));
        this._bind('type-opreturn', () => this.selectType('opreturn'));
        this._bind('script-reset', () => this.reset());
        this._bind('script-step', () => this.step());
        this._bind('script-play', () => this.togglePlay());
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
        this._syncTypeButtons();
        if (typeof setRotationButtonState === 'function') setRotationButtonState(this.isRotating);
    }

    _syncTypeButtons() {
        const ids = {
            p2pk: 'type-p2pk',
            p2pkh: 'type-p2pkh',
            p2ms: 'type-p2ms',
            p2sh: 'type-p2sh',
            p2wpkh: 'type-p2wpkh',
            p2wsh: 'type-p2wsh',
            p2tr: 'type-p2tr',
            opreturn: 'type-opreturn'
        };
        Object.keys(ids).forEach((id) => {
            const el = document.getElementById(ids[id]);
            if (!el) return;
            el.setAttribute('aria-pressed', id === this.typeId ? 'true' : 'false');
            el.classList.toggle('active', id === this.typeId);
        });
    }

    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('script-info');
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

    _wireBox(w, h, d, fillOp, edgeOp, edgeCol) {
        const g = new THREE.Group();
        const geo = new THREE.BoxGeometry(w, h, d);
        const fill = new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: fillOp,
                depthWrite: false
            })
        );
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({
                color: edgeCol == null ? 0xcccccc : edgeCol,
                transparent: true,
                opacity: edgeOp == null ? 0.85 : edgeOp
            })
        );
        g.add(fill);
        g.add(edges);
        g.userData.fill = fill;
        g.userData.edges = edges;
        g.userData.fillOp = fillOp;
        g.userData.edgeOp = edgeOp == null ? 0.85 : edgeOp;
        return g;
    }

    _labelCanvasSize() {
        return { w: 2048, h: 512 };
    }

    _labelWorldSize(scaleX) {
        const { w, h } = this._labelCanvasSize();
        return { x: scaleX, y: scaleX * (h / w) };
    }

    _labelTex(role, hex, highlight) {
        const { w: W, h: H } = this._labelCanvasSize();
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const hasHex = !!(hex && String(hex).length);
        const roleSize = hasHex ? 110 : 128;
        ctx.font = 'bold ' + roleSize + 'px Arial, Helvetica, sans-serif';
        ctx.fillStyle = highlight ? '#ffffff' : '#ececec';
        ctx.fillText(role || '', W / 2, hasHex ? Math.round(H * 0.38) : Math.round(H * 0.5));
        if (hasHex) {
            ctx.font = '600 56px Courier New, Courier, monospace';
            ctx.fillStyle = highlight ? '#d0d0d0' : '#a8a8a8';
            ctx.fillText(truncHex(hex), W / 2, Math.round(H * 0.7));
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = this.renderer && this.renderer.capabilities
            ? this.renderer.capabilities.getMaxAnisotropy()
            : 8;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
    }

    _labelSprite(role, hex, highlight, scaleX) {
        const tex = this._labelTex(role, hex, highlight);
        const size = this._labelWorldSize(scaleX);
        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            sizeAttenuation: true
        });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(size.x, size.y, 1);
        return spr;
    }

    _slotY(i) {
        return 0.45 + i * 0.95;
    }

    _buildStage() {
        this.content = new THREE.Group();
        this.scene.add(this.content);
        const amb = new THREE.AmbientLight(0xffffff, 0.45);
        this.content.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 0.5);
        dir.position.set(4, 10, 6);
        this.content.add(dir);

        const binW = 5.5, binH = 8.8, binD = 2.4;
        const binBottom = -0.2;
        const bin = this._wireBox(binW, binH, binD, 0.035);
        bin.position.set(0, binBottom + binH / 2, 0);
        this.content.add(bin);
        this._binTop = binBottom + binH;

        const title = this._labelSprite('STACK', '', false, 2.4);
        title.position.set(0, binBottom - 0.55, binD * 0.15);
        this.content.add(title);

        this.stackGroup = new THREE.Group();
        this.content.add(this.stackGroup);

        this._emptyMesh = this._labelSprite('(empty)', '', false, 2.8);
        this._emptyMesh.material.opacity = 0.7;
        this._emptyMesh.position.set(0, 1.15, 0.2);
        this.content.add(this._emptyMesh);
    }

    _makePlate(item, index, spawn) {
        const group = new THREE.Group();
        const fillOp = item.isOp ? 0.28 : 0.022;
        const edgeOp = item.isOp ? 1 : 0.42;
        const edgeCol = item.isOp ? 0xffffff : 0x777777;
        const box = this._wireBox(4.7, 0.62, 1.85, fillOp, edgeOp, edgeCol);
        group.add(box);
        const face = this._labelSprite(
            item.role,
            item.hex,
            index === this.stack.length - 1,
            3.6
        );
        face.position.set(0, 0.04, 1.05);
        group.add(face);
        const y = this._slotY(index);
        if (spawn) {
            group.position.set(0, Math.max(y + 1.7, (this._binTop || 6) + 0.6), 0);
            group.scale.setScalar(0.28);
        } else {
            group.position.set(0, y, 0);
            group.scale.setScalar(1);
        }
        this.stackGroup.add(group);
        const plate = {
            id: item.id,
            group: group,
            face: face,
            box: box,
            fillOp: fillOp,
            edgeOp: edgeOp,
            targetX: 0,
            targetY: y,
            targetScale: 1,
            dying: false,
            dieMode: 'slide',
            dieT: 0,
            pulse: 0,
            swapped: false
        };
        this.plates.set(item.id, plate);
        this._markBusy(0.5);
        return plate;
    }

    _updatePlateFace(plate, item, highlight) {
        const old = plate.face.material.map;
        const tex = this._labelTex(item.role, item.hex, highlight);
        plate.face.material.map = tex;
        plate.face.material.needsUpdate = true;
        if (old) old.dispose();
    }

    _beginDie(plate, mode, dir) {
        plate.dying = true;
        plate.dieMode = mode || 'slide';
        plate.dieT = 0;
        plate.pulse = 0;
        const y = plate.group.position.y;
        if (plate.dieMode === 'sink') {
            plate.targetX = 0;
            plate.targetY = y - 0.55;
            plate.targetScale = 0.18;
        } else if (plate.dieMode === 'drop') {
            plate.targetX = plate.group.position.x;
            plate.targetY = y;
            plate.targetScale = 1;
        } else if (plate.dieMode === 'merge') {
            plate.targetX = 0;
            plate.targetY = y;
            plate.targetScale = 0.04;
        } else if (plate.dieMode === 'apart') {
            plate.targetX = (dir || 1) * 5.4;
            plate.targetY = y + 0.15;
            plate.targetScale = 0.4;
        } else {
            plate.targetX = (dir || 1) * 6.4;
            plate.targetY = y + 0.25;
            plate.targetScale = 0.35;
        }
        this._markBusy(0.6);
    }

    _nudge(item, x, y) {
        if (!item) return;
        const plate = this.plates.get(item.id);
        if (!plate || plate.dying) return;
        if (x != null) plate.targetX = x;
        if (y != null) plate.targetY = y;
        this._markBusy(0.45);
    }

    _pulse(item) {
        if (!item) return;
        const plate = this.plates.get(item.id);
        if (plate) plate.pulse = 0.001;
    }

    _removeFromStack(item, mode, dir) {
        if (!item) return null;
        const i = this.stack.indexOf(item);
        if (i >= 0) this.stack.splice(i, 1);
        const plate = this.plates.get(item.id);
        if (plate) this._beginDie(plate, mode, dir);
        return item;
    }

    _popItem(mode, dir) {
        const item = this.stack.pop();
        if (!item) return null;
        const plate = this.plates.get(item.id);
        if (plate) this._beginDie(plate, mode, dir);
        return item;
    }

    _pushItem(role, hex, opts) {
        opts = opts || {};
        const item = {
            id: this._id++,
            role: role,
            hex: String(hex || '').toLowerCase(),
            isOp: !!opts.isOp
        };
        this.stack.push(item);
        this._makePlate(item, this.stack.length - 1, true);
        this._relayout();
        this.updatePanel();
        return item;
    }

    _queueAction(fn, wait) {
        this.actionQueue.push({ fn: fn, wait: wait == null ? 0.55 : wait });
        this._markBusy((wait == null ? 0.55 : wait) + 0.05);
    }

    _transformTop(role, hex, punch) {
        const item = this.stack[this.stack.length - 1];
        if (!item) return;
        item.role = role;
        item.hex = String(hex || '').toLowerCase();
        const plate = this.plates.get(item.id);
        if (plate) {
            this._updatePlateFace(plate, item, true);
            plate.pulse = 0.001;
            plate.pulseAmp = punch ? 0.42 : 0.18;
            plate.pulseDur = punch ? 0.85 : 0.4;
            plate.swapped = true;
            plate._pending = null;
            this._markBusy(punch ? 0.9 : 0.45);
        }
    }

    _relayout() {
        this.stack.forEach((item, i) => {
            const plate = this.plates.get(item.id);
            if (!plate || plate.dying) return;
            plate.targetX = 0;
            plate.targetY = this._slotY(i);
            this._updatePlateFace(plate, item, i === this.stack.length - 1);
        });
    }

    _markBusy(sec) {
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000 + sec;
        if (t > this.busyUntil) this.busyUntil = t;
    }

    _platesMoving() {
        for (const p of this.plates.values()) {
            if (p.dying || p.pulse > 0) return true;
            if (Math.abs(p.group.position.y - p.targetY) > 0.04) return true;
            if (Math.abs(p.group.position.x - p.targetX) > 0.04) return true;
        }
        return false;
    }

    _isBusy() {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        if (this._crush) return true;
        if (this.actionQueue.length) return true;
        if (now < this.busyUntil) return true;
        return this._platesMoving();
    }

    _tickCrush(dt) {
        const c = this._crush;
        if (!c || c.phase !== 'press') return;
        c.t += dt;
        while (c.launched < c.ids.length && c.t >= c.launched * c.interval) {
            const plate = this.plates.get(c.ids[c.launched]);
            if (plate && !plate.dying) {
                plate.crushing = true;
                plate.pulse = 0;
                plate.targetX = 0;
                plate.targetY = c.bottomY;
                plate.targetScale = 0.1;
            }
            c.launched += 1;
            const opP = this.plates.get(c.opId);
            if (opP) {
                opP.crushing = true;
                const remain = 1 - c.launched / Math.max(1, c.ids.length);
                opP.targetX = 0;
                opP.targetY = c.bottomY + 0.5 * remain;
                opP.targetScale = 1;
            }
        }
        if (c.launched < c.ids.length) return;
        const opP = this.plates.get(c.opId);
        if (opP && Math.abs(opP.group.position.y - c.bottomY) > 0.18) return;
        for (let i = 0; i < c.ids.length; i++) {
            const plate = this.plates.get(c.ids[i]);
            if (!plate || plate.dying) continue;
            if (Math.abs(plate.group.position.y - c.bottomY) > 0.16) return;
        }
        c.ids.forEach((id) => {
            const item = this.stack.find((s) => s.id === id);
            if (item) this._removeFromStack(item, 'merge');
        });
        const ok = !!c.ok;
        this._crush = null;
        if (opP) opP.crushing = false;
        this._relayout();
        const top = this.stack[this.stack.length - 1];
        if (top) top.isOp = false;
        this._transformTop(ok ? 'TRUE' : 'FALSE', ok ? DEMO.trueHex : '00', true);
        if (!ok) this.failed = true;
        this.updatePanel();
    }

    selectType(id) {
        if (id === this.typeId) {
            this.step();
            return;
        }
        this.setType(id);
    }

    setType(id) {
        if (!SCRIPT_TYPES[id]) return;
        this.typeId = id;
        try {
            const u = new URL(window.location.href);
            u.searchParams.set('type', id);
            history.replaceState({}, '', u);
        } catch (e) { /* ignore */ }
        this.reset();
        this._syncTypeButtons();
    }

    reset() {
        this.pc = 0;
        while (this.stack.length) this._popItem();
        this.failed = false;
        this.done = false;
        this.playing = false;
        this.playTimer = 0;
        this.lastOp = '—';
        this.actionQueue = [];
        this._crush = null;
        this.updatePanel();
    }

    togglePlay() {
        this.playing = !this.playing;
        this.playTimer = 0;
        this.updatePanel();
    }

    step() {
        if (this.done || this.failed || this._isBusy()) return;
        const tokens = SCRIPT_TYPES[this.typeId].tokens;
        if (this.pc >= tokens.length) {
            this._finish();
            this.updatePanel();
            return;
        }
        const tok = tokens[this.pc];
        this.lastOp = tok.kind === 'op' ? tok.name : ('PUSH ' + truncHex(tok.hex));
        this._apply(tok);
        this.pc += 1;
        if (this.failed || this.pc >= tokens.length) this._finish();
        this.updatePanel();
    }

    _apply(tok) {
        if (tok.kind === 'push') {
            this._pushItem(tok.role, tok.hex);
            return;
        }
        const n = tok.name;
        if (n === 'OP_0') { this._pushItem('OP_0', '00', { isOp: true }); return; }
        if (n === 'OP_1') { this._pushItem('OP_1', '01', { isOp: true }); return; }
        if (n === 'OP_2') { this._pushItem('OP_2', '02', { isOp: true }); return; }
        if (n === 'OP_3') { this._pushItem('OP_3', '03', { isOp: true }); return; }
        if (n === 'OP_DUP') {
            if (!this.stack.length) { this.failed = true; return; }
            this._pushItem('OP_DUP', '', { isOp: true });
            this._queueAction(() => {
                const below = this.stack.length >= 2 ? this.stack[this.stack.length - 2] : null;
                this._popItem('sink');
                if (!below) { this.failed = true; this._relayout(); return; }
                const src = this.plates.get(below.id);
                if (src) src.pulse = 0.001;
                this._pushItem(below.role, below.hex);
            });
            return;
        }
        if (n === 'OP_HASH160' || n === 'OP_SHA256') {
            const a = this.stack[this.stack.length - 1];
            if (!a) { this.failed = true; return; }
            const hashed = n === 'OP_HASH160'
                ? DEMO.HASH160[a.hex.toLowerCase()]
                : DEMO.SHA256[a.hex.toLowerCase()];
            const outRole = n === 'OP_HASH160' ? 'HASH160' : 'SHA256';
            this._pushItem(n, '', { isOp: true });
            this._queueAction(() => {
                this._popItem('sink');
                const target = this.stack[this.stack.length - 1];
                if (!target || !hashed) {
                    if (target) this._popItem('slide');
                    this.failed = true;
                    this._relayout();
                    return;
                }
                this._transformTop(outRole, hashed);
            });
            return;
        }
        if (n === 'OP_DROP') {
            if (!this.stack.length) { this.failed = true; return; }
            this._pushItem('OP_DROP', '', { isOp: true });
            this._queueAction(() => {
                const below = this.stack.length >= 2 ? this.stack[this.stack.length - 2] : null;
                this._popItem('drop');
                if (below) this._removeFromStack(below, 'drop');
                else this.failed = true;
                this._relayout();
                this.updatePanel();
            });
            return;
        }
        if (n === 'OP_EQUALVERIFY') {
            if (this.stack.length < 2) { this.failed = true; return; }
            this._pushItem('OP_EQUALVERIFY', '', { isOp: true });
            this._queueAction(() => {
                const b = this.stack.length >= 2 ? this.stack[this.stack.length - 2] : null;
                const a = this.stack.length >= 3 ? this.stack[this.stack.length - 3] : null;
                this._eqA = a;
                this._eqB = b;
                this._pulse(a);
                this._pulse(b);
                this._nudge(a, -1.35, null);
                this._nudge(b, 1.35, null);
            }, 0.2);
            this._queueAction(() => {
                const a = this._eqA;
                const b = this._eqB;
                const pa = a ? this.plates.get(a.id) : null;
                const pb = b ? this.plates.get(b.id) : null;
                const midY = pa && pb
                    ? (pa.group.position.y + pb.group.position.y) / 2
                    : null;
                this._nudge(a, 0, midY);
                this._nudge(b, 0, midY);
                this._pulse(a);
                this._pulse(b);
            }, 0.12);
            this._queueAction(() => {
                const a = this._eqA;
                const b = this._eqB;
                const ok = !!(a && b && a.hex.toLowerCase() === b.hex.toLowerCase());
                if (ok) {
                    this._removeFromStack(a, 'merge');
                    this._removeFromStack(b, 'merge');
                    this._popItem('merge');
                } else {
                    this._removeFromStack(a, 'apart', -1);
                    this._removeFromStack(b, 'apart', 1);
                    this._popItem('slide');
                    this.failed = true;
                }
                this._relayout();
                this.updatePanel();
            });
            return;
        }
        if (n === 'OP_CHECKSIG') {
            if (this.stack.length < 2) { this.failed = true; return; }
            this._pushItem('OP_CHECKSIG', '', { isOp: true });
            this._queueAction(() => {
                const pk = this.stack.length >= 2 ? this.stack[this.stack.length - 2] : null;
                const sig = this.stack.length >= 3 ? this.stack[this.stack.length - 3] : null;
                this._checkPk = pk;
                this._checkSig = sig;
                this._removeFromStack(pk, 'drop');
                this._removeFromStack(sig, 'drop');
                this._relayout();
            });
            this._queueAction(() => {
                const pk = this._checkPk;
                const sig = this._checkSig;
                if (!pk || !sig) {
                    this.failed = true;
                    this.updatePanel();
                    return;
                }
                const pkHex = String(pk.hex || '').toLowerCase();
                const sigHex = String(sig.hex || '').toLowerCase();
                const ok = (sigHex === DEMO.sigA || sigHex === DEMO.schnorr) &&
                    (pkHex === DEMO.pubA || pkHex === DEMO.q);
                const top = this.stack[this.stack.length - 1];
                if (top) top.isOp = false;
                this._transformTop(ok ? 'TRUE' : 'FALSE', ok ? DEMO.trueHex : '00');
                if (!ok) this.failed = true;
                this.updatePanel();
            }, 0.15);
            return;
        }
        if (n === 'OP_CHECKMULTISIG') {
            if (!this.stack.length) { this.failed = true; return; }
            this._pushItem('OP_CHECKMULTISIG', '', { isOp: true });
            this._queueAction(() => {
                const opItem = this.stack[this.stack.length - 1];
                const operands = this.stack.slice(0, -1);
                let idx = operands.length - 1;
                const nKeys = operands[idx] ? parseInt(operands[idx].hex, 16) : 0;
                idx -= 1 + (nKeys || 0);
                const nSigs = operands[idx] ? parseInt(operands[idx].hex, 16) : 0;
                this._crush = {
                    opId: opItem.id,
                    ids: operands.map((it) => it.id).reverse(),
                    t: 0,
                    launched: 0,
                    interval: 0.1,
                    bottomY: this._slotY(0),
                    ok: nKeys >= 3 && nSigs >= 2,
                    phase: 'press'
                };
                const opP = this.plates.get(opItem.id);
                if (opP) {
                    opP.targetX = 0;
                    opP.targetY = this._slotY(Math.max(0, this.stack.length - 2));
                }
            }, 0.08);
            return;
        }
        if (n === 'OP_RETURN') {
            this.failed = true;
            this.lastOp = 'OP_RETURN (fail)';
        }
    }

    _finish() {
        this.done = true;
        this.playing = false;
        if (!this.failed) {
            const top = this.stack[this.stack.length - 1];
            if (!top || top.hex === '00') this.failed = true;
        }
    }

    _resultText() {
        if (this.failed) return 'FAIL';
        if (this.done) return 'VALID';
        return 'running';
    }

    _setGroupOpacity(group, op) {
        group.traverse((c) => {
            if (c.material && c.material.transparent) {
                c.material.opacity = op * (c.userData.baseOp || 1);
            }
        });
    }

    updatePanel() {
        const t = SCRIPT_TYPES[this.typeId];
        const tokens = t.tokens;
        const cur = tokens[Math.min(this.pc, tokens.length - 1)];
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = v;
        };
        set('script-type-label', t.name);
        set('script-subtitle', t.subtitle || t.name);
        set('script-phase-label', this.done ? 'done' : (cur ? cur.phase : '—'));
        set('script-op-label', this.lastOp);
        set('script-stack-label', this.stack.length
            ? this.stack.map((s) => s.role + ' ' + truncHex(s.hex)).join(' | ')
            : 'empty');
        set('script-result-label', this._resultText());
        set('script-key-label', 'kA …0001  ·  kB …0002  ·  kC …0003');
        const note = document.getElementById('script-note');
        if (note) note.textContent = t.note;
        const play = document.getElementById('script-play');
        if (play) play.textContent = this.playing ? 'Pause' : 'Play';

        const ops = document.getElementById('script-ops');
        if (ops) {
            ops.innerHTML = '';
            tokens.forEach((tok, i) => {
                const chip = document.createElement('span');
                chip.className = 'script-op-chip' + (i === this.pc && !this.done ? ' current' : '') + (i < this.pc ? ' done' : '');
                chip.textContent = tok.kind === 'op' ? tok.name : (tok.role + ' ' + truncHex(tok.hex));
                ops.appendChild(chip);
            });
        }
    }

    animate() {
        if (this._disposed) return;
        const dt = this.clock.getDelta();
        const k = 1 - Math.pow(0.0008, dt);

        this.plates.forEach((p, id) => {
            if (p.pulse > 0) {
                p.pulse += dt;
                const dur = p.pulseDur || 0.4;
                const amp = p.pulseAmp == null ? 0.18 : p.pulseAmp;
                const u = Math.min(1, p.pulse / dur);
                const pulse = 1 + amp * Math.sin(u * Math.PI);
                p.group.scale.setScalar(pulse);
                if (u >= 0.5 && !p.swapped && p._pending) {
                    const item = this.stack.find((s) => s.id === p.id);
                    if (item) this._updatePlateFace(p, item, true);
                    p.swapped = true;
                }
                if (u >= 1) {
                    p.pulse = 0;
                    p.group.scale.setScalar(1);
                }
            } else {
                const kk = p.crushing ? 1 - Math.pow(0.00004, dt) : k;
                const s = p.group.scale.x + (p.targetScale - p.group.scale.x) * kk;
                p.group.scale.setScalar(s);
            }
            const pk = p.crushing ? 1 - Math.pow(0.00004, dt) : k;
            p.group.position.x += (p.targetX - p.group.position.x) * pk;
            p.group.position.y += (p.targetY - p.group.position.y) * pk;
            if (p.dying) {
                p.dieT = (p.dieT || 0) + dt;
                let fade;
                if (p.dieMode === 'sink' || p.dieMode === 'merge') fade = Math.max(0, 1 - p.dieT / 0.5);
                else if (p.dieMode === 'drop') fade = Math.max(0, 1 - p.dieT / 0.45);
                else fade = Math.max(0, 1 - Math.abs(p.group.position.x) / 5.5);
                p.group.traverse((c) => {
                    if (c.material && 'opacity' in c.material) {
                        c.material.transparent = true;
                        if (c === p.face) c.material.opacity = fade;
                        else if (c.material.color && c.type === 'LineSegments') {
                            c.material.opacity = fade * (p.edgeOp == null ? 0.85 : p.edgeOp);
                        } else if (c.material.opacity !== undefined && c.geometry && c.geometry.type === 'BoxGeometry') {
                            c.material.opacity = fade * (p.fillOp == null ? 0.07 : p.fillOp);
                        }
                    }
                });
                const gone = p.dieMode === 'merge'
                    ? (p.dieT > 0.5 || p.group.scale.x < 0.08)
                    : p.dieMode === 'drop'
                        ? p.dieT > 0.45
                        : p.dieMode === 'sink'
                            ? p.dieT > 0.5
                            : (p.dieT > 0.7 || fade < 0.05 || Math.abs(p.group.position.x) > 5.3);
                if (gone) {
                    this._disposeObj(p.group);
                    this.plates.delete(id);
                }
            }
        });

        if (this._crush) this._tickCrush(dt);

        if (this.actionQueue.length && !this._platesMoving() && !this._crush) {
            const act = this.actionQueue[0];
            act.wait -= dt;
            if (act.wait <= 0) {
                this.actionQueue.shift();
                act.fn();
            }
        }

        if (this._emptyMesh) {
            this._emptyMesh.visible = this.stack.length === 0 && this.plates.size === 0;
        }

        if (this.playing && !this._isBusy()) {
            this.playTimer += dt;
            if (this.playTimer >= this.playInterval) {
                this.playTimer = 0;
                this.step();
            }
        }
        if (this.isRotating && this.controls && !(this.renderer.xr && this.renderer.xr.isPresenting)) {
            this.controls.theta += dt * 0.08;
            this.controls.update();
        }
        if (this.vrManager && this.vrManager.update) this.vrManager.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this._applyPixelRatio();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    resetCamera() {
        if (!this.controls) return;
        this.isRotating = false;
        if (typeof setRotationButtonState === 'function') setRotationButtonState(false);
        this.controls.target.set(0, 3.8, 0);
        this.controls.phi = 1.22;
        this.controls.theta = Math.PI / 2;
        this.controls.distance = 18;
        this.controls.update();
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
    zoomIn() { this.controls.distance *= 0.85; this.controls.update(); }
    zoomOut() { this.controls.distance *= 1.15; this.controls.update(); }
}

window.ExplorerPages = window.ExplorerPages || {};
window.ExplorerPages['script.html'] = {
    panelTitle: 'Script',
    panelDomId: 'script-info',
    create: function (opts) { return new BitcoinScriptExplorer(opts); }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.__softNav) return;
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        return;
    }
    window.__explorer = new BitcoinScriptExplorer();
});
