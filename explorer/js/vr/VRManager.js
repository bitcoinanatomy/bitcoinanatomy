/**
 * VRManager — WebXR session lifecycle, controller setup, and spatial UI coordination.
 *
 * Controller mapping:
 *   Right trigger (hold)      — pan / tilt the scene
 *   Left trigger  (hold)      — pan / tilt the scene
 *   Both triggers (hold)      — pinch-to-scale (wider = zoom in, closer = zoom out)
 *   Left grip                 — toggle wrist nav menu
 *   Right trigger (point+press on nav button) — navigate to page
 *
 * Scene content is parented into a pivot Group on session start so scale / rotation
 * affect only the virtual content, not the controllers or spatial panel.
 *
 * Exposed as window.VRManager.
 */
(function () {
    'use strict';

    // Initial scale factors: maps scene units → metres at session start.
    // The pivot group is set to this scale; user can then pinch to adjust freely.
    var SCALE_MAP = {
        'network.html':     0.005,
        'blockchain.html':  0.05,
        'block.html':       0.1,
        'difficulty.html':  0.05,
        'transaction.html': 0.02,
        'mempool.html':     0.05,
        'node.html':        0.05,
        'address.html':     0.1,
    };

    var ROT_SENSITIVITY = 8;   // radians of rotation per metre of controller travel
    var SCALE_MIN       = 1e-5;
    var SCALE_MAX       = 1e4;

    // -------------------------------------------------------------------------

    function VRManager(explorer, options) {
        options = options || {};
        this.explorer   = explorer;
        this.panelTitle = options.panelTitle || 'Info';
        this.panelDomId = options.panelDomId || null;

        this.controller0 = null; // right hand
        this.controller1 = null; // left hand

        this.spatialPanel    = null;
        this.navMenu         = null;
        this._panelInterval  = null;
        this.interactables   = [];

        this._origControlsUpdate = null;
        this._wasRotating        = false;
        this._wasMontageActive   = false;

        // Pivot group — wraps all explorer scene content during a VR session
        this.pivot                    = null;
        this._pivotBaseScale          = 1;
        this._needsInitialPlacement   = false; // set true on session start, cleared on first frame

        // HUD — two head-locked side panels (Iron Man style)
        this._hudPivot   = null; // Group whose transform mirrors the XR camera each frame
        this._hudL       = null; // Left panel mesh
        this._hudR       = null; // Right panel mesh
        this._hudLCanvas = null;
        this._hudRCanvas = null;
        this._hudLCtx    = null;
        this._hudRCtx    = null;
        this._hudLTex    = null;
        this._hudRTex    = null;

        // Trigger / pinch state
        this._trigger0       = false;
        this._trigger1       = false;
        this._prevPos0       = new THREE.Vector3();
        this._prevPos1       = new THREE.Vector3();
        this._pinchInitDist  = 0;
        this._pinchInitScale = 1;
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------

    VRManager.prototype.init = function () {
        var self     = this;
        var renderer = this.explorer.renderer;

        renderer.xr.enabled = true;

        // Wire up the VR button
        if (typeof VRButton !== 'undefined') {
            var btn = VRButton.createButton(renderer);
            if (!document.getElementById('vr-button')) {
                document.body.appendChild(btn);
            }
        }

        renderer.xr.addEventListener('sessionstart', function () { self._onSessionStart(); });
        renderer.xr.addEventListener('sessionend',   function () { self._onSessionEnd(); });

        this._setupControllers();

        // Spatial panel — attached to scene directly (never goes into pivot)
        if (typeof SpatialPanel !== 'undefined') {
            this.spatialPanel = new SpatialPanel({ title: this.panelTitle });
            this.spatialPanel.attachToScene(this.explorer.scene);
        }

        // Wrist nav menu — attached to left controller
        if (typeof VRNavMenu !== 'undefined' && this.controller1) {
            this.navMenu = new VRNavMenu(this);
            this.navMenu.build();
            this.navMenu.attachToController(this.controller1);
        }
    };

    // -------------------------------------------------------------------------
    // Controllers
    // -------------------------------------------------------------------------

    VRManager.prototype._setupControllers = function () {
        var self     = this;
        var renderer = this.explorer.renderer;
        var scene    = this.explorer.scene;

        this.controller0 = renderer.xr.getController(0); // right
        this.controller1 = renderer.xr.getController(1); // left

        // Visual rays
        var pts    = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)];
        var rayGeo = new THREE.BufferGeometry().setFromPoints(pts);
        this.controller0.add(new THREE.Line(rayGeo,         new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })));
        this.controller1.add(new THREE.Line(rayGeo.clone(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })));

        scene.add(this.controller0);
        scene.add(this.controller1);

        // ── Right trigger ──────────────────────────────────────────────────────
        this.controller0.addEventListener('selectstart', function () {
            self._trigger0 = true;
            self.controller0.getWorldPosition(self._prevPos0);
            self._pinchInitDist = 0;
            // Select nav button if menu is open
            if (self.navMenu && self.navMenu.group.visible) {
                self.navMenu.selectHighlighted();
            }
        });
        this.controller0.addEventListener('selectend', function () {
            self._trigger0      = false;
            self._pinchInitDist = 0;
        });

        // ── Left trigger ───────────────────────────────────────────────────────
        this.controller1.addEventListener('selectstart', function () {
            self._trigger1 = true;
            self.controller1.getWorldPosition(self._prevPos1);
            self._pinchInitDist = 0;
        });
        this.controller1.addEventListener('selectend', function () {
            self._trigger1      = false;
            self._pinchInitDist = 0;
        });

        // ── Left grip → toggle nav menu ────────────────────────────────────────
        this.controller1.addEventListener('squeezestart', function () {
            if (self.navMenu) self.navMenu.toggle();
        });

        // ── Right grip → toggle HUD ────────────────────────────────────────────
        this.controller0.addEventListener('squeezestart', function () {
            self._toggleHud();
        });
    };

    // -------------------------------------------------------------------------
    // Session start / end
    // -------------------------------------------------------------------------

    VRManager.prototype._onSessionStart = function () {
        var self     = this;
        var explorer = this.explorer;
        var renderer = explorer.renderer;

        // Disable desktop orbit controls
        if (explorer.controls && typeof explorer.controls.update === 'function') {
            this._origControlsUpdate  = explorer.controls.update.bind(explorer.controls);
            explorer.controls.update  = function () {};
        }

        // Pause auto-rotation / montage
        if (typeof explorer.isRotating !== 'undefined') {
            this._wasRotating    = explorer.isRotating;
            explorer.isRotating  = false;
        }
        if (typeof explorer.montageActive !== 'undefined') {
            this._wasMontageActive   = explorer.montageActive;
            explorer.montageActive   = false;
        }

        // Force perspective camera
        if (explorer.isPerspective === false) {
            var tv = document.getElementById('toggle-view');
            if (tv) tv.click();
        }

        // Reset XR camera scale — pivot handles scale from now on
        var xrCamera = renderer.xr.getCamera();
        if (xrCamera) xrCamera.scale.setScalar(1);

        // ── Build pivot ────────────────────────────────────────────────────────
        // Objects that must stay in scene-root space (not scaled with content)
        var keepInScene = [this.controller0, this.controller1];
        var spatialMesh = this.spatialPanel ? this.spatialPanel.getMesh() : null;
        if (spatialMesh) keepInScene.push(spatialMesh);
        // _hudPivot is added to scene AFTER pivot build (in _attachHud), so no need to exclude it here

        this.pivot = new THREE.Group();

        var toMove = explorer.scene.children.slice().filter(function (c) {
            return keepInScene.indexOf(c) === -1;
        });
        toMove.forEach(function (child) {
            explorer.scene.remove(child);
            self.pivot.add(child);
        });

        var page = window.location.pathname.split('/').pop() || 'network.html';
        var scale = SCALE_MAP[page] || 0.05;
        this._pivotBaseScale        = scale;
        this._pinchInitScale        = scale;
        this._needsInitialPlacement = true; // position in front of user on first frame
        this.pivot.scale.setScalar(scale);
        explorer.scene.add(this.pivot);

        // ── HUD ───────────────────────────────────────────────────────────────
        this._attachHud();

        // ── Spatial panel ──────────────────────────────────────────────────────
        if (this.spatialPanel) {
            this._positionPanel();
            this.spatialPanel.setVisible(true);
            if (spatialMesh) this.interactables.push(spatialMesh);
            this._startPanelUpdate();
        }

        // Hide DOM chrome (nav + disclaimer stay visible in HUD instead)
        var uiEl = document.getElementById('ui');
        if (uiEl) uiEl.style.visibility = 'hidden';
        var navEl  = document.querySelector('nav.navbar');
        var discEl = document.querySelector('.disclaimer');
        if (navEl)  navEl.style.visibility  = 'hidden';
        if (discEl) discEl.style.visibility = 'hidden';
    };

    VRManager.prototype._onSessionEnd = function () {
        var self     = this;
        var explorer = this.explorer;

        // Return pivot children to scene root
        if (this.pivot) {
            var toRestore = this.pivot.children.slice();
            toRestore.forEach(function (child) {
                self.pivot.remove(child);
                explorer.scene.add(child);
            });
            explorer.scene.remove(this.pivot);
            this.pivot = null;
        }

        // Restore orbit controls
        if (this._origControlsUpdate && explorer.controls) {
            explorer.controls.update    = this._origControlsUpdate;
            this._origControlsUpdate    = null;
        }

        // Restore auto-rotation / montage
        if (typeof explorer.isRotating !== 'undefined')    explorer.isRotating    = this._wasRotating;
        if (typeof explorer.montageActive !== 'undefined') explorer.montageActive = this._wasMontageActive;

        // Hide spatial panel + HUD
        if (this.spatialPanel) this.spatialPanel.setVisible(false);
        this._detachHud();
        this._stopPanelUpdate();
        this.interactables = [];

        // Reset interaction state
        this._trigger0              = false;
        this._trigger1              = false;
        this._pinchInitDist         = 0;
        this._needsInitialPlacement = false;

        // Restore DOM chrome
        var uiEl   = document.getElementById('ui');
        var navEl  = document.querySelector('nav.navbar');
        var discEl = document.querySelector('.disclaimer');
        if (uiEl)   uiEl.style.visibility   = '';
        if (navEl)  navEl.style.visibility  = '';
        if (discEl) discEl.style.visibility = '';
    };

    // -------------------------------------------------------------------------
    // Initial pivot placement — called on first rendered frame so XR camera
    // pose is fully tracked and we can place the model in front of the user.
    // -------------------------------------------------------------------------

    VRManager.prototype._placeInFrontOfUser = function () {
        if (!this.pivot) return;
        var xrCamera = this.explorer.renderer.xr.getCamera();
        var camPos   = new THREE.Vector3();
        var camDir   = new THREE.Vector3();
        xrCamera.getWorldPosition(camPos);
        xrCamera.getWorldDirection(camDir);

        // Project forward direction onto the horizontal plane so the model
        // floats at a fixed height rather than following head tilt
        var forward = new THREE.Vector3(camDir.x, 0, camDir.z);
        if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1); // fallback if looking straight up/down
        forward.normalize();

        // Place ~0.8 m in front of the user, just below eye level
        this.pivot.position.set(
            camPos.x + forward.x * 0.8,
            camPos.y - 0.15,
            camPos.z + forward.z * 0.8
        );
    };

    // -------------------------------------------------------------------------
    // Minority Report interaction (called every frame)
    // -------------------------------------------------------------------------

    VRManager.prototype._updateInteraction = function () {
        if (!this.pivot || !this.explorer.renderer.xr.isPresenting) return;

        var pos0 = new THREE.Vector3();
        var pos1 = new THREE.Vector3();
        if (this._trigger0) this.controller0.getWorldPosition(pos0);
        if (this._trigger1) this.controller1.getWorldPosition(pos1);

        if (this._trigger0 && this._trigger1) {
            // ── Both triggers: pinch-to-scale ─────────────────────────────────
            var dist = pos0.distanceTo(pos1);
            if (this._pinchInitDist > 0) {
                var ratio    = dist / this._pinchInitDist;
                var newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, this._pinchInitScale * ratio));
                this.pivot.scale.setScalar(newScale);
            } else {
                // First frame with both pressed — record baseline
                this._pinchInitDist  = dist;
                this._pinchInitScale = this.pivot.scale.x;
            }
            // Keep prevPos current so single-hand resumes smoothly
            this._prevPos0.copy(pos0);
            this._prevPos1.copy(pos1);

        } else if (this._trigger0) {
            // ── Right trigger only: pan / tilt ────────────────────────────────
            this._pinchInitDist = 0;
            var d0 = pos0.clone().sub(this._prevPos0);
            if (d0.length() < 0.5) {
                this.pivot.rotation.y += d0.x * ROT_SENSITIVITY;
                this.pivot.rotation.x -= d0.y * ROT_SENSITIVITY;
            }
            this._prevPos0.copy(pos0);

        } else if (this._trigger1) {
            // ── Left trigger only: pan / tilt ─────────────────────────────────
            this._pinchInitDist = 0;
            var d1 = pos1.clone().sub(this._prevPos1);
            if (d1.length() < 0.5) {
                this.pivot.rotation.y += d1.x * ROT_SENSITIVITY;
                this.pivot.rotation.x -= d1.y * ROT_SENSITIVITY;
            }
            this._prevPos1.copy(pos1);

        } else {
            this._pinchInitDist = 0;
        }
    };

    // -------------------------------------------------------------------------
    // Spatial panel helpers
    // -------------------------------------------------------------------------

    VRManager.prototype._positionPanel = function () {
        if (!this.spatialPanel) return;
        var cam     = this.explorer.camera;
        var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        var right   = new THREE.Vector3(1, 0,  0).applyQuaternion(cam.quaternion);
        var pos     = cam.position.clone()
            .addScaledVector(forward, 1.2)
            .addScaledVector(right,   0.35);
        pos.y = cam.position.y + 0.1;
        this.spatialPanel.setPosition(pos.x, pos.y, pos.z);
        this.spatialPanel.getMesh().lookAt(cam.position);
    };

    VRManager.prototype._toggleHud = function () {
        if (!this._hudL) return;
        var vis = !this._hudL.visible;
        [this._hudL, this._hudR, this._hudTop, this._hudBot].forEach(function (m) { if (m) m.visible = vis; });
        // Sync nav-menu toggle button
        if (this.navMenu && this.navMenu._toggleButtons) {
            var self = this;
            this.navMenu._toggleButtons.forEach(function (btn) {
                if (btn.userData.defLabel === 'HUD') self.navMenu._refreshToggle(btn);
            });
        }
    };

    VRManager.prototype._startPanelUpdate = function () {
        var self = this;
        this._stopPanelUpdate();
        this._panelInterval = setInterval(function () {
            var lines = self._readPanelLines();
            if (self.spatialPanel) self.spatialPanel.update(lines);
            if (self._hudL)        self._drawHud(lines);
        }, 1000);
        var initLines = this._readPanelLines();
        if (this.spatialPanel) this.spatialPanel.update(initLines);
        if (this._hudL)        this._drawHud(initLines);
    };

    VRManager.prototype._stopPanelUpdate = function () {
        if (this._panelInterval) {
            clearInterval(this._panelInterval);
            this._panelInterval = null;
        }
    };

    VRManager.prototype._readPanelLines = function () {
        var sourceEl = this.panelDomId ? document.getElementById(this.panelDomId) : null;
        if (!sourceEl) sourceEl = document.querySelector('.panel-content');
        if (!sourceEl) return [];
        var lines = [];
        sourceEl.querySelectorAll('div').forEach(function (div) {
            var text = div.textContent.trim().replace(/\s+/g, ' ');
            if (text.length > 0 && text.length < 80) lines.push(text);
        });
        return lines.slice(0, 10);
    };

    // -------------------------------------------------------------------------
    // HUD — head-locked info strip
    // -------------------------------------------------------------------------

    VRManager.prototype._buildHud = function () {
        var mkMat = function (tex) {
            return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
        };
        var mkCanvas = function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

        // Side panels — portrait (320×480, 2:3)
        this._hudLCanvas = mkCanvas(320, 480); this._hudRCanvas = mkCanvas(320, 480);
        this._hudLCtx    = this._hudLCanvas.getContext('2d');
        this._hudRCtx    = this._hudRCanvas.getContext('2d');
        this._hudLTex    = new THREE.CanvasTexture(this._hudLCanvas);
        this._hudRTex    = new THREE.CanvasTexture(this._hudRCanvas);
        this._hudL = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.113), mkMat(this._hudLTex));
        this._hudR = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.113), mkMat(this._hudRTex));

        // Top strip — logo (512×36)
        this._hudTopCanvas = mkCanvas(512, 36); this._hudTopCtx = this._hudTopCanvas.getContext('2d');
        this._hudTopTex    = new THREE.CanvasTexture(this._hudTopCanvas);
        this._hudTop = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.027), mkMat(this._hudTopTex));

        // Bottom strip — data source (512×28)
        this._hudBotCanvas = mkCanvas(512, 28); this._hudBotCtx = this._hudBotCanvas.getContext('2d');
        this._hudBotTex    = new THREE.CanvasTexture(this._hudBotCanvas);
        this._hudBot = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.019), mkMat(this._hudBotTex));

        [this._hudL, this._hudR, this._hudTop, this._hudBot].forEach(function (m) { m.renderOrder = 9999; });
        this._drawHud([]);
    };

    // Draw one HUD panel — minimal monochrome, no decoration
    VRManager.prototype._drawHudPanel = function (ctx, canvas, lines, side) {
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Subtle background
        ctx.fillStyle = 'rgba(0,0,0,0.50)';
        ctx.fillRect(0, 0, W, H);

        var PAD   = 20;
        var isLeft = side === 'left';
        var align  = isLeft ? 'left' : 'right';
        var xBase  = isLeft ? PAD : W - PAD;

        ctx.textBaseline = 'top';
        ctx.textAlign    = align;

        // Page name
        var page = window.location.pathname.split('/').pop().replace('.html', '').toUpperCase() || 'EXPLORER';
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.font      = '400 54px "BureauGrotesque", sans-serif';
        ctx.fillText(page, xBase, PAD);

        // Rule
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(PAD, PAD + 66, W - PAD * 2, 1);

        // Stats — left panel: first half; right panel: second half
        var half   = Math.ceil(lines.length / 2);
        var subset = isLeft ? lines.slice(0, half) : lines.slice(half);
        ctx.font = '300 19px "Inter", sans-serif';
        subset.forEach(function (line, i) {
            var y   = PAD + 80 + i * 34;
            var col = line.indexOf(':');
            if (col > -1) {
                var lbl = line.slice(0, col + 1);
                var val = line.slice(col + 1).trim();
                if (isLeft) {
                    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(lbl + ' ', xBase, y);
                    ctx.fillStyle = 'rgba(255,255,255,0.80)'; ctx.fillText(val, xBase + ctx.measureText(lbl + ' ').width, y);
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.80)'; ctx.fillText(val, xBase, y);
                    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(' ' + lbl, xBase - ctx.measureText(val).width, y);
                }
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.65)';
                ctx.fillText(line, xBase, y);
            }
        });
    };

    VRManager.prototype._drawHudTop = function () {
        var ctx = this._hudTopCtx, W = this._hudTopCanvas.width, H = this._hudTopCanvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle    = 'rgba(255,255,255,0.75)';
        ctx.font         = '400 24px "BureauGrotesque", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ANATOMY OF BITCOIN EXPLORER', W / 2, H / 2);
        this._hudTopTex.needsUpdate = true;
    };

    VRManager.prototype._drawHudBot = function () {
        var ctx = this._hudBotCtx, W = this._hudBotCanvas.width, H = this._hudBotCanvas.height;
        ctx.clearRect(0, 0, W, H);
        var discEl = document.querySelector('.disclaimer');
        var txt = discEl ? discEl.textContent.trim().replace(/\s+/g, ' ') : '';
        ctx.fillStyle    = 'rgba(255,255,255,0.25)';
        ctx.font         = '300 16px "Inter", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, W / 2, H / 2);
        this._hudBotTex.needsUpdate = true;
    };

    VRManager.prototype._drawHud = function (lines) {
        this._drawHudPanel(this._hudLCtx, this._hudLCanvas, lines, 'left');
        this._drawHudPanel(this._hudRCtx, this._hudRCanvas, lines, 'right');
        this._drawHudTop();
        this._drawHudBot();
        this._hudLTex.needsUpdate = true;
        this._hudRTex.needsUpdate = true;
    };

    VRManager.prototype._attachHud = function () {
        if (!this._hudL) this._buildHud();
        if (!this._hudPivot) {
            // Side panels: ±21cm from center, at eye level, 45cm in front
            // Top/bottom strips: centered, above/below side panels
            var Z = -0.45;
            this._hudPivot = new THREE.Group();
            this._hudL.position.set(-0.21,   0,     Z);
            this._hudR.position.set( 0.21,   0,     Z);
            this._hudTop.position.set(0,     0.22, Z);   // near top of comfortable FOV
            this._hudBot.position.set(0,    -0.22, Z);   // near bottom of comfortable FOV
            [this._hudL, this._hudR, this._hudTop, this._hudBot].forEach(function (m) {
                m.quaternion.identity();
            });
            this._hudPivot.add(this._hudL);
            this._hudPivot.add(this._hudR);
            this._hudPivot.add(this._hudTop);
            this._hudPivot.add(this._hudBot);
        }
        this.explorer.scene.add(this._hudPivot);
        [this._hudL, this._hudR, this._hudTop, this._hudBot].forEach(function (m) { m.visible = true; });
    };

    VRManager.prototype._detachHud = function () {
        if (this._hudPivot) this.explorer.scene.remove(this._hudPivot);
    };

    // Called every frame: mirror the XR camera's world transform into _hudPivot.
    // getWorldPosition/Quaternion call updateWorldMatrix() first, ensuring we read the
    // XR system's current pose values rather than a stale matrixWorld.
    VRManager.prototype._updateHudTransform = function () {
        if (!this._hudPivot || !this._hudL || !this._hudL.visible) return;
        var xrCam = this.explorer.renderer.xr.getCamera();
        var pos   = new THREE.Vector3();
        var quat  = new THREE.Quaternion();
        xrCam.getWorldPosition(pos);
        xrCam.getWorldQuaternion(quat);
        this._hudPivot.position.copy(pos);
        this._hudPivot.quaternion.copy(quat);
    };

    // -------------------------------------------------------------------------
    // Per-frame update (called from each explorer's animate())
    // -------------------------------------------------------------------------

    VRManager.prototype.update = function () {
        if (!this.explorer.renderer.xr.isPresenting) return;

        // On the very first frame the XR camera pose is tracked — place model in front of user
        if (this._needsInitialPlacement) {
            this._placeInFrontOfUser();
            this._needsInitialPlacement = false;
        }

        // Keep spatial panel facing the XR camera
        if (this.spatialPanel && this.spatialPanel.getMesh().visible) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            if (xrCam) this.spatialPanel.getMesh().lookAt(xrCam.position);
        }

        // Nav menu hover (right controller ray)
        if (this.controller0 && this.navMenu) {
            this.navMenu.updateHover(this.controller0);
        }

        // HUD — keep glued to viewer head
        this._updateHudTransform();

        // Minority report pan / tilt / scale
        this._updateInteraction();
    };

    // -------------------------------------------------------------------------

    if (typeof window !== 'undefined') window.VRManager = VRManager;
})();
