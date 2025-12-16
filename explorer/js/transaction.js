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
        
        // Raw transaction data
        this.rawTxData = null;
        this.rawViewMode = 'hex'; // 'hex', 'ascii', or 'binary'
        this.decodeMode = false; // Whether to show decoded transaction parts
        this.decodedSections = null; // Parsed transaction sections
        
        // Gradient texture cache for cylinders
        this.cylinderGradientTexture = null;
        this.outputCylinderGradientTexture = null;
        
        // Get transaction ID and other params from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.txid = urlParams.get('txid') || 'ce6b90e54ee8bc231f694e2abfac140e8c7a0900e4726088f0ed3ea54a0f3d10';
        this.urlViewMode = urlParams.get('view'); // View mode for raw data (hex/ascii/binary)
        this.urlBytesPerLine = urlParams.get('bytes'); // Bytes per line for raw data display
        this.urlRawDataOpen = urlParams.get('rawdata') === 'open'; // Whether raw data panel should be open
        this.urlDecodeMode = urlParams.get('decode') === 'on'; // Whether decode mode should be active
        
        // Set initial view mode from URL
        if (this.urlViewMode === 'ascii') {
            this.rawViewMode = 'ascii';
        } else if (this.urlViewMode === 'binary') {
            this.rawViewMode = 'binary';
        }
        
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
        
        // Raw data functionality
        this.setupRawDataPanel();
        
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
        // Get the container dimensions (respects split screen when raw data panel is open)
        const container = document.getElementById('container');
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        if (this.isPerspective) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        } else {
            const aspect = width / height;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(width, height);
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
    
    // Raw transaction data methods
    setupRawDataPanel() {
        // Raw data button - toggle panel
        document.getElementById('show-raw-data').addEventListener('click', () => {
            const modal = document.getElementById('raw-data-modal');
            if (modal.classList.contains('active')) {
                this.hideRawDataModal();
            } else {
                this.fetchRawTxData();
            }
        });
        
        // Raw data panel controls
        document.getElementById('close-raw-data').addEventListener('click', () => {
            this.hideRawDataModal();
        });
        
        document.getElementById('download-raw-data').addEventListener('click', () => {
            this.downloadRawData();
        });
        
        document.getElementById('copy-raw-data').addEventListener('click', () => {
            this.copyRawData();
        });
        
        // Close panel on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideRawDataModal();
            }
        });
        
        // Bytes per line dropdown
        document.getElementById('bytes-per-line').addEventListener('change', (e) => {
            const bytesValue = parseInt(e.target.value);
            this.reformatRawData(bytesValue);
            
            // Update URL with bytes parameter
            const url = new URL(window.location);
            url.searchParams.set('bytes', bytesValue);
            window.history.pushState({}, '', url);
        });
        
        // Set bytes per line from URL if provided
        if (this.urlBytesPerLine) {
            const bytesDropdown = document.getElementById('bytes-per-line');
            const validValues = ['16', '32', '64', '128', '256'];
            if (validValues.includes(this.urlBytesPerLine)) {
                bytesDropdown.value = this.urlBytesPerLine;
            }
        }
        
        // View toggle (Hex/ASCII/Binary)
        document.getElementById('view-hex').addEventListener('click', () => {
            if (this.rawViewMode !== 'hex') {
                this.rawViewMode = 'hex';
                this.updateViewToggleButtons();
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.delete('view'); // hex is default, remove param
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-ascii').addEventListener('click', () => {
            if (this.rawViewMode !== 'ascii') {
                this.rawViewMode = 'ascii';
                this.updateViewToggleButtons();
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'ascii');
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-binary').addEventListener('click', () => {
            if (this.rawViewMode !== 'binary') {
                this.rawViewMode = 'binary';
                this.updateViewToggleButtons();
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'binary');
                window.history.pushState({}, '', url);
            }
        });
        
        // Decode toggle button
        document.getElementById('toggle-decode').addEventListener('click', () => {
            this.decodeMode = !this.decodeMode;
            const decodeBtn = document.getElementById('toggle-decode');
            const legend = document.getElementById('decode-legend');
            
            if (this.decodeMode) {
                decodeBtn.classList.add('active');
                legend.style.display = 'flex';
                // Parse transaction if not already done
                if (!this.decodedSections && this.rawTxData) {
                    this.decodedSections = this.parseTransaction(this.rawTxData.bytes);
                }
            } else {
                decodeBtn.classList.remove('active');
                legend.style.display = 'none';
            }
            
            // Re-render with or without decode highlighting
            this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
            
            // Update URL with decode parameter
            const url = new URL(window.location);
            if (this.decodeMode) {
                url.searchParams.set('decode', 'on');
            } else {
                url.searchParams.delete('decode');
            }
            window.history.pushState({}, '', url);
        });
        
        // Auto-open raw data panel if URL parameter is set
        if (this.urlRawDataOpen) {
            this.fetchRawTxData();
        }
    }
    
    async fetchRawTxData() {
        if (!this.txid) {
            console.error('No transaction ID available');
            return;
        }
        
        const textElement = document.getElementById('raw-data-text');
        const sizeElement = document.getElementById('raw-data-size');
        const downloadBtn = document.getElementById('download-raw-data');
        
        // Show panel
        this.showRawDataModal();
        
        // If data is already loaded for this tx, just show it
        if (this.rawTxData && this.rawTxData.txid === this.txid) {
            return;
        }
        
        // Show loading state
        textElement.textContent = 'Loading...';
        textElement.className = 'raw-data-loading';
        sizeElement.textContent = 'Loading...';
        downloadBtn.disabled = true;
        
        try {
            const response = await fetch(`https://mempool.space/api/tx/${this.txid}/hex`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const hexString = await response.text();
            
            // Convert hex to bytes for ASCII view
            const bytes = new Uint8Array(hexString.length / 2);
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
            }
            
            // Store raw data
            this.rawTxData = {
                hex: hexString,
                bytes: bytes,
                txid: this.txid
            };
            
            // Format size
            const sizeBytes = bytes.length;
            const sizeFormatted = sizeBytes >= 1024 
                ? `${(sizeBytes / 1024).toFixed(2)} KB`
                : `${sizeBytes} bytes`;
            
            sizeElement.textContent = `Size: ${sizeFormatted} (${hexString.length.toLocaleString()} hex chars)`;
            
            // Parse transaction for decode mode
            this.decodedSections = this.parseTransaction(bytes);
            
            // Enable decode mode from URL if set
            if (this.urlDecodeMode && !this.decodeMode) {
                this.decodeMode = true;
                document.getElementById('toggle-decode').classList.add('active');
                document.getElementById('decode-legend').style.display = 'flex';
            }
            
            // Display data based on current view mode
            textElement.className = '';
            const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
            await this.reformatRawData(bytesPerLine);
            
            downloadBtn.disabled = false;
            
        } catch (error) {
            console.error('Error fetching raw tx data:', error);
            textElement.className = '';
            textElement.textContent = `Error loading raw transaction data:\n${error.message}`;
            sizeElement.textContent = 'Error';
        }
    }
    
    async reformatRawData(bytesPerLine) {
        if (!this.rawTxData || !this.rawTxData.hex) {
            return;
        }
        
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawTxData.hex;
        const bytes = this.rawTxData.bytes;
        
        // Adjust font size based on bytes per line and view mode
        // ASCII = 2x hex, Binary gets progressively smaller at higher bytes/line
        const isAscii = this.rawViewMode === 'ascii';
        const isBinary = this.rawViewMode === 'binary';
        if (bytesPerLine >= 256) {
            textElement.style.fontSize = isAscii ? '0.24vw' : isBinary ? '0.03vw' : '0.12vw';
        } else if (bytesPerLine >= 128) {
            textElement.style.fontSize = isAscii ? '0.6vw' : isBinary ? '0.07vw' : '0.3vw';
        } else if (bytesPerLine >= 64) {
            textElement.style.fontSize = isAscii ? '1vw' : isBinary ? '0.15vw' : '0.5vw';
        } else {
            textElement.style.fontSize = isAscii ? '20px' : isBinary ? '4px' : '10px';
        }
        
        // If decode mode is active, render with colored sections
        if (this.decodeMode && this.decodedSections) {
            this.renderDecodedData(bytesPerLine);
            return;
        }
        
        if (this.rawViewMode === 'ascii') {
            // ASCII view
            const asciiString = this.bytesToAscii(bytes);
            const regex = new RegExp(`.{1,${bytesPerLine}}`, 'g');
            const formatted = asciiString.match(regex)?.join('\n') || asciiString;
            textElement.textContent = formatted;
        } else if (this.rawViewMode === 'binary') {
            // Binary view - 8 chars per byte
            const binaryString = this.bytesToBinary(bytes);
            const charsPerLine = bytesPerLine * 8;
            const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
            const formatted = binaryString.match(regex)?.join('\n') || binaryString;
            textElement.textContent = formatted;
        } else {
            // Hex view
            const charsPerLine = bytesPerLine * 2;
            const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
            const formattedHex = hexString.match(regex)?.join('\n') || hexString;
            textElement.textContent = formattedHex;
        }
    }
    
    renderDecodedData(bytesPerLine) {
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawTxData.hex;
        const bytes = this.rawTxData.bytes;
        
        // Convert byte positions to character positions based on view mode
        const getCharPos = (bytePos) => {
            if (this.rawViewMode === 'ascii') {
                return bytePos;
            } else if (this.rawViewMode === 'binary') {
                return bytePos * 8;
            } else {
                return bytePos * 2;
            }
        };
        
        // Get the full string in current view mode
        let fullString;
        let charsPerLine;
        if (this.rawViewMode === 'ascii') {
            fullString = this.bytesToAscii(bytes);
            charsPerLine = bytesPerLine;
        } else if (this.rawViewMode === 'binary') {
            fullString = this.bytesToBinary(bytes);
            charsPerLine = bytesPerLine * 8;
        } else {
            fullString = hexString;
            charsPerLine = bytesPerLine * 2;
        }
        
        // Build HTML with colored spans
        // Sort sections by start position
        const sortedSections = [...this.decodedSections].sort((a, b) => a.start - b.start);
        
        let html = '';
        let currentCharPos = 0;
        let currentLinePos = 0;
        
        // Helper to add text with line breaks
        const addTextWithBreaks = (text, cssClass, section) => {
            let remaining = text;
            while (remaining.length > 0) {
                const spaceOnLine = charsPerLine - currentLinePos;
                const chunk = remaining.substring(0, spaceOnLine);
                remaining = remaining.substring(spaceOnLine);
                
                if (cssClass) {
                    const dataAttrs = section ? `data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"` : '';
                    html += `<span class="decode-section ${cssClass}" ${dataAttrs}>${this.escapeHtml(chunk)}</span>`;
                } else {
                    html += this.escapeHtml(chunk);
                }
                
                currentLinePos += chunk.length;
                if (currentLinePos >= charsPerLine && remaining.length > 0) {
                    html += '\n';
                    currentLinePos = 0;
                }
            }
        };
        
        for (const section of sortedSections) {
            const sectionStartChar = getCharPos(section.start);
            const sectionEndChar = getCharPos(section.end);
            
            // Add any gap before this section
            if (sectionStartChar > currentCharPos) {
                const gapText = fullString.substring(currentCharPos, sectionStartChar);
                addTextWithBreaks(gapText, null, null);
            }
            
            // Add the section with coloring
            const sectionText = fullString.substring(sectionStartChar, sectionEndChar);
            addTextWithBreaks(sectionText, section.cssClass, section);
            
            currentCharPos = sectionEndChar;
        }
        
        // Add any remaining text after the last section
        if (currentCharPos < fullString.length) {
            const remainingText = fullString.substring(currentCharPos);
            addTextWithBreaks(remainingText, null, null);
        }
        
        textElement.innerHTML = html;
        
        // Set up tooltip handlers
        this.setupDecodeTooltips();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    escapeAttr(text) {
        return text.replace(/&/g, '&amp;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#39;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');
    }
    
    setupDecodeTooltips() {
        // Create tooltip element if it doesn't exist
        let tooltip = document.getElementById('decode-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'decode-tooltip';
            tooltip.className = 'decode-tooltip';
            tooltip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.95);padding:8px 12px;font-size:13px;color:#fff;z-index:99999;max-width:350px;font-family:monospace;display:none;';
            document.body.appendChild(tooltip);
        }
        
        // Color map matching SatSigner's color scheme
        // https://github.com/satsigner/satsigner/blob/master/apps/mobile/components/SSTransactionDecoded.tsx#L69
        const sectionColors = {
            'decode-version': '#ffffff',
            'decode-marker': '#888888',
            'decode-flag': '#ffffff',
            'decode-txInVarInt': '#888888',
            'decode-txInHash': '#E01919',
            'decode-txInIndex': '#860B0B',
            'decode-txInScriptVarInt': '#DD9595',
            'decode-txInScript': '#860B0B',
            'decode-txInSequence': '#860B0B',
            'decode-txOutVarInt': '#93CC92',
            'decode-txOutValue': '#07BC03',
            'decode-txOutScriptVarInt': '#93CC92',
            'decode-txOutScript': '#608A64',
            'decode-witnessVarInt': '#8F5252',
            'decode-witnessItemsVarInt': '#8F5252',
            'decode-witnessItem': '#694040',
            'decode-witnessItemEmpty': '#694040',
            'decode-witnessItemPubkey': '#8F5252',
            'decode-witnessItemSignature': '#694040',
            'decode-witnessItemScript': '#694040',
            'decode-locktime': '#eeeeee',
            // Ordinals Inscription colors - envelope/content-type in muted red tones
            'decode-inscriptionEnvelope': '#A5463C',
            'decode-inscriptionContentTypeTag': '#964B41',
            'decode-inscriptionContentType': '#964B41',
            'decode-inscriptionBodyTag': '#694040',
            'decode-inscriptionBody': '#694040',
            'decode-inscriptionPushOpcode': '#8C4137',
            'decode-inscriptionBodyChunk': '#694040',
            'decode-inscriptionEndif': '#8F5252',
            'decode-inscriptionUnknownTag': '#694040',
            'decode-inscriptionUnknownValue': '#694040',
            // Taproot script elements - witness-related, muted reds
            'decode-taprootPubkeyPush': '#694040',
            'decode-taprootPubkey': '#8F5252',
            'decode-opChecksig': '#694040',
            // Taproot control block - witness-related, muted reds
            'decode-controlBlockPush': '#694040',
            'decode-controlByte': '#8F5252',
            'decode-internalPubkey': '#8F5252',
            'decode-merkleProof': '#694040'
        };
        
        const textElement = document.getElementById('raw-data-text');
        
        // Remove any existing global listener
        if (this._tooltipHandler) {
            textElement.removeEventListener('mouseover', this._tooltipHandler);
            textElement.removeEventListener('mouseout', this._tooltipOutHandler);
        }
        
        // Mouseover handler
        this._tooltipHandler = (e) => {
            const section = e.target.closest('.decode-section');
            if (section) {
                const label = section.getAttribute('data-label');
                const value = section.getAttribute('data-value');
                // Get the color from the section's class
                let color = '#fff';
                for (const [cls, clr] of Object.entries(sectionColors)) {
                    if (section.classList.contains(cls)) {
                        color = clr;
                        break;
                    }
                }
                if (label) {
                    tooltip.innerHTML = '<div style="font-weight:bold;color:' + color + ';margin-bottom:4px;">' + label + '</div><div style="color:rgba(255,255,255,0.8);">' + (value || '') + '</div>';
                    tooltip.style.left = (e.clientX + 15) + 'px';
                    tooltip.style.top = (e.clientY + 15) + 'px';
                    tooltip.style.display = 'block';
                }
            }
        };
        
        // Mouseout handler  
        this._tooltipOutHandler = (e) => {
            if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.decode-section')) {
                tooltip.style.display = 'none';
            }
        };
        
        textElement.addEventListener('mouseover', this._tooltipHandler);
        textElement.addEventListener('mouseout', this._tooltipOutHandler);
    }
    
    bytesToAscii(bytes) {
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            if (byte >= 32 && byte <= 126) {
                result += String.fromCharCode(byte);
            } else {
                result += '.';
            }
        }
        return result;
    }
    
    bytesToBinary(bytes) {
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            result += bytes[i].toString(2).padStart(8, '0');
        }
        return result;
    }
    
    // Parse a Bitcoin transaction and return sections with byte ranges
    // Based on SatSigner's txDecoded.ts implementation
    parseTransaction(bytes) {
        const sections = [];
        let offset = 0;
        
        // Helper to read bytes without advancing
        const peekBytes = (n) => bytes.slice(offset, offset + n);
        
        // Helper to read bytes
        const readBytes = (n) => {
            const slice = bytes.slice(offset, offset + n);
            offset += n;
            return slice;
        };
        
        // Helper to read little-endian integer
        const readLE = (n) => {
            let val = 0;
            for (let i = 0; i < n; i++) {
                val += bytes[offset + i] * Math.pow(256, i);
            }
            offset += n;
            return val;
        };
        
        // Helper to read VarInt and return start/end positions
        const readVarInt = () => {
            const start = offset;
            const first = bytes[offset++];
            let value;
            if (first < 0xfd) {
                value = first;
            } else if (first === 0xfd) {
                value = readLE(2);
            } else if (first === 0xfe) {
                value = readLE(4);
            } else {
                value = readLE(8);
            }
            return { value, start, end: offset };
        };
        
        // Helper to convert bytes to hex
        const toHex = (arr) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Helper to reverse endianness
        const reverseHex = (arr) => Array.from(arr).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
        
        try {
            // Version (4 bytes)
            const versionStart = offset;
            const version = readLE(4);
            sections.push({
                type: 'version',
                start: versionStart,
                end: offset,
                label: 'Version',
                value: version,
                cssClass: 'decode-version'
            });
            
            // Check for SegWit marker (0x00) and flag (0x01)
            let isSegWit = false;
            if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
                isSegWit = true;
                // Marker
                const markerStart = offset;
                offset += 1;
                sections.push({
                    type: 'marker',
                    start: markerStart,
                    end: offset,
                    label: 'Marker',
                    value: '00',
                    cssClass: 'decode-marker'
                });
                // Flag
                const flagStart = offset;
                offset += 1;
                sections.push({
                    type: 'flag',
                    start: flagStart,
                    end: offset,
                    label: 'Flag',
                    value: '01',
                    cssClass: 'decode-flag'
                });
            }
            
            // Input count (VarInt)
            const inputCountInfo = readVarInt();
            const inputCount = inputCountInfo.value;
            sections.push({
                type: 'txInVarInt',
                start: inputCountInfo.start,
                end: inputCountInfo.end,
                label: 'Input Count',
                value: inputCount,
                cssClass: 'decode-txInVarInt'
            });
            
            // Inputs
            for (let i = 0; i < inputCount; i++) {
                // Previous TX hash (32 bytes)
                const hashStart = offset;
                const prevTxHash = reverseHex(readBytes(32));
                sections.push({
                    type: 'txInHash',
                    start: hashStart,
                    end: offset,
                    label: `Input ${i} TXID`,
                    value: prevTxHash.substring(0, 16) + '...',
                    cssClass: 'decode-txInHash'
                });
                
                // Output index (4 bytes)
                const indexStart = offset;
                const outputIndex = readLE(4);
                sections.push({
                    type: 'txInIndex',
                    start: indexStart,
                    end: offset,
                    label: `Input ${i} Vout`,
                    value: outputIndex,
                    cssClass: 'decode-txInIndex'
                });
                
                // Script length (VarInt)
                const scriptLenInfo = readVarInt();
                const scriptLen = scriptLenInfo.value;
                sections.push({
                    type: 'txInScriptVarInt',
                    start: scriptLenInfo.start,
                    end: scriptLenInfo.end,
                    label: `Input ${i} Script Length`,
                    value: scriptLen,
                    cssClass: 'decode-txInScriptVarInt'
                });
                
                // Script (variable)
                if (scriptLen > 0) {
                    const scriptStart = offset;
                    const script = readBytes(scriptLen);
                    sections.push({
                        type: 'txInScript',
                        start: scriptStart,
                        end: offset,
                        label: `Input ${i} ScriptSig`,
                        value: toHex(script).substring(0, 20) + (scriptLen > 10 ? '...' : ''),
                        cssClass: 'decode-txInScript'
                    });
                }
                
                // Sequence (4 bytes)
                const seqStart = offset;
                const sequence = readLE(4);
                sections.push({
                    type: 'txInSequence',
                    start: seqStart,
                    end: offset,
                    label: `Input ${i} Sequence`,
                    value: '0x' + sequence.toString(16).padStart(8, '0'),
                    cssClass: 'decode-txInSequence'
                });
            }
            
            // Output count (VarInt)
            const outputCountInfo = readVarInt();
            const outputCount = outputCountInfo.value;
            sections.push({
                type: 'txOutVarInt',
                start: outputCountInfo.start,
                end: outputCountInfo.end,
                label: 'Output Count',
                value: outputCount,
                cssClass: 'decode-txOutVarInt'
            });
            
            // Outputs
            for (let i = 0; i < outputCount; i++) {
                // Value (8 bytes) - in satoshis
                const valueStart = offset;
                const valueLow = readLE(4);
                const valueHigh = readLE(4);
                const satoshis = valueLow + valueHigh * 0x100000000;
                sections.push({
                    type: 'txOutValue',
                    start: valueStart,
                    end: offset,
                    label: `Output ${i} Value`,
                    value: `${satoshis} sats (${(satoshis / 100000000).toFixed(8)} BTC)`,
                    cssClass: 'decode-txOutValue'
                });
                
                // Script length (VarInt)
                const scriptLenInfo = readVarInt();
                const scriptLen = scriptLenInfo.value;
                sections.push({
                    type: 'txOutScriptVarInt',
                    start: scriptLenInfo.start,
                    end: scriptLenInfo.end,
                    label: `Output ${i} Script Length`,
                    value: scriptLen,
                    cssClass: 'decode-txOutScriptVarInt'
                });
                
                // Script (variable)
                if (scriptLen > 0) {
                    const scriptStart = offset;
                    const script = readBytes(scriptLen);
                    sections.push({
                        type: 'txOutScript',
                        start: scriptStart,
                        end: offset,
                        label: `Output ${i} ScriptPubKey`,
                        value: toHex(script).substring(0, 20) + (scriptLen > 10 ? '...' : ''),
                        cssClass: 'decode-txOutScript'
                    });
                }
            }
            
            // Witness data (if SegWit)
            if (isSegWit) {
                for (let i = 0; i < inputCount; i++) {
                    // Witness stack count for this input
                    const witnessCountInfo = readVarInt();
                    const witnessCount = witnessCountInfo.value;
                    sections.push({
                        type: 'witnessVarInt',
                        start: witnessCountInfo.start,
                        end: witnessCountInfo.end,
                        label: `Witness ${i} Stack Items`,
                        value: witnessCount,
                        cssClass: 'decode-witnessVarInt'
                    });
                    
                    // Each witness item
                    for (let j = 0; j < witnessCount; j++) {
                        // Item length
                        const itemLenInfo = readVarInt();
                        const itemLen = itemLenInfo.value;
                        sections.push({
                            type: 'witnessItemsVarInt',
                            start: itemLenInfo.start,
                            end: itemLenInfo.end,
                            label: `Witness ${i}[${j}] Length`,
                            value: itemLen,
                            cssClass: 'decode-witnessItemsVarInt'
                        });
                        
                        // Item data
                        if (itemLen > 0) {
                            const itemStart = offset;
                            const item = readBytes(itemLen);
                            const itemHex = toHex(item);
                            
                            // Try to identify witness item type
                            let itemType = 'witnessItem';
                            let itemLabel = `Witness ${i}[${j}]`;
                            let itemValue = itemHex.substring(0, 20) + (itemLen > 10 ? '...' : '');
                            
                            // Check for Ordinals inscription (taproot script)
                            // Format: OP_FALSE OP_IF "ord" [content_type_tag] <content_type> [body_tag] <body...> OP_ENDIF
                            const inscription = this.parseInscription(item, itemStart);
                            if (inscription) {
                                // Add inscription sections instead of generic witness item
                                sections.push(...inscription.sections);
                                // Skip adding the generic witness item
                                continue;
                            }
                            
                            // Signature (typically 71-73 bytes, starts with 0x30)
                            if (itemLen >= 64 && itemLen <= 73 && item[0] === 0x30) {
                                itemType = 'witnessItemSignature';
                                itemLabel = `Witness ${i}[${j}] Signature`;
                            }
                            // Public key (33 bytes compressed, starts with 02 or 03)
                            else if (itemLen === 33 && (item[0] === 0x02 || item[0] === 0x03)) {
                                itemType = 'witnessItemPubkey';
                                itemLabel = `Witness ${i}[${j}] Pubkey`;
                            }
                            // Uncompressed public key (65 bytes, starts with 04)
                            else if (itemLen === 65 && item[0] === 0x04) {
                                itemType = 'witnessItemPubkey';
                                itemLabel = `Witness ${i}[${j}] Pubkey (uncompressed)`;
                            }
                            
                            sections.push({
                                type: itemType,
                                start: itemStart,
                                end: offset,
                                label: itemLabel,
                                value: itemValue,
                                cssClass: 'decode-' + itemType
                            });
                        } else {
                            // Empty witness item (often used for multisig)
                            sections.push({
                                type: 'witnessItemEmpty',
                                start: itemLenInfo.end,
                                end: itemLenInfo.end,
                                label: `Witness ${i}[${j}] (empty)`,
                                value: '(empty - OP_0)',
                                cssClass: 'decode-witnessItemEmpty'
                            });
                        }
                    }
                }
            }
            
            // Locktime (4 bytes)
            const locktimeStart = offset;
            const locktime = readLE(4);
            let locktimeValue;
            if (locktime === 0) {
                locktimeValue = '0 (no lock)';
            } else if (locktime < 500000000) {
                locktimeValue = `Block ${locktime}`;
            } else {
                locktimeValue = new Date(locktime * 1000).toISOString();
            }
            sections.push({
                type: 'locktime',
                start: locktimeStart,
                end: offset,
                label: 'Locktime',
                value: locktimeValue,
                cssClass: 'decode-locktime'
            });
            
        } catch (e) {
            console.error('Error parsing transaction:', e);
        }
        
        return sections;
    }
    
    // Parse Ordinals inscription from witness script
    // Based on https://github.com/casey/ord/blob/938b5cc97d48d026fd9250eae661d1e87286b377/src/inscription.rs
    parseInscription(script, baseOffset) {
        const sections = [];
        let pos = 0;
        
        // Helper to read a byte
        const readByte = () => script[pos++];
        
        // Helper to check if we have enough bytes
        const hasBytes = (n) => pos + n <= script.length;
        
        // Helper to read push data (handles different push opcodes)
        // Returns: { data, start, end, opcodeStart, opcodeEnd, opcodeType, opcodeLen }
        const readPushData = () => {
            if (pos >= script.length) return null;
            const opcode = script[pos];
            const opcodeStart = pos;
            
            // Direct push (1-75 bytes)
            if (opcode >= 0x01 && opcode <= 0x4b) {
                const len = opcode;
                pos++;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'direct', opcodeLen: len
                };
            }
            // OP_PUSHDATA1 (76 = 0x4c)
            else if (opcode === 0x4c) {
                pos++;
                if (!hasBytes(1)) return null;
                const len = script[pos++];
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA1', opcodeLen: len
                };
            }
            // OP_PUSHDATA2 (77 = 0x4d)
            else if (opcode === 0x4d) {
                pos++;
                if (!hasBytes(2)) return null;
                const len = script[pos] | (script[pos + 1] << 8);
                pos += 2;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA2', opcodeLen: len
                };
            }
            // OP_PUSHDATA4 (78 = 0x4e)
            else if (opcode === 0x4e) {
                pos++;
                if (!hasBytes(4)) return null;
                const len = script[pos] | (script[pos + 1] << 8) | (script[pos + 2] << 16) | (script[pos + 3] << 24);
                pos += 4;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA4', opcodeLen: len
                };
            }
            // OP_0 / OP_FALSE (empty push)
            else if (opcode === 0x00) {
                pos++;
                return { 
                    data: new Uint8Array(0), start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: pos, dataStart: pos, dataEnd: pos,
                    opcodeType: 'OP_0', opcodeLen: 0
                };
            }
            
            return null;
        };
        
        // Look for inscription envelope: OP_FALSE (0x00) OP_IF (0x63) "ord"
        while (pos < script.length - 5) {
            // Look for OP_FALSE OP_IF pattern
            if (script[pos] === 0x00 && script[pos + 1] === 0x63) {
                const envelopeStart = pos;
                
                // Look backwards to find pubkey + OP_CHECKSIG before the envelope
                // Check if the byte before OP_FALSE is OP_CHECKSIG (0xac)
                if (envelopeStart > 0 && script[envelopeStart - 1] === 0xac) {
                    const checksigPos = envelopeStart - 1;
                    
                    // Look for pubkey push before OP_CHECKSIG
                    // Scan backwards to find the push opcode
                    let pubkeyEnd = checksigPos;
                    let pubkeyStart = 0;
                    let pubkeyLen = 0;
                    let pushOpcodeStart = 0;
                    
                    // Check what's before OP_CHECKSIG - should be pubkey data
                    // We need to find where the pubkey push starts
                    // Common patterns: 0x20 (32 bytes) or 0x21 (33 bytes) for pubkeys
                    
                    // Scan from beginning to find the last push before OP_CHECKSIG
                    let scanPos = 0;
                    let lastPushStart = -1;
                    let lastPushDataStart = -1;
                    let lastPushDataEnd = -1;
                    let lastPushLen = 0;
                    
                    while (scanPos < checksigPos) {
                        const opcode = script[scanPos];
                        
                        // Direct push (1-75 bytes)
                        if (opcode >= 0x01 && opcode <= 0x4b) {
                            lastPushStart = scanPos;
                            lastPushLen = opcode;
                            lastPushDataStart = scanPos + 1;
                            lastPushDataEnd = scanPos + 1 + opcode;
                            scanPos = lastPushDataEnd;
                        }
                        // OP_PUSHDATA1
                        else if (opcode === 0x4c && scanPos + 1 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1];
                            lastPushDataStart = scanPos + 2;
                            lastPushDataEnd = scanPos + 2 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        }
                        // OP_PUSHDATA2
                        else if (opcode === 0x4d && scanPos + 2 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1] | (script[scanPos + 2] << 8);
                            lastPushDataStart = scanPos + 3;
                            lastPushDataEnd = scanPos + 3 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        }
                        else {
                            scanPos++;
                        }
                    }
                    
                    // If we found a push right before OP_CHECKSIG, add it as pubkey
                    if (lastPushStart >= 0 && lastPushDataEnd === checksigPos) {
                        // Add pubkey push opcode
                        if (lastPushDataStart > lastPushStart) {
                            sections.push({
                                type: 'taprootPubkeyPush',
                                start: baseOffset + lastPushStart,
                                end: baseOffset + lastPushDataStart,
                                label: 'Pubkey Push',
                                value: `OP_PUSHBYTES_${lastPushLen}`,
                                cssClass: 'decode-taprootPubkeyPush'
                            });
                        }
                        
                        // Add the pubkey itself
                        const pubkeyHex = Array.from(script.slice(lastPushDataStart, lastPushDataEnd))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        sections.push({
                            type: 'taprootPubkey',
                            start: baseOffset + lastPushDataStart,
                            end: baseOffset + lastPushDataEnd,
                            label: 'X-only Pubkey',
                            value: pubkeyHex.substring(0, 16) + '...',
                            cssClass: 'decode-taprootPubkey'
                        });
                    }
                    
                    // Add OP_CHECKSIG
                    sections.push({
                        type: 'opChecksig',
                        start: baseOffset + checksigPos,
                        end: baseOffset + checksigPos + 1,
                        label: 'OP_CHECKSIG',
                        value: '0xac',
                        cssClass: 'decode-opChecksig'
                    });
                }
                
                pos += 2; // Skip OP_FALSE OP_IF
                
                // Read protocol ID push
                const protocolPush = readPushData();
                if (!protocolPush) { pos = envelopeStart + 1; continue; }
                
                // Check if it's "ord"
                const protocolId = String.fromCharCode(...protocolPush.data);
                if (protocolId !== 'ord') { pos = envelopeStart + 1; continue; }
                
                // Found inscription!
                sections.push({
                    type: 'inscriptionEnvelope',
                    start: baseOffset + envelopeStart,
                    end: baseOffset + pos,
                    label: 'Inscription Envelope',
                    value: 'OP_FALSE OP_IF "ord"',
                    cssClass: 'decode-inscriptionEnvelope'
                });
                
                let contentType = null;
                let bodyChunks = [];
                let bodyStart = null;
                let bodyEnd = null;
                
                // Parse fields until OP_ENDIF (0x68)
                while (pos < script.length) {
                    if (script[pos] === 0x68) { // OP_ENDIF
                        const endifStart = pos;
                        pos++;
                        sections.push({
                            type: 'inscriptionEndif',
                            start: baseOffset + endifStart,
                            end: baseOffset + pos,
                            label: 'Inscription End',
                            value: 'OP_ENDIF',
                            cssClass: 'decode-inscriptionEndif'
                        });
                        
                        // Check for control block after OP_ENDIF
                        // Control block format: <push_opcode> <control_byte> <internal_pubkey>
                        if (pos < script.length) {
                            const controlPush = readPushData();
                            if (controlPush && controlPush.data.length >= 33) {
                                const controlByte = controlPush.data[0];
                                const leafVersion = controlByte & 0xfe;
                                const parity = controlByte & 0x01;
                                
                                // Add control block push opcode
                                if (controlPush.opcodeEnd > controlPush.opcodeStart) {
                                    sections.push({
                                        type: 'controlBlockPush',
                                        start: baseOffset + controlPush.opcodeStart,
                                        end: baseOffset + controlPush.opcodeEnd,
                                        label: 'Control Block Push',
                                        value: `${controlPush.opcodeType || 'push'} (${controlPush.data.length} bytes)`,
                                        cssClass: 'decode-controlBlockPush'
                                    });
                                }
                                
                                // Add control byte
                                sections.push({
                                    type: 'controlByte',
                                    start: baseOffset + controlPush.dataStart,
                                    end: baseOffset + controlPush.dataStart + 1,
                                    label: 'Control Byte',
                                    value: `0x${controlByte.toString(16)} (leaf v${leafVersion >> 1}, parity ${parity})`,
                                    cssClass: 'decode-controlByte'
                                });
                                
                                // Add internal pubkey (32 bytes after control byte)
                                if (controlPush.data.length >= 33) {
                                    const internalPubkey = Array.from(controlPush.data.slice(1, 33))
                                        .map(b => b.toString(16).padStart(2, '0')).join('');
                                    sections.push({
                                        type: 'internalPubkey',
                                        start: baseOffset + controlPush.dataStart + 1,
                                        end: baseOffset + controlPush.dataStart + 33,
                                        label: 'Internal Pubkey',
                                        value: internalPubkey.substring(0, 16) + '...',
                                        cssClass: 'decode-internalPubkey'
                                    });
                                }
                                
                                // If there's more data (merkle proof), add it
                                if (controlPush.data.length > 33) {
                                    const merkleBytes = controlPush.data.length - 33;
                                    sections.push({
                                        type: 'merkleProof',
                                        start: baseOffset + controlPush.dataStart + 33,
                                        end: baseOffset + controlPush.dataEnd,
                                        label: 'Merkle Proof',
                                        value: `${merkleBytes} bytes (${Math.floor(merkleBytes / 32)} hashes)`,
                                        cssClass: 'decode-merkleProof'
                                    });
                                }
                            }
                        }
                        
                        break;
                    }
                    
                    // Read tag
                    const tagPush = readPushData();
                    if (!tagPush) break;
                    
                    const tag = tagPush.data;
                    
                    // Empty tag = body start
                    if (tag.length === 0) {
                        sections.push({
                            type: 'inscriptionBodyTag',
                            start: baseOffset + tagPush.start,
                            end: baseOffset + tagPush.end,
                            label: 'Body Tag',
                            value: 'OP_0 (body start)',
                            cssClass: 'decode-inscriptionBodyTag'
                        });
                        
                        // Read body chunks until OP_ENDIF
                        let chunkIndex = 0;
                        let totalBodySize = 0;
                        while (pos < script.length && script[pos] !== 0x68) {
                            const chunkPush = readPushData();
                            if (!chunkPush) break;
                            
                            const chunkData = chunkPush.data;
                            totalBodySize += chunkData.length;
                            
                            // Add push opcode marker section (if not direct push)
                            if (chunkPush.opcodeType !== 'direct' && chunkPush.opcodeType !== 'OP_0') {
                                sections.push({
                                    type: 'inscriptionPushOpcode',
                                    start: baseOffset + chunkPush.opcodeStart,
                                    end: baseOffset + chunkPush.opcodeEnd,
                                    label: `Push Marker ${chunkIndex}`,
                                    value: `${chunkPush.opcodeType} (${chunkPush.opcodeLen} bytes)`,
                                    cssClass: 'decode-inscriptionPushOpcode'
                                });
                            }
                            
                            // Add the data section
                            if (chunkData.length > 0) {
                                // Try to preview chunk content
                                let chunkPreview = `${chunkData.length} bytes`;
                                if (contentType && contentType.includes('text') && chunkData.length > 0) {
                                    try {
                                        const text = new TextDecoder().decode(chunkData);
                                        chunkPreview = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                                    } catch (e) {
                                        // Keep byte count
                                    }
                                }
                                
                                sections.push({
                                    type: 'inscriptionBodyChunk',
                                    start: baseOffset + chunkPush.dataStart,
                                    end: baseOffset + chunkPush.dataEnd,
                                    label: `Body Chunk ${chunkIndex}`,
                                    value: chunkPreview,
                                    cssClass: 'decode-inscriptionBodyChunk'
                                });
                            }
                            
                            bodyChunks.push(chunkData);
                            chunkIndex++;
                        }
                        continue;
                    }
                    
                    // Tag [1] = content type
                    if (tag.length === 1 && tag[0] === 1) {
                        sections.push({
                            type: 'inscriptionContentTypeTag',
                            start: baseOffset + tagPush.start,
                            end: baseOffset + tagPush.end,
                            label: 'Content-Type Tag',
                            value: '0x01',
                            cssClass: 'decode-inscriptionContentTypeTag'
                        });
                        
                        // Read content type value
                        const valuePush = readPushData();
                        if (valuePush) {
                            contentType = String.fromCharCode(...valuePush.data);
                            sections.push({
                                type: 'inscriptionContentType',
                                start: baseOffset + valuePush.start,
                                end: baseOffset + valuePush.end,
                                label: 'Content-Type',
                                value: contentType,
                                cssClass: 'decode-inscriptionContentType'
                            });
                        }
                        continue;
                    }
                    
                    // Other tags (unknown)
                    sections.push({
                        type: 'inscriptionUnknownTag',
                        start: baseOffset + tagPush.start,
                        end: baseOffset + tagPush.end,
                        label: 'Unknown Tag',
                        value: `0x${Array.from(tag).map(b => b.toString(16).padStart(2, '0')).join('')}`,
                        cssClass: 'decode-inscriptionUnknownTag'
                    });
                    
                    // Read and skip the value
                    const unknownValue = readPushData();
                    if (unknownValue) {
                        sections.push({
                            type: 'inscriptionUnknownValue',
                            start: baseOffset + unknownValue.start,
                            end: baseOffset + unknownValue.end,
                            label: 'Unknown Value',
                            value: `${unknownValue.data.length} bytes`,
                            cssClass: 'decode-inscriptionUnknownValue'
                        });
                    }
                }
                
                // If we found sections, return them
                if (sections.length > 0) {
                    return { sections, contentType, bodySize: bodyChunks.reduce((sum, c) => sum + c.length, 0) };
                }
            }
            pos++;
        }
        
        return null;
    }
    
    updateViewToggleButtons() {
        const hexBtn = document.getElementById('view-hex');
        const binaryBtn = document.getElementById('view-binary');
        const asciiBtn = document.getElementById('view-ascii');
        
        hexBtn.classList.remove('active');
        binaryBtn.classList.remove('active');
        asciiBtn.classList.remove('active');
        
        if (this.rawViewMode === 'hex') {
            hexBtn.classList.add('active');
        } else if (this.rawViewMode === 'binary') {
            binaryBtn.classList.add('active');
        } else {
            asciiBtn.classList.add('active');
        }
    }
    
    downloadRawData() {
        if (!this.rawTxData || !this.rawTxData.hex) return;
        
        const blob = new Blob([this.rawTxData.hex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transaction_${this.txid}.hex`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    copyRawData() {
        if (!this.rawTxData || !this.rawTxData.hex) return;
        
        const copyBtn = document.getElementById('copy-raw-data');
        
        navigator.clipboard.writeText(this.rawTxData.hex).then(() => {
            // Show feedback
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
            copyBtn.textContent = 'Error';
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
            }, 1500);
        });
    }
    
    showRawDataModal() {
        const modal = document.getElementById('raw-data-modal');
        modal.classList.add('active');
        document.body.classList.add('raw-data-open');
        
        // Update view toggle buttons to reflect current mode
        this.updateViewToggleButtons();
        
        // Update URL with rawdata parameter
        const url = new URL(window.location);
        url.searchParams.set('rawdata', 'open');
        window.history.pushState({}, '', url);
        
        // Trigger resize
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
    
    hideRawDataModal() {
        const modal = document.getElementById('raw-data-modal');
        modal.classList.remove('active');
        document.body.classList.remove('raw-data-open');
        
        // Update URL - remove rawdata parameter
        const url = new URL(window.location);
        url.searchParams.delete('rawdata');
        window.history.pushState({}, '', url);
        
        // Trigger resize
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinTransactionExplorer();
}); 