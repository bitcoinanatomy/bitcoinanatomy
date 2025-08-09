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
        
        // Get block height from URL parameter, will fetch chain tip if none provided
        const urlParams = new URLSearchParams(window.location.search);
        this.blockHeight = urlParams.get('height');
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupControls();
        this.setupButtonControls();
        this.setupHoverTooltip();
        this.createScene();
        this.animate();
        this.fetchData();
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
    }
    
    setupButtonControls() {
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.controls.target.set(0, 2, 0); // Reset to the raised center position
            this.controls.distance = 20;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.update();
        });
        
        document.getElementById('toggle-transactions').addEventListener('click', () => {
            this.showTransactions = !this.showTransactions;
            const button = document.getElementById('toggle-transactions');
            button.textContent = this.showTransactions ? 'Hide Transactions' : 'Show Transactions';
            
            this.transactions.forEach(tx => {
                tx.visible = this.showTransactions;
            });
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
            const intersects = raycaster.intersectObjects(this.scene.children, true);

            if (intersects.length > 0) {
                // Look for the first interactive object (transaction or block)
                let foundInteraction = false;
                
                // Check for transactions first (higher priority)
                for (let i = 0; i < intersects.length && !foundInteraction; i++) {
                    const intersectedObject = intersects[i].object;
                    
                    if (this.transactions.includes(intersectedObject)) {
                        const txData = intersectedObject.userData;
                        
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
                                TXID: ${txid ? txid.substring(0, 16) + '...' : 'Loading...'}
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
                
                // If no transaction found, check for blocks
                if (!foundInteraction) {
                    for (let i = 0; i < intersects.length && !foundInteraction; i++) {
                        const intersectedObject = intersects[i].object;
                        
                        // Check if it's a block
                        if (intersectedObject.geometry.type === 'BoxGeometry' && 
                            intersectedObject.geometry.parameters.width === 3) {
                            
                            // Calculate which block this is based on its Z position
                            const blockIndex = Math.round(intersectedObject.position.z / 4);
                            const currentHeight = parseInt(this.blockHeight) || 0;
                            const targetHeight = currentHeight + blockIndex;
                            
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
                }
            } else {
                tooltip.style.display = 'none';
                tooltip.style.pointerEvents = 'none'; // Reset pointer events for hover mode
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            tooltip.style.pointerEvents = 'none'; // Reset pointer events for hover mode
        });
        
        // Add single-click functionality to fetch detailed transaction data
        this.renderer.domElement.addEventListener('click', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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
                        
                        // Show detailed transaction data (cached or fetch new)
                        if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                            this.showTransactionDetails(txData.txid, tooltip, event);
                        }
                        break; // Stop after finding the first transaction
                    }
                }
            }
        });
        
        // Add double-click functionality to navigate to transaction page
        this.renderer.domElement.addEventListener('dblclick', (event) => {
            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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
                        const blockIndex = Math.round(intersectedObject.position.z / 4);
                        
                        if (blockIndex === 0) {
                            // Current block - stay on same page
                            console.log('Current block clicked');
                        } else {
                            // Past or future block - navigate to that block's height
                            const currentHeight = parseInt(this.blockHeight) || 0;
                            const targetHeight = currentHeight + blockIndex;
                            
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
        
        // Filter out transactions that are already loaded (have transactionData)
        const unloadedTransactions = transactionsWithData.filter(tx => 
            !tx.userData.transactionData
        );
        
        const totalToLoad = transactionsWithData.length;
        const alreadyLoaded = totalToLoad - unloadedTransactions.length;
        const remainingToLoad = unloadedTransactions.length;
        let loadedCount = alreadyLoaded; // Start count from already loaded
        let errorCount = 0;
        
        if (remainingToLoad === 0) {
            console.log('All transactions already loaded');
            button.textContent = 'All Loaded';
            button.disabled = true;
            loadTransactionsButton.disabled = true;
            this.isLoadingAll = false;
            return;
        }
        
        console.log(`Loading remaining ${remainingToLoad} transactions (${alreadyLoaded} already loaded) with 0.1s delay between requests...`);
        
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
                
                console.log(`Loaded transaction ${loadedCount}/${totalToLoad}: ${txData.txid.substring(0, 16)}...`);
                
            } catch (error) {
                errorCount++;
                console.warn(`Failed to load transaction ${i + 1}:`, error);
            }
            
            // Add delay between requests (except for the last one)
            if (i < unloadedTransactions.length - 1 && !this.shouldStopLoadingAll) {
                await new Promise(resolve => setTimeout(resolve, 100)); // 0.1 second delay
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
            
            // Calculate new height based on transaction size (similar to transaction.js)
            const txSize = txData.size || 250; // Default size if not available
            // Scale based on transaction size: 250 bytes = 1.0x, larger transactions scale up
            const sizeScale = Math.max(1.0, Math.min(3.0, txSize / 250)); // Scale between 1.0x and 3.0x
            
            // Animate the height change (scale.y starts at 1.0) and adjust position to keep top-aligned
            this.animateCuboidHeightTopAligned(cuboid, sizeScale, 1000);
            
            // Move loaded transactions maintaining their layer spacing
            const baseAlignedY = 2; // Base Y position for layer 0 loaded transactions
            const layer = cuboid.userData.layer;
            const spacingY = 0.3; // Same spacing as used in original grid
            const alignedY = baseAlignedY - layer * spacingY; // Maintain layer spacing
            
            // Animate only the Y position upward to the aligned level
            this.animateCuboidPosition(cuboid, alignedY, 1000);
            
            // Update the transaction cache with detailed information
            const tooltipContent = this.createDetailedTooltipContent(txData, txid);
            this.transactionCache.set(txid, tooltipContent);
            
            // Update cuboid userData with transaction details
            cuboid.userData.transactionData = txData;
            cuboid.userData.size = txSize;
            
            console.log(`Loaded transaction ${globalIndex + 1}: ${txid.substring(0, 16)}... (size: ${txSize} bytes, scale: ${sizeScale.toFixed(3)})`);
            
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
        
        // Create next 5 blocks in front of the current block
        for (let i = 1; i <= 5; i++) {
            const nextBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            nextBlock.position.set(0, 0, i * 4); // Position each block 4 units in front of the previous
            nextBlock.castShadow = true;
            nextBlock.renderOrder = 1;
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            nextBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(nextBlock);
        }
        
        // Create previous blocks behind the current block (only if current height allows)
        const currentHeight = parseInt(this.blockHeight) || 0;
        const maxPastBlocks = Math.min(5, currentHeight); // Don't show more past blocks than available
        
        for (let i = 1; i <= maxPastBlocks; i++) {
            const prevBlock = new THREE.Mesh(blockGeometry, blockMaterial.clone());
            prevBlock.position.set(0, 0, -i * 4); // Position each block 4 units behind the previous
            prevBlock.castShadow = true;
            prevBlock.renderOrder = 1;
            
            // Incrementally decrease opacity (increase transparency) as blocks get further away
            const opacity = 0.1 - (i * 0.02); // Start at 0.1, decrease by 0.02 for each block
            prevBlock.material.opacity = Math.max(opacity, 0.01); // Cap at 0.05 to maintain some visibility
            
            this.scene.add(prevBlock);
        }
    }

    async fetchData() {
        this.showLoadingModal('Loading block data...');
        
        try {
            // If no block height provided, fetch the chain tip height
            if (!this.blockHeight) {
                this.updateLoadingProgress('Fetching chain tip height...', 10);
                console.log('No block height provided, fetching chain tip...');
                const tipResponse = await fetch('https://mempool.space/api/blocks/tip/height');
                
                if (tipResponse.status === 429) {
                    this.hideLoadingModal();
                    this.showRateLimitError('Mempool.space API');
                    return;
                }
                
                if (!tipResponse.ok) {
                    throw new Error(`HTTP error! status: ${tipResponse.status}`);
                }
                
                this.blockHeight = await tipResponse.text();
                console.log(`Fetched chain tip height: ${this.blockHeight}`);
            }
            
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
            
            this.updateLoadingProgress('Fetching transaction IDs...', 70);
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
            
            this.updateLoadingProgress('Creating visualization...', 90);
            this.updateUI(this.blockData);
            this.updateBlockVisualization();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
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
        
        document.getElementById('block-height').textContent = data.height?.toLocaleString() || 'N/A';
        document.getElementById('block-hash').textContent = data.id?.substring(0, 16) + '...' || 'N/A';
        document.getElementById('block-size').textContent = data.size ? `${(data.size / 1024).toFixed(1)} KB` : 'N/A';
        document.getElementById('block-tx-count').textContent = data.tx_count?.toLocaleString() || 'N/A';
        
        const blockTime = data.timestamp ? new Date(data.timestamp * 1000).toLocaleString() : 'N/A';
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
            const CUBOID_WIDTH = 0.035;   // Width (was 0.07)
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
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinBlockExplorer();
}); 