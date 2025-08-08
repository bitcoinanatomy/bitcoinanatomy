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
        
        // Get block height from URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.blockHeight = urlParams.get('height');
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupControls();
        this.createScene();
        this.animate();
        this.fetchData();
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 8, 12);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupControls() {
        let isMouseDown = false;
        let mouseX = 0;
        let mouseY = 0;
        
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            isMouseDown = false;
        });
        
        this.renderer.domElement.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                const deltaX = e.clientX - mouseX;
                const deltaY = e.clientY - mouseY;
                this.camera.position.x += deltaX * 0.01;
                this.camera.position.y -= deltaY * 0.01;
                mouseX = e.clientX;
                mouseY = e.clientY;
            }
        });
        
        this.renderer.domElement.addEventListener('wheel', (e) => {
            const zoomSpeed = 0.1;
            this.camera.position.z -= e.deltaY * zoomSpeed; // Inverted: was +=, now -=
            this.camera.position.z = Math.max(5, Math.min(50, this.camera.position.z));
        });
        
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 8, 12);
            this.camera.lookAt(0, 0, 0);
        });
        
        document.getElementById('toggle-transactions').addEventListener('click', () => {
            this.showTransactions = !this.showTransactions;
            const button = document.getElementById('toggle-transactions');
            button.textContent = this.showTransactions ? 'Hide Transactions' : 'Show Transactions';
            
            this.transactions.forEach(tx => {
                tx.visible = this.showTransactions;
            });
        });
    }

    createScene() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        const gridHelper = new THREE.GridHelper(50, 50, 0x333333, 0x222222);
        this.scene.add(gridHelper);
        
        this.createBlockVisualization();
    }

    createBlockVisualization() {
        // Create main block
        const blockGeometry = new THREE.BoxGeometry(3, 2, 3);
        const blockMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9
        });
        
        const block = new THREE.Mesh(blockGeometry, blockMaterial);
        block.position.set(0, 0, 0);
        block.castShadow = true;
        this.scene.add(block);
        
        // Create transaction particles inside the block
        for (let i = 0; i < 100; i++) {
            const geometry = new THREE.SphereGeometry(0.05, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.7
            });
            
            const particle = new THREE.Mesh(geometry, material);
            particle.position.set(
                (Math.random() - 0.5) * 2.5,
                (Math.random() - 0.5) * 1.5,
                (Math.random() - 0.5) * 2.5
            );
            
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01
                )
            };
            
            this.scene.add(particle);
            this.transactions.push(particle);
        }
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
        
        // Create transaction particles based on real data
        const txCount = Math.min(this.blockData.tx_count || 100, 100); // Limit to 100 for performance
        
        for (let i = 0; i < txCount; i++) {
            const geometry = new THREE.SphereGeometry(0.05, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.7
            });
            
            const particle = new THREE.Mesh(geometry, material);
            particle.position.set(
                (Math.random() - 0.5) * 2.5,
                (Math.random() - 0.5) * 1.5,
                (Math.random() - 0.5) * 2.5
            );
            
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01
                )
            };
            
            this.scene.add(particle);
            this.transactions.push(particle);
        }
        

    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isRotating) {
            this.scene.rotation.y += 0.001;
        }
        
        // Animate transaction particles
        this.transactions.forEach((particle) => {
            particle.position.add(particle.userData.velocity);
            
            // Bounce off block boundaries
            if (Math.abs(particle.position.x) > 1.25) {
                particle.userData.velocity.x *= -1;
            }
            if (Math.abs(particle.position.y) > 0.75) {
                particle.userData.velocity.y *= -1;
            }
            if (Math.abs(particle.position.z) > 1.25) {
                particle.userData.velocity.z *= -1;
            }
        });
        
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