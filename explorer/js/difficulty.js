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
        
        // Animation state
        this.isAnimating = false;
        this.animationTimeouts = [];
        this.currentAnimationBlock = 0;
        
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
            // Handle tooltip and hover effects
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObjects([...this.blocks, ...this.discs]);
            
            // Reset all objects to normal scale first
            [...this.blocks, ...this.discs].forEach(obj => {
                if (obj.userData.isHovered) {
                    obj.scale.set(1, 1, 1);
                    obj.userData.isHovered = false;
                }
            });
            
            if (intersects.length > 0) {
                const object = intersects[0].object;
                
                // Apply hover scale effect
                if (object.userData && (object.userData.isDisc || object.userData.isBlock)) {
                    object.scale.set(1.1, 1.1, 1.1); // Subtle 10% scale increase
                    object.userData.isHovered = true;
                }
                
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
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = monthNames[date.getMonth()];
                    const day = date.getDate();
                    const year = date.getFullYear();
                    const time = date.toTimeString().split(' ')[0]; // Gets HH:MM:SS
                    const dateStr = `${month} ${day}, ${year}, ${time}`;
                    
                    // Create tooltip content
                    const blockIndexInEpoch = object.userData.index + 1; // Convert from 0-based to 1-based index
                    const tooltipContent = `
                        <strong>Block ${blockInfo.height}</strong><br>
                        Block ${blockIndexInEpoch} of 2016<br>
                        Size: ${blockInfo.size.toLocaleString()} bytes<br>
                        Date: ${dateStr}<br>
                        Transactions: ${blockInfo.nTx}<br>
                        Time Difference: ${this.formatTimeFromSeconds(blockInfo.timeDifference)}
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
            
            // Reset all hover states and scales when mouse leaves canvas
            [...this.blocks, ...this.discs].forEach(obj => {
                if (obj.userData.isHovered) {
                    obj.scale.set(1, 1, 1);
                    obj.userData.isHovered = false;
                }
            });
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
                this.camera.position.set(0, 50, 80);
                this.controls.target.set(0, 0, 0);
                this.controls.distance = 50;
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
                
                if (this.isPerspective) {
                    this.controls.distance *= zoomFactor;
                    this.controls.distance = Math.max(10, Math.min(600, this.controls.distance));
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(5, Math.min(100, this.orthographicZoom));
                    
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
        
        // Animation buttons
        document.getElementById('animate-1000x').addEventListener('click', () => {
            this.startBlockAnimation(1000);
        });
        
        document.getElementById('animate-10000x').addEventListener('click', () => {
            this.startBlockAnimation(10000);
        });
        
        document.getElementById('animate-100000x').addEventListener('click', () => {
            this.startBlockAnimation(100000);
        });
        
        // Block visibility slider
        const blockVisibilitySlider = document.getElementById('block-visibility-slider');
        const blockVisibilityValue = document.getElementById('block-visibility-value');
        
        if (blockVisibilitySlider && blockVisibilityValue) {
            blockVisibilitySlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                blockVisibilityValue.textContent = `${percentage}%`;
                this.updateBlockVisibility(percentage);
            });
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
            let timeDifference = block[8]?.time_difference || 600;
            
            // Force time difference to 0 for block 0 (genesis block) since there's no previous block
            if (i === 0) {
                timeDifference = 0;
            }
            
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
                isBlock: true,
                isHovered: false // Initialize hover state
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
        
        // Calculate how many future discs to show based on distance from chain tip
        const selectedAdjustmentInt = parseInt(this.selectedAdjustment);
        const distanceFromTip = this.currentAdjustment ? this.currentAdjustment - selectedAdjustmentInt : 0;
        
        // Show future discs to bridge the gap between selected adjustment and current tip
        // If we're viewing adjustment 450 and current is 452, we should show discs for 451 and 452
        let numFutureDiscs = 0;
        if (distanceFromTip > 0) {
            numFutureDiscs = Math.min(5, distanceFromTip); // Show all periods up to current, max 5
        }
        
        // Debug logging
        console.log('=== DISC CREATION DEBUG ===');
        console.log('Current height:', this.currentHeight);
        console.log('Current adjustment:', this.currentAdjustment);
        console.log('Selected adjustment:', this.selectedAdjustment);
        console.log('Selected adjustment (int):', selectedAdjustmentInt);
        console.log('Distance from tip:', distanceFromTip);
        console.log('Number of future discs to show:', numFutureDiscs);
        console.log('Future discs will represent adjustments:', numFutureDiscs > 0 ? 
            `${selectedAdjustmentInt + 1} to ${selectedAdjustmentInt + numFutureDiscs}` : 'none');
        
        // Create future discs based on calculated number
        if (numFutureDiscs > 0) {
            console.log(`Creating ${numFutureDiscs} future discs...`);
            const startYAbove = 21; // Start higher above the spiral
            const futureDiscRadius = discRadius * 1.1; // 5% bigger radius for future discs
            for (let i = 0; i < numFutureDiscs; i++) {
                const geometry = new THREE.CylinderGeometry(futureDiscRadius, futureDiscRadius, discThickness, 32);
                
                // Gradient transparency from top (0.5) to bottom (0)
                const opacity = 0.1 - (i * 0.02); // 0.1, 0.08, 0.06, 0.04, 0.02
                
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
                    adjustmentIndex: selectedAdjustmentInt + i + 1,
                    discIndex: i,
                    isFuture: true,
                    isHovered: false // Initialize hover state
                };
                
                console.log(`Created future disc ${i} for adjustment ${disc.userData.adjustmentIndex}`);
                
                // Add to scene and array
                this.scene.add(disc);
                this.discs.push(disc);
            }
        } else {
            console.log('Skipping future discs - too close to chain tip');
        }
        
        // Create past discs below - only show the appropriate number based on current adjustment
        if (parseInt(this.selectedAdjustment) > 0) {
            console.log('Creating past discs...');
            const startYBelow = -21; // Start below the spiral
            const numPastDiscs = Math.min(5, parseInt(this.selectedAdjustment)); // Show up to 5 past discs, or current adjustment number if less
            const pastDiscRadius = discRadius * 1.1; // 5% bigger radius for past discs
            
            for (let i = 0; i < numPastDiscs; i++) {
                const geometry = new THREE.CylinderGeometry(pastDiscRadius, pastDiscRadius, discThickness, 32);
                
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
                    isPast: true,
                    isHovered: false // Initialize hover state
                };
                
                console.log(`Created past disc ${i} for adjustment ${disc.userData.adjustmentIndex}`);
                
                // Add to scene and array
                this.scene.add(disc);
                this.discs.push(disc);
            }
        }
        
        console.log('Total discs created:', this.discs.length);
        console.log('=== END DEBUG ===');
    }

    async fetchData() {
        this.showLoadingModal('Loading difficulty data...');
        
        try {
            this.updateLoadingProgress('Fetching epoch data...', 30);
            
            // Get current blockchain height to determine if we're at the tip
            console.log('=== FETCHING CHAIN TIP HEIGHT ===');
            const heightResponse = await fetch('https://mempool.space/api/blocks/tip/height');
            let currentHeight = 0;
            if (heightResponse.ok) {
                currentHeight = parseInt(await heightResponse.text());
                this.currentHeight = currentHeight;
                this.currentAdjustment = Math.floor(currentHeight / 2016);
                console.log('Height response OK');
                console.log('Current height:', currentHeight);
                console.log('Current adjustment calculated:', this.currentAdjustment);
            } else {
                console.log('Height response failed:', heightResponse.status);
            }
            
            // Calculate the first block of the difficulty epoch
            const BLOCKS_PER_EPOCH = 2016;
            const firstBlock = parseInt(this.selectedAdjustment) * BLOCKS_PER_EPOCH;
            console.log('Selected adjustment from URL:', this.selectedAdjustment);
            console.log('First block for epoch:', firstBlock);
            console.log('=== END HEIGHT FETCH DEBUG ===');
            
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

    formatTimeFromSeconds(seconds) {
        const roundedSeconds = Math.round(seconds);
        const days = Math.floor(roundedSeconds / 86400);
        const hours = Math.floor((roundedSeconds % 86400) / 3600);
        const minutes = Math.floor((roundedSeconds % 3600) / 60);
        const remainingSeconds = roundedSeconds % 60;
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            return `${remainingSeconds}s`;
        }
    }

    formatDateOnly(date) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }

    updateUI(data) {
        if (this.selectedAdjustment !== null) {
            // Calculate block range for this difficulty adjustment period
            const epochNumber = parseInt(this.selectedAdjustment);
            const startBlock = epochNumber * 2016;
            const endBlock = startBlock + 2015;
            
            // Update subtitle with adjustment period and block range
            const subtitle = `Adjustment ${this.selectedAdjustment} • Blocks ${startBlock.toLocaleString()} - ${endBlock.toLocaleString()}`;
            document.getElementById('difficulty-subtitle').textContent = subtitle;
            
            // Update elements in the consolidated panel
            const adjustmentPeriod = document.getElementById('adjustment-period');
            const blockRange = document.getElementById('block-range');
            const startDate = document.getElementById('start-date');
            const endDate = document.getElementById('end-date');
            const avgChange = document.getElementById('avg-change');
            const lastChange = document.getElementById('last-change');
            const nextExpected = document.getElementById('next-expected');
            
            if (adjustmentPeriod) {
                adjustmentPeriod.textContent = this.selectedAdjustment;
            }
            if (blockRange) {
                blockRange.textContent = `${startBlock.toLocaleString()} - ${endBlock.toLocaleString()}`;
            }
            
            if (this.blockData && this.blockData[0]) {
                const blocks = this.blockData[0];
                
                // Get start and end dates from first and last blocks
                if (startDate && blocks.length > 0) {
                    const firstBlockTimestamp = blocks[0][1]?.time || 0;
                    const firstBlockDate = new Date(firstBlockTimestamp * 1000);
                    startDate.textContent = this.formatDateOnly(firstBlockDate);
                }
                
                if (endDate && blocks.length > 0) {
                    const lastBlockTimestamp = blocks[blocks.length - 1][1]?.time || 0;
                    const lastBlockDate = new Date(lastBlockTimestamp * 1000);
                    endDate.textContent = this.formatDateOnly(lastBlockDate);
                }
                
                const totalBlocks = blocks.length;
                
                // Calculate time differences, excluding block 0 (genesis block)
                const timeDifferences = blocks.map((block, index) => {
                    if (index === 0) {
                        return 0; // Force block 0 to have 0 time difference
                    }
                    return block[8]?.time_difference || 600;
                });
                
                // Debug: log some time differences to understand the data
                console.log('Time differences sample:', timeDifferences.slice(0, 10));
                console.log('Min time diff before filtering:', Math.min(...timeDifferences));
                console.log('Max time diff before filtering:', Math.max(...timeDifferences));
                
                // For average, include all blocks (including block 0 with time diff 0)
                const avgTimeDiff = timeDifferences.reduce((sum, time) => sum + time, 0) / totalBlocks;
                
                // For min/max, exclude block 0 and handle negative values
                const timeDifferencesExcludingGenesis = timeDifferences.filter((_, index) => index !== 0);
                
                // Filter out negative values for min/max calculations since negative time differences
                // represent clock irregularities and aren't meaningful for "fastest/slowest" block times
                const validTimeDifferences = timeDifferencesExcludingGenesis.filter(time => time > 0);
                
                const minTimeDiff = validTimeDifferences.length > 0 ? Math.min(...validTimeDifferences) : 0;
                const maxTimeDiff = validTimeDifferences.length > 0 ? Math.max(...validTimeDifferences) : 0;
                
                console.log('Valid time differences count:', validTimeDifferences.length);
                console.log('Final min time diff:', minTimeDiff);
                console.log('Final max time diff:', maxTimeDiff);
                
                if (avgChange) {
                    avgChange.textContent = `${this.formatTimeFromSeconds(avgTimeDiff)}`;
                }
                if (lastChange) {
                    lastChange.textContent = `${this.formatTimeFromSeconds(minTimeDiff)}`;
                }
                if (nextExpected) {
                    nextExpected.textContent = `${this.formatTimeFromSeconds(maxTimeDiff)}`;
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
        
        // Update disc opacity based on camera angle
        this.updateDiscOpacity();
        
        this.renderer.render(this.scene, this.camera);
    }
    
    updateDiscOpacity() {
        // Calculate camera tilt angle in degrees
        const phi = this.controls.phi;
        const phiDegrees = phi * (180 / Math.PI);
        
        // Calculate fade factor based on camera tilt
        // Fade starts at 45 degrees and is complete at 30 degrees (up) and 150 degrees (down)
        // Scale starts at 65 degrees and goes to zero at 30 degrees (up) and 150 degrees (down)
        let fadeOpacity = 1.0;
        let scaleValue = 1.0;
        
        const fadeStartAngle = 60; // Start fading at 45 degrees
        const scaleStartAngle = 40; // Start scaling down at 65 degrees
        const maxAngle = 30; // Completely faded/scaled at 30 degrees (looking up)
        const maxAngleDown = 150; // Completely faded/scaled at 150 degrees (looking down)
        
        if (phiDegrees < fadeStartAngle) {
            // Looking up - fade based on how much below 45 degrees
            const fadeRange = fadeStartAngle - maxAngle; // 15 degrees
            const fadeAmount = Math.max(0, fadeStartAngle - phiDegrees) / fadeRange;
            fadeOpacity = Math.max(0, 1 - fadeAmount);
            
            // Scale down starting at 65 degrees
            if (phiDegrees < scaleStartAngle) {
                const scaleRange = scaleStartAngle - maxAngle; // 35 degrees
                const scaleAmount = Math.max(0, scaleStartAngle - phiDegrees) / scaleRange;
                scaleValue = Math.max(0, 1 - scaleAmount);
            }
        } else if (phiDegrees > (180 - fadeStartAngle)) {
            // Looking down - fade based on how much above 135 degrees
            const fadeRange = maxAngleDown - (180 - fadeStartAngle); // 15 degrees
            const fadeAmount = Math.max(0, phiDegrees - (180 - fadeStartAngle)) / fadeRange;
            fadeOpacity = Math.max(0, 1 - fadeAmount);
            
            // Scale down starting at 115 degrees (180 - 65)
            if (phiDegrees > (180 - scaleStartAngle)) {
                const scaleRange = maxAngleDown - (180 - scaleStartAngle); // 35 degrees
                const scaleAmount = Math.max(0, phiDegrees - (180 - scaleStartAngle)) / scaleRange;
                scaleValue = Math.max(0, 1 - scaleAmount);
            }
        }
        
        // Apply fade opacity and scale to all discs
        this.discs.forEach(disc => {
            if (disc.material) {
                // Store original opacity if not already stored
                if (disc.userData.originalOpacity === undefined) {
                    disc.userData.originalOpacity = disc.material.opacity;
                }
                
                // Apply fade while preserving original opacity differences
                disc.material.opacity = disc.userData.originalOpacity * fadeOpacity;
                disc.material.transparent = true;
                
                // Apply scale (only if not currently being hovered for manual scaling)
                if (!disc.userData.isHovered) {
                    disc.scale.set(scaleValue, scaleValue, scaleValue);
                }
            }
        });
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

    updateBlockVisibility(percentage) {
        if (this.blocks.length === 0) return;
        
        // Calculate how many blocks to show based on percentage
        const totalBlocks = this.blocks.length;
        const blocksToShow = Math.floor(totalBlocks * (percentage / 100));
        
        // Show/hide blocks based on their index
        this.blocks.forEach((block, index) => {
            if (index < blocksToShow) {
                block.visible = true;
            } else {
                block.visible = false;
            }
        });
        
        // Update the highest visible block number display
        const highestVisibleBlockElement = document.getElementById('highest-visible-block');
        if (highestVisibleBlockElement) {
            if (blocksToShow === 0) {
                highestVisibleBlockElement.textContent = '0';
            } else {
                // Get the actual block height from the highest visible block
                const highestVisibleIndex = blocksToShow - 1;
                if (this.blockData && this.blockData[0] && this.blockData[0][highestVisibleIndex]) {
                    const blockHeight = this.blockData[0][highestVisibleIndex][0]?.height || (highestVisibleIndex + 1);
                    highestVisibleBlockElement.textContent = blockHeight.toLocaleString();
                } else {
                    // Fallback: use block index + 1 as approximate block number
                    highestVisibleBlockElement.textContent = (highestVisibleIndex + 1).toLocaleString();
                }
            }
        }
        
        console.log(`Showing ${blocksToShow} of ${totalBlocks} blocks (${percentage}%)`);
    }

    startBlockAnimation(speed = 1000) {
        if (this.isAnimating) {
            this.stopBlockAnimation();
            return;
        }
        
        if (this.blocks.length === 0) return;
        
        console.log(`Starting block animation at ${speed}x speed...`);
        this.isAnimating = true;
        this.currentAnimationBlock = 0;
        this.animationSpeed = speed; // Store current speed
        
        // Update button states
        const button1000x = document.getElementById('animate-1000x');
        const button10000x = document.getElementById('animate-10000x');
        const button100000x = document.getElementById('animate-100000x');
        
        if (button1000x && button10000x && button100000x) {
            if (speed === 1000) {
                button1000x.textContent = 'Stop';
                button1000x.style.background = '#666';
                button10000x.textContent = '10000x';
                button10000x.style.background = '#333';
                button100000x.textContent = '100000x';
                button100000x.style.background = '#333';
            } else if (speed === 10000) {
                button10000x.textContent = 'Stop';
                button10000x.style.background = '#666';
                button1000x.textContent = '1000x';
                button1000x.style.background = '#333';
                button100000x.textContent = '100000x';
                button100000x.style.background = '#333';
            } else { // speed === 100000
                button100000x.textContent = 'Stop';
                button100000x.style.background = '#666';
                button1000x.textContent = '1000x';
                button1000x.style.background = '#333';
                button10000x.textContent = '10000x';
                button10000x.style.background = '#333';
            }
        }
        
        // Hide all blocks initially
        this.blocks.forEach(block => {
            block.visible = false;
        });
        
        // Reset block visibility slider to 0%
        const slider = document.getElementById('block-visibility-slider');
        const sliderValue = document.getElementById('block-visibility-value');
        if (slider && sliderValue) {
            slider.value = 0;
            sliderValue.textContent = '0%';
        }
        
        // Start the animation sequence
        this.animateNextBlock(speed);
    }
    
    stopBlockAnimation() {
        console.log('Stopping block animation...');
        this.isAnimating = false;
        
        // Clear all pending timeouts
        this.animationTimeouts.forEach(timeout => clearTimeout(timeout));
        this.animationTimeouts = [];
        
        // Update button text
        const button1000x = document.getElementById('animate-1000x');
        const button10000x = document.getElementById('animate-10000x');
        const button100000x = document.getElementById('animate-100000x');
        
        if (button1000x && button10000x && button100000x) {
            button1000x.textContent = '1000x';
            button1000x.style.background = '#333';
            button10000x.textContent = '10000x';
            button10000x.style.background = '#333';
            button100000x.textContent = '100000x';
            button100000x.style.background = '#333';
        }
        
        // Show all blocks
        this.blocks.forEach(block => {
            block.visible = true;
        });
        
        // Reset block visibility slider to 100%
        const slider = document.getElementById('block-visibility-slider');
        const sliderValue = document.getElementById('block-visibility-value');
        const highestVisibleBlockElement = document.getElementById('highest-visible-block');
        
        if (slider && sliderValue) {
            slider.value = 100;
            sliderValue.textContent = '100%';
        }
        
        // Reset highest visible block to maximum
        if (highestVisibleBlockElement && this.blockData && this.blockData[0] && this.blockData[0].length > 0) {
            const lastBlockIndex = this.blockData[0].length - 1;
            const lastBlockHeight = this.blockData[0][lastBlockIndex][0]?.height || this.blockData[0].length;
            highestVisibleBlockElement.textContent = lastBlockHeight.toLocaleString();
        }
    }
    
    animateNextBlock(speed = 1000) {
        if (!this.isAnimating || this.currentAnimationBlock >= this.blocks.length) {
            // Animation complete
            this.stopBlockAnimation();
            return;
        }
        
        // Show current block
        const currentBlock = this.blocks[this.currentAnimationBlock];
        if (currentBlock) {
            currentBlock.visible = true;
            
            // Update slider to reflect current progress
            const progress = ((this.currentAnimationBlock + 1) / this.blocks.length) * 100;
            const slider = document.getElementById('block-visibility-slider');
            const sliderValue = document.getElementById('block-visibility-value');
            const highestVisibleBlockElement = document.getElementById('highest-visible-block');
            
            if (slider && sliderValue) {
                slider.value = Math.floor(progress);
                sliderValue.textContent = `${Math.floor(progress)}%`;
            }
            
            // Update highest visible block number
            if (highestVisibleBlockElement && this.blockData && this.blockData[0] && this.blockData[0][this.currentAnimationBlock]) {
                const blockHeight = this.blockData[0][this.currentAnimationBlock][0]?.height || (this.currentAnimationBlock + 1);
                highestVisibleBlockElement.textContent = blockHeight.toLocaleString();
            }
            
            console.log(`Showing block ${this.currentAnimationBlock + 1}/${this.blocks.length}`);
        }
        
        // Calculate delay for next block based on time difference
        let delayMs = 600; // Default 10 minutes in seconds
        
        if (this.blockData && this.blockData[0] && this.blockData[0][this.currentAnimationBlock]) {
            const blockData = this.blockData[0][this.currentAnimationBlock];
            let timeDifference = blockData[8]?.time_difference || 600;
            
            // Force time difference to 0 for block 0 (genesis block)
            if (this.currentAnimationBlock === 0) {
                timeDifference = 0;
            }
            
            // Handle negative time differences (treat as small positive value)
            if (timeDifference < 0) {
                timeDifference = Math.abs(timeDifference);
            }
            
            // Scale time difference based on speed: actual seconds / speed = animation milliseconds
            if (speed === 100000) {
                delayMs = Math.max(1, timeDifference / 100); // 100000x speed
            } else if (speed === 10000) {
                delayMs = Math.max(1, timeDifference / 10); // 10000x speed
            } else { // speed === 1000
                delayMs = Math.max(1, timeDifference); // 1000x speed
            }
        }
        
        console.log(`Next block delay: ${delayMs}ms (${speed}x speed)`);
        
        // Move to next block
        this.currentAnimationBlock++;
        
        // Schedule next block animation
        const timeout = setTimeout(() => {
            this.animateNextBlock(speed);
        }, delayMs);
        
        this.animationTimeouts.push(timeout);
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