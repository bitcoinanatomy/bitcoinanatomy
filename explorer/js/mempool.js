// Bitcoin Explorer - Mempool Page
class BitcoinMempoolExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.transactions = [];
        this.isRotating = true;
        this.isPerspective = true;
        this.mempoolData = null;
        this.feeBandLabelsVisible = true;
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupOrbitControls();
        this.setupControls();
        this.setupPanelToggle();
        this.createScene();
        this.animate();
        this.fetchData();
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
        this.camera.position.set(0, 50, 100);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupOrbitControls() {
        // Create custom orbit controls
        this.controls = {
            target: new THREE.Vector3(0, 0, 0),
            distance: 100,
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
        this.setupHoverTooltip();
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
            
            if (this.isPerspective) {
                // Perspective zoom: adjust distance
            controls.distance += e.deltaY * 0.1; // Inverted: was -=, now +=
            controls.distance = Math.max(20, Math.min(200, controls.distance));
            controls.update();
            } else {
                // Orthographic zoom: adjust camera zoom level
                const zoomSpeed = 0.1;
                this.orthographicZoom = this.orthographicZoom || 1;
                this.orthographicZoom += e.deltaY * zoomSpeed * 0.01; // Inverted and scaled
                this.orthographicZoom = Math.max(0.1, Math.min(5, this.orthographicZoom));
                
                this.camera.zoom = this.orthographicZoom;
                this.camera.updateProjectionMatrix();
            }
        });
    }

    setupControls() {
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            const button = document.getElementById('toggle-rotation');
            button.textContent = this.isRotating ? 'Pause Rotation' : 'Start Rotation';
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.camera.position.set(0, 50, 100);
            this.controls.target.set(0, 0, 0);
            this.controls.distance = 100;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.update();
        });
        
        document.getElementById('toggle-view').addEventListener('click', () => {
            this.toggleCameraView();
        });
        
        document.getElementById('toggle-fee-labels').addEventListener('click', () => {
            this.toggleFeeBandLabels();
        });
    }
    
    toggleCameraView() {
        this.isPerspective = !this.isPerspective;
        
        if (this.isPerspective) {
            this.camera = new THREE.PerspectiveCamera(
                75,
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
        } else {
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = 50;
            this.camera = new THREE.OrthographicCamera(
                frustumSize * aspect / -2,
                frustumSize * aspect / 2,
                frustumSize / 2,
                frustumSize / -2,
                0.1,
                1000
            );
            
            // Apply saved orthographic zoom
            this.orthographicZoom = this.orthographicZoom || 1;
            this.camera.zoom = this.orthographicZoom;
            this.camera.updateProjectionMatrix();
        }
        
        this.camera.position.copy(this.controls.target.clone().add(new THREE.Vector3(0, 50, 100)));
        this.camera.lookAt(this.controls.target);
        
        const button = document.getElementById('toggle-view');
        button.textContent = this.isPerspective ? 'Switch to Orthographic' : 'Switch to Perspective';
    }
    
    toggleFeeBandLabels() {
        if (!this.feeBandLabels) return;
        
        this.feeBandLabelsVisible = !this.feeBandLabelsVisible;
        
        this.feeBandLabels.forEach(label => {
            label.element.style.display = this.feeBandLabelsVisible ? 'block' : 'none';
        });
        
        const button = document.getElementById('toggle-fee-labels');
        button.textContent = this.feeBandLabelsVisible ? 'Hide Fee Labels' : 'Show Fee Labels';
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
                
                // Format the tooltip content
                const tooltipContent = `
                    <strong>Transaction ${txData.index}</strong><br>
                    Fee Rate: ${txData.feeRate} sat/vB<br>
                    Size: ${txData.size} vB (dummy)
                `;
                
                tooltip.innerHTML = tooltipContent;
                tooltip.style.display = 'block';
                tooltip.style.left = event.clientX + 10 + 'px';
                tooltip.style.top = event.clientY - 10 + 'px';
                
                // Update transaction details panel
                this.updateTransactionDetails(txData);
            } else {
                tooltip.style.display = 'none';
                this.updateTransactionDetails(null);
            }
        });

        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            this.updateTransactionDetails(null);
        });
    }

    createScene() {
        // Lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
        
        // Add fill lights
        const fillLight1 = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight1.position.set(-10, 5, 10);
        this.scene.add(fillLight1);
        
        const fillLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight2.position.set(10, -5, -10);
        this.scene.add(fillLight2);
    }

    async fetchData() {
        this.showLoadingModal('Loading mempool data...');
        
        try {
            this.updateLoadingProgress('Fetching transaction data...', 30);
            const response = await fetch('https://mempool.space/api/mempool');
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.updateLoadingProgress('Processing transactions...', 60);
            const data = await response.json();
            this.mempoolData = data;
            
            this.updateLoadingProgress('Creating visualization...', 80);
            this.createMempoolVisualization(data);
            this.updateUI(data);
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching mempool data:', error);
            this.showGenericError('Mempool data');
        }
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

    createMempoolVisualization(data) {
        if (!data || !data.fee_histogram) return;
        
        // Clear existing transactions
        this.transactions.forEach(tx => this.scene.remove(tx));
        this.transactions = [];
        
        // Remove existing remaining text element
        if (this.remainingTextElement) {
            this.remainingTextElement.remove();
            this.remainingTextElement = null;
        }
        
        // Remove existing fee band labels
        if (this.feeBandLabels) {
            this.feeBandLabels.forEach(label => label.element.remove());
            this.feeBandLabels = [];
        }
        
        const feeHistogram = data.fee_histogram;
        let totalTransactions = 0;
        let currentIndex = 0;
        
        // Calculate total transactions and create a representative sample
        const transactionObjects = [];
        const maxTransactions = 21000;
        
        // Calculate scaling factor to represent the entire mempool proportionally
        let cumulativeCount = 0;
        feeHistogram.forEach(([feeRate, count]) => {
            cumulativeCount += count;
        });
        
        const scaleFactor = Math.min(1, maxTransactions / cumulativeCount);
        
        // Create proportional representation of each fee band
        totalTransactions = 0;
        feeHistogram.forEach(([feeRate, count]) => {
            const scaledCount = Math.max(1, Math.floor(count * scaleFactor));
            for (let i = 0; i < scaledCount; i++) {
                transactionObjects.push({
                    feeRate: feeRate,
                    size: Math.floor(Math.random() * 1000) + 100, // Random size between 100-1100 vB
                    index: totalTransactions + i,
                    position: totalTransactions + i,
                    originalCount: count // Store original count for tooltip
                });
            }
            totalTransactions += scaledCount;
        });
        
        // No need to sort since fee_histogram is already ordered by fee rate (highest first)
        const selectedTransactions = transactionObjects;
        
        console.log(`Creating ${selectedTransactions.length} transaction cuboids`);
        
        // Create spiral layout similar to difficulty.js
        const RADIUS_SPIRAL_START = 12; // Even more starting radius
        const FACTOR_SPIRAL_GROWTH = 0.3; // Even more growth factor for more spacing
        const FACTOR_BLOCK_DISTANCE = 0.5;
        const CUBOID_WIDTH = 0.07; // Width (30% smaller)
        const CUBOID_HEIGHT = 0.14; // Height (30% smaller)
        const CUBOID_LENGTH = 0.56; // Length (30% smaller)
        const MIN_BRIGHTNESS = 20;
        const MAX_BRIGHTNESS_SIZE = 5000;
        
        // Track fee bands for tooltips
        const feeBands = [];
        let currentFeeBand = null;
        let bandStartIndex = 0;
        
        selectedTransactions.forEach((tx, index) => {
            // Track fee bands
            if (!currentFeeBand || currentFeeBand.feeRate !== tx.feeRate) {
                if (currentFeeBand) {
                    currentFeeBand.endIndex = index - 1;
                    feeBands.push(currentFeeBand);
                }
                currentFeeBand = {
                    feeRate: tx.feeRate,
                    startIndex: index,
                    count: 0
                };
                bandStartIndex = index;
            }
            currentFeeBand.count++;
            
            // Calculate spiral position with absolutely constant distance
            const targetDistance = 0.3; // Target distance between transactions
            
            // Calculate cumulative arc length to maintain constant distance
            let cumulativeArcLength = 0;
            let phi_spiral = 0;
            
            for (let i = 0; i < index; i++) {
                const currentRadius = RADIUS_SPIRAL_START + FACTOR_SPIRAL_GROWTH * phi_spiral;
                const angularStep = targetDistance / currentRadius;
                phi_spiral += angularStep;
                cumulativeArcLength += targetDistance;
            }
            
            const radius_spiral = RADIUS_SPIRAL_START + FACTOR_SPIRAL_GROWTH * phi_spiral;
            
            // Calculate position
            const x = radius_spiral * Math.sin(phi_spiral);
            const z = radius_spiral * Math.cos(phi_spiral);
            const y = 0; // Keep at ground level
            
            // Create cuboid geometry with height based on transaction size
            const minHeight = CUBOID_HEIGHT * 0.3;
            const maxHeight = CUBOID_HEIGHT * 3;
            const normalizedSize = Math.min(tx.size, 2000) / 2000; // Normalize size (cap at 2000 vB)
            const sizeBasedHeight = minHeight + (maxHeight - minHeight) * normalizedSize;
            const geometry = new THREE.BoxGeometry(CUBOID_LENGTH, sizeBasedHeight, CUBOID_WIDTH);
            
            // Calculate opacity for fade-out effect on last 40 transactions
            const fadeStartIndex = selectedTransactions.length - 40;
            let opacity = 0.8; // Default opacity
            
            if (index >= fadeStartIndex) {
                const fadeProgress = (index - fadeStartIndex) / 40;
                opacity = 0.8 * (1 - fadeProgress); // Fade from 0.8 to 0
            }
            
            const material = new THREE.MeshBasicMaterial({
                color: this.getTransactionGrayColor(tx.feeRate),
                transparent: true,
                opacity: opacity
            });
            
            const cuboid = new THREE.Mesh(geometry, material);
            // Position cuboid so it grows downward from ground level
            cuboid.position.set(x, y - sizeBasedHeight / 2, z);
            cuboid.rotation.y = phi_spiral + Math.PI / 2;
            
            cuboid.userData = {
                ...tx,
                feeRate: tx.feeRate,
                size: tx.size,
                index: tx.index,
                position: tx.position,
                opacity: opacity
            };
            
            this.scene.add(cuboid);
            this.transactions.push(cuboid);
        });
        
        // Add the last fee band
        if (currentFeeBand) {
            currentFeeBand.endIndex = selectedTransactions.length - 1;
            feeBands.push(currentFeeBand);
        }
        
        console.log(`Created ${this.transactions.length} transaction cuboids`);
        console.log(`Fee bands:`, feeBands);
        
        // Add fee band labels at strategic positions
        this.addFeeBandLabels(feeBands, selectedTransactions);
        
        // Add text showing remaining transactions
        this.addRemainingTransactionsText(selectedTransactions.length, cumulativeCount);
    }
    
    addFeeBandLabels(feeBands, transactions) {
        // Create labels for major fee bands (show fewer bands - every ~10th band or very significant ones)
        const majorBands = feeBands.filter((band, index) => {
            return index % 10 === 0 || band.count > 200 || index === 0 || index === feeBands.length - 1;
        });
        
        majorBands.forEach((band, labelIndex) => {
            // Get the position of a transaction in the middle of this band
            const middleIndex = Math.floor((band.startIndex + band.endIndex) / 2);
            if (middleIndex >= transactions.length) return;
            
            const middleTx = transactions[middleIndex];
            
            // Create fee band label similar to remaining transactions text
            const labelContainer = document.createElement('div');
            labelContainer.style.position = 'absolute';
            labelContainer.style.color = 'white';
            labelContainer.style.fontSize = '12px';
            labelContainer.style.fontWeight = 'bold';
            labelContainer.style.fontFamily = 'monospace';
            labelContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            labelContainer.style.padding = '4px 8px';
            labelContainer.style.borderRadius = '4px';
            labelContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
            labelContainer.style.zIndex = '1000';
            labelContainer.style.pointerEvents = 'none';
            labelContainer.style.display = 'block';
            labelContainer.style.whiteSpace = 'nowrap';
            
            // Get original count from the transaction data
            const originalCount = middleTx.originalCount || band.count;
            labelContainer.textContent = `${band.feeRate} sat/vB (${originalCount.toLocaleString()})`;
            labelContainer.title = `Fee Band: ${band.feeRate} sat/vB with ${originalCount.toLocaleString()} transactions`;
            
            document.body.appendChild(labelContainer);
            
            // Store reference for cleanup and position updates
            if (!this.feeBandLabels) {
                this.feeBandLabels = [];
            }
            this.feeBandLabels.push({
                element: labelContainer,
                transactionIndex: middleIndex,
                band: band
            });
        });
        
        console.log(`Added ${majorBands.length} fee band labels`);
    }
    
    addRemainingTransactionsText(shownCount, totalCount) {
        const remainingCount = totalCount - shownCount;
        
        // Create a simple text using CSS overlay instead of 3D text for better performance
        const textContainer = document.createElement('div');
        textContainer.style.position = 'absolute';
        textContainer.style.color = 'white';
        textContainer.style.fontSize = '14px';
        textContainer.style.fontWeight = 'bold';
        textContainer.style.fontFamily = 'monospace';
        textContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        textContainer.style.padding = '6px 10px';
        textContainer.style.borderRadius = '4px';
        textContainer.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        textContainer.style.zIndex = '1000';
        textContainer.style.pointerEvents = 'none';
        textContainer.style.display = 'block';
        
        textContainer.textContent = `+${remainingCount.toLocaleString()}`;
        textContainer.title = `Showing ${shownCount.toLocaleString()} of ${totalCount.toLocaleString()} transactions`;
        
        // Start with a fixed position that's visible
        textContainer.style.left = '80%';
        textContainer.style.top = '20%';
        
        document.body.appendChild(textContainer);
        
        // Store reference for cleanup
        this.remainingTextElement = textContainer;
        
        console.log(`Added remaining text: +${remainingCount.toLocaleString()} (${shownCount} of ${totalCount})`);
    }
    
    getTransactionGrayColor(feeRate) {
        // Gray tones based on fee rate - higher fees = lighter grays
        if (feeRate >= 10) return 0xffffff; // White for very high fees
        if (feeRate >= 5) return 0xcccccc; // Light gray for high fees
        if (feeRate >= 2) return 0x999999; // Medium gray for medium fees
        if (feeRate >= 1) return 0x666666; // Dark gray for low fees
        return 0x333333; // Very dark gray for very low fees
    }

    updateTransactionDetails(txData) {
        if (txData) {
            document.getElementById('selected-tx').textContent = txData.index;
            document.getElementById('tx-fee-rate').textContent = `${txData.feeRate.toFixed(2)} sat/vB`;
            document.getElementById('tx-size').textContent = `${txData.size} vB (dummy)`;
            document.getElementById('tx-position').textContent = txData.position;
        } else {
            document.getElementById('selected-tx').textContent = 'None';
            document.getElementById('tx-fee-rate').textContent = '-';
            document.getElementById('tx-size').textContent = '-';
            document.getElementById('tx-position').textContent = '-';
        }
    }

    updateUI() {
        if (!this.mempoolData) {
            document.getElementById('total-transactions').textContent = 'Loading...';
            document.getElementById('total-size').textContent = 'Loading...';
            document.getElementById('total-fees').textContent = 'Loading...';
            document.getElementById('average-fee').textContent = 'Loading...';
            document.getElementById('fee-range').textContent = 'Loading...';
            document.getElementById('mempool-status').textContent = 'Loading...';
            return;
        }
        
        // Calculate statistics
        const totalTx = this.mempoolData.count;
        const totalSize = this.mempoolData.vsize;
        const totalFees = this.mempoolData.total_fee;
        const averageFee = totalFees / totalTx;
        
        // Get fee range
        const feeHistogram = this.mempoolData.fee_histogram;
        const minFee = feeHistogram[feeHistogram.length - 1][0];
        const maxFee = feeHistogram[0][0];
        
        // Update UI
        document.getElementById('total-transactions').textContent = totalTx.toLocaleString();
        document.getElementById('total-size').textContent = `${(totalSize / 1000000).toFixed(2)} MB`;
        document.getElementById('total-fees').textContent = `${(totalFees / 100000000).toFixed(2)} BTC`;
        document.getElementById('average-fee').textContent = `${averageFee.toFixed(2)} sat/vB`;
        document.getElementById('fee-range').textContent = `${minFee.toFixed(2)} - ${maxFee.toFixed(2)} sat/vB`;
        // Update subtitle with transaction count and total fees
        const subtitle = `${totalTx.toLocaleString()} transactions • ${(totalFees / 100000000).toFixed(2)} BTC total fees`;
        document.getElementById('mempool-subtitle').textContent = subtitle;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Rotate scene (optional, can be disabled)
        if (this.isRotating) {
            this.scene.rotation.y += 0.001; // Faster rotation
        }
        
        // Update remaining text position
        this.updateRemainingTextPosition();
        
        // Update fee band label positions
        this.updateFeeBandLabelPositions();
        
        this.renderer.render(this.scene, this.camera);
    }
    
    updateRemainingTextPosition() {
        if (!this.remainingTextElement || this.transactions.length === 0) return;
        
        // Get the last transaction position
        const lastTransaction = this.transactions[this.transactions.length - 1];
        const worldPosition = new THREE.Vector3();
        lastTransaction.getWorldPosition(worldPosition);
        
        // Convert 3D position to screen coordinates
        const vector = worldPosition.clone();
        vector.project(this.camera);
        
        const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
        
        // Check if the tracking point is on screen
        const isOnScreen = vector.z < 1 && x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
        
        if (isOnScreen) {
            // Ensure position is within viewport bounds
            const maxX = window.innerWidth - 100; // Account for smaller text width
            const maxY = window.innerHeight - 30; // Account for smaller text height
            
            const clampedX = Math.max(10, Math.min(maxX, x + 20));
            const clampedY = Math.max(10, Math.min(maxY, y - 20));
            
            // Update text position and show
            this.remainingTextElement.style.left = `${clampedX}px`;
            this.remainingTextElement.style.top = `${clampedY}px`;
            this.remainingTextElement.style.display = 'block';
        } else {
            // Hide text when tracking point is off screen
            this.remainingTextElement.style.display = 'none';
        }
    }
    
    updateFeeBandLabelPositions() {
        if (!this.feeBandLabels || this.transactions.length === 0 || !this.feeBandLabelsVisible) return;
        
        this.feeBandLabels.forEach(label => {
            if (label.transactionIndex >= this.transactions.length) return;
            
            const transaction = this.transactions[label.transactionIndex];
            const worldPosition = new THREE.Vector3();
            transaction.getWorldPosition(worldPosition);
            
            // Convert 3D position to screen coordinates
            const vector = worldPosition.clone();
            vector.project(this.camera);
            
            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
            
            // Check if the tracking point is on screen
            const isOnScreen = vector.z < 1 && x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
            
            if (isOnScreen) {
                // Ensure position is within viewport bounds
                const maxX = window.innerWidth - 150; // Account for label width
                const maxY = window.innerHeight - 30; // Account for label height
                
                const clampedX = Math.max(10, Math.min(maxX, x + 15));
                const clampedY = Math.max(10, Math.min(maxY, y - 15));
                
                // Update label position and show
                label.element.style.left = `${clampedX}px`;
                label.element.style.top = `${clampedY}px`;
                label.element.style.display = 'block';
            } else {
                // Hide label when tracking point is off screen
                label.element.style.display = 'none';
            }
        });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('mempool-stats');
        
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

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded!');
        document.getElementById('scene').innerHTML = '<div style="color: white; padding: 20px;">Error: Three.js failed to load. Please refresh the page.</div>';
        return;
    }
    
    console.log('Three.js loaded successfully:', THREE.REVISION);
    new BitcoinMempoolExplorer();
}); 