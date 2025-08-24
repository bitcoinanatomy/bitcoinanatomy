// Bitcoin Explorer - Address Page
class BitcoinAddressExplorer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isRotating = true;
        this.isPerspective = true;
        this.orthographicZoom = 30;
        this.controls = {
            distance: 30,
            phi: Math.PI / 4,
            theta: 0,
            target: new THREE.Vector3(0, 0, 0),
            isMouseDown: false,
            lastMouseX: 0,
            lastMouseY: 0
        };
        this.addressData = null;
        this.address = null;
        this.displayedTransactionCount = 0; // Track how many transactions are currently displayed
        this.noMoreTransactions = false; // Track if we've reached the end of available transactions
        
        // Get address from URL parameter, default to 1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv if none provided
        const urlParams = new URLSearchParams(window.location.search);
        this.address = urlParams.get('address') || '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv';
        
        this.init();
    }

    formatDate(date) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();
        const time = date.toTimeString().split(' ')[0]; // Gets HH:MM:SS
        return `${month} ${day}, ${year}, ${time}`;
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
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.updateCameraPosition();
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupMouseControls() {
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
            this.controls.isMouseDown = true;
            this.controls.lastMouseX = e.clientX;
            this.controls.lastMouseY = e.clientY;
            
            // Stop automatic rotation when user starts interacting
            this.isRotating = false;
            const button = document.getElementById('toggle-rotation');
            if (button) {
                button.textContent = 'Start Rotation';
            }
        });
        
        this.renderer.domElement.addEventListener('mouseup', () => {
            this.controls.isMouseDown = false;
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
                        dateStr = this.formatDate(date);
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
            if (this.controls.isMouseDown) {
                const deltaX = e.clientX - this.controls.lastMouseX;
                const deltaY = e.clientY - this.controls.lastMouseY;
                
                if (e.shiftKey) {
                    // Panning with inverted axes and reduced intensity
                    const panSpeed = 0.001;
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    
                    this.camera.getWorldDirection(new THREE.Vector3());
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    
                    const panX = deltaX * panSpeed * this.controls.distance;
                    const panY = deltaY * panSpeed * this.controls.distance;
                    
                    this.controls.target.add(right.multiplyScalar(panX));
                    this.controls.target.add(up.multiplyScalar(panY));
                } else {
                    // Rotation with inverted axes and reduced intensity
                    this.controls.theta += deltaX * 0.005;
                    this.controls.phi -= deltaY * 0.005;
                    this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
                }
                
                this.updateCameraPosition();
                this.controls.lastMouseX = e.clientX;
                this.controls.lastMouseY = e.clientY;
            }
        });
        
        this.renderer.domElement.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
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
                this.controls.distance += e.deltaY * 0.1;
                this.controls.distance = Math.max(1, Math.min(200, this.controls.distance));
                this.updateCameraPosition();
            } else {
                // Orthographic camera zoom
                const zoomSpeed = 0.1;
                this.orthographicZoom -= e.deltaY * zoomSpeed;
                this.orthographicZoom = Math.max(5, Math.min(200, this.orthographicZoom));
                
                const aspect = window.innerWidth / window.innerHeight;
                this.camera.left = -this.orthographicZoom * aspect / 2;
                this.camera.right = this.orthographicZoom * aspect / 2;
                this.camera.top = this.orthographicZoom / 2;
                this.camera.bottom = -this.orthographicZoom / 2;
                this.camera.updateProjectionMatrix();
            }
        });

        // Add touch controls for mobile
        this.setupTouchControls();
        
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
        
        const toggleViewButton = document.getElementById('toggle-view');
        if (toggleViewButton) {
            toggleViewButton.addEventListener('click', () => {
                this.toggleCameraView();
            });
        }
        
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
        
        // Load more transactions button
        document.getElementById('load-more-transactions').addEventListener('click', () => {
            this.loadMoreTransactions();
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
            x + this.controls.target.x,
            y + this.controls.target.y,
            z + this.controls.target.z
        );
            
        this.camera.lookAt(this.controls.target);
    }

    setupTouchControls() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartDistance = 0;
        let isPinching = false;
        let lastTouchTime = 0;
        let touchCount = 0;

        // Touch start
        this.renderer.domElement.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            this.isRotating = false;
            const button = document.getElementById('toggle-rotation');
            if (button) {
                button.textContent = 'Start Rotation';
            }

            if (e.touches.length === 1) {
                // Single touch - rotation/panning
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                this.controls.isMouseDown = true;
                this.controls.lastMouseX = touchStartX;
                this.controls.lastMouseY = touchStartY;
            } else if (e.touches.length === 2) {
                // Two finger touch - pinch to zoom
                isPinching = true;
                touchStartDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }

            // Double tap detection
            const currentTime = new Date().getTime();
            const timeDiff = currentTime - lastTouchTime;
            if (timeDiff < 300 && timeDiff > 0) {
                // Double tap - reset camera
                this.controls.distance = 50;
                this.controls.phi = Math.PI / 3;
                this.controls.theta = 0;
                this.controls.target.set(0, 0, 0);
                this.updateCameraPosition();
            }
            lastTouchTime = currentTime;
        });

        // Touch move
        this.renderer.domElement.addEventListener('touchmove', (e) => {
            e.preventDefault();

            if (e.touches.length === 1 && !isPinching) {
                // Single finger drag - rotation/panning
                const touchX = e.touches[0].clientX;
                const touchY = e.touches[0].clientY;
                
                const deltaX = touchX - this.controls.lastMouseX;
                const deltaY = touchY - this.controls.lastMouseY;

                // Use larger sensitivity for mobile
                const sensitivity = 0.02;
                
                if (e.shiftKey || e.altKey) {
                    // Panning
                    const panSpeed = 0.002;
                    const right = new THREE.Vector3();
                    const up = new THREE.Vector3();
                    
                    this.camera.getWorldDirection(new THREE.Vector3());
                    right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
                    up.setFromMatrixColumn(this.camera.matrix, 1);
                    
                    const panX = deltaX * panSpeed * this.controls.distance;
                    const panY = deltaY * panSpeed * this.controls.distance;
                    
                    this.controls.target.add(right.multiplyScalar(panX));
                    this.controls.target.add(up.multiplyScalar(panY));
                } else {
                    // Rotation
                    this.controls.theta += deltaX * sensitivity;
                    this.controls.phi -= deltaY * sensitivity;
                    this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
                }
                
                this.updateCameraPosition();
                this.controls.lastMouseX = touchX;
                this.controls.lastMouseY = touchY;
            } else if (e.touches.length === 2 && isPinching) {
                // Pinch to zoom
                const currentDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                
                const zoomFactor = touchStartDistance / currentDistance;
                
                if (this.isPerspective) {
                    this.controls.distance *= zoomFactor;
                    this.controls.distance = Math.max(1, Math.min(200, this.controls.distance));
                    this.updateCameraPosition();
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(5, Math.min(200, this.orthographicZoom));
                    
                    const aspect = window.innerWidth / window.innerHeight;
                    this.camera.left = -this.orthographicZoom * aspect / 2;
                    this.camera.right = this.orthographicZoom * aspect / 2;
                    this.camera.top = this.orthographicZoom / 2;
                    this.camera.bottom = -this.orthographicZoom / 2;
                    this.camera.updateProjectionMatrix();
                }
                
                touchStartDistance = currentDistance;
            }
        });

        // Touch end
        this.renderer.domElement.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 0) {
                this.controls.isMouseDown = false;
                isPinching = false;
            } else if (e.touches.length === 1) {
                // Switch from pinch to single touch
                isPinching = false;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                this.controls.lastMouseX = touchStartX;
                this.controls.lastMouseY = touchStartY;
            }
        });

        // Prevent default touch behaviors
        this.renderer.domElement.addEventListener('touchcancel', (e) => {
            e.preventDefault();
        });
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

    async fetchTransactionPage(lastSeenTxid = null) {
        console.log('=== FETCHING TRANSACTION PAGE ===');
        console.log('Last seen txid:', lastSeenTxid ? lastSeenTxid.substring(0, 16) + '...' : 'none (first page)');
        
        try {
            let url;
            if (!lastSeenTxid) {
                // First page: get mempool + first confirmed transactions
                url = `https://mempool.space/api/address/${this.address}/txs`;
            } else {
                // Subsequent pages: get only confirmed transactions
                url = `https://mempool.space/api/address/${this.address}/txs/chain/${lastSeenTxid}`;
            }
            
            console.log('Fetching:', url);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`Failed to fetch transactions:`, response.status);
                return [];
            }
            
            const transactions = await response.json();
            console.log(`Fetched ${transactions.length} transactions`);
            
            return transactions;
            
        } catch (error) {
            console.error('Error fetching transaction page:', error);
            return [];
        }
    }

    async fetchAllTransactions() {
        const allTransactions = [];
        let lastSeenTxid = null;
        let hasMore = true;
        let pageCount = 0;
        const maxPages = 50; // Safety limit to prevent infinite loops
        
        console.log('=== FETCHING ALL TRANSACTIONS ===');
        
        while (hasMore && pageCount < maxPages) {
            try {
                let url;
                if (pageCount === 0) {
                    // First page: get mempool + first confirmed transactions
                    url = `https://mempool.space/api/address/${this.address}/txs`;
                } else {
                    // Subsequent pages: get only confirmed transactions
                    url = `https://mempool.space/api/address/${this.address}/txs/chain/${lastSeenTxid}`;
                }
                
                console.log(`Fetching page ${pageCount + 1}:`, url);
                
                const response = await fetch(url);
                
                if (!response.ok) {
                    console.warn(`Failed to fetch transactions page ${pageCount + 1}:`, response.status);
                    if (pageCount === 1) {
                        // If pagination to /txs/chain fails, we only have the initial /txs response
                        console.log('Chain pagination failed, using only initial transactions');
                        this.fetchedAllTransactions = false;
                    }
                    break;
                }
                
                const transactions = await response.json();
                console.log(`Page ${pageCount + 1} returned ${transactions.length} transactions`);
                
                if (transactions.length === 0) {
                    hasMore = false;
                    break;
                }
                
                allTransactions.push(...transactions);
                
                // Handle different page sizes based on endpoint
                if (pageCount === 0) {
                    // First page: up to 50 mempool + 25 confirmed = 75 max
                    // If we get less than 25, there are no more confirmed transactions
                    if (transactions.length < 25) {
                        hasMore = false;
                        console.log('No more confirmed transactions available');
                    } else {
                        // Set the last seen txid for chain pagination
                        lastSeenTxid = transactions[transactions.length - 1].txid;
                    }
                } else {
                    // Subsequent pages from /txs/chain: 25 transactions per page
                    if (transactions.length < 25) {
                        hasMore = false;
                        console.log('Reached end of confirmed transaction history');
                    } else {
                        // Set the last seen txid for next page
                        lastSeenTxid = transactions[transactions.length - 1].txid;
                    }
                }
                
                pageCount++;
                
                // Add a small delay to be respectful to the API
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Error fetching transactions page ${pageCount + 1}:`, error);
                break;
            }
        }
        
        console.log(`=== TRANSACTION FETCH COMPLETE ===`);
        console.log(`Total pages fetched: ${pageCount}`);
        console.log(`Total transactions: ${allTransactions.length}`);
        
        if (pageCount >= maxPages) {
            console.warn(`Reached maximum page limit (${maxPages}). Some transactions may be missing.`);
        }
        
        // Store whether we fetched all available transactions
        this.fetchedAllTransactions = (pageCount < maxPages && allTransactions.length > 0);
        console.log(`Fetched all available transactions: ${this.fetchedAllTransactions}`);
        
        return allTransactions;
    }

    async fetchData() {
        this.showLoadingModal('Loading address data...');
        
        try {
            if (!this.address) {
                console.error('No address provided in URL');
                this.hideLoadingModal();
                this.updateUI({});
                return;
            }

            this.updateLoadingProgress('Fetching address data...', 20);
            
            // Fetch address data from Mempool.space
            const response = await fetch(`https://mempool.space/api/address/${this.address}`);
            
            if (response.status === 429) {
                this.hideLoadingModal();
                this.showRateLimitError('Mempool.space API');
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.addressData = await response.json();
            
            console.log('=== ADDRESS DATA ===');
            console.log('Address:', this.address);
            console.log('Full address object:', this.addressData);
            console.log('Chain stats:', this.addressData.chain_stats);
            console.log('Mempool stats:', this.addressData.mempool_stats);
            
            this.updateLoadingProgress('Fetching transaction history...', 50);
            
            // Fetch first page of transaction history only
            this.transactionHistory = await this.fetchTransactionPage();
            console.log('=== COMPLETE TRANSACTION HISTORY ===');
            console.log('Total transaction count:', this.transactionHistory.length);
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
            
            this.updateLoadingProgress('Fetching UTXO data...', 70);
            
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
            
            this.updateLoadingProgress('Creating visualization...', 90);
            
            this.updateUI(this.addressData);
            this.createAddressVisualization();
            
            this.updateLoadingProgress('Complete!', 100);
            setTimeout(() => {
                this.hideLoadingModal();
            }, 500);
            
        } catch (error) {
            this.hideLoadingModal();
            console.error('Error fetching address data:', error);
            this.showGenericError('Address data');
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
        console.log('=== CREATING TRANSACTION HISTORY 3D MODEL ===');
        console.log('Total transactions available:', this.transactionHistory.length);
        console.log('Currently displayed transactions:', this.displayedTransactionCount);
        
        // Create transaction history visualization - show first 50 initially
        const txCount = Math.min(this.transactionHistory.length, 50);
        this.displayedTransactionCount = txCount;
        
        console.log('Transactions to display in 3D model:', txCount);
        console.log('Sphere radius:', sphereRadius);
        
        // Calculate line parameters - use consistent spacing
        const baseSpacing = 0.4; // Fixed spacing between transactions
        const offset = sphereRadius + 2; // Fixed offset from sphere
        
        console.log('Line parameters:', {
            baseSpacing,
            offset,
            txCount
        });
        
        for (let i = 0; i < txCount; i++) {
            const tx = this.transactionHistory[i];
            
            console.log(`Adding transaction ${i + 1}/${txCount}:`, {
                txid: tx.txid.substring(0, 16) + '...',
                size: tx.size,
                status: tx.status,
                vout_count: tx.vout ? tx.vout.length : 0
            });
            
            // Calculate transaction size for cuboid dimensions
            const txSize = tx.size || 250;
            const width = 1.5;
            const height = Math.max(0.1, txSize / 1000); // Scale height based on transaction size
            const depth = 0.1;

            // Position transactions in a straight line with consistent spacing
            const x = 0; // X-axis position
            const y = 0; // Align all transactions to the top
            const z = offset + (i * baseSpacing); // Each transaction at fixed interval
            
            console.log(`  Position: x=${x}, y=${y}, z=${z.toFixed(2)}`);
            console.log(`  Dimensions: w=${width}, h=${height.toFixed(3)}, d=${depth}`);
            
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
            
            console.log(`  Successfully added transaction cuboid to scene`);
        }
        
        console.log(`=== TRANSACTION HISTORY 3D MODEL COMPLETE ===`);
        console.log(`Total transaction cuboids added to scene: ${txCount}`);
        console.log(`Scene now has ${this.scene.children.length} total objects`);
        
        // Update button text
        this.updateLoadMoreButton();
    }
    
    async loadMoreTransactions() {
        console.log('=== LOADING MORE TRANSACTIONS ===');
        console.log('Currently have:', this.transactionHistory.length, 'transactions');
        console.log('Currently displayed:', this.displayedTransactionCount);
        
        // Check if we have more fetched transactions to display first
        if (this.displayedTransactionCount < this.transactionHistory.length) {
            console.log('Displaying more from already fetched transactions');
            this.displayMoreTransactions();
            return;
        }
        
        // Need to fetch more transactions from API
        console.log('Fetching more transactions from API');
        const lastTxid = this.transactionHistory[this.transactionHistory.length - 1]?.txid;
        
        if (!lastTxid) {
            console.log('No last txid found, cannot fetch more');
            return;
        }
        
        const newTransactions = await this.fetchTransactionPage(lastTxid);
        
        if (newTransactions.length === 0) {
            console.log('No more transactions available from API');
            this.noMoreTransactions = true;
            this.updateLoadMoreButton();
            return;
        }
        
        // Add new transactions to our array
        this.transactionHistory.push(...newTransactions);
        console.log(`Added ${newTransactions.length} new transactions. Total: ${this.transactionHistory.length}`);
        
        // Display the new transactions
        this.displayMoreTransactions();
    }
    
    displayMoreTransactions() {
        const startIndex = this.displayedTransactionCount;
        const endIndex = Math.min(startIndex + 50, this.transactionHistory.length);
        const newTxCount = endIndex - startIndex;
        
        if (newTxCount === 0) {
            console.log('No more transactions to display');
            return;
        }
        
        console.log(`Displaying transactions ${startIndex + 1} to ${endIndex}`);
        
        // Calculate sphere radius (same as in createAddressRepresentation)
        const totalUtxoValue = this.utxoData ? this.utxoData.reduce((sum, utxo) => sum + utxo.value, 0) : 0;
        const totalUtxoValueBTC = totalUtxoValue / 100000000;
        const baseRadius = 1.5;
        const valueScale = Math.max(0.3, Math.min(2.0, Math.log10(totalUtxoValueBTC + 1) * 0.3));
        const sphereRadius = baseRadius * valueScale;
        
        // Calculate positioning for new transactions - extend existing line
        const baseSpacing = 0.4; // Fixed spacing between transactions
        const offset = sphereRadius + 2; // Fixed offset from sphere
        
        for (let i = 0; i < newTxCount; i++) {
            const txIndex = startIndex + i;
            const tx = this.transactionHistory[txIndex];
            
            console.log(`Adding transaction ${txIndex + 1}/${this.transactionHistory.length}:`, {
                txid: tx.txid.substring(0, 16) + '...',
                size: tx.size,
                status: tx.status,
                vout_count: tx.vout ? tx.vout.length : 0
            });
            
            const txSize = tx.size || 250;
            const width = 1.5;
            const height = Math.max(0.1, txSize / 1000);
            const depth = 0.1;
            
            // Position extending the line - each transaction at a fixed distance from the previous
            const x = 0;
            const y = 0;
            const z = offset + (txIndex * baseSpacing);
            
            console.log(`  Position: x=${x}, y=${y}, z=${z.toFixed(2)}`);
            
            const txGeometry = new THREE.BoxGeometry(width, height, depth);
            const txMaterial = new THREE.MeshLambertMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 0.6
            });
            const txCuboid = new THREE.Mesh(txGeometry, txMaterial);
            txCuboid.position.set(x, y, z);
            
            const totalOutput = tx.vout ? tx.vout.reduce((sum, output) => sum + output.value, 0) : 0;
            
            txCuboid.userData = { 
                type: 'transaction', 
                data: {
                    txid: tx.txid,
                    value: totalOutput,
                    size: txSize,
                    status: tx.status
                }
            };
            this.scene.add(txCuboid);
        }
        
        // Update displayed count
        this.displayedTransactionCount = endIndex;
        console.log(`New total displayed transactions: ${this.displayedTransactionCount}`);
        
        // Update button text
        this.updateLoadMoreButton();
    }
    
    updateLoadMoreButton() {
        const button = document.getElementById('load-more-transactions');
        if (!button) return;
        
        const totalTxCount = this.addressData?.chain_stats?.tx_count || 0;
        const remainingToDisplay = this.transactionHistory.length - this.displayedTransactionCount;
        
        console.log('Button update:', {
            totalFromAPI: totalTxCount,
            totalFetched: this.transactionHistory.length,
            displayed: this.displayedTransactionCount,
            remainingToDisplay: remainingToDisplay,
            noMoreFromAPI: this.noMoreTransactions
        });
        
        if (this.noMoreTransactions && remainingToDisplay <= 0) {
            // No more transactions available from API and none to display
            button.textContent = `All TXs Loaded (${this.displayedTransactionCount})`;
            button.disabled = true;
        } else if (remainingToDisplay > 0) {
            // Have fetched transactions ready to display
            const toDisplay = Math.min(50, remainingToDisplay);
            button.textContent = `Load Next ${toDisplay} TXs`;
            button.disabled = false;
        } else {
            // Need to fetch more from API
            button.textContent = `Fetch More TXs`;
            button.disabled = false;
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
        
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(-0.5));
        this.updateCameraPosition();
    }
    
    panRight() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(new THREE.Vector3());
        right.crossVectors(this.camera.up, this.camera.getWorldDirection(new THREE.Vector3())).normalize();
        this.controls.target.add(right.multiplyScalar(0.5));
        this.updateCameraPosition();
    }
    
    panUp() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(0.5));
        this.updateCameraPosition();
    }
    
    panDown() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        this.controls.target.add(up.multiplyScalar(-0.5));
        this.updateCameraPosition();
    }
    
    zoomIn() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        if (this.isPerspective) {
            this.controls.distance -= 2;
            this.controls.distance = Math.max(1, Math.min(200, this.controls.distance));
            this.updateCameraPosition();
        } else {
            this.orthographicZoom -= 2;
            this.orthographicZoom = Math.max(5, Math.min(200, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
    }
    
    zoomOut() {
        this.isRotating = false;
        const button = document.getElementById('toggle-rotation');
        if (button) {
            button.textContent = 'Start Rotation';
        }
        
        if (this.isPerspective) {
            this.controls.distance += 2;
            this.controls.distance = Math.max(1, Math.min(200, this.controls.distance));
            this.updateCameraPosition();
        } else {
            this.orthographicZoom += 2;
            this.orthographicZoom = Math.max(5, Math.min(200, this.orthographicZoom));
            
            const aspect = window.innerWidth / window.innerHeight;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
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
                2000
            );
            this.isPerspective = false;
        } else {
            // Switch to perspective
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
            this.isPerspective = true;
        }
        
        // Restore position and target
        this.camera.position.copy(currentPosition);
        this.controls.target.copy(currentTarget);
        this.camera.lookAt(this.controls.target);
        
        // Update the button text
        const button = document.getElementById('toggle-view');
        if (button) {
            button.textContent = this.isPerspective ? 'Orthographic' : 'Perspective';
        }
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
}

document.addEventListener('DOMContentLoaded', () => {
    new BitcoinAddressExplorer();
}); 