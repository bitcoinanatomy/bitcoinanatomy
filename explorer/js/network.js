// Bitcoin Explorer - Network Page

// Montage loop: 5 shots. target = point on Earth surface (radius 33); no target = look at center.
// Camera: distance = radius from target; phi = vertical angle from +Y (0=above, π/2=equator); theta = horizontal angle around Y (longitude).
const MONTAGE_SHOTS = [
    // 1. General — wide, zoom in to minimum distance
    { name: 'General', distance: 170, phi: 1.42, theta: -2.5, rotationSpeed: 0.00025, panSpeedTheta: 0.018, panSpeedPhi: 0, zoomSpeed: -17, holdSeconds: 5 },
    // 2. Detail — camera close, point of interest on surface (limb)
    { name: 'Detail', distance: 47.6, phi: 1.5, theta: -8.5002, rotationSpeed: 0.00035, panSpeedTheta: 0.05, panSpeedPhi: 0.008, zoomSpeed: -0.5, holdSeconds: 5, target: [17.03, 14.43, -1.77] },
    // 3. Mid — camera close to center, fast pan
    { name: 'Mid', distance: 44, phi: 1.45, theta: 0.5, rotationSpeed: 0.0008, panSpeedTheta: 0.18, panSpeedPhi: 0.025, zoomSpeed: 0, holdSeconds: 5, target: [25, 20, -6] },
    // 4. Horizon — camera and point of interest from user positioning
    { name: 'Horizon', distance: 5, phi: 1.455, theta: -2.1574, rotationSpeed: -0.02, panSpeedTheta: 0, panSpeedPhi: 0, zoomSpeed: 0, holdSeconds: 5, target: [-24.14, 22.07, 8.47] },
    // 5. Europe — fly-by over Europe (target on sphere ~lat 50°N, lng 10°E)
    { name: 'Europe', distance: 52, phi: 1.38, theta: 2.9, rotationSpeed: 0.0004, panSpeedTheta: 0.14, panSpeedPhi: 0.01, zoomSpeed: -0.3, holdSeconds: 5, target: [-21.05, 65.06, 4.01] }
];

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

class BitcoinNetworkExplorer {
    constructor() {
        console.log('🚀 BitcoinNetworkExplorer constructor called');
        
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.nodes = [];
        this.connections = [];
        this.isRotating = true;
        this.showConnections = false;
        this.nodeData = null;
        this.latestSnapshot = null;
        this.snapshotsData = null; // Store the full snapshots response
        this.currentSnapshotIndex = 0; // Track current position in results array
        this.isPerspective = true;
        this.orthographicZoom = 100;
        this.animateLogged = false;
        this.is2DMode = false;
        this.isFocused = false;
        this.orbitTransition = null;
        this.nearScalingActive = false;
        this.earthMesh = null;
        this.mapPlaneMesh = null;
        this.connectionsMesh = null;
        this.proximityMesh = null;
        this.isEarthVisible = true;
        this.savedCameraState = null;
        this.wasRotating2D = false;
        this.subtitlePrefix = '';
        this.tableSort = { column: 'country', dir: 1 };
        this.tableOpen = false;
        this.tablePage = 0;
        this.tablePageSize = 500;
        this.tableFilter = 'all'; // 'all' | 'clearnet' | 'tor'
        
        // Montage loop: 3 camera shots with different angle, zoom, rotation speed
        this.montageActive = false;
        this.montageShotIndex = 0;
        this.montagePhaseStartTime = 0;
        this.montageLastTime = 0;
        this.montageMusicEnabled = true;
        this.montageInstruments = null;
        this.cameraCoordsLastUpdate = 0;
        
        // Cache configuration
        this.CACHE_KEY = 'bitnodes_data_cache';
        this.CACHE_TIMESTAMP_KEY = 'bitnodes_cache_timestamp';
        this.CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour in milliseconds
        
        // Mobile optimization flags
        this.isMobile = this.detectMobile();
        this.maxNodes = this.isMobile ? 1000 : 10000; // Limit nodes on mobile
        this.nodeComplexity = this.isMobile ? 3 : 6; // Reduce sphere complexity on mobile
        
        if (this.isMobile) {
            console.log('📱 Mobile device detected - applying performance optimizations:');
            console.log(`  - Maximum nodes: ${this.maxNodes}`);
            console.log(`  - Node complexity: ${this.nodeComplexity} segments`);
            console.log(`  - Batch processing enabled`);
        } else {
            console.log('💻 Desktop device detected:');
            console.log(`  - Maximum nodes: ${this.maxNodes}`);
            console.log(`  - Node complexity: ${this.nodeComplexity} segments`);
        }
        
        this.init();
    }

    detectMobile() {
        // Detect mobile devices
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               window.innerWidth <= 768 || 
               ('ontouchstart' in window);
    }

