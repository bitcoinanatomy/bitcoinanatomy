// Bitcoin Explorer - Home Page
class BitcoinHomeExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.blocks = [];
        this.transactions = [];
        this.isRotating = true;
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupControls();
        this.createScene();
        this.animate();
        this.fetchData();
        
        // Update data every 30 seconds
        setInterval(() => this.fetchData(), 30000);
    }

    setupThreeJS() {
        const container = document.getElementById('scene');
        
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 5, 10);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupControls() {
        // Mouse controls
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
        
        // Zoom with scroll (inverted)
        this.renderer.domElement.addEventListener('wheel', (e) => {
            const zoomSpeed = 0.1;
            this.camera.position.z -= e.deltaY * zoomSpeed; // Inverted: was +=, now -=
            this.camera.position.z = Math.max(2, Math.min(50, this.camera.position.z));
        });
        
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 5, 10);
            this.camera.lookAt(0, 0, 0);
        });
    }

    createScene() {
        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
        
        // Grid
        const gridHelper = new THREE.GridHelper(50, 50, 0x333333, 0x222222);
        this.scene.add(gridHelper);
        
        // Create overview visualization
        this.createOverviewVisualization();
    }

    createOverviewVisualization() {
        // Create a central Bitcoin symbol
        const geometry = new THREE.SphereGeometry(2, 32, 32);
        const material = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8
        });
        
        const bitcoinSphere = new THREE.Mesh(geometry, material);
        bitcoinSphere.position.set(0, 0, 0);
        bitcoinSphere.castShadow = true;
        this.scene.add(bitcoinSphere);
        
        // Create orbiting blocks
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const radius = 8;
            
            const blockGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.8);
            const blockMaterial = new THREE.MeshLambertMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.7
            });
            
            const block = new THREE.Mesh(blockGeometry, blockMaterial);
            block.position.set(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            );
            block.castShadow = true;
            
            // Store orbit data
            block.userData = { angle, radius, speed: 0.5 + Math.random() * 0.5 };
            
            this.scene.add(block);
            this.blocks.push(block);
        }
        
        // Create transaction particles
        for (let i = 0; i < 50; i++) {
            const geometry = new THREE.SphereGeometry(0.1, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.6
            });
            
            const particle = new THREE.Mesh(geometry, material);
            particle.position.set(
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20
            );
            
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.02
                )
            };
            
            this.scene.add(particle);
            this.transactions.push(particle);
        }
    }

    async fetchData() {
        try {
            // Fetch blockchain data from BlockCypher API
            const blockResponse = await fetch('https://api.blockcypher.com/v1/btc/main');
            const blockData = await blockResponse.json();
            
            // Fetch market data from CoinGecko API
            const marketResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
            const marketData = await marketResponse.json();
            
            // Fetch mempool data
            const mempoolResponse = await fetch('https://mempool.space/api/v1/fees/recommended');
            const mempoolData = await mempoolResponse.json();
            
            this.updateUI(blockData, marketData.bitcoin, mempoolData);
        } catch (error) {
            console.error('Error fetching data:', error);
            // Use mock data if API fails
            this.updateUI({
                height: 800000,
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                size: 1200000,
                tx_count: 2847
            }, {
                usd: 43250,
                usd_24h_change: 2.4,
                usd_market_cap: 845000000000
            }, {});
        }
    }

    updateUI(blockData, marketData, mempoolData) {
        // Update overview information
        document.getElementById('block-height').textContent = blockData.height?.toLocaleString() || '800,000';
        document.getElementById('hash-rate').textContent = '450 EH/s';
        document.getElementById('total-tx').textContent = blockData.tx_count?.toLocaleString() || '2,847';
        document.getElementById('price').textContent = marketData?.usd ? `$${marketData.usd.toLocaleString()}` : '$43,250';
        
        // Update stats information
        document.getElementById('difficulty').textContent = '67.96 T';
        document.getElementById('mempool').textContent = '12,847 tx';
        document.getElementById('change').textContent = marketData?.usd_24h_change ? 
            `${marketData.usd_24h_change > 0 ? '+' : ''}${marketData.usd_24h_change.toFixed(1)}%` : '+2.4%';
        document.getElementById('market-cap').textContent = marketData?.usd_market_cap ? 
            `$${(marketData.usd_market_cap / 1e9).toFixed(1)}B` : '$845B';
        
        // Update colors based on market change
        const changeElement = document.getElementById('change');
        if (marketData?.usd_24h_change) {
            changeElement.style.color = marketData.usd_24h_change >= 0 ? '#00ff00' : '#ff0000';
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Rotate scene
        if (this.isRotating) {
            this.scene.rotation.y += 0.001;
        }
        
        // Animate orbiting blocks
        this.blocks.forEach((block) => {
            const data = block.userData;
            data.angle += data.speed * 0.01;
            
            block.position.x = Math.cos(data.angle) * data.radius;
            block.position.z = Math.sin(data.angle) * data.radius;
            block.rotation.y += 0.02;
        });
        
        // Animate transaction particles
        this.transactions.forEach((particle) => {
            particle.position.add(particle.userData.velocity);
            
            // Bounce off boundaries
            if (Math.abs(particle.position.x) > 10) {
                particle.userData.velocity.x *= -1;
            }
            if (Math.abs(particle.position.y) > 10) {
                particle.userData.velocity.y *= -1;
            }
            if (Math.abs(particle.position.z) > 10) {
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

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BitcoinHomeExplorer();
}); 