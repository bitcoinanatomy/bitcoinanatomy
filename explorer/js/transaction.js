// Bitcoin Explorer - Transaction Page
class BitcoinTransactionExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isRotating = true;
        this.controls = {
            distance: 130,
            phi: Math.PI /2,
            theta: 1,
            target: new THREE.Vector3(0, 0, 0),
            panX: 0,
            panY: 0,
            panZ: 0
        };
        this.isPerspective = true; // Track camera type
        this.orthographicZoom = 20; // Store orthographic zoom level
        this.transactionData = null;
        this.txid = null;
        
        // Gradient texture cache for cylinders
        this.cylinderGradientTexture = null;
        this.outputCylinderGradientTexture = null;
        
        // Get transaction ID from URL parameter, or use default
        const urlParams = new URLSearchParams(window.location.search);
        this.txid = urlParams.get('txid') || 'ce6b90e54ee8bc231f694e2abfac140e8c7a0900e4726088f0ed3ea54a0f3d10';
        
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
        // Prepare gradient texture for cylinders
        this.cylinderGradientTexture = this.createVerticalGradientTexture('#000000', '#cccccccc');
        // Prepare mirrored gradient for output cylinders
        this.outputCylinderGradientTexture = this.createVerticalGradientTexture('#cccccc33', '#ffffff00');
        this.setupThreeJS();
        this.setupMouseControls();
        this.createScene();
        this.animate();
        this.fetchData();
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.updateCameraPosition();
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupMouseControls() {
        let isMouseDown = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
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
        
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            this.isRotating = false; // Stop auto rotation when user interacts
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            isMouseDown = false;
        });
        
        this.renderer.domElement.addEventListener('mousemove', (e) => {
            // Handle tooltip
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

            // Reset hover states: colors and opacities for inputs/outputs and tubes
            this.scene.children.forEach(child => {
                if (child.userData.type === 'input' || child.userData.type === 'input-tube') {
                    if (child.userData.originalColor) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                }
                if (child.userData.type === 'output' || child.userData.type === 'output-tube') {
                    if (typeof child.userData.originalOpacity === 'number') {
                        child.material.opacity = child.userData.originalOpacity;
                    }
                    if (typeof child.userData.originalEmissive === 'number' && child.material.emissive) {
                        child.material.emissive.setHex(child.userData.originalEmissive);
                        child.material.emissiveIntensity = 0;
                    }
                    if (typeof child.userData.originalColor === 'number' && child.material.color) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                }
            });

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.scene.children);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const userData = intersectedObject.userData;
                
                let tooltipContent = '';
                
                if (userData.type === 'input') {
                    const input = userData.data;
                    const amount = input.prevout?.value ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
                    const scriptType = input.prevout?.scriptpubkey_type || 'Unknown';
                    
                    tooltipContent = `
                        <strong>Input ${userData.index + 1}</strong><br>
                        Amount: ${amount} BTC<br>
                        Script Type: ${scriptType}<br>
                        ${input.prevout?.scriptpubkey_address ? `Address: ${input.prevout.scriptpubkey_address.substring(0, 16)}...` : ''}<br>
                        <br>
                        <strong>From Transaction:</strong><br>
                        TXID: ${input.txid ? input.txid.substring(0, 16) + '...' : 'Unknown'}<br>
                        Output Index: ${input.vout !== undefined ? input.vout : 'Unknown'}<br>
                        <em>Double-click to view source transaction</em>
                    `;
                } else if (userData.type === 'output') {
                    const output = userData.data;
                    const amount = (output.value / 100000000).toFixed(8);
                    const scriptType = output.scriptpubkey_type || 'Unknown';
                    
                    // Check if this output is spent and show spending transaction data
                    if (userData.spendingData) {
                        tooltipContent = `
                            <strong>Output ${userData.index + 1} (SPENT)</strong><br>
                            Amount: ${amount} BTC<br>
                            Script Type: ${scriptType}<br>
                            ${output.scriptpubkey_address ? `Address: ${output.scriptpubkey_address.substring(0, 16)}...` : ''}<br>
                            <br>
                            <strong>Spent by:</strong><br>
                            TXID: ${userData.spendingData.txid.substring(0, 16)}...<br>
                            Block: ${userData.spendingData.block_height || 'Unconfirmed'}<br>
                            <em>Double-click to view spending transaction</em>
                        `;
                    } else {
                        tooltipContent = `
                            <strong>Output ${userData.index + 1}</strong><br>
                            Amount: ${amount} BTC<br>
                            Script Type: ${scriptType}<br>
                            ${output.scriptpubkey_address ? `Address: ${output.scriptpubkey_address.substring(0, 16)}...` : ''}
                        `;
                    }
                } else if (userData.type === 'input-tube') {
                    const input = userData.data;
                    const address = input.prevout?.scriptpubkey_address;
                    
                    if (address) {
                        tooltipContent = `
                            <strong>Connection from Address</strong><br>
                            Address: ${address.substring(0, 16)}...<br>
                            Amount: ${input.prevout?.value ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown'} BTC<br>
                            <em>Double-click to view address details</em>
                        `;
                    }
                } else if (userData.type === 'output-tube') {
                    const output = userData.data;
                    const address = output.scriptpubkey_address;
                    
                    if (address) {
                        tooltipContent = `
                            <strong>Connection to Address</strong><br>
                            Address: ${address.substring(0, 16)}...<br>
                            Amount: ${(output.value / 100000000).toFixed(8)} BTC<br>
                            <em>Double-click to view address details</em>
                        `;
                    }
                } else if (userData.type === 'transaction') {
                    const tx = userData.data;
                    const totalInput = tx.vin ? tx.vin.reduce((sum, input) => sum + (input.prevout?.value || 0), 0) : 0;
                    const totalOutput = tx.vout ? tx.vout.reduce((sum, output) => sum + output.value, 0) : 0;
                    const fee = totalInput - totalOutput;
                    
                    tooltipContent = `
                        <strong>Transaction</strong><br>
                        Size: ${tx.size} bytes<br>
                        Fee: ${(fee / 100000000).toFixed(8)} BTC<br>
                        Inputs: ${tx.vin?.length || 0}<br>
                        Outputs: ${tx.vout?.length || 0}
                    `;
                }
                
                if (tooltipContent) {
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 10 + 'px';
                    tooltip.style.top = e.clientY - 10 + 'px';
                    
                    // Softer highlight for inputs: medium gray
                    if (userData.type === 'input' || userData.type === 'input-tube') {
                        const highlightColor = 0x999999;
                        intersectedObject.material.color.setHex(highlightColor);
                        
                        // Apply to both the input cylinder and its connection tube
                        const index = userData.index;
                        this.scene.children.forEach(child => {
                            if ((child.userData.type === 'input' || child.userData.type === 'input-tube') && 
                                child.userData.index === index) {
                                child.material.color.setHex(highlightColor);
                            }
                        });
                    }

                    // Stronger highlight for outputs: increase opacity more and tint brighter
                    if (userData.type === 'output' || userData.type === 'output-tube') {
                        const index = userData.index;
                        this.scene.children.forEach(child => {
                            if ((child.userData.type === 'output' || child.userData.type === 'output-tube') &&
                                child.userData.index === index) {
                                // Bump opacity more aggressively (cap at 1.0)
                                const newOpacity = Math.min(1.0, (child.userData.originalOpacity ?? child.material.opacity) + 1.0);
                                child.material.opacity = newOpacity;
                                // Brighten via emissive to ensure visible highlight even on textured materials
                                if (child.material.emissive) {
                                    child.material.emissive.setHex(0xffffff);
                                    child.material.emissiveIntensity = 0.6;
                                }
                                // Fallback: brighten color if no emissive
                                else if (child.material.color) {
                                    child.material.color.setHex(0xffffff);
                                }
                                // Change gradient texture to a brighter version for cylinders
                                if (child.material.map && child.userData.type === 'output') {
                                    // Create a bright hover gradient for output cylinders
                                    const hoverGradient = this.createVerticalGradientTexture('#ffffff', '#00000000');
                                    child.material.map = hoverGradient;
                                    child.material.color.setHex(0x000000);
                                    child.material.needsUpdate = true;
                                }
                            }
                        });
                    }
                }
            } else {
                tooltip.style.display = 'none';
                // Reset all hover effects when not hovering over anything
                this.scene.children.forEach(child => {
                    if (child.userData) {
                        if ((child.userData.type === 'input' || child.userData.type === 'input-tube') && typeof child.userData.originalColor === 'number' && child.material?.color) {
                            child.material.color.setHex(child.userData.originalColor);
                        }
                        if (child.userData.type === 'output' || child.userData.type === 'output-tube') {
                            if (typeof child.userData.originalOpacity === 'number') {
                                child.material.opacity = child.userData.originalOpacity;
                            }
                            if (typeof child.userData.originalEmissive === 'number' && child.material?.emissive) {
                                child.material.emissive.setHex(child.userData.originalEmissive);
                                child.material.emissiveIntensity = 0;
                            }
                            if (typeof child.userData.originalColor === 'number' && child.material?.color) {
                                child.material.color.setHex(child.userData.originalColor);
                            }
                            // Reset gradient texture to original for output cylinders
                            if (child.material.map && child.userData.type === 'output' && child.userData.originalGradient) {
                                child.material.map = child.userData.originalGradient;
                                child.material.needsUpdate = true;
                            }
                        }
                    }
                });
            }
            
            // Handle camera controls
            if (!isMouseDown) return;

            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;

            if (e.shiftKey) {
                // Panning - inverted for natural feel
                this.controls.panX -= deltaX * 0.05;
                this.controls.panY += deltaY * 0.05;
            } else {
                // Rotation - inverted for natural feel
                this.controls.theta -= deltaX * 0.01;
                this.controls.phi += deltaY * 0.01;
                this.controls.phi = Math.max(0.01, Math.min(Math.PI - 0.1, this.controls.phi));
            }

            this.updateCameraPosition();
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        });
        
        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            // Reset all hover effects on mouse leave
            this.scene.children.forEach(child => {
                if (child.userData) {
                    if ((child.userData.type === 'input' || child.userData.type === 'input-tube') && typeof child.userData.originalColor === 'number' && child.material?.color) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                    if (child.userData.type === 'output' || child.userData.type === 'output-tube') {
                        if (typeof child.userData.originalOpacity === 'number') {
                            child.material.opacity = child.userData.originalOpacity;
                        }
                        if (typeof child.userData.originalEmissive === 'number' && child.material?.emissive) {
                            child.material.emissive.setHex(child.userData.originalEmissive);
                            child.material.emissiveIntensity = 0;
                        }
                        if (typeof child.userData.originalColor === 'number' && child.material?.color) {
                            child.material.color.setHex(child.userData.originalColor);
                        }
                        // Reset gradient texture to original for output cylinders
                        if (child.material.map && child.userData.type === 'output' && child.userData.originalGradient) {
                            child.material.map = child.userData.originalGradient;
                            child.material.needsUpdate = true;
                        }
                    }
                }
            });
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
                this.controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
                this.controls.distance = Math.max(1, Math.min(1000, this.controls.distance)); // Allow much further zoom out
                this.updateCameraPosition();
            } else {
                // Orthographic camera zoom
                const zoomSpeed = 0.1;
                this.orthographicZoom -= e.deltaY * zoomSpeed; // Inverted: was +=, now -=
                this.orthographicZoom = Math.max(1, Math.min(2000, this.orthographicZoom)); // Allow much further zoom out
                
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
        
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.controls.distance = 60;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.target.set(0, 0, 0);
            this.controls.panX = 0;
            this.controls.panY = 0;
            this.controls.panZ = 0;
            this.updateCameraPosition();
        });
        
        // Add toggle view button functionality
        const toggleViewButton = document.getElementById('toggle-view');
        if (toggleViewButton) {
            toggleViewButton.addEventListener('click', () => {
                this.toggleCameraView();
            });
        }
        
        // Remove the toggle-flow button since we don't have flows anymore
        const toggleFlowButton = document.getElementById('toggle-flow');
        if (toggleFlowButton) {
            toggleFlowButton.style.display = 'none';
        }
        
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
        
        // Modal functionality
        this.setupModal();
        
        // Panel toggle functionality
        this.setupPanelToggle();
        
        // Add double-click functionality
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

            const intersects = raycaster.intersectObjects(this.scene.children);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const userData = intersectedObject.userData;
                
                if (userData.type === 'input') {
                    // Navigate to source transaction
                    const txid = userData.data.txid;
                    if (txid) {
                        window.location.href = `transaction.html?txid=${txid}`;
                    }
                } else if (userData.type === 'input-tube') {
                    // Navigate to address page
                    const address = userData.data.prevout?.scriptpubkey_address;
                    if (address) {
                        window.location.href = `address.html?address=${address}`;
                    }
                } else if (userData.type === 'output' && userData.spendingData) {
                    // Navigate to spending transaction
                    window.location.href = `transaction.html?txid=${userData.spendingData.txid}`;
                } else if (userData.type === 'output-tube') {
                    // Navigate to address page
                    const address = userData.data.scriptpubkey_address;
                    if (address) {
                        window.location.href = `address.html?address=${address}`;
                    }
                }
            }
        });
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
                this.controls.distance = 60;
                this.controls.phi = Math.PI / 3;
                this.controls.theta = 0;
                this.controls.target.set(0, 0, 0);
                this.controls.panX = 0;
                this.controls.panY = 0;
                this.controls.panZ = 0;
                this.updateCameraPosition();
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
                    this.controls.panX += deltaX * panSpeed;
                    this.controls.panY -= deltaY * panSpeed;
                } else {
                    // Rotation
                    this.controls.theta += deltaX * sensitivity;
                    this.controls.phi -= deltaY * sensitivity;
                    this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
                }
                
                this.updateCameraPosition();
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
                    this.controls.distance = Math.max(1, Math.min(1000, this.controls.distance));
                    this.updateCameraPosition();
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(1, Math.min(2000, this.orthographicZoom));
                    
                    const aspect = window.innerWidth / window.innerHeight;
                    this.camera.left = -this.orthographicZoom * aspect / 2;
                    this.camera.right = this.orthographicZoom * aspect / 2;
                    this.camera.top = this.orthographicZoom / 2;
                    this.camera.bottom = -this.orthographicZoom / 2;
                    this.camera.updateProjectionMatrix();
                }
                
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

    // Create a simple vertical gradient texture (top to bottom)
    createVerticalGradientTexture(topColor, bottomColor) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, topColor);
        gradient.addColorStop(1, bottomColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.needsUpdate = true;
        return texture;
    }

    updateCameraPosition() {
        const x = this.controls.distance * Math.sin(this.controls.phi) * Math.cos(this.controls.theta);
        const y = this.controls.distance * Math.cos(this.controls.phi);
        const z = this.controls.distance * Math.sin(this.controls.phi) * Math.sin(this.controls.theta);
        
        this.camera.position.set(
            x + this.controls.target.x + this.controls.panX,
            y + this.controls.target.y + this.controls.panY,
            z + this.controls.target.z + this.controls.panZ
        );
            
        this.camera.lookAt(
            this.controls.target.x + this.controls.panX,
            this.controls.target.y + this.controls.panY,
            this.controls.target.z + this.controls.panZ
        );
    }

    createScene() {
        // Add lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, -10, -5);
        this.scene.add(fillLight);

        // Bottom fill light from below
        const bottomFillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        bottomFillLight.position.set(0, -15, 0);
        this.scene.add(bottomFillLight);
            
        // No placeholder geometry - wait for real data
    }

    async fetchData() {
        try {
            if (!this.txid) {
                console.error('No transaction ID provided in URL');
                this.updateUI({});
                return;
            }

            // Fetch transaction data from Mempool.space
            const response = await fetch(`https://mempool.space/api/tx/${this.txid}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.transactionData = await response.json();
            
            // Log all available transaction data
            console.log('=== TRANSACTION DATA ===');
            console.log('Full transaction object:', this.transactionData);
            console.log('Transaction ID:', this.transactionData.txid);
            console.log('Version:', this.transactionData.version);
            console.log('Locktime:', this.transactionData.locktime);
            console.log('Size:', this.transactionData.size, 'bytes');
            console.log('Weight:', this.transactionData.weight);
            console.log('Fee:', this.transactionData.fee, 'sats');
            console.log('Status:', this.transactionData.status);
            
            console.log('\n=== INPUTS ===');
            console.log('Number of inputs:', this.transactionData.vin?.length || 0);
            this.transactionData.vin?.forEach((input, index) => {
                console.log(`Input ${index + 1}:`, {
                    txid: input.txid,
                    vout: input.vout,
                    prevout: input.prevout,
                    scriptsig: input.scriptsig,
                    scriptsig_asm: input.scriptsig_asm,
                    inner_witnessscript_asm: input.inner_witnessscript_asm,
                    sequence: input.sequence,
                    witness: input.witness
                });
            });
            
            console.log('\n=== OUTPUTS ===');
            console.log('Number of outputs:', this.transactionData.vout?.length || 0);
            this.transactionData.vout?.forEach((output, index) => {
                console.log(`Output ${index + 1}:`, {
                    scriptpubkey: output.scriptpubkey,
                    scriptpubkey_asm: output.scriptpubkey_asm,
                    scriptpubkey_type: output.scriptpubkey_type,
                    scriptpubkey_address: output.scriptpubkey_address,
                    value: output.value,
                    value_hex: output.value_hex
                });
            });
            
            console.log('\n=== CALCULATED VALUES ===');
            const totalInput = this.transactionData.vin ? 
                this.transactionData.vin.reduce((sum, input) => sum + (input.prevout?.value || 0), 0) : 0;
            const totalOutput = this.transactionData.vout ? 
                this.transactionData.vout.reduce((sum, output) => sum + output.value, 0) : 0;
            const calculatedFee = totalInput - totalOutput;
            
            console.log('Total input value:', totalInput, 'sats');
            console.log('Total output value:', totalOutput, 'sats');
            console.log('Calculated fee:', calculatedFee, 'sats');
            console.log('API fee:', this.transactionData.fee, 'sats');
            console.log('Fee difference:', calculatedFee - this.transactionData.fee, 'sats');
            
            console.log('=== END TRANSACTION DATA ===\n');
            
            this.updateUI(this.transactionData);
            this.createTransactionVisualization();
            
            // Check spending status of outputs
            this.checkOutputSpendingStatus();
            
        } catch (error) {
            console.error('Error fetching transaction data:', error);
            this.updateUI({});
        }
    }

    updateUI(data) {
        if (!data || Object.keys(data).length === 0) {
            document.getElementById('tx-hash').textContent = 'Loading...';
            document.getElementById('tx-date').textContent = 'Loading...';
            document.getElementById('tx-version').textContent = 'Loading...';
            document.getElementById('tx-locktime').textContent = 'Loading...';
            document.getElementById('tx-amount').textContent = 'Loading...';
            document.getElementById('tx-fee').textContent = 'Loading...';
            document.getElementById('tx-status').textContent = 'Loading...';
            document.getElementById('tx-block-height').textContent = 'Loading...';
            document.getElementById('tx-block-hash').textContent = 'Loading...';
            document.getElementById('tx-inputs').textContent = 'Loading...';
            document.getElementById('tx-outputs').textContent = 'Loading...';
            document.getElementById('tx-size').textContent = 'Loading...';
            document.getElementById('tx-weight').textContent = 'Loading...';
            document.getElementById('tx-sigops').textContent = 'Loading...';
            document.getElementById('tx-confirmations').textContent = 'Loading...';
            return;
        }

        // Calculate total output amount
        const totalOutput = data.vout ? data.vout.reduce((sum, output) => sum + output.value, 0) : 0;
        const fee = data.fee || 0;

        // Update title hash to show full transaction ID
        const titleHash = data.txid ? data.txid : 'Not Found';
        document.getElementById('tx-title-hash').textContent = titleHash;
        
        document.getElementById('tx-hash').textContent = data.txid ? data.txid.substring(0, 16) + '...' : 'N/A';
        
        // Format transaction date
        let txDate = 'N/A';
        if (data.status?.block_time) {
            const date = new Date(data.status.block_time * 1000);
            txDate = this.formatDate(date);
        } else if (data.status?.confirmed === false) {
            txDate = 'Unconfirmed';
        }
        document.getElementById('tx-date').textContent = txDate;
        
        document.getElementById('tx-version').textContent = data.version !== undefined ? data.version.toString() : 'N/A';
        document.getElementById('tx-locktime').textContent = data.locktime !== undefined ? data.locktime.toString() : 'N/A';
        document.getElementById('tx-amount').textContent = totalOutput ? `${(totalOutput / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-fee').textContent = fee ? `${(fee / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-status').textContent = data.status?.confirmed ? 'Confirmed' : 'Unconfirmed';
        document.getElementById('tx-block-height').textContent = data.status?.block_height ? data.status.block_height.toString() : 'Unconfirmed';
        document.getElementById('tx-block-hash').textContent = data.status?.block_hash ? data.status.block_hash.substring(0, 16) + '...' : 'N/A';
        document.getElementById('tx-inputs').textContent = data.vin ? data.vin.length.toString() : 'N/A';
        document.getElementById('tx-outputs').textContent = data.vout ? data.vout.length.toString() : 'N/A';
        document.getElementById('tx-size').textContent = data.size ? `${data.size} bytes` : 'N/A';
        document.getElementById('tx-weight').textContent = data.weight ? `${data.weight} WU` : 'N/A';
        document.getElementById('tx-sigops').textContent = data.sigops ? data.sigops.toString() : 'N/A';
        document.getElementById('tx-confirmations').textContent = data.status?.block_height ? 'Confirmed' : '0';

        // Show/hide "Back to Block" button based on confirmation status
        const backToBlockButton = document.getElementById('back-to-block');
        if (data.status?.block_height) {
            backToBlockButton.style.display = 'inline-block';
            backToBlockButton.onclick = () => {
                window.location.href = `block.html?height=${data.status.block_height}`;
            };
        } else {
            backToBlockButton.style.display = 'none';
        }
    }

    createTransactionVisualization() {
        if (!this.transactionData) return;

        // Clear any existing objects
        while(this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }

        // Re-add lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, -10, -5);
        this.scene.add(fillLight);

        // Create visualization based on real transaction data
        this.createInputOutputVisualization();
    }

    createInputOutputVisualization() {
        const inputs = this.transactionData.vin || [];
        const outputs = this.transactionData.vout || [];

        // Precompute input radii and vertical positions to avoid overlaps and align with tubes
        const inputParams = inputs.map((input, index) => {
            const amount = input.prevout?.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1);
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1));
            const radius = 1 * sizeScale;
            return { index, input, radius };
        });

        const yPositions = [];
        if (inputParams.length > 0) {
            if (inputParams.length === 1) {
                // Single input: position at same Y as transaction (Y=0)
                yPositions[0] = 0;
            } else {
                // Multiple inputs: calculate total height needed for all inputs
                let totalHeight = 0;
                for (let i = 0; i < inputParams.length; i++) {
                    if (i === 0) {
                        totalHeight += inputParams[i].radius;
                    } else {
                        const prevRadius = inputParams[i - 1].radius;
                        const radius = inputParams[i].radius;
                        const spacing = Math.max(0.5, prevRadius + radius + 0.5);
                        totalHeight += spacing;
                    }
                }
                
                // Start from the top and center around transaction cuboid (Y=0)
                let currentY = totalHeight / 2;
                const minSpacing = 0.5;
                for (let i = 0; i < inputParams.length; i++) {
                    if (i === 0) {
                        yPositions[i] = currentY;
                        currentY -= inputParams[i].radius;
                    } else {
                        const prevRadius = inputParams[i - 1].radius;
                        const radius = inputParams[i].radius;
                        const spacing = Math.max(minSpacing, prevRadius + radius + 0.5);
                        currentY -= spacing;
                        yPositions[i] = currentY;
                    }
                }
            }
        }

        // Precompute output radii and vertical positions to avoid overlaps and align with tubes
        const outputParams = outputs.map((output, index) => {
            const amount = output.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1);
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1));
            const radius = 1 * sizeScale;
            return { index, output, radius };
        });

        const yPositionsOutputs = [];
        if (outputParams.length > 0) {
            if (outputParams.length === 1) {
                // Single output: position at same Y as transaction (Y=0)
                yPositionsOutputs[0] = 0;
            } else {
                // Multiple outputs: calculate total height needed for all outputs
                let totalHeightOut = 0;
                for (let i = 0; i < outputParams.length; i++) {
                    if (i === 0) {
                        totalHeightOut += outputParams[i].radius;
                    } else {
                        const prevRadius = outputParams[i - 1].radius;
                        const radius = outputParams[i].radius;
                        const spacing = Math.max(0.5, prevRadius + radius + 0.5);
                        totalHeightOut += spacing;
                    }
                }
                
                // Start from the top and center around transaction cuboid (Y=0)
                let currentYOut = totalHeightOut / 2;
                const minSpacingOut = 0.5;
                for (let i = 0; i < outputParams.length; i++) {
                    if (i === 0) {
                        yPositionsOutputs[i] = currentYOut;
                        currentYOut -= outputParams[i].radius;
                    } else {
                        const prevRadius = outputParams[i - 1].radius;
                        const radius = outputParams[i].radius;
                        const spacing = Math.max(minSpacingOut, prevRadius + radius + 0.5);
                        currentYOut -= spacing;
                        yPositionsOutputs[i] = currentYOut;
                    }
                }
            }
        }

        // Create input cylinders on the left
        inputParams.forEach((param, index) => {
            const { input, radius: cylinderRadius } = param;
            const cylinderHeight = 120; // Much taller for strong presence
            
            const geometry = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, cylinderHeight, 16, 1, true);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0x444444, // Match input connection color
                transparent: true,
                opacity: 0.75,
                side: THREE.DoubleSide,
                depthWrite: false, // Match input tube depth behavior
                depthTest: true,
                map: this.cylinderGradientTexture
            });
            const cylinder = new THREE.Mesh(geometry, material);
            cylinder.renderOrder = 1; // Render after other objects
            
            // Rotate cylinder 90 degrees around Z-axis to make it horizontal
            cylinder.rotation.z = Math.PI / 2;
            
            // Position cylinder so its top (positive X end) aligns with the connection line start point
            // The connection line starts at (-35, y, 0) and the cylinder top should be at that point
            // Since cylinder is rotated 90° around Z, its length extends in the -X direction
            const cylinderLength = cylinderHeight; // Height becomes length when rotated
            const topOffset = cylinderLength / 2; // Half the cylinder length
            const y = yPositions[index] ?? ((inputs.length - 1) - index * 2);
            cylinder.position.set(-35 - topOffset, y, 0);
            
            // Store the radius for spacing calculations
            cylinder.userData.radius = cylinderRadius;
            cylinder.userData = { type: 'input', index, data: input, originalColor: 0x444444 };
            this.scene.add(cylinder);
        });


        // Create output spheres on the right with precomputed spacing
        outputParams.forEach((param, index) => {
            const { output, radius: sphereRadius } = param;
            
            const geometry = new THREE.SphereGeometry(sphereRadius, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2); // Open hemisphere
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xffffff, // White color
                transparent: true,
                opacity: 0.9, // High opacity but not fully opaque
                side: THREE.DoubleSide,
                depthWrite: true,
                depthTest: true
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.renderOrder = 1; // Render after other objects
            
            // Rotate hemisphere so its opening faces outward (toward +X)
            sphere.rotation.z = -Math.PI / 2;
            
            const y = yPositionsOutputs[index] ?? ((outputs.length - 1) - index * 2);
            sphere.position.set(35, y, 0);
            sphere.userData = { type: 'output', index, data: output, radius: sphereRadius, originalOpacity: material.opacity, originalEmissive: material.emissive ? material.emissive.getHex() : 0x000000, originalColor: material.color ? material.color.getHex() : 0xffffff };
            this.scene.add(sphere);
        });

        // Create central transaction cuboid
        const width = 2; // Fixed width
        const depth = width / 10; // 1/10th of width
        const height = Math.max(0.01, (this.transactionData.size || 250) / 1000); // Based on transaction size
        
        const txGeometry = new THREE.BoxGeometry(width, height, depth);
        const txMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff,
            transparent: true,
            opacity: 0.8, // Slightly transparent for better visibility
            depthWrite: true,
            depthTest: true
        });
        const txCuboid = new THREE.Mesh(txGeometry, txMaterial);
        txCuboid.renderOrder = 0; // Render before spheres
        txCuboid.position.set(0, 0, 0);
        txCuboid.userData = { type: 'transaction', data: this.transactionData };
        this.scene.add(txCuboid);

        // Add circles perpendicular to the sides of the cuboid
        // Calculate total satoshis from inputs and outputs
        const totalInputSats = this.transactionData.vin ? 
            this.transactionData.vin.reduce((sum, input) => sum + (input.prevout?.value || 0), 0) : 0;
        const totalOutputSats = this.transactionData.vout ? 
            this.transactionData.vout.reduce((sum, output) => sum + output.value, 0) : 0;
        
        // Scale radius based on output value (what's actually being transferred)
        const baseRadius = Math.max(width, height) * 0.6;
        
        // Both discs use output value since that's what's being transferred
        const totalOutputBTC = totalOutputSats / 100000000;
        const logValue = Math.log10(totalOutputBTC + 1); // +1 to handle 0 values
        const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
        const circleRadius = 1 * sizeScale;
        
        // Single spanning cylinder ring across the transaction and adjacent space
        // Make its length 1/8th of the transaction cuboid height
        const spanLength = 2.5;
        const spanGeometry = new THREE.CylinderGeometry(circleRadius, circleRadius, spanLength, 32, 1, true);
        const spanMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true
        });
        const spanRing = new THREE.Mesh(spanGeometry, spanMaterial);
        spanRing.position.set(0, 0, 0);
        spanRing.rotation.z = Math.PI / 2; // Align along X axis
        spanRing.renderOrder = 1;
        this.scene.add(spanRing);

        // Create connection curves
        inputs.forEach((input, index) => {
            const y = yPositions[index] ?? ((inputs.length - 1) - index * 2);
            const startPoint = new THREE.Vector3(-35, y, 0);
            const endPoint = new THREE.Vector3(-1, 0, 0); // End at left side of cuboid (width = 2)
            
            // Create control points for smooth curve
            const controlPoint1 = new THREE.Vector3(-15, y + 1, 0);
            const controlPoint2 = new THREE.Vector3(-8, 0.5, 0);
            
            const curve = new THREE.CubicBezierCurve3(startPoint, controlPoint1, controlPoint2, endPoint);
            
            // Calculate tube radius based on input cylinder size (logarithmic scaling)
            const amount = input.prevout?.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const tubeRadius = 1 * sizeScale;
            
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, tubeRadius, 16, false);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0x222222, // Dark gray color
                opacity: 0.8,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true
            });
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 0; // Render before circles
            tube.userData = { type: 'input-tube', index: index, data: input, originalColor: 0x444444 };
            this.scene.add(tube);
        });

        outputs.forEach((output, index) => {
            const y = yPositionsOutputs[index] ?? ((outputs.length - 1) - index * 2);
            const startPoint = new THREE.Vector3(1, 0, 0); // Start from right side of cuboid (width/2 where width=2)
            const endPoint = new THREE.Vector3(35, y, 0);
            
            // Create control points for smooth curve
            const controlPoint1 = new THREE.Vector3(15, 0.5, 0); // Adjusted for new start point
            const controlPoint2 = new THREE.Vector3(8, y + 1, 0);
            
            const curve = new THREE.CubicBezierCurve3(startPoint, controlPoint1, controlPoint2, endPoint);
            
            // Calculate tube radius based on output sphere size (logarithmic scaling)
            const amount = output.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const tubeRadius = 1 * sizeScale;
            
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, tubeRadius, 16, false);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xffffff, // White color
                opacity: 0.6, 
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true
            });
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 0; // Render before circles
            tube.userData = { type: 'output-tube', index: index, data: output, originalOpacity: material.opacity, originalEmissive: material.emissive ? material.emissive.getHex() : 0x000000, originalColor: material.color ? material.color.getHex() : 0xffffff };
            this.scene.add(tube);
        });
    }
    
    repositionInputCylinders() {
        // Get all input cylinders
        const inputCylinders = this.scene.children.filter(child => child.userData.type === 'input');
        
        if (inputCylinders.length === 0) return;
        
        // Sort by index to maintain order
        inputCylinders.sort((a, b) => a.userData.index - b.userData.index);
        
        // Calculate positions with proper spacing
        let currentY = (inputCylinders.length - 1) * 2; // Start position
        const minSpacing = 0.5; // Minimum spacing between cylinders
        
        inputCylinders.forEach((cylinder, index) => {
            const radius = cylinder.userData.radius || 1;
            
            // Calculate spacing based on radius of current and previous cylinder
            let spacing = minSpacing;
            if (index > 0) {
                const prevRadius = inputCylinders[index - 1].userData.radius || 1;
                spacing = Math.max(minSpacing, radius + prevRadius + 0.5); // Add buffer
            }
            
            // Update Y position
            if (index === 0) {
                // First cylinder stays at top
                cylinder.position.y = currentY;
            } else {
                // Subsequent cylinders are positioned with proper spacing
                currentY -= spacing;
                cylinder.position.y = currentY;
            }
        });
        
        // Update connection tube positions to match new cylinder positions
        this.updateInputTubePositions();
    }
    
    updateInputTubePositions() {
        const inputCylinders = this.scene.children.filter(child => child.userData.type === 'input');
        const inputTubes = this.scene.children.filter(child => child.userData.type === 'input-tube');
        
        inputCylinders.forEach(cylinder => {
            const index = cylinder.userData.index;
            const tube = inputTubes.find(t => t.userData.index === index);
            
            if (tube) {
                // Update tube start and end points to match new cylinder position
                const startPoint = new THREE.Vector3(-35, cylinder.position.y, 0);
                const endPoint = new THREE.Vector3(-1, 0, 0); // -width/2 where width = 2
                
                // Create control points for smooth curve
                const controlPoint1 = new THREE.Vector3(-15, cylinder.position.y + 1, 0);
                const controlPoint2 = new THREE.Vector3(-8, 0.5, 0);
                
                const curve = new THREE.CubicBezierCurve3(startPoint, controlPoint1, controlPoint2, endPoint);
                
                // Update tube geometry
                const tubeRadius = cylinder.userData.radius || 1;
                const newTubeGeometry = new THREE.TubeGeometry(curve, 64, tubeRadius, 8, false);
                
                // Replace the tube geometry
                tube.geometry.dispose();
                tube.geometry = newTubeGeometry;
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isRotating) {
            this.controls.theta += 0.001;
            this.updateCameraPosition();
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    async checkOutputSpendingStatus() {
        if (!this.transactionData || !this.transactionData.vout) return;
        
        console.log('\n=== CHECKING OUTPUT SPENDING STATUS ===');
        
        // Get all output spheres and tubes from the scene
        const outputSpheres = [];
        const outputTubes = [];
        this.scene.children.forEach(child => {
            if (child.userData.type === 'output') {
                outputSpheres.push(child);
            } else if (child.userData.type === 'output-tube') {
                outputTubes.push(child);
            }
        });
        
        // Check each output's spending status
        for (let i = 0; i < this.transactionData.vout.length; i++) {
            try {
                const response = await fetch(`https://mempool.space/api/tx/${this.txid}/outspend/${i}`);
                
                if (response.ok) {
                    const spendingData = await response.json();
                    console.log(`Output ${i} spending status:`, spendingData);
                    
                    // Find the corresponding sphere and tube
                    const sphere = outputSpheres.find(s => s.userData.index === i);
                    const tube = outputTubes.find(t => t.userData.index === i);
                    
                    if (sphere) {
                        if (spendingData.spent) {
                            // Replace sphere with a cylinder for spent outputs
                            const y = sphere.position.y;
                            const sphereRadius = sphere.userData.radius || 1;
                            const cylinderHeight = 120; // Much taller to match inputs
                            
                            const geometry = new THREE.CylinderGeometry(sphereRadius, sphereRadius, cylinderHeight, 16, 1, true);
                            const material = new THREE.MeshLambertMaterial({ 
                                color: 0xffffff, // Match spent output tube color
                                transparent: true,
                                opacity: 1,
                                side: THREE.DoubleSide,
                                depthWrite: false, // Match tube depth behavior
                                depthTest: true,
                                map: this.outputCylinderGradientTexture
                            });
                            const cylinder = new THREE.Mesh(geometry, material);
                            cylinder.renderOrder = 1;
                            
                            // Rotate to horizontal and align base (negative X end) with connection end point at x=35
                            cylinder.rotation.z = Math.PI / 2;
                            const topOffset = cylinderHeight / 2;
                            cylinder.position.set(35 + topOffset, y, 0);
                            
                            // Preserve user data, original material state, and add spending info
                            cylinder.userData = {
                                type: 'output',
                                index: i,
                                data: this.transactionData.vout[i],
                                radius: sphereRadius,
                                spendingData,
                                originalOpacity: material.opacity,
                                originalEmissive: material.emissive ? material.emissive.getHex() : 0x000000,
                                originalColor: material.color ? material.color.getHex() : 0xffffff,
                                originalGradient: this.outputCylinderGradientTexture
                            };
                            
                            // Replace in scene
                            this.scene.remove(sphere);
                            this.scene.add(cylinder);
                            
                            // Grey out corresponding tube and store spending info, and set its originalColor to grey for proper hover-out
                            if (tube) {
                                tube.material.color.setHex(0x666666);
                                tube.userData.spendingData = spendingData;
                                if (tube.userData) {
                                    tube.userData.originalColor = 0x666666;
                                }
                            }
                            console.log(`Output ${i} is SPENT - replaced with cylinder`);
                        } else {
                            // Keep unspent outputs white
                            sphere.material.color.setHex(0xffffff);
                            if (tube) tube.material.color.setHex(0xffffff);
                            console.log(`Output ${i} is UNSPENT - kept white`);
                        }
                    }
                } else {
                    console.log(`Failed to get spending status for output ${i}:`, response.status);
                }
            } catch (error) {
                console.error(`Error checking spending status for output ${i}:`, error);
            }
        }
        
        console.log('=== END SPENDING STATUS CHECK ===\n');
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
                5000
            );
            this.isPerspective = false;
        } else {
            // Switch to perspective
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
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
        const panelContent = document.getElementById('tx-info');
        
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

    setupModal() {
        const modal = document.getElementById('transaction-modal');
        const changeTransactionBtn = document.getElementById('change-transaction');
        const closeBtn = document.querySelector('.modal-close');
        const cancelBtn = document.getElementById('modal-cancel');
        const transactionForm = document.getElementById('transaction-form');
        const txidInput = document.getElementById('new-txid');
        const pasteBtn = document.getElementById('paste-button');
        const famousTransactions = document.querySelectorAll('.famous-transaction');

        // Show modal
        changeTransactionBtn.addEventListener('click', () => {
            modal.style.display = 'block';
            txidInput.focus();
            // Pre-fill with current transaction ID
            txidInput.value = this.txid || '';
        });

        // Close modal functions
        const closeModal = () => {
            modal.style.display = 'none';
            txidInput.value = '';
        };

        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'block') {
                closeModal();
            }
        });

        // Paste from clipboard functionality
        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    txidInput.value = text.trim();
                    txidInput.focus();
                }
            } catch (err) {
                console.error('Failed to read clipboard:', err);
                // Fallback for older browsers or when clipboard access is denied
                alert('Please paste manually (Ctrl+V) or copy the transaction ID to clipboard first');
            }
        });

        // Famous transactions functionality
        famousTransactions.forEach(button => {
            button.addEventListener('click', () => {
                const txid = button.getAttribute('data-txid');
                txidInput.value = txid;
                txidInput.focus();
            });
        });

        // Handle form submission
        transactionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const newTxid = txidInput.value.trim();
            
            if (!newTxid) {
                alert('Please enter a valid transaction ID');
                return;
            }

            // Basic transaction ID validation (64 character hex string)
            const isValidTransactionId = (txid) => {
                return /^[a-fA-F0-9]{64}$/.test(txid);
            };

            if (!isValidTransactionId(newTxid)) {
                alert('Please enter a valid transaction ID (64 character hexadecimal string)');
                return;
            }

            // Redirect to the same page with new transaction ID parameter
            const currentUrl = new URL(window.location);
            currentUrl.searchParams.set('txid', newTxid);
            window.location.href = currentUrl.toString();
        });
    }
    
    // Navigation methods
    rotateLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.theta -= 0.2;
        this.updateCameraPosition();
    }
    
    rotateRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.theta += 0.2;
        this.updateCameraPosition();
    }
    
    rotateUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.updateCameraPosition();
    }
    
    rotateDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.updateCameraPosition();
    }
    
    panLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panX -= 0.5;
        this.updateCameraPosition();
    }
    
    panRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panX += 0.5;
        this.updateCameraPosition();
    }
    
    panUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panY += 0.5;
        this.updateCameraPosition();
    }
    
    panDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panY -= 0.5;
        this.updateCameraPosition();
    }
    
    zoomIn() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.distance -= 2;
        this.controls.distance = Math.max(10, Math.min(200, this.controls.distance));
        this.updateCameraPosition();
    }
    
    zoomOut() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.distance += 2;
        this.controls.distance = Math.max(10, Math.min(200, this.controls.distance));
        this.updateCameraPosition();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinTransactionExplorer();
}); 