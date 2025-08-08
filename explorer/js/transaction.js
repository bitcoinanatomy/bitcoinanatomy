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
            this.updateUI(this.transactionData);
            this.createTransactionVisualization();
            
        } catch (error) {
            console.error('Error fetching transaction data:', error);
            this.updateUI({});
        }
    }

    updateUI(data) {
        if (!data || Object.keys(data).length === 0) {
            document.getElementById('tx-hash').textContent = 'Loading...';
            document.getElementById('tx-amount').textContent = 'Loading...';
            document.getElementById('tx-fee').textContent = 'Loading...';
            document.getElementById('tx-status').textContent = 'Loading...';
            document.getElementById('tx-inputs').textContent = 'Loading...';
            document.getElementById('tx-outputs').textContent = 'Loading...';
            document.getElementById('tx-size').textContent = 'Loading...';
            document.getElementById('tx-confirmations').textContent = 'Loading...';
            return;
        }

        // Calculate total output amount
        const totalOutput = data.vout ? data.vout.reduce((sum, output) => sum + output.value, 0) : 0;
        const fee = data.fee || 0;

        document.getElementById('tx-hash').textContent = data.txid ? data.txid.substring(0, 16) + '...' : 'N/A';
        document.getElementById('tx-amount').textContent = totalOutput ? `${(totalOutput / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-fee').textContent = fee ? `${(fee / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-status').textContent = data.status?.confirmed ? 'Confirmed' : 'Unconfirmed';
        document.getElementById('tx-inputs').textContent = data.vin ? data.vin.length.toString() : 'N/A';
        document.getElementById('tx-outputs').textContent = data.vout ? data.vout.length.toString() : 'N/A';
        document.getElementById('tx-size').textContent = data.size ? `${data.size} bytes` : 'N/A';
        document.getElementById('tx-confirmations').textContent = data.status?.block_height ? 'Confirmed' : '0';
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
            const geometry = new THREE.SphereGeometry(0.5, 16, 16);
            const material = new THREE.MeshLambertMaterial({ color: 0xff6b6b });
            const sphere = new THREE.Mesh(geometry, material);
            
            sphere.position.set(-8, index * 2 - (inputs.length - 1), 0);
            sphere.userData = { type: 'input', index, data: input };
            this.scene.add(sphere);
        });

        // Create output spheres on the right
        outputs.forEach((output, index) => {
            const geometry = new THREE.SphereGeometry(0.5, 16, 16);
            const material = new THREE.MeshLambertMaterial({ color: 0x4ecdc4 });
            const sphere = new THREE.Mesh(geometry, material);
            
            sphere.position.set(8, index * 2 - (outputs.length - 1), 0);
            sphere.userData = { type: 'output', index, data: output };
            this.scene.add(sphere);
        });

        // Create central transaction cuboid
        const width = 2; // Fixed width
        const depth = width / 10; // 1/10th of width
        const height = Math.max(0.5, (this.transactionData.size || 250) / 1000); // Based on transaction size
        
        const txGeometry = new THREE.BoxGeometry(width, height, depth);
        const txMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const txCuboid = new THREE.Mesh(txGeometry, txMaterial);
        txCuboid.position.set(0, 0, 0);
        txCuboid.userData = { type: 'transaction', data: this.transactionData };
        this.scene.add(txCuboid);

        // Add circles perpendicular to the sides of the cuboid
        // Calculate total satoshis from inputs and outputs
        const totalInputSats = this.transactionData.vin ? 
            this.transactionData.vin.reduce((sum, input) => sum + (input.prevout?.value || 0), 0) : 0;
        const totalOutputSats = this.transactionData.vout ? 
            this.transactionData.vout.reduce((sum, output) => sum + output.value, 0) : 0;
        const totalSats = Math.max(totalInputSats, totalOutputSats);
        
        // Scale radius based on total satoshis (normalize to reasonable range)
        const baseRadius = Math.max(width, height) * 0.6;
        const satsScale = Math.min(2.0, Math.max(0.3, totalSats / 100000000)); // Scale factor based on BTC
        const circleRadius = baseRadius * satsScale;
        
        // Left side circle (perpendicular to X-axis)
        const leftCircleGeometry = new THREE.CircleGeometry(circleRadius, 32);
        const leftCircleMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5
        });
        const leftCircle = new THREE.Mesh(leftCircleGeometry, leftCircleMaterial);
        leftCircle.position.set(-width/2 - 0.1, 0, 0);
        leftCircle.rotation.y = Math.PI / 2; // Rotate to be perpendicular to X-axis
        this.scene.add(leftCircle);

        // Right side circle (perpendicular to X-axis)
        const rightCircleGeometry = new THREE.CircleGeometry(circleRadius, 32);
        const rightCircleMaterial = new THREE.MeshLambertMaterial({ 
            color: 0xffffff, 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5
        });
        const rightCircle = new THREE.Mesh(rightCircleGeometry, rightCircleMaterial);
        rightCircle.position.set(width/2 + 0.1, 0, 0);
        rightCircle.rotation.y = -Math.PI / 2; // Rotate to be perpendicular to X-axis
        this.scene.add(rightCircle);

        // Create connection lines
        inputs.forEach((input, index) => {
            const points = [
                new THREE.Vector3(-8, index * 2 - (inputs.length - 1), 0),
                new THREE.Vector3(0, 0, 0)
            ];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0xff6b6b, opacity: 0.6, transparent: true });
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
        });

        outputs.forEach((output, index) => {
            const points = [
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(8, index * 2 - (outputs.length - 1), 0)
            ];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0x4ecdc4, opacity: 0.6, transparent: true });
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
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
    new BitcoinTransactionExplorer();
}); 