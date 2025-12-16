// Bitcoin Explorer - Block Page
class BitcoinBlockExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.transactions = [];
        this.isRotating = true;
        this.showTransactions = true;
        this.blockHeight = null;
        this.blockData = null;
        this.transactionIds = [];
        this.transactionCache = new Map(); // Cache for transaction details
        this.loadedTransactionCount = 0; // Track how many transactions have been loaded
        this.loadingModal = null; // Store loading modal reference
        this.isPerspective = true; // Track camera type
        this.orthographicZoom = 20; // Store orthographic zoom level
        this.isLoadingAll = false; // Track if load all is in progress
        this.shouldStopLoadingAll = false; // Flag to stop load all process
        this.chainTipHeight = null; // Store chain tip height
        this.rawBlockData = null; // Store raw block data for download
        this.rawViewMode = 'hex'; // 'hex' or 'ascii'
        this.blockHeaderData = null; // Store block header hex data
        this.headerMesh = null; // 3D mesh for block header
        this.headerAnimated = false; // Track if header has been animated up
        this.highlightedCuboid = null; // Track highlighted transaction in 3D
        this.hoveredCuboid = null; // Track hovered transaction for visual feedback
        
        // Decode mode properties
        this.decodeMode = false;
        this.decodedSections = null;
        this.decodeTooltip = null;
        this.highlightRange = null; // Track highlighted transaction byte range
        
        // Get block height and transaction ID from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        this.blockHeight = urlParams.get('height');
        this.focusTxid = urlParams.get('txid'); // Transaction to highlight on load
        this.bytesPerLine = urlParams.get('bytes'); // Bytes per line for raw data display
        this.urlViewMode = urlParams.get('view'); // View mode for raw data (hex/ascii/binary)
        this.urlDecodeMode = urlParams.get('decode') === 'on'; // Decode mode from URL
        this.urlRawDataOpen = urlParams.get('rawdata') === 'open'; // Whether raw data panel should be open
        
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

    async init() {
        this.setupThreeJS();
        this.setupControls();
        this.setupButtonControls();
        this.setupHoverTooltip();
        this.setupPanelToggle();
        
        // Apply bytes per line from URL parameter if provided
        if (this.bytesPerLine) {
            const validValues = ['16', '32', '64', '128', '256', '512'];
            if (validValues.includes(this.bytesPerLine)) {
                document.getElementById('bytes-per-line').value = this.bytesPerLine;
            }
        }
        
        // Fetch chain tip height before creating scene
        await this.fetchChainTipHeight();
        
        this.createScene();
        this.animate();
        this.fetchData();
        
        // Auto-open raw data panel if URL parameter is set
        if (this.urlRawDataOpen) {
            // Wait for block data to load first
            const waitForBlockData = setInterval(() => {
                if (this.blockData && this.blockData.id) {
                    clearInterval(waitForBlockData);
                    this.fetchRawBlockData();
                }
            }, 100);
        }
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 20);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupControls() {
        // Create custom orbit controls (matching other pages)
        this.controls = {
            target: new THREE.Vector3(0, 2, 0), // Moved center up by 1.21 units
            distance: 20,
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
                    // Rotation with inverted axes and reduced intensity
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
            if (this.isPerspective) {
                // Perspective camera zoom
                controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
                controls.distance = Math.max(1, Math.min(50, controls.distance)); // Allow much closer zoom
                controls.update();
            } else {
                // Orthographic camera zoom
                const zoomSpeed = 0.1;
                this.orthographicZoom -= e.deltaY * zoomSpeed; // Inverted: was +=, now -=
                this.orthographicZoom = Math.max(1, Math.min(50, this.orthographicZoom)); // Allow much closer zoom
                
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
                this.camera.position.set(0, 10, 20);
                this.controls.target.set(0, 2, 0);
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
                
                if (this.isPerspective) {
                    this.controls.distance *= zoomFactor;
                    this.controls.distance = Math.max(1, Math.min(50, this.controls.distance));
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(1, Math.min(50, this.orthographicZoom));
                    
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
    
    setupButtonControls() {
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        

        
        document.getElementById('load-transactions').addEventListener('click', () => {
            this.loadTransactionData();
        });
        
        document.getElementById('load-all-transactions').addEventListener('click', () => {
            if (this.isLoadingAll) {
                this.stopLoadingAll();
            } else {
                this.loadAllTransactions();
            }
        });
        
        document.getElementById('toggle-view').addEventListener('click', () => {
            this.toggleCameraView();
        });
        
        // Raw data button - toggle panel
        document.getElementById('show-raw-data').addEventListener('click', () => {
            const modal = document.getElementById('raw-data-modal');
            if (modal.classList.contains('active')) {
                this.hideRawDataModal();
            } else {
                this.fetchRawBlockData();
            }
        });
        
        // Raw data panel controls
        document.getElementById('close-raw-data').addEventListener('click', () => {
            this.hideRawDataModal();
        });
        
        document.getElementById('download-raw-data').addEventListener('click', () => {
            this.downloadRawData();
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
        
        // View toggle (Hex/ASCII)
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
                // Parse block if not already done
                if (!this.decodedSections && this.rawBlockData) {
                    this.decodedSections = this.parseBlock(this.rawBlockData.bytes);
                }
            } else {
                decodeBtn.classList.remove('active');
                legend.style.display = 'none';
            }
            
            const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
            
            // If there's an active highlight, preserve it when toggling decode mode
            if (this.highlightRange) {
                const hexStartPos = this.highlightRange.start * 2;
                const hexLength = (this.highlightRange.end - this.highlightRange.start) * 2;
                this.highlightTransaction(hexStartPos, hexLength);
            } else {
                // Re-render with or without decode highlighting
                this.reformatRawData(bytesPerLine);
            }
            
            // Update URL with decode parameter
            const url = new URL(window.location);
            if (this.decodeMode) {
                url.searchParams.set('decode', 'on');
            } else {
                url.searchParams.delete('decode');
            }
            window.history.pushState({}, '', url);
        });
        
        // Find transaction controls
        document.getElementById('find-tx-toggle').addEventListener('click', () => {
            const wrapper = document.getElementById('find-tx-input-wrapper');
            const toggle = document.getElementById('find-tx-toggle');
            wrapper.classList.toggle('hidden');
            if (!wrapper.classList.contains('hidden')) {
                document.getElementById('find-tx-input').focus();
                toggle.style.display = 'none';
            }
        });
        
        document.getElementById('find-tx-close').addEventListener('click', () => {
            document.getElementById('find-tx-input-wrapper').classList.add('hidden');
            document.getElementById('find-tx-toggle').style.display = '';
            document.getElementById('find-tx-input').value = '';
            document.getElementById('find-tx-result').textContent = '';
            this.clearHighlight();
            this.clearCuboid3DHighlight();
            
            // Remove txid from URL
            const url = new URL(window.location);
            url.searchParams.delete('txid');
            window.history.pushState({}, '', url);
        });
        
        document.getElementById('find-tx-btn').addEventListener('click', () => {
            this.findTransactionInRawData();
        });
        
        document.getElementById('find-tx-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.findTransactionInRawData();
            }
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
            // Calculate mouse position in normalized device coordinates relative to canvas
            const rect = this.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.scene.children, true);

            if (intersects.length > 0) {
                // Look for the first interactive object (transaction or block)
                let foundInteraction = false;
                
                // Check for transactions first (higher priority)
                let hoveredTx = null;
                for (let i = 0; i < intersects.length && !foundInteraction; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    if (this.transactions.includes(intersectedObject)) {
                        const txData = intersectedObject.userData;
                        hoveredTx = intersectedObject;
                        
                        // Check if we have detailed data cached for this transaction
                        const txid = txData.txid;
                        let tooltipContent;
                        
                        if (txid && this.transactionCache.has(txid)) {
                            // Use cached detailed content
                            tooltipContent = this.transactionCache.get(txid);
                            tooltip.style.pointerEvents = 'auto'; // Enable close button
                        } else {
                            // Use basic content
                            tooltipContent = `
                                <strong>Transaction ${txData.index + 1}</strong><br>
                                TXID: ${txid ? txid.substring(0, 16) + '...' : 'Loading...'}<br>
                                <em style="color:#888;font-size:10px">Shift+Click: Find in raw data</em>
                            `;
                            tooltip.style.pointerEvents = 'none'; // No interaction needed
                        }
                        
                        tooltip.innerHTML = tooltipContent;
                        tooltip.style.display = 'block';
                        tooltip.style.left = event.clientX + 10 + 'px';
                        tooltip.style.top = event.clientY - 10 + 'px';
                        foundInteraction = true;
                    }
                }
                
                // Update hover highlight (only if not in highlight mode)
                if (!this.highlightedCuboid) {
                    if (hoveredTx !== this.hoveredCuboid) {
                        // Clear previous hover
                        if (this.hoveredCuboid) {
                            this.hoveredCuboid.material.opacity = 0.8;
                            this.hoveredCuboid.scale.x = 1;
                            this.hoveredCuboid.scale.z = 1;
                        }
                        // Set new hover - make it brighter and slightly larger
                        if (hoveredTx) {
                            hoveredTx.material.opacity = 1;
                            hoveredTx.scale.x = 1.5;
                            hoveredTx.scale.z = 1.5;
                        }
                        this.hoveredCuboid = hoveredTx;
                    }
                }
                
                // If no transaction found, check for header
                if (!foundInteraction) {
                    for (let i = 0; i < intersects.length && !foundInteraction; i++) {
                        const intersectedObject = intersects[i].object;
                        
                        // Check if it's the header
                        if (intersectedObject.userData && intersectedObject.userData.type === 'header') {
                            let tooltipContent = `
                                <strong>Block Header</strong><br>
                                Size: 80 bytes<br>
                                <br>
                                <em>Contains:</em><br>
                                • Version (4 bytes)<br>
                                • Previous Block Hash (32 bytes)<br>
                                • Merkle Root (32 bytes)<br>
                                • Timestamp (4 bytes)<br>
                                • Difficulty Target (4 bytes)<br>
                                • Nonce (4 bytes)
                            `;
                            
                            if (this.blockHeaderData) {
                                tooltipContent += `<br><br><em>Hex: ${this.blockHeaderData.substring(0, 24)}...</em>`;
                            }
                            
                            tooltip.innerHTML = tooltipContent;
                            tooltip.style.display = 'block';
                            tooltip.style.left = event.clientX + 10 + 'px';
                            tooltip.style.top = event.clientY - 10 + 'px';
                            tooltip.style.pointerEvents = 'none';
                            foundInteraction = true;
                        }
                    }
                }
                
                // If no header found, check for blocks
                if (!foundInteraction) {
                    for (let i = 0; i < intersects.length && !foundInteraction; i++) {
                        const intersectedObject = intersects[i].object;
                        
                        // Check if it's a block (but not the header)
                        if (intersectedObject.geometry.type === 'BoxGeometry' && 
                            intersectedObject.geometry.parameters.width === 3 &&
                            (!intersectedObject.userData || intersectedObject.userData.type !== 'header')) {
                            
                            // Calculate which block this is based on its Z position
                            // Past blocks are at positive Z, future blocks are at negative Z
                            const blockIndex = Math.round(intersectedObject.position.z / 4);
                            const currentHeight = parseInt(this.blockHeight) || 0;
                            const targetHeight = currentHeight - blockIndex; // Negative for past, positive for future
                            
                            let tooltipContent;
                            if (blockIndex === 0) {
                                tooltipContent = `
                                    <strong>Current Block</strong><br>
                                    Height: ${currentHeight}<br>
                                    <em>Double-click to stay on this block</em>
                                `;
                            } else {
                                tooltipContent = `
                                    <strong>Block</strong><br>
                                    Height: ${targetHeight}<br>
                                    <em>Double-click to view this block</em>
                                `;
                            }
                            
                            tooltip.innerHTML = tooltipContent;
                            tooltip.style.display = 'block';
                            tooltip.style.left = event.clientX + 10 + 'px';
                            tooltip.style.top = event.clientY - 10 + 'px';
                            tooltip.style.pointerEvents = 'none'; // No interaction needed for blocks
                            foundInteraction = true;
                        }
                    }
                }
                
                if (!foundInteraction) {
                    tooltip.style.display = 'none';
                    tooltip.style.pointerEvents = 'none';
                    
                    // Clear hover if not hovering any transaction
                    if (this.hoveredCuboid && !this.highlightedCuboid) {
                        this.hoveredCuboid.material.opacity = 0.8;
                        this.hoveredCuboid.scale.x = 1;
                        this.hoveredCuboid.scale.z = 1;
                        this.hoveredCuboid = null;
                    }
                }
            } else {
                tooltip.style.display = 'none';
                tooltip.style.pointerEvents = 'none'; // Reset pointer events for hover mode
                
                // Clear hover when nothing intersected
                if (this.hoveredCuboid && !this.highlightedCuboid) {
                    this.hoveredCuboid.material.opacity = 0.8;
                    this.hoveredCuboid.scale.x = 1;
                    this.hoveredCuboid.scale.z = 1;
                    this.hoveredCuboid = null;
                }
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            tooltip.style.pointerEvents = 'none'; // Reset pointer events for hover mode
            
            // Clear hover highlight
            if (this.hoveredCuboid && !this.highlightedCuboid) {
                this.hoveredCuboid.material.opacity = 0.8;
                this.hoveredCuboid.scale.x = 1;
                this.hoveredCuboid.scale.z = 1;
                this.hoveredCuboid = null;
            }
        });
        
        // Add single-click functionality to fetch detailed transaction data
        this.renderer.domElement.addEventListener('click', (event) => {
            // Calculate mouse position in normalized device coordinates relative to canvas
            const rect = this.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray - check all objects
            const intersects = raycaster.intersectObjects(this.scene.children, true);

            if (intersects.length > 0) {
                // Look for the first transaction in the intersects
                for (let i = 0; i < intersects.length; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    // Check if it's a transaction (in our transactions array)
                    if (this.transactions.includes(intersectedObject)) {
                        const txData = intersectedObject.userData;
                        
                        if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                            // Shift+Click: Find and highlight in raw data
                            if (event.shiftKey) {
                                this.findTransactionInRawDataByTxid(txData.txid);
                            } else {
                                // Normal click: Show detailed transaction data (cached or fetch new)
                                this.showTransactionDetails(txData.txid, tooltip, event);
                            }
                        }
                        break; // Stop after finding the first transaction
                    }
                }
            }
        });
        
        // Add double-click functionality to navigate to transaction page
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            // Calculate mouse position in normalized device coordinates relative to canvas
            const rect = this.renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.camera);

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.scene.children, true);

            if (intersects.length > 0) {
                // Look for the first interactive object (transaction or block)
                for (let i = 0; i < intersects.length; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    // Check if it's a transaction first (higher priority)
                    if (this.transactions.includes(intersectedObject)) {
                        const txData = intersectedObject.userData;
                        
                        // Navigate to transaction page with TXID parameter
                        if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                            window.location.href = `transaction.html?txid=${txData.txid}`;
                        }
                        return; // Exit after handling transaction
                    }
                }
                
                // If no transaction was clicked, check for blocks
                for (let i = 0; i < intersects.length; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    // Check if it's a block (has the same geometry as our blocks)
                    if (intersectedObject.geometry.type === 'BoxGeometry' && 
                        intersectedObject.geometry.parameters.width === 3) {
                        
                        // Calculate which block was clicked based on its Z position
                        // Past blocks are at positive Z, future blocks are at negative Z
                        const blockIndex = Math.round(intersectedObject.position.z / 4);
                        
                        if (blockIndex === 0) {
                            // Current block - stay on same page
                            console.log('Current block clicked');
                        } else {
                            // Past or future block - navigate to that block's height
                            const currentHeight = parseInt(this.blockHeight) || 0;
                            const targetHeight = currentHeight - blockIndex; // Negative for past, positive for future
                            
                            console.log(`Navigating to block height: ${targetHeight}`);
                            window.location.href = `block.html?height=${targetHeight}`;
                        }
                        return; // Exit after handling block
                    }
                }
            }
        });
    }
    

    
    animatePosition(object, targetX, targetY, targetZ, duration) {
        const startX = object.position.x;
        const startY = object.position.y;
        const startZ = object.position.z;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            object.position.x = startX + (targetX - startX) * easeOut;
            object.position.y = startY + (targetY - startY) * easeOut;
            object.position.z = startZ + (targetZ - startZ) * easeOut;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
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
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
    
    async loadAllTransactions() {
        if (this.transactions.length === 0) {
            console.log('No transactions to load');
            return;
        }
        
        if (this.isLoadingAll) {
            console.log('Load all already in progress');
            return;
        }
        
        // Reset stop flag
        this.shouldStopLoadingAll = false;
        
        const button = document.getElementById('load-all-transactions');
        const loadTransactionsButton = document.getElementById('load-transactions');
        const originalText = button.textContent;
        
        // Update button to show it can be clicked to stop
        button.textContent = 'Stop Loading';
        loadTransactionsButton.disabled = true;
        this.isLoadingAll = true;
        
        // Calculate total transactions to load and filter out already loaded ones
        const transactionsWithData = this.transactions.filter(tx => 
            tx.userData.txid && !tx.userData.txid.startsWith('dummy_tx_')
        );
        
        // Filter out transactions that are fully loaded (have transactionData and position animated)
        const unloadedTransactions = transactionsWithData.filter(tx => 
            !tx.userData.transactionData
        );
        
        // Find transactions that have size loaded but position not animated
        const sizeOnlyTransactions = transactionsWithData.filter(tx =>
            tx.userData.transactionData && tx.userData.sizeOnlyLoaded
        );
        
        const totalToLoad = transactionsWithData.length;
        const fullyLoaded = totalToLoad - unloadedTransactions.length - sizeOnlyTransactions.length;
        const remainingToLoad = unloadedTransactions.length + sizeOnlyTransactions.length;
        let loadedCount = fullyLoaded; // Start count from fully loaded
        let errorCount = 0;
        
        if (remainingToLoad === 0) {
            console.log('All transactions already loaded');
            button.textContent = 'All Loaded';
            button.disabled = true;
            loadTransactionsButton.disabled = true;
            this.isLoadingAll = false;
            return;
        }
        
        // First, animate position for size-only loaded transactions (no API call needed)
        for (const cuboid of sizeOnlyTransactions) {
            if (this.shouldStopLoadingAll) break;
            
            const layer = cuboid.userData.layer;
            const baseAlignedY = 2;
            const spacingY = 0.3;
            const alignedY = baseAlignedY - layer * spacingY;
            
            this.animateCuboidPosition(cuboid, alignedY, 500);
            cuboid.userData.sizeOnlyLoaded = false;
            
            // Animate header if needed
            if (!this.headerAnimated && this.headerMesh && layer === 0) {
                const headerTargetY = baseAlignedY + 0.19;
                this.animateCuboidPosition(this.headerMesh, headerTargetY, 500);
                this.headerAnimated = true;
            }
            
            loadedCount++;
            button.textContent = `Stop Loading (${loadedCount}/${totalToLoad})`;
        }
        
        console.log(`Loading remaining ${unloadedTransactions.length} transactions (${sizeOnlyTransactions.length} position-animated, ${fullyLoaded} fully loaded) with 0.005s delay between requests...`);
        
        // Load transactions one by one with delay (only unloaded ones)
        for (let i = 0; i < unloadedTransactions.length; i++) {
            // Check if user wants to stop
            if (this.shouldStopLoadingAll) {
                console.log('Load all stopped by user');
                break;
            }
            
            const cuboid = unloadedTransactions[i];
            const txData = cuboid.userData;
            
            try {
                await this.loadSingleTransaction(cuboid, txData.txid, txData.index, 0);
                loadedCount++;
                
                // Update button text with progress (but keep stop functionality)
                button.textContent = `Stop Loading (${loadedCount}/${totalToLoad})`;
                
                // Update loaded transaction count
                this.loadedTransactionCount = Math.max(this.loadedTransactionCount, txData.index + 1);
                
                //console.log(`Loaded transaction ${loadedCount}/${totalToLoad}: ${txData.txid.substring(0, 16)}...`);
                
            } catch (error) {
                errorCount++;
                console.warn(`Failed to load transaction ${i + 1}:`, error);
            }
            
            // Add delay between requests (except for the last one)
            if (i < unloadedTransactions.length - 1 && !this.shouldStopLoadingAll) {
                await new Promise(resolve => setTimeout(resolve, 5)); // 0.005 second delay (20x faster than original)
            }
        }
        
        // Reset button states
        this.isLoadingAll = false;
        this.shouldStopLoadingAll = false;
        
        if (this.shouldStopLoadingAll || loadedCount < totalToLoad) {
            button.textContent = `Stopped (${loadedCount}/${totalToLoad})`;
        } else if (errorCount > 0) {
            button.textContent = `Loaded All (${errorCount} failed)`;
        } else {
            button.textContent = 'All Loaded';
        }
        
        // Update the regular load button
        const remainingTransactions = this.transactions.length - this.loadedTransactionCount;
        if (remainingTransactions > 0) {
            loadTransactionsButton.textContent = `Load Next ${Math.min(20, remainingTransactions)}`;
            loadTransactionsButton.disabled = false;
        } else {
            loadTransactionsButton.textContent = 'All Loaded';
            loadTransactionsButton.disabled = true;
        }
        
        console.log(`Load all completed: ${loadedCount} loaded, ${errorCount} failed`);
    }
    
    stopLoadingAll() {
        console.log('Stopping load all process...');
        this.shouldStopLoadingAll = true;
        
        const button = document.getElementById('load-all-transactions');
        button.textContent = 'Stopping...';
    }
    
    async loadTransactionData() {
        if (this.transactions.length === 0) {
            console.log('No transactions to load');
            return;
        }
        
        const button = document.getElementById('load-transactions');
        const originalText = button.textContent;
        button.textContent = 'Loading...';
        button.disabled = true;
        
        // Calculate the next batch of transactions to load
        const batchSize = 20;
        const startIndex = this.loadedTransactionCount;
        const endIndex = Math.min(startIndex + batchSize, this.transactions.length);
        const transactionsToLoad = endIndex - startIndex;
        
        if (transactionsToLoad === 0) {
            console.log('All transactions have been loaded');
            button.textContent = 'All Loaded';
            button.disabled = true;
            return;
        }
        
        console.log(`Loading transaction data for ${transactionsToLoad} transactions (${startIndex + 1}-${endIndex} out of ${this.transactions.length} total)`);
        
        let loadedCount = 0;
        let errorCount = 0;
        
        try {
            // Process the next batch of transactions
            const promises = [];
            
            for (let i = startIndex; i < endIndex; i++) {
                const cuboid = this.transactions[i];
                const txData = cuboid.userData;
                
                // Skip dummy transactions
                if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                    promises.push(this.loadSingleTransaction(cuboid, txData.txid, i, i - startIndex));
                } else {
                    loadedCount++;
                }
            }
            
            // Wait for all transactions to complete and handle individual errors
            const results = await Promise.allSettled(promises);
            
            // Count successful loads and errors
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    loadedCount++;
                } else {
                    errorCount++;
                    console.warn('Transaction load failed:', result.reason);
                }
            });
            
            // Update progress - only count successful loads for loadedTransactionCount
            const successfulLoads = results.filter(r => r.status === 'fulfilled').length;
            this.loadedTransactionCount += successfulLoads;
            
            console.log(`Completed batch: ${loadedCount} loaded, ${errorCount} failed (${startIndex + 1}-${endIndex} out of ${this.transactions.length} total)`);
            
            // Update button text based on remaining transactions
            const remainingTransactions = this.transactions.length - this.loadedTransactionCount;
            if (remainingTransactions > 0) {
                if (errorCount > 0) {
                    button.textContent = `Load Next ${Math.min(batchSize, remainingTransactions)} (${errorCount} failed)`;
                } else {
                    button.textContent = `Load Next ${Math.min(batchSize, remainingTransactions)}`;
                }
            } else {
                button.textContent = 'All Loaded';
                button.disabled = true;
            }
            
        } catch (error) {
            console.error('Error in transaction loading batch:', error);
            button.textContent = originalText;
        } finally {
            // Always re-enable the button unless all transactions are loaded
            if (this.loadedTransactionCount < this.transactions.length) {
                button.disabled = false;
            }
        }
    }
    
    async loadSingleTransaction(cuboid, txid, globalIndex, batchIndex) {
        try {
            // Fetch transaction data from mempool.space API
            const response = await fetch(`https://mempool.space/api/tx/${txid}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const txData = await response.json();
            
            // Calculate new height based on transaction size (matching address.js calculation)
            const txSize = txData.size || 200; // Default size if not available
            // Scale height based on transaction size: Math.max(0.1, txSize / 1000)
            const height = Math.max(0.1, txSize / 1000); // Scale height based on transaction size
            
            // Animate the height change (scale.y starts at 1.0) and adjust position to keep top-aligned
            this.animateCuboidHeightTopAligned(cuboid, height, 100);
            
            // Move loaded transactions maintaining their layer spacing
            const baseAlignedY = 2; // Base Y position for layer 0 loaded transactions
            const layer = cuboid.userData.layer;
            const spacingY = 0.3; // Same spacing as used in original grid
            const alignedY = baseAlignedY - layer * spacingY; // Maintain layer spacing
            
            // Animate only the Y position upward to the aligned level
            this.animateCuboidPosition(cuboid, alignedY, 500);
            
            // Animate header up with the first transaction (layer 0)
            if (!this.headerAnimated && this.headerMesh && layer === 0) {
                const headerTargetY = baseAlignedY + 0.19; // Keep same offset above transactions
                this.animateCuboidPosition(this.headerMesh, headerTargetY, 500);
                this.headerAnimated = true;
            }
            
            // Update the transaction cache with detailed information
            const tooltipContent = this.createDetailedTooltipContent(txData, txid);
            this.transactionCache.set(txid, tooltipContent);
            
            // Update cuboid userData with transaction details
            cuboid.userData.transactionData = txData;
            cuboid.userData.size = txSize;
            cuboid.userData.sizeOnlyLoaded = false; // Position has been animated
            
            console.log(`Loaded transaction ${globalIndex + 1}: ${txid.substring(0, 16)}... (size: ${txSize} bytes)`);
            
        } catch (error) {
            console.error(`Error loading transaction ${globalIndex + 1} (${txid}):`, error);
            // Re-throw the error so Promise.allSettled can catch it
            throw error;
        }
    }
    
    animateCuboidHeight(cuboid, targetHeight, duration) {
        const startHeight = cuboid.scale.y;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            const newHeight = startHeight + (targetHeight - startHeight) * easeOut;
            cuboid.scale.y = newHeight;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    animateCuboidHeightTopAligned(cuboid, targetHeight, duration) {
        const startHeight = cuboid.scale.y;
        const startY = cuboid.position.y;
        const startTime = Date.now();
        
        // Calculate the original cuboid height (before scaling)
        const originalHeight = 0.07; // CUBOID_HEIGHT from geometry creation
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            const newHeight = startHeight + (targetHeight - startHeight) * easeOut;
            cuboid.scale.y = newHeight;
            
            // Adjust Y position to keep top edge aligned
            // When scale increases, move down by half the height increase to keep top aligned
            const heightDifference = (newHeight - 1.0) * originalHeight;
            const adjustedY = startY - (heightDifference / 2);
            cuboid.position.y = adjustedY;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    animateCuboidPosition(cuboid, targetY, duration) {
        const startY = cuboid.position.y;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            const newY = startY + (targetY - startY) * easeOut;
            cuboid.position.y = newY;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    animateCuboidToPosition(cuboid, targetX, targetY, targetZ, duration) {
        const startX = cuboid.position.x;
        const startY = cuboid.position.y;
        const startZ = cuboid.position.z;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            
            const newX = startX + (targetX - startX) * easeOut;
            const newY = startY + (targetY - startY) * easeOut;
            const newZ = startZ + (targetZ - startZ) * easeOut;
            
            cuboid.position.x = newX;
            cuboid.position.y = newY;
            cuboid.position.z = newZ;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    createDetailedTooltipContent(txData, txid) {
        // Format inputs
        const inputsHtml = txData.vin.slice(0, 3).map((input, index) => {
            const amount = input.prevout ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
            const address = input.prevout ? (input.prevout.scriptpubkey_address || 'Unknown') : 'Unknown';
            return `Input ${index + 1}: ${amount} BTC (${address.substring(0, 12)}...)`;
        }).join('<br>');
        
        const moreInputs = txData.vin.length > 3 ? `<br>+${txData.vin.length - 3} more inputs` : '';
        
        // Format outputs
        const outputsHtml = txData.vout.slice(0, 3).map((output, index) => {
            const amount = (output.value / 100000000).toFixed(8);
            const address = output.scriptpubkey_address || 'Unknown';
            return `Output ${index + 1}: ${amount} BTC (${address.substring(0, 12)}...)`;
        }).join('<br>');
        
        const moreOutputs = txData.vout.length > 3 ? `<br>+${txData.vout.length - 3} more outputs` : '';
        
        // Calculate total input and output amounts
        const totalInput = txData.vin.reduce((sum, input) => {
            return sum + (input.prevout ? input.prevout.value : 0);
        }, 0) / 100000000;
        
        const totalOutput = txData.vout.reduce((sum, output) => {
            return sum + output.value;
        }, 0) / 100000000;
        
        const fee = (txData.fee / 100000000).toFixed(8);
        
        return `
            <strong>Transaction Details</strong><br>
            <strong>TXID:</strong> ${txid.substring(0, 16)}...<br>
            <strong>Size:</strong> ${txData.size} bytes<br>
            <strong>Fee:</strong> ${fee} BTC<br>
            <br>
            <strong>Inputs (${txData.vin.length}):</strong><br>
            ${inputsHtml}${moreInputs}<br>
            <strong>Total Input:</strong> ${totalInput.toFixed(8)} BTC<br>
            <br>
            <strong>Outputs (${txData.vout.length}):</strong><br>
            ${outputsHtml}${moreOutputs}<br>
            <strong>Total Output:</strong> ${totalOutput.toFixed(8)} BTC<br>
            <br>
            <em>Double-click to view full transaction</em>
        `;
    }
    
    async showTransactionDetails(txid, tooltip, event) {
        // Check if transaction data is already cached
        if (this.transactionCache.has(txid)) {
            const cachedTooltipContent = this.transactionCache.get(txid);
            tooltip.innerHTML = cachedTooltipContent;
            tooltip.style.pointerEvents = 'auto'; // Enable pointer events for close button
            // Don't change position or visibility - keep current state
            return;
        }
        
        try {
            // Show loading state in existing tooltip
            tooltip.innerHTML = `
                <strong>Loading Transaction Details...</strong><br>
                TXID: ${txid.substring(0, 16)}...
            `;
            // Keep current position and visibility
            
            // Fetch transaction data from mempool.space API
            const response = await fetch(`https://mempool.space/api/tx/${txid}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const txData = await response.json();
            
            // Format inputs
            const inputsHtml = txData.vin.slice(0, 3).map((input, index) => {
                const amount = input.prevout ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
                const address = input.prevout ? (input.prevout.scriptpubkey_address || 'Unknown') : 'Unknown';
                return `Input ${index + 1}: ${amount} BTC (${address.substring(0, 12)}...)`;
            }).join('<br>');
            
            const moreInputs = txData.vin.length > 3 ? `<br>+${txData.vin.length - 3} more inputs` : '';
            
            // Format outputs
            const outputsHtml = txData.vout.slice(0, 3).map((output, index) => {
                const amount = (output.value / 100000000).toFixed(8);
                const address = output.scriptpubkey_address || 'Unknown';
                return `Output ${index + 1}: ${amount} BTC (${address.substring(0, 12)}...)`;
            }).join('<br>');
            
            const moreOutputs = txData.vout.length > 3 ? `<br>+${txData.vout.length - 3} more outputs` : '';
            
            // Calculate total input and output amounts
            const totalInput = txData.vin.reduce((sum, input) => {
                return sum + (input.prevout ? input.prevout.value : 0);
            }, 0) / 100000000;
            
            const totalOutput = txData.vout.reduce((sum, output) => {
                return sum + output.value;
            }, 0) / 100000000;
            
            const fee = (txData.fee / 100000000).toFixed(8);
            
            // Update tooltip with detailed transaction information
            const tooltipContent = `
                <strong>Transaction Details</strong><br>
                <strong>TXID:</strong> ${txid.substring(0, 16)}...<br>
                <strong>Size:</strong> ${txData.size} bytes<br>
                <strong>Fee:</strong> ${fee} BTC<br>
                <br>
                <strong>Inputs (${txData.vin.length}):</strong><br>
                ${inputsHtml}${moreInputs}<br>
                <strong>Total Input:</strong> ${totalInput.toFixed(8)} BTC<br>
                <br>
                <strong>Outputs (${txData.vout.length}):</strong><br>
                ${outputsHtml}${moreOutputs}<br>
                <strong>Total Output:</strong> ${totalOutput.toFixed(8)} BTC<br>
                <br>
                <em>Double-click to view full transaction</em>
            `;
            
            // Cache the tooltip content for future use
            this.transactionCache.set(txid, tooltipContent);
            
            tooltip.innerHTML = tooltipContent;
            tooltip.style.pointerEvents = 'auto'; // Enable pointer events for close button
            // Keep current position and visibility
            
            // Keep tooltip visible until manually dismissed (no auto-hide for cached content)
            
        } catch (error) {
            console.error('Error fetching transaction details:', error);
            tooltip.innerHTML = `
                <strong>Error Loading Transaction</strong><br>
                TXID: ${txid.substring(0, 16)}...<br>
                <em>Failed to fetch transaction data</em>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = event.clientX + 10 + 'px';
            tooltip.style.top = event.clientY - 10 + 'px';
            
            // Auto-hide error after 5 seconds
            setTimeout(() => {
                if (tooltip.style.display === 'block') {
                    tooltip.style.display = 'none';
                }
            }, 5000);
        }
    }

    createScene() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        // Add fill light on opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, -10, -5);
        this.scene.add(fillLight);
        
        // Removed grid helper for cleaner visualization
        
        this.createBlockVisualization();
    }

    createBlockVisualization() {
        // Get current height for both future and past block calculations
        const currentHeight = parseInt(this.blockHeight) || 0;
        
        // Create main block as perfect cube with lower opacity
        const blockGeometry = new THREE.BoxGeometry(3, 3, 3);
        const blockMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,  // Prevent depth writing issues with transparency
            alphaTest: 0.01     // Helps with transparency sorting
        });
        
        // Create current block
        const block = new THREE.Mesh(blockGeometry, blockMaterial);
        block.position.set(0, 0, 0);
        block.castShadow = true;
        block.renderOrder = 1;  // Render after transactions (higher number = later)
        this.scene.add(block);
        
        // Store block reference for later use
        this.blockMesh = block;
        
        // Create block header representation (80 bytes)
        // Using same scale as transactions: width spans tx grid, height = max(0.1, 80/1000) = 0.1
        const HEADER_WIDTH = 2.5;  // Spans the transaction grid (10 cols * 0.25 spacing)
        const HEADER_HEIGHT = 0.01;  // Thin slice representing 80 bytes
        const HEADER_DEPTH = 0.01;  // Same depth as transaction cuboids
        
        const headerGeometry = new THREE.BoxGeometry(HEADER_WIDTH, HEADER_HEIGHT, HEADER_DEPTH);
        const headerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        this.headerMesh = new THREE.Mesh(headerGeometry, headerMaterial);
        this.headerMesh.position.set(0, 1.4, -1.125); // Position at front of block, aligned with first transaction row
        this.headerMesh.renderOrder = 0;
        this.headerMesh.userData = { type: 'header', description: 'Block Header (80 bytes)' };
        this.scene.add(this.headerMesh);
        
        // Create past blocks in front of the current block (only if current height allows)
        const maxPastBlocks = Math.min(5, currentHeight); // Don't show more past blocks than available
        
        for (let i = 1; i <= maxPastBlocks; i++) {
            const prevBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            prevBlock.position.set(0, 0, i * 4); // Position each block 4 units in front of the previous
            prevBlock.castShadow = true;
            prevBlock.renderOrder = 1;
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            prevBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(prevBlock);
        }
        
        // Create future blocks behind the current block (limited by chain tip)
        const maxFutureBlocks = this.chainTipHeight ? Math.max(0, this.chainTipHeight - currentHeight) : 5;
        const futureBlocksToShow = Math.min(5, maxFutureBlocks); // Cap at 5 blocks maximum
        
        console.log(`Current height: ${currentHeight}, Chain tip: ${this.chainTipHeight}, Future blocks to show: ${futureBlocksToShow}`);
        console.log(`Example behavior: ?height=${currentHeight} with chain tip ${this.chainTipHeight}: Shows ${futureBlocksToShow} future blocks`);
        
        for (let i = 1; i <= futureBlocksToShow; i++) {
            const nextBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            nextBlock.position.set(0, 0, -i * 4); // Position each block 4 units behind the previous
            nextBlock.castShadow = true;
            nextBlock.renderOrder = 1;
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            nextBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(nextBlock);
        }
    }

    async fetchChainTipHeight() {
        try {
            console.log('Fetching chain tip height...');
            const tipResponse = await fetch('https://mempool.space/api/blocks/tip/height');
            
            if (tipResponse.status === 429) {
                console.warn('Rate limit exceeded when fetching chain tip, using fallback');
                this.chainTipHeight = null;
                return;
            }
            
            if (!tipResponse.ok) {
                console.warn(`Failed to fetch chain tip: HTTP ${tipResponse.status}`);
                this.chainTipHeight = null;
                return;
            }
            
            this.chainTipHeight = parseInt(await tipResponse.text());
            console.log(`Fetched chain tip height: ${this.chainTipHeight}`);
            
            // If no block height provided, use chain tip
            if (!this.blockHeight) {
                this.blockHeight = this.chainTipHeight.toString();
                console.log(`Using chain tip as block height: ${this.blockHeight}`);
            }
        } catch (error) {
            console.warn('Error fetching chain tip height:', error);
            this.chainTipHeight = null;
        }
    }

    async fetchData() {
        this.showLoadingModal('Loading block data...');
        
        try {
            
            this.updateLoadingProgress('Fetching block hash...', 30);
            // Fetch block data from Mempool.space using height
            const response = await fetch(`https://mempool.space/api/block-height/${this.blockHeight}`);
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Get the block hash from the height
            const blockHash = await response.text();
            
            this.updateLoadingProgress('Fetching block details...', 50);
            // Now fetch the full block data using the hash
            const blockResponse = await fetch(`https://mempool.space/api/v1/block/${blockHash}`);
            
            if (blockResponse.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!blockResponse.ok) {
                throw new Error(`HTTP error! status: ${blockResponse.status}`);
            }
            
            this.blockData = await blockResponse.json();
            
            this.updateLoadingProgress('Fetching transaction IDs...', 60);
            // Fetch transaction IDs for this block
            const txidsResponse = await fetch(`https://mempool.space/api/block/${blockHash}/txids`);
            
            if (txidsResponse.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (txidsResponse.ok) {
                this.transactionIds = await txidsResponse.json();
                console.log(`Fetched ${this.transactionIds.length} transaction IDs for block ${this.blockHeight}`);
            } else {
                console.warn('Could not fetch transaction IDs, using fallback visualization');
                this.transactionIds = [];
            }
            
            this.updateLoadingProgress('Fetching block header...', 80);
            // Fetch block header (80 bytes)
            const headerResponse = await fetch(`https://mempool.space/api/block/${blockHash}/header`);
            
            if (headerResponse.ok) {
                this.blockHeaderData = await headerResponse.text();
                console.log(`Fetched block header: ${this.blockHeaderData.substring(0, 32)}...`);
            } else {
                console.warn('Could not fetch block header');
                this.blockHeaderData = null;
            }
            
            this.updateLoadingProgress('Creating visualization...', 90);
            this.updateUI(this.blockData);
            this.updateBlockVisualization();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
                
                // If a transaction ID was provided in URL, highlight it
                if (this.focusTxid) {
                    this.findTransactionInRawDataByTxid(this.focusTxid);
                }
            }, 500);
            
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching block data:', error);
            this.showGenericError('Block data');
            this.updateUI({});
        }
    }

    updateUI(data) {
        if (!data || Object.keys(data).length === 0) {
            document.getElementById('block-height').textContent = 'Loading...';
            document.getElementById('block-hash').textContent = 'Loading...';
            document.getElementById('block-size').textContent = 'Loading...';
            document.getElementById('block-tx-count').textContent = 'Loading...';
            document.getElementById('block-time').textContent = 'Loading...';
            document.getElementById('merkle-root').textContent = 'Loading...';
            document.getElementById('block-nonce').textContent = 'Loading...';
            document.getElementById('block-difficulty').textContent = 'Loading...';
            return;
        }
        
        // Update subtitle with block height and hash
        const subtitle = data.height ? 
            `Height ${data.height.toLocaleString()} • ${data.id ? data.id.substring(0, 6) + '...' + data.id.substring(data.id.length - 6) : 'Hash not available'}` : 
            'Not Found';
        document.getElementById('block-subtitle').textContent = subtitle;
        
        document.getElementById('block-height').textContent = data.height?.toLocaleString() || 'N/A';
        document.getElementById('block-hash').textContent = data.id?.substring(0, 16) + '...' || 'N/A';
        document.getElementById('block-size').textContent = data.size ? `${(data.size / 1024).toFixed(1)} KB` : 'N/A';
        document.getElementById('block-tx-count').textContent = data.tx_count?.toLocaleString() || 'N/A';
        
        const blockTime = data.timestamp ? this.formatDate(new Date(data.timestamp * 1000)) : 'N/A';
        document.getElementById('block-time').textContent = blockTime;
        document.getElementById('merkle-root').textContent = data.merkle_root?.substring(0, 16) + '...' || 'N/A';
        document.getElementById('block-nonce').textContent = data.nonce?.toLocaleString() || 'N/A';
        document.getElementById('block-difficulty').textContent = data.difficulty ? `${(data.difficulty / 1e12).toFixed(2)} T` : 'N/A';
    }
    
    updateBlockVisualization() {
        if (!this.blockData) return;
        
        // Clear existing transactions
        this.transactions.forEach(tx => this.scene.remove(tx));
        this.transactions = [];
        
        // Use actual transaction IDs if available, otherwise fallback to count-based visualization
        const transactionsToVisualize = this.transactionIds.length > 0 ? this.transactionIds : [];
        const txCount = transactionsToVisualize.length > 0 ? 
            transactionsToVisualize.length : // Show all transactions
            Math.min(this.blockData.tx_count || 100, 100);
        
        console.log(`Creating ${txCount} transaction cuboids`);
        
        // Create transaction cuboids in a 3D grid layout with vertical separation
        const transactionsPerRow = 10; // Fixed 10 transactions per row
        const transactionsPerLayer = 100; // 10 rows per layer (10 * 10 = 100)
        
        const spacingX = 0.25; // Horizontal spacing between transactions
        const spacingZ = 0.25; // Depth spacing between rows
        const spacingY = 0.3;  // Vertical spacing between layers
        
        for (let i = 0; i < txCount; i++) {
            // Calculate 3D grid position
            const layer = Math.floor(i / transactionsPerLayer);
            const positionInLayer = i % transactionsPerLayer;
            const row = Math.floor(positionInLayer / transactionsPerRow);
            const col = positionInLayer % transactionsPerRow;
            
            // Calculate position with proper centering
            const x = (col - (transactionsPerRow - 1) / 2) * spacingX;
            const z = (row - 4.5) * spacingZ; // Center around 10 rows (0-9, so -4.5 to +4.5)
            const y = 1.21 - layer * spacingY; // Move all transactions up 10 units, then stack layers downward
            
            // Create cuboid geometry (reduced to half scale)
            const CUBOID_WIDTH = 0.01;   // Width (was 0.07)
            const CUBOID_HEIGHT = 0.07;   // Height (was 0.14)
            const CUBOID_LENGTH = 0.21;   // Length (was 0.56)
            const geometry = new THREE.BoxGeometry(CUBOID_LENGTH, CUBOID_HEIGHT, CUBOID_WIDTH);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8
            });
            
            const cuboid = new THREE.Mesh(geometry, material);
            cuboid.position.set(x, y, z);
            cuboid.renderOrder = 0;  // Render before block (lower number = earlier)
            
            // Store transaction data (no velocity/animation)
            if (transactionsToVisualize.length > 0) {
                cuboid.userData = {
                    txid: transactionsToVisualize[i],
                    index: i,
                    layer: layer,
                    row: row,
                    col: col
                };
            } else {
                cuboid.userData = {
                    txid: `dummy_tx_${i}`,
                    index: i,
                    layer: layer,
                    row: row,
                    col: col
                };
            }
            
            this.scene.add(cuboid);
            this.transactions.push(cuboid);
        }
        
        console.log(`Created ${this.transactions.length} transaction cuboids`);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isRotating) {
            this.scene.rotation.y += 0.001;
        }
        
        // Transaction cuboids are static (no animation)
        
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        // Get the container dimensions (respects split screen)
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
        const panelContent = document.getElementById('block-info');
        
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
        this.controls.panX -= 0.5;
        this.controls.update();
    }
    
    panRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panX += 0.5;
        this.controls.update();
    }
    
    panUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panY += 0.5;
        this.controls.update();
    }
    
    panDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.panY -= 0.5;
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
    
    // Raw block data methods
    async fetchRawBlockData() {
        if (!this.blockData || !this.blockData.id) {
            this.showPopupMessage('Error', 'Block data not loaded yet. Please wait for the block to load.', 'error');
            return;
        }
        
        const blockHash = this.blockData.id;
        const textElement = document.getElementById('raw-data-text');
        const sizeElement = document.getElementById('raw-data-size');
        const downloadBtn = document.getElementById('download-raw-data');
        
        // Show panel (this also triggers resize)
        this.showRawDataModal();
        
        // If data is already loaded for this block, just show it
        if (this.rawBlockData && this.rawBlockData.hash === blockHash) {
            return;
        }
        
        // Show loading state
        textElement.textContent = '';
        textElement.className = 'raw-data-loading';
        sizeElement.textContent = 'Loading...';
        downloadBtn.disabled = true;
        
        try {
            const response = await fetch(`https://mempool.space/api/block/${blockHash}/raw`);
            
            if (response.status === 429) {
                this.hideRawDataModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Get the raw data as ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            
            // Convert to hex string for display
            const hexString = Array.from(bytes)
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
            
            // Store raw data for download
            this.rawBlockData = {
                hex: hexString,
                bytes: bytes,
                hash: blockHash
            };
            
            // Format size
            const sizeBytes = bytes.length;
            const sizeFormatted = sizeBytes >= 1024 * 1024 
                ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                : sizeBytes >= 1024 
                    ? `${(sizeBytes / 1024).toFixed(2)} KB`
                    : `${sizeBytes} bytes`;
            
            sizeElement.textContent = `Size: ${sizeFormatted} (${hexString.length.toLocaleString()} hex chars)`;
            
            // Parse block for decode mode
            this.decodedSections = this.parseBlock(bytes);
            
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
            console.error('Error fetching raw block data:', error);
            textElement.className = '';
            textElement.textContent = `Error loading raw block data:\n${error.message}`;
            sizeElement.textContent = 'Error';
        }
    }
    
    async displayLargeText(element, hexString, charsPerLine = 64) {
        // Format with line breaks
        const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
        const lines = hexString.match(regex) || [hexString];
        const totalLines = lines.length;
        const chunkSize = 1000; // Lines per chunk
        
        element.textContent = `Loading ${totalLines.toLocaleString()} lines...\n`;
        
        // Process in chunks with small delays to keep UI responsive
        for (let i = 0; i < totalLines; i += chunkSize) {
            const chunk = lines.slice(i, Math.min(i + chunkSize, totalLines));
            
            if (i === 0) {
                element.textContent = chunk.join('\n');
            } else {
                element.textContent += '\n' + chunk.join('\n');
            }
            
            // Small delay every chunk to allow UI to breathe
            if (i + chunkSize < totalLines) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }
    
    async findTransactionInRawData() {
        const input = document.getElementById('find-tx-input');
        const result = document.getElementById('find-tx-result');
        const textElement = document.getElementById('raw-data-text');
        
        const txid = input.value.trim().toLowerCase();
        
        if (!txid || txid.length !== 64) {
            result.textContent = 'Invalid TXID (need 64 hex chars)';
            result.className = 'find-tx-result not-found';
            return;
        }
        
        if (!this.rawBlockData || !this.rawBlockData.hex) {
            result.textContent = 'No data loaded';
            result.className = 'find-tx-result not-found';
            return;
        }
        
        const hexData = this.rawBlockData.hex.toLowerCase();
        
        // TXIDs are hashes and don't appear directly in raw block data
        // Instead, fetch the transaction hex and search for a unique portion of it
        result.textContent = 'Fetching TX data...';
        result.className = 'find-tx-result loading';
        
        // Dim the text area while searching
        textElement.style.opacity = '0.5';
        textElement.style.pointerEvents = 'none';
        
        try {
            // Fetch the transaction's raw hex
            const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
            
            if (!response.ok) {
                result.textContent = 'TX not found on mempool';
                result.className = 'find-tx-result not-found';
                textElement.style.opacity = '1';
                textElement.style.pointerEvents = '';
                return;
            }
            
            const txHex = (await response.text()).toLowerCase();
            
            // Update loading state - use requestAnimationFrame for reliable UI update
            result.textContent = 'Searching in block...';
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            
            // Search for the transaction's raw data in the block
            // Try finding a unique portion (first 64 chars after version/marker)
            // Skip version (8) + marker (2) + flag (2) = 12 chars, then take next 64
            let searchPattern = txHex.substring(12, 76);
            let foundPosition = hexData.indexOf(searchPattern);
            let matchType = 'input reference';
            
            // If not found, try the full start of transaction
            if (foundPosition === -1) {
                searchPattern = txHex.substring(0, 64);
                foundPosition = hexData.indexOf(searchPattern);
                matchType = 'tx start';
            }
            
            // Try without segwit marker/flag (legacy search)
            if (foundPosition === -1) {
                // Version (8 chars) + input count position varies
                searchPattern = txHex.substring(0, 8);
                const matches = [];
                let pos = 0;
                while ((pos = hexData.indexOf(searchPattern, pos)) !== -1) {
                    matches.push(pos);
                    pos++;
                }
                if (matches.length > 0) {
                    // Try to find by matching more of the tx
                    for (const matchPos of matches) {
                        if (hexData.substring(matchPos, matchPos + 40) === txHex.substring(0, 40)) {
                            foundPosition = matchPos;
                            matchType = 'version match';
                            break;
                        }
                    }
                }
            }
            
            if (foundPosition === -1) {
                result.textContent = 'TX data not found in block';
                result.className = 'find-tx-result not-found';
                textElement.style.opacity = '1';
                textElement.style.pointerEvents = '';
                return;
            }
            
            // Show highlighting state
            const bytePosition = Math.floor(foundPosition / 2);
            result.textContent = 'Highlighting...';
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            
            // Calculate line number based on current bytes per line and view mode
            const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
            
            // Chars per line varies by mode: ASCII=1, Hex=2, Binary=8 per byte
            let charsPerLine, positionInView;
            if (this.rawViewMode === 'ascii') {
                charsPerLine = bytesPerLine;
                positionInView = bytePosition;
            } else if (this.rawViewMode === 'binary') {
                charsPerLine = bytesPerLine * 8;
                positionInView = bytePosition * 8;
            } else {
                charsPerLine = bytesPerLine * 2;
                positionInView = foundPosition;
            }
            const lineNumber = Math.floor(positionInView / charsPerLine);
            
            // Highlight the transaction in the display (pass hex positions, highlightTransaction will convert)
            this.highlightTransaction(foundPosition, txHex.length);
            
            // Show final result
            result.textContent = `Found at byte ${bytePosition.toLocaleString()} (${matchType})`;
            result.className = 'find-tx-result found';
            
            // Restore text area
            textElement.style.opacity = '1';
            textElement.style.pointerEvents = '';
            
            // Also highlight the 3D model
            const cuboid = this.transactions.find(tx => tx.userData.txid === txid);
            if (cuboid) {
                // Load the transaction size if not already loaded
                if (!cuboid.userData.transactionData) {
                    await this.loadSingleTransactionSizeOnly(cuboid, txid);
                }
                // Highlight by dimming all other transactions
                this.highlightCuboid3D(cuboid);
                
                // Update URL with transaction ID
                const url = new URL(window.location);
                url.searchParams.set('txid', txid);
                window.history.pushState({}, '', url);
            }
            
            // Scroll to the approximate position in the text element
            const lineHeight = parseFloat(window.getComputedStyle(textElement).lineHeight) || 15;
            const scrollPosition = lineNumber * lineHeight;
            textElement.scrollTop = Math.max(0, scrollPosition - 100);
            
        } catch (error) {
            console.error('Error finding transaction:', error);
            result.textContent = 'Error fetching TX';
            result.className = 'find-tx-result not-found';
            textElement.style.opacity = '1';
            textElement.style.pointerEvents = '';
        }
    }
    
    highlightTransaction(hexStartPos, hexLength) {
        if (!this.rawBlockData || !this.rawBlockData.hex) return;
        
        const textElement = document.getElementById('raw-data-text');
        const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
        
        // Set appropriate font size based on bytes per line and view mode
        const isAscii = this.rawViewMode === 'ascii';
        const isBinary = this.rawViewMode === 'binary';
        if (bytesPerLine >= 512) {
            textElement.style.fontSize = isAscii ? '0.12vw' : isBinary ? '0.015vw' : '0.06vw';
        } else if (bytesPerLine >= 256) {
            textElement.style.fontSize = isAscii ? '0.24vw' : isBinary ? '0.03vw' : '0.12vw';
        } else if (bytesPerLine >= 128) {
            textElement.style.fontSize = isAscii ? '0.6vw' : isBinary ? '0.08vw' : '0.3vw';
        } else if (bytesPerLine >= 64) {
            textElement.style.fontSize = isAscii ? '1vw' : isBinary ? '0.15vw' : '0.5vw';
        } else {
            textElement.style.fontSize = isAscii ? '20px' : isBinary ? '4px' : '10px';
        }
        
        // Store highlight range in bytes for use in decode mode
        const highlightByteStart = Math.floor(hexStartPos / 2);
        const highlightByteEnd = highlightByteStart + Math.floor(hexLength / 2);
        this.highlightRange = { start: highlightByteStart, end: highlightByteEnd };
        
        // If decode mode is active, render with decode colors AND highlight
        if (this.decodeMode && this.decodedSections) {
            this.renderDecodedDataWithHighlight(bytesPerLine, highlightByteStart, highlightByteEnd);
            return;
        }
        
        let dataString, charsPerLine, startPos, length;
        
        if (this.rawViewMode === 'ascii') {
            // ASCII mode: convert hex positions to byte positions
            dataString = this.bytesToAscii(this.rawBlockData.bytes);
            charsPerLine = bytesPerLine; // 1 char per byte in ASCII
            startPos = Math.floor(hexStartPos / 2); // hex position / 2 = byte position
            length = Math.floor(hexLength / 2); // hex length / 2 = byte length
        } else if (this.rawViewMode === 'binary') {
            // Binary mode: convert hex positions to binary positions
            dataString = this.bytesToBinary(this.rawBlockData.bytes);
            charsPerLine = bytesPerLine * 8; // 8 binary chars per byte
            startPos = Math.floor(hexStartPos / 2) * 8; // hex position / 2 * 8 = binary position
            length = Math.floor(hexLength / 2) * 8; // hex length / 2 * 8 = binary length
        } else {
            // Hex mode
            dataString = this.rawBlockData.hex;
            charsPerLine = bytesPerLine * 2; // 2 hex chars per byte
            startPos = hexStartPos;
            length = hexLength;
        }
        
        // Format with line breaks
        const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
        const lines = dataString.match(regex) || [dataString];
        
        // Calculate which characters to highlight (accounting for newlines)
        const endPos = startPos + length;
        
        // Build HTML with highlight
        let currentPos = 0;
        let html = '';
        
        for (let i = 0; i < lines.length; i++) {
            const lineStart = currentPos;
            const lineEnd = currentPos + lines[i].length;
            const line = lines[i];
            
            // Check if this line contains any part of the highlight
            if (lineEnd > startPos && lineStart < endPos) {
                // This line has some highlighted content
                const highlightStart = Math.max(0, startPos - lineStart);
                const highlightEnd = Math.min(line.length, endPos - lineStart);
                
                const before = line.substring(0, highlightStart);
                const highlighted = line.substring(highlightStart, highlightEnd);
                const after = line.substring(highlightEnd);
                
                html += this.escapeHtml(before);
                html += `<span class="tx-highlight">${this.escapeHtml(highlighted)}</span>`;
                html += this.escapeHtml(after);
            } else {
                html += this.escapeHtml(line);
            }
            
            if (i < lines.length - 1) {
                html += '\n';
            }
            
            currentPos = lineEnd;
        }
        
        textElement.innerHTML = html;
        textElement.classList.add('has-highlight');
        
        // Add double-click handler to navigate to transaction page
        this.addHighlightClickHandlers();
    }
    
    renderDecodedDataWithHighlight(bytesPerLine, highlightByteStart, highlightByteEnd) {
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawBlockData.hex;
        const bytes = this.rawBlockData.bytes;
        
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
        
        // Convert highlight byte range to char range
        const highlightCharStart = getCharPos(highlightByteStart);
        const highlightCharEnd = getCharPos(highlightByteEnd);
        
        // Sort sections by start position
        const sortedSections = [...this.decodedSections].sort((a, b) => a.start - b.start);
        
        let html = '';
        let currentCharPos = 0;
        let currentLinePos = 0;
        
        // Helper to check if a position is within highlight range
        const isInHighlight = (charPos) => charPos >= highlightCharStart && charPos < highlightCharEnd;
        
        // Helper to add text with line breaks and optional highlight
        const addTextWithBreaks = (text, cssClass, section, textStartCharPos) => {
            let remaining = text;
            let charPos = textStartCharPos;
            
            while (remaining.length > 0) {
                const spaceOnLine = charsPerLine - currentLinePos;
                const chunk = remaining.substring(0, spaceOnLine);
                remaining = remaining.substring(spaceOnLine);
                
                // Check if any part of this chunk is in the highlight range
                const chunkStart = charPos;
                const chunkEnd = charPos + chunk.length;
                const chunkInHighlight = chunkStart < highlightCharEnd && chunkEnd > highlightCharStart;
                
                if (cssClass) {
                    const dataAttrs = section ? `data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"` : '';
                    const highlightClass = chunkInHighlight ? ' tx-highlight-decode' : '';
                    html += `<span class="decode-section ${cssClass}${highlightClass}" ${dataAttrs}>${this.escapeHtml(chunk)}</span>`;
                } else {
                    if (chunkInHighlight) {
                        html += `<span class="tx-highlight">${this.escapeHtml(chunk)}</span>`;
                    } else {
                        html += this.escapeHtml(chunk);
                    }
                }
                
                charPos += chunk.length;
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
                addTextWithBreaks(gapText, null, null, currentCharPos);
            }
            
            // Add the section with coloring
            const sectionText = fullString.substring(sectionStartChar, sectionEndChar);
            addTextWithBreaks(sectionText, section.cssClass, section, sectionStartChar);
            
            currentCharPos = sectionEndChar;
        }
        
        // Add any remaining text after the last section
        if (currentCharPos < fullString.length) {
            const remainingText = fullString.substring(currentCharPos);
            addTextWithBreaks(remainingText, null, null, currentCharPos);
        }
        
        textElement.innerHTML = html;
        textElement.classList.add('has-highlight');
        this.setupDecodeTooltips();
        this.addHighlightClickHandlers();
    }
    
    addHighlightClickHandlers() {
        const textElement = document.getElementById('raw-data-text');
        const highlightSpans = textElement.querySelectorAll('.tx-highlight, .tx-highlight-decode');
        highlightSpans.forEach(span => {
            span.style.cursor = 'pointer';
            span.title = 'Double-click to view transaction details';
            span.addEventListener('dblclick', () => {
                const txid = document.getElementById('find-tx-input').value.trim();
                if (txid && txid.length === 64) {
                    window.location.href = `transaction.html?txid=${txid}`;
                }
            });
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    async clearHighlight() {
        const textElement = document.getElementById('raw-data-text');
        textElement.classList.remove('has-highlight');
        
        // Clear highlight range
        this.highlightRange = null;
        
        // Save scroll position before re-rendering
        const scrollTop = textElement.scrollTop;
        
        // Re-render without highlight if data exists (respects current view mode)
        if (this.rawBlockData && this.rawBlockData.hex) {
            const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
            await this.reformatRawData(bytesPerLine);
        }
        
        // Restore scroll position after re-rendering
        textElement.scrollTop = scrollTop;
    }
    
    async findTransactionInRawDataByTxid(txid) {
        // Update URL with transaction ID (without reloading page)
        const url = new URL(window.location);
        url.searchParams.set('txid', txid);
        window.history.pushState({}, '', url);
        
        // Find and load the transaction on the 3D model
        const cuboid = this.transactions.find(tx => tx.userData.txid === txid);
        if (cuboid) {
            // Load the transaction data if not already loaded (size only, no position change)
            if (!cuboid.userData.transactionData) {
                await this.loadSingleTransactionSizeOnly(cuboid, txid);
            }
            
            // Highlight by dimming all other transactions
            this.highlightCuboid3D(cuboid);
        }
        
        // Open the find UI
        const wrapper = document.getElementById('find-tx-input-wrapper');
        const toggle = document.getElementById('find-tx-toggle');
        const input = document.getElementById('find-tx-input');
        const result = document.getElementById('find-tx-result');
        
        wrapper.classList.remove('hidden');
        toggle.style.display = 'none';
        
        // Set the txid in the input
        input.value = txid;
        
        // Show loading state
        result.textContent = 'Loading raw data...';
        result.className = 'find-tx-result loading';
        
        // If raw data not loaded, fetch it first and wait for it to complete
        if (!this.rawBlockData || !this.rawBlockData.hex) {
            await this.fetchRawBlockData();
        } else {
            // Just open the panel if data already loaded
            this.showRawDataModal();
        }
        
        // Wait for raw data to be available and displayed
        while (!this.rawBlockData || !this.rawBlockData.hex) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Update loading state
        result.textContent = 'Locating transaction...';
        
        // Additional wait for DOM to settle after large text rendering
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Now find the transaction
        await this.findTransactionInRawData();
    }
    
    async loadSingleTransactionSizeOnly(cuboid, txid) {
        try {
            const response = await fetch(`https://mempool.space/api/tx/${txid}`);
            if (!response.ok) return;
            
            const txData = await response.json();
            const txSize = txData.size || 200;
            const height = Math.max(0.1, txSize / 1000);
            
            // Only animate height, no position change
            this.animateCuboidHeightTopAligned(cuboid, height, 100);
            
            // Update userData - mark as size-only loaded (position not animated yet)
            cuboid.userData.transactionData = txData;
            cuboid.userData.size = txSize;
            cuboid.userData.sizeOnlyLoaded = true; // Flag to allow position animation later
            
            // Cache tooltip
            const tooltipContent = this.createDetailedTooltipContent(txData, txid);
            this.transactionCache.set(txid, tooltipContent);
        } catch (error) {
            console.error('Error loading transaction size:', error);
        }
    }
    
    highlightCuboid3D(targetCuboid) {
        // Dim all other transactions, keep target at full opacity
        this.transactions.forEach(cuboid => {
            if (cuboid === targetCuboid) {
                cuboid.material.opacity = 1;
            } else {
                cuboid.material.opacity = 0.15;
            }
        });
        
        // Store reference to restore later
        this.highlightedCuboid = targetCuboid;
    }
    
    clearCuboid3DHighlight() {
        // Restore all transactions to original opacity
        this.transactions.forEach(cuboid => {
            cuboid.material.opacity = 0.8;
        });
        this.highlightedCuboid = null;
    }
    
    async reformatRawData(bytesPerLine) {
        if (!this.rawBlockData || !this.rawBlockData.hex) {
            return;
        }
        
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawBlockData.hex;
        const bytes = this.rawBlockData.bytes;
        
        // Adjust font size based on bytes per line and view mode
        // ASCII = 2x hex, Binary gets progressively smaller at higher bytes/line
        const isAscii = this.rawViewMode === 'ascii';
        const isBinary = this.rawViewMode === 'binary';
        if (bytesPerLine >= 512) {
            textElement.style.fontSize = isAscii ? '0.12vw' : isBinary ? '0.015vw' : '0.06vw';
        } else if (bytesPerLine >= 256) {
            textElement.style.fontSize = isAscii ? '0.24vw' : isBinary ? '0.03vw' : '0.12vw';
        } else if (bytesPerLine >= 128) {
            textElement.style.fontSize = isAscii ? '0.6vw' : isBinary ? '0.08vw' : '0.3vw';
        } else if (bytesPerLine >= 64) {
            textElement.style.fontSize = isAscii ? '1vw' : isBinary ? '0.15vw' : '0.5vw';
        } else {
            textElement.style.fontSize = isAscii ? '20px' : isBinary ? '4px' : '10px';
        }
        
        // If decode mode is active, render decoded view
        if (this.decodeMode && this.decodedSections) {
            await this.renderDecodedData(bytesPerLine);
            return;
        }
        
        // Show brief loading state for large data
        const isLarge = hexString.length > 100000;
        if (isLarge) {
            textElement.textContent = 'Reformatting...';
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        if (this.rawViewMode === 'ascii') {
            // ASCII view
            const asciiString = this.bytesToAscii(bytes);
            if (isLarge) {
                await this.displayLargeText(textElement, asciiString, bytesPerLine, 'ascii');
            } else {
                const regex = new RegExp(`.{1,${bytesPerLine}}`, 'g');
                const formatted = asciiString.match(regex)?.join('\n') || asciiString;
                textElement.textContent = formatted;
            }
        } else if (this.rawViewMode === 'binary') {
            // Binary view - 8 chars per byte
            const binaryString = this.bytesToBinary(bytes);
            const charsPerLine = bytesPerLine * 8; // 8 binary chars per byte
            if (isLarge) {
                await this.displayLargeText(textElement, binaryString, charsPerLine, 'binary');
            } else {
                const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
                const formatted = binaryString.match(regex)?.join('\n') || binaryString;
                textElement.textContent = formatted;
            }
        } else {
            // Hex view
            const charsPerLine = bytesPerLine * 2; // 2 hex chars per byte
            if (isLarge) {
                await this.displayLargeText(textElement, hexString, charsPerLine, 'hex');
            } else {
                const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
                const formattedHex = hexString.match(regex)?.join('\n') || hexString;
                textElement.textContent = formattedHex;
            }
        }
    }
    
    bytesToAscii(bytes) {
        // Convert bytes to ASCII, using '.' for non-printable characters
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            // Printable ASCII range: 32-126
            if (byte >= 32 && byte <= 126) {
                result += String.fromCharCode(byte);
            } else {
                result += '.';
            }
        }
        return result;
    }
    
    bytesToBinary(bytes) {
        // Convert bytes to binary string (8 bits per byte)
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            result += bytes[i].toString(2).padStart(8, '0');
        }
        return result;
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
        
        // Trigger resize immediately and after transition completes
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
        
        // Trigger resize immediately and after transition completes
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
    
    downloadRawData() {
        if (!this.rawBlockData) {
            console.warn('No raw block data available for download');
            return;
        }
        
        // Create blob from the raw bytes
        const blob = new Blob([this.rawBlockData.bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = `block_${this.rawBlockData.hash.substring(0, 16)}.bin`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Cleanup
        URL.revokeObjectURL(url);
    }
    
    // Parse a Bitcoin block and return sections with byte ranges
    parseBlock(bytes) {
        const sections = [];
        let offset = 0;
        
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
            // ===== BLOCK HEADER (80 bytes) =====
            
            // Version (4 bytes)
            const versionStart = offset;
            const version = readLE(4);
            sections.push({
                type: 'blockVersion',
                start: versionStart,
                end: offset,
                label: 'Block Version',
                value: version,
                cssClass: 'decode-version'
            });
            
            // Previous block hash (32 bytes)
            const prevHashStart = offset;
            const prevHash = reverseHex(readBytes(32));
            sections.push({
                type: 'prevBlockHash',
                start: prevHashStart,
                end: offset,
                label: 'Previous Block Hash',
                value: prevHash.substring(0, 16) + '...',
                cssClass: 'decode-marker'
            });
            
            // Merkle root (32 bytes)
            const merkleStart = offset;
            const merkleRoot = reverseHex(readBytes(32));
            sections.push({
                type: 'merkleRoot',
                start: merkleStart,
                end: offset,
                label: 'Merkle Root',
                value: merkleRoot.substring(0, 16) + '...',
                cssClass: 'decode-txOutVarInt'
            });
            
            // Time (4 bytes)
            const timeStart = offset;
            const time = readLE(4);
            const date = new Date(time * 1000);
            sections.push({
                type: 'blockTime',
                start: timeStart,
                end: offset,
                label: 'Block Time',
                value: date.toISOString(),
                cssClass: 'decode-locktime'
            });
            
            // Bits (4 bytes)
            const bitsStart = offset;
            const bits = readLE(4);
            sections.push({
                type: 'blockBits',
                start: bitsStart,
                end: offset,
                label: 'Bits (Difficulty)',
                value: '0x' + bits.toString(16).padStart(8, '0'),
                cssClass: 'decode-locktime'
            });
            
            // Nonce (4 bytes)
            const nonceStart = offset;
            const nonce = readLE(4);
            sections.push({
                type: 'blockNonce',
                start: nonceStart,
                end: offset,
                label: 'Nonce',
                value: nonce,
                cssClass: 'decode-locktime'
            });
            
            // ===== TRANSACTIONS =====
            
            // Transaction count (VarInt)
            const txCountInfo = readVarInt();
            const txCount = txCountInfo.value;
            sections.push({
                type: 'txCount',
                start: txCountInfo.start,
                end: txCountInfo.end,
                label: 'Transaction Count',
                value: txCount,
                cssClass: 'decode-txInVarInt'
            });
            
            // Parse each transaction
            for (let txIdx = 0; txIdx < txCount && offset < bytes.length; txIdx++) {
                const txStart = offset;
                
                // Version (4 bytes)
                const txVersionStart = offset;
                const txVersion = readLE(4);
                sections.push({
                    type: 'version',
                    start: txVersionStart,
                    end: offset,
                    label: `TX ${txIdx} Version`,
                    value: txVersion,
                    cssClass: 'decode-version'
                });
                
                // Check for SegWit marker (0x00) and flag (0x01)
                let isSegWit = false;
                if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
                    isSegWit = true;
                    const markerStart = offset;
                    offset += 1;
                    sections.push({
                        type: 'marker',
                        start: markerStart,
                        end: offset,
                        label: `TX ${txIdx} Marker`,
                        value: '00',
                        cssClass: 'decode-marker'
                    });
                    const flagStart = offset;
                    offset += 1;
                    sections.push({
                        type: 'flag',
                        start: flagStart,
                        end: offset,
                        label: `TX ${txIdx} Flag`,
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
                    label: `TX ${txIdx} Input Count`,
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
                        label: `TX ${txIdx} In ${i} TXID`,
                        value: prevTxHash.substring(0, 12) + '...',
                        cssClass: 'decode-txInHash'
                    });
                    
                    // Output index (4 bytes)
                    const indexStart = offset;
                    const outputIndex = readLE(4);
                    sections.push({
                        type: 'txInIndex',
                        start: indexStart,
                        end: offset,
                        label: `TX ${txIdx} In ${i} Vout`,
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
                        label: `TX ${txIdx} In ${i} Script Len`,
                        value: scriptLen,
                        cssClass: 'decode-txInScriptVarInt'
                    });
                    
                    // Script (variable)
                    if (scriptLen > 0) {
                        const scriptStart = offset;
                        readBytes(scriptLen);
                        sections.push({
                            type: 'txInScript',
                            start: scriptStart,
                            end: offset,
                            label: `TX ${txIdx} In ${i} ScriptSig`,
                            value: `${scriptLen} bytes`,
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
                        label: `TX ${txIdx} In ${i} Sequence`,
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
                    label: `TX ${txIdx} Output Count`,
                    value: outputCount,
                    cssClass: 'decode-txOutVarInt'
                });
                
                // Outputs
                for (let i = 0; i < outputCount; i++) {
                    // Value (8 bytes)
                    const valueStart = offset;
                    const valueLow = readLE(4);
                    const valueHigh = readLE(4);
                    const satoshis = valueLow + valueHigh * 0x100000000;
                    sections.push({
                        type: 'txOutValue',
                        start: valueStart,
                        end: offset,
                        label: `TX ${txIdx} Out ${i} Value`,
                        value: `${satoshis} sats`,
                        cssClass: 'decode-txOutValue'
                    });
                    
                    // Script length (VarInt)
                    const outScriptLenInfo = readVarInt();
                    const outScriptLen = outScriptLenInfo.value;
                    sections.push({
                        type: 'txOutScriptVarInt',
                        start: outScriptLenInfo.start,
                        end: outScriptLenInfo.end,
                        label: `TX ${txIdx} Out ${i} Script Len`,
                        value: outScriptLen,
                        cssClass: 'decode-txOutScriptVarInt'
                    });
                    
                    // Script (variable)
                    if (outScriptLen > 0) {
                        const outScriptStart = offset;
                        readBytes(outScriptLen);
                        sections.push({
                            type: 'txOutScript',
                            start: outScriptStart,
                            end: offset,
                            label: `TX ${txIdx} Out ${i} Script`,
                            value: `${outScriptLen} bytes`,
                            cssClass: 'decode-txOutScript'
                        });
                    }
                }
                
                // Witness data (if SegWit)
                if (isSegWit) {
                    for (let i = 0; i < inputCount; i++) {
                        const witnessCountInfo = readVarInt();
                        const witnessCount = witnessCountInfo.value;
                        sections.push({
                            type: 'witnessVarInt',
                            start: witnessCountInfo.start,
                            end: witnessCountInfo.end,
                            label: `TX ${txIdx} Witness ${i} Count`,
                            value: witnessCount,
                            cssClass: 'decode-witnessVarInt'
                        });
                        
                        for (let w = 0; w < witnessCount; w++) {
                            const itemLenInfo = readVarInt();
                            const itemLen = itemLenInfo.value;
                            sections.push({
                                type: 'witnessItemsVarInt',
                                start: itemLenInfo.start,
                                end: itemLenInfo.end,
                                label: `TX ${txIdx} Wit ${i} Item ${w} Len`,
                                value: itemLen,
                                cssClass: 'decode-witnessItemsVarInt'
                            });
                            
                            if (itemLen > 0) {
                                const itemStart = offset;
                                const item = readBytes(itemLen);
                                
                                // Check for Ordinals inscription (taproot script)
                                if (itemLen > 100) {
                                    const inscription = this.parseInscription(item, itemStart);
                                    if (inscription) {
                                        // Add inscription sections instead of generic witness item
                                        sections.push(...inscription.sections);
                                        continue;
                                    }
                                }
                                
                                // Determine witness item type
                                let cssClass = 'decode-witnessItem';
                                let itemType = 'Witness';
                                if (itemLen === 64 || itemLen === 65) {
                                    cssClass = 'decode-witnessItemSignature';
                                    itemType = 'Signature';
                                } else if (itemLen === 33 || itemLen === 32) {
                                    cssClass = 'decode-witnessItemPubkey';
                                    itemType = 'Pubkey';
                                } else if (itemLen > 100) {
                                    cssClass = 'decode-witnessItemScript';
                                    itemType = 'Script';
                                }
                                
                                sections.push({
                                    type: 'witnessItem',
                                    start: itemStart,
                                    end: offset,
                                    label: `TX ${txIdx} Wit ${i} ${itemType}`,
                                    value: `${itemLen} bytes`,
                                    cssClass: cssClass
                                });
                            } else {
                                sections.push({
                                    type: 'witnessItemEmpty',
                                    start: itemLenInfo.start,
                                    end: itemLenInfo.end,
                                    label: `TX ${txIdx} Wit ${i} Empty`,
                                    value: '(OP_0)',
                                    cssClass: 'decode-witnessItemEmpty'
                                });
                            }
                        }
                    }
                }
                
                // Locktime (4 bytes)
                const locktimeStart = offset;
                const locktime = readLE(4);
                sections.push({
                    type: 'locktime',
                    start: locktimeStart,
                    end: offset,
                    label: `TX ${txIdx} Locktime`,
                    value: locktime,
                    cssClass: 'decode-locktime'
                });
            }
            
        } catch (e) {
            console.error('Error parsing block:', e, 'at offset:', offset);
        }
        
        return sections;
    }
    
    // Parse Ordinals inscription from witness script
    parseInscription(script, baseOffset) {
        const sections = [];
        let pos = 0;
        
        const readByte = () => script[pos++];
        const hasBytes = (n) => pos + n <= script.length;
        
        const readPushData = () => {
            if (pos >= script.length) return null;
            const opcode = script[pos];
            const opcodeStart = pos;
            
            if (opcode >= 0x01 && opcode <= 0x4b) {
                const len = opcode;
                pos++;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { data, start: opcodeStart, end: pos, opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos, opcodeType: 'direct', opcodeLen: len };
            }
            else if (opcode === 0x4c) {
                pos++;
                if (!hasBytes(1)) return null;
                const len = script[pos++];
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { data, start: opcodeStart, end: pos, opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos, opcodeType: 'OP_PUSHDATA1', opcodeLen: len };
            }
            else if (opcode === 0x4d) {
                pos++;
                if (!hasBytes(2)) return null;
                const len = script[pos] | (script[pos + 1] << 8);
                pos += 2;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { data, start: opcodeStart, end: pos, opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos, opcodeType: 'OP_PUSHDATA2', opcodeLen: len };
            }
            else if (opcode === 0x4e) {
                pos++;
                if (!hasBytes(4)) return null;
                const len = script[pos] | (script[pos + 1] << 8) | (script[pos + 2] << 16) | (script[pos + 3] << 24);
                pos += 4;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { data, start: opcodeStart, end: pos, opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos, opcodeType: 'OP_PUSHDATA4', opcodeLen: len };
            }
            else if (opcode === 0x00) {
                pos++;
                return { data: new Uint8Array(0), start: opcodeStart, end: pos, opcodeStart, opcodeEnd: pos, dataStart: pos, dataEnd: pos, opcodeType: 'OP_0', opcodeLen: 0 };
            }
            return null;
        };
        
        while (pos < script.length - 5) {
            if (script[pos] === 0x00 && script[pos + 1] === 0x63) {
                const envelopeStart = pos;
                
                // Look for pubkey + OP_CHECKSIG before envelope
                if (envelopeStart > 0 && script[envelopeStart - 1] === 0xac) {
                    const checksigPos = envelopeStart - 1;
                    let scanPos = 0;
                    let lastPushStart = -1, lastPushDataStart = -1, lastPushDataEnd = -1, lastPushLen = 0;
                    
                    while (scanPos < checksigPos) {
                        const opcode = script[scanPos];
                        if (opcode >= 0x01 && opcode <= 0x4b) {
                            lastPushStart = scanPos;
                            lastPushLen = opcode;
                            lastPushDataStart = scanPos + 1;
                            lastPushDataEnd = scanPos + 1 + opcode;
                            scanPos = lastPushDataEnd;
                        } else if (opcode === 0x4c && scanPos + 1 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1];
                            lastPushDataStart = scanPos + 2;
                            lastPushDataEnd = scanPos + 2 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        } else if (opcode === 0x4d && scanPos + 2 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1] | (script[scanPos + 2] << 8);
                            lastPushDataStart = scanPos + 3;
                            lastPushDataEnd = scanPos + 3 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        } else {
                            scanPos++;
                        }
                    }
                    
                    if (lastPushStart >= 0 && lastPushDataEnd === checksigPos) {
                        if (lastPushDataStart > lastPushStart) {
                            sections.push({ type: 'taprootPubkeyPush', start: baseOffset + lastPushStart, end: baseOffset + lastPushDataStart, label: 'Pubkey Push', value: `OP_PUSHBYTES_${lastPushLen}`, cssClass: 'decode-taprootPubkeyPush' });
                        }
                        const pubkeyHex = Array.from(script.slice(lastPushDataStart, lastPushDataEnd)).map(b => b.toString(16).padStart(2, '0')).join('');
                        sections.push({ type: 'taprootPubkey', start: baseOffset + lastPushDataStart, end: baseOffset + lastPushDataEnd, label: 'X-only Pubkey', value: pubkeyHex.substring(0, 16) + '...', cssClass: 'decode-taprootPubkey' });
                    }
                    sections.push({ type: 'opChecksig', start: baseOffset + checksigPos, end: baseOffset + checksigPos + 1, label: 'OP_CHECKSIG', value: '0xac', cssClass: 'decode-opChecksig' });
                }
                
                pos += 2;
                const protocolPush = readPushData();
                if (!protocolPush) { pos = envelopeStart + 1; continue; }
                
                const protocolId = String.fromCharCode(...protocolPush.data);
                if (protocolId !== 'ord') { pos = envelopeStart + 1; continue; }
                
                sections.push({ type: 'inscriptionEnvelope', start: baseOffset + envelopeStart, end: baseOffset + pos, label: 'Inscription Envelope', value: 'OP_FALSE OP_IF "ord"', cssClass: 'decode-inscriptionEnvelope' });
                
                let contentType = null;
                
                while (pos < script.length) {
                    if (script[pos] === 0x68) {
                        const endifStart = pos;
                        pos++;
                        sections.push({ type: 'inscriptionEndif', start: baseOffset + endifStart, end: baseOffset + pos, label: 'Inscription End', value: 'OP_ENDIF', cssClass: 'decode-inscriptionEndif' });
                        
                        // Control block after OP_ENDIF
                        if (pos < script.length) {
                            const controlPush = readPushData();
                            if (controlPush && controlPush.data.length >= 33) {
                                const controlByte = controlPush.data[0];
                                const leafVersion = controlByte & 0xfe;
                                const parity = controlByte & 0x01;
                                
                                if (controlPush.opcodeEnd > controlPush.opcodeStart) {
                                    sections.push({ type: 'controlBlockPush', start: baseOffset + controlPush.opcodeStart, end: baseOffset + controlPush.opcodeEnd, label: 'Control Block Push', value: `${controlPush.opcodeType} (${controlPush.data.length} bytes)`, cssClass: 'decode-controlBlockPush' });
                                }
                                sections.push({ type: 'controlByte', start: baseOffset + controlPush.dataStart, end: baseOffset + controlPush.dataStart + 1, label: 'Control Byte', value: `0x${controlByte.toString(16)} (leaf v${leafVersion >> 1}, parity ${parity})`, cssClass: 'decode-controlByte' });
                                
                                if (controlPush.data.length >= 33) {
                                    const internalPubkey = Array.from(controlPush.data.slice(1, 33)).map(b => b.toString(16).padStart(2, '0')).join('');
                                    sections.push({ type: 'internalPubkey', start: baseOffset + controlPush.dataStart + 1, end: baseOffset + controlPush.dataStart + 33, label: 'Internal Pubkey', value: internalPubkey.substring(0, 16) + '...', cssClass: 'decode-internalPubkey' });
                                }
                                if (controlPush.data.length > 33) {
                                    const merkleBytes = controlPush.data.length - 33;
                                    sections.push({ type: 'merkleProof', start: baseOffset + controlPush.dataStart + 33, end: baseOffset + controlPush.dataEnd, label: 'Merkle Proof', value: `${merkleBytes} bytes`, cssClass: 'decode-merkleProof' });
                                }
                            }
                        }
                        break;
                    }
                    
                    const tagPush = readPushData();
                    if (!tagPush) break;
                    const tag = tagPush.data;
                    
                    if (tag.length === 0) {
                        sections.push({ type: 'inscriptionBodyTag', start: baseOffset + tagPush.start, end: baseOffset + tagPush.end, label: 'Body Tag', value: 'OP_0 (body start)', cssClass: 'decode-inscriptionBodyTag' });
                        
                        let chunkIndex = 0;
                        while (pos < script.length && script[pos] !== 0x68) {
                            const chunkPush = readPushData();
                            if (!chunkPush) break;
                            
                            if (chunkPush.opcodeType !== 'direct' && chunkPush.opcodeType !== 'OP_0') {
                                sections.push({ type: 'inscriptionPushOpcode', start: baseOffset + chunkPush.opcodeStart, end: baseOffset + chunkPush.opcodeEnd, label: `Push Marker ${chunkIndex}`, value: `${chunkPush.opcodeType} (${chunkPush.opcodeLen} bytes)`, cssClass: 'decode-inscriptionPushOpcode' });
                            }
                            
                            if (chunkPush.data.length > 0) {
                                let chunkPreview = `${chunkPush.data.length} bytes`;
                                if (contentType && contentType.includes('text')) {
                                    try {
                                        const text = new TextDecoder().decode(chunkPush.data);
                                        chunkPreview = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                                    } catch (e) {}
                                }
                                sections.push({ type: 'inscriptionBodyChunk', start: baseOffset + chunkPush.dataStart, end: baseOffset + chunkPush.dataEnd, label: `Body Chunk ${chunkIndex}`, value: chunkPreview, cssClass: 'decode-inscriptionBodyChunk' });
                            }
                            chunkIndex++;
                        }
                        continue;
                    }
                    
                    if (tag.length === 1 && tag[0] === 1) {
                        sections.push({ type: 'inscriptionContentTypeTag', start: baseOffset + tagPush.start, end: baseOffset + tagPush.end, label: 'Content-Type Tag', value: '0x01', cssClass: 'decode-inscriptionContentTypeTag' });
                        const valuePush = readPushData();
                        if (valuePush) {
                            contentType = String.fromCharCode(...valuePush.data);
                            sections.push({ type: 'inscriptionContentType', start: baseOffset + valuePush.start, end: baseOffset + valuePush.end, label: 'Content-Type', value: contentType, cssClass: 'decode-inscriptionContentType' });
                        }
                        continue;
                    }
                    
                    sections.push({ type: 'inscriptionUnknownTag', start: baseOffset + tagPush.start, end: baseOffset + tagPush.end, label: 'Unknown Tag', value: `0x${Array.from(tag).map(b => b.toString(16).padStart(2, '0')).join('')}`, cssClass: 'decode-inscriptionUnknownTag' });
                    const unknownValue = readPushData();
                    if (unknownValue) {
                        sections.push({ type: 'inscriptionUnknownValue', start: baseOffset + unknownValue.start, end: baseOffset + unknownValue.end, label: 'Unknown Value', value: `${unknownValue.data.length} bytes`, cssClass: 'decode-inscriptionUnknownValue' });
                    }
                }
                
                if (sections.length > 0) {
                    return { sections, contentType };
                }
            }
            pos++;
        }
        return null;
    }
    
    async renderDecodedData(bytesPerLine) {
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawBlockData.hex;
        const bytes = this.rawBlockData.bytes;
        
        // Show loading for large blocks
        if (hexString.length > 100000) {
            textElement.innerHTML = 'Decoding block...';
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
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
        
        // Add final newline if needed
        if (currentLinePos > 0 && currentLinePos < charsPerLine) {
            // Content ends mid-line, that's fine
        }
        
        textElement.innerHTML = html;
        this.setupDecodeTooltips();
    }
    
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
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
        
        // Remove any existing listeners
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
    
    escapeAttr(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinBlockExplorer();
}); 