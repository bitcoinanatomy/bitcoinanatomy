// Bitcoin Explorer - Network Page
class BitcoinNetworkExplorer {
    constructor() {
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
        this.isPerspective = true;
        this.orthographicZoom = 100;
        
        this.init();
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
        this.setupThreeJS();
        this.setupOrbitControls();
        this.setupControls();
        this.setupPanelToggle();
        this.createScene();
        this.animate();
        this.fetchData();
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
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
        if (!this.nodeData || !this.nodeData.nodes) return;
        
        // Clear existing nodes and connections
        this.nodes.forEach(node => this.scene.remove(node));
        this.connections.forEach(connection => this.scene.remove(connection));
        this.nodes = [];
        this.connections = [];
        
        const nodes = this.nodeData.nodes;
        const nodeEntries = Object.entries(nodes);
        
        console.log(`Creating ${nodeEntries.length} nodes`);
        
        // Process each node
        nodeEntries.forEach(([address, nodeInfo], index) => {
            const [version, userAgent, timestamp, height, latestHeight, hostname, city, country, lat, lng, timezone, asn, org] = nodeInfo;
            
            // Determine node implementation based on user agent
            const nodeImplementation = this.getNodeType(userAgent);
            const nodeColor = this.getNodeColor(nodeImplementation);
            const nodeSize = this.getNodeSize(nodeImplementation);
            
            // Calculate position
            let x, y, z;
            
            if (lat !== null && lng !== null && lat !== 0.0 && lng !== 0.0) {
                // Convert lat/lng to 3D position on sphere
                const radius = 33.1; // Slightly larger than Earth
                const phi = (90 - lat) * (Math.PI / 180);
                const theta = (-lng + 180) * (Math.PI / 180); // Inverted longitude
                
                x = radius * Math.sin(phi) * Math.cos(theta);
                y = radius * Math.cos(phi);
                z = radius * Math.sin(phi) * Math.sin(theta);
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
            }
            
            // Create node geometry with reduced complexity
            const geometry = new THREE.SphereGeometry(nodeSize, 6, 6);
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
                index: index
            };
            
            this.scene.add(node);
            this.nodes.push(node);
        });
        
        console.log(`Created ${this.nodes.length} nodes`);
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

    async fetchData() {
        this.showLoadingModal('Loading network data...');
        
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
                this.latestSnapshot = snapshotsData.results[0];
                
                // Fetch the detailed snapshot data
                this.updateLoadingProgress('Loading node data...', 60);
                const snapshotResponse = await fetch(this.latestSnapshot.url);
                
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
                console.log('Fetched node data:', this.nodeData);
                this.createNetworkVisualization();
                this.updateUI();
                
                this.updateLoadingProgress('Complete!', 100);
                setTimeout(() => {
                    this.hideLoadingModal();
                }, 500);
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
        if (!this.nodeData) return;
        
        const totalNodes = this.nodeData.total_nodes;
        const latestHeight = this.nodeData.latest_height;
        const timestamp = new Date(this.nodeData.timestamp * 1000);
        
        // Count node implementations
        const nodeImplementations = {};
        this.nodes.forEach(node => {
            const implementation = node.userData.type;
            nodeImplementations[implementation] = (nodeImplementations[implementation] || 0) + 1;
        });
        
        // Update UI
        document.getElementById('total-nodes').textContent = totalNodes.toLocaleString();
        document.getElementById('connections').textContent = '0';
        document.getElementById('hash-rate').textContent = '450 EH/s'; // Placeholder
        document.getElementById('difficulty').textContent = '67.96 T'; // Placeholder
        
        // Update implementation counts
        document.getElementById('bitcoin-core').textContent = (nodeImplementations['bitcoin-core'] || 0).toLocaleString();
        document.getElementById('other').textContent = (nodeImplementations['other'] || 0).toLocaleString();
        document.getElementById('knots').textContent = (nodeImplementations['knots'] || 0).toLocaleString();
        document.getElementById('bcoin').textContent = (nodeImplementations['bcoin'] || 0).toLocaleString();
        
        // Update subtitle with timestamp and node count
        const subtitle = `${totalNodes.toLocaleString()} nodes • ${this.formatDate(timestamp)}`;
        document.getElementById('network-subtitle').textContent = subtitle;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Rotate scene (optional, can be disabled)
        if (this.isRotating) {
            this.scene.rotation.y += 0.001; // Faster rotation
        }
        
        this.renderer.render(this.scene, this.camera);
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
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        document.getElementById('scene').innerHTML = '<div style="color: white; padding: 20px;">Error: Three.js failed to load. Please refresh the page.</div>';
        return;
    }
    
    console.log('Three.js loaded successfully:', THREE.REVISION);
    new BitcoinNetworkExplorer();
}); 