// Bitcoin Explorer - Address Page
class BitcoinAddressExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isRotating = true;
        this.controls = {
            distance: 30,
            phi: Math.PI / 4,
            theta: 0,
            target: new THREE.Vector3(0, 0, 0),
            panX: 0,
            panY: 0,
            panZ: 0
        };
        this.addressData = null;
        this.address = null;
        
        // Get address from URL parameter, default to 1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv if none provided
        const urlParams = new URLSearchParams(window.location.search);
        this.address = urlParams.get('address') || '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv';
        
        this.init();
    }

    init() {
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
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.scene.children);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const userData = intersectedObject.userData;
                
                let tooltipContent = '';
                
                if (userData.type === 'transaction') {
                    const tx = userData.data;
                    let dateStr = 'Unknown';
                    if (tx.status && tx.status.block_time) {
                        const date = new Date(tx.status.block_time * 1000);
                        dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                    }
                    tooltipContent = `
                        <strong>Transaction</strong><br>
                        TXID: ${tx.txid.substring(0, 16)}...<br>
                        Amount: ${(tx.value / 100000000).toFixed(8)} BTC<br>
                        Size: ${tx.size} bytes<br>
                        Date: ${dateStr}<br>
                        <em>Double-click to view transaction</em>
                    `;
                } else if (userData.type === 'address') {
                    const address = userData.data;
                    const totalUtxoValue = this.utxoData ? this.utxoData.reduce((sum, utxo) => sum + utxo.value, 0) : 0;
                    tooltipContent = `
                        <strong>Address</strong><br>
                        ${address.address.substring(0, 16)}...<br>
                        Balance: ${(totalUtxoValue / 100000000).toFixed(8)} BTC<br>
                        UTXOs: ${this.utxoData ? this.utxoData.length : 0}<br>
                        Transactions: ${this.transactionHistory ? this.transactionHistory.length : 0}
                    `;
                } else if (userData.type === 'utxo') {
                    const utxo = userData.data;
                    tooltipContent = `
                        <strong>UTXO ${userData.index + 1}</strong><br>
                        TXID: ${utxo.txid.substring(0, 16)}...<br>
                        Output: ${utxo.vout}<br>
                        Value: ${(utxo.value / 100000000).toFixed(8)} BTC<br>
                        Block: ${utxo.status.block_height}<br>
                        <em>Double-click to view transaction</em>
                    `;
                }
                
                if (tooltipContent) {
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 10 + 'px';
                    tooltip.style.top = e.clientY - 10 + 'px';
                }
            } else {
                tooltip.style.display = 'none';
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
                this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
            }

            this.updateCameraPosition();
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        });
        
        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        this.renderer.domElement.addEventListener('wheel', (e) => {
            // Inverted zoom direction
            this.controls.distance += e.deltaY * 0.1;
            this.controls.distance = Math.max(1, Math.min(200, this.controls.distance)); // Allow much closer zoom
            this.updateCameraPosition();
        });
        
        // Double-click functionality
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
                
                if (userData.type === 'transaction') {
                    const tx = userData.data;
                    window.location.href = `transaction.html?txid=${tx.txid}`;
                } else if (userData.type === 'utxo') {
                    const utxo = userData.data;
                    window.location.href = `transaction.html?txid=${utxo.txid}`;
                }
            }
        });
        
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.controls.distance = 30;
            this.controls.phi = Math.PI / 4;
            this.controls.theta = 0;
            this.controls.target.set(0, 0, 0);
            this.controls.panX = 0;
            this.controls.panY = 0;
            this.controls.panZ = 0;
            this.updateCameraPosition();
        });
        
        document.getElementById('toggle-transactions').addEventListener('click', () => {
            // Toggle transaction visibility
            this.scene.children.forEach(child => {
                if (child.userData.type === 'transaction') {
                    child.visible = !child.visible;
                }
            });
            
            const button = document.getElementById('toggle-transactions');
            button.textContent = button.textContent === 'Show Transactions' ? 'Hide Transactions' : 'Show Transactions';
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
        
        // Modal functionality
        this.setupModal();
        
        // Panel toggle functionality
        this.setupPanelToggle();
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
    }

    async fetchData() {
        try {
            if (!this.address) {
                console.error('No address provided in URL');
                this.updateUI({});
                return;
            }

            // Fetch address data from Mempool.space
            const response = await fetch(`https://mempool.space/api/address/${this.address}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.addressData = await response.json();
            
            console.log('=== ADDRESS DATA ===');
            console.log('Address:', this.address);
            console.log('Full address object:', this.addressData);
            console.log('Chain stats:', this.addressData.chain_stats);
            console.log('Mempool stats:', this.addressData.mempool_stats);
            
            // Fetch transaction history
            const txsResponse = await fetch(`https://mempool.space/api/address/${this.address}/txs`);
            
            if (txsResponse.ok) {
                this.transactionHistory = await txsResponse.json();
                console.log('=== TRANSACTION HISTORY ===');
                console.log('Transaction count:', this.transactionHistory.length);
                console.log('First 3 transactions:', this.transactionHistory.slice(0, 3));
                console.log('Transaction details:');
                this.transactionHistory.slice(0, 5).forEach((tx, index) => {
                    console.log(`  TX ${index + 1}:`, {
                        txid: tx.txid,
                        size: tx.size,
                        weight: tx.weight,
                        fee: tx.fee,
                        status: tx.status,
                        vout_count: tx.vout ? tx.vout.length : 0,
                        vin_count: tx.vin ? tx.vin.length : 0
                    });
                });
            } else {
                console.warn('Could not fetch transaction history');
                this.transactionHistory = [];
            }
            
            // Fetch UTXO data
            const utxoResponse = await fetch(`https://mempool.space/api/address/${this.address}/utxo`);
            
            if (utxoResponse.ok) {
                this.utxoData = await utxoResponse.json();
                console.log('=== UTXO DATA ===');
                console.log('UTXO count:', this.utxoData.length);
                console.log('Total UTXO value:', this.utxoData.reduce((sum, utxo) => sum + utxo.value, 0));
                console.log('UTXO details:');
                this.utxoData.forEach((utxo, index) => {
                    console.log(`  UTXO ${index + 1}:`, {
                        txid: utxo.txid,
                        vout: utxo.vout,
                        value: utxo.value,
                        status: utxo.status,
                        block_height: utxo.status.block_height,
                        block_time: utxo.status.block_time
                    });
                });
            } else {
                console.warn('Could not fetch UTXO data');
                this.utxoData = [];
            }
            
            console.log('=== SUMMARY ===');
            console.log('Address:', this.address);
            console.log('Total transactions:', this.transactionHistory ? this.transactionHistory.length : 0);
            console.log('Total UTXOs:', this.utxoData ? this.utxoData.length : 0);
            console.log('Total UTXO value:', this.utxoData ? this.utxoData.reduce((sum, utxo) => sum + utxo.value, 0) : 0);
            console.log('Chain stats funded:', this.addressData.chain_stats ? this.addressData.chain_stats.funded_txo_sum : 0);
            console.log('Chain stats spent:', this.addressData.chain_stats ? this.addressData.chain_stats.spent_txo_sum : 0);
            
            this.updateUI(this.addressData);
            this.createAddressVisualization();
            
        } catch (error) {
            console.error('Error fetching address data:', error);
            this.updateUI({});
        }
    }

    updateUI(data) {
        if (!data || Object.keys(data).length === 0) {
            document.getElementById('address-subtitle').textContent = 'Loading...';
            document.getElementById('address-hash').textContent = 'Loading...';
            document.getElementById('address-balance').textContent = 'Loading...';
            document.getElementById('address-tx-count').textContent = 'Loading...';
            document.getElementById('address-utxo-count').textContent = 'Loading...';
            document.getElementById('address-type').textContent = 'Loading...';
            document.getElementById('address-received').textContent = 'Loading...';
            document.getElementById('address-sent').textContent = 'Loading...';
            document.getElementById('address-unconfirmed').textContent = 'Loading...';
            return;
        }

        // Update subtitle with address and balance
        const balance = data.chain_stats ? (data.chain_stats.funded_txo_sum / 100000000).toFixed(8) : '0';
        const subtitle = `${data.address || 'Unknown'} • ${balance} BTC`;
        document.getElementById('address-subtitle').textContent = subtitle;

        document.getElementById('address-hash').textContent = data.address ? data.address.substring(0, 16) + '...' : 'N/A';
        document.getElementById('address-balance').textContent = data.chain_stats ? `${(data.chain_stats.funded_txo_sum / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('address-tx-count').textContent = data.chain_stats ? data.chain_stats.tx_count.toString() : 'N/A';
        document.getElementById('address-utxo-count').textContent = this.utxoData ? this.utxoData.length.toString() : 'N/A';
        document.getElementById('address-type').textContent = data.chain_stats ? 'Confirmed' : 'N/A';
        document.getElementById('address-received').textContent = data.chain_stats ? `${(data.chain_stats.funded_txo_sum / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('address-sent').textContent = data.chain_stats ? `${(data.chain_stats.spent_txo_sum / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('address-unconfirmed').textContent = data.mempool_stats ? `${(data.mempool_stats.funded_txo_sum / 100000000).toFixed(8)} BTC` : '0.00000000 BTC';
    }

    createAddressVisualization() {
        if (!this.addressData) return;

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

        // Create central address representation
        this.createAddressRepresentation();
    }

    createAddressRepresentation() {
        // Calculate total UTXO value for sphere sizing
        const totalUtxoValue = this.utxoData ? this.utxoData.reduce((sum, utxo) => sum + utxo.value, 0) : 0;
        const totalUtxoValueBTC = totalUtxoValue / 100000000;
        
        console.log('=== OUTER SPHERE SCALING DEBUG ===');
        console.log('Total UTXO value:', totalUtxoValue);
        console.log('Total UTXO value in BTC:', totalUtxoValueBTC);
        console.log('Raw value scale:', totalUtxoValue / 100000000);
        
        const baseRadius = 1.5; // Reduced base radius
        const valueScale = Math.max(0.3, Math.min(2.0, Math.log10(totalUtxoValueBTC + 1) * 0.3)); // Reduced scaling
        const sphereRadius = baseRadius * valueScale;
        
        console.log('Final value scale:', valueScale);
        console.log('Final sphere radius:', sphereRadius);
        
        // Create a central sphere representing the address
        const addressGeometry = new THREE.SphereGeometry(sphereRadius, 32, 32);
        const addressMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, // White color
            transparent: true,
            opacity: 0.3, // Lower opacity to reduce interference
            side: THREE.FrontSide, // Only render front side
            depthWrite: false, // Don't write to depth buffer
            depthTest: true // Still test depth
        });
        const addressSphere = new THREE.Mesh(addressGeometry, addressMaterial);
        addressSphere.position.set(0, 0, 0);
        addressSphere.renderOrder = -1; // Render first (behind other objects)
        addressSphere.userData = { type: 'address', data: this.addressData };
        this.scene.add(addressSphere);

        // Add inner lighting to illuminate UTXOs
        const innerLight = new THREE.PointLight(0xffffff, 0.8, sphereRadius * 2);
        innerLight.position.set(0, 0, 0);
        this.scene.add(innerLight);
        
        // Add UTXO spheres inside the address sphere
        if (this.utxoData && this.utxoData.length > 0) {
            this.createUtxoSpheres(sphereRadius);
        }

        // Add transaction history visualization
        if (this.transactionHistory && this.transactionHistory.length > 0) {
            this.createTransactionHistory(sphereRadius);
        }
    }

    createTransactionHistory(sphereRadius) {
        // Create transaction history visualization
        const txCount = Math.min(this.transactionHistory.length, 50); // Limit to 50 for performance
        
        // Calculate line parameters
        const lineLength = 20; // Total length of the line
        const spacing = lineLength / txCount; // Space between transactions
        
        // Calculate offset based on sphere radius and transaction count
        const lineWidth = (txCount - 1) * spacing; // Total width of the transaction line
        const offset = sphereRadius + Math.max(2, lineWidth / 2); // Start at sphere radius + line width consideration
        
        for (let i = 0; i < txCount; i++) {
            const tx = this.transactionHistory[i];
            
            // Calculate transaction size for cuboid dimensions
            const txSize = tx.size || 250;
            const width = 1.5;
            const height = Math.max(0.1, txSize / 1000); // Scale height based on transaction size
            const depth = 0.1;

            // Position transactions in a straight line
            const linePosition = (i - txCount / 2) * spacing; // Center the line around origin
            const x = 0; // X-axis position
            const y = 0; // Align all transactions to the top
            const z = 0.5 + offset + linePosition; // Fixed distance from center
            
            const txGeometry = new THREE.BoxGeometry(width, height, depth);
            const txMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 0.6
            });
            const txCuboid = new THREE.Mesh(txGeometry, txMaterial);
            txCuboid.position.set(x, y, z);
            
            // Calculate total output value for this transaction
            const totalOutput = tx.vout ? tx.vout.reduce((sum, output) => sum + output.value, 0) : 0;
            
            txCuboid.userData = { 
                type: 'transaction', 
                data: {
                    txid: tx.txid,
                    value: totalOutput,
                    size: txSize,
                    status: tx.status // Include status for timestamp
                }
            };
            this.scene.add(txCuboid);
        }
    }

    createUtxoSpheres(sphereRadius) {
        console.log('=== UTXO SPHERE CREATION DEBUG ===');
        console.log('Total UTXOs:', this.utxoData.length);
        console.log('Sphere radius:', sphereRadius);
        console.log('UTXO values range:', {
            min: Math.min(...this.utxoData.map(u => u.value)),
            max: Math.max(...this.utxoData.map(u => u.value)),
            total: this.utxoData.reduce((sum, u) => sum + u.value, 0)
        });
        console.log('UTXO values in BTC:', this.utxoData.map(u => ({
            value: u.value,
            btc: (u.value / 100000000).toFixed(8)
        })));
        
        // Seeded random number generator for predictable positions
        const seededRandom = (seed) => {
            let x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };
        
        // Create a sphere for each UTXO inside the address sphere
        this.utxoData.forEach((utxo, index) => {
            // Use address + UTXO index as seed for deterministic positioning
            const baseSeed = this.hashCode(this.address);
            const seed = baseSeed + index; // Add index for variation between UTXOs
            
            // Deterministic position inside the sphere
            const radius = seededRandom(seed) * (sphereRadius * 0.8); // 80% of sphere radius
            const theta = seededRandom(seed + 1) * Math.PI * 2; // Angle around Y axis
            const phi = Math.acos(2 * seededRandom(seed + 2) - 1); // Angle from Y axis
            
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.cos(phi);
            const z = radius * Math.sin(phi) * Math.sin(theta);
            
            // Size sphere based on UTXO value
            const utxoValue = utxo.value;
            
            // Improved scaling: use logarithmic scaling for better visual representation
            const valueInBTC = utxoValue / 100000000;
            const logValue = Math.log10(valueInBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(4.0, logValue * 0.8)); // Adjusted scaling for better visibility
            const utxoRadius = 0.12 * sizeScale;
            
            console.log(`UTXO ${index + 1}:`, {
                txid: utxo.txid.substring(0, 16) + '...',
                vout: utxo.vout,
                value: utxoValue,
                valueInBTC: valueInBTC.toFixed(8),
                logValue: logValue.toFixed(3),
                sizeScale: sizeScale.toFixed(3),
                finalRadius: utxoRadius.toFixed(3)
            });
            
            const utxoGeometry = new THREE.SphereGeometry(utxoRadius, 16, 16);
            const utxoMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xffffff, // White color for UTXOs
                transparent: true,
                opacity: 1.0, // Full opacity for maximum brightness
                depthWrite: true, // Write to depth buffer
                depthTest: true,
                emissive: 0x222222 // Add slight glow effect
            });
            const utxoSphere = new THREE.Mesh(utxoGeometry, utxoMaterial);
            utxoSphere.position.set(x, y, z);
            utxoSphere.renderOrder = 1; // Render after the main sphere
            utxoSphere.userData = { 
                type: 'utxo', 
                data: utxo,
                index: index
            };
            this.scene.add(utxoSphere);
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isRotating) {
            this.controls.theta += 0.005;
            this.updateCameraPosition();
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Simple hash function to convert string to number
    hashCode(str) {
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    setupModal() {
        const modal = document.getElementById('address-modal');
        const changeAddressBtn = document.getElementById('change-address');
        const closeBtn = document.querySelector('.modal-close');
        const cancelBtn = document.getElementById('modal-cancel');
        const addressForm = document.getElementById('address-form');
        const addressInput = document.getElementById('new-address');
        const pasteBtn = document.getElementById('paste-button');
        const famousAddresses = document.querySelectorAll('.famous-address');

        // Show modal
        changeAddressBtn.addEventListener('click', () => {
            modal.style.display = 'block';
            addressInput.focus();
            // Pre-fill with current address
            addressInput.value = this.address;
        });

        // Close modal functions
        const closeModal = () => {
            modal.style.display = 'none';
            addressInput.value = '';
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
                    addressInput.value = text.trim();
                    addressInput.focus();
                }
            } catch (err) {
                console.error('Failed to read clipboard:', err);
                // Fallback for older browsers or when clipboard access is denied
                alert('Please paste manually (Ctrl+V) or copy the address to clipboard first');
            }
        });

        // Famous addresses functionality
        famousAddresses.forEach(button => {
            button.addEventListener('click', () => {
                const address = button.getAttribute('data-address');
                addressInput.value = address;
                addressInput.focus();
            });
        });

        // Handle form submission
        addressForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const newAddress = addressInput.value.trim();
            
            if (!newAddress) {
                alert('Please enter a valid Bitcoin address');
                return;
            }

            // Basic Bitcoin address validation for different formats
            const isValidBitcoinAddress = (address) => {
                // Legacy addresses (P2PKH): 1 + 25-34 characters
                if (address.startsWith('1') && address.length >= 26 && address.length <= 35) {
                    return true;
                }
                // SegWit addresses (P2SH): 3 + 25-34 characters
                if (address.startsWith('3') && address.length >= 26 && address.length <= 35) {
                    return true;
                }
                // Native SegWit addresses (P2WPKH/P2WSH): bc1 + variable length
                if (address.startsWith('bc1') && address.length >= 42 && address.length <= 62) {
                    return true;
                }
                // Taproot addresses (P2TR): bc1p + variable length
                if (address.startsWith('bc1p') && address.length >= 62 && address.length <= 90) {
                    return true;
                }
                return false;
            };

            if (!isValidBitcoinAddress(newAddress)) {
                alert('Please enter a valid Bitcoin address format:\n• Legacy: 1... (26-35 chars)\n• SegWit: 3... (26-35 chars)\n• Native SegWit: bc1... (42-62 chars)\n• Taproot: bc1p... (62-90 chars)');
                return;
            }

            // Redirect to the same page with new address parameter
            const currentUrl = new URL(window.location);
            currentUrl.searchParams.set('address', newAddress);
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
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.updateCameraPosition();
    }
    
    zoomOut() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        this.controls.distance += 2;
        this.controls.distance = Math.max(10, Math.min(100, this.controls.distance));
        this.updateCameraPosition();
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('address-info');
        
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
    new BitcoinAddressExplorer();
}); 