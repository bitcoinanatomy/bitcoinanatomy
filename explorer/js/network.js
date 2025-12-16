// Bitcoin Explorer - Network Page
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
        // Create custom orbit controls
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
                    // Panning with inverted axes and reduced intensity
                    const panSpeed = 0.001; // Reduced intensity
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    
                    this.camera.getWorldDirection(new THREE.Vector3());
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    
                    const panX = deltaX * panSpeed * controls.distance;
                    const panY = deltaY * panSpeed * controls.distance; // Inverted: was -deltaY, now deltaY
                    
                    controls.target.add(right.multiplyScalar(panX));
                    controls.target.add(up.multiplyScalar(panY));
                } else {
                    // Rotation with inverted axes and reduced intensity
                    controls.theta += deltaX * 0.005; // Reduced intensity: was 0.01, now 0.005
                    controls.phi -= deltaY * 0.005; // Reduced intensity: was 0.01, now 0.005
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
            if (this.isPerspective) {
                // Perspective camera zoom
                controls.distance += e.deltaY * 0.1;
                controls.distance = Math.max(36, Math.min(200, controls.distance));
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
                    this.controls.distance = Math.max(36, Math.min(200, this.controls.distance));
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

    setupControls() {
        // Toggle rotation
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        // Reset camera
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(-100, 50, 100);
            this.camera.lookAt(0, 0, 0);
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 100;
            this.controls.phi = Math.PI / 2.5;
            this.controls.theta = -3.5;
            this.controls.update();
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
    
    setupHoverTooltip() {
        const raycaster = new THREE.Raycaster();
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
            const intersects = raycaster.intersectObjects(this.nodes);

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
            const nodeImplementation = node.userData.type;
            
            if (nodeImplementation === selectedImplementation) {
                // Highlight selected implementation with full opacity and white color
                material.opacity = 1.0;
                material.color.setHex(0xffffff);
                material.transparent = true;
            } else {
                // Reduce opacity and change to grey for others
                material.opacity = 0.3;
                material.color.setHex(0x666666);
                material.transparent = true;
            }
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
        this.scene.add(earth);
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
                btn.style.cssText = `
                    padding: 6px 12px;
                    border: 1px solid #555;
                    background: #000;
                    color: white;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                `;
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#333';
                    btn.style.borderColor = '#666';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#000';
                    btn.style.borderColor = '#555';
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
        this.connections.forEach(connection => this.scene.remove(connection));
        this.nodes = [];
        this.connections = [];
        
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
                index: i
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
        
        // Count node implementations
        const nodeImplementations = {};
        this.nodes.forEach(node => {
            const implementation = node.userData.type;
            nodeImplementations[implementation] = (nodeImplementations[implementation] || 0) + 1;
        });
        
        console.log('📊 Node implementation counts:', nodeImplementations);
        
        // Calculate total rendered nodes
        const totalRenderedNodes = this.nodes.length;
        
        // Update UI
        document.getElementById('total-nodes').textContent = totalNodes.toLocaleString();
        document.getElementById('connections').textContent = '0';
        document.getElementById('hash-rate').textContent = '450 EH/s'; // Placeholder
        document.getElementById('difficulty').textContent = '67.96 T'; // Placeholder
        
        // Update implementation counts and percentage bars
        const implementations = ['bitcoin-core', 'knots', 'bcoin', 'other'];
        implementations.forEach(impl => {
            const count = nodeImplementations[impl] || 0;
            const percentage = totalRenderedNodes > 0 ? (count / totalRenderedNodes * 100) : 0;
            
            // Update count text
            document.getElementById(impl).textContent = count.toLocaleString();
            
            // Update percentage bar
            const bar = document.getElementById(`bar-${impl}`);
            if (bar) {
                bar.style.width = `${percentage}%`;
                console.log(`  📊 ${impl}: ${count} nodes (${percentage.toFixed(1)}%)`);
            }
        });
        
        console.log('✅ UI updated with implementation counts and percentage bars');
        
        // Update subtitle with timestamp and node count
        let subtitle = `${totalNodes.toLocaleString()} nodes • ${this.formatDate(timestamp)}`;
        
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
        
        // Rotate scene (optional, can be disabled)
        if (this.isRotating) {
            this.scene.rotation.y += 0.001; // Faster rotation
        }
        
        this.renderer.render(this.scene, this.camera);
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
        if (this.isPerspective) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        } else {
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('network-info');
        
        if (toggleBtn && panelContent) {
            toggleBtn.addEventListener('click', () => {
                const isMinimized = panelContent.classList.contains('minimized');
                
                if (isMinimized) {
                    // Expand panel
                    panelContent.classList.remove('minimized');
                    toggleBtn.textContent = '−';
                    toggleBtn.title = 'Minimize';
                } else {
                    // Minimize panel
                    panelContent.classList.add('minimized');
                    toggleBtn.textContent = '+';
                    toggleBtn.title = 'Maximize';
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
        if (this.isPerspective) {
            this.controls.distance -= 2;
            this.controls.distance = Math.max(10, Math.min(200, this.controls.distance));
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
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        if (this.isPerspective) {
            this.controls.distance += 2;
            this.controls.distance = Math.max(10, Math.min(200, this.controls.distance));
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
        
        // Update the button text
        const button = document.getElementById('toggle-view');
        if (button) {
            button.textContent = this.isPerspective ? 'Orthographic' : 'Perspective';
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