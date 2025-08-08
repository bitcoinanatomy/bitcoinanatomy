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
        this.isExploded = false;
        this.originalPositions = [];
        this.transactionCache = new Map(); // Cache for transaction details
        
        // Get block height from URL parameter
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
            target: new THREE.Vector3(0, 0, 0),
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
            controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
            controls.distance = Math.max(5, Math.min(50, controls.distance));
            controls.update();
        });
    }
    
    setupButtonControls() {
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.controls.target.set(0, 0, 0);
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
        
        document.getElementById('explode-transactions').addEventListener('click', () => {
            this.toggleExplodeTransactions();
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
            const intersects = raycaster.intersectObjects(this.transactions);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
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

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.transactions);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const txData = intersectedObject.userData;
                
                // Show detailed transaction data (cached or fetch new)
                if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                    this.showTransactionDetails(txData.txid, tooltip, event);
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
            const intersects = raycaster.intersectObjects(this.transactions);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const txData = intersectedObject.userData;
                
                // Navigate to transaction page with TXID parameter
                if (txData.txid && !txData.txid.startsWith('dummy_tx_')) {
                    window.location.href = `transaction.html?txid=${txData.txid}`;
                }
            }
        });
    }
    
    toggleExplodeTransactions() {
        if (this.transactions.length === 0) return;
        
        this.isExploded = !this.isExploded;
        const button = document.getElementById('explode-transactions');
        button.textContent = this.isExploded ? 'Implode Transactions' : 'Explode Transactions';
        
        this.transactions.forEach((cuboid, index) => {
            if (this.isExploded) {
                // Move transactions outside the block in a spread pattern
                const originalPos = cuboid.userData.originalPosition;
                const explosionFactor = 3.5; // How far to spread
                
                // Calculate exploded position (spread outward from center)
                const targetX = originalPos.x * explosionFactor;
                const targetY = originalPos.y + (Math.random() - 0.5) * 4; // Add some vertical spread
                const targetZ = originalPos.z * explosionFactor;
                
                // Animate to exploded position
                this.animatePosition(cuboid, targetX, targetY, targetZ, 1000);
            } else {
                // Return to original position
                const originalPos = cuboid.userData.originalPosition;
                this.animatePosition(cuboid, originalPos.x, originalPos.y, originalPos.z, 1000);
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
        
        const gridHelper = new THREE.GridHelper(50, 50, 0x333333, 0x222222);
        this.scene.add(gridHelper);
        
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
        
        const block = new THREE.Mesh(blockGeometry, blockMaterial);
        block.position.set(0, 0, 0);
        block.castShadow = true;
        block.renderOrder = 1;  // Render after transactions (higher number = later)
        this.scene.add(block);
        
        // Store block reference for later use
        this.blockMesh = block;
    }

    async fetchData() {
        try {
            if (!this.blockHeight) {
                console.error('No block height provided in URL');
                this.updateUI({});
                return;
            }
            
            // Fetch block data from Mempool.space using height
            const response = await fetch(`https://mempool.space/api/block-height/${this.blockHeight}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Get the block hash from the height
            const blockHash = await response.text();
            
            // Now fetch the full block data using the hash
            const blockResponse = await fetch(`https://mempool.space/api/v1/block/${blockHash}`);
            
            if (!blockResponse.ok) {
                throw new Error(`HTTP error! status: ${blockResponse.status}`);
            }
            
            this.blockData = await blockResponse.json();
            
            // Fetch transaction IDs for this block
            const txidsResponse = await fetch(`https://mempool.space/api/block/${blockHash}/txids`);
            
            if (txidsResponse.ok) {
                this.transactionIds = await txidsResponse.json();
                console.log(`Fetched ${this.transactionIds.length} transaction IDs for block ${this.blockHeight}`);
            } else {
                console.warn('Could not fetch transaction IDs, using fallback visualization');
                this.transactionIds = [];
            }
            
            this.updateUI(this.blockData);
            this.updateBlockVisualization();
            
        } catch (error) {
            console.error('Error fetching block data:', error);
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
        this.originalPositions = [];
        this.isExploded = false;
        
        // Use actual transaction IDs if available, otherwise fallback to count-based visualization
        const transactionsToVisualize = this.transactionIds.length > 0 ? this.transactionIds : [];
        const txCount = transactionsToVisualize.length > 0 ? 
            Math.min(transactionsToVisualize.length, 500) : // Limit to 500 for performance
            Math.min(this.blockData.tx_count || 100, 100);
        
        console.log(`Creating ${txCount} transaction cuboids`);
        
        // Create transaction cuboids in a 2D grid layout within the block
        const gridSize = Math.ceil(Math.sqrt(txCount)); // 2D grid
        const spacing = 2.4 / gridSize; // Fit within block bounds
        const offset = -(gridSize - 1) * spacing / 2;
        
        for (let i = 0; i < txCount; i++) {
            // Calculate 2D grid position (flat grid at y=0)
            const x = (i % gridSize) * spacing + offset;
            const z = Math.floor(i / gridSize) * spacing + offset;
            const y = 0; // Keep all transactions at the same height level
            
            // Create cuboid geometry (matching mempool.js size)
            const CUBOID_WIDTH = 0.07;   // Width
            const CUBOID_HEIGHT = 0.14;  // Height  
            const CUBOID_LENGTH = 0.56;  // Length
            const geometry = new THREE.BoxGeometry(CUBOID_LENGTH, CUBOID_HEIGHT, CUBOID_WIDTH);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8
            });
            
                        const cuboid = new THREE.Mesh(geometry, material);
            cuboid.position.set(x, y, z);
            cuboid.renderOrder = 0;  // Render before block (lower number = earlier)
            
            // Store original position for explosion animation
            this.originalPositions.push({x: x, y: y, z: z});
            
            // Store transaction data (no velocity/animation)
            if (transactionsToVisualize.length > 0) {
                cuboid.userData = {
                    txid: transactionsToVisualize[i],
                    index: i,
                    originalPosition: {x: x, y: y, z: z}
                };
            } else {
                cuboid.userData = {
                    txid: `dummy_tx_${i}`,
                    index: i,
                    originalPosition: {x: x, y: y, z: z}
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
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinBlockExplorer();
}); 