    formatDate(date) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        const time = date.toTimeString().split(' ')[0]; // Gets HH:MM:SS
        return `${month} ${day}, ${year}, ${time}`;
    }

    init() {
        console.log('⚙️ Initializing BitcoinNetworkExplorer...');
        
        // Apply ui=hidden from URL immediately so UI is hidden before data loads
        this.applyUiHiddenFromUrl();
        this.applyCameraInfoFromUrl();
        
        console.log('  1️⃣ Setting up Three.js...');
        this.setupThreeJS();
        
        console.log('  2️⃣ Setting up orbit controls...');
        this.setupOrbitControls();
        
        console.log('  3️⃣ Setting up UI controls...');
        this.setupControls();
        
        console.log('  4️⃣ Setting up panel toggle...');
        this.setupPanelToggle();
        
        console.log('  4.5️⃣ Setting up snapshot navigation...');
        this.setupSnapshotNavigation();
        
        console.log('  4.6️⃣ Setting up archive dropdown...');
        this.setupArchiveDropdown();
        
        console.log('  5️⃣ Creating scene...');
        this.createScene();
        
        console.log('  6️⃣ Starting animation loop...');
        this.animate();
        
        console.log('  7️⃣ Fetching data...');
        this.fetchData();
        
        console.log('✅ Initialization complete!');
    }
    
    formatNodeAddress(address) {
        // Handle IPv6 addresses with square brackets
        if (address.includes('[') && address.includes(']')) {
            // Extract IPv6 address and port
            const match = address.match(/\[([^\]]+)\]:(\d+)/);
            if (match) {
                const ipv6 = match[1];
                const port = match[2];
                // Return IPv6 address without brackets, with hyphen separator
                return `${ipv6}-${port}`;
            }
        }
        
        // For regular IPv4 addresses, convert colon to hyphen
        return address.replace(':', '-');
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.01,
            2000
        );
        this.camera.position.set(-100, 50, 100);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer with mobile optimizations
        const rendererOptions = { 
            antialias: !this.isMobile, // Disable antialiasing on mobile for better performance
            powerPreference: this.isMobile ? "low-power" : "high-performance"
        };
        
        this.renderer = new THREE.WebGLRenderer(rendererOptions);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // Disable shadows on mobile for better performance
        if (!this.isMobile) {
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
        
        // Set pixel ratio for mobile optimization
        this.renderer.setPixelRatio(this.isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio);
        
        container.appendChild(this.renderer.domElement);
        
        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupOrbitControls() {
        // Orbit camera: position = spherical coords around target. Camera always looks at target.
        // - target: 3D point the camera orbits and looks at (e.g. scene center or a point on the globe).
        // - distance: radius from target; larger = zoomed out, smaller = closer.
        // - phi: polar angle from +Y (vertical). 0 = above target, π/2 = equator, π = below. Clamped (0.1, π−0.1).
        // - theta: azimuthal angle around Y (horizontal). 0 = +X side, π/2 = +Z; drag left/right changes theta.
        // Position: x = target.x + distance*sin(phi)*cos(theta), y = target.y + distance*cos(phi), z = target.z + distance*sin(phi)*sin(theta).
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 100,
            phi: Math.PI / 2.5,
            theta: -3.5,
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
        
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            controls.isMouseDown = true;
            controls.lastMouseX = e.clientX;
            controls.lastMouseY = e.clientY;
            
            // Stop automatic rotation when user starts interacting
            this.isRotating = false;
            this.updateRotationButton(false);
            this.stopMontageIfActive();
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            controls.isMouseDown = false;
        });
        
        this.renderer.domElement.addEventListener('mousemove', (e) => {
            if (controls.isMouseDown) {
                const deltaX = e.clientX - controls.lastMouseX;
                const deltaY = e.clientY - controls.lastMouseY;
                
                const wantPan = this.is2DMode ? !e.shiftKey : e.shiftKey;

                if (wantPan) {
                    // Pan: move the orbit target in camera-right / camera-up directions
                    const panSpeed = 0.001;
                    const right = new THREE.Vector3();
                    const up    = new THREE.Vector3();
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    controls.target.add(right.multiplyScalar(deltaX * panSpeed * controls.distance));
                    controls.target.add(up.multiplyScalar(deltaY * panSpeed * controls.distance));
                } else {
                    // Rotate
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
            this.updateRotationButton(false);
            this.stopMontageIfActive();
            
            // Zoom in/out with inverted scroll direction
            if (this.isPerspective) {
                // Perspective camera zoom
                controls.distance += e.deltaY * 0.1;
                const { min: wMin, max: wMax } = this.zoomLimits();
                controls.distance = Math.max(wMin, Math.min(wMax, controls.distance));
                controls.update();
            } else {
                // Orthographic camera zoom
                const zoomSpeed = 0.1;
                this.orthographicZoom += e.deltaY * zoomSpeed;
                this.orthographicZoom = Math.max(10, Math.min(300, this.orthographicZoom));
                
                const aspect = window.innerWidth / window.innerHeight;
                this.camera.left = -this.orthographicZoom * aspect / 2;
                this.camera.right = this.orthographicZoom * aspect / 2;
                this.camera.top = this.orthographicZoom / 2;
                this.camera.bottom = -this.orthographicZoom / 2;
                this.camera.updateProjectionMatrix();
            }
        });

        // Add touch controls for mobile
        this.setupTouchControls();
    }

    setupTouchControls() {
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
            this.updateRotationButton(false);
            this.stopMontageIfActive();

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
                this.resetCamera();
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
                
                if (this.isPerspective) {
                    this.controls.distance *= zoomFactor;
                    const { min: tMin, max: tMax } = this.zoomLimits();
                    this.controls.distance = Math.max(tMin, Math.min(tMax, this.controls.distance));
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(10, Math.min(300, this.orthographicZoom));
                    
                    const aspect = window.innerWidth / window.innerHeight;
                    this.camera.left = -this.orthographicZoom * aspect / 2;
                    this.camera.right = this.orthographicZoom * aspect / 2;
                    this.camera.top = this.orthographicZoom / 2;
                    this.camera.bottom = -this.orthographicZoom / 2;
                    this.camera.updateProjectionMatrix();
                }
                
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

    zoomLimits() {
        if (this.is2DMode) return { min: 2,   max: 600 };
        // Earth sphere radius is 33; keep camera just outside it for close-to-surface feel
        const MIN_DISTANCE = 40;
        return { min: MIN_DISTANCE, max: 600 };
    }

    updateRotationButton(rotating) {
        const btn = document.getElementById('toggle-rotation');
        if (!btn) return;
        const icon = document.getElementById('toggle-rotation-icon');
        if (icon) icon.src = rotating ? 'imgs/icons/pause.svg' : 'imgs/icons/play.svg';
        const label = rotating ? 'Pause rotation' : 'Start rotation';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }

    setupControls() {
        // Toggle rotation
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            this.updateRotationButton(this.isRotating);
            this.syncUrlParams();
        });
        
        // Reset camera
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.resetCamera();
        });
        
        // Show all nodes
        document.getElementById('show-all').addEventListener('click', () => {
            this.showAllNodes();
        });
        
        // Toggle view
        const toggleViewButton = document.getElementById('toggle-view');
        if (toggleViewButton) {
            toggleViewButton.addEventListener('click', () => {
                this.toggleCameraView();
            });
        }
        
        // Toggle 2D map view
        const toggle2DButton = document.getElementById('toggle-2d');
        if (toggle2DButton) {
            toggle2DButton.addEventListener('click', () => {
                this.toggle2DView();
            });
        }

        // Toggle earth geography visibility
        const toggleEarthButton = document.getElementById('toggle-earth');
        if (toggleEarthButton) {
            toggleEarthButton.addEventListener('click', () => {
                this.toggleEarth();
            });
        }

        // Toggle random connections between nodes
        const toggleConnectionsButton = document.getElementById('toggle-connections');
        if (toggleConnectionsButton) {
            toggleConnectionsButton.addEventListener('click', () => {
                this.toggleConnections();
            });
        }
        
        // Toggle node table pane
        const toggleTableButton = document.getElementById('toggle-table');
        if (toggleTableButton) {
            toggleTableButton.addEventListener('click', () => this.toggleTablePane());
        }
        const closeTableButton = document.getElementById('close-table-pane');
        if (closeTableButton) {
            closeTableButton.addEventListener('click', () => this.closeTablePane());
        }
        const tableSearch = document.getElementById('table-search');
        if (tableSearch) {
            tableSearch.addEventListener('input', () => { this.tablePage = 0; this.renderTableRows(); });
        }
        document.querySelectorAll('#node-table th.sortable').forEach(th => {
            th.addEventListener('click', () => this.handleTableSort(th.dataset.col));
        });
        const tablePageSize = document.getElementById('table-page-size');
        if (tablePageSize) {
            tablePageSize.addEventListener('change', () => {
                this.tablePageSize = parseInt(tablePageSize.value, 10);
                this.tablePage = 0;
                this.renderTableRows();
            });
        }
        document.getElementById('table-prev')?.addEventListener('click', () => {
            if (this.tablePage > 0) { this.tablePage--; this.renderTableRows(true); }
        });
        document.getElementById('table-next')?.addEventListener('click', () => {
            this.tablePage++;
            this.renderTableRows(true);
        });
        document.querySelectorAll('.table-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.tableFilter = btn.dataset.filter;
                this.tablePage = 0;
                document.querySelectorAll('.table-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderTableRows();
                this.syncUrlParams();
            });
        });

        // Clear cache and reload
        const clearCacheButton = document.getElementById('clear-cache');
        if (clearCacheButton) {
            clearCacheButton.addEventListener('click', () => {
                if (confirm('Clear cached data and reload from API?')) {
                    this.clearCache();
                    location.reload();
                }
            });
        }
        
        // Montage loop
        const toggleMontageButton = document.getElementById('toggle-montage');
        if (toggleMontageButton) {
            toggleMontageButton.addEventListener('click', () => this.toggleMontage());
        }
        
        // View UI toggle: persist in URL (handler runs after controls-camera toggle)
        const toggleUiBtn = document.getElementById('toggle-ui');
        if (toggleUiBtn) {
            toggleUiBtn.addEventListener('click', () => { setTimeout(() => this.syncUrlParams(), 0); });
        }

        // Montage music mute (View group)
        const viewButtons = document.getElementById('toggle-fullscreen')?.parentElement;
        if (viewButtons) {
            const musicBtn = document.createElement('button');
            musicBtn.id = 'toggle-montage-music';
            musicBtn.type = 'button';
            musicBtn.title = this.montageMusicEnabled ? 'Music on' : 'Music off';
            musicBtn.setAttribute('aria-label', musicBtn.title);
            musicBtn.innerHTML = '<svg id="toggle-montage-music-icon" class="control-icon-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
            musicBtn.addEventListener('click', () => {
                this.montageMusicEnabled = !this.montageMusicEnabled;
                musicBtn.title = this.montageMusicEnabled ? 'Music on' : 'Music off';
                musicBtn.setAttribute('aria-label', musicBtn.title);
                const icon = document.getElementById('toggle-montage-music-icon');
                if (icon) {
                    icon.innerHTML = this.montageMusicEnabled
                        ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
                        : '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
                }
            });
            viewButtons.appendChild(musicBtn);
        }
        
        // Camera coords panel: click to copy distance, phi, theta, target, targetPhi, targetTheta
        const cameraCoordsPanel = document.getElementById('camera-coords-panel');
        if (cameraCoordsPanel) {
            cameraCoordsPanel.addEventListener('click', () => {
                const c = this.controls;
                const tx = c.target.x, ty = c.target.y, tz = c.target.z;
                const r = Math.sqrt(tx * tx + ty * ty + tz * tz);
                const tPhi = r >= 1e-6 ? Math.acos(Math.max(-1, Math.min(1, ty / r))) : 0;
                const tTheta = r >= 1e-6 ? Math.atan2(tz, tx) : 0;
                const line = `distance: ${c.distance.toFixed(2)}, phi: ${c.phi.toFixed(4)}, theta: ${c.theta.toFixed(4)}, target: [${tx.toFixed(2)}, ${ty.toFixed(2)}, ${tz.toFixed(2)}], targetPhi: ${tPhi.toFixed(4)}, targetTheta: ${tTheta.toFixed(4)}`;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(line).then(() => {
                        const hint = cameraCoordsPanel.querySelector('.camera-coords-hint');
                        if (hint) { const t = hint.textContent; hint.textContent = 'Copied!'; setTimeout(() => { hint.textContent = t; }, 800); }
                    }).catch(() => {});
                }
            });
        }

        // Log camera/orbit state to console (press L) — copy for MONTAGE_SHOTS
        document.addEventListener('keydown', (e) => {
            if (e.key === 'l' || e.key === 'L') {
                this.logCameraState();
            }
        });
        
        // Implementation filter clicks
        document.querySelectorAll('.implementation-item').forEach(item => {
            item.addEventListener('click', () => {
                const implementation = item.getAttribute('data-implementation');
                // Toggle filter: if already active, deselect and show all
                if (item.classList.contains('active')) {
                    this.showAllNodes();
                } else {
                    this.filterNodesByImplementation(implementation);
                }
            });
        });
        
        // Navigation controls (stop montage when user moves camera)
        document.getElementById('rotate-left').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.rotateLeft();
        });
        
        document.getElementById('rotate-right').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.rotateRight();
        });
        
        document.getElementById('rotate-up').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.rotateUp();
        });
        
        document.getElementById('rotate-down').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.rotateDown();
        });
        
        document.getElementById('pan-left').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.panLeft();
        });
        
        document.getElementById('pan-right').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.panRight();
        });
        
        document.getElementById('pan-up').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.panUp();
        });
        
        document.getElementById('pan-down').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.panDown();
        });
        
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.zoomIn();
        });
        
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.stopMontageIfActive();
            this.zoomOut();
        });
    }
    
    setupHoverTooltip() {
        const raycaster = new THREE.Raycaster();
        raycaster.params.Mesh = {};   // ensure mesh picking is default exact
        this.hoverRaycaster = raycaster; // store so toggle2DView can adjust threshold
        const mouse = new THREE.Vector2();

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.style.position = 'absolute';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '8px 12px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '12px';
        tooltip.style.fontFamily = 'monospace';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '1000';
        tooltip.style.display = 'none';
        tooltip.style.whiteSpace = 'nowrap';
        document.body.appendChild(tooltip);

        this.renderer.domElement.addEventListener('mousemove', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            let intersects = raycaster.intersectObjects(this.nodes);

            // When nodes are scaled down, the ray often misses; fallback to closest node in screen space
            const cameraToOrigin = this.camera.position.length();
            if (intersects.length === 0 && cameraToOrigin < 80 && this.nodes.length > 0) {
                const worldPos = new THREE.Vector3();
                const ndc = new THREE.Vector3();
                const MIN_HOVER_PIXELS = 28;
                let bestNode = null;
                let bestDist = MIN_HOVER_PIXELS;
                for (let i = 0; i < this.nodes.length; i++) {
                    const node = this.nodes[i];
                    if (!node.visible) continue;
                    node.getWorldPosition(worldPos);
                    ndc.copy(worldPos).project(this.camera);
                    if (ndc.z < -1 || ndc.z > 1) continue;
                    const sx = (ndc.x * 0.5 + 0.5) * window.innerWidth;
                    const sy = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
                    const dist = Math.hypot(event.clientX - sx, event.clientY - sy);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestNode = node;
                    }
                }
                if (bestNode) {
                    intersects = [{ object: bestNode }];
                }
            }

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const nodeData = intersectedObject.userData;
                
                // Format the tooltip content
                const tooltipContent = `
                    <strong>${nodeData.type.toUpperCase()}</strong><br>
                    Address: ${nodeData.address}<br>
                    Country: ${nodeData.country || 'Unknown'}<br>
                    City: ${nodeData.city || 'Unknown'}<br>
                    Height: ${nodeData.height}<br>
                    User Agent: ${nodeData.userAgent}
                `;
                
                tooltip.innerHTML = tooltipContent;
                tooltip.style.display = 'block';
                tooltip.style.left = event.clientX + 10 + 'px';
                tooltip.style.top = event.clientY - 10 + 'px';
            } else {
                tooltip.style.display = 'none';
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Shift+click: smoothly orbit around the clicked node
        this.renderer.domElement.addEventListener('click', (event) => {
            if (!event.shiftKey) return;
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObjects(this.nodes);
            if (intersects.length > 0) {
                // getWorldPosition accounts for scene.rotation so the target
                // lands on the actual rendered position of the node
                const worldPos = new THREE.Vector3();
                intersects[0].object.getWorldPosition(worldPos);

                // Stop auto-rotation — the world-space target would drift otherwise
                this.isRotating = false;
                this.updateRotationButton(false);

                this.isFocused = true;
                this.orbitTransition = {
                    fromTarget:   this.controls.target.clone(),
                    toTarget:     worldPos,
                    fromDistance: this.controls.distance,
                    toDistance:   3,
                    progress:     0,
                    duration:     30
                };
                tooltip.style.display = 'none';
            }
        });

        // Add double-click handler for node navigation
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.nodes);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const nodeData = intersectedObject.userData;
                
                // Format address for URL parameter
                const formattedAddress = this.formatNodeAddress(nodeData.address);
                
                // Navigate to node page with address as URL parameter
                window.location.href = `node.html?node=${formattedAddress}`;
            }
        });
    }
    
    filterNodesByImplementation(selectedImplementation) {
        this.nodes.forEach(node => {
            const material = node.material;
            const type = node.userData.type;
            const ua   = node.userData.userAgent || '';
            let match = false;

            switch (selectedImplementation) {
                case 'core-v30plus': {
                    const m = ua.match(/Satoshi:(\d+)\./);
                    match = type === 'bitcoin-core' && m && parseInt(m[1]) >= 30;
                    break;
                }
                case 'core-older': {
                    const m = ua.match(/Satoshi:(\d+)\./);
                    match = type === 'bitcoin-core' && (!m || parseInt(m[1]) < 30);
                    break;
                }
                case 'knots-bip110':
                    match = type === 'knots' && ua.toLowerCase().includes('bip110');
                    break;
                case 'knots-standard':
                    match = type === 'knots' && !ua.toLowerCase().includes('bip110');
                    break;
                default:
                    match = type === selectedImplementation;
            }

            material.opacity = match ? 1.0 : 0.3;
            material.color.setHex(match ? 0xffffff : 0x666666);
            material.transparent = true;
        });
        
        this.updateFilterButtons(selectedImplementation);
    }
    
    showAllNodes() {
        this.nodes.forEach(node => {
            const material = node.material;
            // Restore full opacity and white color for all nodes
            material.opacity = 1.0;
            material.color.setHex(0xffffff);
            material.transparent = true;
        });
        
        this.updateFilterButtons(null);
    }
    
    updateFilterButtons(selectedImplementation) {
        // Update active state for implementation items
        document.querySelectorAll('.implementation-item').forEach(item => {
            const implementation = item.getAttribute('data-implementation');
            if (implementation === selectedImplementation) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        
        // Show/hide "Show All" button
        const showAllContainer = document.getElementById('show-all-container');
        if (selectedImplementation) {
            showAllContainer.style.display = 'block';
        } else {
            showAllContainer.style.display = 'none';
        }
    }

    createScene() {
        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        // Create Earth representation
        this.createEarth();
    }

    createEarth() {
        // Create Earth sphere with texture
        const earthGeometry = new THREE.SphereGeometry(33, 64, 64);
        
        // Load Earth texture
        const textureLoader = new THREE.TextureLoader();
        const earthTexture = textureLoader.load('https://blossom.primal.net/6edee6bd5ec2e128f0e5bd0b24c3672ea6908771667959ad1bdaa964f2cfe6d4.jpg');
        
        const earthMaterial = new THREE.MeshBasicMaterial({
            map: earthTexture,
            color: 0x555555, // Darken the texture
            transparent: true,
            opacity: 0.9
        });
        
        const earth = new THREE.Mesh(earthGeometry, earthMaterial);
        earth.rotation.y = (180 * Math.PI) / 180; // Rotate 50 degrees
        this.earthMesh = earth;
        this.scene.add(earth);

        // Flat map plane for 2D mode — same texture, equirectangular projection
        // Width=132 covers longitude ±66 units, height=66 covers latitude ±33 units,
        // matching the node flat-projection coordinates exactly.
        const planeMaterial = new THREE.MeshBasicMaterial({
            map: earthTexture,
            color: 0x555555,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(132, 66), planeMaterial);
        plane.rotation.x = -Math.PI / 2; // Lay flat in XZ plane
        plane.position.y = -0.05;        // Just below nodes at y=0
        plane.visible = false;           // Only shown in 2D mode
        this.mapPlaneMesh = plane;
        this.scene.add(plane);
    }


    
    showRateLimitError(apiName) {
        if (this.rateLimitArchiveTimeout) {
            clearTimeout(this.rateLimitArchiveTimeout);
            this.rateLimitArchiveTimeout = null;
        }
        const self = this;
        var countdownInterval = null;
        this.showPopupMessage(
            'Rate Limit Exceeded',
            `${apiName} is temporarily unavailable.`,
            'warning',
            [{ label: 'Load Archive', onClick: function () {
                if (countdownInterval) clearInterval(countdownInterval);
                if (self.rateLimitArchiveTimeout) {
                    clearTimeout(self.rateLimitArchiveTimeout);
                    self.rateLimitArchiveTimeout = null;
                }
                self.loadLocalArchive();
            } }],
            function onDismiss() {
                if (countdownInterval) clearInterval(countdownInterval);
                if (self.rateLimitArchiveTimeout) {
                    clearTimeout(self.rateLimitArchiveTimeout);
                    self.rateLimitArchiveTimeout = null;
                }
            },
            'Archive data will load automatically in 10 seconds, or click Load Archive now.'
        );
        var popup = document.querySelector('.api-popup');
        if (popup) {
            var body = popup.querySelector('.popup-body');
            if (body) {
                var countdownEl = document.createElement('div');
                countdownEl.className = 'popup-countdown';
                countdownEl.style.cssText = 'margin-top: 10px; color: #888; font-size: 13px;';
                body.appendChild(countdownEl);
                var sec = 10;
                countdownEl.textContent = 'Loading archive in ' + sec + ' seconds';
                countdownInterval = setInterval(function () {
                    sec--;
                    if (sec <= 0) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                        countdownEl.textContent = 'Loading...';
                    } else {
                        countdownEl.textContent = 'Loading archive in ' + sec + ' second' + (sec === 1 ? '' : 's');
                    }
                }, 1000);
            }
        }
        this.rateLimitArchiveTimeout = setTimeout(function () {
            self.rateLimitArchiveTimeout = null;
            popup = document.querySelector('.api-popup');
            if (popup) popup.remove();
            self.loadLocalArchive();
        }, 10000);
    }
    
    async loadLocalArchive() {
        const ARCHIVE_PATH = 'js/bitnodes-snapshot-1772712282.json';
        this.showLoadingModal('Loading archive snapshot...');
        try {
            this.updateLoadingProgress('Loading archive snapshot...', 10);
            const response = await fetch(ARCHIVE_PATH);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            this.nodeData = data;
            this.subtitlePrefix = 'Archive: ';
            this.latestSnapshot = { timestamp: data.timestamp, total_nodes: data.total_nodes };
            this.snapshotsData = null;
            this.currentSnapshotIndex = 0;

            this.updateLoadingProgress('Creating visualization...', 80);
            this.createNetworkVisualization();
            this.updateSnapshotNavButtons();
            this.syncUrlParams();
        } catch (error) {
            console.error('Failed to load local archive:', error);
            this.hideLoadingModal();
            this.showGenericError('local archive data');
        }
    }

    showGenericError(dataType) {
        this.showPopupMessage(
            'Error',
            `Failed to load ${dataType}. Please check your connection and try again.`,
            'error'
        );
    }
    
    showPopupMessage(title, message, type = 'info', extraButtons = [], onDismiss = null, mutedMessage = null) {
        // Remove existing popup if any
        const existingPopup = document.querySelector('.api-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        const self = this;
        function removePopup() {
            if (onDismiss) onDismiss();
            popup.remove();
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
                    ${mutedMessage ? `<p class="popup-body-muted">${mutedMessage}</p>` : ''}
                </div>
                <div class="popup-footer">
                    ${extraButtons.map((btn, i) => `<button class="popup-extra popup-extra-${i}${i === 0 ? ' popup-extra-primary' : ''}">${btn.label}</button>`).join('')}
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
            border: 1px solid #333;
            border-radius: 4px;
            max-width: 350px;
            width: 90%;
            color: white;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        `;
        
        const header = popup.querySelector('.popup-header');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid #333;
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
        const mutedEl = popup.querySelector('.popup-body-muted');
        if (mutedEl) {
            mutedEl.style.cssText = 'margin-top: 12px; margin-bottom: 0; color: #888; font-size: 13px;';
        }
        
        const footer = popup.querySelector('.popup-footer');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid #333;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        `;
        
        const buttons = popup.querySelectorAll('button');
        buttons.forEach(btn => {
            if (btn.className.includes('popup-')) {
                const isPrimary = btn.classList.contains('popup-extra-primary');
                btn.style.cssText = `
                    padding: 6px 12px;
                    border: 1px solid ${isPrimary ? '#fff' : '#555'};
                    background: ${isPrimary ? '#fff' : '#000'};
                    color: ${isPrimary ? '#000' : 'white'};
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                `;
                btn.addEventListener('mouseenter', () => {
                    if (isPrimary) {
                        btn.style.background = '#e0e0e0';
                        btn.style.borderColor = '#ccc';
                    } else {
                        btn.style.background = '#333';
                        btn.style.borderColor = '#666';
                    }
                });
                btn.addEventListener('mouseleave', () => {
                    if (isPrimary) {
                        btn.style.background = '#fff';
                        btn.style.borderColor = '#fff';
                    } else {
                        btn.style.background = '#000';
                        btn.style.borderColor = '#555';
                    }
                });
            }
        });
        
        // Add event listeners
        closeBtn.addEventListener('click', removePopup);
        popup.querySelector('.popup-dismiss').addEventListener('click', removePopup);
        popup.querySelector('.popup-retry').addEventListener('click', () => {
            removePopup();
            this.fetchData();
        });
        extraButtons.forEach((btn, i) => {
            popup.querySelector(`.popup-extra-${i}`)?.addEventListener('click', () => {
                btn.onClick();
                removePopup();
            });
        });
        
        // Close on background click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                removePopup();
            }
        });
        
        // Auto-close after 10 seconds
        setTimeout(() => {
            if (document.body.contains(popup)) {
                removePopup();
            }
        }, 10000);
        
        document.body.appendChild(popup);
    }

    createNetworkVisualization() {
        console.log('🎨 createNetworkVisualization called');
        
        if (!this.nodeData || !this.nodeData.nodes) {
            console.error('❌ No node data available!', {
                nodeData: this.nodeData,
                hasNodes: this.nodeData?.nodes ? 'yes' : 'no'
            });
            return;
        }
        
        console.log('✅ Node data exists:', {
            totalNodes: Object.keys(this.nodeData.nodes).length,
            timestamp: this.nodeData.timestamp
        });
        
        // Clear existing nodes and connections
        this.nodes.forEach(node => this.scene.remove(node));
        this.nodes = [];
        this.clearConnections();
        this.showConnections = false;
        const connBtn = document.getElementById('toggle-connections');
        if (connBtn) connBtn.textContent = 'Show Connections';
        
        console.log('🧹 Cleared existing nodes and connections');
        
        const nodes = this.nodeData.nodes;
        let nodeEntries = Object.entries(nodes);
        
        // Limit nodes on mobile devices
        if (this.isMobile && nodeEntries.length > this.maxNodes) {
            console.log(`Mobile device detected: limiting nodes from ${nodeEntries.length} to ${this.maxNodes}`);
            // Take a sample of nodes, prioritizing those with location data
            const nodesWithLocation = nodeEntries.filter(([address, nodeInfo]) => {
                const [version, userAgent, timestamp, height, latestHeight, hostname, city, country, lat, lng] = nodeInfo;
                return lat !== null && lng !== null && lat !== 0.0 && lng !== 0.0;
            });
            
            const nodesWithoutLocation = nodeEntries.filter(([address, nodeInfo]) => {
                const [version, userAgent, timestamp, height, latestHeight, hostname, city, country, lat, lng] = nodeInfo;
                return lat === null || lng === null || lat === 0.0 || lng === 0.0;
            });
            
            // Take proportional samples
            const locationSample = Math.floor(this.maxNodes * 0.8); // 80% with location
            const noLocationSample = this.maxNodes - locationSample; // 20% without location
            
            nodeEntries = [
                ...nodesWithLocation.slice(0, locationSample),
                ...nodesWithoutLocation.slice(0, noLocationSample)
            ];
        }
        
        console.log(`Creating ${nodeEntries.length} nodes (mobile: ${this.isMobile})`);
        
        // Process nodes in batches to prevent UI blocking
        this.createNodesBatch(nodeEntries, 0);
    }

    createNodesBatch(nodeEntries, startIndex) {
        const batchSize = this.isMobile ? 50 : 200; // Smaller batches on mobile
        const endIndex = Math.min(startIndex + batchSize, nodeEntries.length);
        
        console.log(`🔧 createNodesBatch called: startIndex=${startIndex}, endIndex=${endIndex}, batchSize=${batchSize}`);
        
        try {
            // Process current batch
            for (let i = startIndex; i < endIndex; i++) {
            const [address, nodeInfo] = nodeEntries[i];
            const [version, userAgent, timestamp, height, latestHeight, hostname, city, country, lat, lng, timezone, asn, org] = nodeInfo;
            
            // Only log details for first 3 nodes and every 1000th node to reduce console spam
            const shouldLog = i < 3 || i % 1000 === 0;
            
            if (shouldLog) {
                console.log(`📍 Processing node ${i}:`, {
                    address,
                    userAgent,
                    height,
                    latestHeight,
                    lat,
                    lng,
                    city,
                    country
                });
            }
            
            // Determine node implementation based on user agent
            const nodeImplementation = this.getNodeType(userAgent);
            const nodeColor = this.getNodeColor(nodeImplementation);
            const nodeSize = this.getNodeSize(nodeImplementation);
            
            if (shouldLog) {
                console.log(`  └─ Node ${i} type: ${nodeImplementation}, color: ${nodeColor.toString(16)}, size: ${nodeSize}`);
            }
            
            // Calculate position
            let x, y, z;
            
            // Check if lat/lng are valid (not null, not undefined, not 0.0)
            // Using != instead of !== checks for both null and undefined
            if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && lat !== 0.0 && lng !== 0.0) {
                // Convert lat/lng to 3D position on sphere
                const radius = 33.1; // Slightly larger than Earth
                const phi = (90 - lat) * (Math.PI / 180);
                const theta = (-lng + 180) * (Math.PI / 180); // Inverted longitude
                
                x = radius * Math.sin(phi) * Math.cos(theta);
                y = radius * Math.cos(phi);
                z = radius * Math.sin(phi) * Math.sin(theta);
                
                if (shouldLog) {
                    console.log(`  └─ Node ${i} position (geo): lat=${lat}, lng=${lng} → x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)}`);
                }
            } else {
                // TOR nodes or nodes without coordinates - distribute randomly across entire sphere surface
                const baseRadius = 65; // Base distance from Earth sphere
                const radiusVariation = 10; // Random variation range
                const radius = baseRadius + (Math.random() - 0.5) * radiusVariation; // Random distance between 40-50
                const phi = Math.acos(2 * Math.random() - 1); // Random latitude (0 to π)
                const theta = Math.random() * Math.PI * 2; // Random longitude (0 to 2π)
                
                x = radius * Math.sin(phi) * Math.cos(theta);
                y = radius * Math.cos(phi);
                z = radius * Math.sin(phi) * Math.sin(theta);
                
                if (shouldLog) {
                    console.log(`  └─ Node ${i} position (random - no coords): x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)}`);
                }
            }
            
            // Create node geometry with mobile-optimized complexity
            const geometry = new THREE.SphereGeometry(nodeSize, this.nodeComplexity, this.nodeComplexity);
            const material = new THREE.MeshBasicMaterial({
                color: nodeColor,
                transparent: true,
                opacity: 1.0
            });
            
            const node = new THREE.Mesh(geometry, material);
            node.position.set(x, y, z);
            
            const hasLocation = lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && lat !== 0.0 && lng !== 0.0;
            node.userData = {
                type: nodeImplementation,
                address: address,
                userAgent: userAgent,
                country: country,
                city: city,
                height: height,
                latestHeight: latestHeight,
                asn: asn,
                org: org,
                index: i,
                lat: lat,
                lng: lng,
                hasLocation: hasLocation
            };
            
            if (shouldLog) {
                console.log(`  └─ Node ${i} userData:`, {
                    type: nodeImplementation,
                    height: height,
                    latestHeight: latestHeight,
                    city: city,
                    country: country
                });
            }
            
            this.scene.add(node);
            this.nodes.push(node);
        }
        
        // Update progress (less frequently on mobile to reduce overhead)
        const progress = Math.floor((endIndex / nodeEntries.length) * 20) + 80; // 80-100%
        if (!this.isMobile || endIndex % (batchSize * 2) === 0 || endIndex === nodeEntries.length) {
            this.updateLoadingProgress(`Creating nodes... (${endIndex}/${nodeEntries.length})`, progress);
        }
        
            // Continue with next batch or finish
            if (endIndex < nodeEntries.length) {
                // Schedule next batch to prevent UI blocking
                console.log(`⏭️ Batch complete. Scheduling next batch...`);
                setTimeout(() => {
                    this.createNodesBatch(nodeEntries, endIndex);
                }, this.isMobile ? 10 : 1); // Longer delay on mobile
            } else {
                console.log(`🎉 ALL BATCHES COMPLETE! Created ${this.nodes.length} nodes total`);
                console.log(`🎬 Final scene info:`, {
                    sceneChildren: this.scene.children.length,
                    nodesArray: this.nodes.length,
                    sceneChildrenTypes: this.scene.children.map(child => child.type)
                });
                
                // Update UI with node counts now that nodes are created
                console.log('📊 Updating UI with node implementation counts...');
                this.updateUI();
                this.applyUrlParams();
                
                this.updateLoadingProgress('Complete!', 100);
                setTimeout(() => {
                    this.hideLoadingModal();
                }, 500);
            }
        } catch (error) {
            console.error('Error creating nodes batch:', error);
            console.log(`Successfully created ${this.nodes.length} nodes before error`);
            
            // Update UI with whatever nodes we managed to create
            console.log('📊 Updating UI with partial node counts...');
            this.updateUI();
            
            // Complete loading even if there was an error
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
            
            // Show a warning if very few nodes were created
            if (this.nodes.length < 100) {
                console.warn('Very few nodes created - device may be running out of memory');
            }
        }
    }

    getNodeType(userAgent) {
        if (userAgent.includes('Satoshi')) {
            if (userAgent.includes('Knots')) return 'knots';
            return 'bitcoin-core';
        } else if (userAgent.includes('Bitcoin')) {
            return 'bitcoin-core';
        } else if (userAgent.includes('bcoin')) {
            return 'bcoin';
        } else if (userAgent.includes('btcd')) {
            return 'btcd';
        } else {
            return 'other';
        }
    }

    getNodeColor(nodeType) {
        switch (nodeType) {
            case 'bitcoin-core': return 0xffffff;
            case 'knots': return 0xffffff;
            case 'bcoin': return 0xffffff;
            case 'btcd': return 0xffffff;
            default: return 0xffffff;
        }
    }

    getNodeSize(nodeType) {
        switch (nodeType) {
            case 'bitcoin-core': return 0.06;
            case 'knots': return 0.06;
            case 'bcoin': return 0.06;
            case 'btcd': return 0.06;
            default: return 0.06;
        }
    }

    // Cache management methods
    getCachedData() {
        try {
            const cachedData = localStorage.getItem(this.CACHE_KEY);
            const cacheTimestamp = localStorage.getItem(this.CACHE_TIMESTAMP_KEY);
            
            if (!cachedData || !cacheTimestamp) {
                console.log('📦 No cached data found');
                return null;
            }
            
            const timestamp = parseInt(cacheTimestamp, 10);
            const age = Date.now() - timestamp;
            const ageMinutes = Math.floor(age / 60000);
            
            if (age > this.CACHE_EXPIRY_MS) {
                console.log(`📦 Cache expired (${ageMinutes} minutes old, max ${this.CACHE_EXPIRY_MS / 60000} minutes)`);
                this.clearCache();
                return null;
            }
            
            console.log(`✅ Using cached data (${ageMinutes} minutes old)`);
            return JSON.parse(cachedData);
        } catch (error) {
            console.error('❌ Error reading cache:', error);
            this.clearCache();
            return null;
        }
    }
    
    setCachedData(data) {
        try {
            const dataString = JSON.stringify(data);
            const sizeInMB = (dataString.length / (1024 * 1024)).toFixed(2);
            
            console.log(`💾 Caching data (${sizeInMB} MB)...`);
            
            localStorage.setItem(this.CACHE_KEY, dataString);
            localStorage.setItem(this.CACHE_TIMESTAMP_KEY, Date.now().toString());
            
            console.log('✅ Data cached successfully');
            this.updateCacheStatus();
        } catch (error) {
            console.error('❌ Error caching data (storage full?):', error);
            // If storage is full, clear old cache and try again
            this.clearCache();
        }
    }
    
    clearCache() {
        localStorage.removeItem(this.CACHE_KEY);
        localStorage.removeItem(this.CACHE_TIMESTAMP_KEY);
        console.log('🗑️ Cache cleared');
        this.updateCacheStatus();
    }
    
    updateCacheStatus() {
        const cacheTimestamp = localStorage.getItem(this.CACHE_TIMESTAMP_KEY);
        const subtitle = document.getElementById('network-subtitle');
        
        if (cacheTimestamp && subtitle) {
            const age = Date.now() - parseInt(cacheTimestamp, 10);
            const ageMinutes = Math.floor(age / 60000);
            const currentText = subtitle.textContent;
            
            if (!currentText.includes('(cached')) {
                subtitle.textContent = currentText + ` (cached ${ageMinutes}m ago)`;
            }
        }
    }

    async fetchData() {
        this.showLoadingModal('Loading network data...');
        
        // URL param: load local archive instead of live/cache
        const archiveParam = new URLSearchParams(location.search).get('archive');
        if (archiveParam === '1' || archiveParam === 'true' || archiveParam === 'local') {
            await this.loadLocalArchive();
            return;
        }
        
        // Check cache first
        const cachedData = this.getCachedData();
        if (cachedData) {
            this.updateLoadingProgress('Loading from cache...', 50);
            this.nodeData = cachedData;
            
            // Sample nodes logging
            const sampleNodes = Object.entries(this.nodeData.nodes).slice(0, 3);
            console.log('📍 Sample nodes from cache:');
            sampleNodes.forEach(([address, nodeInfo], idx) => {
                console.log(`  Node ${idx}:`, {
                    address,
                    userAgent: nodeInfo[1],
                    height: nodeInfo[3],
                    city: nodeInfo[6],
                    country: nodeInfo[7],
                    lat: nodeInfo[8],
                    lng: nodeInfo[9]
                });
            });
            
            this.updateLoadingProgress('Creating visualization...', 80);
            this.createNetworkVisualization();
            
            // Still fetch snapshots list for navigation (lightweight call)
            this.fetchSnapshotsList();
            return;
        }
        
        try {
            // First, get the latest snapshot
            this.updateLoadingProgress('Fetching latest snapshot...', 20);
            const snapshotsResponse = await fetch('https://bitnodes.io/api/v1/snapshots/');
            
            if (snapshotsResponse.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Bitnodes.io API');
                return;
            }
            
            if (!snapshotsResponse.ok) {
                throw new Error(`HTTP error! status: ${snapshotsResponse.status}`);
            }
            
            const snapshotsData = await snapshotsResponse.json();
            
            if (snapshotsData.results && snapshotsData.results.length > 0) {
                // Store the full snapshots response for navigation
                this.snapshotsData = snapshotsData;
                this.currentSnapshotIndex = 0;
                this.latestSnapshot = snapshotsData.results[0];
                
                // Fetch the detailed snapshot data with geo field
                this.updateLoadingProgress('Loading node data...', 60);
                const snapshotUrl = this.latestSnapshot.url + (this.latestSnapshot.url.includes('?') ? '&' : '?') + 'field=geo';
                console.log('📡 Fetching snapshot with geo data from:', snapshotUrl);
                const snapshotResponse = await fetch(snapshotUrl);
                
                if (snapshotResponse.status === 429) {
                    this.hideLoadingModal();
                    this.showRateLimitError('Bitnodes.io API');
                    return;
                }
                
                if (!snapshotResponse.ok) {
                    throw new Error(`HTTP error! status: ${snapshotResponse.status}`);
                }
                
                this.nodeData = await snapshotResponse.json();
                this.subtitlePrefix = '';
                
                this.updateLoadingProgress('Creating visualization...', 80);
                console.log('✅ Fetched node data:', this.nodeData);
                console.log(`📊 Total nodes in dataset: ${Object.keys(this.nodeData.nodes).length}`);
                
                // Cache the data
                this.setCachedData(this.nodeData);
                
                // Sample first few nodes to check structure
                const sampleNodes = Object.entries(this.nodeData.nodes).slice(0, 3);
                console.log('📍 Sample nodes to verify structure:');
                sampleNodes.forEach(([address, nodeInfo], idx) => {
                    console.log(`  Node ${idx}:`, {
                        address,
                        arrayLength: nodeInfo.length,
                        version: nodeInfo[0],
                        userAgent: nodeInfo[1],
                        timestamp: nodeInfo[2],
                        height: nodeInfo[3],
                        latestHeight: nodeInfo[4],
                        hostname: nodeInfo[5],
                        city: nodeInfo[6],
                        country: nodeInfo[7],
                        lat: nodeInfo[8],
                        lng: nodeInfo[9],
                        timezone: nodeInfo[10],
                        asn: nodeInfo[11],
                        org: nodeInfo[12]
                    });
                });
                
                // Start node creation (this will handle progress updates and modal hiding)
                // updateUI() will be called AFTER nodes are created
                this.createNetworkVisualization();
                
                // Update snapshot navigation buttons
                this.updateSnapshotNavButtons();
            }
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching network data:', error);
            this.showGenericError('Network data');
        }
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
            border: 1px solid #333;
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

    updateUI() {
        if (!this.nodeData) {
            console.warn('⚠️ updateUI called but no nodeData available');
            return;
        }
        
        const totalNodes = this.nodeData.total_nodes;
        const latestHeight = this.nodeData.latest_height;
        const timestamp = new Date(this.nodeData.timestamp * 1000);
        
        console.log('📊 Counting node implementations from', this.nodes.length, 'nodes...');
        
        // Count node implementations and sub-metrics
        const nodeImplementations = {};
        let coreV30plus = 0, coreOlder = 0;
        let knotsBip110 = 0, knotsStandard = 0;

        this.nodes.forEach(node => {
            const implementation = node.userData.type;
            nodeImplementations[implementation] = (nodeImplementations[implementation] || 0) + 1;

            const ua = node.userData.userAgent || '';

            if (implementation === 'bitcoin-core') {
                const m = ua.match(/Satoshi:(\d+)\./);
                if (m && parseInt(m[1]) >= 30) coreV30plus++;
                else coreOlder++;
            } else if (implementation === 'knots') {
                if (ua.toLowerCase().includes('bip110')) knotsBip110++;
                else knotsStandard++;
            }
        });
        
        console.log('📊 Node implementation counts:', nodeImplementations);
        
        // Calculate total rendered nodes
        const totalRenderedNodes = this.nodes.length;
        
        // Update UI
        document.getElementById('total-nodes').textContent = totalNodes.toLocaleString();
        document.getElementById('connections').textContent = '0';
        document.getElementById('hash-rate').textContent = '450 EH/s'; // Placeholder
        document.getElementById('difficulty').textContent = '67.96 T'; // Placeholder
        
        // Update all implementation rows (flat list, bars relative to total rendered nodes)
        const setEl  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = `${pct}%`; };
        const pct = (n) => totalRenderedNodes > 0 ? n / totalRenderedNodes * 100 : 0;

        const rows = [
            { id: 'core-v30plus',   count: coreV30plus },
            { id: 'core-older',     count: coreOlder },
            { id: 'knots-standard', count: knotsStandard },
            { id: 'knots-bip110',   count: knotsBip110 },
            { id: 'bcoin',          count: nodeImplementations['bcoin'] || 0 },
            { id: 'other',          count: nodeImplementations['other'] || 0 },
        ];
        rows.forEach(({ id, count }) => {
            setEl(id, count > 0 ? count.toLocaleString() : '0');
            setBar(`bar-${id}`, pct(count));
        });

        console.log('✅ UI updated with implementation counts and percentage bars');
        
        // Update subtitle with timestamp and node count
        let subtitle = `${this.subtitlePrefix}${totalNodes.toLocaleString()} nodes • ${this.formatDate(timestamp)}`;
        
        // Add mobile optimization notice
        if (this.isMobile && this.nodes.length < totalNodes) {
            subtitle += ` • Showing ${this.nodes.length.toLocaleString()} (mobile optimized)`;
        }
        
        document.getElementById('network-subtitle').textContent = subtitle;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Log animate start once
        this.logAnimateStart();
        
        // Smooth orbit-focus transition (triggered by shift+click)
        if (this.orbitTransition) {
            const tr = this.orbitTransition;
            tr.progress = Math.min(tr.progress + 1 / tr.duration, 1);
            // Smoothstep easing: slow start and end, fast middle
            const t = tr.progress * tr.progress * (3 - 2 * tr.progress);
            this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, t);
            this.controls.distance = tr.fromDistance + (tr.toDistance - tr.fromDistance) * t;
            this.controls.update();
            if (tr.progress >= 1) this.orbitTransition = null;
        }

        // Montage loop: each shot has continuous motion; all cuts are immediate
        if (this.montageActive) {
            if (this.is2DMode) {
                this.montageActive = false;
                this.updateMontageButton(false);
            } else {
                const now = performance.now();
                const deltaSec = this.montageLastTime ? Math.min((now - this.montageLastTime) / 1000, 0.1) : 0;
                this.montageLastTime = now;
                const zoomLim = this.zoomLimits();
                const shot = MONTAGE_SHOTS[this.montageShotIndex];
                // General: allow zoom to continue to end (don't stop at 40); Horizon: allow any distance (e.g. 3 or 33)
                const distMin = (shot.name === 'General') ? 33 : (shot.name === 'Horizon') ? Math.min(33, shot.distance) : zoomLim.min;

                this.scene.rotation.y += (shot.rotationSpeed || 0) * deltaSec;
                this.controls.theta += (shot.panSpeedTheta || 0) * deltaSec;
                this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi + (shot.panSpeedPhi || 0) * deltaSec));
                this.controls.distance = Math.max(distMin, Math.min(zoomLim.max, this.controls.distance + (shot.zoomSpeed || 0) * deltaSec));
                this.controls.update();

                if (now - this.montagePhaseStartTime >= shot.holdSeconds * 1000) {
                    const toIndex = (this.montageShotIndex + 1) % MONTAGE_SHOTS.length;
                    const toShot = MONTAGE_SHOTS[toIndex];
                    this.montageShotIndex = toIndex;
                    this.montagePhaseStartTime = now;
                    if (toShot.target) {
                        this.controls.target.set(toShot.target[0], toShot.target[1], toShot.target[2]);
                    } else {
                        this.controls.target.set(0, 0, 0);
                    }
                    this.controls.distance = (toShot.name === 'Horizon') ? toShot.distance : Math.max(zoomLim.min, toShot.distance);
                    this.controls.phi = toShot.phi;
                    this.controls.theta = toShot.theta;
                    this.controls.update();
                    this.montageMusicPhrase(toShot);
                }
            }
        }

        // Depth dimming + anti-overlap scale.
        // Use distance from camera to origin so all shots (including custom-target e.g. Horizon) respect proximity.
        const cameraToOrigin = this.camera.position.length();
        // Above DEPTH_OFF distance all nodes are pure white (full-network view).
        const DEPTH_OFF  = 80;
        const DEPTH_ON   = 40;
        const MIN_BRIGHT = 0.18;
        const SCALE_ZONE = 50;
        const MIN_SCALE  = 0.25;
        const orthoFactor = this.isPerspective ? 1 : (this.orthographicZoom / 100);
        const baseScale   = (this.is2DMode ? 1.2 : 1.0) * orthoFactor;

        // How strongly the depth effect applies — 0 when zoomed out, 1 when close (by proximity to origin).
        const depthStrength = Math.min(1, Math.max(0,
            (DEPTH_OFF - cameraToOrigin) / (DEPTH_OFF - DEPTH_ON)
        ));

        // Camera in scene-local space (scene rotates, nodes are scene-children).
        const camPosLocal = this.scene.worldToLocal(this.camera.position.clone());

        // When fully zoomed out restore all nodes to white in one pass and skip
        // per-node work for this frame.
        if (depthStrength === 0) {
            if (this.nearScalingActive) {
                this.nearScalingActive = false;
                this.nodes.forEach(node => {
                    node.material.color.setHex(0xffffff);
                    node.scale.setScalar(baseScale);
                });
            }
        } else {
            // Pass 1 — find visible distance range for normalisation
            let minDist = Infinity, maxDist = 0;
            this.nodes.forEach(node => {
                if (!node.visible) return;
                const d = node.position.distanceTo(camPosLocal);
                if (d < minDist) minDist = d;
                if (d > maxDist) maxDist = d;
            });
            const distRange = maxDist - minDist;

            // Pass 2 — depth brightness + anti-overlap scale
            this.nodes.forEach(node => {
                if (!node.visible) return;
                const dist = node.position.distanceTo(camPosLocal);

                // Quadratic falloff blended by depthStrength.
                // At depthStrength=0 all nodes stay white; at 1 far nodes go dark.
                const depthRatio = distRange > 0.5 ? (dist - minDist) / distRange : 0;
                const t = 1 - depthRatio;
                const fullBright = MIN_BRIGHT + (1 - MIN_BRIGHT) * t * t;
                const brightness = 1 - depthStrength * (1 - fullBright);
                node.material.color.setScalar(brightness);

                // Scale shrinkage only when camera is close enough to origin (proximity-based for all shots)
                if (cameraToOrigin < SCALE_ZONE) {
                    const ratio = Math.min(1, dist / SCALE_ZONE);
                    const s = Math.max(MIN_SCALE, ratio * ratio * baseScale);
                    if (Math.abs(node.scale.x - s) > 0.0005) node.scale.setScalar(s);
                }
            });

            // Orthographic mode: all nodes share the same size (the smallest computed
            // scale) so they appear uniform regardless of depth position.
            if (!this.isPerspective && cameraToOrigin < SCALE_ZONE) {
                let minScale = baseScale;
                this.nodes.forEach(node => {
                    if (node.visible && node.scale.x < minScale) minScale = node.scale.x;
                });
                this.nodes.forEach(node => {
                    if (node.visible && Math.abs(node.scale.x - minScale) > 0.0005)
                        node.scale.setScalar(minScale);
                });
            }

            // Restore scales when leaving the scale zone
            if (cameraToOrigin >= SCALE_ZONE && this.nearScalingActive) {
                this.nearScalingActive = false;
                this.nodes.forEach(node => node.scale.setScalar(baseScale));
            }
            if (cameraToOrigin < SCALE_ZONE) this.nearScalingActive = true;
        }

        // Rotate scene (optional; when montage is active rotation is handled above)
        if (!this.montageActive && this.isRotating) {
            this.scene.rotation.y += 0.001;
        }
        
