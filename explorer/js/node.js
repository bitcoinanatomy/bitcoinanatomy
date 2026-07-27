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
        this.showDetails = true;
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
            const probeRes = await fetch(probeUrl);
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
                const listRes = await fetch(this.apiUrl(`/v1/nodes/?page=${page}&limit=${pageSize}`));
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
            this.showNoNodesError();
        }
    }
    
    showNoNodesError() {
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
                    <h3>No Nodes Available</h3>
                    <button class="popup-close">&times;</button>
                </div>
                <div class="popup-body">
                    <p>Unable to load network data from BTC Nodes API</p>
                    <p>Please try again later or check your internet connection.</p>
                </div>
                <div class="popup-footer">
                    <a href="network.html" style="color: #4CAF50; text-decoration: none; margin-right: 10px;">← Back to Network</a>
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
                        <strong>${featureData.name}</strong><br>
                        ${featureData.description}<br>
                        Type: ${featureData.type}<br>
                        Year: ${featureData.year}
                    `;
                    
                    // Only add "View Details" link for non-navigation objects (feature cuboids)
                    if (featureData.type === 'Bitcoin Protocol') {
                        tooltipContent += `<br><a href="${featureData.url}" target="_blank" style="color: #4CAF50; text-decoration: none;">View Details →</a>`;
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
                        <strong>${featureData.name}</strong><br>
                        ${featureData.description}<br>
                        Type: ${featureData.type}<br>
                        Year: ${featureData.year}
                    `;
                    
                    // Only add "View Details" link for non-navigation objects (feature cuboids)
                    if (featureData.type === 'Bitcoin Protocol') {
                        tooltipContent += `<br><a href="${featureData.url}" target="_blank" style="color: #4CAF50; text-decoration: none;">View Details →</a>`;
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
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
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
        
        // Create network connection lines radiating from the center
        this.createNetworkConnections();
        
        // Create blockchain helix inside the sphere
        this.createBlockchainHelix();
        
        // Create mempool spiral next to the sphere
        this.createMempoolSpiral();
        
        // Create Bitcoin node version features visualization
        this.createVersionFeatures();
    }
    
    createTextLabel(sphere, text) {
        // Create HTML element for text label
        const label = document.createElement('div');
        label.className = 'feature-label';
        label.textContent = text;
        label.style.position = 'absolute';
        label.style.color = 'white';
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
    
    createVersionFeatures() {
        // Bitcoin protocol features and BIPs
        const bitcoinFeatures = [
            { 
                name: "SegWit", 
                description: "Segregated Witness - Transaction format upgrade",
                url: "https://bips.dev/141/",
                year: 2016, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 157", 
                description: "Client Side Block Filtering - Light client protocol",
                url: "https://bips.dev/157/",
                year: 2018, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 158", 
                description: "Compact Block Filters - Golomb-Rice coded sets",
                url: "https://bips.dev/158/",
                year: 2018, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 339", 
                description: "Erlay - Bandwidth-efficient transaction relay",
                url: "https://bips.dev/339/",
                year: 2020, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 340", 
                description: "Schnorr Signatures - Elliptic curve signature scheme",
                url: "https://bips.dev/340/",
                year: 2020, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 341", 
                description: "Taproot - Merkle tree upgrade for privacy",
                url: "https://bips.dev/341/",
                year: 2020, 
                color: 0x00ff00 
            },
            { 
                name: "BIP 342", 
                description: "Tapscript - Script upgrade for Taproot",
                url: "https://bips.dev/342/",
                year: 2020, 
                color: 0x00ff00 
            }
        ];
        
        // Create feature cuboids around the main node
        const allFeatures = [...bitcoinFeatures];
        
        allFeatures.forEach((feature, index) => {
            const angle = (index / allFeatures.length) * Math.PI * 2;
            const radius = 5; // Reduced from 8 to 5 to bring features closer
            const height = (index % 3) * 2 - 2; // Distribute in 3 layers
            
            // Calculate position on the sphere
            const x = Math.cos(angle) * radius;
            const y = height;
            const z = Math.sin(angle) * radius;
            
            // Calculate the tangent vector (perpendicular to the radius from center)
            const tangentX = -Math.sin(angle);
            const tangentZ = Math.cos(angle);
            
            // Create cuboid geometry (rectangular prism)
            const width = 0.9;
            const height_cuboid = 0.9;
            const depth = 0.3;
            const geometry = new THREE.BoxGeometry(width, height_cuboid, depth);
            const material = new THREE.MeshBasicMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 0.5
            });
            
            const featureCuboid = new THREE.Mesh(geometry, material);
            featureCuboid.position.set(x, y, z);
            
            // Orient the cuboid perpendicular to the tangent
            // First, rotate to face the tangent direction
            featureCuboid.lookAt(new THREE.Vector3(x + tangentX, y, z + tangentZ));
            
            // Then rotate 90 degrees around the Y-axis to make it perpendicular
            featureCuboid.rotateY(Math.PI / 2);
            
            // Store feature info for tooltip and text positioning
            featureCuboid.userData = {
                name: feature.name,
                description: feature.description,
                url: feature.url,
                year: feature.year,
                type: 'Bitcoin Protocol',
                index: index
            };
            
            this.scene.add(featureCuboid);
            
            // Create HTML text label
            this.createTextLabel(featureCuboid, feature.name);
        });
    }
    
    createBlockchainHelix() {
        // Create a helix inside the sphere representing the blockchain
        const points = [];
        const segments = 250; // More segments for longer helix
        const radius = 0.5; // Even smaller radius for more compression
        const height = 5; // Taller for longer helix
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI * 10; // 5 full rotations for more compression
            const x = Math.cos(angle) * radius;
            const y = (t - 0.5) * height;
            const z = Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, y, z));
        }
        
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
        // Create a flat white spiral next to the sphere representing the mempool
        const spiralGeometry = new THREE.BufferGeometry();
        const points = [];
        const segments = 120; // More segments for longer spiral
        const radius = 0.8;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI * 4; // 2 full rotations for longer spiral
            const currentRadius = radius * (1 - t * 0.6); // Slower radius decrease
            const x = Math.cos(angle) * currentRadius + 3; // Offset to the right
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
    
    createNetworkConnections() {
        // Create 9 network connection lines radiating from the sphere surface
        const lineMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x666666,
            transparent: true,
            opacity: 0.4
        });
        
        for (let i = 0; i < 9; i++) {
            const angle = (i / 9) * Math.PI * 2;
            const sphereRadius = 6; // Updated radius of the sphere
            const distance = 80; // 4 times longer connections (from 20 to 80)
            
            const points = [
                new THREE.Vector3(
                    Math.cos(angle) * sphereRadius, // Start from sphere surface
                    0, // Keep lines horizontal
                    Math.sin(angle) * sphereRadius
                ),
                new THREE.Vector3(
                    Math.cos(angle) * distance,
                    0, // Keep lines horizontal
                    Math.sin(angle) * distance
                )
            ];
            
            // Create a path from the points
            const path = new THREE.CatmullRomCurve3(points);
            
            // Create a tube geometry for thickness
            const tubeGeometry = new THREE.TubeGeometry(path, 8, 0.08, 6, false);
            
            const line = new THREE.Mesh(tubeGeometry, lineMaterial);
            this.scene.add(line);
        }
    }

    async fetchData() {
        this.showLoadingModal('Loading node data...');
        
        try {
            this.updateLoadingProgress('Fetching node information...', 30);
            const path = `/v1/nodes/${encodeURIComponent(this.apiNodeAddress)}/`;
            const response = await fetch(this.apiUrl(path));
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('BTC Nodes API');
                return;
            }
            
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
            this.updateUI();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching node data:', error);
            this.showGenericError('Node data');
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
                    <a href="network.html" style="color: #4CAF50; text-decoration: none; margin-right: 10px;">← Back to Network</a>
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
                'node-address', 'node-status-display', 'node-version', 'node-user-agent',
                'node-height', 'node-latest-height', 'node-hostname', 'node-city',
                'node-country', 'node-coordinates', 'node-timezone', 'node-asn',
                'node-org', 'node-uptime', 'bandwidth'
            ];
            fields.forEach(field => {
                const element = document.getElementById(field);
                if (element) element.textContent = 'Not Available';
            });
            
            // Update subtitle for error state
            const subtitle = `${this.nodeAddress || 'Unknown'} • Not Found`;
            document.getElementById('node-subtitle').textContent = subtitle;
            
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

        updateField('node-address', displayAddress);
        updateField('node-status-display', this.nodeData.status || (this.nodeData.found ? 'UP' : 'DOWN'));
        updateField('node-version', version);
        updateField('node-user-agent', userAgent);
        updateField('node-height', height);
        updateField('node-latest-height', height);
        updateField('node-hostname', hostname || this.nodeData.hostname);
        updateField('node-city', city);
        updateField('node-country', country);
        updateField('node-coordinates', coordinatesText);
        updateField('node-timezone', timezone);
        updateField('node-asn', asn);
        updateField('node-org', org);
        updateField('node-uptime', uptimeText);
        updateField('bandwidth', this.nodeData.mbps ? `${this.nodeData.mbps} Mbps` : 'N/A');

        const status = this.nodeData.status || (this.nodeData.found ? 'UP' : 'DOWN');
        document.getElementById('node-subtitle').textContent = `${displayAddress} • ${status}`;
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
        // Get all feature cuboids (excluding the main node)
        const featureCuboids = this.scene.children.filter(child => 
            child.geometry && child.geometry.type === 'BoxGeometry' && 
            child.geometry.parameters.width === 0.9
        );
        
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
                
                // Check if cuboid is in front of camera
                if (vector.z < 1) {
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