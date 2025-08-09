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
                    tooltipContent = `
                        <strong>Transaction</strong><br>
                        TXID: ${tx.txid.substring(0, 16)}...<br>
                        Amount: ${(tx.value / 100000000).toFixed(8)} BTC<br>
                        Size: ${tx.size} bytes<br>
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
            this.controls.distance = Math.max(5, Math.min(200, this.controls.distance));
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
            document.getElementById('address-hash').textContent = 'Loading...';
            document.getElementById('address-balance').textContent = 'Loading...';
            document.getElementById('address-tx-count').textContent = 'Loading...';
            document.getElementById('address-type').textContent = 'Loading...';
            document.getElementById('address-received').textContent = 'Loading...';
            document.getElementById('address-sent').textContent = 'Loading...';
            document.getElementById('address-unconfirmed').textContent = 'Loading...';
            return;
        }

        document.getElementById('address-hash').textContent = data.address ? data.address.substring(0, 16) + '...' : 'N/A';
        document.getElementById('address-balance').textContent = data.chain_stats ? `${(data.chain_stats.funded_txo_sum / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('address-tx-count').textContent = data.chain_stats ? data.chain_stats.tx_count.toString() : 'N/A';
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
        const baseRadius = 2;
        const valueScale = Math.max(0.5, Math.min(5.0, totalUtxoValue / 100000000)); // Scale based on BTC
        const sphereRadius = baseRadius * valueScale;
        
        // Create a central sphere representing the address
        const addressGeometry = new THREE.SphereGeometry(sphereRadius, 32, 32);
        const addressMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, // Changed to white
            transparent: true,
            opacity: 0.5 // Changed to 0.5 opacity
        });
        const addressSphere = new THREE.Mesh(addressGeometry, addressMaterial);
        addressSphere.position.set(0, 0, 0);
        addressSphere.userData = { type: 'address', data: this.addressData };
        this.scene.add(addressSphere);

        // Add UTXO spheres inside the address sphere
        if (this.utxoData && this.utxoData.length > 0) {
            this.createUtxoSpheres(sphereRadius);
        }

        // Add transaction history visualization
        if (this.transactionHistory && this.transactionHistory.length > 0) {
            this.createTransactionHistory();
        }
    }

    createTransactionHistory() {
        // Create transaction history visualization
        const txCount = Math.min(this.transactionHistory.length, 50); // Limit to 50 for performance
        
        for (let i = 0; i < txCount; i++) {
            const tx = this.transactionHistory[i];
            
            // Calculate transaction size for cuboid dimensions
            const txSize = tx.size || 250;
            const width = 0.5;
            const height = Math.max(0.1, txSize / 1000); // Scale height based on transaction size
            const depth = 0.3;
            
            // Create transaction cuboids around the address
            const angle = (i / txCount) * Math.PI * 2;
            const radius = 8 + Math.random() * 4; // Random distance from center
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const y = (Math.random() - 0.5) * 4; // Random height
            
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
                    size: txSize
                }
            };
            this.scene.add(txCuboid);
        }
    }

    createUtxoSpheres(sphereRadius) {
        // Create a sphere for each UTXO inside the address sphere
        this.utxoData.forEach((utxo, index) => {
            // Random position inside the sphere
            const radius = Math.random() * (sphereRadius * 0.8); // 80% of sphere radius
            const theta = Math.random() * Math.PI * 2; // Random angle around Y axis
            const phi = Math.acos(2 * Math.random() - 1); // Random angle from Y axis
            
            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.cos(phi);
            const z = radius * Math.sin(phi) * Math.sin(theta);
            
            // Size sphere based on UTXO value
            const utxoValue = utxo.value;
            const sizeScale = Math.max(0.1, Math.min(1.0, utxoValue / 100000000)); // Scale based on BTC
            const utxoRadius = 0.2 * sizeScale;
            
            const utxoGeometry = new THREE.SphereGeometry(utxoRadius, 16, 16);
            const utxoMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xff6b6b, // Red color for UTXOs
                transparent: true,
                opacity: 0.8
            });
            const utxoSphere = new THREE.Mesh(utxoGeometry, utxoMaterial);
            utxoSphere.position.set(x, y, z);
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
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinAddressExplorer();
}); 