this.updateCameraCoordsDisplay();
        this.renderer.render(this.scene, this.camera);
    }

    /** Update sidebar camera coords display (throttled). Target phi/theta = spherical angles of target from origin. */
    updateCameraCoordsDisplay() {
        const now = performance.now();
        if (now - this.cameraCoordsLastUpdate < 100) return;
        this.cameraCoordsLastUpdate = now;
        const distEl = document.getElementById('camera-dist');
        const phiEl = document.getElementById('camera-phi');
        const thetaEl = document.getElementById('camera-theta');
        const targetEl = document.getElementById('camera-target');
        const targetPhiEl = document.getElementById('camera-target-phi');
        const targetThetaEl = document.getElementById('camera-target-theta');
        if (!distEl || !phiEl || !thetaEl) return;
        const c = this.controls;
        distEl.textContent = c.distance.toFixed(2);
        phiEl.textContent = c.phi.toFixed(4);
        thetaEl.textContent = c.theta.toFixed(4);
        const tx = c.target.x, ty = c.target.y, tz = c.target.z;
        targetEl.textContent = [tx.toFixed(2), ty.toFixed(2), tz.toFixed(2)].join(', ');
        const r = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (r < 1e-6) {
            if (targetPhiEl) targetPhiEl.textContent = '—';
            if (targetThetaEl) targetThetaEl.textContent = '—';
        } else {
            const tPhi = Math.acos(Math.max(-1, Math.min(1, ty / r)));
            const tTheta = Math.atan2(tz, tx);
            if (targetPhiEl) targetPhiEl.textContent = tPhi.toFixed(4);
            if (targetThetaEl) targetThetaEl.textContent = tTheta.toFixed(4);
        }
    }

    // Add a one-time log to verify animate is running
    logAnimateStart() {
        if (!this.animateLogged) {
            console.log('🎬 Animate loop is running');
            console.log('📹 Renderer info:', {
                width: this.renderer.domElement.width,
                height: this.renderer.domElement.height
            });
            console.log('📷 Camera info:', {
                position: this.camera.position,
                type: this.camera.type
            });
            this.animateLogged = true;
        }
    }

    onWindowResize() {
        const sceneEl = document.getElementById('scene');
        const w = sceneEl ? sceneEl.clientWidth  : window.innerWidth;
        const h = sceneEl ? sceneEl.clientHeight : window.innerHeight;
        if (this.isPerspective) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        } else {
            const aspect = w / h;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(w, h);
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('network-info');
        
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
    
    setupSnapshotNavigation() {
        const prevBtn = document.getElementById('prev-snapshot');
        const nextBtn = document.getElementById('next-snapshot');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.loadPreviousSnapshot());
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.loadNextSnapshot());
        }
    }
    
    formatSnapshotDate(timestamp) {
        const date = new Date(timestamp * 1000);
        const options = {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        };
        return date.toLocaleString(undefined, options);
    }
    
    updateSnapshotNavButtons() {
        const prevBtn = document.getElementById('prev-snapshot');
        const nextBtn = document.getElementById('next-snapshot');
        
        if (!this.snapshotsData || !this.snapshotsData.results) {
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }
        
        const results = this.snapshotsData.results;
        const hasOlderSnapshots = this.currentSnapshotIndex < results.length - 1 || this.snapshotsData.next;
        const hasNewerSnapshots = this.currentSnapshotIndex > 0 || this.snapshotsData.previous;
        
        // Previous = older in time (higher index or next page)
        if (prevBtn) {
            prevBtn.disabled = !hasOlderSnapshots;
            if (this.currentSnapshotIndex < results.length - 1) {
                const prevSnapshot = results[this.currentSnapshotIndex + 1];
                prevBtn.title = `Previous: ${this.formatSnapshotDate(prevSnapshot.timestamp)}`;
            } else if (this.snapshotsData.next) {
                prevBtn.title = 'Load older snapshots...';
            } else {
                prevBtn.title = 'No older snapshots';
            }
        }
        
        // Next = newer in time (lower index or previous page)
        if (nextBtn) {
            nextBtn.disabled = !hasNewerSnapshots;
            if (this.currentSnapshotIndex > 0) {
                const nextSnapshot = results[this.currentSnapshotIndex - 1];
                nextBtn.title = `Next: ${this.formatSnapshotDate(nextSnapshot.timestamp)}`;
            } else if (this.snapshotsData.previous) {
                nextBtn.title = 'Load newer snapshots...';
            } else {
                nextBtn.title = 'Already at latest snapshot';
            }
        }
    }
    
    async loadPreviousSnapshot() {
        if (!this.snapshotsData || !this.snapshotsData.results) return;
        
        const results = this.snapshotsData.results;
        
        // Try to go to older snapshot (higher index)
        if (this.currentSnapshotIndex < results.length - 1) {
            this.currentSnapshotIndex++;
            await this.loadSnapshotByIndex(this.currentSnapshotIndex);
        } else if (this.snapshotsData.next) {
            // Need to fetch older snapshots from next page
            await this.fetchOlderSnapshots();
        }
    }
    
    async loadNextSnapshot() {
        if (!this.snapshotsData || !this.snapshotsData.results) return;
        
        // Try to go to newer snapshot (lower index)
        if (this.currentSnapshotIndex > 0) {
            this.currentSnapshotIndex--;
            await this.loadSnapshotByIndex(this.currentSnapshotIndex);
        } else if (this.snapshotsData.previous) {
            // Need to fetch newer snapshots from previous page
            await this.fetchNewerSnapshots();
        }
    }
    
    async fetchOlderSnapshots() {
        if (!this.snapshotsData.next) return;
        
        this.showLoadingModal('Loading older snapshots...');
        this.updateLoadingProgress('Fetching snapshot list...', 20);
        
        try {
            const response = await fetch(this.snapshotsData.next);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const newData = await response.json();
            
            // Append older snapshots to our list
            this.snapshotsData.results = [...this.snapshotsData.results, ...newData.results];
            this.snapshotsData.next = newData.next;
            
            // Move to the first snapshot of the new page
            this.currentSnapshotIndex++;
            await this.loadSnapshotByIndex(this.currentSnapshotIndex);
        } catch (error) {
            console.error('Error fetching older snapshots:', error);
            this.hideLoadingModal();
            this.showGenericError('older snapshots');
        }
    }
    
    async fetchNewerSnapshots() {
        if (!this.snapshotsData.previous) return;
        
        this.showLoadingModal('Loading newer snapshots...');
        this.updateLoadingProgress('Fetching snapshot list...', 20);
        
        try {
            const response = await fetch(this.snapshotsData.previous);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const newData = await response.json();
            
            // Prepend newer snapshots to our list (adjusting current index)
            const newCount = newData.results.length;
            this.snapshotsData.results = [...newData.results, ...this.snapshotsData.results];
            this.snapshotsData.previous = newData.previous;
            this.currentSnapshotIndex += newCount;
            
            // Move to the last snapshot of the new page (newest of the prepended)
            this.currentSnapshotIndex--;
            await this.loadSnapshotByIndex(this.currentSnapshotIndex);
        } catch (error) {
            console.error('Error fetching newer snapshots:', error);
            this.hideLoadingModal();
            this.showGenericError('newer snapshots');
        }
    }
    
    async loadSnapshotByIndex(index) {
        const snapshot = this.snapshotsData.results[index];
        if (!snapshot) return;
        
        // Clear the cache since we're loading a different snapshot
        this.clearCache();
        
        this.showLoadingModal('Loading snapshot...');
        this.updateLoadingProgress(`Loading snapshot from ${this.formatSnapshotDate(snapshot.timestamp)}...`, 30);
        
        try {
            const snapshotUrl = snapshot.url + (snapshot.url.includes('?') ? '&' : '?') + 'field=geo';
            console.log('📡 Fetching snapshot with geo data from:', snapshotUrl);
            
            this.updateLoadingProgress('Downloading node data...', 50);
            const response = await fetch(snapshotUrl);
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Bitnodes.io API');
                return;
            }
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            this.nodeData = await response.json();
            this.latestSnapshot = snapshot;
            
            this.updateLoadingProgress('Creating visualization...', 80);
            this.createNetworkVisualization();
            this.updateSnapshotNavButtons();
        } catch (error) {
            console.error('Error loading snapshot:', error);
            this.hideLoadingModal();
            this.showGenericError('snapshot data');
        }
    }
    
    async fetchSnapshotsList() {
        // Lightweight fetch of just the snapshots list (for navigation when using cached data)
        try {
            const response = await fetch('https://bitnodes.io/api/v1/snapshots/');
            if (!response.ok) return;
            
            const snapshotsData = await response.json();
            if (snapshotsData.results && snapshotsData.results.length > 0) {
                this.snapshotsData = snapshotsData;
                
                // Find the current snapshot in the list by matching timestamp
                if (this.nodeData && this.nodeData.timestamp) {
                    const currentTimestamp = this.nodeData.timestamp;
                    const index = snapshotsData.results.findIndex(s => s.timestamp === currentTimestamp);
                    this.currentSnapshotIndex = index >= 0 ? index : 0;
                } else {
                    this.currentSnapshotIndex = 0;
                }
                
                this.updateSnapshotNavButtons();
            }
        } catch (error) {
            console.log('Could not fetch snapshots list:', error);
            // Non-critical, just means navigation won't work
        }
    }
    
    // Archive snapshots data (weekly snapshots from bitnodes.io/archive)
    getArchiveSnapshots() {
        return {
            2025: [
                { timestamp: 1764375604, date: 'Sat Nov 29 00:20:04 2025 UTC', nodes: 24335 },
                { timestamp: 1763770728, date: 'Sat Nov 22 00:18:48 2025 UTC', nodes: 23265 },
                { timestamp: 1763165509, date: 'Sat Nov 15 00:11:49 2025 UTC', nodes: 23127 },
                { timestamp: 1762560432, date: 'Sat Nov 8 00:07:12 2025 UTC', nodes: 24182 },
                { timestamp: 1761955513, date: 'Sat Nov 1 00:05:13 2025 UTC', nodes: 24031 },
                { timestamp: 1761697657, date: 'Wed Oct 29 00:27:37 2025 UTC', nodes: 23928 },
                { timestamp: 1761092452, date: 'Wed Oct 22 00:20:52 2025 UTC', nodes: 23735 },
                { timestamp: 1760487076, date: 'Wed Oct 15 00:11:16 2025 UTC', nodes: 24159 },
                { timestamp: 1759882225, date: 'Wed Oct 8 00:10:25 2025 UTC', nodes: 24166 },
                { timestamp: 1759277241, date: 'Wed Oct 1 00:07:21 2025 UTC', nodes: 23964 },
                { timestamp: 1759105049, date: 'Mon Sep 29 00:17:29 2025 UTC', nodes: 23372 },
                { timestamp: 1758500095, date: 'Mon Sep 22 00:14:55 2025 UTC', nodes: 23523 },
                { timestamp: 1757894888, date: 'Mon Sep 15 00:08:08 2025 UTC', nodes: 26879 },
                { timestamp: 1757289979, date: 'Mon Sep 8 00:06:19 2025 UTC', nodes: 23964 },
                { timestamp: 1756685173, date: 'Mon Sep 1 00:06:13 2025 UTC', nodes: 23615 },
                { timestamp: 1756427187, date: 'Fri Aug 29 00:26:27 2025 UTC', nodes: 23578 },
                { timestamp: 1755822229, date: 'Fri Aug 22 00:23:49 2025 UTC', nodes: 23480 },
                { timestamp: 1755217188, date: 'Fri Aug 15 00:19:48 2025 UTC', nodes: 23263 },
                { timestamp: 1754611891, date: 'Fri Aug 8 00:11:31 2025 UTC', nodes: 23356 },
                { timestamp: 1754006453, date: 'Fri Aug 1 00:00:53 2025 UTC', nodes: 22482 },
                { timestamp: 1753748770, date: 'Tue Jul 29 00:26:10 2025 UTC', nodes: 22843 },
                { timestamp: 1753143763, date: 'Tue Jul 22 00:22:43 2025 UTC', nodes: 23076 },
                { timestamp: 1752538586, date: 'Tue Jul 15 00:16:26 2025 UTC', nodes: 22879 },
                { timestamp: 1751933384, date: 'Tue Jul 8 00:09:44 2025 UTC', nodes: 22817 },
                { timestamp: 1751328065, date: 'Tue Jul 1 00:01:05 2025 UTC', nodes: 21770 },
                { timestamp: 1751156828, date: 'Sun Jun 29 00:27:08 2025 UTC', nodes: 22111 },
                { timestamp: 1750551577, date: 'Sun Jun 22 00:19:37 2025 UTC', nodes: 22000 },
                { timestamp: 1749946380, date: 'Sun Jun 15 00:13:00 2025 UTC', nodes: 21969 },
                { timestamp: 1749341504, date: 'Sun Jun 8 00:11:44 2025 UTC', nodes: 22158 },
                { timestamp: 1748736096, date: 'Sun Jun 1 00:01:36 2025 UTC', nodes: 22299 },
                { timestamp: 1748478531, date: 'Thu May 29 00:28:51 2025 UTC', nodes: 22312 },
                { timestamp: 1747873306, date: 'Thu May 22 00:21:46 2025 UTC', nodes: 21579 },
                { timestamp: 1747268121, date: 'Thu May 15 00:15:21 2025 UTC', nodes: 22104 },
                { timestamp: 1746662689, date: 'Thu May 8 00:04:49 2025 UTC', nodes: 21863 },
                { timestamp: 1746057855, date: 'Thu May 1 00:04:15 2025 UTC', nodes: 21395 },
                { timestamp: 1745886126, date: 'Tue Apr 29 00:22:06 2025 UTC', nodes: 21064 },
                { timestamp: 1745280818, date: 'Tue Apr 22 00:13:38 2025 UTC', nodes: 21512 },
                { timestamp: 1744675732, date: 'Tue Apr 15 00:08:52 2025 UTC', nodes: 21284 },
                { timestamp: 1744070582, date: 'Tue Apr 8 00:03:02 2025 UTC', nodes: 21370 },
                { timestamp: 1743465781, date: 'Tue Apr 1 00:03:01 2025 UTC', nodes: 21813 },
                { timestamp: 1743207707, date: 'Sat Mar 29 00:21:47 2025 UTC', nodes: 21781 },
                { timestamp: 1742602825, date: 'Sat Mar 22 00:20:25 2025 UTC', nodes: 21162 },
                { timestamp: 1741997710, date: 'Sat Mar 15 00:15:10 2025 UTC', nodes: 21812 },
                { timestamp: 1741392315, date: 'Sat Mar 8 00:05:15 2025 UTC', nodes: 21197 },
                { timestamp: 1740787435, date: 'Sat Mar 1 00:03:55 2025 UTC', nodes: 21966 },
                { timestamp: 1740183809, date: 'Sat Feb 22 00:23:29 2025 UTC', nodes: 21848 },
                { timestamp: 1739578459, date: 'Sat Feb 15 00:14:19 2025 UTC', nodes: 21810 },
                { timestamp: 1738973630, date: 'Sat Feb 8 00:13:50 2025 UTC', nodes: 21804 },
                { timestamp: 1738368329, date: 'Sat Feb 1 00:05:29 2025 UTC', nodes: 21030 },
                { timestamp: 1738110254, date: 'Wed Jan 29 00:24:14 2025 UTC', nodes: 21057 },
                { timestamp: 1737505009, date: 'Wed Jan 22 00:16:49 2025 UTC', nodes: 20875 },
                { timestamp: 1736900176, date: 'Wed Jan 15 00:16:16 2025 UTC', nodes: 20581 },
                { timestamp: 1736294986, date: 'Wed Jan 8 00:09:46 2025 UTC', nodes: 20912 },
                { timestamp: 1735690131, date: 'Wed Jan 1 00:08:51 2025 UTC', nodes: 20766 }
            ],
            2024: [
                { timestamp: 1735432191, date: 'Sun Dec 29 00:29:51 2024 UTC', nodes: 20333 },
                { timestamp: 1734827047, date: 'Sun Dec 22 00:24:07 2024 UTC', nodes: 20599 },
                { timestamp: 1734221883, date: 'Sun Dec 15 00:18:03 2024 UTC', nodes: 21140 },
                { timestamp: 1733616586, date: 'Sun Dec 8 00:09:46 2024 UTC', nodes: 20144 },
                { timestamp: 1733011555, date: 'Sun Dec 1 00:05:55 2024 UTC', nodes: 19362 },
                { timestamp: 1732839987, date: 'Fri Nov 29 00:26:27 2024 UTC', nodes: 19287 },
                { timestamp: 1732234584, date: 'Fri Nov 22 00:16:24 2024 UTC', nodes: 19472 },
                { timestamp: 1731629779, date: 'Fri Nov 15 00:16:19 2024 UTC', nodes: 19499 },
                { timestamp: 1731024903, date: 'Fri Nov 8 00:15:03 2024 UTC', nodes: 18758 },
                { timestamp: 1730419533, date: 'Fri Nov 1 00:05:33 2024 UTC', nodes: 19423 },
                { timestamp: 1730160285, date: 'Tue Oct 29 00:04:45 2024 UTC', nodes: 19524 },
                { timestamp: 1729555484, date: 'Tue Oct 22 00:04:44 2024 UTC', nodes: 19256 },
                { timestamp: 1728950662, date: 'Tue Oct 15 00:04:22 2024 UTC', nodes: 18837 },
                { timestamp: 1728345854, date: 'Tue Oct 8 00:04:14 2024 UTC', nodes: 18984 },
                { timestamp: 1727740867, date: 'Tue Oct 1 00:01:07 2024 UTC', nodes: 18956 },
                { timestamp: 1727569282, date: 'Sun Sep 29 00:21:22 2024 UTC', nodes: 18991 },
                { timestamp: 1726964476, date: 'Sun Sep 22 00:21:16 2024 UTC', nodes: 19112 },
                { timestamp: 1726359060, date: 'Sun Sep 15 00:11:00 2024 UTC', nodes: 19436 },
                { timestamp: 1725753687, date: 'Sun Sep 8 00:01:27 2024 UTC', nodes: 19203 },
                { timestamp: 1725148865, date: 'Sun Sep 1 00:01:05 2024 UTC', nodes: 19345 },
                { timestamp: 1724890201, date: 'Thu Aug 29 00:10:01 2024 UTC', nodes: 19421 },
                { timestamp: 1724285377, date: 'Thu Aug 22 00:09:37 2024 UTC', nodes: 19178 },
                { timestamp: 1723680524, date: 'Thu Aug 15 00:08:44 2024 UTC', nodes: 19320 },
                { timestamp: 1723075718, date: 'Thu Aug 8 00:08:38 2024 UTC', nodes: 19663 },
                { timestamp: 1722470724, date: 'Thu Aug 1 00:05:24 2024 UTC', nodes: 19292 },
                { timestamp: 1722212215, date: 'Mon Jul 29 00:16:55 2024 UTC', nodes: 19180 },
                { timestamp: 1721607266, date: 'Mon Jul 22 00:14:26 2024 UTC', nodes: 7614 },
                { timestamp: 1721002440, date: 'Mon Jul 15 00:14:00 2024 UTC', nodes: 10930 },
                { timestamp: 1720397297, date: 'Mon Jul 8 00:08:17 2024 UTC', nodes: 19383 },
                { timestamp: 1719792494, date: 'Mon Jul 1 00:08:14 2024 UTC', nodes: 19286 },
                { timestamp: 1719620866, date: 'Sat Jun 29 00:27:46 2024 UTC', nodes: 19124 },
                { timestamp: 1719015872, date: 'Sat Jun 22 00:24:32 2024 UTC', nodes: 19234 },
                { timestamp: 1718410833, date: 'Sat Jun 15 00:20:33 2024 UTC', nodes: 19466 },
                { timestamp: 1717805597, date: 'Sat Jun 8 00:13:17 2024 UTC', nodes: 19077 },
                { timestamp: 1717200374, date: 'Sat Jun 1 00:06:14 2024 UTC', nodes: 19382 },
                { timestamp: 1716942004, date: 'Wed May 29 00:20:04 2024 UTC', nodes: 18393 },
                { timestamp: 1716337028, date: 'Wed May 22 00:17:08 2024 UTC', nodes: 18271 },
                { timestamp: 1715732068, date: 'Wed May 15 00:14:28 2024 UTC', nodes: 17750 },
                { timestamp: 1715126989, date: 'Wed May 8 00:09:49 2024 UTC', nodes: 19145 },
                { timestamp: 1714521871, date: 'Wed May 1 00:04:31 2024 UTC', nodes: 19368 },
                { timestamp: 1714350618, date: 'Mon Apr 29 00:30:18 2024 UTC', nodes: 18890 },
                { timestamp: 1713745615, date: 'Mon Apr 22 00:26:55 2024 UTC', nodes: 19054 },
                { timestamp: 1713140476, date: 'Mon Apr 15 00:21:16 2024 UTC', nodes: 17756 },
                { timestamp: 1712535253, date: 'Mon Apr 8 00:14:13 2024 UTC', nodes: 17969 },
                { timestamp: 1711930068, date: 'Mon Apr 1 00:07:48 2024 UTC', nodes: 17883 },
                { timestamp: 1711672003, date: 'Fri Mar 29 00:26:43 2024 UTC', nodes: 18210 },
                { timestamp: 1711066753, date: 'Fri Mar 22 00:19:13 2024 UTC', nodes: 17953 },
                { timestamp: 1710461741, date: 'Fri Mar 15 00:15:41 2024 UTC', nodes: 18277 },
                { timestamp: 1709856788, date: 'Fri Mar 8 00:13:08 2024 UTC', nodes: 18358 },
                { timestamp: 1709251755, date: 'Fri Mar 1 00:09:15 2024 UTC', nodes: 18419 },
                { timestamp: 1709166140, date: 'Thu Feb 29 00:22:20 2024 UTC', nodes: 18364 },
                { timestamp: 1708561280, date: 'Thu Feb 22 00:21:20 2024 UTC', nodes: 18209 },
                { timestamp: 1707956086, date: 'Thu Feb 15 00:14:46 2024 UTC', nodes: 17797 },
                { timestamp: 1707350820, date: 'Thu Feb 8 00:07:00 2024 UTC', nodes: 17606 },
                { timestamp: 1706745660, date: 'Thu Feb 1 00:01:00 2024 UTC', nodes: 15514 },
                { timestamp: 1706488021, date: 'Mon Jan 29 00:27:01 2024 UTC', nodes: 15167 },
                { timestamp: 1705882931, date: 'Mon Jan 22 00:22:11 2024 UTC', nodes: 15634 },
                { timestamp: 1705277778, date: 'Mon Jan 15 00:16:18 2024 UTC', nodes: 15933 },
                { timestamp: 1704672612, date: 'Mon Jan 8 00:10:12 2024 UTC', nodes: 17777 },
                { timestamp: 1704067368, date: 'Mon Jan 1 00:02:48 2024 UTC', nodes: 17197 }
            ],
            2023: [
                { timestamp: 1703808960, date: 'Fri Dec 29 00:16:00 2023 UTC', nodes: 17250 },
                { timestamp: 1703204117, date: 'Fri Dec 22 00:15:17 2023 UTC', nodes: 16358 },
                { timestamp: 1702599162, date: 'Fri Dec 15 00:12:42 2023 UTC', nodes: 16990 },
                { timestamp: 1701994308, date: 'Fri Dec 8 00:11:48 2023 UTC', nodes: 17271 },
                { timestamp: 1701389008, date: 'Fri Dec 1 00:03:28 2023 UTC', nodes: 16854 },
                { timestamp: 1701216759, date: 'Wed Nov 29 00:12:39 2023 UTC', nodes: 16328 },
                { timestamp: 1700611941, date: 'Wed Nov 22 00:12:21 2023 UTC', nodes: 16553 },
                { timestamp: 1700007117, date: 'Wed Nov 15 00:11:57 2023 UTC', nodes: 16919 },
                { timestamp: 1699401788, date: 'Wed Nov 8 00:03:08 2023 UTC', nodes: 16754 },
                { timestamp: 1698796955, date: 'Wed Nov 1 00:02:35 2023 UTC', nodes: 17000 },
                { timestamp: 1698538672, date: 'Sun Oct 29 00:17:52 2023 UTC', nodes: 15716 },
                { timestamp: 1697933646, date: 'Sun Oct 22 00:14:06 2023 UTC', nodes: 16903 },
                { timestamp: 1697328479, date: 'Sun Oct 15 00:07:59 2023 UTC', nodes: 16574 },
                { timestamp: 1696723616, date: 'Sun Oct 8 00:06:56 2023 UTC', nodes: 16793 },
                { timestamp: 1696118719, date: 'Sun Oct 1 00:05:19 2023 UTC', nodes: 16727 },
                { timestamp: 1695946741, date: 'Fri Sep 29 00:19:01 2023 UTC', nodes: 16510 },
                { timestamp: 1695341580, date: 'Fri Sep 22 00:13:00 2023 UTC', nodes: 16347 },
                { timestamp: 1694736392, date: 'Fri Sep 15 00:06:32 2023 UTC', nodes: 16645 },
                { timestamp: 1694131430, date: 'Fri Sep 8 00:03:50 2023 UTC', nodes: 16141 },
                { timestamp: 1693526498, date: 'Fri Sep 1 00:01:38 2023 UTC', nodes: 16495 },
                { timestamp: 1693267801, date: 'Tue Aug 29 00:10:01 2023 UTC', nodes: 16179 },
                { timestamp: 1692662973, date: 'Tue Aug 22 00:09:33 2023 UTC', nodes: 15513 },
                { timestamp: 1692058168, date: 'Tue Aug 15 00:09:28 2023 UTC', nodes: 16154 },
                { timestamp: 1691453237, date: 'Tue Aug 8 00:07:17 2023 UTC', nodes: 16796 },
                { timestamp: 1690848118, date: 'Tue Aug 1 00:01:58 2023 UTC', nodes: 16900 },
                { timestamp: 1690589315, date: 'Sat Jul 29 00:08:35 2023 UTC', nodes: 16716 },
                { timestamp: 1689984393, date: 'Sat Jul 22 00:06:33 2023 UTC', nodes: 17099 },
                { timestamp: 1689379452, date: 'Sat Jul 15 00:04:12 2023 UTC', nodes: 16774 },
                { timestamp: 1688774465, date: 'Sat Jul 8 00:01:05 2023 UTC', nodes: 16747 },
                { timestamp: 1688169600, date: 'Sat Jul 1 00:00:00 2023 UTC', nodes: 16722 },
                { timestamp: 1687998116, date: 'Thu Jun 29 00:21:56 2023 UTC', nodes: 16794 },
                { timestamp: 1687392837, date: 'Thu Jun 22 00:13:57 2023 UTC', nodes: 16896 },
                { timestamp: 1686788007, date: 'Thu Jun 15 00:13:27 2023 UTC', nodes: 17149 },
                { timestamp: 1686182848, date: 'Thu Jun 8 00:07:28 2023 UTC', nodes: 17186 },
                { timestamp: 1685578038, date: 'Thu Jun 1 00:07:18 2023 UTC', nodes: 16862 },
                { timestamp: 1685319869, date: 'Mon May 29 00:24:29 2023 UTC', nodes: 17205 },
                { timestamp: 1684714761, date: 'Mon May 22 00:19:21 2023 UTC', nodes: 16894 },
                { timestamp: 1684109811, date: 'Mon May 15 00:16:51 2023 UTC', nodes: 17075 },
                { timestamp: 1683504599, date: 'Mon May 8 00:09:59 2023 UTC', nodes: 17008 },
                { timestamp: 1682899629, date: 'Mon May 1 00:07:09 2023 UTC', nodes: 17539 },
                { timestamp: 1682727784, date: 'Sat Apr 29 00:23:04 2023 UTC', nodes: 17303 },
                { timestamp: 1682122808, date: 'Sat Apr 22 00:20:08 2023 UTC', nodes: 17468 },
                { timestamp: 1681517650, date: 'Sat Apr 15 00:14:10 2023 UTC', nodes: 17510 },
                { timestamp: 1680912554, date: 'Sat Apr 8 00:09:14 2023 UTC', nodes: 17634 },
                { timestamp: 1680307616, date: 'Sat Apr 1 00:06:56 2023 UTC', nodes: 17447 },
                { timestamp: 1680049474, date: 'Wed Mar 29 00:24:34 2023 UTC', nodes: 17308 },
                { timestamp: 1679444443, date: 'Wed Mar 22 00:20:43 2023 UTC', nodes: 17134 },
                { timestamp: 1678839335, date: 'Wed Mar 15 00:15:35 2023 UTC', nodes: 16271 },
                { timestamp: 1678234030, date: 'Wed Mar 8 00:07:10 2023 UTC', nodes: 16376 },
                { timestamp: 1677628955, date: 'Wed Mar 1 00:02:35 2023 UTC', nodes: 16431 },
                { timestamp: 1677025392, date: 'Wed Feb 22 00:23:12 2023 UTC', nodes: 15436 },
                { timestamp: 1676420185, date: 'Wed Feb 15 00:16:25 2023 UTC', nodes: 14053 },
                { timestamp: 1675815297, date: 'Wed Feb 8 00:14:57 2023 UTC', nodes: 14464 },
                { timestamp: 1675209943, date: 'Wed Feb 1 00:05:43 2023 UTC', nodes: 12529 },
                { timestamp: 1674951670, date: 'Sun Jan 29 00:21:10 2023 UTC', nodes: 14322 },
                { timestamp: 1674346688, date: 'Sun Jan 22 00:18:08 2023 UTC', nodes: 14623 },
                { timestamp: 1673741842, date: 'Sun Jan 15 00:17:22 2023 UTC', nodes: 14511 },
                { timestamp: 1673136610, date: 'Sun Jan 8 00:10:10 2023 UTC', nodes: 14777 },
                { timestamp: 1672531655, date: 'Sun Jan 1 00:07:35 2023 UTC', nodes: 15434 }
            ],
            2022: [
                { timestamp: 1672273281, date: 'Thu Dec 29 00:21:21 2022 UTC', nodes: 15379 },
                { timestamp: 1671668220, date: 'Thu Dec 22 00:17:00 2022 UTC', nodes: 13762 },
                { timestamp: 1671063181, date: 'Thu Dec 15 00:13:01 2022 UTC', nodes: 15184 },
                { timestamp: 1670458075, date: 'Thu Dec 8 00:07:55 2022 UTC', nodes: 15439 },
                { timestamp: 1669852979, date: 'Thu Dec 1 00:02:59 2022 UTC', nodes: 13802 },
                { timestamp: 1669680949, date: 'Tue Nov 29 00:15:49 2022 UTC', nodes: 14056 },
                { timestamp: 1669076089, date: 'Tue Nov 22 00:14:49 2022 UTC', nodes: 14234 },
                { timestamp: 1668470889, date: 'Tue Nov 15 00:08:09 2022 UTC', nodes: 15317 },
                { timestamp: 1667866022, date: 'Tue Nov 8 00:07:02 2022 UTC', nodes: 15762 },
                { timestamp: 1667260886, date: 'Tue Nov 1 00:01:26 2022 UTC', nodes: 15625 },
                { timestamp: 1667002538, date: 'Sat Oct 29 00:15:38 2022 UTC', nodes: 14168 },
                { timestamp: 1666397282, date: 'Sat Oct 22 00:08:02 2022 UTC', nodes: 14492 },
                { timestamp: 1665792409, date: 'Sat Oct 15 00:06:49 2022 UTC', nodes: 14613 },
                { timestamp: 1665187515, date: 'Sat Oct 8 00:05:15 2022 UTC', nodes: 14991 },
                { timestamp: 1664582610, date: 'Sat Oct 1 00:03:30 2022 UTC', nodes: 14321 },
                { timestamp: 1664410202, date: 'Thu Sep 29 00:10:02 2022 UTC', nodes: 14343 },
                { timestamp: 1663805364, date: 'Thu Sep 22 00:09:24 2022 UTC', nodes: 13764 },
                { timestamp: 1663200478, date: 'Thu Sep 15 00:07:58 2022 UTC', nodes: 14886 },
                { timestamp: 1662595541, date: 'Thu Sep 8 00:05:41 2022 UTC', nodes: 14638 },
                { timestamp: 1661990462, date: 'Thu Sep 1 00:01:02 2022 UTC', nodes: 14175 },
                { timestamp: 1661731878, date: 'Mon Aug 29 00:11:18 2022 UTC', nodes: 14612 },
                { timestamp: 1661127069, date: 'Mon Aug 22 00:11:09 2022 UTC', nodes: 12752 },
                { timestamp: 1660521975, date: 'Mon Aug 15 00:06:15 2022 UTC', nodes: 14386 },
                { timestamp: 1659916957, date: 'Mon Aug 8 00:02:37 2022 UTC', nodes: 14852 },
                { timestamp: 1659312097, date: 'Mon Aug 1 00:01:37 2022 UTC', nodes: 13738 },
                { timestamp: 1659053827, date: 'Fri Jul 29 00:17:07 2022 UTC', nodes: 14035 },
                { timestamp: 1658448795, date: 'Fri Jul 22 00:13:15 2022 UTC', nodes: 14887 },
                { timestamp: 1657843656, date: 'Fri Jul 15 00:07:36 2022 UTC', nodes: 15215 },
                { timestamp: 1657238659, date: 'Fri Jul 8 00:04:19 2022 UTC', nodes: 15138 },
                { timestamp: 1656633779, date: 'Fri Jul 1 00:02:59 2022 UTC', nodes: 15476 },
                { timestamp: 1656461677, date: 'Wed Jun 29 00:14:37 2022 UTC', nodes: 15953 },
                { timestamp: 1655856597, date: 'Wed Jun 22 00:09:57 2022 UTC', nodes: 15975 },
                { timestamp: 1655251776, date: 'Wed Jun 15 00:09:36 2022 UTC', nodes: 15846 },
                { timestamp: 1654646854, date: 'Wed Jun 8 00:07:34 2022 UTC', nodes: 15954 },
                { timestamp: 1654041784, date: 'Wed Jun 1 00:03:04 2022 UTC', nodes: 16127 },
                { timestamp: 1653782682, date: 'Sun May 29 00:04:42 2022 UTC', nodes: 15185 },
                { timestamp: 1653177787, date: 'Sun May 22 00:03:07 2022 UTC', nodes: 15473 },
                { timestamp: 1652572920, date: 'Sun May 15 00:02:00 2022 UTC', nodes: 15705 },
                { timestamp: 1651968079, date: 'Sun May 8 00:01:19 2022 UTC', nodes: 15557 },
                { timestamp: 1651363231, date: 'Sun May 1 00:00:31 2022 UTC', nodes: 15367 },
                { timestamp: 1651191715, date: 'Fri Apr 29 00:21:55 2022 UTC', nodes: 15786 },
                { timestamp: 1650586677, date: 'Fri Apr 22 00:17:57 2022 UTC', nodes: 15441 },
                { timestamp: 1649981543, date: 'Fri Apr 15 00:12:23 2022 UTC', nodes: 15142 },
                { timestamp: 1649376552, date: 'Fri Apr 8 00:09:12 2022 UTC', nodes: 15799 },
                { timestamp: 1648771419, date: 'Fri Apr 1 00:03:39 2022 UTC', nodes: 15101 },
                { timestamp: 1648512738, date: 'Tue Mar 29 00:12:18 2022 UTC', nodes: 15003 },
                { timestamp: 1647907676, date: 'Tue Mar 22 00:07:56 2022 UTC', nodes: 15079 },
                { timestamp: 1647302744, date: 'Tue Mar 15 00:05:44 2022 UTC', nodes: 14915 },
                { timestamp: 1646697803, date: 'Tue Mar 8 00:03:23 2022 UTC', nodes: 15019 },
                { timestamp: 1646092973, date: 'Tue Mar 1 00:02:53 2022 UTC', nodes: 14996 },
                { timestamp: 1645488952, date: 'Tue Feb 22 00:15:52 2022 UTC', nodes: 15233 },
                { timestamp: 1644884116, date: 'Tue Feb 15 00:15:16 2022 UTC', nodes: 15212 },
                { timestamp: 1644278951, date: 'Tue Feb 8 00:09:11 2022 UTC', nodes: 14977 },
                { timestamp: 1643673867, date: 'Tue Feb 1 00:04:27 2022 UTC', nodes: 14997 },
                { timestamp: 1643415283, date: 'Sat Jan 29 00:14:43 2022 UTC', nodes: 15036 },
                { timestamp: 1642810360, date: 'Sat Jan 22 00:12:40 2022 UTC', nodes: 15091 },
                { timestamp: 1642205266, date: 'Sat Jan 15 00:07:46 2022 UTC', nodes: 14900 },
                { timestamp: 1641600312, date: 'Sat Jan 8 00:05:12 2022 UTC', nodes: 14950 },
                { timestamp: 1640995478, date: 'Sat Jan 1 00:04:38 2022 UTC', nodes: 14727 }
            ],
            2021: [
                { timestamp: 1640737012, date: 'Wed Dec 29 00:16:52 2021 UTC', nodes: 14964 },
                { timestamp: 1640131958, date: 'Wed Dec 22 00:12:38 2021 UTC', nodes: 14719 },
                { timestamp: 1639526917, date: 'Wed Dec 15 00:08:37 2021 UTC', nodes: 14696 },
                { timestamp: 1638921959, date: 'Wed Dec 8 00:05:59 2021 UTC', nodes: 14723 },
                { timestamp: 1638316922, date: 'Wed Dec 1 00:02:02 2021 UTC', nodes: 14688 },
                { timestamp: 1638144864, date: 'Mon Nov 29 00:14:24 2021 UTC', nodes: 14373 },
                { timestamp: 1637539941, date: 'Mon Nov 22 00:12:21 2021 UTC', nodes: 13640 },
                { timestamp: 1636934980, date: 'Mon Nov 15 00:09:40 2021 UTC', nodes: 13513 },
                { timestamp: 1636329902, date: 'Mon Nov 8 00:05:02 2021 UTC', nodes: 12712 },
                { timestamp: 1635724808, date: 'Mon Nov 1 00:00:08 2021 UTC', nodes: 12669 },
                { timestamp: 1635466286, date: 'Fri Oct 29 00:11:26 2021 UTC', nodes: 12017 },
                { timestamp: 1634861433, date: 'Fri Oct 22 00:10:33 2021 UTC', nodes: 13956 },
                { timestamp: 1634256276, date: 'Fri Oct 15 00:04:36 2021 UTC', nodes: 14261 },
                { timestamp: 1633651387, date: 'Fri Oct 8 00:03:07 2021 UTC', nodes: 13501 },
                { timestamp: 1633046511, date: 'Fri Oct 1 00:01:51 2021 UTC', nodes: 10531 },
                { timestamp: 1632874366, date: 'Wed Sep 29 00:12:46 2021 UTC', nodes: 11250 },
                { timestamp: 1632269307, date: 'Wed Sep 22 00:08:27 2021 UTC', nodes: 11502 },
                { timestamp: 1631664389, date: 'Wed Sep 15 00:06:29 2021 UTC', nodes: 11111 },
                { timestamp: 1631059319, date: 'Wed Sep 8 00:01:59 2021 UTC', nodes: 10069 },
                { timestamp: 1630454401, date: 'Wed Sep 1 00:00:01 2021 UTC', nodes: 10169 },
                { timestamp: 1630195754, date: 'Sun Aug 29 00:09:14 2021 UTC', nodes: 11507 },
                { timestamp: 1629590836, date: 'Sun Aug 22 00:07:16 2021 UTC', nodes: 12484 },
                { timestamp: 1628985701, date: 'Sun Aug 15 00:01:41 2021 UTC', nodes: 11793 },
                { timestamp: 1628380889, date: 'Sun Aug 8 00:01:29 2021 UTC', nodes: 12239 },
                { timestamp: 1627776070, date: 'Sun Aug 1 00:01:10 2021 UTC', nodes: 10811 },
                { timestamp: 1627518244, date: 'Thu Jul 29 00:24:04 2021 UTC', nodes: 12259 },
                { timestamp: 1626913192, date: 'Thu Jul 22 00:19:52 2021 UTC', nodes: 12780 },
                { timestamp: 1626307822, date: 'Thu Jul 15 00:10:22 2021 UTC', nodes: 12781 },
                { timestamp: 1625702683, date: 'Thu Jul 8 00:04:43 2021 UTC', nodes: 11496 },
                { timestamp: 1625097611, date: 'Thu Jul 1 00:00:11 2021 UTC', nodes: 10326 },
                { timestamp: 1624925663, date: 'Tue Jun 29 00:14:23 2021 UTC', nodes: 10569 },
                { timestamp: 1624320804, date: 'Tue Jun 22 00:13:24 2021 UTC', nodes: 9752 },
                { timestamp: 1623715703, date: 'Tue Jun 15 00:08:23 2021 UTC', nodes: 9042 },
                { timestamp: 1623110833, date: 'Tue Jun 8 00:07:13 2021 UTC', nodes: 9406 },
                { timestamp: 1622505755, date: 'Tue Jun 1 00:02:35 2021 UTC', nodes: 9803 },
                { timestamp: 1622247624, date: 'Sat May 29 00:20:24 2021 UTC', nodes: 9786 },
                { timestamp: 1621642482, date: 'Sat May 22 00:14:42 2021 UTC', nodes: 9656 },
                { timestamp: 1621037442, date: 'Sat May 15 00:10:42 2021 UTC', nodes: 9727 },
                { timestamp: 1620432317, date: 'Sat May 8 00:05:17 2021 UTC', nodes: 9526 },
                { timestamp: 1619827440, date: 'Sat May 1 00:04:00 2021 UTC', nodes: 9832 },
                { timestamp: 1619655665, date: 'Thu Apr 29 00:21:05 2021 UTC', nodes: 9752 },
                { timestamp: 1619050599, date: 'Thu Apr 22 00:16:39 2021 UTC', nodes: 9740 },
                { timestamp: 1618445550, date: 'Thu Apr 15 00:12:30 2021 UTC', nodes: 9640 },
                { timestamp: 1617840365, date: 'Thu Apr 8 00:06:05 2021 UTC', nodes: 9435 },
                { timestamp: 1617235397, date: 'Thu Apr 1 00:03:17 2021 UTC', nodes: 9690 },
                { timestamp: 1616977297, date: 'Mon Mar 29 00:21:37 2021 UTC', nodes: 9171 },
                { timestamp: 1616372460, date: 'Mon Mar 22 00:21:00 2021 UTC', nodes: 10200 },
                { timestamp: 1615767321, date: 'Mon Mar 15 00:15:21 2021 UTC', nodes: 10318 },
                { timestamp: 1615162148, date: 'Mon Mar 8 00:09:08 2021 UTC', nodes: 10384 },
                { timestamp: 1614557068, date: 'Mon Mar 1 00:04:28 2021 UTC', nodes: 10487 },
                { timestamp: 1613952943, date: 'Mon Feb 22 00:15:43 2021 UTC', nodes: 10265 },
                { timestamp: 1613347893, date: 'Mon Feb 15 00:11:33 2021 UTC', nodes: 9962 },
                { timestamp: 1612743008, date: 'Mon Feb 8 00:10:08 2021 UTC', nodes: 9631 },
                { timestamp: 1612138005, date: 'Mon Feb 1 00:06:45 2021 UTC', nodes: 11249 },
                { timestamp: 1611880910, date: 'Fri Jan 29 00:41:50 2021 UTC', nodes: 11767 },
                { timestamp: 1611275511, date: 'Fri Jan 22 00:31:51 2021 UTC', nodes: 11850 },
                { timestamp: 1610669997, date: 'Fri Jan 15 00:19:57 2021 UTC', nodes: 11050 },
                { timestamp: 1610065148, date: 'Fri Jan 8 00:19:08 2021 UTC', nodes: 9434 },
                { timestamp: 1609459918, date: 'Fri Jan 1 00:11:58 2021 UTC', nodes: 11029 }
            ],
            2020: [
                { timestamp: 1609201190, date: 'Tue Dec 29 00:19:50 2020 UTC', nodes: 10709 },
                { timestamp: 1608596306, date: 'Tue Dec 22 00:18:26 2020 UTC', nodes: 11478 },
                { timestamp: 1607991247, date: 'Tue Dec 15 00:14:07 2020 UTC', nodes: 11223 },
                { timestamp: 1607385830, date: 'Tue Dec 8 00:03:50 2020 UTC', nodes: 11195 },
                { timestamp: 1606780813, date: 'Tue Dec 1 00:00:13 2020 UTC', nodes: 11022 },
                { timestamp: 1606610057, date: 'Sun Nov 29 00:34:17 2020 UTC', nodes: 11238 },
                { timestamp: 1606005044, date: 'Sun Nov 22 00:30:44 2020 UTC', nodes: 11033 },
                { timestamp: 1605399754, date: 'Sun Nov 15 00:22:34 2020 UTC', nodes: 10709 },
                { timestamp: 1604794392, date: 'Sun Nov 8 00:13:12 2020 UTC', nodes: 11065 },
                { timestamp: 1604189429, date: 'Sun Nov 1 00:10:29 2020 UTC', nodes: 11080 }
            ],
            2019: [
                { timestamp: 1577578276, date: 'Sun Dec 29 00:11:16 2019 UTC', nodes: 9510 },
                { timestamp: 1576973212, date: 'Sun Dec 22 00:06:52 2019 UTC', nodes: 9512 },
                { timestamp: 1576368334, date: 'Sun Dec 15 00:05:34 2019 UTC', nodes: 9567 },
                { timestamp: 1575763385, date: 'Sun Dec 8 00:03:05 2019 UTC', nodes: 9435 },
                { timestamp: 1575158535, date: 'Sun Dec 1 00:02:15 2019 UTC', nodes: 9574 }
            ],
            2018: [
                { timestamp: 1546043081, date: 'Sat Dec 29 00:24:41 2018 UTC', nodes: 10247 },
                { timestamp: 1545438208, date: 'Sat Dec 22 00:23:28 2018 UTC', nodes: 9930 },
                { timestamp: 1544833366, date: 'Sat Dec 15 00:22:46 2018 UTC', nodes: 9720 },
                { timestamp: 1514764941, date: 'Mon Jan 1 00:02:21 2018 UTC', nodes: 11748 }
            ],
            2017: [
                { timestamp: 1514506683, date: 'Fri Dec 29 00:18:03 2017 UTC', nodes: 11799 },
                { timestamp: 1483228917, date: 'Sun Jan 1 00:01:57 2017 UTC', nodes: 5459 }
            ],
            2016: [
                { timestamp: 1482970669, date: 'Thu Dec 29 00:17:49 2016 UTC', nodes: 5513 },
                { timestamp: 1451606409, date: 'Fri Jan 1 00:00:09 2016 UTC', nodes: 5645 }
            ],
            2015: [
                { timestamp: 1451347826, date: 'Tue Dec 29 00:10:26 2015 UTC', nodes: 5378 },
                { timestamp: 1420070689, date: 'Thu Jan 1 00:04:49 2015 UTC', nodes: 6289 }
            ],
            2014: [
                { timestamp: 1419812501, date: 'Mon Dec 29 00:21:41 2014 UTC', nodes: 6528 },
                { timestamp: 1409799688, date: 'Thu Sep 4 03:01:28 2014 UTC', nodes: 6997 }
            ]
        };
    }
    
    setupArchiveDropdown() {
        const archiveSelect = document.getElementById('archive-select');
        if (!archiveSelect) return;
        
        const archiveData = this.getArchiveSnapshots();
        const years = Object.keys(archiveData).sort((a, b) => b - a); // Sort descending
        
        // Populate dropdown with optgroups by year
        years.forEach(year => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = year;
            
            archiveData[year].forEach(snapshot => {
                const option = document.createElement('option');
                option.value = snapshot.timestamp;
                // Format: "Nov 29 - 24,335 nodes"
                const dateMatch = snapshot.date.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2} \d+)/);
                const shortDate = dateMatch ? dateMatch[1] : snapshot.date.substring(0, 10);
                option.textContent = `${shortDate} - ${snapshot.nodes.toLocaleString()} nodes`;
                option.title = `${snapshot.date} - ${snapshot.nodes.toLocaleString()} nodes`;
                optgroup.appendChild(option);
            });
            
            archiveSelect.appendChild(optgroup);
        });
        
        // Add change event listener
        archiveSelect.addEventListener('change', async (e) => {
            const timestamp = e.target.value;
            if (timestamp) {
                await this.loadArchiveSnapshot(parseInt(timestamp));
                // Reset dropdown to placeholder
                archiveSelect.value = '';
            }
        });
    }
    
    async loadArchiveSnapshot(timestamp) {
        this.showLoadingModal('Loading archive snapshot...');
        this.updateLoadingProgress(`Loading ${this.formatSnapshotDate(timestamp)}...`, 20);
        
        // Clear cache since we're loading historical data
        this.clearCache();
        
        try {
            // Archive snapshots use a different URL format
            const archiveUrl = `https://bitnodes.io/api/v1/snapshots/${timestamp}/?field=geo`;
            console.log('📡 Fetching archive snapshot from:', archiveUrl);
            
            this.updateLoadingProgress('Downloading node data...', 50);
            const response = await fetch(archiveUrl);
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Bitnodes.io API');
                return;
            }
            
            if (response.status === 404) {
                // Try the weekly archive format instead
                console.log('📡 Trying weekly archive format...');
                this.updateLoadingProgress('Trying archive format...', 60);
                const weeklyUrl = `https://bitnodes.io/weekly/${timestamp}.json`;
                const weeklyResponse = await fetch(weeklyUrl);
                
                if (!weeklyResponse.ok) {
                    throw new Error(`Archive snapshot not found: ${timestamp}`);
                }
                
                // Weekly archive has different format - need to transform
                const weeklyData = await weeklyResponse.json();
                this.nodeData = this.transformWeeklyArchiveData(timestamp, weeklyData);
            } else if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                this.nodeData = await response.json();
            }
            
            // Update snapshot tracking
            this.latestSnapshot = { timestamp, total_nodes: Object.keys(this.nodeData.nodes || {}).length };
            this.snapshotsData = null; // Clear regular snapshots since we're in archive mode
            this.currentSnapshotIndex = 0;
            
            this.updateLoadingProgress('Creating visualization...', 80);
            this.createNetworkVisualization();
            this.updateSnapshotNavButtons();
            
            // Update subtitle to indicate archive mode
            const subtitle = document.getElementById('network-subtitle');
            if (subtitle) {
                const totalNodes = this.nodeData.total_nodes || Object.keys(this.nodeData.nodes || {}).length;
                subtitle.textContent = `Archive: ${totalNodes.toLocaleString()} nodes • ${this.formatSnapshotDate(timestamp)}`;
            }
        } catch (error) {
            console.error('Error loading archive snapshot:', error);
            this.hideLoadingModal();
            this.showGenericError('archive snapshot');
        }
    }
    
    transformWeeklyArchiveData(timestamp, weeklyData) {
        // Weekly archive format: array of arrays
        // [address, port, version, userAgent, connectedSince, services, height, hostname, city, countryCode, lat, lng, timezone, asn, org]
        const nodes = {};
        
        if (Array.isArray(weeklyData)) {
            weeklyData.forEach(nodeArray => {
                if (Array.isArray(nodeArray) && nodeArray.length >= 2) {
                    const [address, port, version, userAgent, connectedSince, services, height, hostname, city, country, lat, lng, timezone, asn, org] = nodeArray;
                    const nodeKey = `${address}:${port}`;
                    // Transform to standard snapshot format
                    nodes[nodeKey] = [
                        version || 70015,
                        userAgent || '/Satoshi:0.0.0/',
                        connectedSince || timestamp,
                        height || 0,
                        height || 0,
                        hostname || '',
                        city || null,
                        country || null,
                        lat || null,
                        lng || null,
                        timezone || null,
                        asn || null,
                        org || null
                    ];
                }
            });
        }
        
        return {
            timestamp: timestamp,
            total_nodes: Object.keys(nodes).length,
            latest_height: 0,
            nodes: nodes
        };
    }
    
    // Navigation methods
    rotateLeft() {
        this.isRotating = false;
        this.updateRotationButton(false);
        this.controls.theta -= 0.2;
        this.controls.update();
    }
    
    rotateRight() {
        this.isRotating = false;
        this.updateRotationButton(false);
        this.controls.theta += 0.2;
        this.controls.update();
    }
    
    rotateUp() {
        this.isRotating = false;
        this.updateRotationButton(false);
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    rotateDown() {
        this.isRotating = false;
        this.updateRotationButton(false);
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    panLeft() {
        this.isRotating = false;
        this.updateRotationButton(false);
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    panRight() {
        this.isRotating = false;
        this.updateRotationButton(false);
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panUp() {
        this.isRotating = false;
        this.updateRotationButton(false);
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panDown() {
        this.isRotating = false;
        this.updateRotationButton(false);
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    zoomIn() {
        this.isRotating = false;
        this.updateRotationButton(false);
        if (this.isPerspective) {
            this.controls.distance -= 2;
            const { min: ziMin, max: ziMax } = this.zoomLimits();
            this.controls.distance = Math.max(ziMin, Math.min(ziMax, this.controls.distance));
            this.controls.update();
        } else {
            this.orthographicZoom += 5;
            this.orthographicZoom = Math.max(10, Math.min(300, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
    }
    
    zoomOut() {
        this.isRotating = false;
        this.updateRotationButton(false);
        if (this.isPerspective) {
            this.controls.distance += 2;
            const { min: zoMin, max: zoMax } = this.zoomLimits();
            this.controls.distance = Math.max(zoMin, Math.min(zoMax, this.controls.distance));
            this.controls.update();
        } else {
            this.orthographicZoom -= 5;
            this.orthographicZoom = Math.max(10, Math.min(300, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
    }
    
    toggleConnections() {
        this.showConnections = !this.showConnections;
        const btn = document.getElementById('toggle-connections');
        if (this.showConnections) {
            this.createConnections();
            if (btn) btn.textContent = 'Hide Connections';
        } else {
            this.clearConnections();
            if (btn) btn.textContent = 'Show Connections';
        }
        this.syncUrlParams();
    }

    createConnections() {
        this.clearConnections();

        const visibleNodes = this.nodes.filter(n => n.visible);
        if (visibleNodes.length < 2) return;

        // Budget: at least one random line per node so every node is covered
        const MAX_LINES = Math.max(3000, visibleNodes.length);
        const positions = new Float32Array(MAX_LINES * 6);
        let count = 0;

        // Phase 1 – guaranteed pass: shuffle all nodes, pair each as source with a
        // random destination. Every node gets ≥1 random connection.
        const shuffledRandom = visibleNodes.slice().sort(() => Math.random() - 0.5);
        for (let i = 0; i < shuffledRandom.length && count < MAX_LINES; i++) {
            const a = shuffledRandom[i];
            const b = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
            if (a === b) continue;
            const base = count * 6;
            positions[base]     = a.position.x;
            positions[base + 1] = a.position.y;
            positions[base + 2] = a.position.z;
            positions[base + 3] = b.position.x;
            positions[base + 4] = b.position.y;
            positions[base + 5] = b.position.z;
            count++;
        }

        // Phase 2 – fill remaining budget with additional random pairs
        const extraAttempts = (MAX_LINES - count) * 3;
        for (let i = 0; i < extraAttempts && count < MAX_LINES; i++) {
            const a = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
            const b = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
            if (a === b) continue;
            const base = count * 6;
            positions[base]     = a.position.x;
            positions[base + 1] = a.position.y;
            positions[base + 2] = a.position.z;
            positions[base + 3] = b.position.x;
            positions[base + 4] = b.position.y;
            positions[base + 5] = b.position.z;
            count++;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 6), 3));

        const sharedMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.07,
            blending: THREE.ScreenBlending,
            depthWrite: false
        });

        const lineSegments = new THREE.LineSegments(geometry, sharedMaterial);
        this.connectionsMesh = lineSegments;
        this.scene.add(lineSegments);

        // --- Proximity connections: only link nodes within a radius ---
        const PROX_LINES = 1000;
        const RADIUS = 22;
        const proxPositions = new Float32Array(PROX_LINES * 6);
        let proxCount = 0;

        // Phase 1 – guaranteed pass: every node gets ≥1 proximity connection
        // (if a neighbour within RADIUS exists after 20 attempts).
        const shuffledProx = visibleNodes.slice().sort(() => Math.random() - 0.5);
        for (let i = 0; i < shuffledProx.length && proxCount < PROX_LINES; i++) {
            const a = shuffledProx[i];
            for (let t = 0; t < 20; t++) {
                const b = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
                if (b === a) continue;
                if (a.position.distanceTo(b.position) > RADIUS) continue;
                const base = proxCount * 6;
                proxPositions[base]     = a.position.x;
                proxPositions[base + 1] = a.position.y;
                proxPositions[base + 2] = a.position.z;
                proxPositions[base + 3] = b.position.x;
                proxPositions[base + 4] = b.position.y;
                proxPositions[base + 5] = b.position.z;
                proxCount++;
                break;
            }
        }

        // Phase 2 – fill remaining proximity budget
        const proxExtra = (PROX_LINES - proxCount) * 8;
        for (let i = 0; i < proxExtra && proxCount < PROX_LINES; i++) {
            const a = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
            for (let t = 0; t < 20; t++) {
                const b = visibleNodes[Math.floor(Math.random() * visibleNodes.length)];
                if (b === a) continue;
                if (a.position.distanceTo(b.position) > RADIUS) continue;
                const base = proxCount * 6;
                proxPositions[base]     = a.position.x;
                proxPositions[base + 1] = a.position.y;
                proxPositions[base + 2] = a.position.z;
                proxPositions[base + 3] = b.position.x;
                proxPositions[base + 4] = b.position.y;
                proxPositions[base + 5] = b.position.z;
                proxCount++;
                break;
            }
        }

        if (proxCount > 0) {
            const proxGeometry = new THREE.BufferGeometry();
            proxGeometry.setAttribute('position', new THREE.BufferAttribute(proxPositions.slice(0, proxCount * 6), 3));
            this.proximityMesh = new THREE.LineSegments(proxGeometry, sharedMaterial);
            this.scene.add(this.proximityMesh);
        }

        // Keep connections array in sync for clearing on data reload
        this.connections = [lineSegments, this.proximityMesh].filter(Boolean);
    }

    clearConnections() {
        if (this.connectionsMesh) {
            this.connectionsMesh.geometry.dispose();
            this.connectionsMesh.material.dispose(); // shared material disposed here
            this.scene.remove(this.connectionsMesh);
            this.connectionsMesh = null;
        }
        if (this.proximityMesh) {
            this.proximityMesh.geometry.dispose();
            // material already disposed above (shared)
            this.scene.remove(this.proximityMesh);
            this.proximityMesh = null;
        }
        this.connections = [];
    }

    // ── Table Pane ──────────────────────────────────────────────────────────

    toggleTablePane() {
        if (this.tableOpen) {
            this.closeTablePane();
        } else {
            this.openTablePane();
        }
    }

    openTablePane() {
        this.tableOpen = true;
        const pane = document.getElementById('node-table-pane');
        const btn  = document.getElementById('toggle-table');
        if (pane) { pane.classList.add('open'); pane.setAttribute('aria-hidden', 'false'); }
        if (btn)  btn.classList.add('active');
        document.body.classList.add('table-open');
        setTimeout(() => this.onWindowResize(), 310);
        this.renderTableRows();
        this.syncUrlParams();
    }

    closeTablePane() {
        this.tableOpen = false;
        const pane = document.getElementById('node-table-pane');
        const btn  = document.getElementById('toggle-table');
        if (pane) { pane.classList.remove('open'); pane.setAttribute('aria-hidden', 'true'); }
        if (btn)  btn.classList.remove('active');
        document.body.classList.remove('table-open');
        setTimeout(() => this.onWindowResize(), 310);
        this.syncUrlParams();
    }

    handleTableSort(column) {
        if (this.tableSort.column === column) {
            this.tableSort.dir *= -1;
        } else {
            this.tableSort.column = column;
            this.tableSort.dir = 1;
        }
        // Update header indicators
        document.querySelectorAll('#node-table th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.col === column) {
                th.classList.add(this.tableSort.dir === 1 ? 'sort-asc' : 'sort-desc');
            }
        });
        this.tablePage = 0;
        this.renderTableRows();
    }

    getNodeTableData() {
        return this.nodes.map(node => {
            const d = node.userData || {};
            // Derive a clean client string from userAgent
            let client = d.userAgent || '';
            const match = client.match(/\/([^/]+:[^/]+)/);
            if (match) client = match[1];
            client = client.replace(/^\//, '').slice(0, 20);

            return {
                address:   d.address   || '',
                country:   d.country   || '',
                city:      d.city      || '',
                userAgent: client,
                height:    typeof d.height === 'number' ? d.height : (parseInt(d.height) || 0),
                isTor:     !d.hasLocation,
                visible:   node.visible,
            };
        });
    }

    renderTableRows(scrollToTop = false) {
        const tbody   = document.getElementById('node-table-body');
        const countEl = document.getElementById('table-count');
        const footerEl  = document.getElementById('table-footer-note');
        const pageInfoEl = document.getElementById('table-page-info');
        const prevBtn  = document.getElementById('table-prev');
        const nextBtn  = document.getElementById('table-next');
        if (!tbody) return;

        const query = (document.getElementById('table-search')?.value || '').toLowerCase().trim();
        const { column, dir } = this.tableSort;
        const pageSize = this.tablePageSize;

        let rows = this.getNodeTableData();

        // Type filter
        if (this.tableFilter === 'clearnet') rows = rows.filter(r => !r.isTor);
        else if (this.tableFilter === 'tor')  rows = rows.filter(r =>  r.isTor);

        // Search filter
        if (query) {
            rows = rows.filter(r =>
                r.address.toLowerCase().includes(query) ||
                r.country.toLowerCase().includes(query) ||
                r.city.toLowerCase().includes(query) ||
                r.userAgent.toLowerCase().includes(query)
            );
        }

        const total = rows.length;

        // Sort
        rows.sort((a, b) => {
            let av = a[column], bv = b[column];
            if (column === 'height') return dir * (av - bv);
            av = String(av).toLowerCase();
            bv = String(bv).toLowerCase();
            return dir * av.localeCompare(bv);
        });

        // Pagination
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        this.tablePage = Math.min(this.tablePage, totalPages - 1);
        const start = this.tablePage * pageSize;
        const pageRows = rows.slice(start, start + pageSize);

        // Count badge
        if (countEl) {
            countEl.textContent = query
                ? `${total.toLocaleString()} match${total !== 1 ? 'es' : ''}`
                : `${this.nodes.length.toLocaleString()} nodes`;
        }

        // Page info & prev/next state
        if (pageInfoEl) pageInfoEl.textContent = `${this.tablePage + 1} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = this.tablePage === 0;
        if (nextBtn) nextBtn.disabled = this.tablePage >= totalPages - 1;

        // Footer note
        if (footerEl) {
            const from = total === 0 ? 0 : start + 1;
            const to   = Math.min(start + pageSize, total);
            footerEl.textContent = total === 0
                ? ''
                : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;
        }

        if (pageRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="table-no-results">No nodes match your search.</td></tr>`;
            return;
        }

        // Build HTML string for performance
        const html = pageRows.map(r => {
            const badge = r.isTor ? `<span class="node-type-badge tor">Tor</span>` : '';
            const heightStr = r.height > 0 ? r.height.toLocaleString() : '—';
            const addrShort = r.address.length > 38 ? r.address.slice(0, 36) + '…' : r.address;
            return `<tr data-address="${escHtml(r.address)}">
                <td class="addr-cell" title="${escHtml(r.address)}">${escHtml(addrShort)}${badge}</td>
                <td title="${escHtml(r.country)}">${escHtml(r.country) || '—'}</td>
                <td title="${escHtml(r.city)}">${escHtml(r.city) || '—'}</td>
                <td title="${escHtml(r.userAgent)}">${escHtml(r.userAgent) || '—'}</td>
                <td class="height-cell">${heightStr}</td>
            </tr>`;
        }).join('');

        tbody.innerHTML = html;

        if (scrollToTop) {
            const body = document.querySelector('.table-pane-body');
            if (body) body.scrollTop = 0;
        }
    }

    // ── URL Parameter Sync ────────────────────────────────────────────────────

    applyUiHiddenFromUrl() {
        if (new URLSearchParams(location.search).get('ui') !== 'hidden') return;
        document.body.classList.add('ui-hidden');
        const toggleUi = document.getElementById('toggle-ui');
        if (toggleUi) {
            toggleUi.title = 'Show UI';
            toggleUi.setAttribute('aria-label', 'Show UI');
        }
    }

    applyCameraInfoFromUrl() {
        const p = new URLSearchParams(location.search);
        const show = p.get('camerainfo') === 'true' || p.get('camerainfo') === '1';
        const panel = document.getElementById('camera-coords-panel');
        if (panel) panel.style.display = show ? '' : 'none';
    }

    syncUrlParams() {
        const p = new URLSearchParams();
        if (this.is2DMode)        p.set('view',        '2d');
        if (!this.isEarthVisible) p.set('earth',       '0');
        if (this.showConnections) p.set('connections', '1');
        if (this.tableOpen)       p.set('table',       '1');
        if (!this.isRotating)     p.set('rotate',      '0');
        if (this.tableFilter !== 'all') p.set('filter', this.tableFilter);
        if (document.body.classList.contains('ui-hidden')) p.set('ui', 'hidden');
        if (this.montageActive) p.set('montage', '1');
        if (this.subtitlePrefix === 'Archive: ') p.set('archive', '1');
        const current = new URLSearchParams(location.search);
        if (current.get('camerainfo') === '1' || current.get('camerainfo') === 'true') p.set('camerainfo', '1');

        const qs = p.toString();
        const newUrl = qs ? `${location.pathname}?${qs}` : location.pathname;
        history.replaceState(null, '', newUrl);
    }

    applyUrlParams() {
        const p = new URLSearchParams(location.search);

        // view
        if (p.get('view') === '2d' && !this.is2DMode) this.toggle2DView();

        // earth
        if (p.get('earth') === '0' && this.isEarthVisible) this.toggleEarth();

        // connections
        if (p.get('connections') === '1' && !this.showConnections) this.toggleConnections();

        // rotate
        if (p.get('rotate') === '0' && this.isRotating) {
            this.isRotating = false;
            this.updateRotationButton(false);
        }

        // table + filter
        const filter = p.get('filter');
        if (filter && ['all', 'clearnet', 'tor'].includes(filter)) {
            this.tableFilter = filter;
            document.querySelectorAll('.table-filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
        }
        if (p.get('table') === '1') this.openTablePane();

        // UI visibility (view toggle) — also applied early in init() via applyUiHiddenFromUrl()
        if (p.get('ui') === 'hidden') this.applyUiHiddenFromUrl();

        this.applyCameraInfoFromUrl();

        // Montage (only start if not already active and not in 2D mode)
        if (p.get('montage') === '1' && !this.montageActive && !this.is2DMode) this.toggleMontage();
    }

    toggleEarth() {
        this.isEarthVisible = !this.isEarthVisible;
        if (this.is2DMode) {
            if (this.mapPlaneMesh) this.mapPlaneMesh.visible = this.isEarthVisible;
        } else {
            if (this.earthMesh) this.earthMesh.visible = this.isEarthVisible;
        }
        const btn = document.getElementById('toggle-earth');
        if (btn) btn.textContent = this.isEarthVisible ? 'Hide Map' : 'Show Map';
        this.syncUrlParams();
    }

    toggle2DView() {
        // Reset connections on every mode switch — lines reference old node positions
        if (this.showConnections) {
            this.clearConnections();
            this.showConnections = false;
            const connBtn = document.getElementById('toggle-connections');
            if (connBtn) connBtn.textContent = 'Show Connections';
        }

        this.is2DMode = !this.is2DMode;
        const btn = document.getElementById('toggle-2d');

        if (this.is2DMode) {
            // --- Enter 2D mode ---
            this.scene.rotation.y = 0;

            // Hide the 3D globe; show the flat map plane honoring current earth visibility
            if (this.earthMesh) this.earthMesh.visible = false;
            if (this.mapPlaneMesh) this.mapPlaneMesh.visible = this.isEarthVisible;

            // Reposition nodes onto flat map plane; hide Tor nodes
            // Scale nodes up so they are visible and raycaster-hittable from top-down
            this.nodes.forEach(node => {
                node.userData.originalPosition = node.position.clone();
                if (node.userData.hasLocation) {
                    const flatX = (node.userData.lng / 180) * 66;
                    const flatZ = -(node.userData.lat / 90) * 33;
                    node.position.set(flatX, 0, flatZ);
                    node.visible = true;
                    node.scale.setScalar(1.2);
                } else {
                    node.visible = false;
                }
            });

            // Save current camera state
            this.savedCameraState = {
                phi: this.controls.phi,
                theta: this.controls.theta,
                distance: this.controls.distance,
                target: this.controls.target.clone(),
                cameraUp: this.camera.up.clone()
            };

            // Position camera top-down: phi≈0 puts camera directly above
            this.controls.phi = 0.001;
            this.controls.theta = 0;
            this.controls.distance = 120;
            this.controls.target.set(0, 0, 0);
            // north-up: screen-up direction maps to world -Z (negative lat = south in our projection)
            this.camera.up.set(0, 0, -1);
            this.controls.update();

            if (btn) btn.textContent = '3D Globe';
        } else {
            // --- Exit 2D mode ---

            // Hide the flat map plane and restore the 3D globe
            if (this.mapPlaneMesh) this.mapPlaneMesh.visible = false;
            if (this.earthMesh) this.earthMesh.visible = this.isEarthVisible;

            // Restore all node positions, scale and visibility
            this.nodes.forEach(node => {
                if (node.userData.originalPosition) {
                    node.position.copy(node.userData.originalPosition);
                }
                node.scale.setScalar(1);
                node.visible = true;
            });

            // Restore camera state
            if (this.savedCameraState) {
                this.controls.phi = this.savedCameraState.phi;
                this.controls.theta = this.savedCameraState.theta;
                this.controls.distance = this.savedCameraState.distance;
                this.controls.target.copy(this.savedCameraState.target);
                this.camera.up.copy(this.savedCameraState.cameraUp);
            } else {
                this.camera.up.set(0, 1, 0);
            }
            this.controls.update();

            if (btn) btn.textContent = '2D Map';
        }
        this.syncUrlParams();
    }

    resetCamera() {
        if (this.is2DMode) {
            // Top-down view centred on the flat map
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 120;
            this.controls.phi = 0.001;
            this.controls.theta = 0;
            this.camera.up.set(0, 0, -1);
        } else {
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 100;
            this.controls.phi = Math.PI / 2.5;
            this.controls.theta = -3.5;
            this.camera.up.set(0, 1, 0);
        }
        this.controls.update();
    }

    /** Create fallback synths for montage music — Zimmer-style: deep pad, brass, strings, sparse melody, cinematic drums, reverb. */
    montageMusicInit() {
        if (typeof Tone === 'undefined' || this.montageInstruments) return;
        try {
            const vol = new Tone.Volume(-8).toDestination();
            const reverb = new Tone.Reverb({ decay: 3.5, wet: 0.35 }).connect(vol);
            reverb.generate();

            const pad = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: 'sine' },
                envelope: { attack: 1.2, decay: 0.3, sustain: 0.8, release: 2.5 }
            }).connect(reverb);
            const sub = new Tone.MonoSynth({
                oscillator: { type: 'sine' },
                envelope: { attack: 0.8, decay: 0.2, sustain: 0.9, release: 2 }
            }).connect(reverb);
            const brass = new Tone.PolySynth(Tone.FMSynth, {
                harmonicity: 2,
                envelope: { attack: 0.5, decay: 0.2, sustain: 0.7, release: 1.8 }
            }).connect(reverb);
            const brassLow = new Tone.MonoSynth({
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.4, decay: 0.3, sustain: 0.6, release: 1.5 }
            }).connect(reverb);
            const strings = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.8, decay: 0.2, sustain: 0.7, release: 2.2 }
            }).connect(reverb);
            const melody = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: 'sine' },
                envelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.8 }
            }).connect(reverb);
            const volPattern = new Tone.Volume(-14).connect(reverb);
            const delay = new Tone.FeedbackDelay(0.28, 0.4).connect(volPattern);
            delay.wet.value = 0.2;
            const vibrato = new Tone.Vibrato(5, 0.15).connect(delay);
            const patternSynth = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: 'sine' },
                envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.8 }
            }).connect(vibrato);
            const volDrums = new Tone.Volume(-14).connect(vol);
            const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, envelope: { decay: 0.35, sustain: 0 } }).connect(volDrums);
            const impact = new Tone.NoiseSynth({ envelope: { decay: 0.4, sustain: 0 } }).connect(new Tone.Filter(120, 'lowpass').connect(volDrums));
            this.montageInstruments = { pad, sub, brass, brassLow, strings, melody, patternSynth, kick, impact };
        } catch (e) {
            console.warn('Montage music init failed:', e);
        }
    }

    /** Two alternate progressions with distinct melodies; pick by shot index (even = A, odd = B). */
    _montageMusicProgressions() {
        return {
            progressionA: {
                chords: [['A2', 'C3', 'E3'], ['F2', 'A2', 'C3'], ['C3', 'E3', 'G3'], ['G2', 'B2', 'D3'], ['E2', 'G2', 'B2']],
                heroNotes: (rootHi, thirdHi, fifthHi) => [[fifthHi, rootHi], [rootHi, thirdHi], [thirdHi, fifthHi], [fifthHi, thirdHi], [rootHi, fifthHi]],
                patternNotes: [['E4', 'G4', 'A4', 'G4', 'E4'], ['C4', 'F4', 'A4', 'F4', 'C4'], ['G4', 'E4', 'C4', 'E4', 'G4'], ['D4', 'B3', 'G3', 'B3', 'D4'], ['B4', 'G4', 'E4', 'G4', 'B4']]
            },
            progressionB: {
                chords: [['D2', 'F2', 'A2'], ['Bb2', 'D3', 'F3'], ['C2', 'E2', 'G2'], ['A2', 'C3', 'E3'], ['E2', 'G2', 'B2']],
                heroNotes: (rootHi, thirdHi, fifthHi) => [[fifthHi, thirdHi], [thirdHi, rootHi], [rootHi, fifthHi], [thirdHi, fifthHi], [fifthHi, rootHi]],
                patternNotes: [['A4', 'F4', 'D4', 'F4', 'A4'], ['F4', 'D4', 'Bb3', 'D4', 'F4'], ['G4', 'E4', 'C4', 'E4', 'G4'], ['E4', 'C4', 'A3', 'C4', 'E4'], ['B4', 'G4', 'E4', 'G4', 'B4']]
            }
        };
    }

    /** Trigger one phrase per shot — Zimmer-style: deep pad + sub, heroic brass, strings wash, sparse melody, cinematic pulse. */
    montageMusicPhrase(shot) {
        if (!this.montageMusicEnabled || typeof Tone === 'undefined' || !this.montageInstruments) return;
        try {
            const { progressionA, progressionB } = this._montageMusicProgressions();
            const idx = this.montageShotIndex % 5;
            const useB = idx % 2 === 1;
            const prog = useB ? progressionB : progressionA;
            const chord = prog.chords[idx];
            const root = chord[0], third = chord[1], fifth = chord[2];
            const rootLo = root.replace(/\d/, n => Math.max(0, Number(n) - 1));
            const rootHi = root.replace(/\d/, n => Number(n) + 2);
            const thirdHi = third.replace(/\d/, n => Number(n) + 2);
            const fifthHi = fifth.replace(/\d/, n => Number(n) + 2);
            const t = Tone.now();
            const dur = shot.holdSeconds;

            this.montageInstruments.pad.triggerAttackRelease(chord, dur, t);
            this.montageInstruments.sub.triggerAttackRelease(rootLo, dur, t);
            this.montageInstruments.brassLow.triggerAttackRelease(rootLo, dur * 0.9, t + 0.15);
            this.montageInstruments.brass.triggerAttackRelease([third, fifth], dur * 0.85, t + 0.2);
            this.montageInstruments.brass.triggerAttackRelease([thirdHi], dur * 0.5, t + 0.5);
            this.montageInstruments.strings.triggerAttackRelease([fifth, third], dur, t + 0.25);

            const heroNotes = prog.heroNotes(rootHi, thirdHi, fifthHi);
            const [a, b] = heroNotes[idx];
            this.montageInstruments.melody.triggerAttackRelease(a, dur * 0.45, t + dur * 0.15);
            this.montageInstruments.melody.triggerAttackRelease(b, dur * 0.5, t + dur * 0.5);

            const pattern = prog.patternNotes[idx];
            const step = dur / pattern.length;
            pattern.forEach((note, i) => {
                this.montageInstruments.patternSynth.triggerAttackRelease(note, step * 0.85, t + step * (i + 0.1));
            });

            this.montageInstruments.kick.triggerAttackRelease('C1', 0.4, t);
            this.montageInstruments.kick.triggerAttackRelease('C1', 0.35, t + dur * 0.5);
            this.montageInstruments.impact.triggerAttackRelease(0.25, t);
        } catch (e) {
            console.warn('Montage music phrase failed:', e);
        }
    }

    toggleMontage() {
        if (this.montageActive) {
            this.montageActive = false;
            this.updateMontageButton(false);
            this.syncUrlParams();
            return;
        }
        if (this.is2DMode) {
            return; // Montage only in 3D globe view
        }
        this.orbitTransition = null;
        this.montageActive = true;
        this.montageShotIndex = 0;
        this.montagePhaseStartTime = performance.now();
        this.montageLastTime = this.montagePhaseStartTime;
        const shot = MONTAGE_SHOTS[0];
        const zoomLim = this.zoomLimits();
        if (shot.target) {
            this.controls.target.set(shot.target[0], shot.target[1], shot.target[2]);
        } else {
            this.controls.target.set(0, 0, 0);
        }
        this.controls.distance = (shot.name === 'Horizon') ? shot.distance : Math.max(zoomLim.min, shot.distance);
        this.controls.phi = shot.phi;
        this.controls.theta = shot.theta;
        this.controls.update();
        this.updateMontageButton(true);
        if (typeof Tone !== 'undefined' && this.montageMusicEnabled) {
            Tone.start().then(() => {
                this.montageMusicInit();
                this.montageMusicPhrase(MONTAGE_SHOTS[0]);
            }).catch(() => {});
        }
        this.syncUrlParams();
    }

    updateMontageButton(active) {
        const btn = document.getElementById('toggle-montage');
        if (!btn) return;
        btn.textContent = active ? 'Stop montage' : 'Montage';
        btn.title = active ? 'Stop camera montage loop' : 'Start camera montage loop (5 shots)';
    }

    /** Stop montage when user moves camera (drag, zoom, buttons). */
    stopMontageIfActive() {
        if (this.montageActive) {
            this.montageActive = false;
            this.updateMontageButton(false);
            if (this.montageInstruments) {
                try {
                    this.montageInstruments.pad.releaseAll();
                    if (this.montageInstruments.sub) this.montageInstruments.sub.triggerRelease();
                    this.montageInstruments.brass.releaseAll();
                    if (this.montageInstruments.brassLow) this.montageInstruments.brassLow.triggerRelease();
                    this.montageInstruments.strings.releaseAll();
                    if (this.montageInstruments.melody) this.montageInstruments.melody.releaseAll();
                    if (this.montageInstruments.patternSynth) this.montageInstruments.patternSynth.releaseAll();
                } catch (e) {}
            }
            this.syncUrlParams();
        }
    }

    /** Log current orbit/camera state to console. Press L to capture a shot for MONTAGE_SHOTS. */
    logCameraState() {
        const c = this.controls;
        const pos = this.camera.position;
        console.log('——— Camera / orbit state ———');
        console.log('target:', c.target.x, c.target.y, c.target.z);
        console.log('distance:', c.distance);
        console.log('phi:', c.phi, '(rad)', (c.phi * 180 / Math.PI).toFixed(2) + '°');
        console.log('theta:', c.theta, '(rad)', (c.theta * 180 / Math.PI).toFixed(2) + '°');
        console.log('camera.position:', pos.x.toFixed(3), pos.y.toFixed(3), pos.z.toFixed(3));
        console.log('——— Paste into MONTAGE_SHOTS ———');
        console.log(
            `{ distance: ${c.distance.toFixed(2)}, phi: ${c.phi.toFixed(4)}, theta: ${c.theta.toFixed(4)} }`
        );
        console.log('(optional: phi as Math.PI)', `phi: Math.PI / ${(Math.PI / c.phi).toFixed(2)},`);
    }

    toggleCameraView() {
        const currentPosition = this.camera.position.clone();
        const currentTarget = this.controls.target.clone();
        
        if (this.isPerspective) {
            // Switch to orthographic
            const aspect = window.innerWidth / window.innerHeight;
            this.camera = new THREE.OrthographicCamera(
                this.orthographicZoom * aspect / -2,
                this.orthographicZoom * aspect / 2,
                this.orthographicZoom / 2,
                this.orthographicZoom / -2,
                0.01,
                2000
            );
            this.isPerspective = false;
        } else {
            // Switch to perspective
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 2000);
            this.isPerspective = true;
        }
        
        // Restore position and target
        this.camera.position.copy(currentPosition);
        this.controls.target.copy(currentTarget);
        this.camera.lookAt(this.controls.target);
        
        this.updateViewButton();
    }

    updateViewButton() {
        const btn = document.getElementById('toggle-view');
        if (!btn) return;
        const icon = document.getElementById('toggle-view-icon');
        // When currently perspective, offer to switch to orthographic (and vice-versa)
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
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOMContentLoaded event fired');
    
    if (typeof THREE === 'undefined') {
        console.error('❌ Three.js not loaded!');
        document.getElementById('scene').innerHTML = '<div style="color: white; padding: 20px;">Error: Three.js failed to load. Please refresh the page.</div>';
        return;
    }
    
    console.log('✅ Three.js loaded successfully, version:', THREE.REVISION);
    console.log('🎯 Creating BitcoinNetworkExplorer instance...');
    new BitcoinNetworkExplorer();
}); 