// Bitcoin Explorer - Node Page
class BitcoinNodeExplorer {
    constructor(opts) {
        opts = opts || {};
        this._shell = opts.shell || null;
        this._ac = new AbortController();
        this._disposed = false;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isRotating = true;
        this.showDetails = false;
        this.nodeAddress = null;
        this.nodeData = null;
        this.vrManager = null;
        this.API_BASE = '/api/btcnodes';

        this.init();
    }

    apiUrl(pathOrUrl) {
        if (!pathOrUrl) return this.API_BASE + '/';
        if (/^https?:\/\//i.test(pathOrUrl)) {
            try {
                const u = new URL(pathOrUrl);
                if (u.hostname === 'btcnodes.io' && u.pathname.startsWith('/api')) {
                    return this.API_BASE + u.pathname.slice('/api'.length) + u.search;
                }
            } catch (e) { /* fall through */ }
            return pathOrUrl;
        }
        if (pathOrUrl.startsWith('/api/')) return this.API_BASE + pathOrUrl.slice('/api'.length);
        if (pathOrUrl.charAt(0) !== '/') pathOrUrl = '/' + pathOrUrl;
        return this.API_BASE + pathOrUrl;
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * fetch() with backoff on transient upstream errors. The BTC Nodes list
     * endpoints intermittently return 503 "server busy" under load; a single
     * blip shouldn't blow up the page. Retries 429/502/503/504 and network
     * errors, then throws a `{ retriable: true }` error. Non-retryable
     * responses (e.g. 404) are returned to the caller unchanged.
     */
    async _fetchRetry(url, { tries = 3, baseDelay = 800 } = {}) {
        for (let attempt = 1; attempt <= tries; attempt++) {
            let res = null;
            try {
                res = await fetch(url, { signal: this._ac.signal });
            } catch (e) {
                if (this._disposed) throw e;
                if (attempt < tries) { await this._delay(baseDelay * attempt); continue; }
                const err = new Error('BTC Nodes API unreachable');
                err.retriable = true; err.status = 0;
                throw err;
            }
            const busy = res.status === 429 || res.status === 502 ||
                         res.status === 503 || res.status === 504;
            if (busy && attempt < tries) {
                await this._delay(baseDelay * attempt);
                continue;
            }
            if (busy) {
                const err = new Error(`BTC Nodes API busy (HTTP ${res.status})`);
                err.retriable = true; err.status = res.status;
                throw err;
            }
            return res;
        }
    }

    init() {
        // Get node address from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.nodeAddress = urlParams.get('node');
        
        this.setupThreeJS();

        if (this._shell && this._shell.vrManager) {
            this.vrManager = this._shell.vrManager;
        } else if (typeof VRManager !== 'undefined') {
            this.vrManager = new VRManager(this, { panelTitle: 'Node', panelDomId: 'node-info' });
            this.vrManager.init();
        }

        this.setupOrbitControls();
        this.setupControls();
        this.setupPanelToggle();
        this.createScene();
        this.renderer.setAnimationLoop(() => this.animate());

        if (!this.nodeAddress) {
            // Load any reachable node when opened without ?node=
            this.loadRandomNode();
        } else {
            // Format the node address for API call
            this.apiNodeAddress = this.formatNodeAddress(this.nodeAddress);
            this.fetchData();
        }
    }
    
    async loadRandomNode() {
        this.showLoadingModal('Picking a node...');
        try {
            this.updateLoadingProgress('Fetching node list...', 20);
            const probeUrl = this.apiUrl('/v1/nodes/?page=1&limit=1');
            const probeRes = await this._fetchRetry(probeUrl);
            if (probeRes.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('BTC Nodes API');
                return;
            }
            if (!probeRes.ok) throw new Error(`HTTP ${probeRes.status}`);
            const probe = await probeRes.json();
            const total = typeof probe.count === 'number' ? probe.count : 0;
            if (total <= 0) {
                this.hideLoadingModal();
                this.showNoNodesError();
                return;
            }

            const pageSize = 50;
            const maxPage = Math.max(1, Math.ceil(total / pageSize));
            // Try a few random pages until we get a non-onion node
            let chosen = null;
            for (let attempt = 0; attempt < 5 && !chosen; attempt++) {
                const page = 1 + Math.floor(Math.random() * maxPage);
                this.updateLoadingProgress(`Sampling nodes… page ${page}`, 30 + attempt * 10);
                let listRes;
                try {
                    listRes = await this._fetchRetry(this.apiUrl(`/v1/nodes/?page=${page}&limit=${pageSize}`));
                } catch (e) {
                    continue; // transient failure on one page — try another
                }
                if (!listRes.ok) continue;
                const list = await listRes.json();
                const rows = (list.results || []).filter((r) => {
                    const addr = r && r.address;
                    return addr && typeof addr === 'string' && !addr.includes('.onion');
                });
                if (rows.length === 0) continue;
                chosen = rows[Math.floor(Math.random() * rows.length)];
            }

            if (!chosen) {
                this.hideLoadingModal();
                this.showNoNodesError();
                return;
            }

            const isIpv6 = chosen.address.includes(':');
            const displayKey = isIpv6
                ? `[${chosen.address}]:${chosen.port}`
                : `${chosen.address}:${chosen.port}`;
            this.nodeAddress = displayKey;
            this.apiNodeAddress = this.formatNodeAddress(displayKey);
            // Keep URL shareable without forcing a reload
            try {
                const next = `node.html?node=${encodeURIComponent(this.apiNodeAddress)}`;
                history.replaceState({ softNav: true }, '', next);
            } catch (e) { /* ignore */ }

            console.log('Loading random node:', this.apiNodeAddress);
            await this.fetchData();
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error loading random node:', error);
            this.showNoNodesError({ busy: !!(error && error.retriable) });
        }
    }
    
    showNoNodesError(opts = {}) {
        const busy = !!opts.busy;
        const onRetry = (typeof opts.onRetry === 'function') ? opts.onRetry : () => this.loadRandomNode();
        // Remove existing popup if any
        const existingPopup = document.querySelector('.api-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        const title = busy ? 'BTC Nodes API Busy' : 'No Nodes Available';
        const bodyHtml = busy
            ? `<p>The BTC Nodes API is temporarily busy (server overloaded).</p>
               <p>This usually clears in a few seconds — try again.</p>`
            : `<p>Unable to load network data from BTC Nodes API</p>
               <p>Please try again later or check your internet connection.</p>`;

        // Create popup element
        const popup = document.createElement('div');
        popup.className = 'api-popup';
        popup.innerHTML = `
            <div class="popup-content">
                <div class="popup-header">
                    <h3>${title}</h3>
                    <button class="popup-close">&times;</button>
                </div>
                <div class="popup-body">
                    ${bodyHtml}
                </div>
                <div class="popup-footer">
                    <a href="network.html" style="color: #ffffff; text-decoration: none; margin-right: 10px;">← Back to Network</a>
                    ${opts.onArchive ? '<button class="popup-archive">Load Archive</button>' : ''}
                    <button class="popup-retry">Retry</button>
                    <button class="popup-dismiss">Dismiss</button>
                </div>
            </div>
        `;

        // Load Archive button — ask before falling back to the local snapshot
        const archiveBtn = popup.querySelector('.popup-archive');
        if (archiveBtn) {
            archiveBtn.style.cssText = `
                padding: 6px 12px;
                border: 1px solid rgba(255,255,255,0.18);
                background: #000;
                color: #fff;
                border-radius: 2px;
                cursor: pointer;
                font-size: 12px;
                margin-left: auto;
                transition: all 0.2s;
            `;
            archiveBtn.addEventListener('mouseenter', () => { archiveBtn.style.background = '#333'; });
            archiveBtn.addEventListener('mouseleave', () => { archiveBtn.style.background = '#000'; });
            archiveBtn.addEventListener('click', () => {
                popup.remove();
                opts.onArchive();
            });
        }

        // Retry button — re-run the random-node picker (styled + wired below)
        const retryBtn = popup.querySelector('.popup-retry');
        if (retryBtn) {
            retryBtn.style.cssText = `
                padding: 6px 12px;
                border: 1px solid rgba(255,255,255,0.5);
                background: #fff;
                color: #000;
                border-radius: 2px;
                cursor: pointer;
                font-size: 12px;
                margin-left: auto;
                transition: all 0.2s;
            `;
            retryBtn.addEventListener('mouseenter', () => { retryBtn.style.background = '#ddd'; });
            retryBtn.addEventListener('mouseleave', () => { retryBtn.style.background = '#fff'; });
            retryBtn.addEventListener('click', () => {
                popup.remove();
                onRetry();
            });
        }
        
        // Add styles
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        const content = popup.querySelector('.popup-content');
        content.style.cssText = `
            background: #000;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 4px;
            max-width: 400px;
            width: 90%;
            color: white;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        `;
        
        const header = popup.querySelector('.popup-header');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const closeBtn = popup.querySelector('.popup-close');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #999;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        `;
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#fff';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#999';
        });
        
        const body = popup.querySelector('.popup-body');
        body.style.cssText = `
            padding: 20px;
            line-height: 1.5;
            font-size: 14px;
        `;
        
        const footer = popup.querySelector('.popup-footer');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            display: flex;
            gap: 8px;
            justify-content: space-between;
            align-items: center;
        `;
        
        const dismissBtn = popup.querySelector('.popup-dismiss');
        dismissBtn.style.cssText = `
            padding: 6px 12px;
            border: 1px solid rgba(255,255,255,0.18);
            background: #000;
            color: white;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        `;
        dismissBtn.addEventListener('mouseenter', () => {
            dismissBtn.style.background = '#333';
            dismissBtn.style.borderColor = 'rgba(255,255,255,0.28)';
        });
        dismissBtn.addEventListener('mouseleave', () => {
            dismissBtn.style.background = '#000';
            dismissBtn.style.borderColor = 'rgba(255,255,255,0.18)';
        });
        
        // Add event listeners
        closeBtn.addEventListener('click', () => popup.remove());
        dismissBtn.addEventListener('click', () => popup.remove());
        
        // Close on background click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.remove();
            }
        });
        
        // Auto-close after 15 seconds
        setTimeout(() => {
            if (document.body.contains(popup)) {
                popup.remove();
            }
        }, 15000);
        
        document.body.appendChild(popup);
    }
    
    formatNodeAddress(address) {
        if (!address) return address;
        // [ipv6]:port or [ipv6]-port → ipv6-port
        const bracket = address.match(/\[([^\]]+)\][:\-](\d+)/);
        if (bracket) return `${bracket[1]}-${bracket[2]}`;
        // ipv4:port → ipv4-port
        if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(address)) return address.replace(':', '-');
        // Already ADDRESS-PORT (incl. bare ipv6-port)
        return address;
    }

    setupThreeJS() {
        const signal = this._ac.signal;

        if (this._shell) {
            this.scene = this._shell.scene;
            this.camera = this._shell.camera;
            this.renderer = this._shell.renderer;
            this.scene.background = new THREE.Color(0x000000);
            if (this.camera.isPerspectiveCamera) {
                this.camera.fov = 75;
                this.camera.near = 0.1;
                this.camera.far = 1000;
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
            }
            this.camera.position.set(0, 10, 15);
            this.camera.lookAt(0, 0, 0);
            window.addEventListener('resize', () => this.onWindowResize(), { signal });
            return;
        }

        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 15);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize(), { signal });
    }

    _bindWithAbort(target, fn) {
        const signal = this._ac.signal;
        const orig = target.addEventListener.bind(target);
        target.addEventListener = (t, f, o) => {
            if (o === true) return orig(t, f, { capture: true, signal });
            if (o && typeof o === 'object') return orig(t, f, Object.assign({}, o, { signal }));
            return orig(t, f, { signal });
        };
        try { fn(); }
        finally { target.addEventListener = EventTarget.prototype.addEventListener.bind(target); }
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._ac.abort();
        this.isRotating = false;
        if (this._hoverTooltipEl && this._hoverTooltipEl.parentNode) {
            this._hoverTooltipEl.parentNode.removeChild(this._hoverTooltipEl);
            this._hoverTooltipEl = null;
        }
        // BIP / feature labels are DOM nodes on document.body — remove before dropping meshes
        if (this.scene) {
            this.scene.traverse((child) => {
                const label = child.userData && child.userData.label;
                if (label && label.parentNode) label.parentNode.removeChild(label);
                if (child.userData) child.userData.label = null;
            });
        }
        document.querySelectorAll('.feature-label').forEach((el) => el.remove());
        // Dispose scene meshes created by this page (do not dispose shared renderer)
        if (this.scene) {
            const toRemove = this.scene.children.slice();
            toRemove.forEach((child) => {
                if (child.isLight) return;
                this.scene.remove(child);
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                    else child.material.dispose();
                }
            });
        }
    }

    setupOrbitControls() {
        // Create custom orbit controls
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 15,
            phi: Math.PI / 3,
            theta: 0,
            isMouseDown: false,
            lastMouseX: 0,
            lastMouseY: 0,
            
            update: () => {
                // Update camera position based on spherical coordinates
                this.camera.position.x = this.controls.target.x + this.controls.distance * Math.sin(this.controls.phi) * Math.cos(this.controls.theta);
                this.camera.position.y = this.controls.target.y + this.controls.distance * Math.cos(this.controls.phi);
                this.camera.position.z = this.controls.target.z + this.controls.distance * Math.sin(this.controls.phi) * Math.sin(this.controls.theta);
                this.camera.lookAt(this.controls.target);
            }
        };
        
        // Set up mouse controls
        this.setupMouseControls();
        this.setupHoverTooltip();
        this.controls.update();
    }
    
    setupMouseControls() {
        const controls = this.controls;
        this._bindWithAbort(this.renderer.domElement, () => this._setupMouseControlsInner(controls));
    }

    _setupMouseControlsInner(controls) {
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            controls.isMouseDown = true;
            controls.lastMouseX = e.clientX;
            controls.lastMouseY = e.clientY;
            
            // Stop automatic rotation when user starts interacting
            this.isRotating = false;
            const button = document.getElementById('toggle-rotation');
            if (button) {
                button.textContent = 'Start Rotation';
            }
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            controls.isMouseDown = false;
        });
        
        this.renderer.domElement.addEventListener('mousemove', (e) => {
            if (controls.isMouseDown) {
                const deltaX = e.clientX - controls.lastMouseX;
                const deltaY = e.clientY - controls.lastMouseY;
                
                if (e.shiftKey) {
                    // Panning
                    const panSpeed = 0.001;
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    
                    this.camera.getWorldDirection(new THREE.Vector3());
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    
                    const panX = deltaX * panSpeed * controls.distance;
                    const panY = deltaY * panSpeed * controls.distance;
                    
                    controls.target.add(right.multiplyScalar(panX));
                    controls.target.add(up.multiplyScalar(panY));
                } else {
                    // Rotation
                    controls.theta += deltaX * 0.005;
                    controls.phi -= deltaY * 0.005;
                    controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, controls.phi));
                }
                
                controls.update();
                controls.lastMouseX = e.clientX;
                controls.lastMouseY = e.clientY;
            }
        });
        
        this.renderer.domElement.addEventListener('wheel', (e) => {
            // Stop automatic rotation when user starts zooming
            this.isRotating = false;
            const button = document.getElementById('toggle-rotation');
            if (button) {
                button.textContent = 'Start Rotation';
            }
            
            // Zoom in/out with inverted scroll direction
            controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
            controls.distance = Math.max(5, Math.min(50, controls.distance));
            controls.update();
        });

        // Add touch controls for mobile
        this.setupTouchControls();
    }

    setupTouchControls() {
        this._bindWithAbort(this.renderer.domElement, () => this._setupTouchControlsInner());
    }

    _setupTouchControlsInner() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartDistance = 0;
        let isPinching = false;
        let lastTouchTime = 0;
        let touchCount = 0;

        // Touch start
        this.renderer.domElement.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            this.isRotating = false;
            const button = document.getElementById('toggle-rotation');
            if (button) {
                button.textContent = 'Start Rotation';
            }

            if (e.touches.length === 1) {
                // Single touch - rotation/panning
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                this.controls.isMouseDown = true;
                this.controls.lastMouseX = touchStartX;
                this.controls.lastMouseY = touchStartY;
            } else if (e.touches.length === 2) {
                // Two finger touch - pinch to zoom
                isPinching = true;
                touchStartDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }

            // Double tap detection
            const currentTime = new Date().getTime();
            const timeDiff = currentTime - lastTouchTime;
            if (timeDiff < 300 && timeDiff > 0) {
                // Double tap - reset camera
                this.camera.position.set(0, 10, 20);
                this.controls.target.set(0, 0, 0);
                this.controls.distance = 20;
                this.controls.phi = Math.PI / 3;
                this.controls.theta = 0;
                this.controls.update();
            }
            lastTouchTime = currentTime;
        });

        // Touch move
        this.renderer.domElement.addEventListener('touchmove', (e) => {
            e.preventDefault();

            if (e.touches.length === 1 && !isPinching) {
                // Single finger drag - rotation/panning
                const touchX = e.touches[0].clientX;
                const touchY = e.touches[0].clientY;
                
                const deltaX = touchX - this.controls.lastMouseX;
                const deltaY = touchY - this.controls.lastMouseY;

                // Use larger sensitivity for mobile
                const sensitivity = 0.02;
                
                if (e.shiftKey || e.altKey) {
                    // Panning
                    const panSpeed = 0.002;
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    
                    this.camera.getWorldDirection(new THREE.Vector3());
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    
                    const panX = deltaX * panSpeed * this.controls.distance;
                    const panY = deltaY * panSpeed * this.controls.distance;
                    
                    this.controls.target.add(right.multiplyScalar(panX));
                    this.controls.target.add(up.multiplyScalar(panY));
                } else {
                    // Rotation
                    this.controls.theta += deltaX * sensitivity;
                    this.controls.phi -= deltaY * sensitivity;
                    this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
                }
                
                this.controls.update();
                this.controls.lastMouseX = touchX;
                this.controls.lastMouseY = touchY;
            } else if (e.touches.length === 2 && isPinching) {
                // Pinch to zoom
                const currentDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                const zoomFactor = touchStartDistance / currentDistance;
                
                this.controls.distance *= zoomFactor;
                this.controls.distance = Math.max(5, Math.min(50, this.controls.distance));
                this.controls.update();
                touchStartDistance = currentDistance;
            }
        });

        // Touch end
        this.renderer.domElement.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                this.controls.isMouseDown = false;
                isPinching = false;
            } else if (e.touches.length === 1) {
                // Switch from pinch to single touch
                isPinching = false;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                this.controls.lastMouseX = touchStartX;
                this.controls.lastMouseY = touchStartY;
            }
        });

        // Prevent default touch behaviors
        this.renderer.domElement.addEventListener('touchcancel', (e) => {
            e.preventDefault();
        });
    }

    setupHoverTooltip() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let clickedSphere = null;

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.style.position = 'absolute';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '10px 15px';
        tooltip.style.borderRadius = '6px';
        tooltip.style.fontSize = '12px';
        tooltip.style.fontFamily = 'monospace';
        tooltip.style.pointerEvents = 'auto';
        tooltip.style.zIndex = '1000';
        tooltip.style.display = 'none';
        tooltip.style.whiteSpace = 'nowrap';
        tooltip.style.maxWidth = '300px';
        tooltip.style.lineHeight = '1.4';
        document.body.appendChild(tooltip);
        this._hoverTooltipEl = tooltip;

        this._bindWithAbort(this.renderer.domElement, () => {
        this.renderer.domElement.addEventListener('mousemove', (event) => {
            // If a cuboid is clicked, don't update tooltip on mouse move
            if (clickedSphere) return;
            
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Get all interactive objects (feature cuboids, helix, and spiral)
            const interactiveObjects = this.scene.children.filter(child => 
                (child.geometry && child.geometry.type === 'BoxGeometry' && 
                 child !== this.scene.children.find(child => child.geometry && child.geometry.parameters && child.geometry.parameters.radius === 2)) ||
                (child.geometry && child.geometry.type === 'BufferGeometry' && child.userData && child.userData.name) ||
                (child.geometry && child.geometry.type === 'TubeGeometry' && child.userData && child.userData.name)
            );

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(interactiveObjects);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const featureData = intersectedObject.userData;
                
                if (featureData.name) {
                    // Format the tooltip content
                    let tooltipContent = `
                        <strong>${featureData.name}</strong>${featureData.bip ? ` &nbsp;<span style="opacity:0.6">BIP ${featureData.bip}</span>` : ''}<br>
                        ${featureData.description}<br>
                        ${featureData.supported ? '✓ Supported by this node' : '✗ Not supported by this node'}
                    `;
                    
                    // Only add "View Details" link for non-navigation objects (feature cuboids)
                    if (featureData.type === 'Bitcoin Protocol') {
                        tooltipContent += `<br><a href="${featureData.url}" target="_blank" style="color: #ffffff; text-decoration: none;">View Details →</a>`;
                    } else {
                        tooltipContent += `<br><em>Double-click to navigate</em>`;
                    }
                    
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    
                    // Position tooltip above mouse cursor
                    const tooltipRect = tooltip.getBoundingClientRect();
                    let left = event.clientX + 10;
                    let top = event.clientY - tooltipRect.height - 10;
                    
                    // Ensure tooltip stays within viewport
                    if (top < 10) {
                        top = event.clientY + 10;
                    }
                    if (left + tooltipRect.width > window.innerWidth - 10) {
                        left = event.clientX - tooltipRect.width - 10;
                    }
                    
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                }
            } else {
                tooltip.style.display = 'none';
            }
        });

        // Add click handler for interactive objects
        this.renderer.domElement.addEventListener('click', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Get all interactive objects (feature cuboids, helix, and spiral)
            const interactiveObjects = this.scene.children.filter(child => 
                (child.geometry && child.geometry.type === 'BoxGeometry' && 
                 child !== this.scene.children.find(child => child.geometry && child.geometry.parameters && child.geometry.parameters.radius === 2)) ||
                (child.geometry && child.geometry.type === 'BufferGeometry' && child.userData && child.userData.name) ||
                (child.geometry && child.geometry.type === 'TubeGeometry' && child.userData && child.userData.name)
            );

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(interactiveObjects);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const featureData = intersectedObject.userData;
                
                if (featureData.name) {
                    clickedSphere = intersectedObject;
                    
                    // Format the tooltip content
                    let tooltipContent = `
                        <strong>${featureData.name}</strong>${featureData.bip ? ` &nbsp;<span style="opacity:0.6">BIP ${featureData.bip}</span>` : ''}<br>
                        ${featureData.description}<br>
                        ${featureData.supported ? '✓ Supported by this node' : '✗ Not supported by this node'}
                    `;
                    
                    // Only add "View Details" link for non-navigation objects (feature cuboids)
                    if (featureData.type === 'Bitcoin Protocol') {
                        tooltipContent += `<br><a href="${featureData.url}" target="_blank" style="color: #ffffff; text-decoration: none;">View Details →</a>`;
                    } else {
                        tooltipContent += `<br><em>Double-click to navigate</em>`;
                    }
                    
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    
                    // Position tooltip near mouse cursor (same as hover)
                    const tooltipRect = tooltip.getBoundingClientRect();
                    let left = event.clientX + 10;
                    let top = event.clientY - tooltipRect.height - 10;
                    
                    // Ensure tooltip stays within viewport
                    if (top < 10) {
                        top = event.clientY + 10;
                    }
                    if (left + tooltipRect.width > window.innerWidth - 10) {
                        left = event.clientX - tooltipRect.width - 10;
                    }
                    
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                }
            } else {
                // Clicked elsewhere, hide tooltip
                clickedSphere = null;
                tooltip.style.display = 'none';
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            if (!clickedSphere) {
                tooltip.style.display = 'none';
            }
        });
        
        // Add double-click handler for navigation
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Get all interactive objects (feature cuboids, helix, and spiral)
            const interactiveObjects = this.scene.children.filter(child => 
                (child.geometry && child.geometry.type === 'BoxGeometry' && 
                 child !== this.scene.children.find(child => child.geometry && child.geometry.parameters && child.geometry.parameters.radius === 2)) ||
                (child.geometry && child.geometry.type === 'BufferGeometry' && child.userData && child.userData.name) ||
                (child.geometry && child.geometry.type === 'TubeGeometry' && child.userData && child.userData.name)
            );

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(interactiveObjects);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const featureData = intersectedObject.userData;
                
                if (featureData.name && featureData.url) {
                    // Navigate to the specified URL
                    explorerNavigate(featureData.url);
                }
            }
        });
        });
    }

    setupControls() {
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            // The button holds an <img> icon (from ControlsCamera) — swap its src,
            // don't overwrite textContent (which would destroy the icon).
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = this.isRotating ? 'imgs/icons/pause.svg' : 'imgs/icons/play.svg';
            const btn = document.getElementById('toggle-rotation');
            const label = this.isRotating ? 'Pause rotation' : 'Start rotation';
            if (btn) { btn.title = label; btn.setAttribute('aria-label', label); }
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 10, 15);
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 15;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.update();
        });
        
        document.getElementById('toggle-details').addEventListener('click', () => {
            this.showDetails = !this.showDetails;
            const button = document.getElementById('toggle-details');
            button.textContent = this.showDetails ? 'Hide Details' : 'Show Details';
        });
        
        // Navigation controls
        document.getElementById('rotate-left').addEventListener('click', () => {
            this.rotateLeft();
        });
        
        document.getElementById('rotate-right').addEventListener('click', () => {
            this.rotateRight();
        });
        
        document.getElementById('rotate-up').addEventListener('click', () => {
            this.rotateUp();
        });
        
        document.getElementById('rotate-down').addEventListener('click', () => {
            this.rotateDown();
        });
        
        document.getElementById('pan-left').addEventListener('click', () => {
            this.panLeft();
        });
        
        document.getElementById('pan-right').addEventListener('click', () => {
            this.panRight();
        });
        
        document.getElementById('pan-up').addEventListener('click', () => {
            this.panUp();
        });
        
        document.getElementById('pan-down').addEventListener('click', () => {
            this.panDown();
        });
        
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.zoomIn();
        });
        
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.zoomOut();
        });
    }

    createScene() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        this.scene.add(directionalLight);
        
        this.createNodeVisualization();
    }

    createNodeVisualization() {
        // Create main node as white sphere
        const nodeGeometry = new THREE.SphereGeometry(6, 32, 32); // Increased radius from 4 to 6
        const nodeMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            transparent: true,
            opacity: 0.15, // Reduced opacity from 0.3 to 0.15
            depthWrite: false,  // Prevent depth writing issues with transparency
            alphaTest: 0.1      // Help with transparency sorting
        });
        const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
        node.position.set(0, 0, 0);
        this.scene.add(node);

        // Network context is data-driven — only drawn for UP nodes once data
        // loads (see updateUI → createNetworkConnections).

        // Create blockchain helix inside the sphere
        this.createBlockchainHelix();
        
        // Create mempool spiral next to the sphere
        this.createMempoolSpiral();

        // Feature ring is data-driven and built once the node loads (renderNodeFeatures).
    }
    
    createTextLabel(sphere, text, supported = true) {
        // Create HTML element for text label
        const label = document.createElement('div');
        label.className = 'feature-label';
        label.textContent = text;
        label.style.position = 'absolute';
        label.style.color = supported ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.4)';
        label.style.fontSize = '10px';
        label.style.fontFamily = 'monospace';
        label.style.fontWeight = 'bold';
        label.style.textAlign = 'center';
        label.style.pointerEvents = 'none';
        label.style.zIndex = '1000';
        label.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        label.style.padding = '2px 6px';
        label.style.borderRadius = '3px';
        label.style.whiteSpace = 'nowrap';
        label.style.display = 'none';

        document.body.appendChild(label);

        // Store reference to label in sphere
        sphere.userData.label = label;
    }
    
    /**
     * Derive which BIPs / P2P features this node supports from its protocol
     * version, service-flag bitfield, and software (user-agent) version.
     * Returns an ordered list of { name, description, url, supported }.
     */
    computeNodeFeatures(version, services, userAgent) {
        const proto = Number(version) || 0;
        const bits = Number(services) || 0;
        const hasBit = (b) => (bits & b) === b;

        // Parse Bitcoin Core version out of a "/Satoshi:30.0.0/" user agent.
        // Returns a comparable number: 30.0.0 -> 30.0, 0.21.1 -> 0.21.
        let coreVer = 0;
        const m = /Satoshi:(\d+)\.(\d+)/.exec(String(userAgent || ''));
        if (m) coreVer = parseInt(m[1], 10) + parseInt(m[2], 10) / 100;

        // `shape` groups BIPs by the KIND of function they add, so each family
        // gets a distinct organelle geometry:
        //   box=structure  octa=consensus/crypto  icosa=filtering
        //   cone=relay/messaging  tetra=policy  dodeca=addressing
        //   torus=transport  cylinder=resource/storage
        return [
            {
                name: 'SegWit', bip: '141', shape: 'box',
                description: 'Segregated Witness — moves signatures out of the tx body (NODE_WITNESS service)',
                url: 'https://bips.dev/141/', supported: hasBit(8)
            },
            {
                name: 'Bloom', bip: '37 / 111', shape: 'icosa',
                description: 'Bloom filter serving for light clients (NODE_BLOOM service)',
                url: 'https://bips.dev/111/', supported: hasBit(4)
            },
            {
                name: 'Cmpct Filters', bip: '157 / 158', shape: 'icosa',
                description: 'Compact block filters for private light clients (NODE_COMPACT_FILTERS)',
                url: 'https://bips.dev/158/', supported: hasBit(64)
            },
            {
                name: 'Limited', bip: '159', shape: 'cylinder',
                description: 'Pruned / limited peer serving only recent blocks (NODE_NETWORK_LIMITED)',
                url: 'https://bips.dev/159/', supported: hasBit(1024)
            },
            {
                name: 'V2 Transport', bip: '324', shape: 'torus',
                description: 'Encrypted v2 peer-to-peer transport (NODE_P2P_V2)',
                url: 'https://bips.dev/324/', supported: hasBit(2048)
            },
            {
                name: 'SendHeaders', bip: '130', shape: 'cone',
                description: 'Direct headers announcement (protocol ≥ 70012)',
                url: 'https://bips.dev/130/', supported: proto >= 70012
            },
            {
                name: 'FeeFilter', bip: '133', shape: 'tetra',
                description: 'feefilter message — advertise minimum relay fee (protocol ≥ 70013)',
                url: 'https://bips.dev/133/', supported: proto >= 70013
            },
            {
                name: 'Cmpct Blocks', bip: '152', shape: 'cone',
                description: 'Compact block relay — bandwidth-efficient block propagation (protocol ≥ 70014)',
                url: 'https://bips.dev/152/', supported: proto >= 70014
            },
            {
                name: 'AddrV2', bip: '155', shape: 'dodeca',
                description: 'addrv2 gossip — richer peer address types (protocol ≥ 70016)',
                url: 'https://bips.dev/155/', supported: proto >= 70016
            },
            {
                name: 'WTXID Relay', bip: '339', shape: 'cone',
                description: 'wtxid-based transaction relay (protocol ≥ 70016)',
                url: 'https://bips.dev/339/', supported: proto >= 70016
            },
            {
                name: 'Taproot', bip: '340–342', shape: 'octa',
                description: 'Taproot — Schnorr signatures & Tapscript enforcement (Bitcoin Core ≥ 22.0)',
                url: 'https://bips.dev/341/', supported: coreVer >= 22
            }
        ];
    }

    /** (Re)build the ring of BIP "organelles" from this node's real capabilities. */
    renderNodeFeatures(version, services, userAgent) {
        if (this._disposed || !this.scene) return;
        if (!this.featureCuboids) this.featureCuboids = [];

        // Tear down any previously rendered organelles + their labels
        this.featureCuboids.forEach((organelle) => {
            if (organelle.userData && organelle.userData.label && organelle.userData.label.remove) {
                organelle.userData.label.remove();
            }
            this.scene.remove(organelle);
            if (organelle.geometry) organelle.geometry.dispose();
            if (organelle.material) organelle.material.dispose();
        });
        this.featureCuboids = [];

        const features = this.computeNodeFeatures(version, services, userAgent);
        const n = features.length;
        const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle

        features.forEach((feature, index) => {
            // Fibonacci-sphere distribution suspends the organelles evenly through
            // the cytoplasm (inside the ~6-radius membrane) for a cell-like look.
            const yUnit = 1 - (index / Math.max(1, n - 1)) * 2; // 1 .. -1
            const rUnit = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
            const phi = index * golden;
            const shellR = 3.2 + (Math.random() - 0.5) * 0.8; // slight radial jitter

            const x = Math.cos(phi) * rUnit * shellR;
            const y = yUnit * shellR;
            const z = Math.sin(phi) * rUnit * shellR;

            // Simple cuboids for every feature; monochrome, with unsupported
            // features shown as faint wireframe "ghost" cuboids.
            const geometry = new THREE.BoxGeometry(0.9, 0.9, 0.3);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: feature.supported ? 0.7 : 0.12,
                wireframe: !feature.supported
            });

            const organelle = new THREE.Mesh(geometry, material);
            organelle.position.set(x, y, z);
            // Static orientation, standing perpendicular to the sphere surface
            // (long axis aligned with the radial direction from the center).
            const radial = new THREE.Vector3(x, y, z).normalize();
            organelle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);

            organelle.userData = {
                name: feature.name,
                bip: feature.bip,
                description: feature.description,
                url: feature.url,
                supported: feature.supported,
                type: 'Bitcoin Protocol',
                index: index
            };

            this.scene.add(organelle);
            this.featureCuboids.push(organelle);
            this.createTextLabel(organelle, feature.name, feature.supported);
        });
    }
    
    createBlockchainHelix() {
        // Create a helix inside the sphere representing the blockchain.
        // Laid down along the X axis (horizontal) rather than standing vertical.
        const points = [];
        const segments = 250; // More segments for longer helix
        const radius = 0.5; // Even smaller radius for more compression
        const length = 5; // Length of the chain along its (horizontal) axis

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI * 10; // 5 full rotations for more compression
            const x = (t - 0.5) * length;   // long axis is now horizontal (X)
            const y = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, y, z));
        }

        // Tip = latest block (t = 1) at the +X end; used to anchor the mempool spiral.
        this.blockchainTipX = length / 2;
        
        // Create a path from the points
        const path = new THREE.CatmullRomCurve3(points);
        
        // Create a tube geometry for thickness
        const tubeGeometry = new THREE.TubeGeometry(path, segments, 0.15, 8, false);
        
        const helixMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9
        });
        
        const helix = new THREE.Mesh(tubeGeometry, helixMaterial);
        helix.position.set(0, 0, 0);
        
        // Store data for tooltip and navigation
        helix.userData = {
            name: "Blockchain",
            description: "The complete chain of blocks",
            type: "Blockchain",
            year: "Ongoing",
            url: "blockchain.html"
        };
        
        this.scene.add(helix);
    }
    
    createMempoolSpiral() {
        // Create a flat white spiral positioned just past the blockchain tip,
        // representing the mempool feeding the next block.
        const spiralGeometry = new THREE.BufferGeometry();
        const points = [];
        const segments = 120; // More segments for longer spiral
        const radius = 0.8;

        // Sit just beyond the latest-block tip of the (horizontal) blockchain.
        const tipX = (this.blockchainTipX != null) ? this.blockchainTipX : 2.5;
        const offsetX = tipX + radius + 0.8;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI * 4; // 2 full rotations for longer spiral
            const currentRadius = radius * (1 - t * 0.6); // Slower radius decrease
            const x = Math.cos(angle) * currentRadius + offsetX; // anchored to the tip
            const y = 0; // Keep it flat (no height variation)
            const z = Math.sin(angle) * currentRadius;
            points.push(new THREE.Vector3(x, y, z));
        }
        
        spiralGeometry.setFromPoints(points);
        
        const spiralMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        
        const spiral = new THREE.Line(spiralGeometry, spiralMaterial);
        spiral.position.set(0, 0, 0);
        
        // Store data for tooltip and navigation
        spiral.userData = {
            name: "Mempool",
            description: "Pending transactions waiting to be mined",
            type: "Mempool",
            year: "Dynamic",
            url: "mempool.html"
        };
        
        this.scene.add(spiral);
    }
    
    /**
     * Render the node in the context of the surrounding network — a closeup crop
     * of the wider graph. Bright connections radiate to peer nodes that fade to
     * dark (reading as distance), peers interconnect, and a few links continue
     * further out into the faint background.
     */
    /** Remove any previously drawn network-context meshes (lines + peer nodes). */
    clearNetworkConnections() {
        if (!this.networkMeshes) { this.networkMeshes = []; return; }
        this.networkMeshes.forEach((m) => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.networkMeshes = [];
    }

    createNetworkConnections() {
        // Rebuild from scratch (a previous node's network may still be present).
        this.clearNetworkConnections();

        const sphereRadius = 6;
        const peerCount = 20;

        // Brightness as a function of distance from the node's centre: bright at
        // the surface (light emanating from the node) fading to black in the
        // distance. Every colour in the scene is derived from this so depth reads
        // consistently — the farther from the node, the darker.
        const MAX_DIST = 850;
        const shadeForDistance = (dist) => {
            const t = Math.max(0, 1 - dist / MAX_DIST);
            const b = Math.pow(t, 1.5); // eased falloff for a glow-like gradient
            return new THREE.Color(b, b, b);
        };
        const nearColor = shadeForDistance(sphereRadius); // bright at the surface

        // Peer node size shrinks with distance to exaggerate the depth/scale.
        const sizeForDistance = (dist) => Math.max(0.4, 1.2 - dist / 500);

        // A line whose colour fades between its two endpoints. Against the black
        // background, fading toward dark grey reads as "receding into the distance".
        const addFadingLine = (a, colorA, b, colorB, opacity) => {
            const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
            geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
                colorA.r, colorA.g, colorA.b,
                colorB.r, colorB.g, colorB.b
            ]), 3));
            const mat = new THREE.LineBasicMaterial({
                vertexColors: true, transparent: true, opacity: opacity
            });
            const line = new THREE.Line(geom, mat);
            this.scene.add(line);
            this.networkMeshes.push(line);
            return line;
        };

        const addPeerNode = (pos, color, size) => {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(size, 12, 12),
                new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9 })
            );
            mesh.position.copy(pos);
            this.scene.add(mesh);
            this.networkMeshes.push(mesh);
            return mesh;
        };

        const peers = [];

        // 1) Primary connections: node -> a ring of peers pushed well out, so the
        //    surrounding network feels vast. Bright gradient = light emanating.
        for (let i = 0; i < peerCount; i++) {
            const angle = (i / peerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
            const elevation = (Math.random() - 0.5) * Math.PI * 0.55;
            const distance = 150 + Math.random() * 210; // 150–360

            const dir = new THREE.Vector3(
                Math.cos(angle) * Math.cos(elevation),
                Math.sin(elevation),
                Math.sin(angle) * Math.cos(elevation)
            );

            const start = dir.clone().multiplyScalar(sphereRadius);
            const end = dir.clone().multiplyScalar(distance);

            // Gradient darkens with distance → the node appears to emanate light.
            const farColor = shadeForDistance(distance);

            addFadingLine(start, nearColor, end, farColor, 0.5);
            addPeerNode(end, farColor, sizeForDistance(distance));
            peers.push({ pos: end, color: farColor, dir: dir });
        }

        // 2) Connections between peers — a denser faint mesh. Each peer links to
        //    its 2 nearest neighbours plus 1–2 random peers (deduped).
        const linkKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
        const linked = new Set();
        for (let i = 0; i < peers.length; i++) {
            const others = peers
                .map((p, j) => ({ j, d: peers[i].pos.distanceTo(p.pos) }))
                .filter((o) => o.j !== i)
                .sort((a, b) => a.d - b.d);
            if (!others.length) continue;

            const targets = others.slice(0, 2); // 2 nearest
            const extra = 1 + Math.floor(Math.random() * 2); // + 1–2 random
            for (let k = 0; k < extra; k++) {
                targets.push(others[Math.floor(Math.random() * others.length)]);
            }
            targets.forEach((t) => {
                const key = linkKey(i, t.j);
                if (linked.has(key)) return;
                linked.add(key);
                addFadingLine(peers[i].pos, peers[i].color, peers[t.j].pos, peers[t.j].color, 0.12);
            });
        }

        // 3) Second tier: each peer spawns 1–3 children further out, extending the
        //    network into the distance.
        const tier2 = [];
        peers.forEach((p) => {
            const kids = 1 + Math.floor(Math.random() * 3);
            for (let k = 0; k < kids; k++) {
                const jitter = new THREE.Vector3(
                    (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)
                ).multiplyScalar(0.85);
                const outDir = p.dir.clone().add(jitter).normalize();
                const childPos = p.pos.clone().add(outDir.multiplyScalar(90 + Math.random() * 170));
                const childColor = shadeForDistance(childPos.length());
                addFadingLine(p.pos, p.color, childPos, childColor, 0.16);
                addPeerNode(childPos, childColor, sizeForDistance(childPos.length()));
                tier2.push({ pos: childPos, color: childColor });
            }
        });

        // 4) Deep background field — a faint dome of distant nodes filling the
        //    volume, so the node sits inside a vast network receding into black.
        const golden = Math.PI * (3 - Math.sqrt(5));
        const fieldCount = 46;
        const field = [];
        for (let i = 0; i < fieldCount; i++) {
            const yUnit = 1 - (i / (fieldCount - 1)) * 2;
            const rUnit = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
            const phi = i * golden;
            const R = 380 + Math.random() * 320; // 380–700
            const pos = new THREE.Vector3(
                Math.cos(phi) * rUnit * R,
                yUnit * R,
                Math.sin(phi) * rUnit * R
            );
            const color = shadeForDistance(pos.length());
            addPeerNode(pos, color, sizeForDistance(pos.length()));
            field.push({ pos: pos, color: color });
        }

        // Sparse links within the field and from tier-2 into it, tying the far
        // network together as a dim web.
        for (let i = 0; i < field.length; i++) {
            if (Math.random() < 0.5) {
                const j = Math.floor(Math.random() * field.length);
                if (j !== i) addFadingLine(field[i].pos, field[i].color, field[j].pos, field[j].color, 0.06);
            }
        }
        tier2.forEach((t) => {
            if (Math.random() < 0.5 && field.length) {
                const f = field[Math.floor(Math.random() * field.length)];
                addFadingLine(t.pos, t.color, f.pos, f.color, 0.06);
            }
        });
    }

    async fetchData() {
        this.showLoadingModal('Loading node data...');
        
        try {
            this.updateLoadingProgress('Fetching node information...', 30);
            const path = `/v1/nodes/${encodeURIComponent(this.apiNodeAddress)}/`;
            const response = await this._fetchRetry(this.apiUrl(path));

            if (!response.ok) {
                if (response.status === 404) {
                    console.error('Node not found or not activated:', this.apiNodeAddress);
                    this.hideLoadingModal();
                    this.showNodeNotFoundError();
                    return;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.updateLoadingProgress('Processing node data...', 70);
            this.nodeData = await response.json();
            console.log('Fetched node data:', this.nodeData);

            if (this.nodeData && this.nodeData.found === false) {
                this.hideLoadingModal();
                this.showNodeNotFoundError();
                return;
            }
            
            this.updateLoadingProgress('Creating visualization...', 90);
            this.updateDataSourceDisclaimer(false); // live data OK — clear any archive/error flags
            this.updateUI();

            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching node data:', error);
            this.updateDataSourceDisclaimer(false, 'live API unavailable');
            // Always ask before falling back to the local archive
            this.showNoNodesError({
                busy: !!(error && error.retriable),
                onRetry: () => this.fetchData(),
                onArchive: () => this.loadLocalArchive()
            });
        }
    }

    updateDataSourceDisclaimer(usingArchive, errorMsg) {
        const el = document.getElementById('disclaimer-archive');
        if (el) {
            if (usingArchive) el.removeAttribute('hidden');
            else el.setAttribute('hidden', '');
        }
        const errEl = document.getElementById('disclaimer-error');
        if (errEl) {
            if (errorMsg) {
                errEl.textContent = ` · ${errorMsg}`;
                errEl.removeAttribute('hidden');
            } else {
                errEl.setAttribute('hidden', '');
            }
        }
    }

    /**
     * Fallback: load a node from the bundled local snapshot archive. Prefers the
     * requested address if present; otherwise picks a random archive node.
     */
    async loadLocalArchive() {
        const ARCHIVE_PATH = 'js/bitnodes-snapshot-1772712282.json';
        this.showLoadingModal('Loading archive snapshot...');
        try {
            this.updateLoadingProgress('Loading archive snapshot...', 20);
            const response = await fetch(ARCHIVE_PATH);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            const nodes = (data && data.nodes) || {};
            const keys = Object.keys(nodes).filter((k) => k && !k.includes('.onion'));
            if (keys.length === 0) throw new Error('No nodes in archive');

            // Prefer the requested node; otherwise a random one.
            let key = null;
            if (this.apiNodeAddress) {
                key = keys.find((k) => this.formatNodeAddress(k) === this.apiNodeAddress) || null;
            }
            if (!key && this.nodeAddress) key = keys.find((k) => k === this.nodeAddress) || null;
            if (!key) key = keys[Math.floor(Math.random() * keys.length)];

            const arr = nodes[key];
            this.nodeAddress = key;
            this.apiNodeAddress = this.formatNodeAddress(key);
            this.nodeData = {
                found: true,
                status: 'UP',
                address: key,
                hostname: arr[5],
                data: arr,
                node: { rank: 0, service_flags: [] },
                rtt: 0,
                _archive: true
            };

            this.updateLoadingProgress('Creating visualization...', 80);
            this.updateDataSourceDisclaimer(true);
            this.updateUI();
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => this.hideLoadingModal(), 400);
        } catch (error) {
            console.error('Failed to load node archive:', error);
            this.hideLoadingModal();
            this.showGenericError('local archive data');
        }
    }

    showRateLimitError(apiName) {
        this.showPopupMessage(
            'Rate Limit Exceeded',
            `${apiName} is temporarily unavailable due to too many requests. Please try again in a few minutes.`,
            'warning'
        );
    }
    
    showGenericError(dataType) {
        this.showPopupMessage(
            'Error',
            `Failed to load ${dataType}. Please check your connection and try again.`,
            'error'
        );
    }
    
    showPopupMessage(title, message, type = 'info') {
        // Remove existing popup if any
        const existingPopup = document.querySelector('.api-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // Create popup element
        const popup = document.createElement('div');
        popup.className = 'api-popup';
        popup.innerHTML = `
            <div class="popup-content">
                <div class="popup-header">
                    <h3>${title}</h3>
                    <button class="popup-close">&times;</button>
                </div>
                <div class="popup-body">
                    <p>${message}</p>
                </div>
                <div class="popup-footer">
                    <button class="popup-retry">Retry</button>
                    <button class="popup-dismiss">Dismiss</button>
                </div>
            </div>
        `;
        
        // Add styles
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        const content = popup.querySelector('.popup-content');
        content.style.cssText = `
            background: #000;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 4px;
            max-width: 350px;
            width: 90%;
            color: white;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        `;
        
        const header = popup.querySelector('.popup-header');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const closeBtn = popup.querySelector('.popup-close');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #999;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        `;
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#fff';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#999';
        });
        
        const body = popup.querySelector('.popup-body');
        body.style.cssText = `
            padding: 20px;
            line-height: 1.5;
            font-size: 14px;
        `;
        
        const footer = popup.querySelector('.popup-footer');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        `;
        
        const buttons = popup.querySelectorAll('button');
        buttons.forEach(btn => {
            if (btn.className.includes('popup-')) {
                btn.style.cssText = `
                    padding: 6px 12px;
                    border: 1px solid rgba(255,255,255,0.18);
                    background: #000;
                    color: white;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                `;
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#333';
                    btn.style.borderColor = 'rgba(255,255,255,0.28)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#000';
                    btn.style.borderColor = 'rgba(255,255,255,0.18)';
                });
            }
        });
        
        // Add event listeners
        closeBtn.addEventListener('click', () => popup.remove());
        popup.querySelector('.popup-dismiss').addEventListener('click', () => popup.remove());
        popup.querySelector('.popup-retry').addEventListener('click', () => {
            popup.remove();
            this.fetchData();
        });
        
        // Close on background click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.remove();
            }
        });
        
        // Auto-close after 10 seconds
        setTimeout(() => {
            if (document.body.contains(popup)) {
                popup.remove();
            }
        }, 10000);
        
        document.body.appendChild(popup);
    }
    
    showNodeNotFoundError() {
        // Remove existing popup if any
        const existingPopup = document.querySelector('.api-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // Check if this is a TOR node
        const isTorNode = this.nodeAddress && this.nodeAddress.includes('.onion');
        
        // Create popup element
        const popup = document.createElement('div');
        popup.className = 'api-popup';
        popup.innerHTML = `
            <div class="popup-content">
                <div class="popup-header">
                    <h3>${isTorNode ? 'TOR Node Not Supported' : 'Node Not Found'}</h3>
                    <button class="popup-close">&times;</button>
                </div>
                <div class="popup-body">
                    <p>The node <strong>${this.nodeAddress}</strong> ${isTorNode ? 'is a TOR node' : 'was not found or is not activated'}.</p>
                    ${isTorNode ? 
                        '<p>TOR nodes (.onion addresses) are not supported for individual node queries.</p>' :
                        '<p>This can happen with:</p><ul style="text-align: left; margin: 10px 0; padding-left: 20px;"><li>Nodes that are currently offline</li><li>Nodes not present in the latest BTC Nodes snapshot</li></ul>'
                    }
                </div>
                <div class="popup-footer">
                    <a href="network.html" style="color: #ffffff; text-decoration: none; margin-right: 10px;">← Back to Network</a>
                    <button class="popup-dismiss">Dismiss</button>
                </div>
            </div>
        `;
        
        // Add styles
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        const content = popup.querySelector('.popup-content');
        content.style.cssText = `
            background: #000;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 4px;
            max-width: 400px;
            width: 90%;
            color: white;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        `;
        
        const header = popup.querySelector('.popup-header');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const closeBtn = popup.querySelector('.popup-close');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: #999;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s;
        `;
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#fff';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#999';
        });
        
        const body = popup.querySelector('.popup-body');
        body.style.cssText = `
            padding: 20px;
            line-height: 1.5;
            font-size: 14px;
        `;
        
        const footer = popup.querySelector('.popup-footer');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            display: flex;
            gap: 8px;
            justify-content: space-between;
            align-items: center;
        `;
        
        const dismissBtn = popup.querySelector('.popup-dismiss');
        dismissBtn.style.cssText = `
            padding: 6px 12px;
            border: 1px solid rgba(255,255,255,0.18);
            background: #000;
            color: white;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        `;
        dismissBtn.addEventListener('mouseenter', () => {
            dismissBtn.style.background = '#333';
            dismissBtn.style.borderColor = 'rgba(255,255,255,0.28)';
        });
        dismissBtn.addEventListener('mouseleave', () => {
            dismissBtn.style.background = '#000';
            dismissBtn.style.borderColor = 'rgba(255,255,255,0.18)';
        });
        
        // Add event listeners
        closeBtn.addEventListener('click', () => popup.remove());
        dismissBtn.addEventListener('click', () => popup.remove());
        
        // Close on background click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.remove();
            }
        });
        
        // Auto-close after 15 seconds
        setTimeout(() => {
            if (document.body.contains(popup)) {
                popup.remove();
            }
        }, 15000);
        
        document.body.appendChild(popup);
        
        // Update UI with error state
        this.updateUI();
    }

    updateUI() {
        if (!this.nodeData || this.nodeData.detail) {
            // Set all fields to error state
            const fields = [
                'node-address', 'node-status-display', 'node-rank', 'node-version',
                'node-user-agent', 'node-height', 'node-latency', 'node-services',
                'node-hostname', 'node-city', 'node-country', 'node-coordinates',
                'node-timezone', 'node-asn', 'node-org', 'node-uptime'
            ];
            fields.forEach(field => {
                const element = document.getElementById(field);
                if (element) element.textContent = 'Not Available';
            });

            // Update subtitle for error state
            const subtitle = `${this.nodeAddress || 'Unknown'} • Not Found`;
            document.getElementById('node-subtitle').textContent = subtitle;

            this.clearNetworkConnections();
            return;
        }

        // BTC Nodes status `data`: version, userAgent, connectedSince, services, height,
        // hostname, city, country, lat, lng, timezone, asn, org
        const [
            version, userAgent, connectedSince, services, height,
            hostname, city, country, lat, lng, timezone, asn, org
        ] = this.nodeData.data || [];

        let uptimeText = 'N/A';
        if (connectedSince) {
            const uptimeMs = Date.now() - (connectedSince * 1000);
            if (uptimeMs > 0) {
                const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
                const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                uptimeText = `${uptimeDays} days, ${uptimeHours} hours`;
            }
        }

        const coordinatesText = (lat != null && lng != null && lat !== 0 && lng !== 0)
            ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
            : 'N/A';

        const updateField = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = (value || value === 0) ? String(value) : 'N/A';
        };

        const displayAddress = this.nodeData.address
            ? (this.nodeAddress || this.nodeData.address)
            : (this.nodeAddress || 'N/A');

        // Rank and latency come from the node sub-object / top-level rtt
        const rank = this.nodeData.node && this.nodeData.node.rank;
        const rtt = this.nodeData.rtt;
        const rankText = (rank && rank > 0) ? `#${rank}` : 'N/A';
        const latencyText = (rtt && rtt > 0) ? `${Math.round(rtt)} ms` : 'N/A';
        const servicesText = this.decodeServices(services) || 'N/A';

        updateField('node-address', displayAddress);
        updateField('node-status-display', this.nodeData.status || (this.nodeData.found ? 'UP' : 'DOWN'));
        updateField('node-rank', rankText);
        updateField('node-version', version);
        updateField('node-user-agent', userAgent);
        updateField('node-height', height);
        updateField('node-latency', latencyText);
        updateField('node-services', servicesText);
        updateField('node-hostname', hostname || this.nodeData.hostname);
        updateField('node-city', city);
        updateField('node-country', country);
        updateField('node-coordinates', coordinatesText);
        updateField('node-timezone', timezone);
        updateField('node-asn', asn);
        updateField('node-org', org);
        updateField('node-uptime', uptimeText);

        const status = this.nodeData.status || (this.nodeData.found ? 'UP' : 'DOWN');
        const uaPrefix = userAgent ? `${userAgent} • ` : '';
        const archivePrefix = this.nodeData._archive ? 'ARCHIVE · ' : '';
        document.getElementById('node-subtitle').textContent = `${archivePrefix}${uaPrefix}${displayAddress} • ${status}`;

        // Rebuild the 3D feature ring from this node's real capabilities
        this.renderNodeFeatures(version, services, userAgent);

        // Only an UP node participates in the network — hide connections if down
        if (String(status).toUpperCase() === 'UP') {
            this.createNetworkConnections();
        } else {
            this.clearNetworkConnections();
        }
    }

    /**
     * Human-readable P2P service flags. Prefers the API's decoded
     * `node.service_flags` (with labels); falls back to decoding the raw
     * `services` bitfield from the status `data` array.
     */
    decodeServices(services) {
        // Prefer the API-provided labelled flags when available
        const flags = this.nodeData && this.nodeData.node && this.nodeData.node.service_flags;
        if (Array.isArray(flags) && flags.length) {
            const labels = flags
                .map((f) => f && (f.label || f.name))
                .filter(Boolean);
            if (labels.length) return labels.join(', ');
        }

        // Fallback: decode the raw bitfield
        const bits = Number(services) || 0;
        if (!bits) return '';
        const MAP = [
            [1, 'NETWORK'],
            [2, 'GETUTXO'],
            [4, 'BLOOM'],
            [8, 'WITNESS'],
            [16, 'XTHIN'],
            [64, 'COMPACT_FILTERS'],
            [1024, 'NETWORK_LIMITED'],
            [2048, 'P2P_V2']
        ];
        const labels = MAP.filter(([bit]) => (bits & bit) === bit).map(([, name]) => name);
        return labels.join(', ');
    }

    animate() {
        if (this._disposed) return;
        if (this.isRotating) {
            this.scene.rotation.y += 0.001;
        }

        // Update text label positions
        this.updateTextLabels();

        this.vrManager && this.vrManager.update();
        this.renderer.render(this.scene, this.camera);
    }

    updateTextLabels() {
        if (this._disposed || !this.scene) return;
        // Position labels over the BIP organelles tracked in featureCuboids
        const featureCuboids = this.featureCuboids || [];

        featureCuboids.forEach(cuboid => {
            if (cuboid.userData.label) {
                const label = cuboid.userData.label;
                if (!label.isConnected) {
                    cuboid.userData.label = null;
                    return;
                }
                
                // Get the world position of the cuboid (accounting for scene rotation)
                const worldPosition = cuboid.getWorldPosition(new THREE.Vector3());
                
                // Convert 3D position to screen coordinates
                const vector = worldPosition.clone();
                vector.project(this.camera);
                
                // Convert to screen coordinates
                const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
                
                // Show labels only when "Details" is on and the cuboid faces the camera
                if (this.showDetails && vector.z < 1) {
                    label.style.display = 'block';
                    label.style.left = x + 'px';
                    label.style.top = (y - 20) + 'px'; // Position above cuboid
                } else {
                    label.style.display = 'none';
                }
            }
        });
    }

    onWindowResize() {
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    showLoadingModal(message) {
        // Remove existing loading modal if any
        const existingModal = document.querySelector('.loading-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create loading modal
        const modal = document.createElement('div');
        modal.className = 'loading-modal';
        modal.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-text">${message}</div>
                <div class="loading-progress">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="progress-text">0%</div>
                </div>
            </div>
        `;
        
        // Add styles
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        const content = modal.querySelector('.loading-content');
        content.style.cssText = `
            background: #000;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 4px;
            padding: 40px;
            text-align: center;
            color: white;
            min-width: 300px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        `;
        
        const spinner = modal.querySelector('.loading-spinner');
        spinner.style.cssText = `
            width: 40px;
            height: 40px;
            border: 2px solid #333;
            border-top: 2px solid #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        `;
        
        const text = modal.querySelector('.loading-text');
        text.style.cssText = `
            font-size: 16px;
            margin-bottom: 20px;
            color: #ccc;
        `;
        
        const progress = modal.querySelector('.loading-progress');
        progress.style.cssText = `
            margin-top: 20px;
        `;
        
        const progressBar = modal.querySelector('.progress-bar');
        progressBar.style.cssText = `
            width: 100%;
            height: 4px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
            margin-bottom: 8px;
        `;
        
        const progressFill = modal.querySelector('.progress-fill');
        progressFill.style.cssText = `
            height: 100%;
            background: #fff;
            width: 0%;
            transition: width 0.3s ease;
        `;
        
        const progressText = modal.querySelector('.progress-text');
        progressText.style.cssText = `
            font-size: 12px;
            color: #999;
        `;
        
        // Add CSS animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
        this.loadingModal = modal;
        document.body.appendChild(modal);
    }
    
    updateLoadingProgress(message, percentage) {
        if (!this.loadingModal) return;
        
        const text = this.loadingModal.querySelector('.loading-text');
        const progressFill = this.loadingModal.querySelector('.progress-fill');
        const progressText = this.loadingModal.querySelector('.progress-text');
        
        if (text) text.textContent = message;
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressText) progressText.textContent = `${percentage}%`;
    }
    
    hideLoadingModal() {
        if (this.loadingModal) {
            this.loadingModal.remove();
            this.loadingModal = null;
        }
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('node-info');
        
        if (toggleBtn && panelContent) {
            toggleBtn.addEventListener('click', () => {
                const isMinimized = panelContent.classList.contains('minimized');
                
                const icon = toggleBtn.querySelector('.panel-toggle-icon');
                if (isMinimized) {
                    panelContent.classList.remove('minimized');
                    if (icon) icon.src = 'imgs/icons/chevron-up.svg';
                    toggleBtn.title = 'Minimize';
                    toggleBtn.setAttribute('aria-label', 'Minimize panel');
                } else {
                    panelContent.classList.add('minimized');
                    if (icon) icon.src = 'imgs/icons/chevron-down.svg';
                    toggleBtn.title = 'Maximize';
                    toggleBtn.setAttribute('aria-label', 'Maximize panel');
                }
            });
        }
    }
    
    // Navigation methods
    rotateLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.theta -= 0.2;
        this.controls.update();
    }
    
    rotateRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.theta += 0.2;
        this.controls.update();
    }
    
    rotateUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    rotateDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    panLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    panRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    zoomIn() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.distance -= 2;
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.controls.update();
    }
    
    zoomOut() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.distance += 2;
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.controls.update();
    }
}

window.ExplorerPages = window.ExplorerPages || {};
window.ExplorerPages['node.html'] = {
    panelTitle: 'Node',
    panelDomId: 'node-info',
    create: function (opts) { return new BitcoinNodeExplorer(opts); }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.__softNav) return;
    window.__explorer = new BitcoinNodeExplorer();
}); 