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
        this.hoveredUtxoSphere = null; // Track hovered UTXO sphere for full opacity on hover
        
        // Decode mode properties
        this.decodeMode = false;
        this.decodedSections = null;
        this.decodeTooltip = null;
        this.highlightRange = null; // Track highlighted transaction byte range
        
        // Merkle tree properties
        this.merkleTreeLines = []; // Store all merkle tree line objects
        this.merkleTreeVisible = false; // Track if merkle tree is currently visible
        this.merkleTreeNodes = []; // Store merkle tree node positions
        this.merkleTreeLineMap = new Map(); // Map txid -> vertical line for direct lookup
        
        // Past/future blocks: store refs for "Show more" (header + tx cuboids)
        this.pastBlockInfos = [];   // { mesh, height, z }
        this.futureBlockInfos = []; // { mesh, height, z }
        this.contentPastCount = 0;  // how many past blocks have header+tx loaded (always 5 fading at the end)
        this.contentFutureCount = 0;
        this.otherBlocksHeaders = [];
        this.otherBlocksCuboids = [];
        this.blockUnspentOutputs = []; // unspent outputs created by this block (block approach)
        this.utxoSpheres = []; // meshes for "Show UTXO" spheres
        this.utxoSpheresVisible = false;
        this.isLoadingUtxos = false;
        this.shouldStopUtxoLoad = false;
        this.FACTOR_BLOCK_DISTANCE = 0.016;
        this.MIN_TIMESTAMP = 1231006500;
        this.MAX_TIMESTAMP = 4102444800;
        
        // Get block height and transaction ID from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        
        // Validate block height parameter
        const heightParam = urlParams.get('height');
        if (heightParam) {
            const height = parseInt(heightParam, 10);
            if (!isNaN(height) && height >= 0 && height <= 100000000) {
                this.blockHeight = height;
            } else {
                this.blockHeight = null;
                console.warn('Invalid block height parameter:', heightParam);
            }
        } else {
            this.blockHeight = null;
        }
        
        // Validate transaction ID parameter
        const txidParam = urlParams.get('txid');
        if (txidParam && /^[a-fA-F0-9]{64}$/.test(txidParam)) {
            this.focusTxid = txidParam;
        } else if (txidParam) {
            this.focusTxid = null;
            console.warn('Invalid transaction ID parameter:', txidParam);
        } else {
            this.focusTxid = null;
        }
        
        // Validate bytes per line parameter
        const bytesParam = urlParams.get('bytes');
        const validBytesValues = ['16', '32', '64', '128', '256', '512'];
        if (bytesParam && validBytesValues.includes(bytesParam)) {
            this.bytesPerLine = bytesParam;
        } else {
            this.bytesPerLine = null;
        }
        
        // Validate view mode parameter
        const viewModeParam = urlParams.get('view');
        if (viewModeParam === 'ascii' || viewModeParam === 'binary' || viewModeParam === 'dump') {
            this.urlViewMode = viewModeParam;
        } else {
            this.urlViewMode = null;
        }
        
        this.urlDecodeMode = urlParams.get('decode') === 'on'; // Decode mode from URL
        this.urlRawDataOpen = urlParams.get('rawdata') === 'open'; // Whether raw data panel should be open
        this.urlMerkleTree = urlParams.get('merkle') === 'true' || urlParams.get('merkleTree') === 'true'; // Auto-load merkle tree
        this.urlLoadAll = urlParams.get('loadAll') === 'true' || urlParams.get('loadall') === 'true'; // Auto-load all transactions
        
        // Set initial view mode from URL
        if (this.urlViewMode === 'ascii') {
            this.rawViewMode = 'ascii';
        } else if (this.urlViewMode === 'binary') {
            this.rawViewMode = 'binary';
        } else if (this.urlViewMode === 'dump') {
            this.rawViewMode = 'dump';
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
        
        await this.createScene();
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
        
        // Auto-load all transactions if URL parameter is set
        if (this.urlLoadAll) {
            // Wait for block data and transactions to be created first
            const waitForLoadAll = setInterval(() => {
                if (this.blockData && this.blockData.id && this.transactions.length > 0) {
                    clearInterval(waitForLoadAll);
                    // Small delay to ensure transactions are fully initialized
                    setTimeout(() => {
                        this.loadAllTransactions();
                    }, 500);
                }
            }, 100);
        }
        
        // Auto-load merkle tree if URL parameter is set (e.g. ?merkle=true)
        if (this.urlMerkleTree) {
            let elapsed = 0;
            const timeoutMs = 60000;
            const waitForMerkleTree = setInterval(() => {
                elapsed += 100;
                const ready = this.blockData && this.blockData.id &&
                    this.transactionIds && this.transactionIds.length > 0 &&
                    this.transactions.length > 0 &&
                    this.transactions.some(t => t.userData && t.userData.txid && !String(t.userData.txid).startsWith('dummy_tx_'));
                if (ready) {
                    clearInterval(waitForMerkleTree);
                    this.showMerkleTree();
                } else if (elapsed >= timeoutMs) {
                    clearInterval(waitForMerkleTree);
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
                const icon = document.getElementById('toggle-rotation-icon');
                if (icon) icon.src = 'imgs/icons/play.svg';
                button.title = 'Start rotation';
                button.setAttribute('aria-label', button.title);
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
                const icon = document.getElementById('toggle-rotation-icon');
                if (icon) icon.src = 'imgs/icons/play.svg';
                button.title = 'Start rotation';
                button.setAttribute('aria-label', button.title);
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
                this.orthographicZoom += e.deltaY * zoomSpeed; // Correct: increasing zoom value = zooming out
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
                const icon = document.getElementById('toggle-rotation-icon');
                if (icon) icon.src = 'imgs/icons/play.svg';
                button.title = 'Start rotation';
                button.setAttribute('aria-label', button.title);
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
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = this.isRotating ? 'imgs/icons/pause.svg' : 'imgs/icons/play.svg';
            button.title = this.isRotating ? 'Pause rotation' : 'Start rotation';
            button.setAttribute('aria-label', button.title);
        });
        

        
        document.getElementById('show-more-blocks').addEventListener('click', async () => {
            const btn = document.getElementById('show-more-blocks');
            btn.textContent = 'Loading...';
            btn.disabled = true;
            try {
                await this.loadOtherBlocksContent();
            } catch (e) {
                console.warn('Show more failed:', e);
            }
            btn.disabled = false;
            btn.textContent = 'Show more';
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
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.resetCameraPosition();
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
        
        // Merkle tree button
        document.getElementById('show-merkle-tree').addEventListener('click', () => {
            if (this.merkleTreeVisible) {
                this.hideMerkleTree();
            } else {
                this.showMerkleTree();
            }
        });
        document.getElementById('show-utxos').addEventListener('click', () => {
            const btn = document.getElementById('show-utxos');
            if (btn && btn.disabled) return;
            if (this.utxoSpheresVisible) {
                this.hideUtxoSpheres();
                if (btn) btn.textContent = 'Show UTXO';
            } else if (this.isLoadingUtxos) {
                this.stopUtxoLoad();
            } else if (this.blockUnspentOutputs && this.blockUnspentOutputs.length > 0) {
                this.showUtxoSpheres();
                if (btn) btn.textContent = 'Hide UTXO';
            } else {
                if (btn) btn.textContent = 'Stop loading';
                this.startUnspentOutputsFetch();
            }
        });
        
        // Go to block modal
        const blockModal = document.getElementById('block-modal');
        const goToBlockBtn = document.getElementById('go-to-block');
        const newBlockHeightInput = document.getElementById('new-block-height');
        const blockForm = document.getElementById('block-form');
        if (goToBlockBtn && blockModal) {
            goToBlockBtn.addEventListener('click', () => {
                blockModal.style.display = 'block';
                if (newBlockHeightInput) {
                    newBlockHeightInput.value = this.blockHeight || '';
                    newBlockHeightInput.focus();
                }
            });
        }
        const blockModalClose = document.querySelector('.block-modal-close');
        const blockModalCancel = document.getElementById('block-modal-cancel');
        if (blockModalClose) {
            blockModalClose.addEventListener('click', () => { blockModal.style.display = 'none'; });
        }
        if (blockModalCancel) {
            blockModalCancel.addEventListener('click', () => { blockModal.style.display = 'none'; });
        }
        if (blockModal) {
            blockModal.addEventListener('click', (e) => {
                if (e.target === blockModal) {
                    blockModal.style.display = 'none';
                }
            });
        }
        if (blockForm) {
            blockForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const height = newBlockHeightInput?.value?.trim();
                if (height !== undefined && height !== '') {
                    const h = parseInt(height, 10);
                    if (!isNaN(h) && h >= 0) {
                        blockModal.style.display = 'none';
                        window.location.href = `block.html?height=${h}`;
                    }
                }
            });
        }
        document.querySelectorAll('.go-to-block-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const height = btn.getAttribute('data-height');
                if (height !== null) {
                    blockModal.style.display = 'none';
                    window.location.href = `block.html?height=${height}`;
                }
            });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && blockModal && blockModal.style.display === 'block') {
                blockModal.style.display = 'none';
            }
        });
        
        // UI toggle and nav-reveal on hover are handled by controls-camera.js component on all pages.

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
                document.getElementById('bytes-per-line').disabled = false;
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
                document.getElementById('bytes-per-line').disabled = false;
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
                document.getElementById('bytes-per-line').disabled = false;
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'binary');
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-dump').addEventListener('click', () => {
            if (this.rawViewMode !== 'dump') {
                this.rawViewMode = 'dump';
                this.updateViewToggleButtons();
                document.getElementById('bytes-per-line').disabled = true;
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'dump');
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
                let hoveredUtxoSphereThisFrame = null;
                
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
                            // Use basic content - escape all user data
                            const escapedTxid = txid ? this.escapeHtml(txid.substring(0, 16) + '...') : 'Loading...';
                            tooltipContent = `
                                <strong>Transaction ${txData.index + 1}</strong><br>
                                TXID: ${escapedTxid}<br>
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
                    if (!foundInteraction && intersectedObject.userData && intersectedObject.userData.type === 'blockUtxo') {
                        hoveredUtxoSphereThisFrame = intersectedObject;
                        const utxo = intersectedObject.userData.utxo;
                        const valueBtc = utxo.value ? (utxo.value / 100000000).toFixed(8) : '0';
                        const addr = utxo.scriptpubkey_address ? this.escapeHtml(utxo.scriptpubkey_address.substring(0, 20) + '...') : '—';
                        tooltip.innerHTML = `
                            <strong>Unspent output</strong><br>
                            Value: ${valueBtc} BTC<br>
                            Address: ${addr}<br>
                            TXID: ${this.escapeHtml((utxo.txid || '').substring(0, 16))}...
                        `;
                        tooltip.style.display = 'block';
                        tooltip.style.left = event.clientX + 10 + 'px';
                        tooltip.style.top = event.clientY - 10 + 'px';
                        tooltip.style.pointerEvents = 'none';
                        foundInteraction = true;
                    }
                }
                
                // Update UTXO sphere hover (full opacity on hover)
                if (hoveredUtxoSphereThisFrame !== this.hoveredUtxoSphere) {
                    if (this.hoveredUtxoSphere && this.hoveredUtxoSphere.material) {
                        this.hoveredUtxoSphere.material.opacity = 0.35;
                    }
                    this.hoveredUtxoSphere = hoveredUtxoSphereThisFrame;
                    if (this.hoveredUtxoSphere && this.hoveredUtxoSphere.material) {
                        this.hoveredUtxoSphere.material.opacity = 1;
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
                                const escapedHex = this.escapeHtml(this.blockHeaderData.substring(0, 24) + '...');
                                tooltipContent += `<br><br><em>Hex: ${escapedHex}</em>`;
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
                            
                            // Use stored block height from userData (accurate); fallback to Z-based for legacy
                            const currentHeight = parseInt(this.blockHeight) || 0;
                            const storedHeight = intersectedObject.userData && intersectedObject.userData.blockHeight !== undefined
                                ? intersectedObject.userData.blockHeight
                                : null;
                            const isCurrentBlock = intersectedObject.userData && intersectedObject.userData.type === 'currentBlock';
                            const targetHeight = storedHeight !== null ? storedHeight : (currentHeight - Math.round(intersectedObject.position.z / 4));
                            
                            let tooltipContent;
                            if (isCurrentBlock || (storedHeight === null && Math.round(intersectedObject.position.z / 4) === 0)) {
                                const escapedHeight = this.escapeHtml(String(currentHeight));
                                tooltipContent = `
                                    <strong>Current Block</strong><br>
                                    Height: ${escapedHeight}<br>
                                    <em>Double-click to stay on this block</em>
                                `;
                            } else {
                                const escapedHeight = this.escapeHtml(String(targetHeight));
                                tooltipContent = `
                                    <strong>Block</strong><br>
                                    Height: ${escapedHeight}<br>
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
                    // Clear UTXO sphere hover
                    if (this.hoveredUtxoSphere && this.hoveredUtxoSphere.material) {
                        this.hoveredUtxoSphere.material.opacity = 0.35;
                        this.hoveredUtxoSphere = null;
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
                if (this.hoveredUtxoSphere && this.hoveredUtxoSphere.material) {
                    this.hoveredUtxoSphere.material.opacity = 0.35;
                    this.hoveredUtxoSphere = null;
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
            if (this.hoveredUtxoSphere && this.hoveredUtxoSphere.material) {
                this.hoveredUtxoSphere.material.opacity = 0.35;
                this.hoveredUtxoSphere = null;
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
                // Look for the first interactive object (UTXO sphere, transaction, or block)
                for (let i = 0; i < intersects.length; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    // Double-click UTXO sphere: go to transaction page
                    if (intersectedObject.userData?.type === 'blockUtxo' && intersectedObject.userData?.utxo?.txid) {
                        window.location.href = `transaction.html?txid=${intersectedObject.userData.utxo.txid}`;
                        return;
                    }
                    
                    // Check if it's a transaction
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
                        
                        // Use stored block height from userData for accurate navigation
                        const currentHeight = parseInt(this.blockHeight) || 0;
                        const isCurrentBlock = intersectedObject.userData && intersectedObject.userData.type === 'currentBlock';
                        const storedHeight = intersectedObject.userData && intersectedObject.userData.blockHeight !== undefined
                            ? intersectedObject.userData.blockHeight
                            : null;
                        const blockIndex = Math.round(intersectedObject.position.z / 4);
                        const targetHeight = storedHeight !== null ? storedHeight : (currentHeight - blockIndex);
                        
                        if (isCurrentBlock || (storedHeight === null && blockIndex === 0)) {
                            // Current block - stay on same page
                        } else {
                            // Past or future block - navigate to that block's height
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
        
        // Update the button icon and title
        const button = document.getElementById('toggle-view');
        const icon = document.getElementById('toggle-view-icon');
        if (icon) icon.src = this.isPerspective ? 'imgs/icons/orthographic.svg' : 'imgs/icons/perspective.svg';
        button.title = this.isPerspective ? 'Switch to orthographic' : 'Switch to perspective';
        button.setAttribute('aria-label', button.title);
    }
    
    resetCameraPosition() {
        this.controls.target.set(0, 2, 0);
        this.controls.distance = 20;
        this.controls.phi = Math.PI / 3;
        this.controls.theta = 0;
        if (this.controls.panX !== undefined) this.controls.panX = 0;
        if (this.controls.panY !== undefined) this.controls.panY = 0;
        this.controls.update();
        if (!this.isPerspective) {
            this.orthographicZoom = 20;
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
    }
    
    async loadAllTransactions() {
        if (this.transactions.length === 0) {
            return;
        }
        
        if (this.isLoadingAll) {
            return;
        }
        
        // Reset stop flag
        this.shouldStopLoadingAll = false;
        
        const button = document.getElementById('load-all-transactions');
        
        button.textContent = 'Stop loading';
        this.isLoadingAll = true;
        this.showLoadingModal('Loading transactions...', true);
        
        // Update URL with loadAll parameter
        const url = new URL(window.location);
        url.searchParams.set('loadAll', 'true');
        window.history.replaceState({}, '', url);
        
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
            this.hideLoadingModal();
            button.textContent = 'All Loaded';
            button.disabled = true;
            this.isLoadingAll = false;
            return;
        }
        
        // First, animate position for size-only loaded transactions (no API call needed)
        for (const cuboid of sizeOnlyTransactions) {
            if (this.shouldStopLoadingAll) break;
            
            const layer = cuboid.userData.layer;
            const baseAlignedY = 1.0; // Reduced from 2 to keep inside block cube
            const spacingY = 0.3;
            const alignedY = baseAlignedY - layer * spacingY;
            
            // Animate merkle tree line's first point if merkle tree is visible
            // Start this BEFORE the cuboid animation so it can track from the beginning
            if (this.merkleTreeVisible && cuboid.userData.txid) {
                this.animateMerkleTreeLineOrigin(cuboid, alignedY, 500);
            }
            
            this.animateCuboidPosition(cuboid, alignedY, 500);
            cuboid.userData.sizeOnlyLoaded = false;
            
            // Animate header if needed
            if (!this.headerAnimated && this.headerMesh && layer === 0) {
                const headerTargetY = baseAlignedY + 0.19;
                this.animateCuboidPosition(this.headerMesh, headerTargetY, 500);
                this.headerAnimated = true;
            }
            
            loadedCount++;
            this.updateLoadingProgress(`Loading ${loadedCount}/${totalToLoad}...`, Math.round(100 * loadedCount / totalToLoad));
        }
        
        // Load transactions one by one with delay (only unloaded ones)
        for (let i = 0; i < unloadedTransactions.length; i++) {
            // Check if user wants to stop
            if (this.shouldStopLoadingAll) {
                break;
            }
            
            const cuboid = unloadedTransactions[i];
            const txData = cuboid.userData;
            
            try {
                await this.loadSingleTransaction(cuboid, txData.txid, txData.index, 0);
                loadedCount++;
                this.updateLoadingProgress(`Loading ${loadedCount}/${totalToLoad}...`, Math.round(100 * loadedCount / totalToLoad));
                
                // Update loaded transaction count
                this.loadedTransactionCount = Math.max(this.loadedTransactionCount, txData.index + 1);
                
                // Refresh merkle tree every 100 transactions if visible
                if (this.merkleTreeVisible && loadedCount % 100 === 0) {
                    // Hide and show to rebuild with updated transaction positions
                    this.hideMerkleTree(false, true); // Don't update button, skip flag update
                    // Small delay to ensure hide completes
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Show will set the flag back to true
                    await this.showMerkleTree();
                }
                
                // Merkle tree line origins are now animated individually with each transaction
                
                
            } catch (error) {
                errorCount++;
                console.warn(`Failed to load transaction ${i + 1}:`, error);
            }
            
            // Add delay between requests (except for the last one)
            if (i < unloadedTransactions.length - 1 && !this.shouldStopLoadingAll) {
                await new Promise(resolve => setTimeout(resolve, 5)); // 0.005 second delay (20x faster than original)
            }
        }
        
        this.isLoadingAll = false;
        this.shouldStopLoadingAll = false;
        this.hideLoadingModal();
        
        if (loadedCount < totalToLoad) {
            button.textContent = 'Load TXs';
        } else if (errorCount > 0) {
            button.textContent = `Loaded (${errorCount} failed)`;
        } else {
            button.textContent = 'All Loaded';
            button.disabled = true;
            const url = new URL(window.location);
            url.searchParams.delete('loadAll');
            url.searchParams.delete('loadall');
            window.history.replaceState({}, '', url);
        }
    }
    
    stopLoadingAll() {
        this.shouldStopLoadingAll = true;
        
        const url = new URL(window.location);
        url.searchParams.set('loadAll', 'false');
        window.history.replaceState({}, '', url);
        
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
            // Reduced distance: start at 0.8, move to 1.0 (only 0.2 units instead of 1.2)
            const baseAlignedY = 1.0; // Reduced from 2 to minimize animation distance
            const layer = cuboid.userData.layer;
            const spacingY = 0.3; // Same spacing as used in original grid
            const alignedY = baseAlignedY - layer * spacingY; // Maintain layer spacing
            
            // Animate merkle tree line's first point if merkle tree is visible
            // Start this BEFORE the cuboid animation so it can track from the beginning
            if (this.merkleTreeVisible && cuboid.userData.txid) {
                this.animateMerkleTreeLineOrigin(cuboid, alignedY, 500);
            }
            
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
        const originalHeight = 0.03; // CUBOID_HEIGHT from geometry creation
        
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
            // Show loading state in existing tooltip - escape txid
            const escapedTxidShort = this.escapeHtml(txid.substring(0, 16) + '...');
            tooltip.innerHTML = `
                <strong>Loading Transaction Details...</strong><br>
                TXID: ${escapedTxidShort}
            `;
            // Keep current position and visibility
            
            // Fetch transaction data from mempool.space API
            const response = await fetch(`https://mempool.space/api/tx/${txid}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const txData = await response.json();
            
            // Validate API response
            if (!txData || typeof txData !== 'object') {
                throw new Error('Invalid transaction data received');
            }
            
            // Format inputs - escape all user data
            const inputsHtml = txData.vin.slice(0, 3).map((input, index) => {
                const amount = input.prevout ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
                const address = input.prevout ? (input.prevout.scriptpubkey_address || 'Unknown') : 'Unknown';
                const escapedAddress = this.escapeHtml(address.substring(0, 12) + '...');
                return `Input ${index + 1}: ${this.escapeHtml(amount)} BTC (${escapedAddress})`;
            }).join('<br>');
            
            const moreInputs = txData.vin.length > 3 ? `<br>+${this.escapeHtml(String(txData.vin.length - 3))} more inputs` : '';
            
            // Format outputs - escape all user data
            const outputsHtml = txData.vout.slice(0, 3).map((output, index) => {
                const amount = (output.value / 100000000).toFixed(8);
                const address = output.scriptpubkey_address || 'Unknown';
                const escapedAddress = this.escapeHtml(address.substring(0, 12) + '...');
                return `Output ${index + 1}: ${this.escapeHtml(amount)} BTC (${escapedAddress})`;
            }).join('<br>');
            
            const moreOutputs = txData.vout.length > 3 ? `<br>+${this.escapeHtml(String(txData.vout.length - 3))} more outputs` : '';
            
            // Calculate total input and output amounts
            const totalInput = txData.vin.reduce((sum, input) => {
                return sum + (input.prevout ? input.prevout.value : 0);
            }, 0) / 100000000;
            
            const totalOutput = txData.vout.reduce((sum, output) => {
                return sum + output.value;
            }, 0) / 100000000;
            
            const fee = (txData.fee / 100000000).toFixed(8);
            
            // Update tooltip with detailed transaction information - escape all dynamic data
            const escapedTxidShort2 = this.escapeHtml(txid.substring(0, 16) + '...');
            const tooltipContent = `
                <strong>Transaction Details</strong><br>
                <strong>TXID:</strong> ${escapedTxidShort2}<br>
                <strong>Size:</strong> ${this.escapeHtml(String(txData.size || 0))} bytes<br>
                <strong>Fee:</strong> ${this.escapeHtml(fee)} BTC<br>
                <br>
                <strong>Inputs (${this.escapeHtml(String(txData.vin.length))}):</strong><br>
                ${inputsHtml}${moreInputs}<br>
                <strong>Total Input:</strong> ${this.escapeHtml(totalInput.toFixed(8))} BTC<br>
                <br>
                <strong>Outputs (${this.escapeHtml(String(txData.vout.length))}):</strong><br>
                ${outputsHtml}${moreOutputs}<br>
                <strong>Total Output:</strong> ${this.escapeHtml(totalOutput.toFixed(8))} BTC<br>
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
            const escapedTxidShort = this.escapeHtml(txid.substring(0, 16) + '...');
            tooltip.innerHTML = `
                <strong>Error Loading Transaction</strong><br>
                TXID: ${escapedTxidShort}<br>
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

    async createScene() {
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
        
        await this.createBlockVisualization();
    }

    async createBlockVisualization() {
        // Get current height for both future and past block calculations
        const currentHeight = parseInt(this.blockHeight) || 0;
        
        // Create main block as perfect cube with lower opacity
        const blockGeometry = new THREE.BoxGeometry(3, 3, 3);
        const blockMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.15,  // current block with header and transactions
            depthWrite: false,  // Prevent depth writing issues with transparency
            alphaTest: 0.01     // Helps with transparency sorting
        });
        
        // Create current block
        const block = new THREE.Mesh(blockGeometry, blockMaterial);
        block.position.set(0, 0, 0);
        block.castShadow = true;
        block.renderOrder = 1;  // Render after transactions (higher number = later)
        block.userData = { type: 'currentBlock', blockHeight: currentHeight };
        this.scene.add(block);
        
        // Store block reference for later use
        this.blockMesh = block;
        
        // Create block header representation (80 bytes)
        // Using same scale as transactions: width spans tx grid, height = max(0.1, 80/1000) = 0.1
        // Width = 9 spaces between 10 cols (9 * 0.25 = 2.25) + cuboid length (0.21) = 2.46
        const HEADER_WIDTH = 2.46;  // Aligns with first and last transaction edges
        const HEADER_HEIGHT = 0.01;  // Thin slice representing 80 bytes
        const HEADER_DEPTH = 0.01;  // Same depth as transaction cuboids
        
        const headerGeometry = new THREE.BoxGeometry(HEADER_WIDTH, HEADER_HEIGHT, HEADER_DEPTH);
        const headerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        this.headerMesh = new THREE.Mesh(headerGeometry, headerMaterial);
        // Calculate Z position to align with first row of transactions (row 0)
        // Use same spacing as transactions: spacingZ = 0.25
        const spacingZ = 0.25;
        const firstRow = 0; // First row index
        const firstRowZ = Math.max(-1.4, Math.min(1.4, (firstRow - 4.5) * spacingZ));
        this.headerMesh.position.set(0, 1.0, firstRowZ); // Aligned with first row of transactions
        this.headerMesh.renderOrder = 0;
        this.headerMesh.userData = { type: 'header', description: 'Block Header (80 bytes)' };
        this.scene.add(this.headerMesh);
        
        // Fetch block timestamps for time-based spacing
        // Use smaller factor than difficulty.js since blocks are in linear arrangement, not spiral
        const FACTOR_BLOCK_DISTANCE = 0.016; // Spacing between past/future blocks (time-based)
        
        // Get current block timestamp - always fetch it to ensure we have the correct value
        let currentTimestamp = 0;
        try {
            const currentHashResponse = await fetch(`https://mempool.space/api/block-height/${currentHeight}`);
            if (currentHashResponse.ok) {
                const currentHash = await currentHashResponse.text();
                const currentBlockResponse = await fetch(`https://mempool.space/api/v1/block/${currentHash}`);
                if (currentBlockResponse.ok) {
                    const currentBlockData = await currentBlockResponse.json();
                    currentTimestamp = currentBlockData.timestamp || 0;
                }
            }
        } catch (error) {
            console.warn(`Failed to fetch timestamp for current block ${currentHeight}:`, error);
            // Fallback to blockData if available
            currentTimestamp = this.blockData?.timestamp || 0;
        }
        
        // Validate timestamp is reasonable (between 2009 and 2100)
        const MIN_TIMESTAMP = 1231006500; // Jan 3, 2009 (Bitcoin genesis)
        const MAX_TIMESTAMP = 4102444800; // Jan 1, 2100
        if (currentTimestamp < MIN_TIMESTAMP || currentTimestamp > MAX_TIMESTAMP) {
            console.warn(`Invalid current timestamp: ${currentTimestamp}, will use default time differences`);
            currentTimestamp = 0; // Will use default time difference for all calculations
        }
        
        
        // Create past blocks in front of the current block (only if current height allows)
        const maxPastBlocks = Math.min(5, currentHeight); // Don't show more past blocks than available
        
        let cumulativeZPast = 0;
        // Only use currentTimestamp if it's valid, otherwise start with 0 and use defaults
        let lastTimestamp = (currentTimestamp >= MIN_TIMESTAMP && currentTimestamp <= MAX_TIMESTAMP) ? currentTimestamp : 0;
        for (let i = 1; i <= maxPastBlocks; i++) {
            const prevHeight = currentHeight - i;
            
            // Fetch timestamp for previous block and calculate time difference
            // Same approach as difficulty.js: time_difference represents how long it took for that block to be found
            let timeDifference = 600; // Default 10 minutes
            try {
                const prevHashResponse = await fetch(`https://mempool.space/api/block-height/${prevHeight}`);
                if (prevHashResponse.ok) {
                    const prevHash = await prevHashResponse.text();
                    const prevBlockResponse = await fetch(`https://mempool.space/api/v1/block/${prevHash}`);
                    if (prevBlockResponse.ok) {
                        const prevBlockData = await prevBlockResponse.json();
                        const prevTimestamp = prevBlockData.timestamp || 0;
                        
                        
                        // Only calculate time difference if both timestamps are valid
                        if (lastTimestamp > 0 && prevTimestamp > 0 && prevTimestamp <= lastTimestamp) {
                            // Calculate time difference: last block time - previous block time
                            // This represents how long it took for the previous block to be found
                            timeDifference = lastTimestamp - prevTimestamp;
                            // Clamp to reasonable bounds (0 to 2 hours)
                            if (timeDifference > 7200) {
                                console.warn(`Time difference too large: ${timeDifference}s (${timeDifference/3600}h), using default`);
                                timeDifference = 600; // Use default if unreasonably large
                            }
                        } else if (lastTimestamp === 0) {
                            // If we don't have a valid lastTimestamp, use default
                            console.warn(`Invalid lastTimestamp (0) for block ${prevHeight}, using default time difference`);
                            timeDifference = 600;
                        } else if (prevTimestamp > lastTimestamp) {
                            // Clock irregularity - previous block is newer than last block
                            console.warn(`Clock irregularity detected: prevTimestamp ${prevTimestamp} > lastTimestamp ${lastTimestamp}, using default`);
                            timeDifference = 600;
                        } else if (prevTimestamp === 0) {
                            // Invalid previous timestamp
                            console.warn(`Invalid prevTimestamp (0) for block ${prevHeight}, using default time difference`);
                            timeDifference = 600;
                        }
                        lastTimestamp = prevTimestamp;
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch timestamp for block ${prevHeight}:`, error);
            }
            
            // Final safety check: if timeDifference is still unreasonably large, use default
            if (timeDifference > 7200) {
                console.warn(`Final safety check: timeDifference ${timeDifference}s is too large, using default 600s`);
                timeDifference = 600;
            }
            
            // Calculate spacing based on time difference (exactly like difficulty.js)
            // block_distance = timeDifference (for non-edge blocks)
            const blockDistance = timeDifference * FACTOR_BLOCK_DISTANCE;
            cumulativeZPast += blockDistance;
            
            
            const prevBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            prevBlock.position.set(0, 0, cumulativeZPast); // Position based on cumulative time difference
            prevBlock.castShadow = true;
            prevBlock.renderOrder = 1;
            prevBlock.userData = { type: 'pastBlock', blockHeight: prevHeight };
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            prevBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(prevBlock);
            this.pastBlockInfos.push({ mesh: prevBlock, height: prevHeight, z: cumulativeZPast });
        }
        
        // Create future blocks behind the current block (limited by chain tip)
        const maxFutureBlocks = this.chainTipHeight ? Math.max(0, this.chainTipHeight - currentHeight) : 5;
        const futureBlocksToShow = Math.min(5, maxFutureBlocks); // Cap at 5 blocks maximum
        
        
        let cumulativeZFuture = 0;
        // Only use currentTimestamp if it's valid, otherwise start with 0 and use defaults
        let nextLastTimestamp = (currentTimestamp >= MIN_TIMESTAMP && currentTimestamp <= MAX_TIMESTAMP) ? currentTimestamp : 0;
        for (let i = 1; i <= futureBlocksToShow; i++) {
            const nextHeight = currentHeight + i;
            
            // Fetch timestamp for next block and calculate time difference
            // Same approach as difficulty.js: time_difference represents how long it took for that block to be found
            let timeDifference = 600; // Default 10 minutes
            try {
                const nextHashResponse = await fetch(`https://mempool.space/api/block-height/${nextHeight}`);
                if (nextHashResponse.ok) {
                    const nextHash = await nextHashResponse.text();
                    const nextBlockResponse = await fetch(`https://mempool.space/api/v1/block/${nextHash}`);
                    if (nextBlockResponse.ok) {
                        const nextBlockData = await nextBlockResponse.json();
                        const nextTimestamp = nextBlockData.timestamp || 0;
                        
                        // Only calculate time difference if both timestamps are valid
                        if (nextLastTimestamp > 0 && nextTimestamp > 0 && nextTimestamp >= nextLastTimestamp) {
                            // Calculate time difference: next block time - last block time
                            // This represents how long it took for the next block to be found
                            timeDifference = nextTimestamp - nextLastTimestamp;
                            // Clamp to reasonable bounds (0 to 2 hours)
                            if (timeDifference > 7200) {
                                console.warn(`Time difference too large: ${timeDifference}s, using default`);
                                timeDifference = 600; // Use default if unreasonably large
                            }
                        } else if (nextLastTimestamp === 0) {
                            // If we don't have a valid nextLastTimestamp, use default
                            console.warn(`Invalid nextLastTimestamp for block ${nextHeight}, using default time difference`);
                            timeDifference = 600;
                        } else if (nextTimestamp < nextLastTimestamp) {
                            // Clock irregularity - next block is older than last block
                            console.warn(`Clock irregularity detected: nextTimestamp ${nextTimestamp} < nextLastTimestamp ${nextLastTimestamp}, using default`);
                            timeDifference = 600;
                        }
                        nextLastTimestamp = nextTimestamp;
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch timestamp for block ${nextHeight}:`, error);
            }
            
            // Final safety check: if timeDifference is still unreasonably large, use default
            if (timeDifference > 7200) {
                console.warn(`Final safety check: timeDifference ${timeDifference}s is too large, using default 600s`);
                timeDifference = 600;
            }
            
            // Calculate spacing based on time difference (exactly like difficulty.js)
            // block_distance = timeDifference (for non-edge blocks)
            const blockDistance = timeDifference * FACTOR_BLOCK_DISTANCE;
            cumulativeZFuture += blockDistance;
            
            
            const nextBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            nextBlock.position.set(0, 0, -cumulativeZFuture); // Position based on cumulative time difference (negative Z)
            nextBlock.castShadow = true;
            nextBlock.renderOrder = 1;
            nextBlock.userData = { type: 'futureBlock', blockHeight: nextHeight };
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            nextBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(nextBlock);
            this.futureBlockInfos.push({ mesh: nextBlock, height: nextHeight, z: -cumulativeZFuture });
        }
    }

    /**
     * When "Show more": add 5 more past and 5 more future block cubes (incremental, fading only).
     * Content (header+tx) is loaded separately for the "inner" blocks; this keeps 5 fading at each end.
     */
    async extendBlocksRow() {
        const currentHeight = parseInt(this.blockHeight) || 0;
        const countPast = this.pastBlockInfos.length;
        const countFuture = this.futureBlockInfos.length;

        // Fetch timestamp for the last past block we have so we can compute spacing for the next 5
        let lastTimestamp = 0;
        const lastPastHeight = currentHeight - countPast;
        if (lastPastHeight >= 0 && countPast >= 1) {
            try {
                const hashRes = await fetch(`https://mempool.space/api/block-height/${lastPastHeight}`);
                if (hashRes.ok) {
                    const hash = (await hashRes.text()).trim();
                    const blockRes = await fetch(`https://mempool.space/api/v1/block/${hash}`);
                    if (blockRes.ok) {
                        const data = await blockRes.json();
                        lastTimestamp = data.timestamp || 0;
                    }
                }
            } catch (_) { /* ignore */ }
        }
        if (lastTimestamp < this.MIN_TIMESTAMP || lastTimestamp > this.MAX_TIMESTAMP) lastTimestamp = 0;

        let cumulativeZPast = countPast > 0 ? this.pastBlockInfos[countPast - 1].z : 0;
        for (let k = 1; k <= 5; k++) {
            const i = countPast + k;
            const prevHeight = currentHeight - i;
            if (prevHeight < 0) break;
            let timeDifference = 600;
            try {
                const prevHashResponse = await fetch(`https://mempool.space/api/block-height/${prevHeight}`);
                if (prevHashResponse.ok) {
                    const prevHash = (await prevHashResponse.text()).trim();
                    const prevBlockResponse = await fetch(`https://mempool.space/api/v1/block/${prevHash}`);
                    if (prevBlockResponse.ok) {
                        const prevBlockData = await prevBlockResponse.json();
                        const prevTimestamp = prevBlockData.timestamp || 0;
                        if (lastTimestamp > 0 && prevTimestamp > 0 && prevTimestamp <= lastTimestamp) {
                            timeDifference = Math.min(7200, lastTimestamp - prevTimestamp);
                        }
                        lastTimestamp = prevTimestamp;
                    }
                }
            } catch (_) { /* ignore */ }
            if (timeDifference > 7200) timeDifference = 600;
            cumulativeZPast += timeDifference * this.FACTOR_BLOCK_DISTANCE;

            const geom = new THREE.BoxGeometry(3, 3, 3);
            const mat = new THREE.MeshLambertMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.15,
                depthWrite: false,
                alphaTest: 0.01
            });
            const prevBlock = new THREE.Mesh(geom, mat);
            prevBlock.position.set(0, 0, cumulativeZPast);
            prevBlock.castShadow = true;
            prevBlock.renderOrder = 1;
            prevBlock.userData = { type: 'pastBlock', blockHeight: prevHeight };
            const opacity = Math.max(0.06, 0.1 - (i * 0.02));
            prevBlock.material.opacity = opacity;
            this.scene.add(prevBlock);
            this.pastBlockInfos.push({ mesh: prevBlock, height: prevHeight, z: cumulativeZPast });
        }

        // Future: fetch timestamp for the last future block we have
        let nextLastTimestamp = 0;
        const lastFutureHeight = currentHeight + countFuture;
        if (countFuture >= 1) {
            try {
                const hashRes = await fetch(`https://mempool.space/api/block-height/${lastFutureHeight}`);
                if (hashRes.ok) {
                    const hash = (await hashRes.text()).trim();
                    const blockRes = await fetch(`https://mempool.space/api/v1/block/${hash}`);
                    if (blockRes.ok) {
                        const data = await blockRes.json();
                        nextLastTimestamp = data.timestamp || 0;
                    }
                }
            } catch (_) { /* ignore */ }
        }
        if (nextLastTimestamp < this.MIN_TIMESTAMP || nextLastTimestamp > this.MAX_TIMESTAMP) nextLastTimestamp = 0;

        let cumulativeZFuture = countFuture > 0 ? Math.abs(this.futureBlockInfos[countFuture - 1].z) : 0;
        for (let k = 1; k <= 5; k++) {
            const i = countFuture + k;
            const nextHeight = currentHeight + i;
            if (this.chainTipHeight != null && nextHeight > this.chainTipHeight) break;
            let timeDifference = 600;
            try {
                const nextHashResponse = await fetch(`https://mempool.space/api/block-height/${nextHeight}`);
                if (nextHashResponse.ok) {
                    const nextHash = (await nextHashResponse.text()).trim();
                    const nextBlockResponse = await fetch(`https://mempool.space/api/v1/block/${nextHash}`);
                    if (nextBlockResponse.ok) {
                        const nextBlockData = await nextBlockResponse.json();
                        const nextTimestamp = nextBlockData.timestamp || 0;
                        if (nextLastTimestamp > 0 && nextTimestamp > 0 && nextTimestamp >= nextLastTimestamp) {
                            timeDifference = Math.min(7200, nextTimestamp - nextLastTimestamp);
                        }
                        nextLastTimestamp = nextTimestamp;
                    }
                }
            } catch (_) { /* ignore */ }
            if (timeDifference > 7200) timeDifference = 600;
            cumulativeZFuture += timeDifference * this.FACTOR_BLOCK_DISTANCE;

            const geom = new THREE.BoxGeometry(3, 3, 3);
            const mat = new THREE.MeshLambertMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.15,
                depthWrite: false,
                alphaTest: 0.01
            });
            const nextBlock = new THREE.Mesh(geom, mat);
            nextBlock.position.set(0, 0, -cumulativeZFuture);
            nextBlock.castShadow = true;
            nextBlock.renderOrder = 1;
            nextBlock.userData = { type: 'futureBlock', blockHeight: nextHeight };
            const opacity = Math.max(0.06, 0.1 - (i * 0.02));
            nextBlock.material.opacity = opacity;
            this.scene.add(nextBlock);
            this.futureBlockInfos.push({ mesh: nextBlock, height: nextHeight, z: -cumulativeZFuture });
        }
    }

    /**
     * Create header mesh + transaction cuboids for a block at given z (past/future block).
     * blockOpacity: matches the block cube so header and cuboids fade with the block.
     */
    createHeaderAndCuboidsForBlock(blockZ, txCount, blockOpacity = 0.4) {
        const HEADER_WIDTH = 2.46;
        const HEADER_HEIGHT = 0.01;
        const HEADER_DEPTH = 0.01;
        const spacingZ = 0.25;
        const firstRowZ = Math.max(-1.4, Math.min(1.4, (0 - 4.5) * spacingZ));
        const headerGeometry = new THREE.BoxGeometry(HEADER_WIDTH, HEADER_HEIGHT, HEADER_DEPTH);
        const headerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: blockOpacity
        });
        const headerMesh = new THREE.Mesh(headerGeometry, headerMaterial);
        headerMesh.position.set(0, 1.0, blockZ + firstRowZ);
        headerMesh.renderOrder = 0;
        this.scene.add(headerMesh);

        const transactionsPerRow = 10;
        const transactionsPerLayer = 100;
        const spacingX = 0.25;
        const spacingY = 0.3;
        const CUBOID_WIDTH = 0.01;
        const CUBOID_HEIGHT = 0.03;
        const CUBOID_LENGTH = 0.21;
        // Use actual tx count so each block's geometry varies; cap at 1000 for performance (10 blocks × 1000)
        const n = Math.min(Math.max(0, txCount), 4000);
        const cuboids = [];
        for (let i = 0; i < n; i++) {
            const layer = Math.floor(i / transactionsPerLayer);
            const positionInLayer = i % transactionsPerLayer;
            const row = Math.floor(positionInLayer / transactionsPerRow);
            const col = positionInLayer % transactionsPerRow;
            const x = ((transactionsPerRow - 1) / 2 - col) * spacingX;
            const z = (row - 4.5) * spacingZ;
            const zClamped = Math.max(-1.4, Math.min(1.4, z));
            const y = 0.8 - layer * spacingY;
            const geometry = new THREE.BoxGeometry(CUBOID_LENGTH, CUBOID_HEIGHT, CUBOID_WIDTH);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: blockOpacity
            });
            const cuboid = new THREE.Mesh(geometry, material);
            cuboid.position.set(x, y, blockZ + zClamped);
            cuboid.renderOrder = 0;
            this.scene.add(cuboid);
            cuboids.push(cuboid);
        }
        return { headerMesh, cuboids };
    }

    /**
     * Get unspent outputs created by this block (block approach).
     * Fetches block txids, then for each tx gets tx + outspends; collects outputs where spent === false.
     * Uses /api/tx/:txid and /api/tx/:txid/outspends (plural = all outputs in one call).
     */
    async getUnspentOutputsForBlock(blockHash, onProgress, onBatch) {
        const DELAY_MS = 15;
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        const unspent = [];
        let txids = [];
        try {
            const res = await fetch(`https://mempool.space/api/block/${blockHash}/txids`);
            if (!res.ok) return [];
            txids = await res.json();
            if (!Array.isArray(txids)) return [];
        } catch (_) { return []; }
        const toProcess = txids;
        if (this.shouldStopUtxoLoad) return unspent;
        for (let i = 0; i < toProcess.length; i++) {
            if (this.shouldStopUtxoLoad) break;
            const txid = toProcess[i];
            const prevLen = unspent.length;
            try {
                const [txRes, outspendsRes] = await Promise.all([
                    fetch(`https://mempool.space/api/tx/${txid}`),
                    fetch(`https://mempool.space/api/tx/${txid}/outspends`)
                ]);
                if (txRes.status === 429 || outspendsRes.status === 429) break;
                if (!txRes.ok || !outspendsRes.ok) continue;
                const tx = await txRes.json();
                const outspends = await outspendsRes.json();
                const vouts = tx.vout || [];
                if (!Array.isArray(outspends) || outspends.length < vouts.length) continue;
                for (let v = 0; v < vouts.length; v++) {
                    if (!outspends[v] || outspends[v].spent) continue;
                    unspent.push({
                        txid,
                        vout: v,
                        value: vouts[v].value ?? 0,
                        scriptpubkey_address: vouts[v].scriptpubkey_address || null,
                        status: { block_height: this.blockData?.height }
                    });
                }
                await delay(DELAY_MS);
                if (this.shouldStopUtxoLoad) break;
            } catch (_) { /* skip tx */ }
            if (typeof onProgress === 'function') onProgress(i + 1, toProcess.length);
            if (typeof onBatch === 'function' && unspent.length > prevLen) {
                onBatch(unspent.slice(prevLen));
            }
        }
        return unspent;
    }

    /**
     * Get actual transaction count for a block by hash (same source as current block on load).
     * Tries /api/block/:hash (tx_count), then /api/v1/block/:hash, then /api/block/:hash/txids length.
     */
    async getBlockTxCount(hash) {
        const urlBlock = `https://mempool.space/api/block/${hash}`;
        const urlBlockV1 = `https://mempool.space/api/v1/block/${hash}`;
        const urlTxids = `https://mempool.space/api/block/${hash}/txids`;
        try {
            const res = await fetch(urlBlock);
            if (res.ok) {
                const data = await res.json();
                const n = data.tx_count != null ? parseInt(data.tx_count, 10) : NaN;
                if (!isNaN(n) && n >= 0) return n;
            }
        } catch (_) { /* ignore */ }
        try {
            const res = await fetch(urlBlockV1);
            if (res.ok) {
                const data = await res.json();
                const n = data.tx_count != null ? parseInt(data.tx_count, 10) : NaN;
                if (!isNaN(n) && n >= 0) return n;
            }
        } catch (_) { /* ignore */ }
        try {
            const res = await fetch(urlTxids);
            if (res.ok) {
                const txids = await res.json();
                return Array.isArray(txids) ? txids.length : 0;
            }
        } catch (_) { /* ignore */ }
        return 0;
    }

    async loadOtherBlocksContent() {
        // 1) Add 5 past + 5 future fading blocks (no content)
        await this.extendBlocksRow();
        // 2) Load header + tx only for the next 5 past and next 5 future (the "inner" ones that now get content)
        const pastToLoad = this.pastBlockInfos.slice(this.contentPastCount, this.contentPastCount + 5);
        const futureToLoad = this.futureBlockInfos.slice(this.contentFutureCount, this.contentFutureCount + 5);
        const blockOpacity = 0.1; // blocks with loaded transactions match current block
        for (const info of [...pastToLoad, ...futureToLoad]) {
            try {
                const hashRes = await fetch(`https://mempool.space/api/block-height/${info.height}`);
                if (!hashRes.ok) continue;
                const hash = (await hashRes.text()).trim();
                if (!hash) continue;
                const txCount = await this.getBlockTxCount(hash);
                info.mesh.material.opacity = blockOpacity;
                const { headerMesh, cuboids } = this.createHeaderAndCuboidsForBlock(info.z, txCount, blockOpacity);
                this.otherBlocksHeaders.push(headerMesh);
                this.otherBlocksCuboids.push(...cuboids);
            } catch (e) {
                console.warn(`Failed to load block ${info.height} for Show more:`, e);
            }
        }
        this.contentPastCount += pastToLoad.length;
        this.contentFutureCount += futureToLoad.length;
    }

    removeOtherBlocksContent() {
        this.otherBlocksHeaders.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.otherBlocksCuboids.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.otherBlocksHeaders = [];
        this.otherBlocksCuboids = [];
    }

    async fetchChainTipHeight() {
        try {
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
            
            // If no block height provided, use chain tip (allow height 0 for genesis)
            if (this.blockHeight == null) {
                this.blockHeight = this.chainTipHeight.toString();
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
            
            // Validate block data
            if (!this.blockData || typeof this.blockData !== 'object') {
                throw new Error('Invalid block data received');
            }
            if (typeof this.blockData.height !== 'number' || this.blockData.height < 0) {
                throw new Error('Invalid block height in response');
            }
            if (this.blockData.id && (typeof this.blockData.id !== 'string' || this.blockData.id.length > 64)) {
                throw new Error('Invalid block hash in response');
            }
            
            this.updateLoadingProgress('Fetching transaction IDs...', 60);
            // Fetch transaction IDs for this block
            const txidsResponse = await fetch(`https://mempool.space/api/block/${blockHash}/txids`);
            
            if (txidsResponse.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (txidsResponse.ok) {
                const txids = await txidsResponse.json();
                // Validate transaction IDs array
                if (Array.isArray(txids)) {
                    // Validate each transaction ID format
                    this.transactionIds = txids.filter(txid => 
                        typeof txid === 'string' && /^[a-fA-F0-9]{64}$/.test(txid)
                    );
                } else {
                    console.warn('Invalid transaction IDs format received');
                    this.transactionIds = [];
                }
            } else {
                console.warn('Could not fetch transaction IDs, using fallback visualization');
                this.transactionIds = [];
            }
            
            this.updateLoadingProgress('Fetching block header...', 80);
            // Fetch block header (80 bytes)
            const headerResponse = await fetch(`https://mempool.space/api/block/${blockHash}/header`);
            
            if (headerResponse.ok) {
                this.blockHeaderData = await headerResponse.text();
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
            document.getElementById('block-size').textContent = 'Loading...';
            document.getElementById('block-tx-count').textContent = 'Loading...';
            document.getElementById('block-time').textContent = 'Loading...';
            document.getElementById('merkle-root').textContent = 'Loading...';
            document.getElementById('block-nonce').textContent = 'Loading...';
            document.getElementById('block-difficulty').textContent = 'Loading...';
            const unspentEl = document.getElementById('block-unspent-count');
            if (unspentEl) unspentEl.textContent = '—';
            return;
        }
        
        // Update subtitle with block height and hash on separate lines
        // Use data.height != null to handle genesis block (height 0) correctly
        const subtitleEl = document.getElementById('block-subtitle');
        if (data.height != null) {
            // Calculate difficulty adjustment period (every 2016 blocks)
            const adjustmentPeriod = Math.floor(data.height / 2016);
            const difficultyLink = `<br><a href="difficulty.html?adjustment=${adjustmentPeriod}&blockHeight=${data.height}" class="difficulty-epoch-link">Back to Difficulty Epoch</a>`;
            const escapedHash = this.escapeHtml(data.id || 'Hash not available');
            subtitleEl.innerHTML = `Height ${data.height.toLocaleString()}<br>${escapedHash}${difficultyLink}`;
        } else {
            subtitleEl.textContent = 'Not Found';
        }
        
        document.getElementById('block-height').textContent = data.height?.toLocaleString() || 'N/A';
        document.getElementById('block-size').textContent = data.size ? `${(data.size / 1024).toFixed(1)} KB` : 'N/A';
        document.getElementById('block-tx-count').textContent = data.tx_count?.toLocaleString() || 'N/A';
        
        const blockTime = data.timestamp ? this.formatDate(new Date(data.timestamp * 1000)) : 'N/A';
        document.getElementById('block-time').textContent = blockTime;
        document.getElementById('merkle-root').textContent = data.merkle_root?.substring(0, 16) + '...' || 'N/A';
        document.getElementById('block-nonce').textContent = data.nonce?.toLocaleString() || 'N/A';
        document.getElementById('block-difficulty').textContent = data.difficulty ? `${(data.difficulty / 1e12).toFixed(2)} T` : 'N/A';
        const unspentEl = document.getElementById('block-unspent-count');
        if (unspentEl) unspentEl.textContent = '—';
    }

    /**
     * Fetch unspent outputs for current block; updates panel and adds spheres incrementally. Returns a promise.
     */
    startUnspentOutputsFetch() {
        if (!this.blockData || !this.blockData.id) return Promise.resolve();
        const unspentEl = document.getElementById('block-unspent-count');
        if (unspentEl) unspentEl.textContent = '...';
        this.showLoadingModal('Loading UTXOs...', true);
        this.blockUnspentOutputs = [];
        this.hideUtxoSpheres();
        this.utxoSpheresVisible = true;
        this.isLoadingUtxos = true;
        this.shouldStopUtxoLoad = false;
        const blockHash = this.blockData.id;
        const txCount = this.transactionIds?.length ?? this.blockData.tx_count ?? 0;
        const onProgress = (current, total) => {
            this.updateLoadingProgress(`Loading UTXOs ${current}/${total}...`, Math.round(100 * current / total));
        };
        const onBatch = (batch) => {
            this.blockUnspentOutputs.push(...batch);
            const el = document.getElementById('block-unspent-count');
            if (el) el.textContent = this.blockUnspentOutputs.length.toLocaleString();
            this.addUtxoSpheresForBatch(batch);
        };
        return this.getUnspentOutputsForBlock(blockHash, onProgress, onBatch).then(unspent => {
            this.hideLoadingModal();
            this.isLoadingUtxos = false;
            this.shouldStopUtxoLoad = false;
            const el = document.getElementById('block-unspent-count');
            if (el) el.textContent = unspent.length.toLocaleString();
            const btn = document.getElementById('show-utxos');
            if (btn) btn.textContent = 'Hide UTXO';
        }).catch(() => {
            this.hideLoadingModal();
            this.isLoadingUtxos = false;
            this.shouldStopUtxoLoad = false;
            const el = document.getElementById('block-unspent-count');
            if (el) el.textContent = '—';
            const btn = document.getElementById('show-utxos');
            if (btn) btn.textContent = 'Show UTXO';
        });
    }

    stopUtxoLoad() {
        this.shouldStopUtxoLoad = true;
    }

    /**
     * Add spheres for a batch of UTXOs (used when loading incrementally). Uses existing blockUnspentOutputs for value scale.
     */
    addUtxoSpheresForBatch(batch) {
        if (!batch || batch.length === 0 || !this.scene) return;
        const allValues = (this.blockUnspentOutputs || []).map(u => u.value);
        const valueMax = allValues.length ? Math.max(...allValues) : 0;
        const valueMaxLog = Math.log10(valueMax + 1);
        const MIN_RADIUS = 0.08;
        const MAX_RADIUS = 0.42;
        const STACK_OFFSET = 0.08; // vertical offset per sphere when multiple UTXOs share a tx
        const JITTER = 0.008; // tiny jitter to avoid z-fighting when centered
        const voutCountByTx = new Map();
        this.utxoSpheres.forEach(m => {
            const txid = m.userData?.utxo?.txid;
            if (txid) voutCountByTx.set(txid, (voutCountByTx.get(txid) || 0) + 1);
        });
        for (const utxo of batch) {
            const cuboid = this.transactions.find(tx => tx.userData && tx.userData.txid === utxo.txid);
            if (!cuboid) continue;
            const voutIndex = voutCountByTx.get(utxo.txid) ?? 0;
            voutCountByTx.set(utxo.txid, voutIndex + 1);
            const t = valueMaxLog > 0 ? Math.log10(utxo.value + 1) / valueMaxLog : 0.5;
            const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * (0.15 + 0.85 * t);
            // Center on cuboid; stack multiple UTXOs from same tx slightly above
            const jx = (Math.random() - 0.5) * 2 * JITTER;
            const jy = (Math.random() - 0.5) * 2 * JITTER;
            const jz = (Math.random() - 0.5) * 2 * JITTER;
            const x = cuboid.position.x + jx;
            const y = cuboid.position.y + voutIndex * STACK_OFFSET + jy;
            const z = cuboid.position.z + jz;
            const geometry = new THREE.SphereGeometry(radius, 16, 16);
            const material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0xffffff,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.25
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(x, y, z);
            sphere.castShadow = true;
            sphere.renderOrder = 2;
            sphere.userData = { type: 'blockUtxo', utxo };
            this.scene.add(sphere);
            this.utxoSpheres.push(sphere);
        }
    }

    /**
     * Add UTXO spheres: one per unspent output, centered on the transaction cuboid (stacked vertically when multiple per tx).
     */
    showUtxoSpheres() {
        if (!this.blockUnspentOutputs || this.blockUnspentOutputs.length === 0) return;
        this.hideUtxoSpheres();
        const values = this.blockUnspentOutputs.map(u => u.value);
        console.log('UTXO values (sats):', values);
        this.addUtxoSpheresForBatch(this.blockUnspentOutputs);
        this.utxoSpheresVisible = true;
    }

    hideUtxoSpheres() {
        this.utxoSpheres.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.utxoSpheres = [];
        this.utxoSpheresVisible = false;
    }
    
    updateBlockVisualization() {
        if (!this.blockData) return;
        
        this.hideUtxoSpheres();
        this.blockUnspentOutputs = [];
        this.isLoadingUtxos = false;
        this.shouldStopUtxoLoad = false;
        const unspentEl = document.getElementById('block-unspent-count');
        if (unspentEl) unspentEl.textContent = '—';
        const showUtxosBtn = document.getElementById('show-utxos');
        if (showUtxosBtn) {
            showUtxosBtn.textContent = 'Show UTXO';
            showUtxosBtn.disabled = !this.transactionIds || this.transactionIds.length === 0;
        }
        
        // Clear existing transactions
        this.transactions.forEach(tx => this.scene.remove(tx));
        this.transactions = [];
        
        // Use actual transaction IDs if available, otherwise fallback to count-based visualization
        const transactionsToVisualize = this.transactionIds.length > 0 ? this.transactionIds : [];
        const txCount = transactionsToVisualize.length > 0 ? 
            transactionsToVisualize.length : // Show all transactions
            Math.min(this.blockData.tx_count || 100, 100);
        
        
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
            
            // Calculate position with proper centering (left to right order)
            // Keep inside block cube (3x3x3 centered at 0,0,0, so -1.5 to +1.5 in all dimensions)
            const x = ((transactionsPerRow - 1) / 2 - col) * spacingX;
            const z = (row - 4.5) * spacingZ; // Center around 10 rows (0-9, so -4.5 to +4.5)
            const zClamped = Math.max(-1.4, Math.min(1.4, z)); // Clamp Z to stay inside block
            const y = 0.8 - layer * spacingY; // Reduced Y to keep inside block (was 1.21)
            
            // Create cuboid geometry (reduced to half scale)
            const CUBOID_WIDTH = 0.01;   // Width (was 0.07)
            const CUBOID_HEIGHT = 0.03;   // Height - shorter default before loading
            const CUBOID_LENGTH = 0.21;   // Length (was 0.56)
            const geometry = new THREE.BoxGeometry(CUBOID_LENGTH, CUBOID_HEIGHT, CUBOID_WIDTH);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8
            });
            
            const cuboid = new THREE.Mesh(geometry, material);
            cuboid.position.set(x, y, zClamped);
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

    showLoadingModal(message, nonModal = false) {
        // Remove existing loading modal if any
        const existingModal = document.querySelector('.loading-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create loading indicator
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
        
        if (nonModal) {
            // Non-modal overlay - positioned in bottom-right corner, above controls and panel, always visible
            modal.style.cssText = `
                position: fixed;
                bottom: 120px;
                right: 20px;
                width: 320px;
                background: rgba(0, 0, 0, 0.85);
                border: 1px solid #333;
                border-radius: 8px;
                padding: 20px;
                z-index: 35000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(10px);
            `;
            
            const content = modal.querySelector('.loading-content');
            content.style.cssText = `
                text-align: left;
                color: white;
            `;
            
            const spinner = modal.querySelector('.loading-spinner');
            spinner.style.cssText = `
                width: 24px;
                height: 24px;
                border: 2px solid #333;
                border-top: 2px solid #ffffff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 12px;
                display: inline-block;
                vertical-align: middle;
                margin-right: 10px;
            `;
            
            const text = modal.querySelector('.loading-text');
            text.style.cssText = `
                font-size: 14px;
                margin-bottom: 12px;
                color: #fff;
                display: inline-block;
                vertical-align: middle;
            `;
            
            const progress = modal.querySelector('.loading-progress');
            progress.style.cssText = `
                margin-top: 12px;
            `;
            
            const progressBar = modal.querySelector('.progress-bar');
            progressBar.style.cssText = `
                width: 100%;
                height: 6px;
                background: #333;
                border-radius: 3px;
                overflow: hidden;
                margin-bottom: 6px;
            `;
            
            const progressFill = modal.querySelector('.progress-fill');
            progressFill.style.cssText = `
                height: 100%;
                background: #ffffff;
                width: 0%;
                transition: width 0.3s ease;
            `;
            
            const progressText = modal.querySelector('.progress-text');
            progressText.style.cssText = `
                font-size: 11px;
                color: #aaa;
                text-align: center;
            `;
        } else {
            // Original modal style (full screen overlay)
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
        }
        
        // Add CSS animation
        const style = document.createElement('style');
        if (!document.getElementById('loading-spinner-animation')) {
            style.id = 'loading-spinner-animation';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        }
        
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
                    // Clear transaction highlight and txid from URL when closing panel
                    this.clearCuboid3DHighlight();
                    const url = new URL(window.location);
                    url.searchParams.delete('txid');
                    window.history.pushState({}, '', url);
                }
            });
        }
    }
    
    // Navigation methods
    rotateLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.theta -= 0.2;
        this.controls.update();
    }
    
    rotateRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.theta += 0.2;
        this.controls.update();
    }
    
    rotateUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    rotateDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.controls.update();
    }
    
    panLeft() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.panX -= 0.5;
        this.controls.update();
    }
    
    panRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.panX += 0.5;
        this.controls.update();
    }
    
    panUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.panY += 0.5;
        this.controls.update();
    }
    
    panDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        this.controls.panY -= 0.5;
        this.controls.update();
    }
    
    zoomIn() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        
        if (this.isPerspective) {
        this.controls.distance -= 2;
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.controls.update();
        } else {
            // Orthographic camera: decrease zoom value to zoom in
            this.orthographicZoom -= 2;
            this.orthographicZoom = Math.max(1, Math.min(50, this.orthographicZoom));
            
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
            const icon = document.getElementById('toggle-rotation-icon');
            if (icon) icon.src = 'imgs/icons/play.svg';
            button.title = 'Start rotation';
            button.setAttribute('aria-label', button.title);
        }
        
        if (this.isPerspective) {
        this.controls.distance += 2;
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.controls.update();
        } else {
            // Orthographic camera: increase zoom value to zoom out
            this.orthographicZoom += 2;
            this.orthographicZoom = Math.max(1, Math.min(50, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
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
        const isDump = this.rawViewMode === 'dump';
        if (isDump) {
            textElement.style.fontSize = '11px';
        } else if (bytesPerLine >= 512) {
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
        
        // Handle dump mode separately
        if (isDump) {
            if (this.decodeMode && this.decodedSections) {
                this.renderDecodedDump(highlightByteStart, highlightByteEnd);
            } else {
                this.renderDumpWithHighlight(highlightByteStart, highlightByteEnd);
            }
            return;
        }
        
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
            if (this.rawViewMode === 'dump') {
                await this.renderDecodedDump();
            } else {
                await this.renderDecodedData(bytesPerLine);
            }
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
        } else if (this.rawViewMode === 'dump') {
            // Hex dump view - classic format with offset, hex, and ASCII
            // Use HTML rendering to match decoded dump structure
            textElement.style.fontSize = '11px';
            this.renderDumpPlain();
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
    
    bytesToDump(bytes) {
        // Classic hex dump format: offset | hex bytes | ASCII
        let result = '';
        const bytesPerLine = 16;
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (8 hex chars)
            const offset = i.toString(16).padStart(8, '0');
            
            // Hex bytes (two groups of 8 bytes)
            let hexPart = '';
            let asciiPart = '';
            
            for (let j = 0; j < bytesPerLine; j++) {
                if (i + j < bytes.length) {
                    const byte = bytes[i + j];
                    hexPart += byte.toString(16).padStart(2, '0') + ' ';
                    // ASCII: printable range 32-126, else '.'
                    asciiPart += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                } else {
                    hexPart += '   ';
                    asciiPart += ' ';
                }
                // Add extra space between the two groups of 8
                if (j === 7) hexPart += ' ';
            }
            
            result += `${offset}  ${hexPart} |${asciiPart}|\n`;
        }
        
        return result.trimEnd();
    }
    
    updateViewToggleButtons() {
        const hexBtn = document.getElementById('view-hex');
        const binaryBtn = document.getElementById('view-binary');
        const asciiBtn = document.getElementById('view-ascii');
        const dumpBtn = document.getElementById('view-dump');
        const bytesSelect = document.getElementById('bytes-per-line');
        
        hexBtn.classList.remove('active');
        binaryBtn.classList.remove('active');
        asciiBtn.classList.remove('active');
        dumpBtn.classList.remove('active');
        
        if (this.rawViewMode === 'hex') {
            hexBtn.classList.add('active');
            bytesSelect.disabled = false;
        } else if (this.rawViewMode === 'binary') {
            binaryBtn.classList.add('active');
            bytesSelect.disabled = false;
        } else if (this.rawViewMode === 'dump') {
            dumpBtn.classList.add('active');
            bytesSelect.disabled = true;
        } else {
            asciiBtn.classList.add('active');
            bytesSelect.disabled = false;
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
        
        // Clear transaction highlight and remove txid from URL when closing pane
        this.clearCuboid3DHighlight();
        // Update URL - remove rawdata and txid parameters
        const url = new URL(window.location);
        url.searchParams.delete('rawdata');
        url.searchParams.delete('txid');
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
    
    async renderDecodedDump(highlightByteStart = null, highlightByteEnd = null) {
        const textElement = document.getElementById('raw-data-text');
        const bytes = this.rawBlockData.bytes;
        const bytesPerLine = 16; // Standard dump format
        
        // Set consistent font size for dump view
        textElement.style.fontSize = '11px';
        
        // Show loading for large blocks
        if (bytes.length > 50000) {
            textElement.innerHTML = 'Decoding dump view...';
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Create a map of byte position to section for quick lookup
        const byteToSection = new Map();
        for (const section of this.decodedSections) {
            for (let i = section.start; i < section.end; i++) {
                byteToSection.set(i, section);
            }
        }
        
        // Helper to check if byte is in highlight range
        const isHighlighted = (byteIndex) => {
            return highlightByteStart !== null && 
                   byteIndex >= highlightByteStart && 
                   byteIndex < highlightByteEnd;
        };
        
        let html = '';
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (using span for consistency)
            const offset = i.toString(16).padStart(8, '0');
            html += `<span class="dump-offset">${offset}</span>  `;
            
            // Hex bytes (always wrapped in span for consistent spacing)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const hexByte = byte.toString(16).padStart(2, '0');
                    const section = byteToSection.get(byteIndex);
                    const highlighted = isHighlighted(byteIndex);
                    
                    let classes = 'dump-byte';
                    let dataAttrs = '';
                    
                    if (section) {
                        classes += ` decode-section ${section.cssClass}`;
                        dataAttrs = ` data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"`;
                    }
                    if (highlighted) {
                        classes += section ? ' tx-highlight-decode' : ' tx-highlight';
                    }
                    
                    html += `<span class="${classes}"${dataAttrs}>${hexByte}</span> `;
                } else {
                    html += '   ';
                }
                // Extra space between the two groups of 8
                if (j === 7) html += ' ';
            }
            
            html += '|';
            
            // ASCII representation (always wrapped in span for consistency)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                    const escapedChar = this.escapeHtml(char);
                    const section = byteToSection.get(byteIndex);
                    const highlighted = isHighlighted(byteIndex);
                    
                    let classes = 'dump-ascii';
                    let dataAttrs = '';
                    
                    if (section) {
                        classes += ` decode-section ${section.cssClass}`;
                        dataAttrs = ` data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"`;
                    }
                    if (highlighted) {
                        classes += section ? ' tx-highlight-decode' : ' tx-highlight';
                    }
                    
                    html += `<span class="${classes}"${dataAttrs}>${escapedChar}</span>`;
                } else {
                    html += ' ';
                }
            }
            
            html += '|\n';
        }
        
        textElement.innerHTML = html.trimEnd();
        
        if (highlightByteStart !== null) {
            textElement.classList.add('has-highlight');
            this.addHighlightClickHandlers();
        }
        
        this.setupDecodeTooltips();
    }
    
    renderDumpPlain() {
        const textElement = document.getElementById('raw-data-text');
        const bytes = this.rawBlockData.bytes;
        const bytesPerLine = 16;
        
        let html = '';
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (using span for consistency with decoded view)
            const offset = i.toString(16).padStart(8, '0');
            html += `<span class="dump-offset">${offset}</span>  `;
            
            // Hex bytes (each wrapped in span for consistent spacing)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const hexByte = byte.toString(16).padStart(2, '0');
                    html += `<span class="dump-byte">${hexByte}</span> `;
                } else {
                    html += '   ';
                }
                if (j === 7) html += ' ';
            }
            
            html += '|';
            
            // ASCII (each wrapped in span for consistency)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                    html += `<span class="dump-ascii">${this.escapeHtml(char)}</span>`;
                } else {
                    html += ' ';
                }
            }
            
            html += '|\n';
        }
        
        textElement.innerHTML = html.trimEnd();
    }
    
    renderDumpWithHighlight(highlightByteStart, highlightByteEnd) {
        const textElement = document.getElementById('raw-data-text');
        const bytes = this.rawBlockData.bytes;
        const bytesPerLine = 16;
        
        // Set consistent font size for dump view
        textElement.style.fontSize = '11px';
        
        let html = '';
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (using span for consistency)
            const offset = i.toString(16).padStart(8, '0');
            html += `<span class="dump-offset">${offset}</span>  `;
            
            // Hex bytes
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const hexByte = byte.toString(16).padStart(2, '0');
                    const highlighted = byteIndex >= highlightByteStart && byteIndex < highlightByteEnd;
                    
                    if (highlighted) {
                        html += `<span class="dump-byte tx-highlight">${hexByte}</span>`;
                    } else {
                        html += `<span class="dump-byte">${hexByte}</span>`;
                    }
                    html += ' ';
                } else {
                    html += '   ';
                }
                if (j === 7) html += ' ';
            }
            
            html += '|';
            
            // ASCII
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                    const escapedChar = this.escapeHtml(char);
                    const highlighted = byteIndex >= highlightByteStart && byteIndex < highlightByteEnd;
                    
                    if (highlighted) {
                        html += `<span class="dump-ascii tx-highlight">${escapedChar}</span>`;
                    } else {
                        html += `<span class="dump-ascii">${escapedChar}</span>`;
                    }
                } else {
                    html += ' ';
                }
            }
            
            html += '|\n';
        }
        
        textElement.innerHTML = html.trimEnd();
        textElement.classList.add('has-highlight');
        this.addHighlightClickHandlers();
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
                    const escapedLabel = this.escapeHtml(label);
                    const escapedValue = this.escapeHtml(value || '');
                    tooltip.innerHTML = '<div style="font-weight:bold;color:' + this.escapeAttr(color) + ';margin-bottom:4px;">' + escapedLabel + '</div><div style="color:rgba(255,255,255,0.8);">' + escapedValue + '</div>';
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
    
    // Convert hex string to Uint8Array
    hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }
    
    // Convert Uint8Array to hex string
    bytesToHex(bytes) {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    // Double SHA256 hash (Bitcoin's hash function)
    async doubleSha256(data) {
        // First SHA256
        const hash1 = await crypto.subtle.digest('SHA-256', data);
        // Second SHA256
        const hash2 = await crypto.subtle.digest('SHA-256', hash1);
        return new Uint8Array(hash2);
    }
    
    // Calculate merkle root from transaction IDs
    async calculateMerkleTree(txids) {
        if (txids.length === 0) return [];
        
        // Convert txids from hex strings to bytes
        // Bitcoin txids are displayed in big-endian (normal hex), but stored in little-endian
        // For merkle tree calculation, we need to reverse the hex string to get the actual bytes
        const totalSteps = txids.length + Math.ceil(Math.log2(txids.length)); // Approximate total steps
        let currentStep = 0;
        
        const leaves = await Promise.all(txids.map(async (txid, index) => {
            // Reverse hex pairs to convert from display format to byte format
            const reversedTxid = txid.match(/.{2}/g).reverse().join('');
            const bytes = this.hexToBytes(reversedTxid);
            
            // Update progress
            currentStep++;
            const progress = 5 + Math.floor((currentStep / txids.length) * 35); // 5-40% for leaf hashing
            this.updateLoadingProgress(`Hashing transaction ${currentStep}/${txids.length}...`, progress);
            
            return {
                hash: bytes,
                hashHex: this.bytesToHex(bytes),
                txid: txid,
                level: 0,
                index: index
            };
        }));
        
        const tree = [leaves]; // Start with leaves
        let currentLevel = leaves;
        let levelNum = 0;
        
        // Build tree level by level
        while (currentLevel.length > 1) {
            levelNum++;
            const nextLevel = [];
            const levelProgressStart = 40 + (levelNum - 1) * 5; // Start progress for this level
            const levelProgressRange = 5; // Progress range for this level
            
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    // Pair exists - hash them together
                    const left = currentLevel[i];
                    const right = currentLevel[i + 1];
                    const combined = new Uint8Array([...left.hash, ...right.hash]);
                    const hash = await this.doubleSha256(combined);
                    
                    nextLevel.push({
                        hash: hash,
                        hashHex: this.bytesToHex(hash),
                        left: left,
                        right: right,
                        level: currentLevel[0].level + 1,
                        index: Math.floor(i / 2)
                    });
                } else {
                    // Odd number - duplicate the last one (Bitcoin's behavior)
                    const last = currentLevel[i];
                    const combined = new Uint8Array([...last.hash, ...last.hash]);
                    const hash = await this.doubleSha256(combined);
                    
                    nextLevel.push({
                        hash: hash,
                        hashHex: this.bytesToHex(hash),
                        left: last,
                        right: last,
                        level: currentLevel[0].level + 1,
                        index: Math.floor(i / 2)
                    });
                }
                
                // Update progress for this level
                const pairProgress = (i / 2 + 1) / Math.ceil(currentLevel.length / 2);
                const progress = levelProgressStart + Math.floor(pairProgress * levelProgressRange);
                this.updateLoadingProgress(`Building tree level ${levelNum}...`, Math.min(progress, 45));
            }
            
            tree.push(nextLevel);
            currentLevel = nextLevel;
        }
        
        return tree;
    }
    
    // Show merkle tree visualization
    async showMerkleTree() {
        if (this.transactions.length === 0) {
            return;
        }
        
        // Get transaction IDs
        const txids = this.transactions
            .map(tx => tx.userData.txid)
            .filter(txid => txid && !txid.startsWith('dummy_tx_'));
        
        if (txids.length === 0) {
            return;
        }
        
        try {
            // Show loading indicator (non-modal so animation is visible)
            this.showLoadingModal('Calculating Merkle Tree...', true);
            this.updateLoadingProgress('Preparing transaction hashes...', 5);
            
            // Calculate merkle tree with progress updates
            const tree = await this.calculateMerkleTree(txids);
            
            this.updateLoadingProgress('Calculating node positions...', 50);
            
            // Store node positions
            this.merkleTreeNodes = [];
            const nodePositions = new Map(); // Map from node to position
            
            // Calculate positions for leaf nodes (transactions)
            // Only use transactions that have valid txids
            // IMPORTANT: Define validTransactions first before using it
            let validTransactions = [];
            validTransactions = this.transactions.filter(tx => {
                const txid = tx.userData.txid;
                return txid && !txid.startsWith('dummy_tx_') && txids.includes(txid);
            });
            
            // First, create vertical lines from each transaction
            // Leaf nodes start at transaction center position (aligned with cuboid center)
            // Tree grows DOWNWARD from leaves to root (root at bottom)
            const validTxCount = validTransactions.length;
            const levelSpacing = validTxCount > 500 ? 0.8 : 1.2; // Reduced spacing between levels (shorter tree)
            
            const txCount = validTransactions.length;
            const positionUpdateInterval = txCount > 100 ? Math.max(50, Math.floor(txCount / 20)) : 10;
            
            for (let i = 0; i < validTransactions.length; i++) {
                const tx = validTransactions[i];
                const txPos = tx.position.clone();
                // Leaf node starts at transaction center position (cuboid position is at center)
                const leafY = txPos.y;
                
                const leafNode = {
                    position: new THREE.Vector3(txPos.x, leafY, txPos.z),
                    level: 0,
                    index: i,
                    node: tree[0][i]
                };
                
                nodePositions.set(tree[0][i], leafNode.position);
                this.merkleTreeNodes.push(leafNode);
                
                // Update progress during position calculation
                if (i % positionUpdateInterval === 0 || i === validTransactions.length - 1) {
                    const progress = 50 + Math.floor((i / validTransactions.length) * 15); // 50-65%
                    this.updateLoadingProgress(`Calculating positions ${i + 1}/${validTransactions.length}...`, progress);
                    // Yield to allow UI updates
                    if (i % (positionUpdateInterval * 2) === 0) {
                        await this.sleep(1);
                    }
                }
            }
            
            // Calculate positions for intermediate nodes
            this.updateLoadingProgress('Calculating tree node positions...', 65);
            for (let level = 1; level < tree.length; level++) {
                const levelNodes = tree[level];
                const parentLevel = tree[level - 1];
                
                for (let i = 0; i < levelNodes.length; i++) {
                    const node = levelNodes[i];
                    const leftPos = nodePositions.get(node.left);
                    const rightPos = nodePositions.get(node.right);
                    
                    // Position parent node between its children
                    // Tree grows DOWNWARD: parent is below children (negative Y direction)
                    // Progressive spacing: level 1 = 0.3, level 2 = 0.4, level 3 = 0.5, etc.
                    const levelSpacingProgressive = 0.16 + (level - 1) * 0.1;
                    const parentX = (leftPos.x + rightPos.x) / 2;
                    const parentY = leftPos.y - levelSpacingProgressive; // Progressive spacing per level
                    const parentZ = (leftPos.z + rightPos.z) / 2;
                    
                    const parentPos = new THREE.Vector3(parentX, parentY, parentZ);
                    nodePositions.set(node, parentPos);
                    
                    this.merkleTreeNodes.push({
                        position: parentPos,
                        level: level,
                        index: i,
                        node: node
                    });
                }
            }
            
            // Clear any existing merkle tree lines first (without updating button or flag)
            this.merkleTreeLines.forEach(line => {
                this.scene.remove(line);
                line.geometry.dispose();
                line.material.dispose();
            });
            this.merkleTreeLines = [];
            this.merkleTreeNodes = [];
            this.merkleTreeLineMap.clear(); // Clear the map
            
            // Now create and animate the lines
            this.merkleTreeVisible = true;
            const button = document.getElementById('show-merkle-tree');
            if (button) {
                button.textContent = 'Hide Merkle Tree';
            }
            
            // Update URL with merkle parameter
            const url = new URL(window.location);
            url.searchParams.set('merkle', 'true');
            window.history.replaceState({}, '', url);
            
            this.updateLoadingProgress('Rendering visualization...', 70);
            
            // Animate tree growth progressively
            await this.animateMerkleTreeGrowth(tree, nodePositions, levelSpacing, txids);
            
            // Hide loading modal when complete
            this.hideLoadingModal();
        } catch (error) {
            console.error('Error creating merkle tree visualization:', error);
            this.hideLoadingModal();
            alert('Error creating merkle tree visualization. Please try again.');
        }
    }
    
    // Animate merkle tree growth from leaves to root
    async animateMerkleTreeGrowth(tree, nodePositions, levelSpacing, txids) {
        // Get valid transactions (matching the ones used for tree calculation)
        const validTransactions = this.transactions.filter(tx => {
            const txid = tx.userData.txid;
            return txid && !txid.startsWith('dummy_tx_') && txids.includes(txid);
        });
        
        // Total animation steps (needed to compute constant-time pacing)
        const txCount = validTransactions.length;
        const totalVerticalLines = validTransactions.length;
        const totalTreeLines = tree.reduce((sum, level, idx) => {
            if (idx === 0) return sum; // Skip leaf level
            return sum + level.length * 2; // Each node has 2 lines (left and right)
        }, 0);
        const totalSteps = totalVerticalLines + totalTreeLines;
        
        // Target total animation time (ms): much shorter for blocks with lots of transactions
        const TARGET_TOTAL_MS = Math.max(80, Math.min(800, 900 - txCount * 0.25)); // ~0.9s at 0 tx, floor 80ms for 3300+ tx
        const MIN_PER_LINE_MS = 0;      // Allow sub-ms for huge trees (instant path then skips sleep)
        const MAX_PER_LINE_MS = 40;     // Cap so small trees don't drag
        const perLineMs = Math.max(MIN_PER_LINE_MS, Math.min(MAX_PER_LINE_MS, TARGET_TOTAL_MS / totalSteps));
        const lineAnimationDuration = Math.max(1, Math.round(perLineMs * 0.7)); // ≥1ms when animating
        const animationDelay = Math.round(perLineMs * 0.3);        // 30% delay between lines (single line)
        const instantStepDelay = Math.round(perLineMs);            // when drawing instantly; 0 for huge trees
        const treeLevelDelay = Math.round(perLineMs * 1.3);        // after 2 lines in parallel: 2*perLine - lineAnimationDuration
        const isLargeSet = txCount > 100;
        const useInstantDraw = txCount > 200;                      // Skip line animation earlier for faster large-block build
        const progressUpdateInterval = isLargeSet ? Math.max(10, Math.floor(txCount / 50)) : 1; // Update every N lines for large sets
        let currentStep = 0;
        
        // Initial progress update
        this.updateLoadingProgress(`Creating ${totalSteps} lines...`, 71);
        
        // First, animate vertical lines from transactions to leaf nodes
        for (let i = 0; i < validTransactions.length; i++) {
            const tx = validTransactions[i];
            const txPos = tx.position.clone();
            const leafNode = this.merkleTreeNodes.find(n => n.level === 0 && n.index === i);
            
            if (leafNode) {
                // Start line at transaction center position (aligned with cuboid center)
                const startPos = new THREE.Vector3(txPos.x, txPos.y, txPos.z);
                const endPos = leafNode.position.clone();
                
                // Create line from transaction to leaf node (start with just start position)
                const geometry = new THREE.BufferGeometry().setFromPoints([startPos, startPos]);
                const material = new THREE.LineBasicMaterial({ 
                    color: 0xffffff, 
                    transparent: true,
                    opacity: 0.25,
                    linecap: 'round',
                    linejoin: 'round'
                });
                const line = new THREE.Line(geometry, material);
                line.userData.merkleTree = true;
                line.userData.isVerticalLine = true; // Mark as vertical line from transaction
                line.userData.transactionIndex = i; // Store transaction index for reconnection
                
                // Store txid - verify it exists
                const txid = tx.userData.txid;
                if (!txid) {
                    console.warn(`[MerkleTree] Transaction ${i} has no txid!`, tx.userData);
                }
                line.userData.txid = txid; // Store txid for finding transaction after loading
                line.renderOrder = 10; // Render after other objects
                
                // Add to scene first so it can be rendered during animation
                this.scene.add(line);
                this.merkleTreeLines.push(line);
                
                // Store line in map for direct lookup by txid
                if (txid) {
                    this.merkleTreeLineMap.set(txid, line);
                }
                
                // Animate line growth (or skip animation for large sets for speed)
                if (useInstantDraw) {
                    // Large blocks: draw line instantly (no animation)
                    const positions = line.geometry.attributes.position;
                    if (positions) {
                        positions.setXYZ(0, startPos.x, startPos.y, startPos.z);
                        positions.setXYZ(1, endPos.x, endPos.y, endPos.z);
                        positions.needsUpdate = true;
                    } else {
                        line.geometry.setFromPoints([startPos, endPos]);
                        line.geometry.attributes.position.needsUpdate = true;
                    }
                    line.geometry.computeBoundingSphere();
                    if (instantStepDelay > 0) {
                        await this.sleep(instantStepDelay);
                    } else if (i % 150 === 0) {
                        await this.sleep(0); // Yield to UI so large blocks don't freeze
                    }
                } else {
                    await this.animateLineGrowth(line, startPos, endPos, lineAnimationDuration);
                    await this.sleep(animationDelay);
                }
                
                // Update progress (only every N lines for large sets to avoid UI lag)
                currentStep++;
                if (currentStep % progressUpdateInterval === 0 || currentStep === totalSteps) {
                    const progress = 70 + Math.floor((currentStep / totalSteps) * 25); // 70-95% for animation
                    this.updateLoadingProgress(`Drawing lines ${currentStep}/${totalSteps}...`, progress);
                }
            }
        }
        
        // Then animate tree levels from bottom to top
        for (let level = 1; level < tree.length; level++) {
            const levelNodes = tree[level];
            
            for (let i = 0; i < levelNodes.length; i++) {
                const node = levelNodes[i];
                const leftPos = nodePositions.get(node.left);
                const rightPos = nodePositions.get(node.right);
                const parentPos = nodePositions.get(node);
                
                // Create lines from children to parent (start with just start positions)
                const leftLine = this.createLine(leftPos, leftPos, 0xffffff);
                const rightLine = this.createLine(rightPos, rightPos, 0xffffff);
                
                // Add to scene first so they can be rendered during animation
                this.scene.add(leftLine);
                this.scene.add(rightLine);
                this.merkleTreeLines.push(leftLine, rightLine);
                
                // Animate both lines (or skip animation for large sets for speed)
                if (useInstantDraw) {
                    // Large blocks: draw both lines instantly
                    const leftPositions = leftLine.geometry.attributes.position;
                    const rightPositions = rightLine.geometry.attributes.position;
                    if (leftPositions && rightPositions) {
                        leftPositions.setXYZ(0, leftPos.x, leftPos.y, leftPos.z);
                        leftPositions.setXYZ(1, parentPos.x, parentPos.y, parentPos.z);
                        rightPositions.setXYZ(0, rightPos.x, rightPos.y, rightPos.z);
                        rightPositions.setXYZ(1, parentPos.x, parentPos.y, parentPos.z);
                        leftPositions.needsUpdate = true;
                        rightPositions.needsUpdate = true;
                    } else {
                        leftLine.geometry.setFromPoints([leftPos, parentPos]);
                        rightLine.geometry.setFromPoints([rightPos, parentPos]);
                        leftLine.geometry.attributes.position.needsUpdate = true;
                        rightLine.geometry.attributes.position.needsUpdate = true;
                    }
                    leftLine.geometry.computeBoundingSphere();
                    rightLine.geometry.computeBoundingSphere();
                    if (instantStepDelay > 0) {
                        await this.sleep(instantStepDelay * 2);
                    } else if (i % 100 === 0) {
                        await this.sleep(0); // Yield to UI so large blocks don't freeze
                    }
                } else {
                    await Promise.all([
                        this.animateLineGrowth(leftLine, leftPos, parentPos, lineAnimationDuration),
                        this.animateLineGrowth(rightLine, rightPos, parentPos, lineAnimationDuration)
                    ]);
                    await this.sleep(treeLevelDelay); // So 2-line step takes 2*perLineMs total
                }
                
                // Update progress (each node adds 2 lines)
                currentStep += 2;
                if (currentStep % progressUpdateInterval === 0 || currentStep === totalSteps) {
                    const progress = 70 + Math.floor((currentStep / totalSteps) * 25); // 70-95% for animation
                    this.updateLoadingProgress(`Drawing lines ${currentStep}/${totalSteps}...`, progress);
                }
            }
        }
        
        // Final progress update - ensure we show 100%
        if (currentStep < totalSteps) {
            currentStep = totalSteps; // Ensure we're at 100%
        }
        this.updateLoadingProgress('Complete!', 100);
        await this.sleep(60); // Brief pause to show 100%
        
        // Force a render to ensure lines are visible
        this.renderer.render(this.scene, this.camera);
    }
    
    // Create a line between two points
    createLine(start, end, color) {
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const material = new THREE.LineBasicMaterial({ 
            color: 0xffffff, 
            transparent: true,
            opacity: 0.25,
            linecap: 'round',
            linejoin: 'round'
        });
        const line = new THREE.Line(geometry, material);
        line.userData.merkleTree = true;
        line.renderOrder = 10; // Render after other objects
        return line;
    }
    
    // Animate line growth from start to end
    async animateLineGrowth(line, start, end, duration) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const distance = start.distanceTo(end);
            
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Easing function for smooth animation
                const eased = 1 - Math.pow(1 - progress, 3);
                
                const currentPos = new THREE.Vector3().lerpVectors(start, end, eased);
                line.geometry.setFromPoints([start, currentPos]);
                line.geometry.attributes.position.needsUpdate = true;
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Ensure final position is exact
                    line.geometry.setFromPoints([start, end]);
                    line.geometry.attributes.position.needsUpdate = true;
                    resolve();
                }
            };
            
            animate();
        });
    }
    
    // Animate merkle tree line's first point to follow transaction position
    animateMerkleTreeLineOrigin(cuboid, targetY, duration) {
        if (!this.merkleTreeVisible) return;
        if (!cuboid.userData.txid) return;
        
        // Find the vertical line for this transaction
        const txid = cuboid.userData.txid;
        
        // Try to use cached reference first
        let verticalLine = cuboid.userData.merkleLine;
        
        if (!verticalLine) {
            // Use direct map lookup - much faster and more reliable!
            verticalLine = this.merkleTreeLineMap.get(txid);
            
            if (verticalLine) {
                // Cache the reference for faster lookup
                cuboid.userData.merkleLine = verticalLine;
            } else {
                
                // Fallback: try to find in array (shouldn't be needed if map is working)
                const txIndex = cuboid.userData.index;
                if (txIndex !== undefined) {
                    verticalLine = this.merkleTreeLines.find(line => 
                        line.userData && 
                        line.userData.merkleTree && 
                        line.userData.transactionIndex === txIndex
                    );
                    if (verticalLine) {
                        cuboid.userData.merkleLine = verticalLine;
                        // Add to map for future lookups
                        if (txid) {
                            this.merkleTreeLineMap.set(txid, verticalLine);
                        }
                    }
                }
            }
            
            if (!verticalLine) {
                const linesWithTxid = this.merkleTreeLines.filter(l => 
                    l.userData && l.userData.txid
                );
                const linesWithMerkleTree = this.merkleTreeLines.filter(l => 
                    l.userData && l.userData.merkleTree
                );
                const verticalLines = this.merkleTreeLines.filter(l => 
                    l.userData && l.userData.merkleTree && l.userData.isVerticalLine
                );
                if (linesWithTxid.length > 0) {
                    const matchingLine = this.merkleTreeLines.find(l => 
                        l.userData && l.userData.txid === txid
                    );
                } else {
                    if (this.merkleTreeLines.length > 0) {
                        const anyVertical = this.merkleTreeLines.find(l => l.userData?.isVerticalLine);
                    }
                }
            }
        }
        
        if (!verticalLine) {
            // Line might not exist if transaction wasn't included in merkle tree
            // (e.g., coinbase transaction or filtered transactions)
            return;
        }
        
        const positions = verticalLine.geometry.attributes.position;
        if (!positions || positions.count < 2) return;
        
        // Get end position (leaf node - keep unchanged)
        const endX = positions.getX(1);
        const endY = positions.getY(1);
        const endZ = positions.getZ(1);
        
        const startX = positions.getX(0);
        const startY = positions.getY(0);
        const startZ = positions.getZ(0);
        
        const startTime = Date.now();
        let frameCount = 0;
        
        // Store animation state on the line for tracking
        verticalLine.userData.animating = true;
        verticalLine.userData.cuboid = cuboid;
        verticalLine.userData.endPos = new THREE.Vector3(endX, endY, endZ);
        
        const animate = () => {
            frameCount++;
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Track the transaction's current position in real-time (it's animating)
            const currentTxX = cuboid.position.x;
            const currentTxY = cuboid.position.y;
            const currentTxZ = cuboid.position.z;
            
            // Update first point to match transaction's current position exactly
            // This makes the line follow the transaction as it moves
            positions.setXYZ(0, currentTxX, currentTxY, currentTxZ);
            positions.setXYZ(1, endX, endY, endZ);
            positions.needsUpdate = true;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Final update to ensure we're exactly at the transaction position
                positions.setXYZ(0, currentTxX, currentTxY, currentTxZ);
                positions.setXYZ(1, endX, endY, endZ);
                positions.needsUpdate = true;
                verticalLine.userData.animating = false;
            }
        };
        animate();
    }
    
    // Update merkle tree line origins to reconnect to transaction positions after loading
    updateMerkleTreeLineOrigins() {
        if (!this.merkleTreeVisible || this.merkleTreeLines.length === 0) return;
        
        // Find all vertical lines (from transactions to leaf nodes)
        // First, let's check what we have
        const linesWithUserData = this.merkleTreeLines.filter(l => l.userData);
        const linesWithMerkleTree = linesWithUserData.filter(l => l.userData.merkleTree);
        const verticalLines = linesWithMerkleTree.filter(l => l.userData.isVerticalLine);
        
        let updatedCount = 0;
        
        // Update each vertical line's start position to match current transaction position
        verticalLines.forEach(line => {
            const txid = line.userData.txid;
            if (txid) {
                // Find the transaction cuboid by txid
                const tx = this.transactions.find(t => 
                    t.userData.txid === txid && 
                    !t.userData.txid.startsWith('dummy_tx_')
                );
                
                if (tx) {
                    const txPos = tx.position.clone();
                    
                    // Get the end position (leaf node) - keep it unchanged
                    const positions = line.geometry.attributes.position;
                    if (positions && positions.count >= 2) {
                        const endX = positions.getX(1);
                        const endY = positions.getY(1);
                        const endZ = positions.getZ(1);
                        
                        // Update start position to match current transaction position
                        positions.setXYZ(0, txPos.x, txPos.y, txPos.z);
                        positions.setXYZ(1, endX, endY, endZ);
                        positions.needsUpdate = true;
                        
                        updatedCount++;
                    }
                } else {
                    console.warn(`Transaction not found for txid: ${txid.substring(0, 16)}...`);
                }
            }
        });
        
        // Force render to update the scene
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    // Hide merkle tree visualization
    hideMerkleTree(updateButton = true, skipFlagUpdate = false) {
        // Remove all merkle tree lines
        this.merkleTreeLines.forEach(line => {
            this.scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        });
        this.merkleTreeLines = [];
        this.merkleTreeNodes = [];
        this.merkleTreeLineMap.clear(); // Clear the map
        
        // Only update flag if not skipping (for refresh operations)
        if (!skipFlagUpdate) {
            this.merkleTreeVisible = false;
        }
        
        // Force render to update the scene
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
        
        if (updateButton) {
            const button = document.getElementById('show-merkle-tree');
            if (button) {
                button.textContent = 'Merkle Tree';
            }
            
            // Update URL - remove merkle parameter
            const url = new URL(window.location);
            url.searchParams.delete('merkle');
            url.searchParams.delete('merkleTree');
            window.history.replaceState({}, '', url);
        }
    }
    
    // Sleep utility for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinBlockExplorer();
}); 