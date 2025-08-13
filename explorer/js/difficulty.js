// Bitcoin Explorer - Difficulty Adjustments Page
class BitcoinDifficultyExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.blocks = [];
        this.discs = [];
        this.isRotating = true;
        this.clock = new THREE.Clock();
        this.selectedAdjustment = null;
        this.blockData = null;
        this.isPerspective = true;
        this.orthographicZoom = 20;
        
        // Get adjustment index from URL parameter, default to epoch 0
        const urlParams = new URLSearchParams(window.location.search);
        this.selectedAdjustment = urlParams.get('adjustment') || '0';
        
        this.init();
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

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 50, 80);
        this.camera.lookAt(0, 0, 0);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupOrbitControls() {
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 20,
            phi: Math.PI / 3,
            theta: 0,
            isMouseDown: false,
            lastMouseX: 0,
            lastMouseY: 0,
            
            update: () => {
                this.camera.position.x = this.controls.target.x + this.controls.distance * Math.sin(this.controls.phi) * Math.cos(this.controls.theta);
                this.camera.position.y = this.controls.target.y + this.controls.distance * Math.cos(this.controls.phi);
                this.camera.position.z = this.controls.target.z + this.controls.distance * Math.sin(this.controls.phi) * Math.sin(this.controls.theta);
                this.camera.lookAt(this.controls.target);
            }
        };
        
        this.setupMouseControls();
        this.controls.update();
    }
    
    setupMouseControls() {
        const controls = this.controls;
        
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
        
        // Setup raycaster for tooltip
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            controls.isMouseDown = true;
            controls.lastMouseX = e.clientX;
            controls.lastMouseY = e.clientY;
            this.isRotating = false;
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            controls.isMouseDown = false;
        });
        
        this.renderer.domElement.addEventListener('mousemove', (e) => {
            // Handle tooltip
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObjects([...this.blocks, ...this.discs]);
            
            if (intersects.length > 0) {
                const object = intersects[0].object;
                
                if (object.userData && object.userData.isDisc) {
                    // Create tooltip for disc
                    const adjustmentIndex = object.userData.adjustmentIndex;
                    const isFuture = object.userData.isFuture;
                    const isPast = object.userData.isPast;
                    
                    let periodText = '';
                    if (isFuture) {
                        periodText = 'Future Period';
                    } else if (isPast) {
                        periodText = 'Previous Period';
                    }
                    
                    const tooltipContent = `
                        <strong>Difficulty Adjustment ${adjustmentIndex}</strong><br>
                        ${periodText}<br>
                        Click to navigate to epoch ${adjustmentIndex}<br>
                        Blocks: ${(adjustmentIndex * 2016).toLocaleString()} - ${((adjustmentIndex + 1) * 2016 - 1).toLocaleString()}
                    `;
                    
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 10 + 'px';
                    tooltip.style.top = e.clientY - 10 + 'px';
                } else if (object.userData && object.userData.blockInfo) {
                    // Create tooltip for block
                    const blockInfo = object.userData.blockInfo;
                    
                    // Format date from timestamp
                    const date = new Date(blockInfo.time * 1000);
                    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                    
                    // Create tooltip content
                    const tooltipContent = `
                        <strong>Block ${blockInfo.height}</strong><br>
                        Size: ${blockInfo.size.toLocaleString()} bytes<br>
                        Date: ${dateStr}<br>
                        Transactions: ${blockInfo.nTx}<br>
                        Time Difference: ${blockInfo.timeDifference}s
                    `;
                    
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 10 + 'px';
                    tooltip.style.top = e.clientY - 10 + 'px';
                }
            } else {
                tooltip.style.display = 'none';
            }
            
            // Handle camera controls
            if (controls.isMouseDown) {
                const deltaX = e.clientX - controls.lastMouseX;
                const deltaY = e.clientY - controls.lastMouseY;
                
                if (e.shiftKey) {
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
                    controls.theta += deltaX * 0.05;
                    controls.phi -= deltaY * 0.05;
                    controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, controls.phi));
                }
                
                controls.update();
                controls.lastMouseX = e.clientX;
                controls.lastMouseY = e.clientY;
            }
        });
        
        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Add double-click handler for block navigation
        this.renderer.domElement.addEventListener('dblclick', (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObjects([...this.blocks, ...this.discs]);
            
            if (intersects.length > 0) {
                const object = intersects[0].object;
                
                if (object.userData && object.userData.isDisc) {
                    // Navigate to next difficulty adjustment page
                    const adjustmentIndex = object.userData.adjustmentIndex;
                    window.location.href = `difficulty.html?adjustment=${adjustmentIndex}`;
                } else if (object.userData && object.userData.blockInfo) {
                    // Navigate to block page with block height
                    const blockInfo = object.userData.blockInfo;
                    window.location.href = `block.html?height=${blockInfo.height}`;
                }
            }
        });
        
        this.renderer.domElement.addEventListener('wheel', (e) => {
            this.isRotating = false;
            
            if (this.isPerspective) {
                // Perspective camera zoom
            controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
            controls.distance = Math.max(10, Math.min(600, controls.distance));
            controls.update();
            } else {
                // Orthographic camera zoom
                this.orthographicZoom -= e.deltaY * 0.1;
                this.orthographicZoom = Math.max(5, Math.min(100, this.orthographicZoom));
                
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
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 50, 80);
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 50;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.update();
        });
        
        // Add orthographic view toggle
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
    }

    createScene() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        if (this.selectedAdjustment !== null) {
            this.createBlockSpiral();
        }
    }

    createBlockSpiral() {
        if (!this.blockData || !this.blockData[0]) {
            console.error('No block data available');
            return;
        }
        
        const blocks = this.blockData[0];
        const blockSize = 5; // Match React Native BLOCK_SIZE
        
        // Calculate time difference range
        const minTimeDiff = Math.min(...blocks.map(block => block[8]?.time_difference || 600));
        const maxTimeDiff = Math.max(...blocks.map(block => block[8]?.time_difference || 600));
        
        console.log(`Creating ${blocks.length} blocks in spiral`);
        console.log(`Time difference range: ${minTimeDiff}s to ${maxTimeDiff}s`);
        

        
        // Exact constants from React Native implementation (scaled down 50%)
        const FACTOR_BLOCK_DISTANCE = 0.2;
        const RADIUS_SPIRAL_START = 0.4; // 50% of original
        const FACTOR_SPIRAL_GROWTH = .13;
        const BLOCK_SIZE = 0.3; // 50% of original
        const MIN_BRIGHTNESS = 20;
        const MAX_BRIGHTNESS_SIZE = 5000;
        
        // Newton-Raphson method (exact same as React Native)
        function newtonRaphson(L, k, initialGuess = 1.0, tolerance = 1e-6, maxIterations = 1000) {
            let t = initialGuess;
            
            function f(t, L, k) {
                return t ** 2 - L * k;
            }
            
            function df(t) {
                return 2 * t;
            }
            
            for (let i = 0; i < maxIterations; i++) {
                const f_t = f(t, L, k);
                const df_t = df(t);
                if (Math.abs(f_t) < tolerance) {
                    return t;
                }
                t = t - f_t / df_t;
            }
            
            throw new Error('Convergence Failed!');
        }
        
        // Initialize spiral variables (exact same as React Native)
        let phi_spiral = RADIUS_SPIRAL_START / FACTOR_SPIRAL_GROWTH;
        let arc_distance = FACTOR_SPIRAL_GROWTH * (Math.asinh(phi_spiral) + phi_spiral * Math.sqrt(phi_spiral ** 2 + 1));
        let radius_spiral = RADIUS_SPIRAL_START;
        
        // Use all 2016 blocks for complete difficulty adjustment visualization
        const maxBlocksPerSpiral = 2016; // Use all blocks
        const maxIterations = Math.min(maxBlocksPerSpiral, blocks.length);
        
        for (let i = 0; i < maxIterations; i++) {
            const block = blocks[i];
            
            // Extract data exactly like React Native expects
            // time_difference is in Block[8], not Block[7]
            const timeDifference = block[8]?.time_difference || 600;
            const size = block[5]?.size || 216; // Use actual size from data
            const time = block[1]?.time || 0; // Block timestamp
            const nTx = block[2]?.nTx || 0; // Number of transactions
            const height = block[0]?.height || i; // Block height
            

            
            // Calculate block_distance exactly like React Native
            const block_distance = i === 0 || i === maxBlocksPerSpiral - 1 ? 0 : timeDifference;
            
            arc_distance += block_distance * FACTOR_BLOCK_DISTANCE;
            
            phi_spiral = newtonRaphson(arc_distance, FACTOR_SPIRAL_GROWTH, phi_spiral);
            const radius_spiral = FACTOR_SPIRAL_GROWTH * phi_spiral;
            
            // Convert to 2D coordinates (same as React Native)
            // React Native: x = horizontal, y = vertical
            // Three.js: x = horizontal, y = vertical, z = depth
            // To make horizontal: swap x and y coordinates
            const x = radius_spiral * Math.sin(phi_spiral);  // Horizontal (was vertical)
            const z = radius_spiral * Math.cos(phi_spiral);  // Depth (was vertical)
            const y = 0; // Three.js vertical (keep flat)
            
            // Exact same brightness calculation as React Native
            const brightness = MIN_BRIGHTNESS + (size / MAX_BRIGHTNESS_SIZE) * 256;
            
            // Color based on brightness (grayscale like React Native)
            const color = new THREE.Color(brightness / 255, brightness / 255, brightness / 255);
            
            const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8
            });
            
            const blockMesh = new THREE.Mesh(geometry, material);
            blockMesh.position.set(x, y, z);
            
            // Rotate block to match spiral direction (same as React Native)
            // React Native rotates blocks to face outward from spiral center
            // Since we switched y and z, rotate around Y-axis instead of Z-axis
            blockMesh.rotation.y = phi_spiral + Math.PI / 2; // Add 90 degrees to face outward
            
            blockMesh.userData = {
                index: i,
                blockInfo: {
                    height: height,
                    timeDifference: timeDifference,
                    size: size,
                    time: time,
                    nTx: nTx
                },
                isBlock: true
            };
            
            this.scene.add(blockMesh);
            this.blocks.push(blockMesh);
            

        }
        
        // Adjust camera for better view of 2D spiral pattern
        this.camera.position.set(0, 50, 80);
        this.controls.distance = 80;
        this.controls.update();
        
        // Add 5 discs above the spiral
        this.createDiscs();
    }
    
    createDiscs() {
        const discRadius = 21; // Bigger discs
        const discThickness = 0.5; // Very thin for flat appearance
        const discSpacing = 21; // More spacing between discs
        
        // Create 5 discs above (future periods)
        const startYAbove = 21; // Start higher above the spiral
        for (let i = 0; i < 5; i++) {
            const geometry = new THREE.CylinderGeometry(discRadius, discRadius, discThickness, 32);
            
            // Gradient transparency from top (0.5) to bottom (0)
            const opacity = 0.1 - (i * 0.02); // 0.5, 0.4, 0.3, 0.2, 0.1
            
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(1, 1, 1), // White color
                transparent: true,
                opacity: opacity,
                depthWrite: false, // Fix transparency issues
                depthTest: true
            });
            
            const disc = new THREE.Mesh(geometry, material);
            disc.position.set(0, startYAbove + (i * discSpacing), 0);
            disc.rotation.x = Math.PI; // Rotate 90 degrees on x-axis
            
            // Add click data to disc (future periods)
            disc.userData = {
                isDisc: true,
                adjustmentIndex: parseInt(this.selectedAdjustment) + i + 1,
                discIndex: i,
                isFuture: true
            };
            
            // Add to scene and array
            this.scene.add(disc);
            this.discs.push(disc);
        }
        
        // Create past discs below - only show the appropriate number based on current adjustment
        if (parseInt(this.selectedAdjustment) > 0) {
            const startYBelow = -21; // Start below the spiral
            const numPastDiscs = Math.min(5, parseInt(this.selectedAdjustment)); // Show up to 5 past discs, or current adjustment number if less
            
            for (let i = 0; i < numPastDiscs; i++) {
                const geometry = new THREE.CylinderGeometry(discRadius, discRadius, discThickness, 32);
                
                // Gradient transparency from bottom (0.1) to top (0.02)
                const opacity = 0.1 - (i * 0.02); // 0.1, 0.08, 0.06, 0.04, 0.02
                
                const material = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(0.8, 0.8, 0.8), // Light gray color for past periods
                    transparent: true,
                    opacity: opacity,
                    depthWrite: false, // Fix transparency issues
                    depthTest: true
                });
                
                const disc = new THREE.Mesh(geometry, material);
                disc.position.set(0, startYBelow - (i * discSpacing), 0);
                disc.rotation.x = Math.PI; // Rotate 90 degrees on x-axis
                
                // Add click data to disc (previous periods)
                disc.userData = {
                    isDisc: true,
                    adjustmentIndex: parseInt(this.selectedAdjustment) - i - 1,
                    discIndex: i + 5,
                    isPast: true
                };
                
                // Add to scene and array
                this.scene.add(disc);
                this.discs.push(disc);
            }
        }
    }

    async fetchData() {
        this.showLoadingModal('Loading difficulty data...');
        
        try {
            this.updateLoadingProgress('Fetching epoch data...', 30);
            // Calculate the first block of the difficulty epoch
            const BLOCKS_PER_EPOCH = 2016;
            const firstBlock = parseInt(this.selectedAdjustment) * BLOCKS_PER_EPOCH;
            const fileName = `rcp_bitcoin_block_data_${firstBlock.toString().padStart(7, '0')}.json`;
            const response = await fetch(`https://pvxg.net/bitcoin_data/difficulty_epochs/${fileName}`);
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('pvxg.net API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.updateLoadingProgress('Processing block data...', 60);
            this.blockData = await response.json();
            
            this.updateLoadingProgress('Creating spiral visualization...', 80);
            this.createBlockSpiral();
            this.updateUI();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching block data:', error);
            this.showGenericError('Difficulty data');
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
        if (this.selectedAdjustment !== null) {
            // Update subtitle with adjustment period
            const subtitle = `Adjustment ${this.selectedAdjustment} • ${(parseInt(this.selectedAdjustment) * 2016).toLocaleString()} blocks`;
            document.getElementById('difficulty-subtitle').textContent = subtitle;
            
            // Update elements in the consolidated panel
            const adjustmentPeriod = document.getElementById('adjustment-period');
            const adjustmentBlocks = document.getElementById('adjustment-blocks');
            const totalAdjustments = document.getElementById('total-adjustments');
            const avgChange = document.getElementById('avg-change');
            const lastChange = document.getElementById('last-change');
            const nextExpected = document.getElementById('next-expected');
            
            if (adjustmentPeriod) {
                adjustmentPeriod.textContent = this.selectedAdjustment;
            }
            if (adjustmentBlocks) {
                adjustmentBlocks.textContent = `${(parseInt(this.selectedAdjustment) * 2016).toLocaleString()}`;
            }
            
            if (this.blockData && this.blockData[0]) {
                const blocks = this.blockData[0];
                const totalBlocks = blocks.length;
                const avgTimeDiff = blocks.reduce((sum, block) => sum + (block[8]?.time_difference || 600), 0) / totalBlocks;
                const minTimeDiff = Math.min(...blocks.map(block => block[8]?.time_difference || 600));
                const maxTimeDiff = Math.max(...blocks.map(block => block[8]?.time_difference || 600));
                
                if (totalAdjustments) {
                    totalAdjustments.textContent = `${totalBlocks} blocks`;
                }
                if (avgChange) {
                    avgChange.textContent = `${avgTimeDiff.toFixed(0)}s avg`;
                }
                if (lastChange) {
                    lastChange.textContent = `${minTimeDiff}s fastest`;
                }
                if (nextExpected) {
                    nextExpected.textContent = `${maxTimeDiff}s slowest`;
                }
            }
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const elapsedTime = this.clock.getElapsedTime();
        
        if (this.isRotating) {
            this.scene.rotation.y = elapsedTime * 0.1;
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('current-adjustment');
        
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
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        document.getElementById('scene').innerHTML = '<div style="color: white; padding: 20px;">Error: Three.js failed to load. Please refresh the page.</div>';
        return;
    }
    
    console.log('Three.js loaded successfully:', THREE.REVISION);
    new BitcoinDifficultyExplorer();
}); 