// Bitcoin Explorer - Blockchain Page
class BitcoinBlockchainExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.blocks = [];
        this.isRotating = true;
        this.showUTXOs = false;
        this.clock = new THREE.Clock();
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupOrbitControls();
        this.setupControls();
        this.createScene();
        this.animate();
        this.fetchData();
        
        setInterval(() => this.fetchData(), 30000);
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Initialize with perspective camera
        this.isPerspective = true;
        this.orthographicZoom = 20; // Store orthographic zoom level
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 30, 50);
        this.camera.lookAt(0, 0, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupOrbitControls() {
        // Create custom orbit controls
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 50,
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
                controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
                controls.distance = Math.max(10, Math.min(100, controls.distance));
                controls.update();
            } else {
                // Orthographic camera zoom
                const zoomSpeed = 0.1;
                this.orthographicZoom -= e.deltaY * zoomSpeed; // Inverted: was +=, now -=
                this.orthographicZoom = Math.max(5, Math.min(50, this.orthographicZoom));
                
                const aspect = window.innerWidth / window.innerHeight;
                this.camera.left = -this.orthographicZoom * aspect / 2;
                this.camera.right = this.orthographicZoom * aspect / 2;
                this.camera.top = this.orthographicZoom / 2;
                this.camera.bottom = -this.orthographicZoom / 2;
                this.camera.updateProjectionMatrix();
            }
        });
        
        // Add hover tooltip functionality
        this.setupHoverTooltip();
    }
    
        setupHoverTooltip() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.style.position = 'absolute';
        tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '5px 10px';
        tooltip.style.borderRadius = '3px';
        tooltip.style.fontSize = '12px';
        tooltip.style.fontFamily = 'monospace';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '1000';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);

        this.renderer.domElement.addEventListener('mousemove', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.blocks);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                if (!intersectedObject.userData.special) { // Only show tooltip for discs, not UTXOs
                    const index = intersectedObject.userData.index;
                    tooltip.textContent = `Disc ${index} (Double-click to view details)`;
                    tooltip.style.display = 'block';
                    tooltip.style.left = event.clientX + 10 + 'px';
                    tooltip.style.top = event.clientY - 10 + 'px';
                } else {
                    tooltip.style.display = 'none';
                }
            } else {
                tooltip.style.display = 'none';
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });

        // Add double-click handler for discs
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.blocks);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                if (!intersectedObject.userData.special) { // Only handle clicks on discs, not UTXOs
                    const index = intersectedObject.userData.index;
                    console.log(`Double-clicked on disc ${index}, redirecting to difficulty page...`);
                    
                    // Redirect to difficulty page with the disc index as URL parameter
                    window.location.href = `difficulty.html?adjustment=${index}`;
                }
            }
        });
    }

    setupControls() {
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            // Reset camera to default position, zoom, and target
            this.camera.position.set(0, 30, 50);
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 50;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.update();
        });
        
        document.getElementById('toggle-utxos').addEventListener('click', () => {
            this.showUTXOs = !this.showUTXOs;
            const button = document.getElementById('toggle-utxos');
            button.textContent = this.showUTXOs ? 'Hide UTXOs' : 'Show UTXOs';
            
            if (this.showUTXOs) {
                // Create spheres when showing UTXOs
                this.createUTXOs();
            } else {
                // Remove spheres when hiding UTXOs
                this.removeUTXOs();
            }
        });
        
        document.getElementById('toggle-view').addEventListener('click', () => {
            this.toggleCameraView();
        });
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
                0.1,
                1000
            );
            this.isPerspective = false;
        } else {
            // Switch to perspective
            this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
            this.isPerspective = true;
        }
        
        // Restore position and target
        this.camera.position.copy(currentPosition);
        this.controls.target.copy(currentTarget);
        this.camera.lookAt(this.controls.target);
        
        // Update the button text
        const button = document.getElementById('toggle-view');
        button.textContent = this.isPerspective ? 'Orthographic' : 'Perspective';
        
                // Update controls to use new camera
        this.setupMouseControls();
    }
    
    createUTXOs() {
        if (!this.sphereData) return;
        
        // Create spheres for UTXOs
        this.sphereData.forEach((sphereData, idx) => {
            const discIndex = sphereData.index;
            if (discIndex < this.blocks.length) {
                const discPos = this.blocks[discIndex].position;
                const t = discIndex * 0.05;
                
                // Calculate offset in the rotated coordinate system
                const offsetX = Math.cos(t) * 3;
                const offsetY = Math.sin(t) * 3; // Changed from offsetZ to offsetY for X-rotation
                
                const sphereGeometry = new THREE.SphereGeometry(sphereData.size, 32, 32);
                const sphereMaterial = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.5,
                    metalness: 0.1,
                    transparent: true,
                    opacity: 0.8
                });
                
                const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
                sphereMesh.position.set(
                    discPos.x + offsetX,
                    discPos.y + offsetY,
                    discPos.z
                );
                
                sphereMesh.castShadow = false;
                sphereMesh.userData = { special: true, size: sphereData.size };
                
                this.scene.add(sphereMesh);
                this.blocks.push(sphereMesh);
            }
        });
        
        console.log('Created UTXO spheres');
    }
    
    removeUTXOs() {
        // Remove all spheres (UTXOs) from scene and blocks array
        this.blocks = this.blocks.filter(block => {
            if (block.userData.special) {
                this.scene.remove(block);
                return false; // Remove from blocks array
            }
            return true; // Keep non-sphere blocks
        });
        
        console.log('Removed UTXO spheres');
    }
    
    updateVisualization() {
        if (!this.difficultyAdjustments) return;
        
        // Clear existing helix discs (but keep UTXOs if they exist)
        this.blocks = this.blocks.filter(block => {
            if (!block.userData.special) {
                this.scene.remove(block);
                return false;
            }
            return true;
        });
        
        // Recreate helix with difficulty adjustments count
        this.createBlockchainVisualization();
        
        console.log(`Updated visualization with ${this.difficultyAdjustments} discs (each representing 2016 blocks)`);
    }
    
    createScene() {
        // Add lighting for shadows
        const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        // Add fill lights for softer illumination
        const fillLight1 = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight1.position.set(-10, -10, -5);
        this.scene.add(fillLight1);
        
        const fillLight2 = new THREE.DirectionalLight(0xffffff, 0.2);
        fillLight2.position.set(0, 20, 0);
        this.scene.add(fillLight2);
        
        const fillLight3 = new THREE.DirectionalLight(0xffffff, 0.15);
        fillLight3.position.set(0, -20, 0);
        this.scene.add(fillLight3);
        
        // Grid hidden for cleaner look
        // const gridHelper = new THREE.GridHelper(100, 100, 0x333333, 0x222222);
        // this.scene.add(gridHelper);
        
        this.createBlockchainVisualization();
    }

    createBlockchainVisualization() {
        const radius = 5;
        const height = 1.5;
        const numDiscs = this.difficultyAdjustments || 104; // Use difficulty adjustments count (each disc = 2016 blocks)
        const discThickness = 0.05;
        // const discRadius = 1.7; // Removed fixed radius
        
        // Color gradient parameters
        const startColor = new THREE.Color(0x555555); // Grey
        const endColor = new THREE.Color(0xffffff); // White
        
        // Special sphere indices for highlighting important blocks
        const specialSpheres = [
            { index: 50, size: 0.5 + Math.random() * 1.0 },
            { index: 75, size: 0.7 + Math.random() * 2.2 },
            { index: 100, size: 0.4 + Math.random() * 0.8 },
            { index: 125, size: 0.4 + Math.random() * 0.8 },
            { index: 150, size: 1.4 + Math.random() * 1.8 },
            { index: 175, size: 2.4 + Math.random() * 2.8 },
        ];
        
        console.log('Creating blockchain visualization with', numDiscs, 'discs');
        
        // Generate disc positions along the helix
        for (let i = 0; i < numDiscs; i++) {
            const t = i * 0.06057;
            const x = radius * Math.cos(t);
            const y = height * t - 21; // Translate 20 units in Y-axis
            const z = radius * Math.sin(t);
            
            // Calculate color based on position in the sequence
            const progress = i / (numDiscs - 1);
            const color = new THREE.Color().lerpColors(startColor, endColor, progress);
            
            // Create cylinder disc with random radius
            const randomRadius = 1.5 + Math.random() * 0.3; // Random between 1.5 and 1.8
            const geometry = new THREE.CylinderGeometry(randomRadius, randomRadius, discThickness, 32);
            const material = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.8,
                metalness: 0.0
            });
            
            const disc = new THREE.Mesh(geometry, material);
            disc.position.set(x, y, z);
            disc.rotation.set(Math.PI / 2, 0, t);
            
            disc.castShadow = false;
            disc.receiveShadow = true;
            disc.userData = { 
                index: i, 
                t: t,
                progress: progress
            };
            
            this.scene.add(disc);
            this.blocks.push(disc);
        }
        
        // Rotate the entire helix 90 degrees around X-axis
        this.blocks.forEach(block => {
            if (!block.userData.special) { // Only rotate helix discs, not UTXOs
                const originalPosition = block.position.clone();
                const rotationMatrix = new THREE.Matrix4();
                rotationMatrix.makeRotationX(Math.PI / 2); // 90 degrees
                originalPosition.applyMatrix4(rotationMatrix);
                block.position.copy(originalPosition);
                
                // Adjust the disc's rotation to maintain proper orientation
                block.rotation.x += Math.PI / 2;
            }
        });
        
        // Store sphere data for later creation
        this.sphereData = specialSpheres;
        
        console.log('Created', this.blocks.length, 'total objects');
    }

    async fetchData() {
        this.showLoadingModal('Loading blockchain data...');
        
        try {
            this.updateLoadingProgress('Fetching current height...', 30);
            const response = await fetch('https://mempool.space/api/blocks/tip/height');
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.updateLoadingProgress('Processing data...', 70);
            const height = await response.text();
            const numDiscs = Math.floor(parseInt(height) / 2016);
            
            console.log('Current height:', height);
            console.log('Difficulty adjustments:', numDiscs);
            
            this.updateLoadingProgress('Creating visualization...', 90);
            this.updateUI({ height: height, numDiscs: numDiscs });
            this.updateVisualization();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching blockchain data:', error);
            this.showGenericError('Blockchain data');
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

    updateUI(data) {
        // Store the difficulty adjustments count for visualization
        this.difficultyAdjustments = data.numDiscs;
        
        // Display current height from Mempool.space
        document.getElementById('chain-height').textContent = data.height?.toLocaleString() || '800,000';
        document.getElementById('chain-size').textContent = '450 GB';
        document.getElementById('chain-difficulty').textContent = '67.96 T';
        document.getElementById('chain-hashrate').textContent = '450 EH/s';
        
        // Display difficulty adjustment information
        document.getElementById('last-block').textContent = data.hash?.substring(0, 16) + '...' || '0000...abcd';
        document.getElementById('avg-block-time').textContent = '10.2 min';
        document.getElementById('total-transactions').textContent = data.numDiscs?.toLocaleString() || '0';
        document.getElementById('chain-work').textContent = '1.2 Z';
        
        // Log the calculated values
        if (data.height && data.numDiscs) {
            console.log(`Current height: ${data.height.toLocaleString()}`);
            console.log(`Difficulty adjustments: ${data.numDiscs.toLocaleString()}`);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const elapsedTime = this.clock.getElapsedTime();
        
        if (this.isRotating) {
            this.scene.rotation.y = elapsedTime * 0.1;
        }
        
        // Removed sphere animation for cleaner view
        
        // Update controls (if needed)
        // this.controls.update(); // Not needed for custom controls
        
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
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
}

document.addEventListener('DOMContentLoaded', () => {
    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded! Please check the CDN link.');
        document.getElementById('scene').innerHTML = '<div style="color: white; padding: 20px;">Error: Three.js failed to load. Please refresh the page.</div>';
        return;
    }
    
    console.log('Three.js loaded successfully:', THREE.REVISION);
    new BitcoinBlockchainExplorer();
}); 