/**
 * VRNavMenu — wrist-anchored grid navigation menu for moving between explorer pages.
 * Parented to the left XR controller. Toggle with left controller grip.
 * Cards reveal with a staggered fade + slide-up animation.
 * Exposed as window.VRNavMenu.
 */
(function () {
    'use strict';

    var PAGES = [
        { name: 'NETWORK',     file: 'network.html',     img: 'imgs/network.png'     },
        { name: 'NODE',        file: 'node.html',        img: 'imgs/node.png'        },
        { name: 'BLOCKCHAIN',  file: 'blockchain.html',  img: 'imgs/blockchain.png'  },
        { name: 'DIFFICULTY',  file: 'difficulty.html',  img: 'imgs/difficulty.png'  },
        { name: 'BLOCK',       file: 'block.html',       img: 'imgs/block.png'       },
        { name: 'TRANSACTION', file: 'transaction.html', img: 'imgs/transaction.png' },
        { name: 'ADDRESS',     file: 'address.html',     img: 'imgs/address.png'     },
        { name: 'MEMPOOL',     file: 'mempool.html',     img: 'imgs/mempool.png'     },
    ];

    // Grid layout
    var GRID_COLS  = 4;
    var CELL_W     = 0.105;
    var CELL_H     = 0.068;
    var GAP_X      = 0.014;
    var GAP_Y      = 0.034;   // includes label space below card
    var LABEL_H    = 0.030;   // label plane height

    // Toggle row below grid
    var TOGGLE_W   = 0.090;
    var TOGGLE_H   = 0.022;
    var TOGGLE_GAP = 0.010;

    // Interaction
    var OPACITY_DEFAULT = 0.92;
    var OPACITY_HOVER   = 1.0;
    var BORDER_OPACITY  = 0.35;
    var BORDER_HOVER_OP = 1.0;

    // Stagger animation
    var STAGGER_S  = 0.055;
    var ANIM_DUR_S = 0.25;
    var SLIDE_UP   = 0.025;

    // -------------------------------------------------------------------------

    function makeLabel(text, opts) {
        opts = opts || {};
        var W   = opts.width  || 512;
        var H   = opts.height || 72;
        var px  = opts.fontSize || 26;
        var align = opts.align || 'left';
        var canvas = document.createElement('canvas');
        canvas.width  = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle    = opts.color || 'rgba(255,255,255,0.82)';
        ctx.font         = '300 ' + px + 'px "Inter", sans-serif';
        ctx.textAlign    = align;
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '2px';
        var tx = align === 'left' ? 12 : W / 2;
        ctx.fillText(text, tx, H / 2);
        var tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    function makeLogoTexture() {
        var W = 1024, H = 96;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle    = 'rgba(255,255,255,0.95)';
        ctx.font         = '400 76px "BureauGrotesque", sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '1px';
        ctx.fillText('ANATOMY OF BITCOIN', 12, H / 2);
        var tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    function makeToggleLabel(text, active) {
        var W = 360, H = 56;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        // Pill background
        ctx.fillStyle = active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        ctx.roundRect(0, 0, W, H, 6);
        ctx.fill();
        // Text
        ctx.fillStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)';
        ctx.font = '300 26px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '2px';
        ctx.fillText(text, 14, H / 2);
        // On/off dot
        var dotColor = active ? '#ffffff' : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(W - 22, H / 2, 7, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        var tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // -------------------------------------------------------------------------

    function VRNavMenu(vrManager) {
        this.vrManager      = vrManager;
        this.group          = new THREE.Group();
        this.group.visible  = false;

        this.buttons        = [];   // page card meshes
        this._labels        = [];   // label meshes
        this._borders       = [];   // LineLoop border per card
        this._toggleButtons = [];   // visibility toggle button meshes
        this._allTargets    = [];   // union of buttons + toggles for raycasting

        this._animStartTime = null;
        this.highlighted    = null;
        this.raycaster      = new THREE.Raycaster();
    }

    // -------------------------------------------------------------------------
    // Build
    // -------------------------------------------------------------------------

    VRNavMenu.prototype.build = function () {
        var self   = this;
        var loader = new THREE.TextureLoader();

        var gridW = GRID_COLS * CELL_W + (GRID_COLS - 1) * GAP_X;
        var rows  = Math.ceil(PAGES.length / GRID_COLS);
        var gridH = rows * CELL_H + (rows - 1) * GAP_Y;

        var toggleRowCount = 3; // HUD + INFO PANEL + ROTATION
        var toggleRowH = TOGGLE_H + 0.012;
        var totalToggleW = toggleRowCount * TOGGLE_W + (toggleRowCount - 1) * TOGGLE_GAP;

        var LOGO_H   = 0.026;   // world-space height of logo strip
        var LOGO_GAP = 0.014;   // gap between logo and top of grid
        var DIV_H    = 0.001;   // thin divider line height

        var padX     = 0.022;
        var padTop   = 0.012;   // above logo
        var padBot   = 0.014 + toggleRowH + 0.012;
        var plateW   = Math.max(gridW, totalToggleW) + padX * 2;
        var plateH   = gridH + LABEL_H + padTop + padBot + LOGO_H + LOGO_GAP + DIV_H + 0.010;

        // The grid Y=0 centre shifts down to make room for logo above
        var gridShift = -(LOGO_H + LOGO_GAP + DIV_H) / 2;

        // Background plate
        var plateMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.90, side: THREE.DoubleSide });
        var plate    = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), plateMat);
        plate.position.set(0, gridShift, -0.001);
        this.group.add(plate);

        // ── Logo ─────────────────────────────────────────────────────────────
        var logoMat  = new THREE.MeshBasicMaterial({ map: makeLogoTexture(), transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
        var logoMesh = new THREE.Mesh(new THREE.PlaneGeometry(plateW - padX * 2, LOGO_H), logoMat);
        var logoY    = gridShift + plateH / 2 - padTop - LOGO_H / 2;
        logoMesh.position.set(0, logoY, 0.002);
        logoMesh.renderOrder = 999;
        this.group.add(logoMesh);

        // Thin divider below logo
        var divPts = [new THREE.Vector3(-plateW / 2 + padX, 0, 0), new THREE.Vector3(plateW / 2 - padX, 0, 0)];
        var divGeo = new THREE.BufferGeometry().setFromPoints(divPts);
        var divMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, depthTest: false });
        var divLine = new THREE.Line(divGeo, divMat);
        divLine.position.set(0, logoY - LOGO_H / 2 - 0.006, 0.002);
        this.group.add(divLine);

        // Left edge X for left-aligned layout
        var leftEdge = -gridW / 2;

        // ── Page cards ────────────────────────────────────────────────────────
        PAGES.forEach(function (page, i) {
            var col = i % GRID_COLS;
            var row = Math.floor(i / GRID_COLS);

            // Left-aligned: cards start from leftEdge
            var x = leftEdge + col * (CELL_W + GAP_X) + CELL_W / 2;
            var y = (gridH / 2 - CELL_H / 2) - row * (CELL_H + GAP_Y) + gridShift;

            // ── Card image ────────────────────────────────────────────────────
            var mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide });
            var mesh = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W, CELL_H), mat);
            mesh.position.set(x, y, 0.001);
            mesh.userData.pageFile = page.file;
            mesh.userData.baseY    = y;

            loader.load(page.img, function (tex) {
                // All cards use identical CELL_W × CELL_H — no per-image resize
                mat.map = tex;
                mat.needsUpdate = true;
            });

            // ── White border (LineLoop) ───────────────────────────────────────
            var hw = CELL_W / 2, hh = CELL_H / 2;
            var borderGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-hw, -hh, 0),
                new THREE.Vector3( hw, -hh, 0),
                new THREE.Vector3( hw,  hh, 0),
                new THREE.Vector3(-hw,  hh, 0),
            ]);
            var borderMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });
            var border    = new THREE.LineLoop(borderGeo, borderMat);
            border.position.set(x, y, 0.0015);
            mesh.userData.border = border;

            // ── Label (left-aligned, below card) ─────────────────────────────
            var labelY   = y - CELL_H / 2 - LABEL_H / 2 - 0.004;
            var labelTex = makeLabel(page.name, { align: 'left', fontSize: 44, width: 512, height: 96 });
            var labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false, opacity: 0 });
            var label    = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W, LABEL_H), labelMat);
            label.renderOrder = 999;
            label.position.set(x, labelY, 0.002);
            label.userData.baseY = labelY;

            self.group.add(border);
            self.group.add(label);
            self.group.add(mesh);
            self.buttons.push(mesh);
            self._labels.push(label);
            self._borders.push(border);
        });

        // ── Visibility toggles ────────────────────────────────────────────────
        var toggleDefs = [
            {
                label:    'HUD',
                getState: function () {
                    var vm = self.vrManager;
                    return vm && vm._hudL ? vm._hudL.visible : false;
                },
                onSelect: function (mesh) {
                    if (self.vrManager) self.vrManager._toggleHud();
                    self._refreshToggle(mesh);
                },
            },
            {
                label:    'INFO PANEL',
                getState: function () {
                    var sp = self.vrManager && self.vrManager.spatialPanel;
                    return sp ? sp.getMesh().visible : false;
                },
                onSelect: function (mesh) {
                    var sp = self.vrManager && self.vrManager.spatialPanel;
                    if (!sp) return;
                    sp.setVisible(!sp.getMesh().visible);
                    self._refreshToggle(mesh);
                },
            },
            {
                label:    'ROTATION',
                getState: function () {
                    var ex = self.vrManager && self.vrManager.explorer;
                    return ex ? !!ex.isRotating : false;
                },
                onSelect: function (mesh) {
                    var ex = self.vrManager && self.vrManager.explorer;
                    if (!ex || typeof ex.isRotating === 'undefined') return;
                    ex.isRotating = !ex.isRotating;
                    self._refreshToggle(mesh);
                },
            },
        ];

        var toggleRowY = -(gridH / 2) - LABEL_H - 0.016 - TOGGLE_H / 2 + gridShift;
        var toggleStartX = -(totalToggleW / 2) + TOGGLE_W / 2;

        toggleDefs.forEach(function (def, ti) {
            var tx = toggleStartX + ti * (TOGGLE_W + TOGGLE_GAP);
            var active = def.getState();

            var tMat = new THREE.MeshBasicMaterial({ map: makeToggleLabel(def.label, active), transparent: true, side: THREE.DoubleSide, opacity: 0.9 });
            var tMesh = new THREE.Mesh(new THREE.PlaneGeometry(TOGGLE_W, TOGGLE_H), tMat);
            tMesh.position.set(tx, toggleRowY, 0.001);
            tMesh.userData.onSelect  = def.onSelect;
            tMesh.userData.getState  = def.getState;
            tMesh.userData.defLabel  = def.label;
            tMesh.userData.baseY     = toggleRowY;

            self.group.add(tMesh);
            self._toggleButtons.push(tMesh);
        });

        this._allTargets = this.buttons.concat(this._toggleButtons);
    };

    // Rebuild a toggle button's canvas texture to reflect current state
    VRNavMenu.prototype._refreshToggle = function (mesh) {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.map = makeToggleLabel(mesh.userData.defLabel, mesh.userData.getState());
        mesh.material.needsUpdate = true;
    };

    // -------------------------------------------------------------------------
    // Attach / visibility
    // -------------------------------------------------------------------------

    VRNavMenu.prototype.attachToController = function (controller) {
        controller.add(this.group);
        this.group.position.set(0, 0.10, -0.05);
        this.group.rotation.x = -0.35;
    };

    VRNavMenu.prototype.show = function () {
        var self = this;
        this.buttons.forEach(function (mesh, i) {
            mesh.position.y       = mesh.userData.baseY - SLIDE_UP;
            mesh.material.opacity = 0;
            self._borders[i].material.opacity = 0;
        });
        this._labels.forEach(function (label) {
            label.position.y       = label.userData.baseY - SLIDE_UP;
            label.material.opacity = 0;
        });
        this._toggleButtons.forEach(function (t) {
            t.position.y       = t.userData.baseY - SLIDE_UP;
            t.material.opacity = 0;
        });
        this._animStartTime = Date.now();
        this.group.visible  = true;
    };

    VRNavMenu.prototype.hide = function () {
        this.group.visible  = false;
        this._animStartTime = null;
        this.highlighted    = null;
    };

    VRNavMenu.prototype.toggle = function () {
        if (this.group.visible) { this.hide(); } else { this.show(); }
    };

    // -------------------------------------------------------------------------
    // Per-frame update
    // -------------------------------------------------------------------------

    VRNavMenu.prototype.updateHover = function (controller0) {
        if (!this.group.visible) return null;

        var self    = this;
        var elapsed = this._animStartTime ? (Date.now() - this._animStartTime) / 1000 : Infinity;
        var allDone = true;
        var totalItems = this.buttons.length + this._toggleButtons.length;

        // ── Staggered reveal ─────────────────────────────────────────────────
        this.buttons.forEach(function (mesh, i) {
            var t    = Math.max(0, Math.min(1, (elapsed - i * STAGGER_S) / ANIM_DUR_S));
            var ease = 1 - Math.pow(1 - t, 3);
            if (t < 1) allDone = false;
            mesh.position.y = mesh.userData.baseY - SLIDE_UP * (1 - ease);
            if (mesh !== self.highlighted) {
                mesh.material.opacity = ease * OPACITY_DEFAULT;
            }
            self._borders[i].material.opacity = ease * BORDER_OPACITY;
            self._borders[i].position.y       = mesh.position.y;
            var label = self._labels[i];
            if (label) {
                label.position.y       = label.userData.baseY - SLIDE_UP * (1 - ease);
                label.material.opacity = ease * 0.78;
            }
        });

        // Toggles animate after all cards
        var toggleDelay = this.buttons.length * STAGGER_S;
        this._toggleButtons.forEach(function (t, ti) {
            var tt   = Math.max(0, Math.min(1, (elapsed - toggleDelay - ti * STAGGER_S) / ANIM_DUR_S));
            var ease = 1 - Math.pow(1 - tt, 3);
            if (tt < 1) allDone = false;
            t.position.y       = t.userData.baseY - SLIDE_UP * (1 - ease);
            t.material.opacity = ease * 0.9;
        });

        if (allDone) this._animStartTime = null;

        // ── Raycast hover ─────────────────────────────────────────────────────
        var tempMatrix = new THREE.Matrix4();
        tempMatrix.identity().extractRotation(controller0.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller0.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        var intersects = this.raycaster.intersectObjects(this._allTargets);

        // Reset previous highlight
        if (this.highlighted) {
            var hi = this.highlighted;
            if (hi.userData.pageFile !== undefined) {
                // card
                var idx = self.buttons.indexOf(hi);
                hi.material.opacity = OPACITY_DEFAULT;
                if (idx >= 0) self._borders[idx].material.opacity = BORDER_OPACITY;
            } else {
                hi.material.opacity = 0.9;
            }
            this.highlighted = null;
        }

        if (intersects.length > 0) {
            var hit = intersects[0].object;
            hit.material.opacity = OPACITY_HOVER;
            if (hit.userData.pageFile !== undefined) {
                var hidx = self.buttons.indexOf(hit);
                if (hidx >= 0) self._borders[hidx].material.opacity = BORDER_HOVER_OP;
            }
            this.highlighted = hit;
        }

        return null;
    };

    VRNavMenu.prototype.selectHighlighted = function () {
        if (!this.highlighted) return;
        var h = this.highlighted;
        if (h.userData.onSelect) {
            h.userData.onSelect(h);
        } else if (h.userData.pageFile) {
            window.location.href = h.userData.pageFile;
        }
    };

    // -------------------------------------------------------------------------

    if (typeof window !== 'undefined') window.VRNavMenu = VRNavMenu;
})();
