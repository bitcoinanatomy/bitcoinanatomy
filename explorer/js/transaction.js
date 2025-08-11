// Bitcoin Explorer - Transaction Page
class BitcoinTransactionExplorer {
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
        this.transactionData = null;
        this.txid = null;
        
        // Get transaction ID from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.txid = urlParams.get('txid');
        
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
                
                if (userData.type === 'input') {
                    const input = userData.data;
                    const amount = input.prevout?.value ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
                    const scriptType = input.prevout?.scriptpubkey_type || 'Unknown';
                    
                    tooltipContent = `
                        <strong>Input ${userData.index + 1}</strong><br>
                        Amount: ${amount} BTC<br>
                        Script Type: ${scriptType}<br>
                        ${input.prevout?.scriptpubkey_address ? `Address: ${input.prevout.scriptpubkey_address.substring(0, 16)}...` : ''}
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
                this.controls.phi = Math.max(0.01, Math.min(Math.PI - 0.1, this.controls.phi));
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
        
        // Remove the toggle-flow button since we don't have flows anymore
        const toggleFlowButton = document.getElementById('toggle-flow');
        if (toggleFlowButton) {
            toggleFlowButton.style.display = 'none';
        }
        
        // Modal functionality
        this.setupModal();
        
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
                
                if (userData.type === 'output' && userData.spendingData) {
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

        // Update title hash in format: 4a5e14...89f3ad
        const titleHash = data.txid ? 
            data.txid.substring(0, 6) + '...' + data.txid.substring(data.txid.length - 6) : 
            'Not Found';
        document.getElementById('tx-title-hash').textContent = titleHash;
        
        document.getElementById('tx-hash').textContent = data.txid ? data.txid.substring(0, 16) + '...' : 'N/A';
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

        // Create input spheres on the left
        inputs.forEach((input, index) => {
            // Calculate sphere size based on amount (logarithmic scaling)
            const amount = input.prevout?.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const sphereRadius = 1 * sizeScale;
            
            const geometry = new THREE.SphereGeometry(sphereRadius, 16, 16);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xff6b6b,
                transparent: true,
                opacity: 0.9, // High opacity but not fully opaque
                depthWrite: true,
                depthTest: true
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.renderOrder = 1; // Render after other objects
            
            sphere.position.set(-35, (inputs.length - 1) - index * 2, 0); // First inputs at top, moved much further away
            sphere.userData = { type: 'input', index, data: input };
            this.scene.add(sphere);
        });

        // Create output spheres on the right
        outputs.forEach((output, index) => {
            // Calculate sphere size based on amount (logarithmic scaling)
            const amount = output.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const sphereRadius = 1 * sizeScale; // Increased base radius
            
            const geometry = new THREE.SphereGeometry(sphereRadius, 16, 16);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xffffff, // White color
                transparent: true,
                opacity: 0.9, // High opacity but not fully opaque
                depthWrite: true,
                depthTest: true
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.renderOrder = 1; // Render after other objects
            
            sphere.position.set(35, (outputs.length - 1) - index * 2, 0); // First outputs at top, moved much further away
            sphere.userData = { type: 'output', index, data: output };
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
        
        // Left side circle (input disc - perpendicular to X-axis)
        const leftCircleGeometry = new THREE.CircleGeometry(circleRadius, 32);
        const leftCircleMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            depthTest: true
        });
        const leftCircle = new THREE.Mesh(leftCircleGeometry, leftCircleMaterial);
        leftCircle.position.set(-width/2 - 0.1, 0, 0);
        leftCircle.rotation.y = Math.PI / 2; // Rotate to be perpendicular to X-axis
        leftCircle.renderOrder = 1; // Render after other objects
        this.scene.add(leftCircle);

        // Right side circle (output disc - perpendicular to X-axis)
        const rightCircleGeometry = new THREE.CircleGeometry(circleRadius, 32);
        const rightCircleMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            depthTest: true
        });
        const rightCircle = new THREE.Mesh(rightCircleGeometry, rightCircleMaterial);
        rightCircle.position.set(width/2 + 0.1, 0, 0);
        rightCircle.rotation.y = -Math.PI / 2; // Rotate to be perpendicular to X-axis
        rightCircle.renderOrder = 1; // Render after other objects
        this.scene.add(rightCircle);

        // Create connection curves
        inputs.forEach((input, index) => {
            const startPoint = new THREE.Vector3(-35, (inputs.length - 1) - index * 2, 0);
            const endPoint = new THREE.Vector3(-width/2, 0, 0); // End at left side of cuboid
            
            // Create control points for smooth curve
            const controlPoint1 = new THREE.Vector3(-15, (inputs.length - 1) - index * 2 + 1, 0);
            const controlPoint2 = new THREE.Vector3(-8, 0.5, 0);
            
            const curve = new THREE.CubicBezierCurve3(startPoint, controlPoint1, controlPoint2, endPoint);
            
            // Calculate tube radius based on input sphere size (logarithmic scaling)
            const amount = input.prevout?.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const tubeRadius = 1 * sizeScale;
            
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, tubeRadius, 8, false);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xff6b6b, 
                opacity: 0.6, 
                transparent: true,
                depthWrite: false,
                depthTest: true
            });
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 0; // Render before circles
            tube.userData = { type: 'input-tube', index: index };
            this.scene.add(tube);
        });

        outputs.forEach((output, index) => {
            const startPoint = new THREE.Vector3(width/2, 0, 0); // Start from right side of cuboid
            const endPoint = new THREE.Vector3(35, (outputs.length - 1) - index * 2, 0);
            
            // Create control points for smooth curve
            const controlPoint1 = new THREE.Vector3(15, 0.5, 0); // Adjusted for new start point
            const controlPoint2 = new THREE.Vector3(8, (outputs.length - 1) - index * 2 + 1, 0);
            
            const curve = new THREE.CubicBezierCurve3(startPoint, controlPoint1, controlPoint2, endPoint);
            
            // Calculate tube radius based on output sphere size (logarithmic scaling)
            const amount = output.value || 0;
            const amountBTC = amount / 100000000;
            const logValue = Math.log10(amountBTC + 1); // +1 to handle 0 values
            const sizeScale = Math.max(0.05, Math.min(50.0, logValue * 8.0 + 0.1)); // Ultra extreme logarithmic scaling
            const tubeRadius = 1 * sizeScale;
            
            const tubeGeometry = new THREE.TubeGeometry(curve, 64, tubeRadius, 8, false);
            const material = new THREE.MeshLambertMaterial({ 
                color: 0xffffff, // White color
                opacity: 0.6, 
                transparent: true,
                depthWrite: false,
                depthTest: true
            });
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 0; // Render before circles
            tube.userData = { type: 'output-tube', index: index, data: output };
            this.scene.add(tube);
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
                            // Grey out spent outputs
                            sphere.material.color.setHex(0x666666);
                            if (tube) tube.material.color.setHex(0x666666);
                            // Store spending data for tooltip and navigation
                            sphere.userData.spendingData = spendingData;
                            if (tube) tube.userData.spendingData = spendingData;
                            console.log(`Output ${i} is SPENT - greyed out`);
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

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinTransactionExplorer();
}); 