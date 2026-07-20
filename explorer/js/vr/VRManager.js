/**
 * VRManager — WebXR session lifecycle, controller setup, and spatial UI coordination.
 *
 * Controller mapping (both schemes supported):
 *   Right thumbstick (X/Y)         — rotate scene
 *   Left  thumbstick (Y)           — scale scene (up = bigger)
 *   Left  thumbstick (X)           — strafe / pan scene horizontally
 *   Right / left trigger (hold)    — rotate / tilt the scene
 *   Both triggers (hold)           — pinch-to-scale
 *   Right trigger (tap / nav)      — select scene object  /  confirm nav menu item
 *   Left / right grip (hold+drag)  — grab and pan / move the scene in space
 *   Left  grip (tap)               — toggle wrist nav menu  (hold both grips → reset)
 *   Right grip (tap)               — toggle HUD             (hold both grips → reset)
 *
 * AR / MR support: detects immersive-ar blend mode → transparent background,
 * no scene fog, tighter initial scale (table-top feel), reduced HUD opacity.
 *
 * Exposed as window.VRManager.
 */
(function () {
    'use strict';

    // Initial scale factors in VR: scene units → metres
    var SCALE_MAP_VR = {
        'network.html':     0.005,
        'blockchain.html':  0.05,
        'block.html':       0.1,
        'difficulty.html':  0.05,
        'transaction.html': 0.02,
        'mempool.html':     0.05,
        'node.html':        0.05,
        'address.html':     0.1,
    };

    // Tighter scales for AR (table-top)
    var SCALE_MAP_AR = {
        'network.html':     0.002,
        'blockchain.html':  0.02,
        'block.html':       0.04,
        'difficulty.html':  0.02,
        'transaction.html': 0.01,
        'mempool.html':     0.02,
        'node.html':        0.02,
        'address.html':     0.04,
    };

    var SCALE_MIN        = 1e-5;
    var SCALE_MAX        = 1e4;
    var ROT_SENSITIVITY  = 8;       // radians of rotation per metre of controller travel
    var TAP_MOVE_MAX     = 0.04;    // metres — below this, release counts as a tap (not a drag)
    var THUMBSTICK_DEAD  = 0.12;
    var THUMBSTICK_ROT   = 0.025;   // radians per frame per unit axis deflection
    var THUMBSTICK_SCALE = 0.03;    // scale factor per frame per unit axis deflection
    var THUMBSTICK_PAN   = 0.02;    // metres per frame per unit axis deflection

    // HUD corner geometry (all panels at 60 cm — comfortable reading distance)
    var HUD_Z        = -0.60;
    var HUD_W        = 0.18;        // panel physical width (m)
    var HUD_H_TOP    = 0.068;       // top panels physical height (m)
    var HUD_H_BOT    = 0.092;       // bottom panels physical height (m)
    var HUD_X        = 0.20;        // horizontal offset from center
    var HUD_Y_TOP    = 0.12;        // upward offset for top panels
    var HUD_Y_BOT    = 0.09;        // downward offset for bottom panels
    var HUD_CW       = 512;         // canvas pixel width (all panels)
    var HUD_CH_TOP   = 192;         // canvas pixel height (top panels)
    var HUD_CH_BOT   = 256;         // canvas pixel height (bottom panels)

    // -------------------------------------------------------------------------

    function VRManager(explorer, options) {
        options = options || {};
        this.explorer   = explorer;
        this.panelTitle = options.panelTitle || 'Info';
        this.panelDomId = options.panelDomId || null;

        this.controller0 = null;   // right hand (ray source)
        this.controller1 = null;   // left hand
        this._grip0      = null;   // right controller grip (model host)
        this._grip1      = null;   // left controller grip (model host)
        this._ray0       = null;   // right ray Line mesh
        this._ray1       = null;   // left ray Line mesh

        this.spatialPanel   = null;
        this.navMenu        = null;
        this._panelInterval = null;
        this.interactables  = [];

        this._origControlsUpdate = null;
        this._wasRotating        = false;
        this._wasMontageActive   = false;

        // Pivot — wraps scene content so scale/rotation don't affect controllers/HUD
        this.pivot                  = null;
        this._needsInitialPlacement = false;

        // Mode
        this._isAR      = false;
        this._savedBg   = undefined;
        this._savedFog  = undefined;

        // HUD — 4 corner panels (rebuilt each session to pick up AR/VR opacity)
        this._hudPivot   = null;
        this._hudTL      = null;  this._hudTLCanvas = null;  this._hudTLCtx = null;  this._hudTLTex = null;
        this._hudTR      = null;  this._hudTRCanvas = null;  this._hudTRCtx = null;  this._hudTRTex = null;
        this._hudBL      = null;  this._hudBLCanvas = null;  this._hudBLCtx = null;  this._hudBLTex = null;
        this._hudBR      = null;  this._hudBRCanvas = null;  this._hudBRCtx = null;  this._hudBRTex = null;
        this._hudBgAlpha = 0.82;

        // Saved camera state for XR session
        this._savedCameraPos  = null;
        this._savedCameraQuat = null;

        // Interaction state
        this._grip0Held          = false;
        this._grip1Held          = false;
        this._bothGripsResetDone = false;
        this._gripTravel0        = 0;
        this._gripTravel1        = 0;
        this._gripDragPrev0      = new THREE.Vector3();
        this._gripDragPrev1      = new THREE.Vector3();

        // Trigger / pinch state (legacy drag scheme, kept alongside thumbsticks)
        this._trigger0       = false;
        this._trigger1       = false;
        this._prevPos0       = new THREE.Vector3();
        this._prevPos1       = new THREE.Vector3();
        this._pinchInitDist  = 0;
        this._pinchInitScale = 1;
        this._triggerTravel0 = 0;   // cumulative right-trigger drag for tap vs hold

        // Selection
        this._raycaster    = new THREE.Raycaster();
        this._labelMesh    = null;

        // Scene.add/remove hooks — route late content into pivot during XR
        this._origSceneAdd    = null;
        this._origSceneRemove = null;
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------

    VRManager.prototype.init = function () {
        var self     = this;
        var renderer = this.explorer.renderer;

        renderer.xr.enabled = true;

        if (typeof VRButton !== 'undefined') {
            VRButton.createButton(renderer);
        }

        renderer.xr.addEventListener('sessionstart', function () { self._onSessionStart(); });
        renderer.xr.addEventListener('sessionend',   function () { self._onSessionEnd(); });

        this._setupControllers();

        if (typeof SpatialPanel !== 'undefined') {
            this.spatialPanel = new SpatialPanel({ title: this.panelTitle });
            this.spatialPanel.attachToScene(this.explorer.scene);
        }

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

        // Visual rays — right is full opacity, left is dimmer
        var rayPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)];
        var rayGeo = new THREE.BufferGeometry().setFromPoints(rayPts);
        this._ray0 = new THREE.Line(rayGeo,         new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
        this._ray1 = new THREE.Line(rayGeo.clone(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
        this.controller0.add(this._ray0);
        this.controller1.add(this._ray1);

        // Controller grip models (XRControllerModelFactory loaded via importmap)
        this._grip0 = renderer.xr.getControllerGrip(0);
        this._grip1 = renderer.xr.getControllerGrip(1);
        if (typeof XRControllerModelFactory !== 'undefined') {
            var factory = new XRControllerModelFactory();
            this._grip0.add(factory.createControllerModel(this._grip0));
            this._grip1.add(factory.createControllerModel(this._grip1));
        }
        scene.add(this._grip0);
        scene.add(this._grip1);
        scene.add(this.controller0);
        scene.add(this.controller1);

        // ── Right trigger — hold = pan/tilt; both = pinch; tap = select / nav ─
        this.controller0.addEventListener('selectstart', function () {
            self._trigger0 = true;
            self._triggerTravel0 = 0;
            self.controller0.getWorldPosition(self._prevPos0);
            self._pinchInitDist = 0;
            if (self.navMenu && self.navMenu.group.visible) {
                self.navMenu.selectHighlighted();
                self._haptic('right', 50, 0.4);
                // Treat as consumed — don't also drag/select on release
                self._triggerTravel0 = TAP_MOVE_MAX + 1;
            }
        });
        this.controller0.addEventListener('selectend', function () {
            var wasTap = self._trigger0 && !self._trigger1 && self._triggerTravel0 < TAP_MOVE_MAX;
            self._trigger0 = false;
            self._pinchInitDist = 0;
            if (wasTap) {
                self._trySelectObject();
            }
            self._triggerTravel0 = 0;
        });

        // ── Left trigger — hold = pan/tilt; both = pinch ──────────────────────
        this.controller1.addEventListener('selectstart', function () {
            self._trigger1 = true;
            self.controller1.getWorldPosition(self._prevPos1);
            self._pinchInitDist = 0;
        });
        this.controller1.addEventListener('selectend', function () {
            self._trigger1 = false;
            self._pinchInitDist = 0;
        });

        // ── Left grip — hold+drag = pan; tap = nav menu; both grips = reset ───
        this.controller1.addEventListener('squeezestart', function () {
            self._grip1Held = true;
            self._gripTravel1 = 0;
            self.controller1.getWorldPosition(self._gripDragPrev1);
            if (self._grip0Held && !self._bothGripsResetDone) {
                self._bothGripsResetDone = true;
                self._gripTravel0 = self._gripTravel1 = TAP_MOVE_MAX + 1;
                self._resetScene();
            }
        });
        this.controller1.addEventListener('squeezeend', function () {
            var wasTap = self._grip1Held && !self._bothGripsResetDone && self._gripTravel1 < TAP_MOVE_MAX;
            self._grip1Held = false;
            self._bothGripsResetDone = false;
            self._gripTravel1 = 0;
            if (wasTap && self.navMenu) {
                self.navMenu.toggle();
                self._haptic('left', 30, 0.25);
            }
        });

        // ── Right grip — hold+drag = pan; tap = HUD; both grips = reset ───────
        this.controller0.addEventListener('squeezestart', function () {
            self._grip0Held = true;
            self._gripTravel0 = 0;
            self.controller0.getWorldPosition(self._gripDragPrev0);
            if (self._grip1Held && !self._bothGripsResetDone) {
                self._bothGripsResetDone = true;
                self._gripTravel0 = self._gripTravel1 = TAP_MOVE_MAX + 1;
                self._resetScene();
            }
        });
        this.controller0.addEventListener('squeezeend', function () {
            var wasTap = self._grip0Held && !self._bothGripsResetDone && self._gripTravel0 < TAP_MOVE_MAX;
            self._grip0Held = false;
            self._bothGripsResetDone = false;
            self._gripTravel0 = 0;
            if (wasTap) {
                self._toggleHud();
                self._haptic('right', 30, 0.25);
            }
        });
    };

    // -------------------------------------------------------------------------
    // Haptics
    // -------------------------------------------------------------------------

    VRManager.prototype._haptic = function (handedness, durationMs, intensity) {
        var session = this.explorer.renderer.xr.getSession();
        if (!session || !session.inputSources) return;
        for (var i = 0; i < session.inputSources.length; i++) {
            var src = session.inputSources[i];
            if (src.handedness === handedness && src.gamepad &&
                src.gamepad.hapticActuators && src.gamepad.hapticActuators.length > 0) {
                try { src.gamepad.hapticActuators[0].pulse(intensity, durationMs); } catch (e) {}
            }
        }
    };

    // -------------------------------------------------------------------------
    // Both-grips reset
    // -------------------------------------------------------------------------

    VRManager.prototype._resetScene = function () {
        if (!this.pivot) return;
        var page     = window.location.pathname.split('/').pop() || 'network.html';
        var scaleMap = this._isAR ? SCALE_MAP_AR : SCALE_MAP_VR;
        var scale    = scaleMap[page] || 0.05;
        this.pivot.scale.setScalar(scale);
        this.pivot.rotation.set(0, 0, 0);
        this._placeInFrontOfUser();
        this._haptic('left',  80, 0.5);
        this._haptic('right', 80, 0.5);
    };

    // -------------------------------------------------------------------------
    // Object selection + label
    // -------------------------------------------------------------------------

    VRManager.prototype._trySelectObject = function () {
        if (!this.pivot) return;

        var tempMat = new THREE.Matrix4();
        tempMat.identity().extractRotation(this.controller0.matrixWorld);
        this._raycaster.ray.origin.setFromMatrixPosition(this.controller0.matrixWorld);
        this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMat);

        var hits = this._raycaster.intersectObjects(this.pivot.children, true);
        if (hits.length === 0) return;

        var obj = hits[0].object;
        this._haptic('right', 50, 0.4);
        this._showObjectLabel(obj, hits[0].point);

        if (this.spatialPanel) {
            var lines = this._getObjectLines(obj);
            this.spatialPanel.update(lines);
            this.spatialPanel.setVisible(true);
            this._positionPanel();
        }
    };

    VRManager.prototype._getObjectLines = function (obj) {
        var lines = [];
        if (obj.userData) {
            Object.keys(obj.userData).forEach(function (k) {
                var v = obj.userData[k];
                if (typeof v === 'string' || typeof v === 'number') {
                    lines.push(k + ': ' + v);
                }
            });
        }
        return lines.length > 0 ? lines : this._readPanelLines();
    };

    VRManager.prototype._showObjectLabel = function (obj, worldPoint) {
        if (this._labelMesh) {
            this.explorer.scene.remove(this._labelMesh);
            if (this._labelMesh.material.map) this._labelMesh.material.map.dispose();
            this._labelMesh = null;
        }

        var canvas = document.createElement('canvas');
        canvas.width = 384; canvas.height = 80;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        ctx.fillRect(0, 0, 384, 80);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 382, 78);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = '300 26px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var name = obj.userData.name || obj.name || obj.type || 'Object';
        ctx.fillText(String(name).toUpperCase(), 192, 40);

        var tex = new THREE.CanvasTexture(canvas);
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
        this._labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.031), mat);
        this._labelMesh.renderOrder = 9999;
        this._labelMesh.position.copy(worldPoint).y += 0.09;
        this.explorer.scene.add(this._labelMesh);

        var self = this;
        setTimeout(function () {
            if (self._labelMesh) {
                self.explorer.scene.remove(self._labelMesh);
                if (self._labelMesh.material.map) self._labelMesh.material.map.dispose();
                self._labelMesh = null;
            }
        }, 4000);
    };

    // -------------------------------------------------------------------------
    // Session start / end
    // -------------------------------------------------------------------------

    VRManager.prototype._onSessionStart = function () {
        var self     = this;
        var explorer = this.explorer;
        var renderer = explorer.renderer;

        // Detect AR vs VR
        var session    = renderer.xr.getSession();
        this._isAR     = !!(session && session.environmentBlendMode !== 'opaque');
        this._hudBgAlpha = this._isAR ? 0.60 : 0.82;

        // Disable desktop orbit controls
        if (explorer.controls && typeof explorer.controls.update === 'function') {
            this._origControlsUpdate = explorer.controls.update.bind(explorer.controls);
            explorer.controls.update = function () {};
        }

        // Pause auto-rotation / montage
        if (typeof explorer.isRotating !== 'undefined') {
            this._wasRotating   = explorer.isRotating;
            explorer.isRotating = false;
        }
        if (typeof explorer.montageActive !== 'undefined') {
            this._wasMontageActive = explorer.montageActive;
            explorer.montageActive = false;
        }

        // Force perspective camera if needed
        if (explorer.isPerspective === false) {
            var tv = document.getElementById('toggle-view');
            if (tv) tv.click();
        }

        // AR: transparent background, no fog
        if (this._isAR) {
            this._savedBg  = explorer.scene.background;
            this._savedFog = explorer.scene.fog;
            explorer.scene.background = null;
            explorer.scene.fog        = null;
            renderer.setClearAlpha(0);
        }

        // Reset XR camera scale — pivot handles scale from now on
        var xrCamera = renderer.xr.getCamera();
        if (xrCamera) xrCamera.scale.setScalar(1);

        // ── Build pivot ────────────────────────────────────────────────────────
        this.pivot = new THREE.Group();
        explorer.scene.children.slice().forEach(function (c) {
            if (!self._shouldKeepInScene(c)) {
                explorer.scene.remove(c);
                self.pivot.add(c);
            }
        });

        var page     = window.location.pathname.split('/').pop() || 'network.html';
        var scaleMap = this._isAR ? SCALE_MAP_AR : SCALE_MAP_VR;
        var scale    = scaleMap[page] || 0.05;
        this.pivot.scale.setScalar(scale);
        this._needsInitialPlacement = true;
        explorer.scene.add(this.pivot);

        // ── Add scene camera to scene so Three.js XR can write its pose into it ─
        // renderer.xr.getCamera() copies the XR headset pose into explorer.camera's
        // position/quaternion BEFORE scene.updateMatrixWorld() runs each frame,
        // making camera children (the HUD) automatically head-locked — same as Asia XR.
        // Must happen AFTER pivot build so the camera isn't swept into the pivot.
        this._savedCameraPos  = explorer.camera.position.clone();
        this._savedCameraQuat = explorer.camera.quaternion.clone();
        explorer.scene.add(explorer.camera);

        // Route later scene.add() calls (e.g. network nodes loaded async) into pivot
        this._installSceneHooks();

        // ── HUD ───────────────────────────────────────────────────────────────
        this._attachHud();

        // ── Spatial panel ──────────────────────────────────────────────────────
        if (this.spatialPanel) {
            this._positionPanel();
            this.spatialPanel.setVisible(true);
            if (spatialMesh) this.interactables.push(spatialMesh);
            this._startPanelUpdate();
        }

        // Hide DOM chrome
        ['#ui', 'nav.navbar', '.disclaimer'].forEach(function (sel) {
            var el = sel[0] === '#' ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
            if (el) el.style.visibility = 'hidden';
        });
    };

    // Controllers, grips, HUD host camera, spatial panel, selection label stay at scene root
    VRManager.prototype._shouldKeepInScene = function (obj) {
        if (!obj) return true;
        if (obj === this.pivot) return true;
        if (obj === this.controller0 || obj === this.controller1) return true;
        if (obj === this._grip0 || obj === this._grip1) return true;
        if (obj === this.explorer.camera) return true;
        if (obj === this._labelMesh) return true;
        var spatialMesh = this.spatialPanel ? this.spatialPanel.getMesh() : null;
        if (spatialMesh && obj === spatialMesh) return true;
        return false;
    };

    // During XR, explorer pages keep calling scene.add/remove (async node loads, etc.).
    // Redirect those into the pivot so rotate/scale affects Earth + nodes together.
    VRManager.prototype._installSceneHooks = function () {
        if (this._origSceneAdd || !this.pivot) return;
        var self  = this;
        var scene = this.explorer.scene;

        this._origSceneAdd    = scene.add.bind(scene);
        this._origSceneRemove = scene.remove.bind(scene);

        scene.add = function (object) {
            if (arguments.length > 1) {
                for (var i = 0; i < arguments.length; i++) scene.add(arguments[i]);
                return scene;
            }
            if (!object) return scene;
            if (self._shouldKeepInScene(object) || !self.pivot) {
                return self._origSceneAdd(object);
            }
            return self.pivot.add(object);
        };

        scene.remove = function (object) {
            if (arguments.length > 1) {
                for (var j = 0; j < arguments.length; j++) scene.remove(arguments[j]);
                return scene;
            }
            if (!object) return scene;
            if (self.pivot && object.parent === self.pivot) {
                return self.pivot.remove(object);
            }
            return self._origSceneRemove(object);
        };
    };

    VRManager.prototype._uninstallSceneHooks = function () {
        var scene = this.explorer.scene;
        if (this._origSceneAdd) {
            scene.add = this._origSceneAdd;
            this._origSceneAdd = null;
        }
        if (this._origSceneRemove) {
            scene.remove = this._origSceneRemove;
            this._origSceneRemove = null;
        }
    };

    // Sweep anything that bypassed scene.add into the pivot (local transforms preserved)
    VRManager.prototype._adoptOrphanContent = function () {
        if (!this.pivot) return;
        var self  = this;
        var scene = this.explorer.scene;
        scene.children.slice().forEach(function (c) {
            if (!self._shouldKeepInScene(c)) {
                scene.remove(c);
                self.pivot.add(c);
            }
        });
    };

    VRManager.prototype._onSessionEnd = function () {
        var self     = this;
        var explorer = this.explorer;
        var renderer = explorer.renderer;

        // Restore native scene.add/remove before tearing down the pivot
        this._uninstallSceneHooks();

        // Return pivot children to scene root
        if (this.pivot) {
            this.pivot.children.slice().forEach(function (child) {
                self.pivot.remove(child);
                explorer.scene.add(child);
            });
            explorer.scene.remove(this.pivot);
            this.pivot = null;
        }

        // Restore AR scene state
        if (this._isAR) {
            if (typeof this._savedBg  !== 'undefined') explorer.scene.background = this._savedBg;
            if (typeof this._savedFog !== 'undefined') explorer.scene.fog        = this._savedFog;
            renderer.setClearAlpha(1);
        }
        this._isAR = false;

        // Restore orbit controls
        if (this._origControlsUpdate && explorer.controls) {
            explorer.controls.update = this._origControlsUpdate;
            this._origControlsUpdate = null;
        }

        // Restore auto-rotation / montage
        if (typeof explorer.isRotating !== 'undefined')    explorer.isRotating    = this._wasRotating;
        if (typeof explorer.montageActive !== 'undefined') explorer.montageActive = this._wasMontageActive;

        // Clean up selection label
        if (this._labelMesh) {
            explorer.scene.remove(this._labelMesh);
            if (this._labelMesh.material.map) this._labelMesh.material.map.dispose();
            this._labelMesh = null;
        }

        // Restore scene camera to its original position outside the scene graph
        explorer.scene.remove(explorer.camera);
        if (this._savedCameraPos) {
            explorer.camera.position.copy(this._savedCameraPos);
            explorer.camera.quaternion.copy(this._savedCameraQuat);
            this._savedCameraPos = this._savedCameraQuat = null;
        }

        // Hide panel + HUD, clear HUD objects so they rebuild fresh next session
        if (this.spatialPanel) this.spatialPanel.setVisible(false);
        this._detachHud();
        this._hudTL = null; this._hudTR = null; this._hudBL = null; this._hudBR = null;
        this._hudPivot = null;
        this._stopPanelUpdate();
        this.interactables = [];

        // Reset grip / trigger state
        this._grip0Held = this._grip1Held = this._bothGripsResetDone = false;
        this._gripTravel0 = this._gripTravel1 = 0;
        this._trigger0 = this._trigger1 = false;
        this._pinchInitDist = 0;
        this._triggerTravel0 = 0;
        this._needsInitialPlacement = false;

        // Restore DOM chrome
        ['#ui', 'nav.navbar', '.disclaimer'].forEach(function (sel) {
            var el = sel[0] === '#' ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
            if (el) el.style.visibility = '';
        });
    };

    // -------------------------------------------------------------------------
    // Initial placement
    // -------------------------------------------------------------------------

    VRManager.prototype._placeInFrontOfUser = function () {
        if (!this.pivot) return;
        var xrCamera = this.explorer.renderer.xr.getCamera();
        var camPos   = new THREE.Vector3();
        var camDir   = new THREE.Vector3();
        xrCamera.getWorldPosition(camPos);
        xrCamera.getWorldDirection(camDir);

        var forward = new THREE.Vector3(camDir.x, 0, camDir.z);
        if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
        forward.normalize();

        var dist = this._isAR ? 0.5 : 0.8;
        this.pivot.position.set(
            camPos.x + forward.x * dist,
            camPos.y - 0.15,
            camPos.z + forward.z * dist
        );
    };

    // -------------------------------------------------------------------------
    // Scene control (per-frame): grip pan + trigger rotate/pinch + thumbsticks
    // -------------------------------------------------------------------------

    // Grip hold + move — translate the pivot in world space (grab-drag)
    VRManager.prototype._updateGripDrag = function () {
        if (this._bothGripsResetDone) return false;
        if (!this._grip0Held && !this._grip1Held) return false;
        // Both grips reserved for reset — don't pan while both are down
        if (this._grip0Held && this._grip1Held) return false;

        if (this._grip0Held) {
            var pos0 = new THREE.Vector3();
            this.controller0.getWorldPosition(pos0);
            var d0 = pos0.clone().sub(this._gripDragPrev0);
            if (d0.length() < 0.5) {
                this.pivot.position.add(d0);
                this._gripTravel0 += d0.length();
            }
            this._gripDragPrev0.copy(pos0);
            return true;
        }

        var pos1 = new THREE.Vector3();
        this.controller1.getWorldPosition(pos1);
        var d1 = pos1.clone().sub(this._gripDragPrev1);
        if (d1.length() < 0.5) {
            this.pivot.position.add(d1);
            this._gripTravel1 += d1.length();
        }
        this._gripDragPrev1.copy(pos1);
        return true;
    };

    VRManager.prototype._updateTriggerDrag = function () {
        if (!this._trigger0 && !this._trigger1) {
            this._pinchInitDist = 0;
            return false;
        }

        var pos0 = new THREE.Vector3();
        var pos1 = new THREE.Vector3();
        if (this._trigger0) this.controller0.getWorldPosition(pos0);
        if (this._trigger1) this.controller1.getWorldPosition(pos1);

        if (this._trigger0 && this._trigger1) {
            // Both triggers: pinch-to-scale
            var dist = pos0.distanceTo(pos1);
            if (this._pinchInitDist > 0) {
                var ratio = dist / this._pinchInitDist;
                var newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, this._pinchInitScale * ratio));
                this.pivot.scale.setScalar(newScale);
            } else {
                this._pinchInitDist  = dist;
                this._pinchInitScale = this.pivot.scale.x;
            }
            this._prevPos0.copy(pos0);
            this._prevPos1.copy(pos1);
            this._triggerTravel0 = TAP_MOVE_MAX + 1; // pinch cancels tap-select
            return true;
        }

        if (this._trigger0) {
            this._pinchInitDist = 0;
            var d0 = pos0.clone().sub(this._prevPos0);
            if (d0.length() < 0.5) {
                this.pivot.rotation.y += d0.x * ROT_SENSITIVITY;
                this.pivot.rotation.x -= d0.y * ROT_SENSITIVITY;
                this._triggerTravel0 += d0.length();
            }
            this._prevPos0.copy(pos0);
            return true;
        }

        // Left trigger only
        this._pinchInitDist = 0;
        var d1 = pos1.clone().sub(this._prevPos1);
        if (d1.length() < 0.5) {
            this.pivot.rotation.y += d1.x * ROT_SENSITIVITY;
            this.pivot.rotation.x -= d1.y * ROT_SENSITIVITY;
        }
        this._prevPos1.copy(pos1);
        return true;
    };

    VRManager.prototype._readThumbstickAxes = function (gamepad) {
        // Prefer thumbstick axes [2]/[3]; fall back to [0]/[1] for pads with fewer axes
        if (gamepad.axes.length >= 4) {
            return { x: gamepad.axes[2], y: gamepad.axes[3] };
        }
        if (gamepad.axes.length >= 2) {
            return { x: gamepad.axes[0], y: gamepad.axes[1] };
        }
        return null;
    };

    VRManager.prototype._updateThumbsticks = function () {
        var session = this.explorer.renderer.xr.getSession();
        if (!session || !session.inputSources) return;

        for (var i = 0; i < session.inputSources.length; i++) {
            var src = session.inputSources[i];
            if (!src.gamepad) continue;

            var axes = this._readThumbstickAxes(src.gamepad);
            if (!axes) continue;

            var ax = axes.x;
            var ay = axes.y;

            if (src.handedness === 'right') {
                if (Math.abs(ax) > THUMBSTICK_DEAD) this.pivot.rotation.y += ax * THUMBSTICK_ROT;
                if (Math.abs(ay) > THUMBSTICK_DEAD) this.pivot.rotation.x -= ay * THUMBSTICK_ROT;
            } else if (src.handedness === 'left') {
                // X — camera-relative horizontal pan; Y — scale
                if (Math.abs(ax) > THUMBSTICK_DEAD || Math.abs(ay) > THUMBSTICK_DEAD) {
                    if (Math.abs(ax) > THUMBSTICK_DEAD) {
                        var xrCam = this.explorer.renderer.xr.getCamera();
                        var right = new THREE.Vector3(1, 0, 0).applyQuaternion(xrCam.quaternion);
                        right.y = 0;
                        if (right.lengthSq() > 1e-6) {
                            right.normalize();
                            this.pivot.position.addScaledVector(right, ax * THUMBSTICK_PAN);
                        }
                    }
                    if (Math.abs(ay) > THUMBSTICK_DEAD) {
                        var newScale = this.pivot.scale.x * (1 - ay * THUMBSTICK_SCALE);
                        this.pivot.scale.setScalar(Math.max(SCALE_MIN, Math.min(SCALE_MAX, newScale)));
                    }
                }
            }
        }
    };

    VRManager.prototype._updateInteraction = function () {
        if (!this.pivot || !this.explorer.renderer.xr.isPresenting) return;

        // Grip pan > trigger rotate/pinch > thumbsticks
        if (this._updateGripDrag()) return;
        if (this._updateTriggerDrag()) return;
        this._updateThumbsticks();
    };

    // -------------------------------------------------------------------------
    // Spatial panel
    // -------------------------------------------------------------------------

    VRManager.prototype._positionPanel = function () {
        if (!this.spatialPanel) return;
        var xrCam   = this.explorer.renderer.xr.getCamera();
        var cam     = xrCam || this.explorer.camera;
        var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        var right   = new THREE.Vector3(1, 0,  0).applyQuaternion(cam.quaternion);
        var pos     = cam.position.clone()
            .addScaledVector(forward, 1.0)
            .addScaledVector(right,   0.40);
        pos.y = cam.position.y + 0.05;
        this.spatialPanel.setPosition(pos.x, pos.y, pos.z);
        this.spatialPanel.getMesh().lookAt(cam.position);
    };

    VRManager.prototype._toggleHud = function () {
        if (!this._hudTL) return;
        var vis = !this._hudTL.visible;
        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) { if (m) m.visible = vis; });
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
            self._drawHud(lines);
        }, 1000);
        var initLines = this._readPanelLines();
        if (this.spatialPanel) this.spatialPanel.update(initLines);
        this._drawHud(initLines);
    };

    VRManager.prototype._stopPanelUpdate = function () {
        if (this._panelInterval) { clearInterval(this._panelInterval); this._panelInterval = null; }
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
    // HUD — 4 corner panels
    // -------------------------------------------------------------------------

    VRManager.prototype._buildHud = function () {
        var self = this;

        function mkMat(tex) {
            return new THREE.MeshBasicMaterial({
                map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide
            });
        }
        function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

        // Top-left — page title
        this._hudTLCanvas = mkCanvas(HUD_CW, HUD_CH_TOP);
        this._hudTLCtx    = this._hudTLCanvas.getContext('2d');
        this._hudTLTex    = new THREE.CanvasTexture(this._hudTLCanvas);
        this._hudTL       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_TOP), mkMat(this._hudTLTex));

        // Top-right — primary stat
        this._hudTRCanvas = mkCanvas(HUD_CW, HUD_CH_TOP);
        this._hudTRCtx    = this._hudTRCanvas.getContext('2d');
        this._hudTRTex    = new THREE.CanvasTexture(this._hudTRCanvas);
        this._hudTR       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_TOP), mkMat(this._hudTRTex));

        // Bottom-left — secondary stats
        this._hudBLCanvas = mkCanvas(HUD_CW, HUD_CH_BOT);
        this._hudBLCtx    = this._hudBLCanvas.getContext('2d');
        this._hudBLTex    = new THREE.CanvasTexture(this._hudBLCanvas);
        this._hudBL       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_BOT), mkMat(this._hudBLTex));

        // Bottom-right — data source + timestamp
        this._hudBRCanvas = mkCanvas(HUD_CW, HUD_CH_BOT);
        this._hudBRCtx    = this._hudBRCanvas.getContext('2d');
        this._hudBRTex    = new THREE.CanvasTexture(this._hudBRCanvas);
        this._hudBR       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_BOT), mkMat(this._hudBRTex));

        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) { m.renderOrder = 9999; });
        this._drawHud([]);
    };

    // Draw one corner panel.  corner: 'TL' | 'TR' | 'BL' | 'BR'
    VRManager.prototype._drawCorner = function (ctx, canvas, corner, lines) {
        var W   = canvas.width;
        var H   = canvas.height;
        var PAD = 18;
        var bg  = this._hudBgAlpha;

        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = 'rgba(0,0,0,' + bg + ')';
        ctx.fillRect(0, 0, W, H);

        // Thin white border (hairline)
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(1, 1, W - 2, H - 2);

        ctx.textBaseline = 'top';

        if (corner === 'TL') {
            // Page title — large, left-aligned
            var page = window.location.pathname.split('/').pop().replace('.html', '').toUpperCase() || 'EXPLORER';
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.font      = '400 58px "BureauGrotesque", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(page, PAD, PAD - 4);

            // Thin rule
            ctx.fillStyle = 'rgba(255,255,255,0.10)';
            ctx.fillRect(PAD, PAD + 64, W - PAD * 2, 1);

            // Sub-label
            ctx.fillStyle = 'rgba(255,255,255,0.26)';
            ctx.font      = '300 17px "Inter", sans-serif';
            ctx.fillText('ANATOMY OF BITCOIN', PAD, PAD + 74);

        } else if (corner === 'TR') {
            // Primary stat — right-aligned, value large
            var primary = lines[0] || '';
            var col     = primary.indexOf(':');
            ctx.textAlign = 'right';
            if (col > -1) {
                var lbl = primary.slice(0, col + 1);
                var val = primary.slice(col + 1).trim();
                ctx.font      = '300 17px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.32)';
                ctx.fillText(lbl, W - PAD, PAD);
                ctx.font      = '400 48px "BureauGrotesque", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.fillText(val, W - PAD, PAD + 22);
            } else if (primary) {
                ctx.font      = '400 36px "BureauGrotesque", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.90)';
                ctx.fillText(primary, W - PAD, PAD + 22);
            }

        } else if (corner === 'BL') {
            // Secondary stats — left-aligned label:value pairs
            var secondary = lines.slice(1, 5);
            ctx.textAlign = 'left';
            ctx.font      = '300 22px "Inter", sans-serif';
            secondary.forEach(function (line, i) {
                var y    = PAD + i * 52;
                var colon = line.indexOf(':');
                if (colon > -1) {
                    var sl   = line.slice(0, colon + 1) + ' ';
                    var sv   = line.slice(colon + 1).trim();
                    var lblW = ctx.measureText(sl).width;
                    ctx.fillStyle = 'rgba(255,255,255,0.32)';
                    ctx.fillText(sl, PAD, y);
                    ctx.fillStyle = 'rgba(255,255,255,0.90)';
                    ctx.fillText(sv, PAD + lblW, y);
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.70)';
                    ctx.fillText(line, PAD, y);
                }
            });

        } else if (corner === 'BR') {
            // Data source + timestamp — right-aligned, dim
            var discEl = document.querySelector('.disclaimer');
            var src    = discEl ? discEl.textContent.trim().replace(/\s+/g, ' ') : 'Data: Mempool.space';
            var now    = new Date();
            var ts     = now.toUTCString().replace(/:\d\d GMT$/, ' UTC');

            ctx.textAlign = 'right';
            ctx.font      = '300 19px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fillText(src, W - PAD, PAD);
            ctx.font      = '300 17px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillText(ts, W - PAD, PAD + 30);
        }
    };

    VRManager.prototype._drawHud = function (lines) {
        if (!this._hudTL) return;
        this._drawCorner(this._hudTLCtx, this._hudTLCanvas, 'TL', lines);
        this._drawCorner(this._hudTRCtx, this._hudTRCanvas, 'TR', lines);
        this._drawCorner(this._hudBLCtx, this._hudBLCanvas, 'BL', lines);
        this._drawCorner(this._hudBRCtx, this._hudBRCanvas, 'BR', lines);
        this._hudTLTex.needsUpdate = true;
        this._hudTRTex.needsUpdate = true;
        this._hudBLTex.needsUpdate = true;
        this._hudBRTex.needsUpdate = true;
    };

    VRManager.prototype._attachHud = function () {
        var self = this;
        if (!this._hudTL) this._buildHud();
        this._hudPivot = new THREE.Group();

        this._hudTL.position.set(-HUD_X,  HUD_Y_TOP, HUD_Z);
        this._hudTR.position.set( HUD_X,  HUD_Y_TOP, HUD_Z);
        this._hudBL.position.set(-HUD_X, -HUD_Y_BOT, HUD_Z);
        this._hudBR.position.set( HUD_X, -HUD_Y_BOT, HUD_Z);

        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
            m.quaternion.identity();
            m.frustumCulled = false;
            self._hudPivot.add(m);
        });

        this.explorer.camera.add(this._hudPivot);
        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) { m.visible = true; });
    };

    VRManager.prototype._detachHud = function () {
        if (this._hudPivot) this.explorer.camera.remove(this._hudPivot);
    };

    // Sync HUD pivot to XR head pose every frame.
    // Use xrCam.position / quaternion — these are written directly by the XR system
    // at the start of each animation frame, before renderer.render() runs.
    // matrixWorld is NOT reliable here (it may still reflect the previous frame).
    VRManager.prototype._updateHudTransform = function () {
        if (!this._hudPivot || !this._hudTL || !this._hudTL.visible) return;
        var xrCam = this.explorer.renderer.xr.getCamera();
        this._hudPivot.position.copy(xrCam.position);
        this._hudPivot.quaternion.copy(xrCam.quaternion);
    };

    // Hide right ray when nav menu is closed and nothing interactable is targeted;
    // show both rays when menu is open.
    VRManager.prototype._updateRays = function () {
        if (!this._ray0 || !this._ray1) return;
        var menuOpen = this.navMenu && this.navMenu.group.visible;
        this._ray0.material.opacity = menuOpen ? 0.6 : (this.navMenu && this.navMenu.highlighted ? 0.6 : 0.15);
        this._ray1.visible = menuOpen;
    };

    // -------------------------------------------------------------------------
    // Per-frame update (called from each page's animate loop)
    // -------------------------------------------------------------------------

    VRManager.prototype.update = function () {
        if (!this.explorer.renderer.xr.isPresenting) return;

        if (this._needsInitialPlacement) {
            this._placeInFrontOfUser();
            this._needsInitialPlacement = false;
        }

        // Spatial panel faces XR camera
        if (this.spatialPanel && this.spatialPanel.getMesh().visible) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            if (xrCam) this.spatialPanel.getMesh().lookAt(xrCam.position);
        }

        // Selection label faces XR camera
        if (this._labelMesh) {
            var xrCam2 = this.explorer.renderer.xr.getCamera();
            if (xrCam2) this._labelMesh.lookAt(xrCam2.position);
        }

        // Nav menu hover + haptic tick on new hover
        if (this.controller0 && this.navMenu) {
            var prevHighlight = this.navMenu.highlighted;
            this.navMenu.updateHover(this.controller0);
            if (this.navMenu.highlighted && this.navMenu.highlighted !== prevHighlight) {
                this._haptic('right', 20, 0.2);
            }
        }

        // Context-aware ray opacity
        this._updateRays();

        // Pull in content added after session start (e.g. network nodes)
        this._adoptOrphanContent();

        // Grip pan + trigger rotate/pinch + thumbsticks
        this._updateInteraction();
    };

    // -------------------------------------------------------------------------

    if (typeof window !== 'undefined') window.VRManager = VRManager;
})();
