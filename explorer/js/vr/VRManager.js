/**
 * VRManager — WebXR session lifecycle, controller setup, and spatial UI coordination.
 *
 * Controller mapping (resolved via XRInputSource.handedness — not slot index):
 *   Right thumbstick (X/Y)         — rotate around gaze / near-user focus
 *   Left  thumbstick (Y)           — scale around the same focus point
 *   Left  thumbstick (X)           — strafe / pan scene horizontally
 *   Right / left trigger (hold)    — rotate / tilt (same focus anchor)
 *   Both triggers (hold)           — pinch-to-scale (same focus anchor)
 *   Focus marker                   — visible while rotating or scaling
 *   Right / left trigger (tap)     — select pointed object → HUD  /  confirm nav (right)
 *   Left / right grip (hold+drag)  — grab and pan / move the scene in space
 *   Left  grip (tap)               — toggle wrist nav menu  (hold both grips → reset)
 *   Right grip (tap)               — toggle HUD (staggered reveal; both grips → reset)
 *   Pointers                       — rays on both controllers; hover scales target
 *   HUD                            — staggered corner reveal on show / pointer select
 *
 * Note: getController(0/1) is connection order only. Quest and the Immersive Web
 * Emulator often disagree on which index is left/right; handedness keeps them aligned.
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
    var HOVER_SCALE      = 1.15;    // scale-up while a pointer aims at an object
    var RAY_IDLE_OPACITY = 0.35;
    var RAY_HIT_OPACITY  = 0.85;
    var RAY_LENGTH       = 4;       // metres
    var THUMBSTICK_DEAD  = 0.12;
    var THUMBSTICK_ROT   = 0.025;   // radians per frame per unit axis deflection
    var THUMBSTICK_SCALE = 0.03;    // scale factor per frame per unit axis deflection
    var THUMBSTICK_PAN   = 0.02;    // metres per frame per unit axis deflection
    // Grip-drag pan gain: 1:1 near the model; grows with distance / scale so huge scenes still move
    var GRIP_PAN_REF_DIST  = 0.8;   // metres — typical place-in-front distance
    var GRIP_PAN_REF_SCALE = 0.05;  // typical VR content scale

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
    var HUD_REVEAL_STAGGER = 90;    // ms between corner reveals
    var HUD_REVEAL_DUR     = 320;   // ms ease per corner
    var HUD_REVEAL_SLIDE   = 0.035; // metres — panels ease in from outside
    var HUD_SELECT_HOLD_MS = 8000;  // keep pointer-select info on HUD this long

    // -------------------------------------------------------------------------

    function VRManager(explorer, options) {
        options = options || {};
        this.explorer   = explorer;
        this.panelTitle = options.panelTitle || 'Info';
        this.panelDomId = options.panelDomId || null;

        this.controller0 = null;   // logical right hand (ray source) — after handedness resolve
        this.controller1 = null;   // logical left hand
        this._grip0      = null;   // logical right grip (model host)
        this._grip1      = null;   // logical left grip
        this._ray0       = null;   // right ray Line mesh
        this._ray1       = null;   // left ray Line mesh
        this._rayTip0    = null;   // right hit cursor
        this._rayTip1    = null;   // left hit cursor
        this._rawControllers = null; // [getController(0), getController(1)] — index ≠ hand
        this._rawGrips       = null;
        this._hoveredObj       = null;
        this._hoveredBaseScale = null;
        this._hoverTempMat     = new THREE.Matrix4();
        this._raycasterL       = new THREE.Raycaster();

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
        this._hudBasePos = null;   // resting corner positions
        this._hudReveal  = null;   // staggered reveal animation state
        this._selectionLines = null;
        this._selectionUntil = 0;

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
        this._triggerTravel1 = 0;   // cumulative left-trigger drag for tap vs hold

        // Rotate/scale around a near-user focus point (not the model origin), held per gesture
        this._focusAnchor      = null;
        this._focusAnchorLocal = new THREE.Vector3();
        this._focusAnchorTmp   = new THREE.Vector3();
        this._anchorMarker     = null; // world-space crosshair at the focus point

        // Selection / pointer hover
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

        // Slot index is connection order only — do not treat 0/1 as right/left.
        this._rawControllers = [
            renderer.xr.getController(0),
            renderer.xr.getController(1)
        ];
        this._rawGrips = [
            renderer.xr.getControllerGrip(0),
            renderer.xr.getControllerGrip(1)
        ];

        // Provisional mapping until `connected` reports handedness (Quest-typical).
        this.controller0 = this._rawControllers[0];
        this.controller1 = this._rawControllers[1];
        this._grip0 = this._rawGrips[0];
        this._grip1 = this._rawGrips[1];

        // Pointer rays on both controllers (+ tip cursors at hit point)
        var rayPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -RAY_LENGTH)];
        var rayGeo = new THREE.BufferGeometry().setFromPoints(rayPts);
        this._ray0 = new THREE.Line(rayGeo,         new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: RAY_IDLE_OPACITY }));
        this._ray1 = new THREE.Line(rayGeo.clone(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: RAY_IDLE_OPACITY }));
        this._ray0.visible = true;
        this._ray1.visible = true;
        this.controller0.add(this._ray0);
        this.controller1.add(this._ray1);

        var tipGeo = new THREE.SphereGeometry(0.008, 12, 12);
        var tipMat0 = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 });
        var tipMat1 = tipMat0.clone();
        this._rayTip0 = new THREE.Mesh(tipGeo, tipMat0);
        this._rayTip1 = new THREE.Mesh(tipGeo.clone(), tipMat1);
        this._rayTip0.visible = false;
        this._rayTip1.visible = false;
        this._rayTip0.renderOrder = 1001;
        this._rayTip1.renderOrder = 1001;
        scene.add(this._rayTip0);
        scene.add(this._rayTip1);

        if (typeof XRControllerModelFactory !== 'undefined') {
            var factory = new XRControllerModelFactory();
            this._rawGrips[0].add(factory.createControllerModel(this._rawGrips[0]));
            this._rawGrips[1].add(factory.createControllerModel(this._rawGrips[1]));
        }
        scene.add(this._rawGrips[0]);
        scene.add(this._rawGrips[1]);
        scene.add(this._rawControllers[0]);
        scene.add(this._rawControllers[1]);

        for (var i = 0; i < 2; i++) {
            (function (controller) {
                controller.addEventListener('connected', function (event) {
                    controller.userData.handedness = event.data && event.data.handedness;
                    self._resolveControllerHands();
                });
                controller.addEventListener('disconnected', function () {
                    controller.userData.handedness = undefined;
                    self._resolveControllerHands();
                });

                // Route by handedness so Quest and the WebXR emulator stay aligned
                controller.addEventListener('selectstart', function () {
                    if (self._handRole(controller) === 'right') self._onRightSelectStart();
                    else self._onLeftSelectStart();
                });
                controller.addEventListener('selectend', function () {
                    if (self._handRole(controller) === 'right') self._onRightSelectEnd();
                    else self._onLeftSelectEnd();
                });
                controller.addEventListener('squeezestart', function () {
                    if (self._handRole(controller) === 'right') self._onRightSqueezeStart();
                    else self._onLeftSqueezeStart();
                });
                controller.addEventListener('squeezeend', function () {
                    if (self._handRole(controller) === 'right') self._onRightSqueezeEnd();
                    else self._onLeftSqueezeEnd();
                });
            })(this._rawControllers[i]);
        }
    };

    /** left | right — prefers XR handedness; falls back to slot index (0=right). */
    VRManager.prototype._handRole = function (controller) {
        var h = controller && controller.userData && controller.userData.handedness;
        if (h === 'left' || h === 'right') return h;
        return controller === this._rawControllers[0] ? 'right' : 'left';
    };

    /** Map raw slots → logical controller0/right and controller1/left. */
    VRManager.prototype._resolveControllerHands = function () {
        if (!this._rawControllers) return;

        var right = null;
        var left = null;
        var rightGrip = null;
        var leftGrip = null;

        for (var i = 0; i < 2; i++) {
            var c = this._rawControllers[i];
            var g = this._rawGrips[i];
            if (c.userData.handedness === 'right') {
                right = c;
                rightGrip = g;
            } else if (c.userData.handedness === 'left') {
                left = c;
                leftGrip = g;
            }
        }

        if (!right) {
            right = this._rawControllers[0];
            rightGrip = this._rawGrips[0];
        }
        if (!left) {
            left = this._rawControllers[1];
            leftGrip = this._rawGrips[1];
        }
        if (right === left) {
            var other = right === this._rawControllers[0] ? 1 : 0;
            left = this._rawControllers[other];
            leftGrip = this._rawGrips[other];
        }

        var changed = this.controller0 !== right || this.controller1 !== left;
        this.controller0 = right;
        this.controller1 = left;
        this._grip0 = rightGrip;
        this._grip1 = leftGrip;

        if (changed && this._ray0 && this._ray1) {
            if (this._ray0.parent) this._ray0.parent.remove(this._ray0);
            if (this._ray1.parent) this._ray1.parent.remove(this._ray1);
            right.add(this._ray0);
            left.add(this._ray1);
            if (this.navMenu) this.navMenu.attachToController(left);
        }
    };

    // ── Right trigger — hold = pan/tilt; both = pinch; tap = select / nav ─────
    VRManager.prototype._onRightSelectStart = function () {
        this._trigger0 = true;
        this._triggerTravel0 = 0;
        this.controller0.getWorldPosition(this._prevPos0);
        this._pinchInitDist = 0;
        if (this.navMenu && this.navMenu.group.visible) {
            this.navMenu.selectHighlighted();
            this._haptic('right', 50, 0.4);
            this._triggerTravel0 = TAP_MOVE_MAX + 1;
        }
    };

    VRManager.prototype._onRightSelectEnd = function () {
        var wasTap = this._trigger0 && !this._trigger1 && this._triggerTravel0 < TAP_MOVE_MAX;
        this._trigger0 = false;
        this._pinchInitDist = 0;
        if (wasTap) this._trySelectObject(this.controller0, 'right');
        this._triggerTravel0 = 0;
    };

    // ── Left trigger — hold = pan/tilt; both = pinch; tap = select ────────────
    VRManager.prototype._onLeftSelectStart = function () {
        this._trigger1 = true;
        this._triggerTravel1 = 0;
        this.controller1.getWorldPosition(this._prevPos1);
        this._pinchInitDist = 0;
    };

    VRManager.prototype._onLeftSelectEnd = function () {
        var wasTap = this._trigger1 && !this._trigger0 && this._triggerTravel1 < TAP_MOVE_MAX;
        this._trigger1 = false;
        this._pinchInitDist = 0;
        if (wasTap) this._trySelectObject(this.controller1, 'left');
        this._triggerTravel1 = 0;
    };

    // ── Left grip — hold+drag = pan; tap = nav menu; both grips = reset ───────
    VRManager.prototype._onLeftSqueezeStart = function () {
        this._grip1Held = true;
        this._gripTravel1 = 0;
        this.controller1.getWorldPosition(this._gripDragPrev1);
        if (this._grip0Held && !this._bothGripsResetDone) {
            this._bothGripsResetDone = true;
            this._gripTravel0 = this._gripTravel1 = TAP_MOVE_MAX + 1;
            this._resetScene();
        }
    };

    VRManager.prototype._onLeftSqueezeEnd = function () {
        var wasTap = this._grip1Held && !this._bothGripsResetDone && this._gripTravel1 < TAP_MOVE_MAX;
        this._grip1Held = false;
        this._bothGripsResetDone = false;
        this._gripTravel1 = 0;
        if (wasTap && this.navMenu) {
            this.navMenu.toggle();
            this._haptic('left', 30, 0.25);
        }
    };

    // ── Right grip — hold+drag = pan; tap = HUD; both grips = reset ───────────
    VRManager.prototype._onRightSqueezeStart = function () {
        this._grip0Held = true;
        this._gripTravel0 = 0;
        this.controller0.getWorldPosition(this._gripDragPrev0);
        if (this._grip1Held && !this._bothGripsResetDone) {
            this._bothGripsResetDone = true;
            this._gripTravel0 = this._gripTravel1 = TAP_MOVE_MAX + 1;
            this._resetScene();
        }
    };

    VRManager.prototype._onRightSqueezeEnd = function () {
        var wasTap = this._grip0Held && !this._bothGripsResetDone && this._gripTravel0 < TAP_MOVE_MAX;
        this._grip0Held = false;
        this._bothGripsResetDone = false;
        this._gripTravel0 = 0;
        if (wasTap) {
            this._toggleHud();
            this._haptic('right', 30, 0.25);
        }
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
        this._clearHover();
        this._clearFocusAnchor();
        this._placeInFrontOfUser();
        this._haptic('left',  80, 0.5);
        this._haptic('right', 80, 0.5);
    };

    // -------------------------------------------------------------------------
    // Pointer hover + object selection → HUD
    // -------------------------------------------------------------------------

    VRManager.prototype._castFromController = function (controller, raycaster) {
        if (!controller || !this.pivot) return null;
        this._hoverTempMat.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._hoverTempMat);
        var hits = raycaster.intersectObjects(this.pivot.children, true);
        if (!hits.length) return null;
        // Prefer meshes with useful userData (skip empty helpers)
        for (var i = 0; i < hits.length; i++) {
            var o = this._resolveSelectTarget(hits[i].object);
            if (o && o !== this.pivot) {
                return { object: o, point: hits[i].point, distance: hits[i].distance, hitObject: hits[i].object };
            }
        }
        return { object: hits[0].object, point: hits[0].point, distance: hits[0].distance, hitObject: hits[0].object };
    };

    VRManager.prototype._resolveSelectTarget = function (obj) {
        var o = obj;
        while (o && o !== this.pivot) {
            var ud = o.userData || {};
            if (
                ud.isMempool || ud.isGenesis || ud.isMilestone ||
                ud.txid || ud.address || ud.blockHeight != null ||
                (typeof ud.index === 'number' && (ud.t != null || ud.progress != null || ud.layer != null)) ||
                ud.type === 'currentBlock' || ud.type === 'pastBlock' || ud.type === 'futureBlock' ||
                ud.type === 'header' || ud.type === 'blockUtxo' ||
                ud.name || ud.label
            ) {
                return o;
            }
            o = o.parent;
        }
        return obj;
    };

    VRManager.prototype._clearHover = function () {
        if (this._hoveredObj && this._hoveredBaseScale) {
            this._hoveredObj.scale.copy(this._hoveredBaseScale);
        }
        this._hoveredObj = null;
        this._hoveredBaseScale = null;
    };

    VRManager.prototype._setHover = function (obj) {
        if (this._hoveredObj === obj) return;
        this._clearHover();
        if (!obj || !obj.scale) return;
        this._hoveredObj = obj;
        this._hoveredBaseScale = obj.scale.clone();
        obj.scale.multiplyScalar(HOVER_SCALE);
    };

    VRManager.prototype._updatePointers = function () {
        if (!this.pivot || !this.controller0 || !this.controller1) return;

        var hitR = this._castFromController(this.controller0, this._raycaster);
        var hitL = this._castFromController(this.controller1, this._raycasterL);

        // Prefer nearer hit for hover scale
        var hover = null;
        if (hitR && hitL) hover = hitR.distance <= hitL.distance ? hitR : hitL;
        else hover = hitR || hitL;

        if (hover) this._setHover(hover.object);
        else this._clearHover();

        // Ray + tip feedback
        if (this._ray0) {
            this._ray0.visible = true;
            this._ray0.material.opacity = hitR ? RAY_HIT_OPACITY : RAY_IDLE_OPACITY;
        }
        if (this._ray1) {
            this._ray1.visible = true;
            this._ray1.material.opacity = hitL ? RAY_HIT_OPACITY : RAY_IDLE_OPACITY;
        }
        if (this._rayTip0) {
            if (hitR) {
                this._rayTip0.visible = true;
                this._rayTip0.position.copy(hitR.point);
            } else {
                this._rayTip0.visible = false;
            }
        }
        if (this._rayTip1) {
            if (hitL) {
                this._rayTip1.visible = true;
                this._rayTip1.position.copy(hitL.point);
            } else {
                this._rayTip1.visible = false;
            }
        }
    };

    VRManager.prototype._trySelectObject = function (controller, hand) {
        if (!this.pivot || !controller) return;

        var hit = this._castFromController(controller, this._raycaster);
        if (!hit) return;

        this._haptic(hand || 'right', 50, 0.4);
        this._showSelectionOnHud(hit.object);

        // Optional page hook for loading richer data / side effects
        var ex = this.explorer;
        if (ex && typeof ex.onVRSelect === 'function') {
            try { ex.onVRSelect(hit.object); } catch (e) { /* ignore page errors */ }
        }
    };

    VRManager.prototype._getObjectLines = function (obj) {
        obj = this._resolveSelectTarget(obj);
        var ex = this.explorer;
        if (ex && typeof ex.getVRObjectInfo === 'function') {
            try {
                var custom = ex.getVRObjectInfo(obj);
                if (custom && custom.length) return custom;
            } catch (e) { /* fall through */ }
        }

        var ud = (obj && obj.userData) || {};
        var lines = [];

        if (ud.isMempool) {
            return ['Selected: Mempool', 'Pending transactions', 'Tip of the chain'];
        }
        if (ud.isGenesis || (ud.index === 0 && ud.t != null)) {
            return ['Selected: Genesis', 'Epoch 0', 'Blocks 0 – 2,015', 'Jan 3, 2009'];
        }
        if (typeof ud.index === 'number' && ud.t != null) {
            var start = ud.index * 2016;
            var end = start + 2015;
            lines = ['Selected: Epoch ' + ud.index];
            lines.push('Blocks: ' + start.toLocaleString() + ' – ' + end.toLocaleString());
            if (ud.isMilestone) lines.push('Milestone: Halving epoch');
            return lines;
        }
        if (ud.txid) {
            var short = String(ud.txid);
            if (short.length > 18) short = short.slice(0, 10) + '…' + short.slice(-6);
            lines = ['Selected: Transaction', 'TXID: ' + short];
            if (ud.index != null) lines.push('Index: ' + ud.index);
            if (ud.layer != null) lines.push('Layer: ' + ud.layer);
            if (ud.fee != null) lines.push('Fee: ' + ud.fee);
            if (ud.size != null) lines.push('Size: ' + ud.size);
            return lines;
        }
        if (ud.type === 'header') {
            return ['Selected: Block Header', ud.description || '80 bytes'];
        }
        if (ud.type === 'currentBlock' || ud.type === 'pastBlock' || ud.type === 'futureBlock') {
            var label = ud.type === 'currentBlock' ? 'Current block' : (ud.type === 'pastBlock' ? 'Past block' : 'Future block');
            lines = ['Selected: ' + label];
            if (ud.blockHeight != null) lines.push('Height: ' + Number(ud.blockHeight).toLocaleString());
            return lines;
        }
        if (ud.type === 'blockUtxo' && ud.utxo) {
            var u = ud.utxo;
            lines = ['Selected: UTXO'];
            if (u.value != null) lines.push('Value: ' + (u.value / 1e8).toFixed(8) + ' BTC');
            if (u.txid) lines.push('TXID: ' + String(u.txid).slice(0, 16) + '…');
            return lines;
        }
        if (ud.address || ud.userAgent || ud.country) {
            lines = ['Selected: Node'];
            if (ud.address) lines.push('Addr: ' + ud.address);
            if (ud.type) lines.push('Impl: ' + ud.type);
            if (ud.city || ud.country) lines.push('Loc: ' + [ud.city, ud.country].filter(Boolean).join(', '));
            if (ud.height != null) lines.push('Height: ' + ud.height);
            if (ud.org) lines.push('Org: ' + ud.org);
            return lines;
        }

        var name = ud.name || ud.label || obj.name || obj.type || 'Object';
        lines.push('Selected: ' + name);
        Object.keys(ud).forEach(function (k) {
            if (k === 'name' || k === 'label' || k === 'originalColor') return;
            var v = ud[k];
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                var s = String(v);
                if (s.length > 42) s = s.slice(0, 40) + '…';
                lines.push(k + ': ' + s);
            }
        });
        return lines.length > 1 ? lines : lines.concat(this._readPanelLines());
    };

    VRManager.prototype._showSelectionOnHud = function (obj) {
        var lines = this._getObjectLines(obj);
        this._selectionLines = lines;
        this._selectionUntil = performance.now() + HUD_SELECT_HOLD_MS;

        // Selection lives on the HUD — hide the floating info panel if open
        if (this.spatialPanel) this.spatialPanel.setVisible(false);

        if (!this._hudTL) this._attachHud();
        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
            if (m) m.visible = true;
        });

        this._drawHud(lines);
        this._startHudReveal();
    };

    VRManager.prototype._hudLines = function () {
        if (this._selectionLines && performance.now() < this._selectionUntil) {
            return this._selectionLines;
        }
        if (this._selectionLines && performance.now() >= this._selectionUntil) {
            this._selectionLines = null;
            this._selectionUntil = 0;
        }
        return this._readPanelLines();
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

        // Re-resolve in case `connected` already fired for both hands
        this._resolveControllerHands();

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

        // ── HUD (primary info surface; staggered reveal on enter) ──────────────
        this._attachHud();
        this._startHudReveal();
        this._startPanelUpdate();

        // ── Spatial panel — optional, off by default (HUD replaces it) ─────────
        if (this.spatialPanel) {
            this._positionPanel();
            this.spatialPanel.setVisible(false);
            var spatialMesh = this.spatialPanel.getMesh();
            if (spatialMesh) this.interactables.push(spatialMesh);
        }

        // Hide DOM chrome
        ['#ui', 'nav.navbar', '.disclaimer'].forEach(function (sel) {
            var el = sel[0] === '#' ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
            if (el) el.style.visibility = 'hidden';
        });
    };

        // Controllers, grips, HUD host camera, spatial panel, focus marker, ray tips stay at scene root
    VRManager.prototype._shouldKeepInScene = function (obj) {
        if (!obj) return true;
        if (obj === this.pivot) return true;
        if (obj === this.controller0 || obj === this.controller1) return true;
        if (obj === this._grip0 || obj === this._grip1) return true;
        if (obj === this.explorer.camera) return true;
        if (obj === this._labelMesh) return true;
        if (obj === this._anchorMarker) return true;
        if (obj === this._rayTip0 || obj === this._rayTip1) return true;
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
        this._triggerTravel0 = this._triggerTravel1 = 0;
        this._clearHover();
        this._clearFocusAnchor();
        this._disposeAnchorMarker();
        if (this._rayTip0) this._rayTip0.visible = false;
        if (this._rayTip1) this._rayTip1.visible = false;
        this._selectionLines = null;
        this._selectionUntil = 0;
        this._hudReveal = null;
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

    /**
     * Pan multiplier for grip-drag. Near / small → ~1 (direct hand mapping).
     * Farther from the model or larger scale → higher gain so the scene keeps pace.
     */
    VRManager.prototype._gripPanGain = function () {
        if (!this.pivot) return 1;
        var xrCam = this.explorer.renderer.xr.getCamera();
        var dist = xrCam.position.distanceTo(this.pivot.position);
        var distGain = dist / GRIP_PAN_REF_DIST;
        // sqrt so extreme scales don't teleport; still much faster when huge
        var scaleGain = Math.sqrt(Math.max(this.pivot.scale.x, SCALE_MIN) / GRIP_PAN_REF_SCALE);
        return Math.max(1, distGain, scaleGain);
    };

    // Grip hold + move — translate the pivot in world space (grab-drag)
    VRManager.prototype._updateGripDrag = function () {
        if (this._bothGripsResetDone) return false;
        if (!this._grip0Held && !this._grip1Held) return false;
        // Both grips reserved for reset — don't pan while both are down
        if (this._grip0Held && this._grip1Held) return false;

        var gain = this._gripPanGain();

        if (this._grip0Held) {
            var pos0 = new THREE.Vector3();
            this.controller0.getWorldPosition(pos0);
            var d0 = pos0.clone().sub(this._gripDragPrev0);
            if (d0.length() < 0.5) {
                this.pivot.position.addScaledVector(d0, gain);
                this._gripTravel0 += d0.length(); // physical hand travel (tap vs drag)
            }
            this._gripDragPrev0.copy(pos0);
            return true;
        }

        var pos1 = new THREE.Vector3();
        this.controller1.getWorldPosition(pos1);
        var d1 = pos1.clone().sub(this._gripDragPrev1);
        if (d1.length() < 0.5) {
            this.pivot.position.addScaledVector(d1, gain);
            this._gripTravel1 += d1.length();
        }
        this._gripDragPrev1.copy(pos1);
        return true;
    };

    /**
     * World-space point for rotate/scale.
     * Prefer what you're looking at (ray hit); else a focus point ahead of the camera.
     */
    VRManager.prototype._pickFocusAnchor = function () {
        var xrCam = this.explorer.renderer.xr.getCamera();
        var camPos = xrCam.position;
        var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.quaternion);

        if (this.pivot && this.pivot.children.length) {
            this._raycaster.set(camPos, forward);
            var hits = this._raycaster.intersectObjects(this.pivot.children, true);
            if (hits.length > 0) return hits[0].point.clone();
        }

        var dist = camPos.distanceTo(this.pivot.position);
        var focusDist = Math.max(0.3, Math.min(dist, 1.5));
        return camPos.clone().addScaledVector(forward, focusDist);
    };

    VRManager.prototype._ensureFocusAnchor = function () {
        if (!this._focusAnchor) {
            this._focusAnchor = this._pickFocusAnchor();
        }
        this._showAnchorMarker();
        return this._focusAnchor;
    };

    VRManager.prototype._clearFocusAnchor = function () {
        this._focusAnchor = null;
        this._hideAnchorMarker();
    };

    VRManager.prototype._ensureAnchorMarker = function () {
        if (this._anchorMarker) return this._anchorMarker;

        var group = new THREE.Group();
        group.name = 'vr-focus-anchor';
        group.renderOrder = 1000;

        var sphereMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.95
        });
        var sphere = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 16), sphereMat);
        sphere.renderOrder = 1000;
        group.add(sphere);

        // 3D crosshair arms
        var armLen = 0.045;
        var lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.75
        });
        var axes = [
            [-armLen, 0, 0, armLen, 0, 0],
            [0, -armLen, 0, 0, armLen, 0],
            [0, 0, -armLen, 0, 0, armLen]
        ];
        for (var i = 0; i < axes.length; i++) {
            var a = axes[i];
            var geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(a[0], a[1], a[2]),
                new THREE.Vector3(a[3], a[4], a[5])
            ]);
            var line = new THREE.Line(geo, lineMat);
            line.renderOrder = 1000;
            group.add(line);
        }

        // Soft outer ring (camera-facing disc outline via thin torus)
        var ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.028, 0.0025, 8, 32),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.55
            })
        );
        ring.renderOrder = 1000;
        group.add(ring);
        group.userData.ring = ring;

        group.visible = false;
        this.explorer.scene.add(group);
        this._anchorMarker = group;
        return group;
    };

    VRManager.prototype._showAnchorMarker = function () {
        var marker = this._ensureAnchorMarker();
        if (this._focusAnchor) marker.position.copy(this._focusAnchor);
        marker.visible = true;
    };

    VRManager.prototype._hideAnchorMarker = function () {
        if (this._anchorMarker) this._anchorMarker.visible = false;
    };

    VRManager.prototype._updateAnchorMarker = function () {
        if (!this._anchorMarker || !this._anchorMarker.visible || !this._focusAnchor) return;
        this._anchorMarker.position.copy(this._focusAnchor);
        // Keep ring facing the user
        var ring = this._anchorMarker.userData.ring;
        if (ring) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            ring.lookAt(xrCam.position);
        }
    };

    VRManager.prototype._disposeAnchorMarker = function () {
        if (!this._anchorMarker) return;
        var marker = this._anchorMarker;
        if (marker.parent) marker.parent.remove(marker);
        marker.traverse(function (child) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this._anchorMarker = null;
    };

    /** Keep a world point fixed while changing pivot rotation. */
    VRManager.prototype._applyPivotRotation = function (dRotX, dRotY) {
        if (!this.pivot || (dRotX === 0 && dRotY === 0)) return;

        var anchor = this._ensureFocusAnchor();
        this.pivot.updateMatrixWorld(true);
        this._focusAnchorLocal.copy(anchor);
        this.pivot.worldToLocal(this._focusAnchorLocal);

        this.pivot.rotation.x += dRotX;
        this.pivot.rotation.y += dRotY;
        this.pivot.updateMatrixWorld(true);

        this._focusAnchorTmp.copy(this._focusAnchorLocal);
        this.pivot.localToWorld(this._focusAnchorTmp);
        this.pivot.position.add(anchor).sub(this._focusAnchorTmp);
        this._updateAnchorMarker();
    };

    /** Keep a world point fixed while changing pivot uniform scale. */
    VRManager.prototype._applyPivotScale = function (newScale) {
        if (!this.pivot) return;
        newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, newScale));
        if (Math.abs(newScale - this.pivot.scale.x) < 1e-12) {
            this._ensureFocusAnchor();
            this._updateAnchorMarker();
            return;
        }

        var anchor = this._ensureFocusAnchor();
        this.pivot.updateMatrixWorld(true);
        this._focusAnchorLocal.copy(anchor);
        this.pivot.worldToLocal(this._focusAnchorLocal);

        this.pivot.scale.setScalar(newScale);
        this.pivot.updateMatrixWorld(true);

        this._focusAnchorTmp.copy(this._focusAnchorLocal);
        this.pivot.localToWorld(this._focusAnchorTmp);
        this.pivot.position.add(anchor).sub(this._focusAnchorTmp);
        this._updateAnchorMarker();
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
            // Both triggers: pinch-to-scale around focus anchor
            var dist = pos0.distanceTo(pos1);
            if (this._pinchInitDist > 0) {
                var ratio = dist / this._pinchInitDist;
                this._applyPivotScale(this._pinchInitScale * ratio);
            } else {
                this._pinchInitDist  = dist;
                this._pinchInitScale = this.pivot.scale.x;
                this._ensureFocusAnchor();
                this._updateAnchorMarker();
            }
            this._prevPos0.copy(pos0);
            this._prevPos1.copy(pos1);
            this._triggerTravel0 = this._triggerTravel1 = TAP_MOVE_MAX + 1; // pinch cancels tap-select
            return true;
        }

        if (this._trigger0) {
            this._pinchInitDist = 0;
            var d0 = pos0.clone().sub(this._prevPos0);
            if (d0.length() < 0.5) {
                this._applyPivotRotation(-d0.y * ROT_SENSITIVITY, d0.x * ROT_SENSITIVITY);
                this._triggerTravel0 += d0.length();
            }
            this._prevPos0.copy(pos0);
            return true;
        }

        // Left trigger only
        this._pinchInitDist = 0;
        var d1 = pos1.clone().sub(this._prevPos1);
        if (d1.length() < 0.5) {
            this._applyPivotRotation(-d1.y * ROT_SENSITIVITY, d1.x * ROT_SENSITIVITY);
            this._triggerTravel1 += d1.length();
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
        if (!session || !session.inputSources) return false;

        var transforming = false;

        for (var i = 0; i < session.inputSources.length; i++) {
            var src = session.inputSources[i];
            if (!src.gamepad) continue;

            var axes = this._readThumbstickAxes(src.gamepad);
            if (!axes) continue;

            var ax = axes.x;
            var ay = axes.y;

            if (src.handedness === 'right') {
                var dYaw = 0;
                var dPitch = 0;
                if (Math.abs(ax) > THUMBSTICK_DEAD) dYaw = ax * THUMBSTICK_ROT;
                if (Math.abs(ay) > THUMBSTICK_DEAD) dPitch = -ay * THUMBSTICK_ROT;
                if (dYaw !== 0 || dPitch !== 0) {
                    transforming = true;
                    this._applyPivotRotation(dPitch, dYaw);
                }
            } else if (src.handedness === 'left') {
                // X — camera-relative horizontal pan; Y — scale about focus
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
                        transforming = true;
                        this._applyPivotScale(this.pivot.scale.x * (1 - ay * THUMBSTICK_SCALE));
                    }
                }
            }
        }

        return transforming;
    };

    VRManager.prototype._updateInteraction = function () {
        if (!this.pivot || !this.explorer.renderer.xr.isPresenting) return;

        // Grip pan > trigger rotate/pinch > thumbsticks
        if (this._updateGripDrag()) {
            this._clearFocusAnchor();
            return;
        }
        if (this._updateTriggerDrag()) {
            this._updateAnchorMarker();
            return;
        }
        var transforming = this._updateThumbsticks();
        if (!transforming) this._clearFocusAnchor();
        else this._updateAnchorMarker();
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
        if (vis) {
            [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
                if (m) m.visible = true;
            });
            this._startHudReveal();
        } else {
            this._hudReveal = null;
            [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
                if (m) {
                    m.visible = false;
                    m.material.opacity = 1;
                }
            });
        }
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
            var lines = self._hudLines();
            if (self.spatialPanel && self.spatialPanel.getMesh().visible) {
                self.spatialPanel.update(self._readPanelLines());
            }
            self._drawHud(lines);
        }, 1000);
        this._drawHud(this._hudLines());
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
            ctx.textAlign = 'right';
            if (this._selectionLines && performance.now() < this._selectionUntil) {
                // Pointer-select mode — show selection context instead of feed meta
                var extra = lines.slice(5, 8);
                ctx.font      = '300 17px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.32)';
                ctx.fillText('OBJECT SELECTED', W - PAD, PAD);
                ctx.font      = '300 20px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.78)';
                extra.forEach(function (line, i) {
                    var text = line.length > 36 ? line.slice(0, 34) + '…' : line;
                    ctx.fillText(text, W - PAD, PAD + 34 + i * 28);
                });
                if (extra.length === 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.22)';
                    ctx.font      = '300 17px "Inter", sans-serif';
                    ctx.fillText('Details on left / top', W - PAD, PAD + 34);
                }
            } else {
                // Data source + timestamp — right-aligned, dim
                var discEl = document.querySelector('.disclaimer');
                var src    = discEl ? discEl.textContent.trim().replace(/\s+/g, ' ') : 'Data: Mempool.space';
                var now    = new Date();
                var ts     = now.toUTCString().replace(/:\d\d GMT$/, ' UTC');

                ctx.font      = '300 19px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.fillText(src, W - PAD, PAD);
                ctx.font      = '300 17px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                ctx.fillText(ts, W - PAD, PAD + 30);
            }
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

        this._hudBasePos = {
            TL: new THREE.Vector3(-HUD_X,  HUD_Y_TOP, HUD_Z),
            TR: new THREE.Vector3( HUD_X,  HUD_Y_TOP, HUD_Z),
            BL: new THREE.Vector3(-HUD_X, -HUD_Y_BOT, HUD_Z),
            BR: new THREE.Vector3( HUD_X, -HUD_Y_BOT, HUD_Z)
        };

        this._hudTL.position.copy(this._hudBasePos.TL);
        this._hudTR.position.copy(this._hudBasePos.TR);
        this._hudBL.position.copy(this._hudBasePos.BL);
        this._hudBR.position.copy(this._hudBasePos.BR);

        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
            m.quaternion.identity();
            m.frustumCulled = false;
            m.material.transparent = true;
            self._hudPivot.add(m);
        });

        this.explorer.camera.add(this._hudPivot);
        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) { m.visible = true; });
    };

    VRManager.prototype._detachHud = function () {
        this._hudReveal = null;
        if (this._hudPivot) this.explorer.camera.remove(this._hudPivot);
    };

    /** Staggered corner reveal — opacity + slide-in from outside. */
    VRManager.prototype._startHudReveal = function () {
        if (!this._hudTL || !this._hudBasePos) return;
        var panels = [
            { mesh: this._hudTL, key: 'TL', sx: -1, sy:  1 },
            { mesh: this._hudTR, key: 'TR', sx:  1, sy:  1 },
            { mesh: this._hudBL, key: 'BL', sx: -1, sy: -1 },
            { mesh: this._hudBR, key: 'BR', sx:  1, sy: -1 }
        ];
        panels.forEach(function (p) {
            if (!p.mesh) return;
            p.mesh.visible = true;
            p.mesh.material.opacity = 0;
        });
        this._hudReveal = {
            start: performance.now(),
            panels: panels
        };
        this._updateHudReveal();
    };

    VRManager.prototype._updateHudReveal = function () {
        if (!this._hudReveal || !this._hudBasePos) return;

        var now = performance.now();
        var allDone = true;
        var panels = this._hudReveal.panels;

        for (var i = 0; i < panels.length; i++) {
            var p = panels[i];
            if (!p.mesh) continue;
            var local = (now - this._hudReveal.start - i * HUD_REVEAL_STAGGER) / HUD_REVEAL_DUR;
            if (local < 1) allDone = false;
            var t = local <= 0 ? 0 : (local >= 1 ? 1 : local);
            // easeOutCubic
            var e = 1 - Math.pow(1 - t, 3);
            var base = this._hudBasePos[p.key];
            p.mesh.material.opacity = e;
            p.mesh.position.set(
                base.x + (1 - e) * HUD_REVEAL_SLIDE * p.sx,
                base.y + (1 - e) * HUD_REVEAL_SLIDE * p.sy,
                base.z
            );
        }

        if (allDone) {
            for (var j = 0; j < panels.length; j++) {
                var q = panels[j];
                if (!q.mesh) continue;
                q.mesh.material.opacity = 1;
                q.mesh.position.copy(this._hudBasePos[q.key]);
            }
            this._hudReveal = null;
        }
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

    // Both pointers stay visible; opacity is driven by _updatePointers hit state.
    VRManager.prototype._updateRays = function () {
        if (this._ray0) this._ray0.visible = true;
        if (this._ray1) this._ray1.visible = true;
        // Brighten further when aiming at nav menu items
        if (this.navMenu && this.navMenu.group.visible && this.navMenu.highlighted && this._ray0) {
            this._ray0.material.opacity = Math.max(this._ray0.material.opacity, RAY_HIT_OPACITY);
        }
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

        // Spatial panel faces XR camera (optional; off by default)
        if (this.spatialPanel && this.spatialPanel.getMesh().visible) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            if (xrCam) this.spatialPanel.getMesh().lookAt(xrCam.position);
        }

        // Staggered HUD corner reveal
        this._updateHudReveal();

        // Dual pointers: hover scale + tip cursors
        this._updatePointers();

        // Nav menu hover + haptic tick on new hover
        if (this.controller0 && this.navMenu) {
            var prevHighlight = this.navMenu.highlighted;
            this.navMenu.updateHover(this.controller0);
            if (this.navMenu.highlighted && this.navMenu.highlighted !== prevHighlight) {
                this._haptic('right', 20, 0.2);
            }
        }

        this._updateRays();

        // Pull in content added after session start (e.g. network nodes)
        this._adoptOrphanContent();

        // Grip pan + trigger rotate/pinch + thumbsticks
        this._updateInteraction();
    };

    // -------------------------------------------------------------------------

    if (typeof window !== 'undefined') window.VRManager = VRManager;
})();
