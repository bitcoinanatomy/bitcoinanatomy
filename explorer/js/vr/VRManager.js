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
 *   Right / left trigger (tap)     — select pointed object → HUD
 *   Right / left trigger (double)  — navigate to the pointed object's page
 *   Left / right grip (hold+drag)  — grab and pan / move the scene in space
 *   Left  grip (tap)               — toggle wrist nav menu  (hold both grips → reset)
 *   Wrist MENU chip (pinch/trigger)— toggle nav menu (hand tracking has no grip)
 *   Left pinch, no target (hands)  — toggle nav menu
 *   Right grip (tap)               — toggle HUD (staggered reveal; both grips → reset)
 *   Pointers                       — rays on both controllers; hover/select per-page whitelist
 *   HUD                            — TL page identity, TR page stats, BL+BR selection data
 *
 * Note: getController(0/1) is connection order only. Quest and the Immersive Web
 * Emulator often disagree on which index is left/right; handedness keeps them aligned.
 *
 * AR / MR support: detects immersive-ar blend mode → transparent background,
 * no scene fog, tighter initial scale (table-top feel).
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
        'crypto.html':      0.08,
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
        'crypto.html':      0.03,
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
    var HUD_X        = 0.13;        // horizontal offset from center (inward)
    var HUD_Y_TOP    = 0.00;        // upward offset for top panels
    var HUD_Y_BOT    = 0.12;        // downward offset for bottom panels
    var HUD_CW       = 512;         // canvas pixel width (all panels)
    var HUD_CH_TOP   = 192;         // canvas pixel height (top panels)
    var HUD_CH_BOT   = 256;         // canvas pixel height (bottom panels)
    var HUD_REVEAL_STAGGER = 90;    // ms between corner reveals
    var HUD_REVEAL_DUR     = 320;   // ms ease per corner
    var HUD_REVEAL_SLIDE   = 0.035; // metres — panels ease in from outside
    var HUD_SELECT_HOLD_MS = 8000;  // keep pointer-select info on HUD this long
    var DOUBLE_SELECT_MS   = 450;   // second trigger tap within this window → navigate

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
        this._hudBasePos = null;   // resting corner positions
        this._hudReveal  = null;   // staggered reveal animation state
        this._hudSigs    = { TL: null, TR: null, BL: null, BR: null };
        this._selectionLines = null;
        this._selectionUntil = 0;
        this._selectionKind  = null;   // bitcoin object kind for HUD TL
        this._selectionToken = 0;      // cancels stale mempool fetches
        this._lastSelectObj  = null;   // for double-trigger navigation
        this._lastSelectAt   = 0;

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
        this._focusAnchorTmp   = new THREE.Vector3();
        this._focusAxis       = new THREE.Vector3();
        this._focusQuat       = new THREE.Quaternion();
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
        if (typeof window.ExplorerAudio !== 'undefined') ExplorerAudio.unlock();
        this._trigger0 = true;
        this._triggerTravel0 = 0;
        this.controller0.getWorldPosition(this._prevPos0);
        this._pinchInitDist = 0;
        if (this._tryNavUiSelect(this.controller0, 'right')) {
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
        if (typeof window.ExplorerAudio !== 'undefined') ExplorerAudio.unlock();
        this._trigger1 = true;
        this._triggerTravel1 = 0;
        this.controller1.getWorldPosition(this._prevPos1);
        this._pinchInitDist = 0;
        if (this._tryNavUiSelect(this.controller1, 'left')) {
            this._triggerTravel1 = TAP_MOVE_MAX + 1;
        }
    };

    VRManager.prototype._onLeftSelectEnd = function () {
        var wasTap = this._trigger1 && !this._trigger0 && this._triggerTravel1 < TAP_MOVE_MAX;
        this._trigger1 = false;
        this._pinchInitDist = 0;
        if (wasTap) {
            var hit = this._castFromController(this.controller1, this._raycasterL);
            if (hit) {
                this._trySelectObject(this.controller1, 'left');
            } else if (this.navMenu && this._usingHands()) {
                this.navMenu.toggle();
            }
        }
        this._triggerTravel1 = 0;
    };

    VRManager.prototype._usingHands = function () {
        var session = this.explorer && this.explorer.renderer && this.explorer.renderer.xr.getSession();
        if (!session || !session.inputSources) return false;
        for (var i = 0; i < session.inputSources.length; i++) {
            if (session.inputSources[i].hand) return true;
        }
        return false;
    };

    /** Wrist MENU chip or open nav-menu card/toggle. Returns true if the pinch was consumed. */
    VRManager.prototype._tryNavUiSelect = function (controller, hand) {
        if (!this.navMenu || !controller) return false;
        if (this.navMenu.hitWristChip(controller)) {
            this.navMenu.toggle();
            this._haptic(hand || 'right', 50, 0.4);
            return true;
        }
        if (this.navMenu.group.visible) {
            if (typeof window.ExplorerAudio !== 'undefined' && this.navMenu.highlighted) {
                ExplorerAudio.play('ui-select');
            }
            this.navMenu.selectHighlighted();
            this._haptic(hand || 'right', 50, 0.4);
            return true;
        }
        return false;
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

    VRManager.prototype._pageId = function () {
        return window.location.pathname.split('/').pop() || 'network.html';
    };

    /**
     * Per-page whitelist of pointer-selectable meshes.
     * Non-matching geometry is ignored for hover scale and trigger select.
     * Pages may override via explorer.isVRSelectable(obj).
     */
    VRManager.prototype._isPointerSelectable = function (obj) {
        if (!obj || obj === this.pivot) return false;
        var ex = this.explorer;
        if (ex && typeof ex.isVRSelectable === 'function') {
            try { return !!ex.isVRSelectable(obj); } catch (e) { /* fall through */ }
        }

        var ud = obj.userData || {};
        var page = this._pageId();

        switch (page) {
            case 'blockchain.html':
                // Epoch / genesis / mempool discs only — not UTXO spheres or epoch overlays
                if (ud.epochOverlay) return false;
                return !ud.special && (ud.t != null || ud.isMempool === true);

            case 'block.html':
                // Transaction cuboids only (not header / past-future blocks / UTXOs)
                return !!ud.txid;

            case 'difficulty.html':
                // Spiral blocks + adjacent adjustment discs
                return ud.isBlock === true || ud.isDisc === true;

            case 'network.html':
                // Peer nodes only
                return !!ud.address;

            case 'mempool.html':
                // Fee-rate cuboids
                return ud.feeRate != null || !!ud.txid;

            case 'address.html':
                // History txs + UTXO spheres (not the address body)
                return ud.type === 'transaction' || ud.type === 'utxo';

            case 'transaction.html':
                // Central tx + input/output tubes and caps
                return ud.type === 'transaction' ||
                    ud.type === 'input' || ud.type === 'output' ||
                    ud.type === 'input-cap' || ud.type === 'output-cap';

            case 'node.html':
                // Protocol feature cuboids + helix/spiral navigators
                return !!(ud.name && (ud.type === 'Bitcoin Protocol' || ud.url));

            default:
                return !!(ud.txid || ud.address || ud.isBlock || ud.t != null || ud.type || ud.name);
        }
    };

    VRManager.prototype._castFromController = function (controller, raycaster) {
        if (!controller || !this.pivot) return null;
        this._hoverTempMat.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._hoverTempMat);
        var hits = raycaster.intersectObjects(this.pivot.children, true);
        if (!hits.length) return null;
        // First hit that resolves to a page-allowed selectable
        for (var i = 0; i < hits.length; i++) {
            var o = this._resolveSelectTarget(hits[i].object);
            if (o) {
                return { object: o, point: hits[i].point, distance: hits[i].distance, hitObject: hits[i].object };
            }
        }
        return null;
    };

    VRManager.prototype._resolveSelectTarget = function (obj) {
        var o = obj;
        while (o && o !== this.pivot) {
            if (this._isPointerSelectable(o)) return o;
            o = o.parent;
        }
        return null;
    };

    VRManager.prototype._clearHover = function () {
        if (this._hoveredObj && this._hoveredBaseScale) {
            this._hoveredObj.scale.copy(this._hoveredBaseScale);
        }
        var hadHover = !!this._hoveredObj;
        this._hoveredObj = null;
        this._hoveredBaseScale = null;
        if (hadHover) {
            var exEnd = this.explorer;
            if (exEnd && typeof exEnd.onVRHoverEnd === 'function') {
                try { exEnd.onVRHoverEnd(); } catch (e) { /* ignore page errors */ }
            }
        }
    };

    VRManager.prototype._setHover = function (obj) {
        if (this._hoveredObj === obj) return;
        this._clearHover();
        if (!obj || !obj.scale) return;
        this._hoveredObj = obj;
        this._hoveredBaseScale = obj.scale.clone();
        obj.scale.multiplyScalar(HOVER_SCALE);
        var ex = this.explorer;
        if (ex && typeof ex.onVRHover === 'function') {
            try { ex.onVRHover(obj); } catch (e) { /* ignore page errors */ }
        }
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

        var now = performance.now();
        var isDouble = this._lastSelectObj === hit.object &&
            (now - this._lastSelectAt) < DOUBLE_SELECT_MS;

        if (isDouble) {
            this._lastSelectObj = null;
            this._lastSelectAt = 0;
            this._navigateFromObject(hit.object, hand || 'right');
            return;
        }

        this._lastSelectObj = hit.object;
        this._lastSelectAt = now;

        this._haptic(hand || 'right', 50, 0.4);
        this._showSelectionOnHud(hit.object);

        // Optional page hook for loading richer data / side effects
        var ex = this.explorer;
        if (ex && typeof ex.onVRSelect === 'function') {
            try { ex.onVRSelect(hit.object); } catch (e) { /* ignore page errors */ }
        }
    };

    /**
     * Double-trigger navigation. Pages may handle via onVRDoubleSelect(obj) → true,
     * or supply a URL via getVRNavigateUrl(obj). Otherwise a shared userData map is used.
     */
    VRManager.prototype._navigateFromObject = function (obj, hand) {
        var ex = this.explorer;
        if (ex && typeof ex.onVRDoubleSelect === 'function') {
            try {
                if (ex.onVRDoubleSelect(obj) === true) {
                    this._haptic(hand || 'right', 80, 0.6);
                    return;
                }
            } catch (e) { /* fall through to URL resolve */ }
        }

        var url = this._resolveNavigateUrl(obj);
        if (!url) {
            // Not navigable — keep HUD feedback on the selection
            this._haptic(hand || 'right', 30, 0.2);
            this._showSelectionOnHud(obj);
            return;
        }

        this._haptic(hand || 'right', 80, 0.6);
        if (typeof window.explorerNavigate === 'function') {
            window.explorerNavigate(url);
        } else {
            window.location.href = url;
        }
    };

    /** Map a selectable mesh to an explorer page URL (or null if none). */
    VRManager.prototype._resolveNavigateUrl = function (obj) {
        obj = this._resolveSelectTarget(obj) || obj;
        if (!obj) return null;

        var ex = this.explorer;
        if (ex && typeof ex.getVRNavigateUrl === 'function') {
            try {
                var custom = ex.getVRNavigateUrl(obj);
                if (custom) return custom;
            } catch (e) { /* fall through */ }
        }

        var ud = obj.userData || {};
        var ZERO_TX = '0000000000000000000000000000000000000000000000000000000000000000';

        // Difficulty spiral block → block page
        if (ud.isBlock && ud.blockInfo && ud.blockInfo.height != null) {
            return 'block.html?height=' + ud.blockInfo.height;
        }

        // Difficulty adjacent adjustment disc → that epoch
        if (ud.isDisc && ud.adjustmentIndex != null) {
            return 'difficulty.html?adjustment=' + ud.adjustmentIndex;
        }

        // Blockchain epoch discs
        if (ud.isMempool) return 'mempool.html';
        if (!ud.special && ud.t != null && typeof ud.index === 'number') {
            return 'difficulty.html?adjustment=' + ud.index;
        }

        // Transactions (block / address / mempool cuboids)
        if (ud.txid && String(ud.txid).indexOf('dummy') !== 0) {
            return 'transaction.html?txid=' + encodeURIComponent(ud.txid);
        }
        if (ud.type === 'transaction' && ud.data && ud.data.txid) {
            return 'transaction.html?txid=' + encodeURIComponent(ud.data.txid);
        }
        if (ud.type === 'utxo' && ud.data && ud.data.txid) {
            return 'transaction.html?txid=' + encodeURIComponent(ud.data.txid);
        }
        if (ud.type === 'blockUtxo' && ud.utxo && ud.utxo.txid) {
            return 'transaction.html?txid=' + encodeURIComponent(ud.utxo.txid);
        }

        // Block page: past / future neighbour blocks
        if ((ud.type === 'pastBlock' || ud.type === 'futureBlock') && ud.blockHeight != null) {
            return 'block.html?height=' + ud.blockHeight;
        }

        // Network peer → node page
        if (ud.address) {
            var addr = String(ud.address);
            var m = addr.match(/\[([^\]]+)\]:(\d+)/);
            if (m) addr = m[1] + '-' + m[2];
            else addr = addr.replace(':', '-');
            return 'node.html?node=' + encodeURIComponent(addr);
        }

        // Node protocol feature with explicit URL
        if (ud.url) return ud.url;

        // Transaction page inputs / outputs
        if ((ud.type === 'input' || ud.type === 'input-cap') && !ud.isCoinbase && ud.data && ud.data.txid) {
            if (ud.data.txid !== ZERO_TX) {
                return 'transaction.html?txid=' + encodeURIComponent(ud.data.txid);
            }
        }
        if ((ud.type === 'output' || ud.type === 'output-cap') && ud.spendingData && ud.spendingData.txid) {
            return 'transaction.html?txid=' + encodeURIComponent(ud.spendingData.txid);
        }

        return null;
    };

    // ── Bitcoin formatting helpers (never dump mesh / layout userData) ────────

    VRManager.prototype._shortHash = function (h, head, tail) {
        h = String(h || '');
        head = head == null ? 10 : head;
        tail = tail == null ? 6 : tail;
        if (tail <= 0) {
            if (h.length <= head) return h;
            return h.slice(0, head) + '…';
        }
        if (h.length <= head + tail + 1) return h;
        return h.slice(0, head) + '…' + h.slice(-tail);
    };

    VRManager.prototype._fmtBtc = function (sats) {
        if (sats == null || isNaN(Number(sats))) return null;
        return (Number(sats) / 1e8).toFixed(8) + ' BTC';
    };

    VRManager.prototype._fmtNum = function (n) {
        if (n == null || isNaN(Number(n))) return null;
        return Number(n).toLocaleString();
    };

    VRManager.prototype._fmtTime = function (unixSec) {
        if (unixSec == null) return null;
        try {
            return new Date(Number(unixSec) * 1000).toUTCString().replace(/:\d\d GMT$/, ' UTC');
        } catch (e) { return null; }
    };

    /** Build HUD lines from a mempool.space-style tx object. */
    VRManager.prototype._linesFromTxData = function (tx, txid) {
        tx = tx || {};
        txid = txid || tx.txid;
        var lines = [];
        var feeSats = tx.fee;
        if (feeSats == null && tx.vin && tx.vout) {
            var tin = 0, tout = 0, i;
            for (i = 0; i < tx.vin.length; i++) tin += (tx.vin[i].prevout && tx.vin[i].prevout.value) || 0;
            for (i = 0; i < tx.vout.length; i++) tout += tx.vout[i].value || 0;
            if (tin > 0) feeSats = tin - tout;
        }

        if (feeSats != null && feeSats >= 0) lines.push('Fee: ' + this._fmtNum(feeSats) + ' sats');
        else lines.push('Type: Transaction');

        if (txid) lines.push('TXID: ' + this._shortHash(txid));
        if (tx.size != null) lines.push('Size: ' + this._fmtNum(tx.size) + ' B');
        if (tx.weight != null) lines.push('Weight: ' + this._fmtNum(tx.weight) + ' WU');
        else if (tx.vsize != null) lines.push('VSize: ' + this._fmtNum(tx.vsize) + ' vB');

        var vinN = tx.vin && tx.vin.length;
        var voutN = tx.vout && tx.vout.length;
        if (vinN != null || voutN != null) {
            lines.push('I/O: ' + (vinN || 0) + ' in / ' + (voutN || 0) + ' out');
        }

        if (feeSats != null && tx.vsize) {
            lines.push('Rate: ' + (feeSats / tx.vsize).toFixed(2) + ' sat/vB');
        } else if (feeSats != null && tx.weight) {
            lines.push('Rate: ' + (feeSats / (tx.weight / 4)).toFixed(2) + ' sat/vB');
        }

        if (tx.version != null) lines.push('Version: ' + tx.version);
        if (tx.locktime != null) lines.push('Locktime: ' + tx.locktime);

        if (tx.status) {
            if (tx.status.confirmed) {
                if (tx.status.block_height != null) lines.push('Block: ' + this._fmtNum(tx.status.block_height));
                var t = this._fmtTime(tx.status.block_time);
                if (t) lines.push('Time: ' + t);
                if (tx.status.block_hash) lines.push('Block hash: ' + this._shortHash(tx.status.block_hash));
            } else {
                lines.push('Status: Unconfirmed');
            }
        }
        return lines;
    };

    /**
     * Bitcoin-domain HUD lines for a selected mesh.
     * Reads nested payloads (transactionData / data / blockInfo / utxo) — never
     * dumps layout fields (layer, radius, opacity, position, …).
     */
    VRManager.prototype._getObjectLines = function (obj) {
        obj = this._resolveSelectTarget(obj) || obj;
        if (!obj) {
            this._selectionKind = null;
            return ['Type: —'];
        }
        var ex = this.explorer;
        if (ex && typeof ex.getVRObjectInfo === 'function') {
            try {
                var custom = ex.getVRObjectInfo(obj);
                if (custom) {
                    if (Object.prototype.toString.call(custom) === '[object Array]' && custom.length) {
                        this._selectionKind = 'Selected';
                        return custom;
                    }
                    if (custom.lines && custom.lines.length) {
                        this._selectionKind = custom.kind || 'Selected';
                        return custom.lines;
                    }
                }
            } catch (e) { /* fall through */ }
        }

        var ud = obj.userData || {};
        var lines;
        var kind;

        // ── Difficulty spiral block (nested blockInfo) ────────────────────────
        if (ud.isBlock && ud.blockInfo) {
            kind = 'Block';
            var bi = ud.blockInfo;
            lines = ['Height: ' + this._fmtNum(bi.height)];
            if (bi.nTx != null) lines.push('Txs: ' + this._fmtNum(bi.nTx));
            if (bi.size != null) {
                lines.push(bi.size >= 1024
                    ? ('Size: ' + (bi.size / 1024).toFixed(1) + ' KB')
                    : ('Size: ' + this._fmtNum(bi.size) + ' B'));
            }
            var bt = this._fmtTime(bi.time);
            if (bt) lines.push('Time: ' + bt);
            var bdShort = this._fmtShortDate(bi.time);
            if (bdShort) lines.push('Date: ' + bdShort);
            if (bi.timeDifference != null) {
                var secs = Math.abs(bi.timeDifference);
                var mins = Math.round(secs / 60);
                lines.push('Δ prev: ' + (mins >= 60
                    ? (Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm')
                    : (mins + 'm')));
                lines.push('Δ secs: ' + this._fmtNum(Math.round(secs)));
            }
            if (bi.id || bi.hash) lines.push('Hash: ' + this._shortHash(bi.id || bi.hash));
            if (bi.difficulty != null) lines.push('Diff: ' + (bi.difficulty / 1e12).toFixed(2) + ' T');
            if (bi.weight != null) lines.push('Weight: ' + this._fmtNum(bi.weight) + ' WU');
            var epochOf = bi.height != null ? Math.floor(bi.height / 2016) : null;
            if (epochOf != null) lines.push('Epoch: ' + epochOf);

        // ── Difficulty adjacent adjustment discs ──────────────────────────────
        } else if (ud.isDisc && ud.adjustmentIndex != null) {
            kind = 'Epoch';
            var adj = ud.adjustmentIndex;
            var aStart = adj * 2016;
            var aEnd = aStart + 2015;
            lines = ['Epoch: ' + adj];
            lines.push('Blocks: ' + aStart.toLocaleString() + ' – ' + aEnd.toLocaleString());
            lines.push('Start height: ' + this._fmtNum(aStart));
            lines.push('End height: ' + this._fmtNum(aEnd));
            if (ud.isFuture) lines.push('Period: Future');
            else if (ud.isPast) lines.push('Period: Previous');
            lines.push('Length: 2,016 blocks');

        // ── Blockchain epochs ─────────────────────────────────────────────────
        } else if (ud.isMempool) {
            kind = 'Mempool';
            lines = ['Tip: Pending', 'Pending transactions', 'Unconfirmed set', 'Tip of the chain'];
        } else if (ud.isGenesis || (ud.index === 0 && ud.t != null)) {
            kind = 'Genesis';
            lines = [
                'Epoch: 0',
                'Blocks: 0 – 2,015',
                'Date: Jan 3, 2009',
                'First difficulty epoch',
                'Start height: 0',
                'End height: 2,015'
            ];
        } else if (typeof ud.index === 'number' && ud.t != null) {
            kind = 'Epoch';
            var start = ud.index * 2016;
            var end = start + 2015;
            lines = ['Epoch: ' + ud.index];
            lines.push('Blocks: ' + start.toLocaleString() + ' – ' + end.toLocaleString());
            lines.push('Start height: ' + this._fmtNum(start));
            lines.push('End height: ' + this._fmtNum(end));
            if (ud.isMilestone) lines.push('Milestone: Halving');
            if (ud.progress != null) lines.push('Progress: ' + Math.round(ud.progress * 100) + '%');
            lines.push('Length: 2,016 blocks');

        // ── Block page: transaction cuboid ────────────────────────────────────
        } else if (ud.txid && (ud.transactionData || !ud.type || ud.type === 'transaction')) {
            kind = 'Transaction';
            if (ud.transactionData) {
                lines = this._linesFromTxData(ud.transactionData, ud.txid);
            } else {
                // Bare txid — show identity now; _enrichSelection will fill fee/size
                lines = [
                    'Type: Transaction',
                    'TXID: ' + this._shortHash(ud.txid),
                    'Loading: mempool.space…'
                ];
                if (ud.size != null && typeof ud.size === 'number' && ud.size > 0 && ud.size < 1e7) {
                    lines.splice(2, 0, 'Size: ' + this._fmtNum(ud.size) + ' B');
                }
            }
            if (ud.index != null && typeof ud.index === 'number') {
                lines.push('In block: #' + ud.index);
            }

        // ── Address page history tx (data nested) ─────────────────────────────
        } else if (ud.type === 'transaction' && ud.data) {
            kind = 'Transaction';
            var atd = ud.data;
            if (atd.vin || atd.vout || atd.fee != null) {
                lines = this._linesFromTxData(atd, atd.txid);
            } else {
                var amt = this._fmtBtc(atd.value);
                lines = [amt ? 'Value: ' + amt : 'Type: Transaction'];
                if (atd.txid) lines.push('TXID: ' + this._shortHash(atd.txid));
                if (atd.size != null) lines.push('Size: ' + this._fmtNum(atd.size) + ' B');
                if (atd.status && atd.status.block_height != null) {
                    lines.push('Block: ' + this._fmtNum(atd.status.block_height));
                }
                var at = atd.status && this._fmtTime(atd.status.block_time);
                if (at) lines.push('Time: ' + at);
                if (atd.status && !atd.status.confirmed) lines.push('Status: Unconfirmed');
            }

        // ── Transaction page: central body / inputs / outputs ─────────────────
        } else if (ud.type === 'transaction' && !ud.data && ud.txid) {
            kind = 'Transaction';
            lines = ['Type: Transaction', 'TXID: ' + this._shortHash(ud.txid), 'Loading: mempool.space…'];
        } else if (ud.type === 'input' || ud.type === 'input-cap') {
            kind = ud.isCoinbase ? 'Coinbase' : 'Input';
            var vin = ud.data || {};
            if (ud.isCoinbase) {
                var cAmt = this._fmtBtc(ud.coinbaseAmount);
                lines = [cAmt ? 'Reward: ' + cAmt : 'Type: Coinbase'];
                lines.push('Source: Newly minted');
                if (vin.coinbase) lines.push('Data: ' + this._shortHash(vin.coinbase, 12, 0));
            } else {
                var inAmt = vin.prevout && this._fmtBtc(vin.prevout.value);
                lines = [inAmt ? 'Value: ' + inAmt : 'Type: Input'];
                if (ud.index != null) lines.push('Input: #' + (ud.index + 1));
                if (vin.prevout && vin.prevout.scriptpubkey_type) {
                    lines.push('Script: ' + vin.prevout.scriptpubkey_type);
                }
                if (vin.prevout && vin.prevout.scriptpubkey_address) {
                    lines.push('Addr: ' + this._shortHash(vin.prevout.scriptpubkey_address, 12, 6));
                }
                if (vin.txid) lines.push('From: ' + this._shortHash(vin.txid));
                if (vin.vout != null) lines.push('Vout: ' + vin.vout);
            }
        } else if (ud.type === 'output' || ud.type === 'output-cap') {
            kind = ud.spendingData ? 'Output (spent)' : 'Output';
            var vout = ud.data || {};
            var outAmt = this._fmtBtc(vout.value);
            lines = [outAmt ? 'Value: ' + outAmt : 'Type: Output'];
            if (ud.index != null) lines.push('Output: #' + (ud.index + 1));
            if (vout.scriptpubkey_type) lines.push('Script: ' + vout.scriptpubkey_type);
            if (vout.scriptpubkey_address) {
                lines.push('Addr: ' + this._shortHash(vout.scriptpubkey_address, 12, 6));
            }
            if (ud.spendingData) {
                if (ud.spendingData.txid) lines.push('Spent by: ' + this._shortHash(ud.spendingData.txid));
                if (ud.spendingData.block_height != null) {
                    lines.push('Spend block: ' + this._fmtNum(ud.spendingData.block_height));
                }
            } else if (ud.type === 'output-cap' || !ud.spendingData) {
                lines.push('Status: Unspent');
            }

        // ── Address / block UTXOs ──────────────────────────────────────────────
        } else if ((ud.type === 'utxo' && ud.data) || (ud.type === 'blockUtxo' && ud.utxo)) {
            kind = 'UTXO';
            var u = ud.data || ud.utxo;
            var uAmt = this._fmtBtc(u.value);
            lines = [uAmt ? 'Value: ' + uAmt : 'Type: UTXO'];
            if (u.txid) lines.push('TXID: ' + this._shortHash(u.txid));
            if (u.vout != null) lines.push('Vout: ' + u.vout);
            if (u.scriptpubkey_address) {
                lines.push('Addr: ' + this._shortHash(u.scriptpubkey_address, 12, 6));
            }
            if (u.status && u.status.block_height != null) {
                lines.push('Block: ' + this._fmtNum(u.status.block_height));
            }

        // ── Block header / adjacent blocks ────────────────────────────────────
        } else if (ud.type === 'header') {
            kind = 'Header';
            lines = ['Type: Block header', ud.description || 'Size: 80 bytes'];
        } else if (ud.type === 'currentBlock' || ud.type === 'pastBlock' || ud.type === 'futureBlock') {
            kind = ud.type === 'currentBlock' ? 'Current block'
                : (ud.type === 'pastBlock' ? 'Past block' : 'Future block');
            lines = ['Type: ' + kind];
            if (ud.blockHeight != null) lines.push('Height: ' + this._fmtNum(ud.blockHeight));

        // ── Mempool fee-band cuboid (no per-tx id) ────────────────────────────
        } else if (ud.feeRate != null && !ud.txid) {
            kind = 'Fee band';
            lines = ['Fee: ' + Number(ud.feeRate).toFixed(2) + ' sat/vB'];
            if (ud.originalCount != null) {
                lines.push('Txs in band: ' + this._fmtNum(ud.originalCount));
            }
            lines.push('Source: Mempool histogram');

        // ── Network peer ──────────────────────────────────────────────────────
        } else if (ud.address || ud.userAgent || (ud.country && !ud.txid)) {
            kind = 'Node';
            lines = ['Impl: ' + (ud.type || 'Unknown')];
            if (ud.address) lines.push('Addr: ' + ud.address);
            if (ud.city || ud.country) {
                lines.push('Loc: ' + [ud.city, ud.country].filter(Boolean).join(', '));
            }
            var h = ud.height != null ? ud.height : ud.latestHeight;
            if (h != null) lines.push('Height: ' + this._fmtNum(h));
            if (ud.latestHeight != null && ud.height != null && ud.latestHeight !== ud.height) {
                lines.push('Tip: ' + this._fmtNum(ud.latestHeight));
            }
            if (ud.org) lines.push('Org: ' + ud.org);
            if (ud.asn) lines.push('ASN: ' + ud.asn);
            if (ud.timezone) lines.push('TZ: ' + ud.timezone);
            if (ud.userAgent) {
                var ua = String(ud.userAgent);
                if (ua.length > 40) ua = ua.slice(0, 38) + '…';
                lines.push('UA: ' + ua);
            }
            if (ud.lat != null && ud.lng != null) {
                lines.push('Coords: ' + Number(ud.lat).toFixed(2) + ', ' + Number(ud.lng).toFixed(2));
            }

        // ── Protocol feature (node.html) ──────────────────────────────────────
        } else if (ud.name && (ud.type === 'Bitcoin Protocol' || ud.description || ud.year)) {
            kind = 'Protocol';
            lines = ['Name: ' + ud.name];
            if (ud.year != null) lines.push('Year: ' + ud.year);
            if (ud.description) {
                var desc = String(ud.description);
                if (desc.length > 48) desc = desc.slice(0, 46) + '…';
                lines.push(desc);
            }

        } else {
            kind = 'Object';
            lines = ['Type: ' + (ud.name || ud.label || 'Unknown')];
        }

        this._selectionKind = kind;
        return lines;
    };

    /** True when we should fetch richer bitcoin data from mempool.space. */
    VRManager.prototype._selectionNeedsFetch = function (obj) {
        if (!obj || !obj.userData) return null;
        var ud = obj.userData;
        // Block / address cuboid with txid but no full tx payload
        if (ud.txid && !ud.transactionData && !(ud.data && (ud.data.vin || ud.data.fee != null))) {
            // Skip dummy / synthetic ids
            if (String(ud.txid).indexOf('dummy') === 0) return null;
            return { kind: 'tx', id: String(ud.txid) };
        }
        if (ud.type === 'transaction' && ud.data && ud.data.txid && !ud.data.vin && ud.data.fee == null) {
            // Address-page slim tx — enrich from full tx endpoint
            return { kind: 'tx', id: String(ud.data.txid) };
        }
        if (ud.isBlock && ud.blockInfo && ud.blockInfo.height != null && ud.blockInfo.nTx == null) {
            return { kind: 'blockHeight', id: String(ud.blockInfo.height) };
        }
        return null;
    };

    VRManager.prototype._enrichSelection = function (obj, token) {
        var need = this._selectionNeedsFetch(obj);
        if (!need) return;

        var self = this;
        var url = need.kind === 'tx'
            ? 'https://mempool.space/api/tx/' + encodeURIComponent(need.id)
            : 'https://mempool.space/api/block-height/' + encodeURIComponent(need.id);

        fetch(url).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return need.kind === 'blockHeight' ? res.text() : res.json();
        }).then(function (first) {
            if (need.kind === 'blockHeight') {
                return fetch('https://mempool.space/api/block/' + encodeURIComponent(String(first).trim()))
                    .then(function (r) {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.json();
                    });
            }
            return first;
        }).then(function (data) {
            if (token !== self._selectionToken) return; // superseded
            if (!obj.userData) obj.userData = {};

            if (need.kind === 'tx' && data) {
                obj.userData.transactionData = data;
                if (obj.userData.data && !obj.userData.data.vin) {
                    // Keep slim address payload but prefer transactionData for HUD
                }
            } else if (need.kind === 'blockHeight' && data && obj.userData.blockInfo) {
                obj.userData.blockInfo.nTx = data.tx_count;
                obj.userData.blockInfo.size = data.size;
                if (data.timestamp != null) obj.userData.blockInfo.time = data.timestamp;
                if (data.id) obj.userData.blockInfo.id = data.id;
                if (data.difficulty != null) obj.userData.blockInfo.difficulty = data.difficulty;
                if (data.weight != null) obj.userData.blockInfo.weight = data.weight;
            }

            var lines = self._prepareSelectionLines(obj);
            self._selectionLines = lines;
            self._selectionUntil = performance.now() + HUD_SELECT_HOLD_MS;
            var changed = self._drawHud();
            if (changed && changed.length) self._startHudReveal(changed);
        }).catch(function () {
            if (token !== self._selectionToken) return;
            // Leave the "Loading…" line; optionally mark failure
            if (self._selectionLines) {
                var next = self._selectionLines.slice();
                for (var i = 0; i < next.length; i++) {
                    if (String(next[i]).indexOf('Loading:') === 0) {
                        next[i] = 'Fetch: unavailable';
                        break;
                    }
                }
                self._selectionLines = next;
                self._drawHud();
            }
        });
    };

    /** Build selection lines + optional double-trigger hint. */
    VRManager.prototype._prepareSelectionLines = function (obj) {
        var lines = this._getObjectLines(obj).slice();
        var canNav = false;
        try { canNav = !!this._resolveNavigateUrl(obj); } catch (e) { canNav = false; }
        if (canNav && lines.indexOf('Double-trigger → open') < 0) {
            lines.push('Double-trigger → open');
        }
        return lines;
    };

    VRManager.prototype._showSelectionOnHud = function (obj) {
        var lines = this._prepareSelectionLines(obj);
        this._selectionLines = lines;
        this._selectionUntil = performance.now() + HUD_SELECT_HOLD_MS;
        this._selectionToken = (this._selectionToken || 0) + 1;
        var token = this._selectionToken;

        // Selection fills bottom HUD corners — hide floating info panel if open
        if (this.spatialPanel) this.spatialPanel.setVisible(false);

        if (!this._hudTL) this._attachHud();
        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) {
            if (m) m.visible = true;
        });

        var changed = this._drawHud();
        if (changed && changed.length) this._startHudReveal(changed);

        // Enrich incomplete bitcoin payloads from mempool.space
        this._enrichSelection(obj, token);
    };

    /** Expire stale selection; returns whether a selection is currently active. */
    VRManager.prototype._selectionActive = function () {
        if (this._selectionLines && performance.now() < this._selectionUntil) return true;
        if (this._selectionLines && performance.now() >= this._selectionUntil) {
            this._selectionLines = null;
            this._selectionUntil = 0;
            this._selectionKind = null;
        }
        return false;
    };

    /** @deprecated kept for spatial-panel fallback callers */
    VRManager.prototype._hudLines = function () {
        if (this._selectionActive()) return this._selectionLines;
        return this._readPanelLines();
    };

    VRManager.prototype._fmtShortDate = function (unixSec) {
        if (unixSec == null || isNaN(Number(unixSec))) return null;
        try {
            var d = new Date(Number(unixSec) * 1000);
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
        } catch (e) { return null; }
    };

    VRManager.prototype._estimatedSubsidyBtc = function (height) {
        if (height == null || isNaN(Number(height))) return null;
        var era = Math.floor(Number(height) / 210000);
        var subsidy = 50;
        for (var i = 0; i < era && subsidy > 0; i++) subsidy /= 2;
        return subsidy;
    };

    /**
     * Page identity (TL) + page stats (TR). Selection never overrides these.
     * Pages may override via explorer.getVRPageHud() → { title, identity, stats }.
     */
    VRManager.prototype._getPageHudContext = function () {
        var ex = this.explorer;
        if (ex && typeof ex.getVRPageHud === 'function') {
            try {
                var custom = ex.getVRPageHud();
                if (custom && custom.title) return custom;
            } catch (e) { /* fall through */ }
        }

        var page = this._pageId();
        var title = 'Explorer';
        var identity = '';
        var stats = [];
        var el;

        function textOf(id) {
            el = document.getElementById(id);
            return el ? String(el.textContent || '').trim() : '';
        }

        switch (page) {
            case 'network.html': {
                title = 'Network';
                var ts = ex && ex.nodeData && ex.nodeData.timestamp;
                identity = this._fmtShortDate(ts) || textOf('network-subtitle') || 'Live';
                var total = ex && ex.nodeData && ex.nodeData.total_nodes;
                if (total != null) stats.push('Nodes: ' + this._fmtNum(total));
                else if (textOf('total-nodes')) stats.push('Nodes: ' + textOf('total-nodes'));
                if (ex && ex.nodes && ex.nodes.length) {
                    var counts = {};
                    ex.nodes.forEach(function (n) {
                        var t = (n.userData && n.userData.type) || 'other';
                        counts[t] = (counts[t] || 0) + 1;
                    });
                    var order = ['bitcoin-core', 'knots', 'bcoin', 'btcd', 'other'];
                    var labels = {
                        'bitcoin-core': 'Core',
                        knots: 'Knots',
                        bcoin: 'bcoin',
                        btcd: 'btcd',
                        other: 'Other'
                    };
                    order.forEach(function (k) {
                        if (counts[k]) stats.push(labels[k] + ': ' + counts[k].toLocaleString());
                    });
                }
                if (ex && ex.nodeData && ex.nodeData.latest_height != null) {
                    stats.push('Height: ' + this._fmtNum(ex.nodeData.latest_height));
                }
                break;
            }
            case 'node.html': {
                title = 'Node';
                identity = (ex && (ex.nodeData && ex.nodeData.address || ex.nodeAddress)) || textOf('node-address') || '—';
                var nd = ex && ex.nodeData && ex.nodeData.data;
                if (nd) {
                    if (nd[0]) stats.push('Version: ' + nd[0]);
                    if (ex.nodeData.status) stats.push('Status: ' + ex.nodeData.status);
                    if (nd[3] != null) stats.push('Height: ' + this._fmtNum(nd[3]));
                    if (nd[4] != null) stats.push('Tip: ' + this._fmtNum(nd[4]));
                    if (nd[6] || nd[7]) stats.push('Loc: ' + [nd[6], nd[7]].filter(Boolean).join(', '));
                    if (ex.nodeData.mbps) stats.push('BW: ' + ex.nodeData.mbps + ' Mbps');
                } else {
                    if (textOf('node-version')) stats.push('Version: ' + textOf('node-version'));
                    if (textOf('node-status-display')) stats.push('Status: ' + textOf('node-status-display'));
                }
                break;
            }
            case 'blockchain.html': {
                title = 'Blockchain';
                var h = textOf('chain-height') || textOf('block-height');
                identity = h && h !== 'Loading...' ? ('Height ' + h) : 'Chain tip';
                if (ex && ex.difficultyAdjustments != null) {
                    stats.push('Epochs: ' + this._fmtNum(ex.difficultyAdjustments));
                } else if (textOf('total-transactions') && textOf('total-transactions') !== 'Loading...') {
                    stats.push('Epochs: ' + textOf('total-transactions'));
                }
                if (textOf('last-block') && textOf('last-block') !== 'Loading...') {
                    stats.push('Tip: ' + textOf('last-block'));
                }
                if (textOf('avg-block-time') && textOf('avg-block-time') !== 'Loading...') {
                    stats.push('Avg time: ' + textOf('avg-block-time'));
                }
                if (textOf('chain-difficulty') && textOf('chain-difficulty') !== 'Loading...') {
                    stats.push('Diff: ' + textOf('chain-difficulty'));
                }
                if (textOf('chain-hashrate') && textOf('chain-hashrate') !== 'Loading...') {
                    stats.push('Hashrate: ' + textOf('chain-hashrate'));
                }
                break;
            }
            case 'difficulty.html': {
                title = 'Difficulty';
                var epoch = ex && ex.selectedAdjustment != null ? String(ex.selectedAdjustment) : textOf('adjustment-period');
                var startDate = textOf('start-date');
                var endDate = textOf('end-date');
                identity = (epoch ? ('Epoch ' + epoch) : 'Epoch') +
                    (startDate && startDate !== 'Loading...' ? (' · ' + startDate) : '');
                if (textOf('avg-change') && textOf('avg-change') !== 'Loading...') {
                    stats.push('Avg block: ' + textOf('avg-change'));
                }
                if (ex && ex.blockData && ex.blockData[0] && ex.blockData[0].length) {
                    var blocks = ex.blockData[0];
                    var totalTx = 0;
                    for (var bi = 0; bi < blocks.length; bi++) {
                        totalTx += (blocks[bi][2] && blocks[bi][2].nTx) || 0;
                    }
                    var avgTx = Math.round(totalTx / blocks.length);
                    stats.push('Avg txs/block: ' + this._fmtNum(avgTx));
                    stats.push('Total txs: ' + this._fmtNum(totalTx));
                    stats.push('Blocks: ' + this._fmtNum(blocks.length));
                }
                if (textOf('block-range') && textOf('block-range') !== 'Loading...') {
                    stats.push('Range: ' + textOf('block-range'));
                }
                if (endDate && endDate !== 'Loading...') stats.push('End: ' + endDate);
                break;
            }
            case 'block.html': {
                title = 'Block';
                var bd = ex && ex.blockData;
                var height = bd && bd.height != null ? bd.height : (ex && ex.blockHeight);
                var id = bd && bd.id ? this._shortHash(bd.id, 10, 6) : '';
                identity = height != null
                    ? (this._fmtNum(height) + (id ? (' · ' + id) : ''))
                    : '—';
                if (bd) {
                    if (bd.size != null) stats.push('Size: ' + (bd.size / 1024).toFixed(1) + ' KB');
                    var bDate = this._fmtShortDate(bd.timestamp);
                    if (bDate) stats.push('Date: ' + bDate);
                    if (bd.tx_count != null) stats.push('Txs: ' + this._fmtNum(bd.tx_count));
                    var rewardSats = bd.extras && bd.extras.reward;
                    var rewardBtc = rewardSats != null
                        ? (Number(rewardSats) / 1e8)
                        : this._estimatedSubsidyBtc(bd.height);
                    if (rewardBtc != null) stats.push('Reward: ' + Number(rewardBtc).toFixed(8) + ' BTC');
                    if (bd.difficulty != null) {
                        stats.push('Diff: ' + (bd.difficulty / 1e12).toFixed(2) + ' T');
                    }
                }
                break;
            }
            case 'transaction.html': {
                title = 'Transaction';
                var tx = ex && (ex.transactionData || null);
                var txid = (tx && tx.txid) || (ex && ex.txid) || '';
                identity = txid ? this._shortHash(txid, 12, 8) : '—';
                if (tx) {
                    if (tx.fee != null) stats.push('Fee: ' + this._fmtNum(tx.fee) + ' sats');
                    if (tx.size != null) stats.push('Size: ' + this._fmtNum(tx.size) + ' B');
                    if (tx.vin && tx.vout) {
                        stats.push('I/O: ' + tx.vin.length + ' / ' + tx.vout.length);
                    }
                    if (tx.status) {
                        if (tx.status.confirmed && tx.status.block_height != null) {
                            stats.push('Block: ' + this._fmtNum(tx.status.block_height));
                        } else {
                            stats.push('Status: Unconfirmed');
                        }
                    }
                }
                break;
            }
            case 'address.html': {
                title = 'Address';
                var addr = (ex && (ex.address || (ex.addressData && ex.addressData.address))) || '';
                identity = addr ? this._shortHash(addr, 12, 8) : '—';
                var cs = ex && ex.addressData && ex.addressData.chain_stats;
                if (cs) {
                    if (cs.funded_txo_sum != null) {
                        stats.push('Balance: ' + (cs.funded_txo_sum / 1e8).toFixed(8) + ' BTC');
                    }
                    if (cs.tx_count != null) stats.push('Txs: ' + this._fmtNum(cs.tx_count));
                    if (cs.funded_txo_count != null) {
                        stats.push('Funded: ' + this._fmtNum(cs.funded_txo_count));
                    }
                }
                if (ex && ex.utxoData) stats.push('UTXOs: ' + this._fmtNum(ex.utxoData.length));
                break;
            }
            case 'mempool.html': {
                title = 'Mempool';
                var md = ex && ex.mempoolData;
                identity = md && md.count != null
                    ? (this._fmtNum(md.count) + ' txs')
                    : 'Live';
                if (md) {
                    if (md.count != null) stats.push('Txs: ' + this._fmtNum(md.count));
                    if (md.vsize != null) stats.push('Size: ' + this._fmtNum(md.vsize) + ' vB');
                    if (md.total_fee != null) {
                        stats.push('Fees: ' + (md.total_fee / 1e8).toFixed(4) + ' BTC');
                    }
                }
                break;
            }
            default:
                title = page.replace('.html', '').replace(/-/g, ' ');
                title = title.charAt(0).toUpperCase() + title.slice(1);
                identity = 'Anatomy of Bitcoin';
        }

        return { title: title, identity: identity, stats: stats.slice(0, 6) };
    };

    /**
     * Full HUD model:
     *   TL = page title + identity
     *   TR = page stats
     *   BL+BR = all selection lines when active; else idle panel/meta
     */
    VRManager.prototype._getHudModel = function () {
        var page = this._getPageHudContext();
        var selecting = this._selectionActive();
        var selection = selecting ? (this._selectionLines || []).slice() : null;
        var idle = !selecting ? this._readPanelLines().slice(0, 8) : null;
        return {
            title: page.title || 'Explorer',
            identity: page.identity || '',
            pageStats: page.stats || [],
            selection: selection,
            selectionKind: selecting ? this._selectionKind : null,
            idleLines: idle
        };
    };

    // -------------------------------------------------------------------------
    // Session start / end
    // -------------------------------------------------------------------------

    VRManager.prototype._onSessionStart = function () {
        var self     = this;
        var explorer = this.explorer;
        var renderer = explorer.renderer;
        if (typeof window.ExplorerAudio !== 'undefined') {
            ExplorerAudio.unlock();
            ExplorerAudio.resume();
        }

        // Detect AR vs VR
        var session    = renderer.xr.getSession();
        this._isAR     = !!(session && session.environmentBlendMode !== 'opaque');

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

        if (this.navMenu && typeof this.navMenu._refreshAllToggles === 'function') {
            this.navMenu._refreshAllToggles();
        }
    };

    // Controllers, grips, HUD host camera, spatial panel, focus marker, ray tips stay at scene root
    VRManager.prototype._shouldKeepInScene = function (obj) {
        if (!obj) return true;
        if (obj === this.pivot) return true;
        if (obj === this.controller0 || obj === this.controller1) return true;
        if (obj === this._grip0 || obj === this._grip1) return true;
        // Raw slots — keep even if logical handedness mapping drifted
        if (this._rawControllers) {
            if (obj === this._rawControllers[0] || obj === this._rawControllers[1]) return true;
        }
        if (this._rawGrips) {
            if (obj === this._rawGrips[0] || obj === this._rawGrips[1]) return true;
        }
        if (obj === this.explorer.camera) return true;
        if (obj === this._labelMesh) return true;
        if (obj === this._anchorMarker) return true;
        if (obj === this._rayTip0 || obj === this._rayTip1) return true;
        var spatialMesh = this.spatialPanel ? this.spatialPanel.getMesh() : null;
        if (spatialMesh && obj === spatialMesh) return true;
        return false;
    };

    /** Re-parent controllers/grips to scene root if a page wipe removed them. */
    VRManager.prototype._ensureControllersInScene = function () {
        var scene = this.explorer && this.explorer.scene;
        if (!scene || !this._rawControllers) return;
        var add = this._origSceneAdd || scene.add.bind(scene);
        var objs = [
            this._rawControllers[0], this._rawControllers[1],
            this._rawGrips && this._rawGrips[0], this._rawGrips && this._rawGrips[1],
            this._rayTip0, this._rayTip1
        ];
        for (var i = 0; i < objs.length; i++) {
            var o = objs[i];
            if (o && o.parent !== scene) add(o);
        }
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
        this._selectionKind = null;
        this._selectionToken = (this._selectionToken || 0) + 1;
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
        var camPos = new THREE.Vector3();
        var forward = new THREE.Vector3();
        xrCam.getWorldPosition(camPos);
        xrCam.getWorldDirection(forward);

        if (this.pivot && this.pivot.children.length) {
            this.pivot.updateMatrixWorld(true);
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

    /** Orbit pivot position + orientation around a fixed world-space point. */
    VRManager.prototype._orbitPivotAroundAnchor = function (axis, angle) {
        if (!this.pivot || !axis || Math.abs(angle) < 1e-12) return;
        if (axis.lengthSq() < 1e-12) return;
        axis.normalize();

        var anchor = this._ensureFocusAnchor();
        // Translate so the anchor is at the world origin, rotate, translate back
        this.pivot.position.sub(anchor);
        this.pivot.position.applyAxisAngle(axis, angle);
        this.pivot.rotateOnWorldAxis(axis, angle);
        this.pivot.position.add(anchor);
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
            xrCam.getWorldPosition(this._focusAnchorTmp);
            ring.lookAt(this._focusAnchorTmp);
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

    /**
     * Rotate around the focus anchor in world space.
     * dRotY = yaw about world up; dRotX = pitch about camera-horizontal right.
     */
    VRManager.prototype._applyPivotRotation = function (dRotX, dRotY) {
        if (!this.pivot || (dRotX === 0 && dRotY === 0)) return;

        // Lock / show the marker before mutating so the indicated point is the orbit center
        this._ensureFocusAnchor();

        if (dRotY !== 0) {
            this._focusAxis.set(0, 1, 0);
            this._orbitPivotAroundAnchor(this._focusAxis, dRotY);
        }
        if (dRotX !== 0) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            xrCam.getWorldQuaternion(this._focusQuat);
            var camRight = this._focusAxis;
            camRight.set(1, 0, 0).applyQuaternion(this._focusQuat);
            camRight.y = 0;
            if (camRight.lengthSq() < 1e-8) {
                // Looking straight up/down — fall back to world X
                camRight.set(1, 0, 0);
            }
            this._orbitPivotAroundAnchor(camRight, dRotX);
        }

        this._updateAnchorMarker();
    };

    /** Uniform-scale the pivot while keeping the focus anchor fixed in world space. */
    VRManager.prototype._applyPivotScale = function (newScale) {
        if (!this.pivot) return;
        newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, newScale));
        var oldScale = this.pivot.scale.x;
        if (Math.abs(newScale - oldScale) < 1e-12 || oldScale < 1e-20) {
            this._ensureFocusAnchor();
            this._updateAnchorMarker();
            return;
        }

        var anchor = this._ensureFocusAnchor();
        var factor = newScale / oldScale;

        // P' = A + (P - A) * (s'/s)  — scales the offset from the anchor, then set scale
        this.pivot.position.sub(anchor).multiplyScalar(factor).add(anchor);
        this.pivot.scale.setScalar(newScale);
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

    VRManager.prototype._togglePassthrough = function () {
        var renderer = this.explorer && this.explorer.renderer;
        if (!renderer || typeof VRButton === 'undefined' || !VRButton.togglePassthrough) return;
        VRButton.togglePassthrough(renderer);
    };

    VRManager.prototype._reloadPage = function () {
        var file = this._pageId() || 'network.html';
        if (typeof window.explorerNavigate === 'function') {
            window.explorerNavigate(file, { force: true, replace: true });
            return;
        }
        window.location.reload();
    };

    VRManager.prototype._startPanelUpdate = function () {
        var self = this;
        this._stopPanelUpdate();
        this._panelInterval = setInterval(function () {
            if (self.spatialPanel && self.spatialPanel.getMesh().visible) {
                self.spatialPanel.update(self._readPanelLines());
            }
            self._drawHud();
        }, 1000);
        this._drawHud();
    };

    VRManager.prototype._stopPanelUpdate = function () {
        if (this._panelInterval) { clearInterval(this._panelInterval); this._panelInterval = null; }
    };

    VRManager.prototype._readPanelLines = function () {
        var sourceEl = this.panelDomId ? document.getElementById(this.panelDomId) : null;
        if (!sourceEl) sourceEl = document.querySelector('.panel-content');
        if (!sourceEl) return [];
        var lines = [];
        var skipIds = {
            'block-visibility-slider': 1,
            'block-visibility-value': 1,
            'highest-visible-block': 1,
            'current-block-time': 1,
            'animate-1000x': 1,
            'animate-10000x': 1,
            'animate-100000x': 1,
            'toggle-sound': 1,
            'toggle-metronome': 1,
            'disc-visibility-slider': 1,
            'disc-visibility-value': 1,
            'highest-visible-disc': 1
        };
        sourceEl.querySelectorAll('div').forEach(function (div) {
            if (div.querySelector('button, input, a')) return;
            if (div.id && skipIds[div.id]) return;
            var text = div.textContent.trim().replace(/\s+/g, ' ');
            if (text.length > 0 && text.length < 80) lines.push(text);
        });
        // Prefer leaf-ish unique lines
        var seen = {};
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            if (seen[lines[i]]) continue;
            seen[lines[i]] = 1;
            out.push(lines[i]);
        }
        return out.slice(0, 12);
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

        // Top-left — page title + identity
        this._hudTLCanvas = mkCanvas(HUD_CW, HUD_CH_TOP);
        this._hudTLCtx    = this._hudTLCanvas.getContext('2d');
        this._hudTLTex    = new THREE.CanvasTexture(this._hudTLCanvas);
        this._hudTL       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_TOP), mkMat(this._hudTLTex));

        // Top-right — page stats
        this._hudTRCanvas = mkCanvas(HUD_CW, HUD_CH_TOP);
        this._hudTRCtx    = this._hudTRCanvas.getContext('2d');
        this._hudTRTex    = new THREE.CanvasTexture(this._hudTRCanvas);
        this._hudTR       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_TOP), mkMat(this._hudTRTex));

        // Bottom-left — selection / idle details
        this._hudBLCanvas = mkCanvas(HUD_CW, HUD_CH_BOT);
        this._hudBLCtx    = this._hudBLCanvas.getContext('2d');
        this._hudBLTex    = new THREE.CanvasTexture(this._hudBLCanvas);
        this._hudBL       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_BOT), mkMat(this._hudBLTex));

        // Bottom-right — selection overflow / meta
        this._hudBRCanvas = mkCanvas(HUD_CW, HUD_CH_BOT);
        this._hudBRCtx    = this._hudBRCanvas.getContext('2d');
        this._hudBRTex    = new THREE.CanvasTexture(this._hudBRCanvas);
        this._hudBR       = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W, HUD_H_BOT), mkMat(this._hudBRTex));

        [this._hudTL, this._hudTR, this._hudBL, this._hudBR].forEach(function (m) { m.renderOrder = 9999; });
        this._drawHud();
    };

    /** Draw label:value rows into a corner (left or right aligned). */
    VRManager.prototype._drawStatRows = function (ctx, canvas, rows, opts) {
        opts = opts || {};
        var W = canvas.width;
        var PAD = opts.pad != null ? opts.pad : 18;
        var align = opts.align || 'left';
        var fontSize = opts.fontSize || 22;
        var lineH = opts.lineH || 36;
        var startY = opts.startY != null ? opts.startY : PAD;
        var maxLines = opts.maxLines != null ? opts.maxLines : 6;
        var maxChars = opts.maxChars || 42;

        ctx.textAlign = align;
        ctx.font = '400 ' + fontSize + 'px "Inter", sans-serif';
        var x = align === 'right' ? (W - PAD) : PAD;

        rows.slice(0, maxLines).forEach(function (line, i) {
            var y = startY + i * lineH;
            var text = String(line || '');
            if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…';
            var colon = text.indexOf(':');
            if (colon > -1 && align === 'left') {
                var sl = text.slice(0, colon + 1) + ' ';
                var sv = text.slice(colon + 1).trim();
                var lblW = ctx.measureText(sl).width;
                ctx.fillStyle = 'rgba(255,255,255,0.62)';
                ctx.fillText(sl, x, y);
                ctx.fillStyle = 'rgba(255,255,255,0.98)';
                ctx.fillText(sv, x + lblW, y);
            } else if (colon > -1 && align === 'right') {
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.fillText(text, x, y);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.88)';
                ctx.fillText(text, x, y);
            }
        });
    };

    // Draw one corner panel.  corner: 'TL' | 'TR' | 'BL' | 'BR'
    VRManager.prototype._drawCorner = function (ctx, canvas, corner, model) {
        var W   = canvas.width;
        var H   = canvas.height;
        var PAD = 18;
        model = model || {};

        ctx.clearRect(0, 0, W, H);
        ctx.textBaseline = 'top';

        if (corner === 'TL') {
            // Page type title + identity (id / date / address…)
            var title = String(model.title || 'Explorer').toUpperCase();
            var identity = String(model.identity || '');

            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.font      = '400 52px "BureauGrotesque", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(title, PAD, PAD - 2);

            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(PAD, PAD + 56, W - PAD * 2, 1);

            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.font      = '400 22px "Inter", sans-serif';
            if (identity.length > 40) identity = identity.slice(0, 38) + '…';
            ctx.fillText(identity || 'Anatomy of Bitcoin', PAD, PAD + 66);

        } else if (corner === 'TR') {
            // Page-level stats — compact right-aligned stack
            var stats = model.pageStats || [];
            ctx.textAlign = 'right';
            if (stats.length === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = '400 20px "Inter", sans-serif';
                ctx.fillText('Loading…', W - PAD, PAD + 20);
            } else if (stats.length === 1) {
                var primary = stats[0];
                var col = primary.indexOf(':');
                if (col > -1) {
                    ctx.font = '400 20px "Inter", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.62)';
                    ctx.fillText(primary.slice(0, col + 1), W - PAD, PAD);
                    ctx.font = '400 40px "BureauGrotesque", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,1)';
                    ctx.fillText(primary.slice(col + 1).trim(), W - PAD, PAD + 24);
                } else {
                    ctx.font = '400 32px "BureauGrotesque", sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.98)';
                    ctx.fillText(primary, W - PAD, PAD + 22);
                }
            } else {
                this._drawStatRows(ctx, canvas, stats, {
                    align: 'right', fontSize: 22, lineH: 32, startY: PAD - 2, maxLines: 5, maxChars: 36
                });
            }

        } else if (corner === 'BL') {
            var leftRows;
            if (model.selection && model.selection.length) {
                // Pack first chunk of selected-object fields (rest → BR)
                leftRows = model.selection.slice(0, 6);
                ctx.fillStyle = 'rgba(255,255,255,0.62)';
                ctx.font = '400 18px "Inter", sans-serif';
                ctx.textAlign = 'left';
                var kind = model.selectionKind ? String(model.selectionKind).toUpperCase() : 'SELECTED';
                ctx.fillText(kind, PAD, PAD - 4);
                this._drawStatRows(ctx, canvas, leftRows, {
                    align: 'left', fontSize: 22, lineH: 34, startY: PAD + 24, maxLines: 6, maxChars: 40
                });
            } else {
                leftRows = model.idleLines || [];
                ctx.fillStyle = 'rgba(255,255,255,0.62)';
                ctx.font = '400 18px "Inter", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('PAGE DATA', PAD, PAD - 4);
                this._drawStatRows(ctx, canvas, leftRows, {
                    align: 'left', fontSize: 22, lineH: 34, startY: PAD + 24, maxLines: 6, maxChars: 40
                });
            }

        } else if (corner === 'BR') {
            if (model.selection && model.selection.length) {
                // Remaining selected-object fields — always dump the rest here
                var rightRows = model.selection.slice(6);
                ctx.textAlign = 'right';
                ctx.fillStyle = 'rgba(255,255,255,0.62)';
                ctx.font = '400 18px "Inter", sans-serif';
                ctx.fillText('DETAILS', W - PAD, PAD - 4);
                if (rightRows.length === 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.50)';
                    ctx.font = '400 20px "Inter", sans-serif';
                    ctx.fillText('All fields on left', W - PAD, PAD + 28);
                } else {
                    this._drawStatRows(ctx, canvas, rightRows, {
                        align: 'right', fontSize: 22, lineH: 32, startY: PAD + 24, maxLines: 7, maxChars: 38
                    });
                }
            } else {
                // Idle meta: data source + live clock
                ctx.textAlign = 'right';
                var discEl = document.querySelector('.disclaimer');
                var src = discEl ? discEl.textContent.trim().replace(/\s+/g, ' ') : 'Data: Mempool.space';
                var now = new Date();
                var ts = now.toUTCString().replace(/:\d\d GMT$/, ' UTC');

                ctx.font = '400 22px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.62)';
                ctx.fillText(src.length > 42 ? src.slice(0, 40) + '…' : src, W - PAD, PAD);
                ctx.font = '400 20px "Inter", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.48)';
                ctx.fillText(ts, W - PAD, PAD + 32);
            }
        }
    };

    /** Stable content fingerprint per corner. */
    VRManager.prototype._hudCornerSig = function (corner, model) {
        model = model || {};
        if (corner === 'TL') return 'P|' + (model.title || '') + '|' + (model.identity || '');
        if (corner === 'TR') return 'S|' + (model.pageStats || []).join('\n');
        if (corner === 'BL') {
            if (model.selection) {
                return 'SEL|' + (model.selectionKind || '') + '|' + model.selection.slice(0, 6).join('\n');
            }
            return 'IDLE|' + (model.idleLines || []).join('\n');
        }
        if (corner === 'BR') {
            if (model.selection) {
                return 'SEL|' + model.selection.slice(6).join('\n');
            }
            return 'META';
        }
        return '';
    };

    /** Draw HUD; returns list of corner keys whose content changed. */
    VRManager.prototype._drawHud = function () {
        if (!this._hudTL) return [];
        var model = this._getHudModel();
        var corners = [
            { key: 'TL', ctx: this._hudTLCtx, canvas: this._hudTLCanvas, tex: this._hudTLTex },
            { key: 'TR', ctx: this._hudTRCtx, canvas: this._hudTRCanvas, tex: this._hudTRTex },
            { key: 'BL', ctx: this._hudBLCtx, canvas: this._hudBLCanvas, tex: this._hudBLTex },
            { key: 'BR', ctx: this._hudBRCtx, canvas: this._hudBRCanvas, tex: this._hudBRTex }
        ];
        var changed = [];
        for (var i = 0; i < corners.length; i++) {
            var c = corners[i];
            var sig = this._hudCornerSig(c.key, model);
            if (sig !== this._hudSigs[c.key]) {
                this._hudSigs[c.key] = sig;
                changed.push(c.key);
            }
            this._drawCorner(c.ctx, c.canvas, c.key, model);
            c.tex.needsUpdate = true;
        }
        return changed;
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

    /**
     * Staggered corner reveal — opacity + slide-in from outside.
     * @param {string[]} [keys] — optional subset ('TL'|'TR'|'BL'|'BR'); default all.
     */
    VRManager.prototype._startHudReveal = function (keys) {
        if (!this._hudTL || !this._hudBasePos) return;

        var all = [
            { mesh: this._hudTL, key: 'TL', sx: -1, sy:  1 },
            { mesh: this._hudTR, key: 'TR', sx:  1, sy:  1 },
            { mesh: this._hudBL, key: 'BL', sx: -1, sy: -1 },
            { mesh: this._hudBR, key: 'BR', sx:  1, sy: -1 }
        ];
        var want = null;
        if (keys && keys.length) {
            want = {};
            for (var k = 0; k < keys.length; k++) want[keys[k]] = true;
        }

        var panels = [];
        for (var i = 0; i < all.length; i++) {
            var p = all[i];
            if (!p.mesh) continue;
            p.mesh.visible = true;
            if (want && !want[p.key]) {
                // Unchanged panels stay fully visible at rest
                p.mesh.material.opacity = 1;
                p.mesh.position.copy(this._hudBasePos[p.key]);
                continue;
            }
            p.mesh.material.opacity = 0;
            panels.push(p);
        }

        if (!panels.length) {
            this._hudReveal = null;
            return;
        }

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
    // Soft-nav shell (ExplorerRouter) — keep XR session across page swaps
    // -------------------------------------------------------------------------

    function _disposeObjectTree(root) {
        if (!root) return;
        root.traverse(function (child) {
            if (child.geometry) {
                try { child.geometry.dispose(); } catch (e) { /* ignore */ }
            }
            var mats = child.material;
            if (!mats) return;
            var list = Array.isArray(mats) ? mats : [mats];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!m) continue;
                try {
                    if (m.map) m.map.dispose();
                    m.dispose();
                } catch (e) { /* ignore */ }
            }
        });
    }

    /** Remove page content meshes; keep controllers / HUD / pivot / camera. */
    VRManager.prototype.clearContent = function () {
        var self = this;
        var explorer = this.explorer;
        if (!explorer || !explorer.scene) return;
        this._clearHover();
        this._clearFocusAnchor();
        this._lastSelectObj = null;
        this._lastSelectAt = 0;

        if (this.pivot && explorer.renderer.xr && explorer.renderer.xr.isPresenting) {
            this.pivot.children.slice().forEach(function (c) {
                self.pivot.remove(c);
                _disposeObjectTree(c);
            });
            return;
        }

        explorer.scene.children.slice().forEach(function (c) {
            if (self._shouldKeepInScene(c)) return;
            explorer.scene.remove(c);
            _disposeObjectTree(c);
        });
    };

    VRManager.prototype.resetPageScale = function () {
        if (!this.pivot) return;
        var page     = this._pageId();
        var scaleMap = this._isAR ? SCALE_MAP_AR : SCALE_MAP_VR;
        var scale    = scaleMap[page] || 0.05;
        this.pivot.scale.setScalar(scale);
        this.pivot.rotation.set(0, 0, 0);
        this._needsInitialPlacement = true;
    };

    VRManager.prototype.bindExplorer = function (explorer, options) {
        options = options || {};
        this.explorer = explorer;
        if (options.panelTitle) this.panelTitle = options.panelTitle;
        if (options.panelDomId !== undefined) this.panelDomId = options.panelDomId;
        if (this.spatialPanel && options.panelTitle && typeof this.spatialPanel.setTitle === 'function') {
            this.spatialPanel.setTitle(options.panelTitle);
        }
    };

    /** After ExplorerRouter finishes creating the next page while presenting. */
    VRManager.prototype.afterSoftNav = function () {
        if (!this.explorer || !this.explorer.renderer.xr.isPresenting) return;
        this._ensureControllersInScene();
        this._adoptOrphanContent();
        this.resetPageScale();
        if (this.navMenu && typeof this.navMenu.rebuild === 'function') {
            var wasVisible = this.navMenu.group.visible;
            this.navMenu.rebuild();
            if (wasVisible) this.navMenu.show();
        }
        this._startHudReveal();
    };

    // -------------------------------------------------------------------------
    // Per-frame update (called from each page's animate loop)
    // -------------------------------------------------------------------------

    VRManager.prototype.update = function () {
        if (this.explorer.renderer.xr.isPresenting) {
            var xrCam = this.explorer.renderer.xr.getCamera();
            if (typeof window.ExplorerAudio !== 'undefined' && xrCam) {
                ExplorerAudio.attachListener(xrCam);
            }
        } else if (this.explorer.camera && typeof window.ExplorerAudio !== 'undefined') {
            ExplorerAudio.attachListener(this.explorer.camera);
        }

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

        // Nav menu hover + haptic tick on new hover (right ray; left can also hit wrist chip)
        if (this.controller0 && this.navMenu) {
            var prevHighlight = this.navMenu.highlighted;
            var prevChip = this.navMenu._chipHovered;
            this.navMenu.updateHover(this.controller0);
            if (this.controller1 && this.navMenu.hitWristChip(this.controller1)) {
                this.navMenu._setChipHover(true);
            }
            if (this.navMenu.highlighted && this.navMenu.highlighted !== prevHighlight) {
                this._haptic('right', 20, 0.2);
                if (typeof window.ExplorerAudio !== 'undefined') {
                    ExplorerAudio.play('ui-hover');
                    if (this.navMenu.highlighted.userData.pageFile) {
                        ExplorerAudio.prefetch(this.navMenu.highlighted.userData.pageFile);
                    }
                }
            } else if (this.navMenu._chipHovered && !prevChip) {
                this._haptic('right', 20, 0.2);
                if (typeof window.ExplorerAudio !== 'undefined') ExplorerAudio.play('ui-hover');
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
