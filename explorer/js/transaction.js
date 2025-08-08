// Bitcoin Explorer - Transaction Page
class BitcoinTransactionExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.transactions = [];
        this.flows = [];
        this.isRotating = true;
        this.showFlow = true;
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupControls();
        this.createScene();
        this.animate();
        this.fetchData();
        
        setInterval(() => this.fetchData(), 30000);
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
            this.camera.position.z = Math.max(5, Math.min(100, this.camera.position.z));
        });
        
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 10, 20);
            this.camera.lookAt(0, 0, 0);
        });
        
        document.getElementById('toggle-flow').addEventListener('click', () => {
            this.showFlow = !this.showFlow;
            const button = document.getElementById('toggle-flow');
            button.textContent = this.showFlow ? 'Hide Flow' : 'Show Flow';
            
            this.flows.forEach(flow => {
                flow.visible = this.showFlow;
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
        
        const gridHelper = new THREE.GridHelper(100, 100, 0x333333, 0x222222);
        this.scene.add(gridHelper);
        
        this.createTransactionVisualization();
    }

    createTransactionVisualization() {
        // Create transaction flow paths
        for (let i = 0; i < 20; i++) {
            const startPoint = new THREE.Vector3(
                (Math.random() - 0.5) * 30,
                Math.random() * 10,
                (Math.random() - 0.5) * 30
            );
            
            const endPoint = new THREE.Vector3(
                (Math.random() - 0.5) * 30,
                Math.random() * 10,
                (Math.random() - 0.5) * 30
            );
            
            // Create curved path
            const curve = new THREE.CubicBezierCurve3(
                startPoint,
                new THREE.Vector3(
                    (startPoint.x + endPoint.x) / 2 + (Math.random() - 0.5) * 10,
                    Math.max(startPoint.y, endPoint.y) + 5,
                    (startPoint.z + endPoint.z) / 2 + (Math.random() - 0.5) * 10
                ),
                new THREE.Vector3(
                    (startPoint.x + endPoint.x) / 2 + (Math.random() - 0.5) * 10,
                    Math.max(startPoint.y, endPoint.y) + 5,
                    (startPoint.z + endPoint.z) / 2 + (Math.random() - 0.5) * 10
                ),
                endPoint
            );
            
            const points = curve.getPoints(50);
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.6
            });
            
            const line = new THREE.Line(geometry, material);
            this.scene.add(line);
            this.flows.push(line);
            
            // Create transaction particles along the path
            for (let j = 0; j < 5; j++) {
                const t = j / 5;
                const point = curve.getPoint(t);
                
                const geometry = new THREE.SphereGeometry(0.1, 8, 8);
                const material = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0.8
                });
                
                const particle = new THREE.Mesh(geometry, material);
                particle.position.copy(point);
                particle.userData = { pathIndex: i, progress: t, speed: 0.5 + Math.random() * 0.5 };
                
                this.scene.add(particle);
                this.transactions.push(particle);
            }
        }
    }

    async fetchData() {
        try {
            const response = await fetch('https://api.blockcypher.com/v1/btc/main');
            const data = await response.json();
            this.updateUI(data);
        } catch (error) {
            console.error('Error fetching transaction data:', error);
            this.updateUI({});
        }
    }

    updateUI(data) {
        document.getElementById('tx-hash').textContent = 'abc123...def456';
        document.getElementById('tx-amount').textContent = '0.5 BTC';
        document.getElementById('tx-fee').textContent = '0.0001 BTC';
        document.getElementById('tx-status').textContent = 'Confirmed';
        
        document.getElementById('tx-inputs').textContent = '2';
        document.getElementById('tx-outputs').textContent = '3';
        document.getElementById('tx-size').textContent = '250 bytes';
        document.getElementById('tx-confirmations').textContent = '6';
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        if (this.isRotating) {
            this.scene.rotation.y += 0.0005;
        }
        
        // Animate transaction particles along their paths
        this.transactions.forEach((particle) => {
            const data = particle.userData;
            data.progress += data.speed * 0.01;
            
            if (data.progress > 1) {
                data.progress = 0;
            }
            
            // Get the corresponding flow path
            const flow = this.flows[data.pathIndex];
            if (flow && flow.geometry.attributes.position) {
                const positions = flow.geometry.attributes.position.array;
                const pointIndex = Math.floor(data.progress * (positions.length / 3 - 1));
                
                if (pointIndex < positions.length / 3) {
                    particle.position.set(
                        positions[pointIndex * 3],
                        positions[pointIndex * 3 + 1],
                        positions[pointIndex * 3 + 2]
                    );
                }
            }
        });
        
        // Animate flow lines
        this.flows.forEach((flow, index) => {
            const material = flow.material;
            const time = Date.now() * 0.001 + index;
            material.opacity = Math.sin(time) * 0.3 + 0.3;
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
    new BitcoinTransactionExplorer();
}); 