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
        this.showLabels = false;
        this.clock = new THREE.Clock();
        
        this.init();
    }

    formatDate(date) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
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
        
        // Initialize with perspective camera
        this.isPerspective = true;
        this.orthographicZoom = 20; // Store orthographic zoom level
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 30, 80);
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
            distance: 80,
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

        // Add touch controls for mobile
        this.setupTouchControls();
        
        // Add hover tooltip functionality
        this.setupHoverTooltip();
    }
    
        setupHoverTooltip() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let hoveredDisc = null;

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
                if (!intersectedObject.userData.special) { // Only handle discs, not UTXOs
                    // Reset previous hovered disc if different
                    if (hoveredDisc && hoveredDisc !== intersectedObject) {
                        this.resetDiscAppearance(hoveredDisc);
                    }

                    // Set new hovered disc
                    if (hoveredDisc !== intersectedObject) {
                        hoveredDisc = intersectedObject;
                        this.highlightDisc(hoveredDisc);
                    }

                    const index = intersectedObject.userData.index;
                    
                    // Check if it's the mempool disc
                    if (intersectedObject.userData.isMempool) {
                        tooltip.innerHTML = `Mempool<br>Double-click to view mempool`;
                    } else {
                        // Calculate block range for this difficulty adjustment period
                        const startBlock = index * 2016;
                        const endBlock = startBlock + 2015;
                        tooltip.innerHTML = `Epoch ${index}<br>Blocks ${startBlock.toLocaleString()} - ${endBlock.toLocaleString()}<br>Double-click to view details`;
                    }
                    
                    tooltip.style.display = 'block';
                    tooltip.style.left = event.clientX + 10 + 'px';
                    tooltip.style.top = event.clientY - 10 + 'px';
                } else {
                    // Reset hover state when not hovering over discs
                    if (hoveredDisc) {
                        this.resetDiscAppearance(hoveredDisc);
                        hoveredDisc = null;
                        this.resetAllDiscsOpacity();
                    }
                    tooltip.style.display = 'none';
                }
            } else {
                // Reset hover state when not hovering over any object
                if (hoveredDisc) {
                    this.resetDiscAppearance(hoveredDisc);
                    hoveredDisc = null;
                    this.resetAllDiscsOpacity();
                }
                tooltip.style.display = 'none';
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            // Reset hover state when mouse leaves the canvas
            if (hoveredDisc) {
                this.resetDiscAppearance(hoveredDisc);
                hoveredDisc = null;
                this.resetAllDiscsOpacity();
            }
            tooltip.style.display = 'none';
        });

                // Create milestone tracking tooltips array
        this.milestoneTooltips = [];
        this.createMilestoneTooltips();
        
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
                    
                    // Check if it's the mempool disc
                    if (intersectedObject.userData.isMempool) {
                        console.log(`Double-clicked on mempool disc, redirecting to mempool page...`);
                        window.location.href = `mempool.html`;
                    } else {
                        console.log(`Double-clicked on disc ${index}, redirecting to difficulty page...`);
                        
                        // Redirect to difficulty page with the disc index as URL parameter
                        window.location.href = `difficulty.html?adjustment=${index}`;
                    }
                }
            }
        });
    }

    highlightDisc(disc) {
        // Store original color if not already stored
        if (!disc.userData.originalColor) {
            disc.userData.originalColor = disc.material.color.clone();
        }
        
        // Change disc color to white
        disc.material.color.setHex(0xffffff);
        
        // Add subtle scale up effect (10% increase)
        disc.scale.set(1.1, 1.1, 1.1);
        
        // Reduce opacity of all other discs
        this.blocks.forEach(block => {
            if (!block.userData.special && block !== disc && !block.userData.isMempool) {
                block.material.transparent = true;
                block.material.opacity = 0.9;
            }
        });
    }

    resetDiscAppearance(disc) {
        // Restore original color
        if (disc.userData.originalColor) {
            disc.material.color.copy(disc.userData.originalColor);
        }
        
        // Reset scale to normal
        disc.scale.set(1, 1, 1);
    }

    resetAllDiscsOpacity() {
        // Reset opacity of all discs back to 1.0
        this.blocks.forEach(block => {
            if (!block.userData.special && !block.userData.isMempool) {
                block.material.opacity = 1.0;
                block.material.transparent = false;
            }
        });
    }

    resetCamera() {
        // Reset camera to default position, zoom, and target
        this.camera.position.set(0, 30, 80);
        this.controls.target.set(0, 0, 0);
        this.controls.distance = 80;
        this.controls.phi = Math.PI / 3;
        this.controls.theta = 0;
        this.controls.update();
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
                    this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(5, Math.min(50, this.orthographicZoom));
                    
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

    createMilestoneTooltips() {
        // Create multiple tooltips for milestone epochs
        const maxMilestones = 10; // Support up to 10 milestone tooltips
        
        for (let i = 0; i < maxMilestones; i++) {
            const tooltip = document.createElement('div');
            tooltip.style.position = 'absolute';
            tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
            tooltip.style.color = 'white';
            tooltip.style.padding = '8px 12px';
            tooltip.style.borderRadius = '3px';
            tooltip.style.fontSize = '11px';
            tooltip.style.fontFamily = 'monospace';
            tooltip.style.pointerEvents = 'none';
            tooltip.style.zIndex = '1001';
            tooltip.style.border = '1px solid #333';
            tooltip.style.display = 'none';
            tooltip.style.whiteSpace = 'pre-line';
            tooltip.style.lineHeight = '1.2';
            tooltip.style.textAlign = 'left';
            document.body.appendChild(tooltip);
            
            this.milestoneTooltips.push(tooltip);
        }
    }

    setupControls() {
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.resetCamera();
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
        
        document.getElementById('toggle-labels').addEventListener('click', () => {
            this.toggleLabels();
        });
        
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
        
        // Disc visibility slider
        const discVisibilitySlider = document.getElementById('disc-visibility-slider');
        const discVisibilityValue = document.getElementById('disc-visibility-value');
        
        if (discVisibilitySlider && discVisibilityValue) {
            discVisibilitySlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                discVisibilityValue.textContent = `${percentage}%`;
                this.updateDiscVisibility(percentage);
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
    
    toggleLabels() {
        this.showLabels = !this.showLabels;
        
        // Update button text
        const button = document.getElementById('toggle-labels');
        button.textContent = this.showLabels ? 'Hide Labels' : 'Show Labels';
        
        // Hide all milestone tooltips immediately if labels are turned off
        if (this.milestoneTooltips) {
            this.milestoneTooltips.forEach(tooltip => {
                if (!this.showLabels) {
                    tooltip.style.display = 'none';
                }
            });
        }
    }
    
    rotateLeft() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Rotate left by adjusting theta
        this.controls.theta -= 0.2; // Rotate left
        this.controls.update();
    }
    
    rotateRight() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Rotate right by adjusting theta
        this.controls.theta += 0.2; // Rotate right
        this.controls.update();
    }
    
    rotateUp() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Rotate up by adjusting phi
        this.controls.phi -= 0.2; // Rotate up
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    rotateDown() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Rotate down by adjusting phi
        this.controls.phi += 0.2; // Rotate down
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    panLeft() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Pan left by moving target
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    panRight() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Pan right by moving target
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panUp() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Pan up by moving target
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(0.5));
        this.controls.update();
    }
    
    panDown() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Pan down by moving target
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(-0.5));
        this.controls.update();
    }
    
    zoomIn() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Zoom in
        if (this.isPerspective) {
            this.controls.distance -= 2;
            this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        } else {
            this.orthographicZoom -= 1;
            this.orthographicZoom = Math.max(5, Math.min(50, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.controls.update();
    }
    
    zoomOut() {
        // Stop automatic rotation
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        // Zoom out
        if (this.isPerspective) {
            this.controls.distance += 2;
            this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        } else {
            this.orthographicZoom += 1;
            this.orthographicZoom = Math.max(5, Math.min(50, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.controls.update();
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
        const numDiscs = this.difficultyAdjustments || 104 || 104*2 || 104*3 || 104*4;
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
            const x = -radius * Math.cos(t); // Inverted X-axis direction
            const y = -(height * t) + 21; // Inverted Y-axis direction
            const z = -radius * Math.sin(t); // Inverted Z-axis direction
            
            // Calculate color based on position in the sequence
            const progress = i / (numDiscs - 1);
            const color = new THREE.Color().lerpColors(startColor, endColor, progress);
            
            // Create cylinder disc with random radius
            let randomRadius = 1.5 + Math.random() * 0.3; // Random between 1.5 and 1.8
            
            if (i === 0) {
                randomRadius = randomRadius * 1.60; 
            }
            
            // Special exception for epoch 33 - reduce radius by 33%
            if (i === 33) {
                randomRadius = randomRadius * 0.57; // Reduce by 33%
            }

            if (i === 32) {
                randomRadius = randomRadius * 0.77;
            }


            if (i === 8) {
                randomRadius = randomRadius * 1.22;
            }
            if (i === 9) {
                randomRadius = randomRadius * 1.23;
            }
            if (i === 10) {
                randomRadius = randomRadius * 1.62;
            }
            if (i === 11) {
                randomRadius = randomRadius * 1.22;
            }
            if (i === 12) {
                randomRadius = randomRadius * 1.27;
            }


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
                progress: progress,
                isMilestone: i % 104 === 0 && i > 0, // Flag for milestone epochs (multiples of 104)
                isGenesis: i === 0 // Flag for genesis block
            };
            
            this.scene.add(disc);
            this.blocks.push(disc);
        }
        
        // Add mempool disc at the end of the helix
        const mempoolT = numDiscs * 0.06057;
        const mempoolX = -radius * Math.cos(mempoolT); // Inverted X-axis direction
        const mempoolY = -(height * mempoolT) + 21; // Inverted Y-axis direction
        const mempoolZ = -radius * Math.sin(mempoolT); // Inverted Z-axis direction
        
        // Create mempool disc with distinct appearance
        const mempoolRadius = 1.8; // Slightly larger than regular discs
        const mempoolGeometry = new THREE.CylinderGeometry(mempoolRadius, mempoolRadius, discThickness, 32);
        const mempoolMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, // White color to emit light
            roughness: 0.0, // Completely smooth for maximum reflectivity
            metalness: 0.8, // High metallic for bright appearance
            emissive: 0x888888 // Much higher emissive for self-illumination
        });
        
        const mempoolDisc = new THREE.Mesh(mempoolGeometry, mempoolMaterial);
        mempoolDisc.position.set(mempoolX, mempoolY, mempoolZ);
        mempoolDisc.rotation.set(Math.PI / 2, 0, mempoolT);
        
        mempoolDisc.castShadow = false;
        mempoolDisc.receiveShadow = true;
        mempoolDisc.userData = { 
            index: numDiscs,
            t: mempoolT,
            isMempool: true // Special flag to identify mempool disc
        };
        
        this.scene.add(mempoolDisc);
        this.blocks.push(mempoolDisc);
        
        // Add a point light at the mempool disc position to make it emit light
        const mempoolLight = new THREE.PointLight(0xffffff, 3.0, 25); // White light, much higher intensity 3.0, distance 25
        mempoolLight.position.set(mempoolX, mempoolY, mempoolZ);
        mempoolLight.castShadow = true;
        mempoolLight.shadow.mapSize.width = 512;
        mempoolLight.shadow.mapSize.height = 512;
        this.scene.add(mempoolLight);
        
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
            const numDiscs = Math.floor(parseInt(height) / 2016) + 1; // Add 1 to include current period in progress
            
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
        
        // Update subtitle with height and difficulty adjustments
        const height = data.height?.toLocaleString() || '800,000';
        const adjustments = data.numDiscs?.toLocaleString() || '0';
        const subtitle = `Height ${height} • ${adjustments} difficulty adjustments`;
        document.getElementById('blockchain-subtitle').textContent = subtitle;
        
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
        
        // Update milestone tooltip position
        this.updateMilestoneTooltip();
        
        // Removed sphere animation for cleaner view
        
        // Update controls (if needed)
        // this.controls.update(); // Not needed for custom controls
        
        this.renderer.render(this.scene, this.camera);
    }

    updateMilestoneTooltip() {
        if (!this.milestoneTooltips || this.milestoneTooltips.length === 0 || !this.showLabels) return;
        
        // Find milestone discs (multiples of 104) and genesis block
        const milestoneDiscs = this.blocks.filter(block => 
            block.userData && (block.userData.isMilestone || block.userData.isGenesis) && !block.userData.special
        );
        
        // Hide all tooltips first
        this.milestoneTooltips.forEach(tooltip => {
            tooltip.style.display = 'none';
        });
        
        // Update tooltips for visible milestone discs
        let tooltipIndex = 0;
        for (const disc of milestoneDiscs) {
            if (tooltipIndex >= this.milestoneTooltips.length) break;
            
            const worldPosition = new THREE.Vector3();
            disc.getWorldPosition(worldPosition);
            
            const vector = worldPosition.clone();
            vector.project(this.camera);
            
            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
            
            // Check if the milestone is on screen
            const isOnScreen = vector.z < 1 && 
                vector.x >= -1 && vector.x <= 1 && 
                vector.y >= -1 && vector.y <= 1 &&
                x >= 0 && x <= window.innerWidth && 
                y >= 0 && y <= window.innerHeight;
            
            if (isOnScreen) {
                const tooltip = this.milestoneTooltips[tooltipIndex];
                const epochIndex = disc.userData.index;
                
                if (disc.userData.isGenesis) {
                    // Special tooltip for genesis block
                    tooltip.textContent = `Genesis\nBlock 0\nJan 3, 2009`;
                } else {
                    // Regular halving tooltip
                    const halvingNumber = Math.floor(epochIndex / 104);
                    const blockNumber = 210000 * halvingNumber;
                    
                    // Use actual halving dates
                    let halvingDate;
                    if (halvingNumber === 0) {
                        halvingDate = new Date('2009-01-03T18:15:00Z');
                    } else if (halvingNumber === 1) {
                        halvingDate = new Date('2012-11-28T00:00:00Z');
                    } else if (halvingNumber === 2) {
                        halvingDate = new Date('2016-07-09T00:00:00Z');
                    } else if (halvingNumber === 3) {
                        halvingDate = new Date('2020-05-11T00:00:00Z');
                    } else if (halvingNumber === 4) {
                        halvingDate = new Date('2024-04-20T00:00:00Z');
                    } else {
                        // For future halvings, calculate approximate date
                        const minutesSinceGenesis = blockNumber * 10;
                        const genesisDate = new Date('2009-01-03T18:15:00Z');
                        halvingDate = new Date(genesisDate.getTime() + minutesSinceGenesis * 60 * 1000);
                    }
                    
                    const dateStr = this.formatDate(halvingDate);
                    
                    tooltip.textContent = `Halving ${halvingNumber}\nBlock ${blockNumber.toLocaleString()}\n${dateStr}`;
                }
                
                // Position tooltip near the milestone disc
                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 50;
                
                const clampedX = Math.max(10, Math.min(maxX, x + 20));
                const clampedY = Math.max(10, Math.min(maxY, y - 30));
                
                tooltip.style.left = `${clampedX}px`;
                tooltip.style.top = `${clampedY}px`;
                tooltip.style.display = 'block';
                
                tooltipIndex++;
            }
        }
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
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('chain-info');
        
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

    updateDiscVisibility(percentage) {
        // Filter blocks to only include difficulty adjustment discs (exclude UTXOs)
        const difficultyDiscs = this.blocks.filter(block => 
            !block.userData.special && !block.userData.isMempool
        );
        
        // Get mempool disc separately
        const mempoolDisc = this.blocks.find(block => block.userData.isMempool);
        
        if (difficultyDiscs.length === 0) return;
        
        // Calculate how many discs to show based on percentage
        const totalDiscs = difficultyDiscs.length;
        const discsToShow = Math.floor(totalDiscs * (percentage / 100));
        
        // Show/hide discs based on their index (chronological order)
        difficultyDiscs.forEach((disc, index) => {
            if (index < discsToShow) {
                disc.visible = true;
            } else {
                disc.visible = false;
            }
        });
        
        // Show/hide mempool disc - only visible at 100%
        if (mempoolDisc) {
            mempoolDisc.visible = (percentage === 100);
        }
        
        // Update the highest visible disc number display
        const highestVisibleDiscElement = document.getElementById('highest-visible-disc');
        if (highestVisibleDiscElement) {
            if (discsToShow === 0) {
                highestVisibleDiscElement.textContent = '0';
            } else {
                // Get the epoch number from the highest visible disc
                const highestVisibleIndex = discsToShow - 1;
                const epochNumber = difficultyDiscs[highestVisibleIndex].userData.index;
                highestVisibleDiscElement.textContent = epochNumber.toLocaleString();
            }
        }
        
        console.log(`Showing ${discsToShow} of ${totalDiscs} difficulty adjustment discs (${percentage}%), mempool: ${percentage === 100}`);
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