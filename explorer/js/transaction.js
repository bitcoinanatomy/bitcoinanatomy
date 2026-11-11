// Bitcoin Explorer - Transaction Page
class BitcoinTransactionExplorer {
    // Tube palette (RRGGBBAA canvas gradients). Current tx stays brighter than traced history.
    static TUBE_TONES = {
        // Untraced current-tx fade (visible, but still a real gradient). Flattened only after a trace loads.
        CURRENT_INPUT: ['#22222200', '#eeeeeedd'],
        CURRENT_OUTPUT: ['#ffffffee', '#ffffff00'],
        CURRENT_FLAT: '#ffffffff',
        HISTORY_FLAT: '#c8c8c8dd',                 // traced funding path: the story, kept bright
        PARENT_INPUT: ['#44444400', '#9a9a9aaa'],  // untraced branches: visible but secondary
        PARENT_OUTPUT: ['#9a9a9aaa', '#44444400']
    };

    // Alternating tints so neighbouring input arms/cells read as separate pieces (3D + panel)
    static INPUT_SHADES = [0xffffff, 0xb4b4b4, 0xe0e0e0, 0x969696];
    static INPUT_PANEL_OPACITY = [0.42, 0.2, 0.32, 0.13];

    // Half-length of the central cylinder: the treemap faces sit at x = ±FACE_X
    static FACE_X = 1.25;

    constructor(opts) {
        opts = opts || {};
        this._shell = opts.shell || null;
        this._ac = new AbortController();
        this._disposed = false;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.isRotating = true;
        this.controls = {
            distance: 130,
            phi: Math.PI /2,
            theta: 1,
            target: new THREE.Vector3(0, 0, 0),
            panX: 0,
            panY: 0,
            panZ: 0
        };
        this.isPerspective = true; // Track camera type
        this.orthographicZoom = 20; // Store orthographic zoom level
        this.transactionData = null;
        this.txid = null;

        // Parent-transaction tracing ("Trace Inputs")
        this.parentMeshes = [];      // flat-added parent geometry, tracked for cleanup
        this.parentsLoaded = false;  // whether parents are currently shown
        this._tracing = false;       // guard against re-entrant clicks during load
        this.traceNodes = [];        // all traced nodes across levels {tx, level, centerY, links, blockHeight}
        this.traceDepth = 0;         // number of input-trace levels currently loaded
        this.parentsSpread = false;  // whether traced nodes are spread out by block age
        this.showTraceLabels = false; // block height + date sprites; only after Show Labels

        // Child-transaction tracing ("Trace Outputs")
        this.childMeshes = [];
        this.childrenLoaded = false;
        this.traceOutNodes = [];     // spending txs {tx, level, centerY, links, blockHeight}
        this.traceOutDepth = 0;
        this._traceMinX = 0;
        this._traceMaxX = 0;

        // Raw transaction data
        this.rawTxData = null;
        this.rawViewMode = 'hex'; // 'hex', 'ascii', or 'binary'
        this.decodeMode = false; // Whether to show decoded transaction parts
        this.decodedSections = null; // Parsed transaction sections
        
        // Gradient texture cache for cylinders
        this.cylinderGradientTexture = null;
        this.outputCylinderGradientTexture = null;
        // Arm layout: aligned column (default) or branching tree (remembered per browser)
        this.treeLayout = false;
        try { this.treeLayout = localStorage.getItem('tx.treeLayout') === '1'; } catch (e) { /* storage blocked */ }
        
        // Get transaction ID and other params from URL
        const urlParams = new URLSearchParams(window.location.search);
        
        // Validate transaction ID parameter
        const txidParam = urlParams.get('txid');
        const defaultTxid = 'ce6b90e54ee8bc231f694e2abfac140e8c7a0900e4726088f0ed3ea54a0f3d10';
        if (txidParam && /^[a-fA-F0-9]{64}$/.test(txidParam)) {
            this.txid = txidParam;
        } else if (txidParam) {
            console.warn('Invalid transaction ID parameter:', txidParam);
            this.txid = defaultTxid;
        } else {
            this.txid = defaultTxid;
        }
        
        // Validate view mode parameter
        const viewModeParam = urlParams.get('view');
        if (viewModeParam === 'ascii' || viewModeParam === 'binary' || viewModeParam === 'dump') {
            this.urlViewMode = viewModeParam;
        } else {
            this.urlViewMode = null;
        }
        
        // Validate bytes per line parameter
        const bytesParam = urlParams.get('bytes');
        const validBytesValues = ['16', '32', '64', '128', '256', '512'];
        if (bytesParam && validBytesValues.includes(bytesParam)) {
            this.urlBytesPerLine = bytesParam;
        } else {
            this.urlBytesPerLine = null;
        }
        
        this.urlRawDataOpen = urlParams.get('rawdata') === 'open'; // Whether raw data panel should be open
        this.urlDecodeMode = urlParams.get('decode') === 'on'; // Whether decode mode should be active
        
        // Set initial view mode from URL
        if (this.urlViewMode === 'ascii') {
            this.rawViewMode = 'ascii';
        } else if (this.urlViewMode === 'binary') {
            this.rawViewMode = 'binary';
        } else if (this.urlViewMode === 'dump') {
            this.rawViewMode = 'dump';
        }
        this.vrManager = null;

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
        // Prepare gradient texture for cylinders
        this.cylinderGradientTexture = this.createVerticalGradientTexture('#000000', '#cccccccc');
        // Prepare mirrored gradient for output cylinders
        this.outputCylinderGradientTexture = this.createVerticalGradientTexture('#cccccc33', '#ffffff00');
        // Gradient for coinbase tube: grey 0.2 opacity to white 0.8 opacity (along tube length)
        this.coinbaseTubeGradientTexture = this.createHorizontalGradientTexture('#88888833', '#ffffffcc');
        this.setupThreeJS();

        if (this._shell && this._shell.vrManager) {
            this.vrManager = this._shell.vrManager;
        } else if (typeof VRManager !== 'undefined') {
            this.vrManager = new VRManager(this, { panelTitle: 'Transaction', panelDomId: 'tx-info' });
            this.vrManager.init();
        }

        this.setupMouseControls();
        this.createScene();
        this.renderer.setAnimationLoop(() => this.animate());
        this.fetchData();
    }

    setupThreeJS() {
        const signal = this._ac.signal;

        if (this._shell) {
            this.scene = this._shell.scene;
            this.camera = this._shell.camera;
            this.renderer = this._shell.renderer;
            this.scene.background = new THREE.Color(0x000000);
            if (this.camera.isPerspectiveCamera) {
                this.camera.fov = 75;
                this.camera.near = 0.1;
                this.camera.far = 60000;
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
            }
            this.updateCameraPosition();
            window.addEventListener('resize', () => this.onWindowResize(), { signal });
            return;
        }

        const container = document.getElementById('scene');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 60000);
        this.updateCameraPosition();
        
        this.renderer = new THREE.WebGLRenderer({ antialias: (window.ExplorerSettings ? ExplorerSettings.get('antialias') : true) });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);
        
        window.addEventListener('resize', () => this.onWindowResize(), { signal });
    }

    _bindWithAbort(target, fn) {
        const signal = this._ac.signal;
        const orig = target.addEventListener.bind(target);
        target.addEventListener = (t, f, o) => {
            if (o === true) return orig(t, f, { capture: true, signal });
            if (o && typeof o === 'object') return orig(t, f, Object.assign({}, o, { signal }));
            return orig(t, f, { signal });
        };
        try { fn(); }
        finally { target.addEventListener = EventTarget.prototype.addEventListener.bind(target); }
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._ac.abort();
        this.isRotating = false;
        if (this._hoverTooltipEl && this._hoverTooltipEl.parentNode) {
            this._hoverTooltipEl.parentNode.removeChild(this._hoverTooltipEl);
            this._hoverTooltipEl = null;
        }
        if (this.cylinderGradientTexture) {
            this.cylinderGradientTexture.dispose();
            this.cylinderGradientTexture = null;
        }
        if (this.outputCylinderGradientTexture) {
            this.outputCylinderGradientTexture.dispose();
            this.outputCylinderGradientTexture = null;
        }
        if (this.coinbaseTubeGradientTexture) {
            this.coinbaseTubeGradientTexture.dispose();
            this.coinbaseTubeGradientTexture = null;
        }
        // Shared XR shell: router clearContent owns scene teardown — never strip controllers
        if (this._shell || (this.vrManager && this.renderer && this.renderer.xr && this.renderer.xr.isPresenting)) {
            return;
        }
        if (this.scene) {
            const toRemove = this.scene.children.slice();
            toRemove.forEach((child) => {
                if (child.isLight) return;
                if (this.vrManager && this.vrManager._shouldKeepInScene &&
                    this.vrManager._shouldKeepInScene(child)) return;
                this.scene.remove(child);
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
                    else child.material.dispose();
                }
            });
        }
    }

    setupMouseControls() {
        this._bindWithAbort(this.renderer.domElement, () => this._setupMouseControlsInner());
        
        // Button controls
        document.getElementById('toggle-rotation').addEventListener('click', () => {
            this.isRotating = !this.isRotating;
            this.updateRotationButtonState();
        });
        
        document.getElementById('reset-camera').addEventListener('click', () => {
            this.controls.distance = 60;
            this.controls.phi = Math.PI / 3;
            this.controls.theta = 0;
            this.controls.target.set(0, 0, 0);
            this.controls.panX = 0;
            this.controls.panY = 0;
            this.controls.panZ = 0;
            this.updateCameraPosition();
        });
        
        // Add toggle view button functionality
        const toggleViewButton = document.getElementById('toggle-view');
        if (toggleViewButton) {
            toggleViewButton.addEventListener('click', () => {
                this.toggleCameraView();
            });
        }
        
        // Remove the toggle-flow button since we don't have flows anymore
        const toggleFlowButton = document.getElementById('toggle-flow');
        if (toggleFlowButton) {
            toggleFlowButton.style.display = 'none';
        }

        // Trace menu: reveal deeper / spread / label controls
        const traceMenuToggle = document.getElementById('trace-menu-toggle');
        const traceMenu = document.getElementById('trace-menu');
        if (traceMenuToggle && traceMenu) {
            traceMenuToggle.addEventListener('click', () => {
                const open = !traceMenu.classList.contains('is-open');
                traceMenu.classList.toggle('is-open', open);
                traceMenu.hidden = !open;
                traceMenuToggle.classList.toggle('active', open);
            });
        }

        const spreadBtn = document.getElementById('spread-parents');
        if (spreadBtn) {
            spreadBtn.addEventListener('click', () => this.toggleSpreadParents());
        }

        const labelsBtn = document.getElementById('toggle-trace-labels');
        if (labelsBtn) {
            labelsBtn.addEventListener('click', () => this.toggleTraceLabels());
        }

        const frameBtn = document.getElementById('frame-trace');
        if (frameBtn) {
            frameBtn.addEventListener('click', () => this.frameTraceHistory());
        }

        const deeperBtn = document.getElementById('trace-deeper');
        if (deeperBtn) {
            deeperBtn.addEventListener('click', () => this.loadDeeperTrace());
        }

        const deeperOutBtn = document.getElementById('trace-deeper-outputs');
        if (deeperOutBtn) {
            deeperOutBtn.addEventListener('click', () => this.loadDeeperOutputTrace());
        }
        this._syncTraceMenuButtons();
        
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
        
        // Raw data functionality
        this.setupRawDataPanel();
        
        // Treemap functionality
        this.setupTreemapPanel();
    }

    _setupMouseControlsInner() {
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
        this._hoverTooltipEl = tooltip;
        
        let clickStartX = 0, clickStartY = 0;
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            clickStartX = e.clientX;
            clickStartY = e.clientY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            this.isRotating = false; // Stop auto rotation when user interacts
            this.updateRotationButtonState();
        });
        
        this.renderer.domElement.addEventListener('mouseup', (e) => {
            isMouseDown = false;
            // A click (not a drag) selects / deselects
            if (e.button === 0 && Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY) < 5) {
                this._handleSelectClick(e.clientX, e.clientY);
            }
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

            // Reset hover states: colors and opacities for inputs/outputs
            this.scene.children.forEach(child => {
                if (child.userData.type === 'input' || child.userData.type === 'input-cap') {
                    if (child.userData.originalColor) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                }
                if (child.userData.type === 'output' || child.userData.type === 'output-cap') {
                    if (typeof child.userData.originalOpacity === 'number') {
                        child.material.opacity = child.userData.originalOpacity;
                    }
                    if (typeof child.userData.originalEmissive === 'number' && child.material.emissive) {
                        child.material.emissive.setHex(child.userData.originalEmissive);
                        child.material.emissiveIntensity = child.userData.originalEmissiveIntensity || 0;
                    }
                    if (typeof child.userData.originalColor === 'number' && child.material.color) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                }
            });

            // Calculate objects intersecting the picking ray
            const intersects = raycaster.intersectObjects(this.scene.children);

            if (intersects.length > 0) {
                const intersectedObject = intersects[0].object;
                const userData = intersectedObject.userData;
                
                let tooltipContent = '';
                
                if (userData.type === 'input') {
                    const input = userData.data;
                    
                    // Check if this is a coinbase input
                    if (userData.isCoinbase) {
                        const amount = userData.coinbaseAmount ? (userData.coinbaseAmount / 100000000).toFixed(8) : 'Unknown';
                        const coinbaseHex = input.coinbase ? input.coinbase.substring(0, 32) + '...' : '';
                        
                        // Escape all dynamic data
                        const escapedAmount = this.escapeHtml(amount);
                        const escapedCoinbaseHex = this.escapeHtml(coinbaseHex);
                        
                        tooltipContent = `
                            <strong>Coinbase (Block Reward)</strong><br>
                            Amount: ${escapedAmount} BTC<br>
                            <br>
                            <strong>Coinbase Data:</strong><br>
                            ${escapedCoinbaseHex}<br>
                            <em>Newly minted bitcoins</em>
                        `;
                    } else {
                    const amount = input.prevout?.value ? (input.prevout.value / 100000000).toFixed(8) : 'Unknown';
                    const scriptType = input.prevout?.scriptpubkey_type || 'Unknown';
                    
                    // Escape all dynamic data
                    const escapedAmount = this.escapeHtml(amount);
                    const escapedScriptType = this.escapeHtml(scriptType);
                    const escapedAddress = input.prevout?.scriptpubkey_address ? this.escapeHtml(input.prevout.scriptpubkey_address.substring(0, 16) + '...') : '';
                    const escapedTxid = input.txid ? this.escapeHtml(input.txid.substring(0, 16) + '...') : 'Unknown';
                    const escapedVout = input.vout !== undefined ? this.escapeHtml(String(input.vout)) : 'Unknown';
                    
                    tooltipContent = `
                        <strong>Input ${userData.index + 1}</strong><br>
                        Amount: ${escapedAmount} BTC<br>
                        Script Type: ${escapedScriptType}<br>
                        ${escapedAddress ? `Address: ${escapedAddress}<br>` : ''}
                        <br>
                        <strong>From Transaction:</strong><br>
                        TXID: ${escapedTxid}<br>
                        Output Index: ${escapedVout}<br>
                            <em>Double-click → source tx | Shift+double-click → address</em>
                    `;
                    }
                } else if (userData.type === 'output') {
                    const output = userData.data;
                    const amount = (output.value / 100000000).toFixed(8);
                    const scriptType = output.scriptpubkey_type || 'Unknown';
                    
                    // Check if this output is spent and show spending transaction data
                    if (userData.spendingData) {
                        // Escape all dynamic data
                        const escapedAmount = this.escapeHtml(amount);
                        const escapedScriptType = this.escapeHtml(scriptType);
                        const escapedAddress = output.scriptpubkey_address ? this.escapeHtml(output.scriptpubkey_address.substring(0, 16) + '...') : '';
                        const escapedTxid = userData.spendingData.txid ? this.escapeHtml(userData.spendingData.txid.substring(0, 16) + '...') : 'Unknown';
                        const escapedBlockHeight = userData.spendingData.block_height ? this.escapeHtml(String(userData.spendingData.block_height)) : 'Unconfirmed';
                        
                        tooltipContent = `
                            <strong>Output ${userData.index + 1} (SPENT)</strong><br>
                            Amount: ${escapedAmount} BTC<br>
                            Script Type: ${escapedScriptType}<br>
                            ${escapedAddress ? `Address: ${escapedAddress}<br>` : ''}
                            <br>
                            <strong>Spent by:</strong><br>
                            TXID: ${escapedTxid}<br>
                            Block: ${escapedBlockHeight}<br>
                            <em>Double-click → spending tx | Shift+double-click → address</em>
                        `;
                    } else {
                        // Escape all dynamic data
                        const escapedAmount = this.escapeHtml(amount);
                        const escapedScriptType = this.escapeHtml(scriptType);
                        const escapedAddress = output.scriptpubkey_address ? this.escapeHtml(output.scriptpubkey_address.substring(0, 16) + '...') : '';
                        
                        tooltipContent = `
                            <strong>Output ${userData.index + 1} (Unspent)</strong><br>
                            Amount: ${escapedAmount} BTC<br>
                            Script Type: ${escapedScriptType}<br>
                            ${escapedAddress ? `Address: ${escapedAddress}<br>` : ''}
                            <em>Shift+double-click → address</em>
                        `;
                    }
                } else if (userData.type === 'input-cap') {
                    // Coinbase hemisphere cap
                    const input = userData.data;
                    const amount = userData.coinbaseAmount ? (userData.coinbaseAmount / 100000000).toFixed(8) : 'Unknown';
                    
                    // Escape all dynamic data
                    const escapedAmount = this.escapeHtml(amount);
                    
                    tooltipContent = `
                        <strong>Coinbase (Block Reward)</strong><br>
                        Amount: ${escapedAmount} BTC<br>
                        <em>Newly minted bitcoins</em>
                    `;
                } else if (userData.type === 'output-cap') {
                    // Unspent output hemisphere cap
                    const output = userData.data;
                    const amount = (output.value / 100000000).toFixed(8);
                    
                    // Escape all dynamic data
                    const escapedAmount = this.escapeHtml(amount);
                    const escapedAddress = output.scriptpubkey_address ? this.escapeHtml(output.scriptpubkey_address.substring(0, 16) + '...') : '';
                    
                    tooltipContent = `
                        <strong>Unspent Output ${userData.index + 1}</strong><br>
                        Amount: ${escapedAmount} BTC<br>
                        ${escapedAddress ? `${escapedAddress}<br>` : ''}
                        <em>Shift+double-click → address</em>
                    `;
                } else if (userData.type === 'fee') {
                    const { fee, totalIn } = userData.data;
                    const escapedFee = this.escapeHtml((fee / 100000000).toFixed(8));
                    const escapedPct = this.escapeHtml(totalIn ? (fee / totalIn * 100).toFixed(3) : '0');
                    tooltipContent = `
                        <strong>Fee</strong><br>
                        Amount: ${escapedFee} BTC<br>
                        ${escapedPct}% of inputs<br>
                        <em>Inputs − outputs, claimed by the miner</em>
                    `;
                } else if (userData.type === 'transaction') {
                    const tx = userData.data;
                    const totalInput = tx.vin ? tx.vin.reduce((sum, input) => sum + (input.prevout?.value || 0), 0) : 0;
                    const totalOutput = tx.vout ? tx.vout.reduce((sum, output) => sum + output.value, 0) : 0;
                    const fee = totalInput - totalOutput;
                    
                    // Escape all dynamic data
                    const escapedSize = this.escapeHtml(String(tx.size || 0));
                    const escapedFee = this.escapeHtml((fee / 100000000).toFixed(8));
                    const escapedInputCount = this.escapeHtml(String(tx.vin?.length || 0));
                    const escapedOutputCount = this.escapeHtml(String(tx.vout?.length || 0));
                    tooltipContent = `
                        <strong>Transaction</strong><br>
                        Size: ${escapedSize} bytes<br>
                        Fee: ${escapedFee} BTC<br>
                        Inputs: ${escapedInputCount}<br>
                        Outputs: ${escapedOutputCount}
                    `;
                }
                
                if (tooltipContent) {
                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.clientX + 10 + 'px';
                    tooltip.style.top = e.clientY - 10 + 'px';
                    
                    // Softer highlight for inputs: medium gray
                    if (userData.type === 'input' || userData.type === 'input-cap') {
                        const highlightColor = 0x999999;
                        intersectedObject.material.color.setHex(highlightColor);
                        
                        // Apply to both the input tube and its cap
                        const index = userData.index;
                        this.scene.children.forEach(child => {
                            if ((child.userData.type === 'input' || child.userData.type === 'input-cap') && 
                                child.userData.index === index) {
                                child.material.color.setHex(highlightColor);
                            }
                        });
                    }

                    // Stronger highlight for outputs: increase opacity more and tint brighter
                    if (userData.type === 'output' || userData.type === 'output-cap') {
                        const index = userData.index;
                        this.scene.children.forEach(child => {
                            if ((child.userData.type === 'output' || child.userData.type === 'output-cap') &&
                                child.userData.index === index) {
                                // Bump opacity more aggressively (cap at 1.0)
                                const newOpacity = Math.min(1.0, (child.userData.originalOpacity ?? child.material.opacity) + 1.0);
                                child.material.opacity = newOpacity;
                                // Brighten via emissive to ensure visible highlight even on textured materials
                                if (child.material.emissive) {
                                    child.material.emissive.setHex(0xffffff);
                                    child.material.emissiveIntensity = 0.6;
                                }
                                // Fallback: brighten color if no emissive
                                else if (child.material.color) {
                                    child.material.color.setHex(0xffffff);
                                }
                            }
                        });
                    }
                }
            } else {
                tooltip.style.display = 'none';
                // Reset all hover effects when not hovering over anything
                this.scene.children.forEach(child => {
                    if (child.userData) {
                        if ((child.userData.type === 'input' || child.userData.type === 'input-cap') && typeof child.userData.originalColor === 'number' && child.material?.color) {
                            child.material.color.setHex(child.userData.originalColor);
                        }
                        if (child.userData.type === 'output' || child.userData.type === 'output-cap') {
                            if (typeof child.userData.originalOpacity === 'number') {
                                child.material.opacity = child.userData.originalOpacity;
                            }
                            if (typeof child.userData.originalEmissive === 'number' && child.material?.emissive) {
                                child.material.emissive.setHex(child.userData.originalEmissive);
                                child.material.emissiveIntensity = child.userData.originalEmissiveIntensity || 0;
                            }
                            if (typeof child.userData.originalColor === 'number' && child.material?.color) {
                                child.material.color.setHex(child.userData.originalColor);
                            }
                        }
                    }
                });
            }
            this._applySelection();

            // Handle camera controls
            if (!isMouseDown) return;

            const deltaX = e.clientX - lastMouseX;
            const deltaY = e.clientY - lastMouseY;

            if (e.shiftKey) {
                // Panning - inverted for natural feel; scale proportionally with zoom distance so
                // it's strong when far out and fine-grained when very close (baseline at ~130).
                const panScale = 0.14 * (this.controls.distance / 130);
                this.controls.panX -= deltaX * panScale;
                this.controls.panY += deltaY * panScale;
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
            // Reset all hover effects on mouse leave
            this.scene.children.forEach(child => {
                if (child.userData) {
                    if ((child.userData.type === 'input' || child.userData.type === 'input-cap') && typeof child.userData.originalColor === 'number' && child.material?.color) {
                        child.material.color.setHex(child.userData.originalColor);
                    }
                    if (child.userData.type === 'output' || child.userData.type === 'output-cap') {
                        if (typeof child.userData.originalOpacity === 'number') {
                            child.material.opacity = child.userData.originalOpacity;
                        }
                        if (typeof child.userData.originalEmissive === 'number' && child.material?.emissive) {
                            child.material.emissive.setHex(child.userData.originalEmissive);
                            child.material.emissiveIntensity = child.userData.originalEmissiveIntensity || 0;
                        }
                        if (typeof child.userData.originalColor === 'number' && child.material?.color) {
                            child.material.color.setHex(child.userData.originalColor);
                        }
                    }
                }
            });
            this._applySelection();
        });
        
        this.renderer.domElement.addEventListener('wheel', (e) => {
            // Stop automatic rotation when user starts zooming
            this.isRotating = false;
            this.updateRotationButtonState();
            // Zoom in/out with inverted scroll direction
            if (this.isPerspective) {
                // Multiplicative (proportional) zoom: constant feel at every scale — fast when
                // far out, fine-grained when very close. Scroll down (deltaY>0) zooms out.
                this.controls.distance *= Math.exp(e.deltaY * 0.001);
                this.controls.distance = Math.max(0.2, Math.min(20000, this.controls.distance));
                this.updateCameraPosition();
            } else {
                // Orthographic camera zoom (multiplicative; preserves prior direction)
                this.orthographicZoom *= Math.exp(-e.deltaY * 0.001);
                this.orthographicZoom = Math.max(0.5, Math.min(30000, this.orthographicZoom)); // Allow much further zoom out
                
                const aspect = window.innerWidth / window.innerHeight;
                this.camera.left = -this.orthographicZoom * aspect / 2;
                this.camera.right = this.orthographicZoom * aspect / 2;
                this.camera.top = this.orthographicZoom / 2;
                this.camera.bottom = -this.orthographicZoom / 2;
                this.camera.updateProjectionMatrix();
                this._updateTraceLabelScales();
            }
        });

        // Add touch controls for mobile
        this.setupTouchControls();
        
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
                const isShiftClick = event.shiftKey;
                
                if (userData.type === 'input' || userData.type === 'input-cap') {
                    // Don't navigate for coinbase inputs (no source transaction)
                    if (userData.isCoinbase) {
                        return;
                    }
                    
                    if (isShiftClick) {
                        // Shift+double-click: go to address
                    const address = userData.data.prevout?.scriptpubkey_address;
                    if (address) {
                        explorerNavigate(`address.html?address=${address}`);
                    }
                    } else {
                        // Double-click: go to source transaction
                        const txid = userData.data.txid;
                        if (txid && txid !== '0000000000000000000000000000000000000000000000000000000000000000') {
                            explorerNavigate(`transaction.html?txid=${txid}`);
                        }
                    }
                } else if (userData.type === 'output' || userData.type === 'output-cap') {
                    if (isShiftClick) {
                        // Shift+double-click: go to address
                    const address = userData.data.scriptpubkey_address;
                    if (address) {
                        explorerNavigate(`address.html?address=${address}`);
                        }
                    } else {
                        // Double-click: go to spending transaction (if spent)
                        if (userData.spendingData?.txid) {
                            explorerNavigate(`transaction.html?txid=${userData.spendingData.txid}`);
                        }
                    }
                }
            }
        });
    }

    setupTouchControls() {
        this._bindWithAbort(this.renderer.domElement, () => this._setupTouchControlsInner());
    }

    _setupTouchControlsInner() {
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
            this.updateRotationButtonState();
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
                this.controls.distance = 60;
                this.controls.phi = Math.PI / 3;
                this.controls.theta = 0;
                this.controls.target.set(0, 0, 0);
                this.controls.panX = 0;
                this.controls.panY = 0;
                this.controls.panZ = 0;
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
                    // Panning - scale proportionally with zoom distance (strong far, fine when close)
                    const panSpeed = 0.006 * (this.controls.distance / 130);
                    this.controls.panX += deltaX * panSpeed;
                    this.controls.panY -= deltaY * panSpeed;
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
                    this.controls.distance = Math.max(0.2, Math.min(20000, this.controls.distance));
                    this.updateCameraPosition();
                } else {
                    this.orthographicZoom *= zoomFactor;
                    this.orthographicZoom = Math.max(0.5, Math.min(30000, this.orthographicZoom));
                    
                    const aspect = window.innerWidth / window.innerHeight;
                    this.camera.left = -this.orthographicZoom * aspect / 2;
                    this.camera.right = this.orthographicZoom * aspect / 2;
                    this.camera.top = this.orthographicZoom / 2;
                    this.camera.bottom = -this.orthographicZoom / 2;
                    this.camera.updateProjectionMatrix();
                    this._updateTraceLabelScales();
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

    // Create a simple vertical gradient texture (top to bottom) - for cylinders
    createVerticalGradientTexture(topColor, bottomColor) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, topColor);
        gradient.addColorStop(1, bottomColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.needsUpdate = true;
        return texture;
    }

    // Create a horizontal gradient texture (left to right) - for tubes (U coordinate goes along tube length)
    createHorizontalGradientTexture(startColor, endColor) {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, size, 0);
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, 1);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    // FrontSide only: DoubleSide transparent tubes show an inner wall (nested shell / grain).
    _makeTubeMaterial(map) {
        return this._glassify(new THREE.MeshLambertMaterial({
            color: 0xffffff,
            map: map,
            opacity: 1.0,
            transparent: true,
            side: THREE.FrontSide,
            depthWrite: false,
            depthTest: true
        }), { core: 0.22, rim: 0.55, flow: 0.08 });
    }

    // X-ray glass look on a Lambert material: see-through at the centre, solid and glowing at
    // the silhouette (fresnel), plus faint light pulses travelling along the tube (uv.x = length).
    // Patches the shader so existing color/opacity/emissive/map highlight logic keeps working.
    _glassify(material, opts) {
        const o = Object.assign({ core: 0.3, rim: 0.5, flow: 0 }, opts);
        if (!this._glassTime) this._glassTime = { value: 0 };
        const time = this._glassTime;
        const glass = { core: { value: o.core }, rim: { value: o.rim }, flow: { value: o.flow }, fade: { value: 1 } };
        material.userData.glass = glass;   // _setGlass() edits these live
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uGlassTime = time;
            shader.uniforms.uGlassCore = glass.core;
            shader.uniforms.uGlassRim = glass.rim;
            shader.uniforms.uGlassFlow = glass.flow;
            shader.uniforms.uGlassFade = glass.fade;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec2 vGlassUv;')
                .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGlassUv = uv;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', [
                    '#include <common>',
                    'varying vec2 vGlassUv;',
                    'uniform float uGlassTime, uGlassCore, uGlassRim, uGlassFlow, uGlassFade;'
                ].join('\n'))
                .replace('#include <opaque_fragment>', [
                    'float glassFr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);',
                    // Soft comet pulses: long gradient tail rising to a blurred head, moving along +uv
                    'float glassPh = fract(vGlassUv.x * 6.0 - uGlassTime * 0.25);',
                    'float glassPulse = uGlassFlow * 1.1 * pow(glassPh, 2.0) * smoothstep(1.0, 0.55, glassPh);',
                    'outgoingLight += diffuseColor.rgb * (glassFr * uGlassRim + glassPulse);',
                    'diffuseColor.a *= clamp(mix(uGlassCore, 1.0, glassFr) + glassPulse, 0.0, 1.0) * uGlassFade;',
                    '#include <opaque_fragment>'
                ].join('\n'));
        };
        material.customProgramCacheKey = () => 'tx-glass';
        return material;
    }

    _setGlass(material, opts) {
        const g = material && material.userData.glass;
        if (!g) return;
        if (opts.core != null) g.core.value = opts.core;
        if (opts.rim != null) g.rim.value = opts.rim;
        if (opts.flow != null) g.flow.value = opts.flow;
        if (opts.fade != null) g.fade.value = opts.fade;
    }

    // ---- Click selection: highlight one input/output (or the fee), fade the rest ----------

    _selectionKey(userData) {
        const t = userData && userData.type;
        if (t === 'input' || t === 'input-cap' || t === 'input-label') return `input:${userData.index}`;
        if (t === 'output' || t === 'output-cap' || t === 'output-label') return `output:${userData.index}`;
        if (t === 'fee' || t === 'fee-label') return 'fee';
        return null;
    }

    // Re-applied after every hover reset, since hover restores colours/opacities to originals
    _applySelection() {
        const sel = this._selection || null;
        this._syncTreemapSelection();
        this.scene.children.forEach((child) => {
            const key = this._selectionKey(child.userData);
            if (!key || !child.material) return;
            const fade = !sel || key === sel ? 1 : 0.08;
            const g = child.material.userData && child.material.userData.glass;
            if (g) {
                this._setGlass(child.material, { fade });
                // Make the selected arm read clearly: denser glass core, restored on deselect
                const picked = sel && key === sel;
                if (picked && g._baseCore == null) {
                    g._baseCore = g.core.value;
                    g.core.value = Math.max(g._baseCore, 0.75);
                } else if (!picked && g._baseCore != null) {
                    g.core.value = g._baseCore;
                    delete g._baseCore;
                }
            } else if (typeof child.userData.originalOpacity === 'number') {
                // Plain (non-glass) caps
                child.material.opacity = child.userData.originalOpacity * fade;
                child.material.transparent = true;
            }
        });
    }

    // Click on an arm/cap/fee selects it; click on anything else (or empty space) clears
    _handleSelectClick(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        // First selectable hit, so the open cylinder / cuboid in front don't swallow clicks
        const hit = raycaster.intersectObjects(this.scene.children)
            .find(h => h.object.visible && this._selectionKey(h.object.userData));
        this._selection = hit ? this._selectionKey(hit.object.userData) : null;
        this._applySelection();
    }

    // Lay the arms meeting the transaction out as a weighted circular Voronoi treemap that
    // tiles the cylinder's cross-section (radius discR, YZ plane), so the cells literally add
    // up to the whole. Returns [{ y, z, r, area, poly }] in input order: (y, z) is the cell's
    // area centroid, poly the cell outline relative to it, r the room left for a round tube.
    // Small seeded PRNG (mulberry32) keyed by a string, for deterministic treemaps
    _seededRandom(key) {
        let h = 1779033703 ^ String(key).length;
        for (let i = 0; i < String(key).length; i++) {
            h = Math.imul(h ^ String(key).charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        let a = h >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    _voronoiPorts(values, discR, seed = 'treemap') {
        const n = values.length;
        if (n === 0) return [];
        const circle = (r, sides) => this.createCircularPolygon(0, 0, r, sides).map(p => ({ y: p.y, z: p.x }));
        if (n === 1) return [{ y: 0, z: 0, r: discR, area: Math.PI * discR * discR, poly: circle(discR, 96) }];
        const total = values.reduce((a, v) => a + Math.max(v, 1e-6), 0);
        const S = 100; // work in a 200×200 box, centre (S,S), radius S
        const spiral = values.map((v, i) => {
            const w = Math.sqrt(Math.max(v, 1e-6) / total);
            const a = i * 2.399963229728653, d = S * (0.2 + 0.5 * (1 - w));
            return { x: S + d * Math.cos(a), y: S + d * Math.sin(a) };
        });
        let cells = null;
        if (typeof voronoi !== 'undefined' && voronoi.Treemap) {
            // The library seeds sites (and re-seeds collapsed cells) with Math.random; swap in a
            // PRNG keyed by the tx + face so the same transaction always gets the same diagram.
            const realRandom = Math.random;
            Math.random = this._seededRandom(seed);
            try {
                const children = values.map((v, i) => ({ value: Math.max(v, 1e-6), originalData: { index: i } }));
                const tm = new voronoi.Treemap({ children }, this.createCircularPolygon(S, S, S, 96), 2 * S, 2 * S);
                for (let k = 0; k < 120; k++) tm.compute();
                const sites = tm.getSites(), polys = tm.getPolygons();
                cells = new Array(n);
                sites.forEach((site, k) => {
                    const poly = polys[k];
                    if (!site || !poly || poly.length < 3 || !site.originalData) return;
                    cells[site.originalData.index] = { site, poly };
                });
                for (let c = 0; c < n; c++) if (!cells[c]) { cells = null; break; } // (some() skips holes)
            } catch (e) {
                console.warn('Voronoi port layout failed, using spiral:', e);
                cells = null;
            } finally {
                Math.random = realRandom;
            }
        }
        const k = discR / S;
        return values.map((v, i) => {
            if (!cells) {
                const p = spiral[i];
                const r = discR * Math.sqrt(Math.max(v, 1e-6) / total) * 0.8;
                return { y: (p.y - S) * k, z: (p.x - S) * k, r, area: Math.PI * r * r, poly: circle(r, 24) };
            }
            // Area-weighted centroid, area, and distance to the nearest edge (room for a round tube)
            const poly = cells[i].poly;
            let A = 0, cx = 0, cy = 0;
            for (let a = 0; a < poly.length; a++) {
                const p1 = poly[a], p2 = poly[(a + 1) % poly.length];
                const cr = p1.x * p2.y - p2.x * p1.y;
                A += cr; cx += (p1.x + p2.x) * cr; cy += (p1.y + p2.y) * cr;
            }
            A /= 2; cx /= 6 * A; cy /= 6 * A;
            let inR = Infinity;
            for (let a = 0; a < poly.length; a++) {
                const p1 = poly[a], p2 = poly[(a + 1) % poly.length];
                const ex = p2.x - p1.x, ey = p2.y - p1.y, len2 = ex * ex + ey * ey || 1;
                const t = Math.max(0, Math.min(1, ((cx - p1.x) * ex + (cy - p1.y) * ey) / len2));
                inR = Math.min(inR, Math.hypot(cx - (p1.x + ex * t), cy - (p1.y + ey * t)));
            }
            return {
                y: (cy - S) * k, z: (cx - S) * k, r: inR * k * 0.9, area: Math.abs(A) * k * k,
                poly: poly.map(q => ({ y: (q.y - cy) * k, z: (q.x - cx) * k }))
            };
        });
    }

    // Voronoi layout for one transaction, used for the current tx and every traced one:
    // each arm is a round tube whose cross-section area is ∝ its value (see _radiusForSats),
    // so a UTXO keeps one width from the tx that creates it to the tx that spends it. Inputs
    // and outputs (+ fee) tile the disc with cells of their tubes' areas — value in = value
    // out, so both faces fill exactly — and each arm morphs from its cell into its tube. Lanes are stacked in the cells' top-to-bottom order
    // (or branch out in tree mode). inY/inZ, outY/outZ are lane ends relative to the tx centre;
    // inStub / outStub are trace-arm lengths long enough for each side's bends. Cached per
    // txid, layout mode and constraints.
    // req = { in: Map(vin → radius), out: Map(vout → radius) } pins arms that a traced bridge
    // links to an already-drawn tx: they get exactly that width (and a cell sized for it), so
    // a coin is one width end to end even where the other tx had to draw it wider than its
    // value. Any area this leaves over on a face goes to that face's unlinked arms.
    _txArmLayout(tx, req) {
        if (!this._txLayoutCache) this._txLayoutCache = new Map();
        const reqIn = (req && req.in) || new Map(), reqOut = (req && req.out) || new Map();
        const sig = (m) => Array.from(m, ([k, r]) => `${k}=${r.toFixed(3)}`).join(',');
        const cacheKey = tx.txid && `${tx.txid}:${this.treeLayout ? 'tree' : 'aligned'}:${sig(reqIn)}|${sig(reqOut)}`;
        const cached = cacheKey && this._txLayoutCache.get(cacheKey);
        if (cached) return cached;
        const vins = tx.vin || [], vouts = tx.vout || [];
        const isCb = vins.length > 0 && (vins[0].coinbase !== undefined ||
            vins[0].txid === '0000000000000000000000000000000000000000000000000000000000000000');
        const totalOut = vouts.reduce((a, o) => a + (o.value || 0), 0);
        const totalInSats = isCb ? totalOut : vins.reduce((a, v) => a + (v.prevout?.value || 0), 0);
        const totalIn = Math.max(totalInSats, totalOut, 1);
        const fee = isCb ? 0 : Math.max(0, totalInSats - totalOut);
        // Tube radius per arm from its own value, so a UTXO keeps one width across transactions
        const inValueR = vins.map((v, i) => this._radiusForSats((isCb && i === 0) ? totalOut : (v.prevout?.value || 0)));
        const outValueR = vouts.map(o => this._radiusForSats(o.value || 0));
        // Each cell's area is its tube's cross-section (∝ value), so the cells on both faces
        // tile the disc and every arm fills its cell; pinned arms use their pinned width
        const inTarget = inValueR.map((r, i) => reqIn.has(i) ? reqIn.get(i) : r);
        const outTarget = outValueR.map((r, i) => reqOut.has(i) ? reqOut.get(i) : r);
        const inShares = inTarget.map(r => r * r);
        const outShares = outTarget.map(r => r * r);
        if (fee > 0) outShares.push(this._radiusForSats(fee) ** 2);
        // Pinned widths can unbalance the faces (in ≠ out + fee); hand the shortfall on the
        // lighter face to its unpinned arms (fee last) so pinned cells stay exactly their size
        const faceA = (a) => a.reduce((t, v) => t + v, 0);
        const total = Math.max(faceA(inShares), faceA(outShares));
        const topUp = (shares, pinned, n) => {
            const deficit = total - faceA(shares);
            if (deficit <= 1e-9) return;
            let free = shares.map((v, i) => i).filter(i => i < n && !pinned.has(i));
            if (!free.length) free = shares.map((v, i) => i).filter(i => !pinned.has(i));
            if (!free.length) return;
            const fs = free.reduce((t, i) => t + shares[i], 0);
            free.forEach(i => { shares[i] += fs > 0 ? deficit * shares[i] / fs : deficit / free.length; });
        };
        topUp(inShares, reqIn, vins.length);
        topUp(outShares, reqOut, vouts.length);
        // Visibility floor so dust, OP_RETURN and tiny fees still get a cell
        const withFloor = (w) => {
            if (!w.length) return w;
            const sum = w.reduce((a, v) => a + v, 0) || 1;
            const floor = Math.min(0.004, 0.5 / w.length);
            const f = w.map(v => Math.max(v / sum, floor));
            const fs = f.reduce((a, v) => a + v, 0);
            return f.map(v => v / fs);
        };
        const inW = withFloor(inShares), outW = withFloor(outShares);
        // Disc = total tube area (inputs = outputs + fee). Sized so every cell still covers its
        // tube where the dust floor takes a little area from the others (r² / share).
        const fit = (radii, w) => radii.reduce((m, r, i) => Math.max(m, (r * r) / (w[i] || 1)), 0);
        const discR = Math.max(0.05, Math.sqrt(Math.max(
            fit(inShares.map(Math.sqrt), inW), fit(outShares.map(Math.sqrt), outW))));
        const gap = discR * 0.012;
        const inputPorts = this._voronoiPorts(inW, discR, `${tx.txid}:in`);
        const outputCells = this._voronoiPorts(outW, discR, `${tx.txid}:out`);
        inputPorts.forEach(p => { p.gap = gap; });
        outputCells.forEach(p => { p.gap = gap; });
        const outputPorts = outputCells.slice(0, vouts.length);
        const feePort = fee > 0 ? outputCells[vouts.length] : null;
        // Each arm keeps its cell's width (equal-area radius) all the way out. On the linear
        // scale that is its value width to within the treemap's fit; small coins held at the
        // visibility floor come out wider, and the tx they link to is pinned to that width.
        const cellRadius = (port) => Math.sqrt(port.area / Math.PI);
        const inputArmR = inputPorts.map((p, i) => reqIn.has(i) ? reqIn.get(i) : cellRadius(p));
        const outputArmR = outputPorts.map((p, i) => reqOut.has(i) ? reqOut.get(i) : cellRadius(p));
        const stack = (ports, radii) => {
            const lanes = new Array(ports.length).fill(0);
            if (ports.length < 2) return { lanes, height: (radii[0] || 0) * 2 };
            const order = ports.map((p, i) => i).sort((a, b) => (ports[b].y - ports[a].y) || (ports[a].z - ports[b].z));
            const st = this.computeStackYPositions(order.map(i => radii[i]));
            order.forEach((idx, k) => { lanes[idx] = st.yPositions[k]; });
            return { lanes, height: st.totalHeight };
        };
        const ins = stack(inputPorts, inputArmR), outs = stack(outputPorts, outputArmR);
        const inZ = inputPorts.map(() => 0), outZ = outputPorts.map(() => 0);
        if (this.treeLayout) {
            // Tree: each arm keeps branching in its cell's direction instead of lining up
            this._treeLanes(inputPorts, inputArmR, ins.lanes, inZ);
            this._treeLanes(outputPorts, outputArmR, outs.lanes, outZ);
        }
        const holdLen = Math.max(3, discR * 0.25);
        // Vertical reach of the lane ends (tree lanes can go well past the stacked height)
        const reach = (lanes, radii) => lanes.reduce((m, y, i) => Math.max(m, Math.abs(y) + (radii[i] || 0)), 0);
        // Arm length per face: long enough for every arm's hold + bend (see _laneTubePath),
        // used for traced txs (min 20) and the current tx (min 120)
        const needFor = (ports, ys, zs, radii) =>
            ports.reduce((m, p, i) => Math.max(m, this._armLengthFor(p, ys[i], zs[i], radii[i], holdLen)), 0);
        const inNeed = needFor(inputPorts, ins.lanes, inZ, inputArmR);
        const outNeed = needFor(outputPorts, outs.lanes, outZ, outputArmR);
        const layout = {
            discR, fee, totalIn, totalInSats, inputPorts, outputCells, outputPorts, feePort,
            inputArmR, outputArmR, inY: ins.lanes, outY: outs.lanes, inZ, outZ,
            halfHeight: Math.max(reach(ins.lanes, inputArmR), reach(outs.lanes, outputArmR), discR, 1),
            holdLen,
            inStub: Math.min(400, Math.max(20, inNeed)),
            outStub: Math.min(400, Math.max(20, outNeed)),
            inLen: Math.min(400, Math.max(120, inNeed)),
            outLen: Math.min(400, Math.max(120, outNeed))
        };
        if (cacheKey) this._txLayoutCache.set(cacheKey, layout);
        return layout;
    }

    // Path for an arm between the cylinder face (x = ±FACE_X, at its Voronoi cell) and its
    // stacked lane at height y. dir = +1 for outputs, -1 for inputs. The arm first leaves the
    // face straight as part of the cell bundle (holdLen), then S-bends into its lane over a
    // run proportional to its vertical travel, so a big fan opens at one steady angle instead
    // of every arm bending sharply in the same few units. Far end stays at 35 + straightLength.
    // Thick tubes (radius) leave the face straight for longer and bend over a longer run, so
    // their curves stay wide instead of kinking (see _armBend).
    _laneTubePath(dir, port, y, straightLength, holdLen = 3, laneZ = 0, bendScale = 0.45, radius = 0) {
        const faceX = BitcoinTransactionExplorer.FACE_X;
        const farX = 35 + straightLength;
        const travel = Math.hypot(y - port.y, laneZ - port.z);
        const hold = this._armHold(holdLen, radius, travel);
        const bundleX = faceX + hold;
        const maxBend = Math.max(8, farX - 8 - bundleX);
        const bend = Math.min(maxBend, Math.max(35 - bundleX, this._armBend(travel, radius, bendScale)));
        const connX = bundleX + bend;
        const face = new THREE.Vector3(dir * faceX, port.y, port.z);
        const bundle = new THREE.Vector3(dir * bundleX, port.y, port.z);
        const c1 = new THREE.Vector3(dir * (bundleX + bend * 0.5), port.y, port.z);
        const c2 = new THREE.Vector3(dir * (bundleX + bend * 0.5), y, laneZ);
        const connection = new THREE.Vector3(dir * connX, y, laneZ);
        const far = new THREE.Vector3(dir * farX, y, laneZ);
        const path = new THREE.CurvePath();
        if (dir > 0) {
            path.add(new THREE.LineCurve3(face, bundle));
            path.add(new THREE.CubicBezierCurve3(bundle, c1, c2, connection));
            if (farX > connX + 1e-3) path.add(new THREE.LineCurve3(connection, far));
        } else {
            if (farX > connX + 1e-3) path.add(new THREE.LineCurve3(far, connection));
            path.add(new THREE.CubicBezierCurve3(connection, c2, c1, bundle));
            path.add(new THREE.LineCurve3(bundle, face));
        }
        path.holdLen = hold;
        path.bendLen = bend;
        return path;
    }

    // Straight run off the face before an arm bends: longer for thick tubes that change lane,
    // so they round off from their cell before turning
    _armHold(holdLen, radius, travel) {
        return travel > 1e-3 ? Math.max(holdLen, radius * 0.6) : holdLen;
    }

    // Length of an arm's S-bend for a sideways travel: the mode's steady angle, but never so
    // short that a tube of this radius kinks (an S over length L and travel h bends with a
    // radius of roughly L² / 6h; keep that at ≥ 2.5× the tube radius)
    _armBend(travel, radius, bendScale) {
        if (travel <= 1e-3) return 0;
        return Math.max(travel * bendScale, Math.sqrt(15 * travel * (radius || 0)));
    }

    // Shortest straightLength (see _laneTubePath) that fits an arm's hold + bend and leaves a
    // short straight lead at its far end
    _armLengthFor(port, y, z, radius, holdLen) {
        const travel = Math.hypot((y ?? 0) - port.y, (z ?? 0) - port.z);
        const hold = this._armHold(holdLen, radius, travel);
        const bend = Math.max(35 - BitcoinTransactionExplorer.FACE_X - hold, this._armBend(travel, radius, this._bendScale()));
        return Math.ceil(BitcoinTransactionExplorer.FACE_X + hold + bend + 14 - 35);
    }

    // Diagonal hatch (u = along the stub, v = around it) used to mark the fee without colour
    _feeHatchTexture() {
        if (this._feeHatch) return this._feeHatch;
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = 'rgba(255,255,255,1)';
        g.lineWidth = 9;
        for (let k = -64; k <= 128; k += 21) {
            g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke();
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, 6);
        this._feeHatch = t;
        return t;
    }

    // Extrude a Voronoi cell along an arm path: the cross-section is the cell polygon at the
    // cylinder face, is held through the path's bundle (path.holdLen), then morphs into a
    // round tube of `radius` over `morphLen` world units.
    // atStart = the face is at u = 0 (outputs); otherwise at u = 1 (inputs).
    // morphLen = Infinity keeps the polygon the whole way; capEnd closes the far end.
    _morphArmGeometry(path, port, radius, atStart, morphLen, capEnd = false) {
        const M = 72, length = path.getLength();
        // Keep the cell shape through the straight bundle, then round off during the bend
        const hold = path.holdLen || 0;
        if (morphLen === undefined) morphLen = Math.max(10, (path.bendLen || 20) * 0.6);
        // Ring positions as distance from the face: dense through the bundle and morph (where
        // the shape changes), then ~1 per unit (capped) along the rest of the arm
        const near = Math.min(length, hold + (Number.isFinite(morphLen) ? morphLen : 0));
        const dists = [];
        const nNear = near > 0 ? 40 : 0;
        for (let i = 0; i < nNear; i++) dists.push(near * i / nNear);
        const nFar = Math.max(8, Math.min(180, Math.ceil((length - near) * 1.2)));
        for (let i = 0; i <= nFar; i++) dists.push(near + (length - near) * i / nFar);
        const us = dists.map(d => Math.min(1, Math.max(0, atStart ? d / length : 1 - d / length))).sort((a, b) => a - b);
        const tubular = us.length - 1;
        // Inset each cell a little so neighbouring arms read as separate pieces
        const inset = (port.gap || 0);
        const src = port.poly.map(p => {
            const d = Math.hypot(p.y, p.z) || 1, s = Math.max(0, d - inset) / d;
            return { y: p.y * s, z: p.z * s };
        });
        // Resample by arc length, starting where the cell crosses angle 0, so ring vertex j
        // and its circle target share a direction (no twisting during the morph)
        const ang = (p) => Math.atan2(p.z, p.y);
        let start = 0, best = Infinity;
        src.forEach((p, i) => { const a = Math.abs(ang(p)); if (a < best) { best = a; start = i; } });
        const ring = src.slice(start).concat(src.slice(0, start));
        if (ring.length > 2) {
            let area2 = 0;
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i], b = ring[(i + 1) % ring.length];
                area2 += a.y * b.z - b.y * a.z;
            }
            if (area2 < 0) ring.reverse(), ring.unshift(ring.pop()); // CCW in (y, z), same start
        }
        const segLen = ring.map((p, i) => { const q = ring[(i + 1) % ring.length]; return Math.hypot(q.y - p.y, q.z - p.z); });
        const perim = segLen.reduce((a, v) => a + v, 0) || 1;
        const poly = [];
        for (let j = 0, seg = 0, acc = 0; j < M; j++) {
            const target = (j / M) * perim;
            while (seg < ring.length - 1 && acc + segLen[seg] < target) acc += segLen[seg++];
            const p = ring[seg], q = ring[(seg + 1) % ring.length];
            const t = segLen[seg] ? (target - acc) / segLen[seg] : 0;
            poly.push({ y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });
        }
        const round = poly.map(p => { const a = ang(p); return { y: Math.cos(a) * radius, z: Math.sin(a) * radius }; });

        // Rotation-minimising frames propagated from the face, seeded with N = +Y, B = +Z so
        // the cell lands exactly where the treemap placed it on the face
        const P = [], T = [];
        for (let i = 0; i <= tubular; i++) {
            const u = us[i];
            P.push(path.getPointAt(u)); T.push(path.getTangentAt(u).normalize());
        }
        const N = new Array(tubular + 1), B = new Array(tubular + 1);
        const f0 = atStart ? 0 : tubular, step = atStart ? 1 : -1;
        N[f0] = new THREE.Vector3(0, 1, 0); B[f0] = new THREE.Vector3(0, 0, 1);
        for (let i = f0 + step; i >= 0 && i <= tubular; i += step) {
            const prev = i - step;
            const v1 = P[i].clone().sub(P[prev]), c1 = v1.dot(v1) || 1e-9;
            const rL = N[prev].clone().sub(v1.clone().multiplyScalar(2 * v1.dot(N[prev]) / c1));
            const tL = T[prev].clone().sub(v1.clone().multiplyScalar(2 * v1.dot(T[prev]) / c1));
            const v2 = T[i].clone().sub(tL), c2 = v2.dot(v2) || 1e-9;
            N[i] = rL.sub(v2.multiplyScalar(2 * v2.dot(rL) / c2)).normalize();
            B[i] = new THREE.Vector3().crossVectors(T[i], N[i]).normalize();
        }

        const positions = [], uvs = [], indices = [];
        for (let i = 0; i <= tubular; i++) {
            const u = us[i];
            const s = (atStart ? u : 1 - u) * length;
            const e = Number.isFinite(morphLen) ? Math.max(0, Math.min(1, (s - hold) / morphLen)) : 0;
            const w = e * e * (3 - 2 * e);
            for (let j = 0; j <= M; j++) {
                const a = poly[j % M], b = round[j % M];
                const cy = a.y + (b.y - a.y) * w, cz = a.z + (b.z - a.z) * w;
                positions.push(
                    P[i].x + N[i].x * cy + B[i].x * cz,
                    P[i].y + N[i].y * cy + B[i].y * cz,
                    P[i].z + N[i].z * cy + B[i].z * cz
                );
                uvs.push(u, j / M);
            }
        }
        // Rings run CCW around T (both directions travel +X at the face), so this winding faces out
        for (let i = 0; i < tubular; i++) {
            for (let j = 0; j < M; j++) {
                const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j, c = b + 1, d = a + 1;
                indices.push(a, d, b, b, d, c);
            }
        }
        if (capEnd) {
            const ci = atStart ? tubular : 0, base = positions.length / 3;
            positions.push(P[ci].x, P[ci].y, P[ci].z); uvs.push(atStart ? 1 : 0, 0.5);
            for (let j = 0; j < M; j++) {
                const a = ci * (M + 1) + j, b = a + 1;
                if (atStart) indices.push(base, a, b); else indices.push(base, b, a);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }

    // Faint outline of every treemap cell plus the rim on one cylinder face (x = faceX).
    // Not pickable: a Line's default raycast threshold would swallow hovers on the arms.
    _treemapOutline(ports, discR, faceX) {
        const pts = [];
        const seg = (y1, z1, y2, z2) => pts.push(faceX, y1, z1, faceX, y2, z2);
        ports.forEach((p) => p.poly.forEach((a, i) => {
            const b = p.poly[(i + 1) % p.poly.length];
            seg(p.y + a.y, p.z + a.z, p.y + b.y, p.z + b.z);
        }));
        const rim = this.createCircularPolygon(0, 0, discR, 128);
        rim.forEach((a, i) => { const b = rim[(i + 1) % rim.length]; seg(a.y, a.x, b.y, b.x); });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false
        }));
        lines.raycast = () => {};
        lines.renderOrder = 3;
        lines.userData = { type: 'treemap-outline' };
        return lines;
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
        this._updateTraceLabelScales();
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

        // Bottom fill light from below
        const bottomFillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        bottomFillLight.position.set(0, -15, 0);
        this.scene.add(bottomFillLight);
            
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
            
            // Validate API response
            if (!this.transactionData || typeof this.transactionData !== 'object') {
                throw new Error('Invalid transaction data received');
            }
            if (this.transactionData.txid && (typeof this.transactionData.txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(this.transactionData.txid))) {
                throw new Error('Invalid transaction ID in response');
            }
            if (typeof this.transactionData.size !== 'number' || this.transactionData.size < 0) {
                throw new Error('Invalid transaction size in response');
            }
            
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
            
            let tipHeight = null;
            if (this.transactionData.status?.block_height) {
                try {
                    const tipResponse = await fetch('https://mempool.space/api/blocks/tip/height');
                    if (tipResponse.ok) {
                        tipHeight = parseInt(await tipResponse.text(), 10);
                    }
                } catch (e) {
                    console.warn('Could not fetch chain tip for confirmations:', e);
                }
            }
            this.updateUI(this.transactionData, tipHeight);
            this.createTransactionVisualization();
            
            // Check spending status of outputs
            this.checkOutputSpendingStatus();
            
        } catch (error) {
            console.error('Error fetching transaction data:', error);
            this.updateUI({});
        }
    }

    updateUI(data, chainTipHeight) {
        if (!data || Object.keys(data).length === 0) {
            document.getElementById('tx-hash').textContent = 'Loading...';
            document.getElementById('tx-date').textContent = 'Loading...';
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

        // Update title hash to show full transaction ID with optional "Back to Block" link
        const titleHash = data.txid ? data.txid : 'Not Found';
        const subtitleEl = document.getElementById('tx-title-hash');
        
        // Add "Block ######" link to the parent block if the transaction is confirmed
        // (include txid so the block page highlights this transaction)
        if (data.status?.block_height && data.txid) {
            const height = data.status.block_height;
            const backToBlockLink = `<br><a href="block.html?height=${height}&txid=${encodeURIComponent(data.txid)}" class="back-to-block-link">Block ${height.toLocaleString()}</a>`;
            subtitleEl.innerHTML = titleHash + backToBlockLink;
        } else {
            subtitleEl.textContent = titleHash;
        }
        
        document.getElementById('tx-hash').textContent = data.txid ? data.txid.substring(0, 16) + '...' : 'N/A';
        
        // Format transaction date
        let txDate = 'N/A';
        if (data.status?.block_time) {
            const date = new Date(data.status.block_time * 1000);
            txDate = this.formatDate(date);
        } else if (data.status?.confirmed === false) {
            txDate = 'Unconfirmed';
        }
        document.getElementById('tx-date').textContent = txDate;
        
        document.getElementById('tx-version').textContent = data.version !== undefined ? data.version.toString() : 'N/A';
        document.getElementById('tx-locktime').textContent = data.locktime !== undefined ? data.locktime.toString() : 'N/A';
        document.getElementById('tx-amount').textContent = totalOutput ? `${(totalOutput / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-fee').textContent = fee ? `${(fee / 100000000).toFixed(8)} BTC` : 'N/A';
        document.getElementById('tx-status').textContent = data.status?.confirmed ? 'Confirmed' : 'Unconfirmed';
        document.getElementById('tx-block-height').textContent = data.status?.block_height ? data.status.block_height.toString() : 'Unconfirmed';
        document.getElementById('tx-block-hash').textContent = data.status?.block_hash ? data.status.block_hash.substring(0, 16) + '...' : 'N/A';
        // Check if coinbase transaction
        const isCoinbaseTx = data.vin && data.vin.length > 0 && 
            (data.vin[0].coinbase !== undefined || 
             data.vin[0].txid === '0000000000000000000000000000000000000000000000000000000000000000');
        document.getElementById('tx-inputs').textContent = isCoinbaseTx ? 'Coinbase' : (data.vin ? data.vin.length.toString() : 'N/A');
        document.getElementById('tx-outputs').textContent = data.vout ? data.vout.length.toString() : 'N/A';
        document.getElementById('tx-size').textContent = data.size ? `${data.size} bytes` : 'N/A';
        document.getElementById('tx-weight').textContent = data.weight ? `${data.weight} WU` : 'N/A';
        document.getElementById('tx-sigops').textContent = data.sigops ? data.sigops.toString() : 'N/A';
        const blockHeight = data.status?.block_height;
        let confirmationsText;
        if (!blockHeight) {
            confirmationsText = 'Not confirmed';
        } else if (chainTipHeight != null && !isNaN(chainTipHeight)) {
            const count = Math.max(0, chainTipHeight - blockHeight + 1);
            confirmationsText = count.toString();
        } else {
            confirmationsText = 'Confirmed';
        }
        document.getElementById('tx-confirmations').textContent = confirmationsText;
    }

    createTransactionVisualization() {
        if (!this.transactionData) return;

        // Clear page meshes only — keep camera / XR controllers / grips / pivot / HUD
        const keep = (obj) => {
            if (!obj) return true;
            if (this.camera && obj === this.camera) return true;
            if (this.vrManager && typeof this.vrManager._shouldKeepInScene === 'function') {
                return this.vrManager._shouldKeepInScene(obj);
            }
            return false;
        };
        this.scene.children.slice().forEach((child) => {
            if (keep(child)) return;
            this.scene.remove(child);
        });
        // The sweep above already removed any traced parent/child geometry from the scene;
        // dispose the tracked meshes and reset the Trace Inputs/Outputs state/UI so it works fresh.
        this._resetParentState();
        if (this.vrManager && typeof this.vrManager._ensureControllersInScene === 'function') {
            this.vrManager._ensureControllersInScene();
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
        this._selection = null;
        const inputs = this.transactionData.vin || [];
        const outputs = this.transactionData.vout || [];
        
        // Check if this is a coinbase transaction
        const isCoinbase = inputs.length > 0 && (inputs[0].coinbase !== undefined || 
            (inputs[0].txid === '0000000000000000000000000000000000000000000000000000000000000000'));
        
        // For coinbase, calculate total output as the "input" amount (block reward + fees)
        const totalOutputValue = outputs.reduce((sum, out) => sum + (out.value || 0), 0);

        // Precompute input radii and vertical positions to avoid overlaps and align with tubes
        const inputParams = inputs.map((input, index) => {
            // For coinbase transactions, use total output value as the amount
            const amount = isCoinbase ? totalOutputValue : (input.prevout?.value || 0);
            const radius = this._radiusForSats(amount);
            return { index, input, radius, isCoinbase, coinbaseAmount: isCoinbase ? amount : null };
        });

        const yPositions = [];
        if (inputParams.length > 0) {
            if (inputParams.length === 1) {
                // Single input: position at same Y as transaction (Y=0)
                yPositions[0] = 0;
            } else {
                // Multiple inputs: calculate total height needed for all inputs
                let totalHeight = 0;
                for (let i = 0; i < inputParams.length; i++) {
                    if (i === 0) {
                        totalHeight += inputParams[i].radius;
                    } else {
                        const prevRadius = inputParams[i - 1].radius;
                        const radius = inputParams[i].radius;
                        const spacing = Math.max(0.5, prevRadius + radius + 0.5);
                        totalHeight += spacing;
                    }
                }
                
                // Start from the top and center around transaction cuboid (Y=0)
                let currentY = totalHeight / 2;
                const minSpacing = 0.5;
                for (let i = 0; i < inputParams.length; i++) {
                    if (i === 0) {
                        yPositions[i] = currentY;
                        currentY -= inputParams[i].radius;
                    } else {
                        const prevRadius = inputParams[i - 1].radius;
                        const radius = inputParams[i].radius;
                        const spacing = Math.max(minSpacing, prevRadius + radius + 0.5);
                        currentY -= spacing;
                        yPositions[i] = currentY;
                    }
                }
            }
        }

        // Precompute output radii and vertical positions to avoid overlaps and align with tubes
        const outputParams = outputs.map((output, index) => {
            const amount = output.value || 0;
            const radius = this._radiusForSats(amount);
            return { index, output, radius };
        });

        const yPositionsOutputs = [];
        if (outputParams.length > 0) {
            if (outputParams.length === 1) {
                // Single output: position at same Y as transaction (Y=0)
                yPositionsOutputs[0] = 0;
            } else {
                // Multiple outputs: calculate total height needed for all outputs
                let totalHeightOut = 0;
                for (let i = 0; i < outputParams.length; i++) {
                    if (i === 0) {
                        totalHeightOut += outputParams[i].radius;
                    } else {
                        const prevRadius = outputParams[i - 1].radius;
                        const radius = outputParams[i].radius;
                        const spacing = Math.max(0.5, prevRadius + radius + 0.5);
                        totalHeightOut += spacing;
                    }
                }
                
                // Start from the top and center around transaction cuboid (Y=0)
                let currentYOut = totalHeightOut / 2;
                const minSpacingOut = 0.5;
                for (let i = 0; i < outputParams.length; i++) {
                    if (i === 0) {
                        yPositionsOutputs[i] = currentYOut;
                        currentYOut -= outputParams[i].radius;
                    } else {
                        const prevRadius = outputParams[i - 1].radius;
                        const radius = outputParams[i].radius;
                        const spacing = Math.max(minSpacingOut, prevRadius + radius + 0.5);
                        currentYOut -= spacing;
                        yPositionsOutputs[i] = currentYOut;
                    }
                }
            }
        }

        // Create hemisphere caps for coinbase inputs only (tubes are created later as unified objects)
        inputParams.forEach((param, index) => {
            const { input, radius: inputRadius, isCoinbase: inputIsCoinbase, coinbaseAmount } = param;
            const y = yPositions[index] ?? ((inputs.length - 1) - index * 2);
            
            if (inputIsCoinbase) {
                // Create hemisphere cap for coinbase (at the far end of the tube)
                const geometry = new THREE.SphereGeometry(inputRadius, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
            const material = new THREE.MeshLambertMaterial({ 
                    color: 0x888888, // Grey color for coinbase
                transparent: true,
                    opacity: 0.3,
                side: THREE.DoubleSide,
                depthWrite: true,
                depthTest: true
            });
                const hemisphere = new THREE.Mesh(geometry, material);
                hemisphere.renderOrder = 1;
                
                // Rotate hemisphere so its opening faces inward (toward +X / the transaction)
                hemisphere.rotation.z = Math.PI / 2;
                
                // Position at the far end of the tube (shorter for coinbase)
                const coinbaseStraightLength = 15;
                hemisphere.position.set(-35 - coinbaseStraightLength, y, 0);
                hemisphere.userData = { 
                    type: 'input-cap', 
                    index, 
                    data: input, 
                    radius: inputRadius,
                    originalColor: 0x888888,
                    originalOpacity: 0.3,
                    isCoinbase: true,
                    coinbaseAmount: coinbaseAmount
                };
                this.scene.add(hemisphere);
            }
        });


        // Output hemisphere caps will be added by checkOutputSpendingStatus for unspent outputs
        // Store output params for later use
        this.outputParams = outputParams;
        this.yPositionsOutputs = yPositionsOutputs;
        // Store input Y positions so "Trace Inputs" can align each parent to the input it funds
        this.yPositionsInputs = yPositions;

        // Create central transaction cuboid
        const width = 2; // Fixed width
        const depth = width / 10; // 1/10th of width
        const height = Math.max(0.01, (this.transactionData.size || 250) / 3360); // Based on transaction size (halved vs width/depth)
        
        const txGeometry = new THREE.BoxGeometry(width, height, depth);
        const txMaterial = this._glassify(new THREE.MeshLambertMaterial({ 
            color: 0xffffff,
            transparent: true,
            opacity: 0.8, // Slightly transparent for better visibility
            depthWrite: true,
            depthTest: true
        }), { core: 0.55, rim: 0.6 });
        const txCuboid = new THREE.Mesh(txGeometry, txMaterial);
        txCuboid.renderOrder = 0; // Render before spheres
        txCuboid.position.set(0, 0, 0);
        txCuboid.userData = { type: 'transaction', data: this.transactionData };
        this.scene.add(txCuboid);

        // The central cylinder is the whole; both faces are circular Voronoi treemaps that tile
        // it by share of the input value (see _txArmLayout, shared with traced transactions).
        const L = this._txArmLayout(this.transactionData);
        const { discR, inputPorts, outputCells, outputPorts, feePort, fee, inputArmR, outputArmR, holdLen } = L;
        this.outputPorts = outputPorts;
        this.feePort = feePort;
        // Shared with the Treemap side panel so it draws exactly these cells
        this.treemapLayout = { discR, inputPorts, outputCells, fee, totalIn: L.totalInSats };
        this.inputArmR = inputArmR;
        this.outputArmR = outputArmR;
        // Lanes follow the cells' top-to-bottom order (arrays updated in place: shared via this.yPositions*)
        L.inY.forEach((y, i) => { yPositions[i] = y; });
        L.outY.forEach((y, i) => { yPositionsOutputs[i] = y; });
        this.zPositionsInputs = inputs.map((_, i) => L.inZ[i] || 0);
        this.zPositionsOutputs = outputs.map((_, i) => L.outZ[i] || 0);
        this.armHoldLen = holdLen;

        const faceX = BitcoinTransactionExplorer.FACE_X;
        const spanLength = faceX * 2;
        const spanGeometry = new THREE.CylinderGeometry(discR, discR, spanLength, 96, 1, true);
        const spanMaterial = this._glassify(new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true
        }), { core: 0.4, rim: 1.2 });
        const spanRing = new THREE.Mesh(spanGeometry, spanMaterial);
        spanRing.position.set(0, 0, 0);
        spanRing.rotation.z = Math.PI / 2; // Align along X axis
        spanRing.renderOrder = 1;
        this.scene.add(spanRing);

        this.scene.add(this._treemapOutline(inputPorts, discR, -faceX));
        this.scene.add(this._treemapOutline(outputCells, discR, faceX));

        // Fee: a short stub of its cell that leaves the output face and goes nowhere
        if (feePort) {
            const feePath = new THREE.LineCurve3(
                new THREE.Vector3(faceX, feePort.y, feePort.z),
                new THREE.Vector3(faceX + holdLen, feePort.y, feePort.z));
            // Grey, but marked: diagonal hatching wraps the stub and a slow pulse runs along it
            const feeMaterial = this._glassify(new THREE.MeshLambertMaterial({
                color: 0xbdbdbd,
                map: this._feeHatchTexture(),
                transparent: true,
                opacity: 1,
                side: THREE.FrontSide,
                depthWrite: false,
                depthTest: true
            }), { core: 0.55, rim: 1.0, flow: 0.25 });
            const feeMesh = new THREE.Mesh(this._morphArmGeometry(feePath, feePort, 0, true, Infinity, true), feeMaterial);
            feeMesh.renderOrder = 2;
            feeMesh.userData = { type: 'fee', data: { fee, totalIn: L.totalInSats }, originalColor: 0xbdbdbd };
            this.scene.add(feeMesh);

            // Label just past the stub (shown with the Labels toggle)
            this._addSceneLabel('FEE', `${this._btcShort(fee)} BTC`,
                new THREE.Vector3(faceX + holdLen, feePort.y, feePort.z), 1, { type: 'fee-label' });
        }

        // Create unified input arms (straight section + curve + Voronoi cell as one object)
        inputs.forEach((input, index) => {
            const y = yPositions[index] ?? ((inputs.length - 1) - index * 2);
            const inputIsCoinbase = isCoinbase && index === 0;
            
            const tubeRadius = inputArmR[index];
            
            // Coinbase inputs have shorter straight section (they originate from block reward)
            const straightLength = inputIsCoinbase ? 15 : L.inLen;
            const port = inputPorts[index];
            const curvePath = this._laneTubePath(-1, port, y, straightLength, holdLen, this.zPositionsInputs[index], this._bendScale(), tubeRadius);
            const tubeGeometry = this._morphArmGeometry(curvePath, port, tubeRadius, false);
            
            let material;
            if (inputIsCoinbase) {
                material = this._makeTubeMaterial(this.coinbaseTubeGradientTexture);
            } else {
                const tones = BitcoinTransactionExplorer.TUBE_TONES;
                material = this._makeTubeMaterial(
                    this.createHorizontalGradientTexture(tones.CURRENT_INPUT[0], tones.CURRENT_INPUT[1])
                );
                // Denser glass + brighter edges, and a per-input tint, so arms stand apart
                const shades = BitcoinTransactionExplorer.INPUT_SHADES;
                material.color.setHex(shades[index % shades.length]);
                this._setGlass(material, { core: 0.32, rim: 0.9 });
            }
            
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 2;
            tube.userData = { 
                type: 'input', 
                index: index, 
                data: input, 
                radius: tubeRadius,
                originalColor: inputIsCoinbase ? 0xffffff : BitcoinTransactionExplorer.INPUT_SHADES[index % BitcoinTransactionExplorer.INPUT_SHADES.length],
                isCoinbase: inputIsCoinbase,
                coinbaseAmount: inputIsCoinbase ? totalOutputValue : null
            };
            this.scene.add(tube);
        });

        // Create unified output arms (Voronoi cell + curve + straight section as one object)
        outputs.forEach((output, index) => {
            const y = yPositionsOutputs[index] ?? ((outputs.length - 1) - index * 2);
            
            const tubeRadius = outputArmR[index];
            
            const straightLength = L.outLen; // long enough for every output's bend
            const port = outputPorts[index];
            const curvePath = this._laneTubePath(1, port, y, straightLength, holdLen, this.zPositionsOutputs[index], this._bendScale(), tubeRadius);
            const tubeGeometry = this._morphArmGeometry(curvePath, port, tubeRadius, true);
            
            const tones = BitcoinTransactionExplorer.TUBE_TONES;
            const material = this._makeTubeMaterial(
                this.createHorizontalGradientTexture(tones.CURRENT_OUTPUT[0], tones.CURRENT_OUTPUT[1])
            );
            
            const tube = new THREE.Mesh(tubeGeometry, material);
            tube.renderOrder = 2;
            tube.userData = { 
                type: 'output', 
                index: index, 
                data: output, 
                radius: tubeRadius,
                originalOpacity: 1.0, 
                originalEmissive: 0x000000, 
                originalColor: 0xffffff 
            };
            this.scene.add(tube);
        });

        this._buildIoLabels(L, isCoinbase, totalOutputValue, yPositions, yPositionsOutputs);
    }

    // ---- Labels toggle: amounts/addresses at the arms' far ends, tx summary, fee ----------

    _btcShort(sats) {
        return ((sats || 0) / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0';
    }

    _shortAddr(a) {
        if (!a) return '';
        return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
    }

    // Label sprite anchored to a point, hidden unless labels are on. Its width tracks the zoom
    // (constant on-screen size); side = -1 grows left of the anchor, +1 right, 0 centred above.
    _addSceneLabel(line1, line2, anchor, side, userData) {
        const sprite = this._makeLabelSprite(line1, line2);
        sprite.raycast = () => {};
        Object.assign(sprite.userData, { originalOpacity: 1, labelAnchor: anchor.clone(), labelSide: side }, userData);
        sprite.visible = !!this.showLabels;
        this.scene.add(sprite);
        this._placeSceneLabel(sprite);
        return sprite;
    }

    _placeSceneLabel(sprite) {
        const u = sprite.userData;
        const w = 90 * this._traceLabelZoomScale();
        const h = w * u.labelAspect;
        sprite.scale.set(w, h, 1);
        sprite.position.copy(u.labelAnchor);
        if (u.labelSide) sprite.position.x += u.labelSide * w * 0.55;
        else sprite.position.y += h * 0.6;
        return h;
    }

    // Resize all scene labels for the current zoom, and declutter: an input/output label is
    // shown only if it clears the one above it (so 100+ inputs don't pile into a smear)
    _updateSceneLabels() {
        const groups = { 'input-label': [], 'output-label': [] };
        let h = 0;
        this.scene.children.forEach((c) => {
            const t = c.userData.type;
            if (t !== 'input-label' && t !== 'output-label' && t !== 'fee-label' && t !== 'tx-label') return;
            h = this._placeSceneLabel(c);
            if (groups[t]) groups[t].push(c);
            else c.visible = !!this.showLabels;
        });
        Object.values(groups).forEach((list) => {
            list.sort((a, b) => b.position.y - a.position.y);
            let lastY = Infinity;
            list.forEach((c) => {
                const fits = lastY - c.position.y >= h * 0.95;
                c.visible = !!this.showLabels && fits;
                if (fits) lastY = c.position.y;
            });
        });
    }

    _buildIoLabels(L, isCoinbase, totalOutputValue, inLanes, outLanes) {
        const tx = this.transactionData;
        const inputs = tx.vin || [], outputs = tx.vout || [];
        inputs.forEach((input, i) => {
            const cb = isCoinbase && i === 0;
            const farX = 35 + (cb ? 15 : L.inLen);
            const amount = cb ? totalOutputValue : (input.prevout?.value || 0);
            this._addSceneLabel(`${this._btcShort(amount)} BTC`,
                cb ? 'Coinbase' : this._shortAddr(input.prevout?.scriptpubkey_address) || `Input ${i + 1}`,
                new THREE.Vector3(-farX - (L.inputArmR[i] || 0), inLanes[i] ?? 0, this.zPositionsInputs?.[i] || 0), -1, { type: 'input-label', index: i });
        });
        this.outputLabels = [];
        outputs.forEach((output, i) => {
            const addr = this._shortAddr(output.scriptpubkey_address) ||
                (output.scriptpubkey_type === 'op_return' ? 'OP_RETURN' : `Output ${i + 1}`);
            this.outputLabels[i] = this._addSceneLabel(`${this._btcShort(output.value)} BTC`, addr,
                new THREE.Vector3(35 + L.outLen, outLanes[i] ?? 0, this.zPositionsOutputs?.[i] || 0), 1, { type: 'output-label', index: i });
        });
        // Transaction: centred above the cylinder
        const shortId = tx.txid ? `${tx.txid.slice(0, 8)}…${tx.txid.slice(-6)}` : 'Transaction';
        this._addSceneLabel(shortId, `${this._btcShort(L.totalInSats)} BTC · ${tx.size || '?'} B`,
            new THREE.Vector3(0, L.discR, 0), 0, { type: 'tx-label' });
        this._updateSceneLabels();
    }

    // Tree mode flares out over a much longer run (gentle branches); aligned keeps the tighter S
    _bendScale() {
        return this.treeLayout ? 1.6 : 0.45;
    }

    // Tree layout: an arm's far end = its cell centre pushed outward by one common factor,
    // just large enough that no two tubes touch (and at least 3×, so the branching reads).
    _treeLanes(ports, radii, ys, zs) {
        if (ports.length < 2) return;
        let k = 3;
        for (let a = 0; a < ports.length; a++) {
            for (let b = a + 1; b < ports.length; b++) {
                const d = Math.hypot(ports[a].y - ports[b].y, ports[a].z - ports[b].z) || 1e-3;
                k = Math.max(k, (radii[a] + radii[b] + 0.5) / d);
            }
        }
        k = Math.min(k, 80);
        ports.forEach((p, i) => { ys[i] = p.y * k; zs[i] = p.z * k; });
    }

    // Rebuild with arms aligned (one vertical sheet) or branching like a tree; keeps traces
    async toggleTreeLayout() {
        this.treeLayout = !this.treeLayout;
        try { localStorage.setItem('tx.treeLayout', this.treeLayout ? '1' : '0'); } catch (e) { /* storage blocked */ }
        document.getElementById('toggle-tree')?.classList.toggle('active', this.treeLayout);
        if (!this.transactionData) return;
        const keep = {
            traceNodes: this.traceNodes, traceDepth: this.traceDepth, parentsLoaded: this.parentsLoaded,
            traceOutNodes: this.traceOutNodes, traceOutDepth: this.traceOutDepth, childrenLoaded: this.childrenLoaded,
            parentsSpread: this.parentsSpread, showTraceLabels: this.showTraceLabels
        };
        this.createTransactionVisualization();
        await this.checkOutputSpendingStatus();
        Object.assign(this, keep);
        if (this.parentsLoaded && (this.traceNodes || []).length) {
            const traced = new Set();
            this.traceNodes.filter(n => n.level === 1).forEach(n => n.links.forEach((l) => {
                const [t, idx] = l.shallowKey.split(':');
                if (t === this.txid) traced.add(parseInt(idx, 10));
            }));
            this._flattenTracedInputs(traced);
            this._layoutParents(this.parentsSpread);
        }
        if (this.childrenLoaded && (this.traceOutNodes || []).length) {
            const traced = new Set();
            this.traceOutNodes.filter(n => n.level === 1).forEach(n => n.links.forEach((l) => {
                const m = /:vout:(\d+)$/.exec(l.shallowKey);
                if (m && l.shallowKey.startsWith(this.txid)) traced.add(parseInt(m[1], 10));
            }));
            this._flattenTracedOutputs(traced);
            this._layoutChildren(this.parentsSpread);
        }
        this._syncTraceMenuButtons();
    }

    toggleLabels() {
        this.showLabels = !this.showLabels;
        const types = { 'input-label': 1, 'output-label': 1, 'fee-label': 1, 'tx-label': 1 };
        this.scene.children.forEach((c) => { if (types[c.userData.type]) c.visible = this.showLabels; });
        this._updateSceneLabels();
        document.getElementById('toggle-labels')?.classList.toggle('active', this.showLabels);
    }
    
    // ---- Trace Inputs: load parent transactions one level deep -------------

    // Tube radius from a satoshi amount: cross-section area ∝ value on one global scale
    // (1 BTC → radius 2.5), so value is conserved like a fluid — a tx's input tubes and its
    // output tubes + fee have the same total area, and a UTXO keeps one width everywhere.
    // Small floor so dust stays visible.
    _radiusForSats(sats) {
        return Math.max(0.04, 2.5 * Math.sqrt(Math.max(0, sats || 0) / 100000000));
    }

    // Stack a set of radii vertically, centered on 0, avoiding overlap.
    // Mirrors the input/output Y-stacking used by createInputOutputVisualization.
    computeStackYPositions(radii, minSpacing = 0.5) {
        const yPositions = [];
        if (!radii || radii.length === 0) return { yPositions, totalHeight: 0 };
        if (radii.length === 1) { yPositions[0] = 0; return { yPositions, totalHeight: radii[0] * 2 }; }
        let totalHeight = 0;
        for (let i = 0; i < radii.length; i++) {
            if (i === 0) totalHeight += radii[i];
            else totalHeight += Math.max(minSpacing, radii[i - 1] + radii[i] + 0.5);
        }
        let currentY = totalHeight / 2;
        for (let i = 0; i < radii.length; i++) {
            if (i === 0) { yPositions[i] = currentY; currentY -= radii[i]; }
            else {
                const spacing = Math.max(minSpacing, radii[i - 1] + radii[i] + 0.5);
                currentY -= spacing;
                yPositions[i] = currentY;
            }
        }
        return { yPositions, totalHeight };
    }

    // Fetch a set of parent transactions with a small concurrency pool.
    async _fetchParents(txids) {
        const results = new Map();
        const queue = txids.slice();
        const worker = async () => {
            while (queue.length) {
                const txid = queue.shift();
                try {
                    const resp = await fetch(`https://mempool.space/api/tx/${txid}`, { signal: this._ac.signal });
                    if (!resp.ok) { console.warn('Trace Inputs: fetch failed', txid, resp.status); continue; }
                    results.set(txid, await resp.json());
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                    console.warn('Trace Inputs: fetch error', txid, e);
                }
            }
        };
        const workers = [];
        const n = Math.min(8, txids.length);
        for (let i = 0; i < n; i++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }

    // Build a tube mesh, tag it, add it flat to the scene, and track it for cleanup.
    // Trace tubes: funding paths ('parent-connection') are bright with a flow pulse so the
    // value's route reads first; untraced branches are dimmer. Each older generation (level)
    // fades a little more, so depth reads left-to-right without anything disappearing.
    _traceFade(level) {
        return Math.max(0.45, Math.pow(0.82, (level || 1) - 1));
    }

    _styleTraceMaterial(material, userData) {
        const isPath = userData && userData.type === 'parent-connection';
        const fade = this._traceFade(userData && userData.level);
        this._setGlass(material, isPath
            ? { core: 0.4 * fade, rim: 0.9 * fade, flow: 0.18 }
            : { core: 0.28 * fade, rim: 0.6 * fade, flow: 0 });
        return material;
    }

    _addTraceMesh(geometry, gradStart, gradEnd, userData, meshList, position) {
        const material = this._styleTraceMaterial(
            this._makeTubeMaterial(this.createHorizontalGradientTexture(gradStart, gradEnd)), userData);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 0;
        mesh.userData = userData;
        if (position) mesh.position.copy(position);
        this.scene.add(mesh);
        (meshList || this.parentMeshes).push(mesh);
        return mesh;
    }

    // Bridge between two arms' far ends (from → to, left to right), tapering from one arm's
    // radius to the other's: an output's cell size in one tx becomes an input's in the next.
    _addTraceBridge(from, to, userData, meshList, tone) {
        if (Math.hypot(to.x - from.x, to.y - from.y) < 0.5) return null;
        const midX = (from.x + to.x) / 2;
        const fz = from.z || 0, tz = to.z || 0;
        const path = new THREE.CubicBezierCurve3(
            new THREE.Vector3(from.x, from.y, fz),
            new THREE.Vector3(midX, from.y, fz),
            new THREE.Vector3(midX, to.y, tz),
            new THREE.Vector3(to.x, to.y, tz));
        const r0 = Math.max(0.05, from.r || 0.25), r1 = Math.max(0.05, to.r || r0);
        const port = { poly: this.createCircularPolygon(0, 0, r0, 32).map(p => ({ y: p.y, z: p.x })) };
        const geo = this._morphArmGeometry(path, port, r1, true, path.getLength());
        return this._addTraceMesh(geo, tone, tone, userData, meshList);
    }

    // Approximate half the vertical extent a parent will occupy (for de-overlap stacking).
    _parentHalfHeight(parentTx) {
        return this._txArmLayout(parentTx).halfHeight;
    }

    // Load the next level of the input trace. Level 1 = parents of the current tx's inputs;
    // deeper levels = parents of the previous level's inputs. Nodes are stored in
    // this.traceNodes (with the funding links needed to reconnect on re-layout) and drawn by
    // _layoutParents. Returns the number of new transactions added this level.
    async loadParentTransactions() {
        const isCoinbaseVin = (v) => v.coinbase !== undefined ||
            v.txid === '0000000000000000000000000000000000000000000000000000000000000000';

        // Build the frontier of parents to fetch: parentTxid -> [{ shallowKey, vout, desiredY }].
        // shallowKey = "<shallowTxid>:<vinIndex>" identifies the shallower input this parent funds.
        const frontier = new Map();
        const addLink = (txid, shallowKey, vout, desiredY) => {
            if (!txid) return;
            if (!frontier.has(txid)) frontier.set(txid, []);
            frontier.get(txid).push({ shallowKey, vout, desiredY });
        };

        if (this.traceDepth === 0) {
            // Frontier = the current transaction's own inputs.
            const inputs = this.transactionData?.vin || [];
            inputs.forEach((input, i) => {
                if (isCoinbaseVin(input)) return;
                addLink(input.txid, `${this.txid}:${i}`, input.vout, this.yPositionsInputs?.[i] ?? 0);
            });
        } else {
            // Frontier = the inputs of the deepest level currently drawn.
            const deepest = this.traceNodes.filter((n) => n.level === this.traceDepth);
            deepest.forEach((node) => {
                const vins = node.tx.vin || [];
                const inY = this._txArmLayout(node.tx).inY;
                vins.forEach((v, j) => {
                    if (isCoinbaseVin(v)) return;
                    addLink(v.txid, `${node.tx.txid}:${j}`, v.vout, node.centerY + (inY[j] ?? 0));
                });
            });
        }

        if (frontier.size === 0) return 0;

        // Cap per level as a safety valve against pathological txs.
        let txids = Array.from(frontier.keys());
        const MAX_PARENTS = 250;
        if (txids.length > MAX_PARENTS) {
            console.warn(`Trace Inputs: capping level at ${MAX_PARENTS} of ${txids.length} parents`);
            txids = txids.slice(0, MAX_PARENTS);
        }

        const fetched = await this._fetchParents(txids);
        if (this._disposed) return 0;

        // Build + vertically stack the new nodes for this level.
        const entries = [];
        for (const txid of txids) {
            const tx = fetched.get(txid);
            if (!tx) continue;
            const links = frontier.get(txid);
            const desiredY = links.reduce((s, l) => s + l.desiredY, 0) / links.length;
            entries.push({
                tx,
                links: links.map((l) => ({ shallowKey: l.shallowKey, vout: l.vout })),
                desiredY,
                halfHeight: this._parentHalfHeight(tx),
                blockHeight: tx.status?.block_height
            });
        }
        if (entries.length === 0) return 0;

        entries.sort((a, b) => b.desiredY - a.desiredY);
        const GAP = 6;
        let prevBottom = Infinity;
        const newLevel = this.traceDepth + 1;
        for (const e of entries) {
            let centerY = e.desiredY;
            if (centerY + e.halfHeight > prevBottom - GAP) centerY = prevBottom - GAP - e.halfHeight;
            prevBottom = centerY - e.halfHeight;
            this.traceNodes.push({ tx: e.tx, level: newLevel, centerY, links: e.links, blockHeight: e.blockHeight });
        }
        this.traceDepth = newLevel;

        // Level 1 flattens the current-tx inputs that now have a parent (uninterrupted path).
        if (newLevel === 1) {
            const tracedInputs = new Set();
            entries.forEach((e) => e.links.forEach((l) => {
                const parts = l.shallowKey.split(':');
                if (parts[0] === this.txid) tracedInputs.add(parseInt(parts[1], 10));
            }));
            this._flattenTracedInputs(tracedInputs);
        }

        this._layoutParents(this.parentsSpread);
        return entries.length;
    }

    // Draw one traced transaction node (cuboid + inputs + outputs). fundingLinks are this node's
    // outputs that fund a shallower input: [{ vout, target: {x,y} }]. fundedInputKeys is the set of
    // "<txid>:<vinIndex>" that a deeper level funds — those inputs are drawn flat (no gradient) so
    // the traced path stays uninterrupted. opts.sourceLinks are this node's inputs that spend a
    // shallower output: [{ vin, target: {x,y} }]. Returns { inputAnchors, outputAnchors }.
    drawTraceNode(tx, centerX, centerY, fundingLinks, fundedInputKeys, opts) {
        opts = opts || {};
        const meshList = opts.meshList || this.parentMeshes;
        const group = opts.group || 'parent';
        const level = opts.level || 1;
        const fade = this._traceFade(level);
        // Older (parent) tubes are greyer/dimmer than the current tx so generations read as depth.
        const tones = BitcoinTransactionExplorer.TUBE_TONES;
        const PARENT_INPUT_GRAD = tones.PARENT_INPUT;
        const PARENT_OUTPUT_GRAD = tones.PARENT_OUTPUT;
        const FLAT_TONE = tones.HISTORY_FLAT; // uninterrupted funding path
        const centre = new THREE.Vector3(centerX, centerY, 0);

        // Same Voronoi treatment as the current tx: disc = input total, cells by share
        const L = this._txArmLayout(tx, opts.req);
        const vins = tx.vin || [];
        const vouts = tx.vout || [];

        // Cuboid
        const width = 2;
        const depth = width / 10;
        const height = Math.max(0.01, (tx.size || 250) / 3360);
        const cuboid = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            this._glassify(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: true, depthTest: true }), { core: 0.55, rim: 0.6 })
        );
        cuboid.renderOrder = 0;
        cuboid.position.copy(centre);
        cuboid.userData = { type: 'parent-transaction', group, data: tx };
        this.scene.add(cuboid);
        meshList.push(cuboid);

        // Cylinder hub + treemap outlines on both faces
        const faceX = BitcoinTransactionExplorer.FACE_X;
        const hub = new THREE.Mesh(
            new THREE.CylinderGeometry(L.discR, L.discR, faceX * 2, 64, 1, true),
            this._glassify(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
                { core: 0.3, rim: 1.1 * fade })
        );
        hub.rotation.z = Math.PI / 2;
        hub.position.copy(centre);
        hub.renderOrder = 1;
        hub.userData = { type: 'parent-hub', group };
        hub.raycast = () => {}; // decorative: don't steal hovers from the cuboid / tubes
        this.scene.add(hub);
        meshList.push(hub);
        [this._treemapOutline(L.inputPorts, L.discR, -faceX), this._treemapOutline(L.outputCells, L.discR, faceX)]
            .forEach((lines) => {
                lines.position.copy(centre);
                lines.material.opacity *= fade;
                lines.userData = { type: 'parent-outline', group };
                this.scene.add(lines);
                meshList.push(lines);
            });

        // Fee stub
        if (L.feePort) {
            const feePath = new THREE.LineCurve3(
                new THREE.Vector3(faceX, L.feePort.y, L.feePort.z),
                new THREE.Vector3(faceX + L.holdLen, L.feePort.y, L.feePort.z));
            const feeMesh = new THREE.Mesh(
                this._morphArmGeometry(feePath, L.feePort, 0, true, Infinity, true),
                this._glassify(new THREE.MeshLambertMaterial({ color: 0xbdbdbd, map: this._feeHatchTexture(), transparent: true, opacity: 1, depthWrite: false }),
                    { core: 0.5 * fade, rim: 0.9 * fade }));
            feeMesh.position.copy(centre);
            feeMesh.renderOrder = 2;
            feeMesh.userData = { type: 'parent-fee', group };
            this.scene.add(feeMesh);
            meshList.push(feeMesh);
        }

        const sourceByVin = new Map();
        (opts.sourceLinks || []).forEach((sl) => {
            if (sl.target == null || sl.vin == null) return;
            if (!sourceByVin.has(sl.vin)) sourceByVin.set(sl.vin, []);
            sourceByVin.get(sl.vin).push(sl.target);
        });

        // Inputs (extend left); record anchors for deeper levels.
        const inputAnchors = [];
        vins.forEach((vin, i) => {
            const port = L.inputPorts[i];
            if (!port) return;
            const r = L.inputArmR[i];
            const y = L.inY[i] ?? 0, z = L.inZ[i] || 0;
            const anchor = { x: centerX - 35 - L.inStub, y: centerY + y, z, r };
            const sources = sourceByVin.get(i);
            const funded = (fundedInputKeys && fundedInputKeys.has(`${tx.txid}:${i}`)) || (sources && sources.length);
            const geo = this._morphArmGeometry(this._laneTubePath(-1, port, y, L.inStub, L.holdLen, z, this._bendScale(), r), port, r, false);
            this._addTraceMesh(geo,
                funded ? FLAT_TONE : PARENT_INPUT_GRAD[0], funded ? FLAT_TONE : PARENT_INPUT_GRAD[1],
                funded
                    ? { type: 'parent-connection', group, level, data: { parentTxid: tx.txid, vin: i }, radius: r }
                    : { type: 'parent-input', group, level, index: i, data: vin, radius: r, originalColor: 0x555555, parentTxid: tx.txid },
                meshList, centre);
            (sources || []).forEach((source) => {
                this._addTraceBridge(source, anchor,
                    { type: 'parent-connection', group, level, data: { parentTxid: tx.txid, vin: i }, radius: r }, meshList, FLAT_TONE);
            });
            inputAnchors[i] = anchor;
        });

        // Outputs (extend right). Funding outputs bridge to the input they fund.
        const fundingByVout = new Map();
        (fundingLinks || []).forEach((fl) => {
            if (!fl.target) return;
            if (!fundingByVout.has(fl.vout)) fundingByVout.set(fl.vout, []);
            fundingByVout.get(fl.vout).push(fl.target);
        });
        const outputAnchors = [];
        const spentOutKeys = opts.spentOutputKeys;
        vouts.forEach((vout, i) => {
            const port = L.outputPorts[i];
            if (!port) return;
            const r = L.outputArmR[i];
            const y = L.outY[i] ?? 0, z = L.outZ[i] || 0;
            const anchor = { x: centerX + 35 + L.outStub, y: centerY + y, z, r };
            const targets = fundingByVout.get(i);
            const spent = spentOutKeys && spentOutKeys.has(`${tx.txid}:vout:${i}`);
            const flat = (targets && targets.length) || spent;
            const geo = this._morphArmGeometry(this._laneTubePath(1, port, y, L.outStub, L.holdLen, z, this._bendScale(), r), port, r, true);
            this._addTraceMesh(geo,
                flat ? FLAT_TONE : PARENT_OUTPUT_GRAD[0], flat ? FLAT_TONE : PARENT_OUTPUT_GRAD[1],
                (targets && targets.length)
                    ? { type: 'parent-connection', group, level, data: { parentTxid: tx.txid, vout: i }, radius: r }
                    : { type: 'parent-output', group, level, index: i, data: vout, radius: r, originalColor: 0x8a8a8a, originalOpacity: 1.0, parentTxid: tx.txid },
                meshList, centre);
            (targets || []).forEach((target) => {
                this._addTraceBridge(anchor, target,
                    { type: 'parent-connection', group, level, data: { parentTxid: tx.txid, vout: i }, radius: r }, meshList, FLAT_TONE);
            });
            outputAnchors[i] = anchor;
        });

        return { inputAnchors, outputAnchors };
    }

    // Replace the fading gradient on the given current-tx input tubes with a bright solid,
    // so a traced input reads as a continuous foreground path (brighter than history tubes).
    // Stashes the original texture on userData so clearParentTransactions can restore it.
    _flattenTracedInputs(inputIndices) {
        if (!inputIndices || inputIndices.size === 0) return;
        this.scene.children.forEach((child) => {
            if (child.userData.type !== 'input') return;
            if (!inputIndices.has(child.userData.index)) return;
            if (child.material && child.material.map && child.userData._origMap === undefined) {
                child.userData._origMap = child.material.map;
                child.userData._origTint = child.material.color.getHex();
                const flat = BitcoinTransactionExplorer.TUBE_TONES.CURRENT_FLAT;
                child.material.map = this.createHorizontalGradientTexture(flat, flat);
                child.material.color.setHex(0xffffff);
                child.material.needsUpdate = true;
            }
        });
    }

    // Restore the original fading gradient on any inputs flattened by _flattenTracedInputs.
    _restoreTracedInputs() {
        this.scene.children.forEach((child) => {
            if (child.userData.type !== 'input') return;
            if (child.userData._origMap === undefined) return;
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.map = child.userData._origMap;
                if (typeof child.userData._origTint === 'number') {
                    child.material.color.setHex(child.userData._origTint);
                }
                child.material.needsUpdate = true;
            }
            delete child.userData._origMap;
            delete child.userData._origTint;
        });
    }

    // Flatten current-tx output tubes that have a traced spending tx.
    _flattenTracedOutputs(outputIndices) {
        if (!outputIndices || outputIndices.size === 0) return;
        this.scene.children.forEach((child) => {
            if (child.userData.type !== 'output') return;
            if (!outputIndices.has(child.userData.index)) return;
            if (child.material && child.material.map && child.userData._origMap === undefined) {
                child.userData._origMap = child.material.map;
                child.userData._origTint = child.material.color.getHex();
                const flat = BitcoinTransactionExplorer.TUBE_TONES.CURRENT_FLAT;
                child.material.map = this.createHorizontalGradientTexture(flat, flat);
                child.material.color.setHex(0xffffff);
                child.material.needsUpdate = true;
            }
        });
    }

    _restoreTracedOutputs() {
        this.scene.children.forEach((child) => {
            if (child.userData.type !== 'output') return;
            if (child.userData._origMap === undefined) return;
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.map = child.userData._origMap;
                if (typeof child.userData._origTint === 'number') {
                    child.material.color.setHex(child.userData._origTint);
                }
                child.material.needsUpdate = true;
            }
            delete child.userData._origMap;
            delete child.userData._origTint;
        });
    }

    // Remove + dispose all tracked parent meshes (geometry, materials, textures). Leaves
    // this.tracedParents (the data) intact so a re-layout can redraw without re-fetching.
    _disposeParentMeshes() {
        this._disposeMeshList(this.parentMeshes);
        this.parentMeshes = [];
    }

    _disposeChildMeshes() {
        this._disposeMeshList(this.childMeshes);
        this.childMeshes = [];
    }

    _disposeMeshList(list) {
        (list || []).forEach((mesh) => {
            this.scene.remove(mesh);
            // Sprites share a module-level geometry in three.js — don't dispose it.
            if (mesh.geometry && !mesh.isSprite) mesh.geometry.dispose();
            if (mesh.material) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                mats.forEach((m) => { if (m.map && m.map !== this._feeHatch) m.map.dispose(); m.dispose(); });
            }
        });
    }

    _syncTraceMenuButtons() {
        const MAX_DEPTH = 6;
        const hasTrace = this.parentsLoaded || this.childrenLoaded;
        const inBtn = document.getElementById('trace-deeper');
        if (inBtn) {
            inBtn.textContent = 'Deeper Inputs';
            const inMax = this.traceDepth >= MAX_DEPTH;
            inBtn.disabled = !!this._tracing || inMax;
            inBtn.title = inMax
                ? `Max depth ${MAX_DEPTH} reached`
                : (this.traceDepth > 0
                    ? `Trace one more level backward (depth ${this.traceDepth})`
                    : 'Trace one more level backward');
        }
        const outBtn = document.getElementById('trace-deeper-outputs');
        if (outBtn) {
            outBtn.textContent = 'Deeper Outputs';
            const outMax = this.traceOutDepth >= MAX_DEPTH;
            outBtn.disabled = !!this._tracing || outMax;
            outBtn.title = outMax
                ? `Max depth ${MAX_DEPTH} reached`
                : (this.traceOutDepth > 0
                    ? `Trace one more level forward (depth ${this.traceOutDepth})`
                    : 'Trace one more level forward');
        }
        const spreadBtn = document.getElementById('spread-parents');
        if (spreadBtn) {
            spreadBtn.disabled = !hasTrace;
            spreadBtn.textContent = this.parentsSpread ? 'Collapse' : 'Spread';
            spreadBtn.title = this.parentsSpread
                ? 'Collapse traced transactions'
                : 'Spread traced transactions by block age';
        }
        const labelsBtn = document.getElementById('toggle-trace-labels');
        if (labelsBtn) {
            labelsBtn.disabled = !this.parentsSpread;
            if (this.showTraceLabels) {
                labelsBtn.textContent = 'Hide Labels';
                labelsBtn.title = 'Hide block numbers and dates';
            } else {
                labelsBtn.textContent = 'Show Labels';
                labelsBtn.title = 'Show block numbers and dates';
            }
        }
        const frameBtn = document.getElementById('frame-trace');
        if (frameBtn) {
            frameBtn.disabled = !hasTrace;
            frameBtn.title = hasTrace
                ? 'Fit the camera to the visible transaction history'
                : 'Trace inputs or outputs first';
        }
    }

    // Fetch + draw one more ancestor level (first click loads the immediate parents).
    async loadDeeperTrace() {
        if (this._tracing) return;
        const MAX_DEPTH = 6;
        if (this.traceDepth >= MAX_DEPTH) { this._syncTraceMenuButtons(); return; }
        const btn = document.getElementById('trace-deeper');
        this._tracing = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
        let added = 0;
        try {
            added = await this.loadParentTransactions();
        } catch (e) {
            console.error('Deeper Inputs failed', e);
        }
        if (this._disposed) return;
        this._tracing = false;
        if (added > 0) this.parentsLoaded = true;
        this._syncTraceMenuButtons();
        if (btn && added === 0 && this.traceDepth < MAX_DEPTH) {
            btn.title = 'No deeper parents to load';
        }
    }

    _updateTraceCamera() {
        const left = this.parentsLoaded ? (this._traceMinX || 0) : 0;
        const right = this.childrenLoaded ? (this._traceMaxX || 0) : 0;
        const span = Math.max(Math.abs(left), right, 1);
        this.controls.target.x = (left + right) / 2;
        this.controls.distance = Math.max(300, span * 1.2);
        this.updateCameraPosition();
    }

    // Fit the camera so the current tx plus all visible traced history is in view.
    frameTraceHistory() {
        if (!this.scene) return;
        const box = new THREE.Box3();
        const include = (obj) => {
            if (!obj || !obj.visible) return;
            if (obj.isSprite && obj.userData && obj.userData.type === 'parent-label' && !this.showTraceLabels) return;
            box.expandByObject(obj);
        };
        (this.parentMeshes || []).forEach(include);
        (this.childMeshes || []).forEach(include);
        this.scene.traverse((obj) => {
            const t = obj.userData && obj.userData.type;
            if (t === 'transaction' || t === 'input' || t === 'output') include(obj);
        });
        if (box.isEmpty()) return;

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        this.controls.target.set(center.x, center.y, 0);
        this.controls.panX = 0;
        this.controls.panY = 0;
        this.controls.panZ = 0;

        const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        const pad = 1.2;
        if (this.isPerspective) {
            const fov = ((this.camera && this.camera.fov) || 75) * Math.PI / 180;
            const distY = (size.y * 0.5 * pad) / Math.max(Math.tan(fov / 2), 0.01);
            const distX = (size.x * 0.5 * pad) / Math.max(Math.tan(fov / 2) * aspect, 0.01);
            this.controls.distance = Math.max(80, Math.max(distX, distY), Math.max(size.x, size.y) * 0.9);
        } else {
            this.orthographicZoom = Math.max(size.y * pad, size.x * pad / aspect, 8);
            if (this.camera && this.camera.isOrthographicCamera) {
                this.camera.left = -this.orthographicZoom * aspect / 2;
                this.camera.right = this.orthographicZoom * aspect / 2;
                this.camera.top = this.orthographicZoom / 2;
                this.camera.bottom = -this.orthographicZoom / 2;
                this.camera.updateProjectionMatrix();
            }
            this.controls.distance = Math.max(this.controls.distance, 80);
        }
        this.updateCameraPosition();
    }

    async _fetchOutspends(txid) {
        try {
            const resp = await fetch(`https://mempool.space/api/tx/${txid}/outspends`, { signal: this._ac.signal });
            if (!resp.ok) { console.warn('Trace Outputs: outspends failed', txid, resp.status); return []; }
            return await resp.json();
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            console.warn('Trace Outputs: outspends error', txid, e);
            return [];
        }
    }

    async loadChildTransactions() {
        const frontier = new Map();
        const addLink = (txid, shallowKey, vin, desiredY) => {
            if (!txid) return;
            if (!frontier.has(txid)) frontier.set(txid, []);
            frontier.get(txid).push({ shallowKey, vin, desiredY });
        };

        const collectFromOutspends = (txid, outspends, yOfVout, yOffset) => {
            (outspends || []).forEach((os, vout) => {
                if (!os || !os.spent || !os.txid) return;
                addLink(os.txid, `${txid}:vout:${vout}`, os.vin, (yOffset || 0) + (yOfVout(vout) || 0));
            });
        };

        if (this.traceOutDepth === 0) {
            const outspends = await this._fetchOutspends(this.txid);
            if (this._disposed) return 0;
            collectFromOutspends(this.txid, outspends, (vout) => this.yPositionsOutputs?.[vout] ?? 0, 0);
        } else {
            const deepest = this.traceOutNodes.filter((n) => n.level === this.traceOutDepth);
            const perNode = [];
            const queue = deepest.slice();
            const worker = async () => {
                while (queue.length) {
                    const node = queue.shift();
                    const outspends = await this._fetchOutspends(node.tx.txid);
                    perNode.push({ node, outspends });
                }
            };
            const n = Math.min(8, deepest.length);
            const workers = [];
            for (let i = 0; i < n; i++) workers.push(worker());
            await Promise.all(workers);
            if (this._disposed) return 0;
            perNode.forEach(({ node, outspends }) => {
                const outY = this._txArmLayout(node.tx).outY;
                collectFromOutspends(node.tx.txid, outspends, (vout) => outY[vout] ?? 0, node.centerY);
            });
        }

        if (frontier.size === 0) return 0;

        let txids = Array.from(frontier.keys());
        const MAX_CHILDREN = 250;
        if (txids.length > MAX_CHILDREN) {
            console.warn(`Trace Outputs: capping level at ${MAX_CHILDREN} of ${txids.length} children`);
            txids = txids.slice(0, MAX_CHILDREN);
        }

        const fetched = await this._fetchParents(txids);
        if (this._disposed) return 0;

        const entries = [];
        for (const txid of txids) {
            const tx = fetched.get(txid);
            if (!tx) continue;
            const links = frontier.get(txid);
            const desiredY = links.reduce((s, l) => s + l.desiredY, 0) / links.length;
            entries.push({
                tx,
                links: links.map((l) => ({ shallowKey: l.shallowKey, vin: l.vin })),
                desiredY,
                halfHeight: this._parentHalfHeight(tx),
                blockHeight: tx.status?.block_height
            });
        }
        if (entries.length === 0) return 0;

        entries.sort((a, b) => b.desiredY - a.desiredY);
        const GAP = 6;
        let prevBottom = Infinity;
        const newLevel = this.traceOutDepth + 1;
        for (const e of entries) {
            let centerY = e.desiredY;
            if (centerY + e.halfHeight > prevBottom - GAP) centerY = prevBottom - GAP - e.halfHeight;
            prevBottom = centerY - e.halfHeight;
            this.traceOutNodes.push({ tx: e.tx, level: newLevel, centerY, links: e.links, blockHeight: e.blockHeight });
        }
        this.traceOutDepth = newLevel;

        if (newLevel === 1) {
            const tracedOutputs = new Set();
            entries.forEach((e) => e.links.forEach((l) => {
                const parts = l.shallowKey.split(':');
                if (parts[0] === this.txid && parts[1] === 'vout') tracedOutputs.add(parseInt(parts[2], 10));
            }));
            this._flattenTracedOutputs(tracedOutputs);
        }

        this._layoutChildren(this.parentsSpread);
        return entries.length;
    }

    async loadDeeperOutputTrace() {
        if (this._tracing) return;
        const MAX_DEPTH = 6;
        if (this.traceOutDepth >= MAX_DEPTH) { this._syncTraceMenuButtons(); return; }
        const btn = document.getElementById('trace-deeper-outputs');
        this._tracing = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
        let added = 0;
        try {
            added = await this.loadChildTransactions();
        } catch (e) {
            console.error('Deeper Outputs failed', e);
        }
        if (this._disposed) return;
        this._tracing = false;
        if (added > 0) this.childrenLoaded = true;
        this._syncTraceMenuButtons();
        if (btn && added === 0 && this.traceOutDepth < MAX_DEPTH) {
            btn.title = 'No deeper spending transactions to load';
        }
    }

    // Extra x distance for one trace level beyond the fixed level spacing (sized for 20-unit
    // arms): room for longer arms on the side facing the previous level (nearStub), and for a
    // bridge long enough to cover its sideways jump at a gentle slope and a wide curve.
    // `links` returns this node's [{ from: anchor already drawn, y, z: its own lane end
    // relative to the node, r: its own arm radius }]. layoutFor(node) is its (pinned) layout.
    _traceLevelShift(nodes, layoutFor, nearStub, links, baseGap) {
        let near = 0, need = 0;
        nodes.forEach((node) => {
            near = Math.max(near, nearStub(layoutFor(node)) - 20);
            links(node).forEach(({ from, y, z, r }) => {
                const h = Math.hypot(from.y - (node.centerY + y), (from.z || 0) - z);
                // gentle slope, and a wide enough S for a thick bridge (see _armBend)
                need = Math.max(need, h * 1.5, Math.sqrt(20 * h * Math.max(from.r || 0, r || 0)));
            });
        });
        return near + Math.min(600, Math.max(0, need - baseGap));
    }

    _layoutChildren(spread) {
        this._disposeChildMeshes();
        if (!(this.traceOutNodes || []).length) {
            this._traceMaxX = 0;
            this._updateTraceCamera();
            return;
        }

        const outputAnchorMap = new Map();
        const curL = this._txArmLayout(this.transactionData);
        const outputs = this.transactionData?.vout || [];
        outputs.forEach((_, i) => {
            outputAnchorMap.set(`${this.txid}:vout:${i}`, { x: 35 + curL.outLen, y: this.yPositionsOutputs?.[i] ?? 0, z: this.zPositionsOutputs?.[i] || 0, r: this.outputArmR?.[i] });
        });

        const spentOutputKeys = new Set();
        (this.traceOutNodes || []).forEach((n) => n.links.forEach((l) => spentOutputKeys.add(l.shallowKey)));

        const currentHeight = this.transactionData?.status?.block_height;
        const BASE_X = 230;
        const LEVEL_GAP = 340;
        const SPREAD_SCALE = 320;
        let maxX = BASE_X;

        const labelCols = [];
        const noteColumn = (x, height, time, topY, txid) => {
            if (!spread) return;
            labelCols.push({ x, height, time, topY, txid });
        };
        if (!this.parentsLoaded) {
            noteColumn(0, currentHeight, this.transactionData?.status?.block_time,
                this._parentHalfHeight(this.transactionData), this.txid);
        }

        // Accumulated extra spacing for long tree arms / big bridges (0 for short aligned arms)
        let shift = 0, prevFar = curL.outLen - 120;
        for (let lvl = 1; lvl <= this.traceOutDepth; lvl++) {
            const nodes = this.traceOutNodes.filter((n) => n.level === lvl);
            // Inputs spending an output already drawn take that output's width
            const reqFor = (node) => {
                const m = new Map();
                node.links.forEach((l) => { const a = outputAnchorMap.get(l.shallowKey); if (a && a.r) m.set(l.vin, a.r); });
                return { in: m };
            };
            const layoutFor = (node) => this._txArmLayout(node.tx, reqFor(node));
            shift += prevFar + this._traceLevelShift(nodes, layoutFor, (L) => L.inStub, (node) => {
                const L = layoutFor(node);
                return node.links.map((l) => ({ from: outputAnchorMap.get(l.shallowKey), y: L.inY[l.vin] ?? 0, z: L.inZ[l.vin] || 0, r: L.inputArmR[l.vin] }))
                    .filter((x) => x.from);
            }, lvl === 1 ? 20 : LEVEL_GAP - 110);
            prevFar = nodes.reduce((m, n) => Math.max(m, layoutFor(n).outStub - 20), 0);
            nodes.forEach((node) => {
                let centerX;
                if (spread && currentHeight && node.blockHeight) {
                    const age = Math.max(0, node.blockHeight - currentHeight);
                    centerX = BASE_X + (lvl - 1) * LEVEL_GAP + Math.log10(age + 1) * SPREAD_SCALE;
                } else {
                    centerX = BASE_X + (lvl - 1) * LEVEL_GAP;
                }
                centerX += shift;
                maxX = Math.max(maxX, centerX);
                const sourceLinks = node.links
                    .map((l) => ({ vin: l.vin, target: outputAnchorMap.get(l.shallowKey) }))
                    .filter((x) => x.target);
                const drawn = this.drawTraceNode(node.tx, centerX, node.centerY, [], null, {
                    meshList: this.childMeshes,
                    group: 'child',
                    sourceLinks,
                    spentOutputKeys,
                    level: lvl,
                    req: reqFor(node)
                });
                (drawn.outputAnchors || []).forEach((pt, j) => {
                    outputAnchorMap.set(`${node.tx.txid}:vout:${j}`, pt);
                });
                noteColumn(centerX, node.blockHeight, node.tx.status?.block_time,
                    node.centerY + this._parentHalfHeight(node.tx), node.tx.txid);
            });
        }

        labelCols.forEach((c) => {
            this._addTraceLabelSprite(c, this.childMeshes, 'child');
        });

        this._traceMaxX = maxX + 80;
        this._updateTraceCamera();
    }

    clearChildTransactions() {
        this._restoreTracedOutputs();
        this._disposeChildMeshes();
        this.traceOutNodes = [];
        this.traceOutDepth = 0;
        this.childrenLoaded = false;
        this._traceMaxX = 0;
        this._syncTraceMenuButtons();
        if (this.parentsLoaded) this._updateTraceCamera();
        else {
            this.controls.target.x = 0;
            this.updateCameraPosition();
        }
    }

    // Render all traced levels. Disposes current parent meshes, then redraws from this.traceNodes
    // shallow-to-deep, threading an anchor map so each level's funding outputs connect to the
    // previous level's input far ends. No re-fetching.
    //   spread=false: compact — each level shifted left by a fixed gap.
    //   spread=true:  older nodes (by block height vs the current tx) pushed further left, log-scaled.
    _layoutParents(spread) {
        this._disposeParentMeshes();

        // Seed anchors with the current tx's input far ends (x = -(35 + inLen)).
        const curL = this._txArmLayout(this.transactionData);
        const anchorMap = new Map();
        const inputs = this.transactionData?.vin || [];
        inputs.forEach((input, i) => {
            anchorMap.set(`${this.txid}:${i}`, { x: -35 - curL.inLen, y: this.yPositionsInputs?.[i] ?? 0, z: this.zPositionsInputs?.[i] || 0, r: this.inputArmR?.[i] });
        });

        // Every input that some node funds (across all levels) — these get a flat, uninterrupted
        // tube instead of the dim gradient stub, so deeper funding paths connect seamlessly.
        const fundedInputKeys = new Set();
        (this.traceNodes || []).forEach((n) => n.links.forEach((l) => fundedInputKeys.add(l.shallowKey)));

        const currentHeight = this.transactionData?.status?.block_height;
        const BASE_X = -230;
        const LEVEL_GAP = 340;     // compact spacing between levels
        const SPREAD_SCALE = 320;  // world units per order-of-magnitude of block age
        let minX = BASE_X;

        const labelCols = [];
        const noteColumn = (x, height, time, topY, txid) => {
            if (!spread) return;
            labelCols.push({ x, height, time, topY, txid });
        };
        // Anchor the timeline with the current transaction at x=0.
        noteColumn(0, currentHeight, this.transactionData?.status?.block_time,
            this._parentHalfHeight(this.transactionData), this.txid);

        // Accumulated extra spacing for long tree arms / big bridges (0 for short aligned arms)
        let shift = 0, prevFar = curL.inLen - 120;
        for (let lvl = 1; lvl <= this.traceDepth; lvl++) {
            const nodes = this.traceNodes.filter((n) => n.level === lvl);
            // Outputs funding an input already drawn take that input's width
            const reqFor = (node) => {
                const m = new Map();
                node.links.forEach((l) => { const a = anchorMap.get(l.shallowKey); if (a && a.r) m.set(l.vout, a.r); });
                return { out: m };
            };
            const layoutFor = (node) => this._txArmLayout(node.tx, reqFor(node));
            shift += prevFar + this._traceLevelShift(nodes, layoutFor, (L) => L.outStub, (node) => {
                const L = layoutFor(node);
                return node.links.map((l) => ({ from: anchorMap.get(l.shallowKey), y: L.outY[l.vout] ?? 0, z: L.outZ[l.vout] || 0, r: L.outputArmR[l.vout] }))
                    .filter((x) => x.from);
            }, lvl === 1 ? 20 : LEVEL_GAP - 110);
            prevFar = nodes.reduce((m, n) => Math.max(m, layoutFor(n).inStub - 20), 0);
            nodes.forEach((node) => {
                let centerX;
                if (spread && currentHeight && node.blockHeight) {
                    // Spread by block age, plus a per-level offset so deeper levels stay
                    // separated even when their block ages are similar.
                    const age = Math.max(0, currentHeight - node.blockHeight);
                    centerX = BASE_X - (lvl - 1) * LEVEL_GAP - Math.log10(age + 1) * SPREAD_SCALE;
                } else {
                    centerX = BASE_X - (lvl - 1) * LEVEL_GAP;
                }
                centerX -= shift;
                minX = Math.min(minX, centerX);
                const fundingLinks = node.links
                    .map((l) => ({ vout: l.vout, target: anchorMap.get(l.shallowKey) }))
                    .filter((x) => x.target);
                const drawn = this.drawTraceNode(node.tx, centerX, node.centerY, fundingLinks, fundedInputKeys, { level: lvl, req: reqFor(node) });
                (drawn.inputAnchors || []).forEach((pt, j) => anchorMap.set(`${node.tx.txid}:${j}`, pt));
                noteColumn(centerX, node.blockHeight, node.tx.status?.block_time,
                    node.centerY + this._parentHalfHeight(node.tx), node.tx.txid);
            });
        }

        // Draw block/date labels above each column (spread mode only).
        labelCols.forEach((c) => {
            this._addTraceLabelSprite(c, this.parentMeshes, 'parent');
        });

        // Frame everything from the current tx (x=0) out to the furthest node.
        this._traceMinX = minX - 80;
        this._updateTraceCamera();
    }

    // Short date "May 22, 2010" from a unix (seconds) block time.
    _shortDate(unixSec) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = new Date(unixSec * 1000);
        return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    _shortTxid(txid) {
        if (!txid) return '';
        return txid.length > 16 ? `${txid.substring(0, 16)}...` : txid;
    }

    // Two-line sprite: txid, then block height + date in the same style.
    _makeLabelSprite(line1, line2) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#dddddd';
        if (line1) {
            ctx.font = '36px Helvetica, Arial, sans-serif';
            ctx.fillText(line1, 256, 40);
        }
        if (line2) {
            ctx.font = '28px Helvetica, Arial, sans-serif';
            ctx.fillText(line2, 256, 88);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.userData.labelAspect = canvas.height / canvas.width;
        sprite.userData.labelBaseW = 95;
        this._applyTraceLabelScale(sprite);
        sprite.renderOrder = 10;
        return sprite;
    }

    // Button handler: toggle traced nodes between compact and spread-by-block-age layouts.
    toggleSpreadParents() {
        if ((!this.parentsLoaded || !(this.traceNodes || []).length) &&
            (!this.childrenLoaded || !(this.traceOutNodes || []).length)) return;
        this.parentsSpread = !this.parentsSpread;
        if (this.parentsLoaded) this._layoutParents(this.parentsSpread);
        if (this.childrenLoaded) this._layoutChildren(this.parentsSpread);
        this._syncTraceMenuButtons();
    }

    _traceLabelZoomScale() {
        // Sprites shrink on screen as the camera recedes; grow world scale with distance
        // so labels stay readable far out and don't dominate in close-up.
        const t = this.isPerspective
            ? this.controls.distance / 280
            : this.orthographicZoom / 70;
        return Math.max(0.18, Math.min(10, Math.pow(Math.max(t, 0.02), 0.92)));
    }

    _applyTraceLabelScale(sprite) {
        if (!sprite || !sprite.userData) return;
        const w = (sprite.userData.labelBaseW || 95) * this._traceLabelZoomScale();
        const aspect = sprite.userData.labelAspect || (128 / 512);
        sprite.scale.set(w, w * aspect, 1);
    }

    _updateTraceLabelScales() {
        if (this.showLabels) this._updateSceneLabels();
        if (!this.parentsSpread) return;
        const apply = (mesh) => {
            if (mesh && mesh.userData && mesh.userData.type === 'parent-label') {
                this._applyTraceLabelScale(mesh);
            }
        };
        (this.parentMeshes || []).forEach(apply);
        (this.childMeshes || []).forEach(apply);
    }

    _addTraceLabelSprite(col, meshList, group) {
        const heightPart = col.height ? col.height.toLocaleString() : 'Unconfirmed';
        const datePart = col.time ? this._shortDate(col.time) : '';
        const meta = datePart ? `${heightPart}  ${datePart}` : heightPart;
        const sprite = this._makeLabelSprite(this._shortTxid(col.txid), meta);
        sprite.position.set(col.x, col.topY + 16, 0);
        sprite.visible = !!this.showTraceLabels;
        sprite.userData.type = 'parent-label';
        sprite.userData.group = group;
        this.scene.add(sprite);
        meshList.push(sprite);
        return sprite;
    }

    toggleTraceLabels() {
        if (!this.parentsSpread) return;
        this.showTraceLabels = !this.showTraceLabels;
        const apply = (mesh) => {
            if (mesh && mesh.userData && mesh.userData.type === 'parent-label') {
                mesh.visible = this.showTraceLabels;
            }
        };
        (this.parentMeshes || []).forEach(apply);
        (this.childMeshes || []).forEach(apply);
        this._syncTraceMenuButtons();
    }

    // Remove and dispose all traced geometry and reset the traced-input gradients.
    clearParentTransactions() {
        this._restoreTracedInputs();
        this._disposeParentMeshes();
        this.traceNodes = [];
        this.traceDepth = 0;
        this.parentsLoaded = false;
        this._traceMinX = 0;
        this._syncTraceMenuButtons();
        if (this.childrenLoaded) this._updateTraceCamera();
        else {
            this.parentsSpread = false;
            this.controls.target.x = 0;
            this.updateCameraPosition();
        }
    }

    // Dispose tracked meshes and reset all trace state/UI (called on new-tx load; the scene
    // sweep has already removed the meshes, so this only frees GPU resources + refs).
    _resetParentState() {
        this._disposeParentMeshes();
        this._disposeChildMeshes();
        this.traceNodes = [];
        this.traceDepth = 0;
        this.parentsLoaded = false;
        this.traceOutNodes = [];
        this.traceOutDepth = 0;
        this.childrenLoaded = false;
        this.parentsSpread = false;
        this.showTraceLabels = false;
        this._tracing = false;
        this._traceMinX = 0;
        this._traceMaxX = 0;
        const menu = document.getElementById('trace-menu');
        const toggle = document.getElementById('trace-menu-toggle');
        if (menu) { menu.classList.remove('is-open'); menu.hidden = true; }
        if (toggle) toggle.classList.remove('active');
        this._syncTraceMenuButtons();
    }

    // Note: Input tubes are now unified objects (straight + curved as one)
    // Repositioning is handled during creation based on input radii

    animate() {
        if (this._glassTime) this._glassTime.value = performance.now() / 1000;
        if (this.isRotating) {
            this.controls.theta += 0.001;
            this.updateCameraPosition();
        }

        this.vrManager && this.vrManager.update();
        (window.ExplorerFX ? ExplorerFX.render(this.renderer, this.scene, this.camera) : this.renderer.render(this.scene, this.camera));
    }

    async checkOutputSpendingStatus() {
        if (!this.transactionData || !this.transactionData.vout) return;
        
        console.log('\n=== CHECKING OUTPUT SPENDING STATUS ===');
        
        // Get all output tubes from the scene (now unified objects)
        const outputTubes = this.scene.children.filter(child => child.userData.type === 'output');
        
        // Check each output's spending status
        for (let i = 0; i < this.transactionData.vout.length; i++) {
            try {
                // Cached per tx so a layout rebuild (Tree toggle) doesn't refetch every output
                if (!this._outspendCache || this._outspendCache.txid !== this.txid) {
                    this._outspendCache = { txid: this.txid, data: [] };
                }
                let spendingData = this._outspendCache.data[i];
                let response = { ok: true };
                if (!spendingData) {
                    response = await fetch(`https://mempool.space/api/tx/${this.txid}/outspend/${i}`);
                    if (response.ok) spendingData = this._outspendCache.data[i] = await response.json();
                }
                
                if (response.ok) {
                    console.log(`Output ${i} spending status:`, spendingData);
                    
                    // Find the corresponding tube
                    const tube = outputTubes.find(t => t.userData.index === i);
                    
                    if (tube) {
                        const tubeRadius = tube.userData.radius || 1;
                        const y = this.yPositionsOutputs?.[i] ?? ((this.transactionData.vout.length - 1) - i * 2);
                        
                        // Store spending data on the tube
                        tube.userData.spendingData = spendingData;
                        
                        if (spendingData.spent) {
                            // Spent output: grey out the tube (keeps long length)
                            tube.material.color.setHex(0xdddddd);
                            tube.userData.originalColor = 0xdddddd;
                            // Lighter glass with a bright edge but no flow: value has moved on
                            this._setGlass(tube.material, { core: 0.32, rim: 1.1, flow: 0 });
                            console.log(`Output ${i} is SPENT - greyed out`);
                        } else {
                            // Unspent output: shorter straight section + hemisphere cap
                            const unspentStraightLength = Math.max(15, this._armLengthFor(this.outputPorts?.[i] || { y: 0, z: 0 },
                                y, this.zPositionsOutputs?.[i] || 0, tubeRadius, this.armHoldLen));
                            const farEndX = 35 + unspentStraightLength;
                            
                            // Recreate tube with shorter path (same Voronoi port)
                            const port = this.outputPorts?.[i] || { y: 0, z: 0, r: tubeRadius,
                                poly: this.createCircularPolygon(0, 0, tubeRadius, 24).map(p => ({ y: p.y, z: p.x })) };
                            const curvePath = this._laneTubePath(1, port, y, unspentStraightLength, this.armHoldLen, this.zPositionsOutputs?.[i] || 0, this._bendScale(), tubeRadius);
                            
                            // Replace tube geometry
                            const newGeometry = this._morphArmGeometry(curvePath, port, tubeRadius, true);
                            tube.geometry.dispose();
                            tube.geometry = newGeometry;
                            
                            // Change to solid white color with strong emission (like hover state)
                            tube.material.map = null;
                            tube.material.color.setHex(0xffffff);
                            tube.material.opacity = 1.0;
                            tube.material.emissive = new THREE.Color(0xffffff);
                            tube.material.emissiveIntensity = 0.6;
                            tube.material.needsUpdate = true;
                            tube.userData.originalColor = 0xffffff;
                            tube.userData.originalOpacity = 1.0;
                            tube.userData.originalEmissive = 0xffffff;
                            tube.userData.originalEmissiveIntensity = 0.6;
                            // Solid, glowing and pulsing: value still sits here
                            tube.material.emissiveIntensity = 1.0;
                            tube.userData.originalEmissiveIntensity = 1.0;
                            this._setGlass(tube.material, { core: 1.0, rim: 0.9, flow: 0.3 });
                            
                            // Add hemisphere cap at the far end with strong emission
                            const capGeometry = new THREE.SphereGeometry(tubeRadius, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
                            const capMaterial = new THREE.MeshLambertMaterial({ 
                                color: 0xffffff,
                                transparent: true,
                                opacity: 1.0,
                                emissive: 0xffffff,
                                emissiveIntensity: 1.0,
                                side: THREE.DoubleSide,
                                depthWrite: true,
                                depthTest: true
                            });
                            const hemisphere = new THREE.Mesh(capGeometry, capMaterial);
                            hemisphere.renderOrder = 1;
                            
                            // Rotate hemisphere so its opening faces inward (toward -X / the transaction)
                            hemisphere.rotation.z = -Math.PI / 2;
                            
                            // Position at the far end of the shorter tube
                            hemisphere.position.set(farEndX, y, this.zPositionsOutputs?.[i] || 0);
                            const outLabel = this.outputLabels?.[i];
                            if (outLabel) { outLabel.userData.labelAnchor.x = farEndX + tubeRadius; this._placeSceneLabel(outLabel); }
                            hemisphere.userData = { 
                                type: 'output-cap', 
                                index: i,
                                data: this.transactionData.vout[i],
                                radius: tubeRadius,
                                originalOpacity: 1.0,
                                originalColor: 0xffffff,
                                originalEmissive: 0xffffff,
                                originalEmissiveIntensity: 1.0
                            };
                            this.scene.add(hemisphere);
                            
                            console.log(`Output ${i} is UNSPENT - shortened tube + added hemisphere cap`);
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
                5000
            );
            this.isPerspective = false;
        } else {
            // Switch to perspective
            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 60000);
            this.isPerspective = true;
        }
        
        // Restore position and target
        this.camera.position.copy(currentPosition);
        this.controls.target.copy(currentTarget);
        this.camera.lookAt(this.controls.target);
        this._updateTraceLabelScales();
        
        // Update the button text
        const button = document.getElementById('toggle-view');
        if (button) {
            button.textContent = this.isPerspective ? 'Orthographic' : 'Perspective';
        }
    }

    onWindowResize() {
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) return;
        // Get the container dimensions (respects split screen when raw data panel is open)
        const container = document.getElementById('container');
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        if (this.isPerspective) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        } else {
            const aspect = width / height;
            this.camera.left = -this.orthographicZoom * aspect / 2;
            this.camera.right = this.orthographicZoom * aspect / 2;
            this.camera.top = this.orthographicZoom / 2;
            this.camera.bottom = -this.orthographicZoom / 2;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(width, height);
    }

    setupPanelToggle() {
        const toggleBtn = document.getElementById('toggle-panel');
        const panelContent = document.getElementById('tx-info');
        
        if (toggleBtn && panelContent) {
            toggleBtn.addEventListener('click', () => {
                const isMinimized = panelContent.classList.contains('minimized');
                
                const icon = toggleBtn.querySelector('.panel-toggle-icon');
                if (isMinimized) {
                    panelContent.classList.remove('minimized');
                    if (icon) icon.src = 'imgs/icons/chevron-up.svg';
                    toggleBtn.title = 'Minimize';
                    toggleBtn.setAttribute('aria-label', 'Minimize panel');
                } else {
                    panelContent.classList.add('minimized');
                    if (icon) icon.src = 'imgs/icons/chevron-down.svg';
                    toggleBtn.title = 'Maximize';
                    toggleBtn.setAttribute('aria-label', 'Maximize panel');
                }
            });
        }
    }

    updateRotationButtonState() {
        setRotationButtonState(this.isRotating);
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

        // Famous transactions: load immediately on click
        famousTransactions.forEach(button => {
            button.addEventListener('click', () => {
                const txid = button.getAttribute('data-txid');
                if (!txid) return;
                modal.style.display = 'none';
                const currentUrl = new URL(window.location);
                currentUrl.searchParams.set('txid', txid);
                explorerNavigate(currentUrl.toString());
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
            explorerNavigate(currentUrl.toString());
        });
    }
    
    // Navigation methods
    rotateLeft() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.theta -= 0.2;
        this.updateCameraPosition();
    }
    
    rotateRight() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.theta += 0.2;
        this.updateCameraPosition();
    }
    
    rotateUp() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.phi -= 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.updateCameraPosition();
    }
    
    rotateDown() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.phi += 0.2;
        this.controls.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.controls.phi));
        this.updateCameraPosition();
    }
    
    _panStep() {
        // Scale the button pan step proportionally with zoom distance (strong far, fine when close).
        return 1.4 * (this.controls.distance / 130);
    }

    panLeft() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.panX -= this._panStep();
        this.updateCameraPosition();
    }

    panRight() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.panX += this._panStep();
        this.updateCameraPosition();
    }

    panUp() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.panY += this._panStep();
        this.updateCameraPosition();
    }

    panDown() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.panY -= this._panStep();
        this.updateCameraPosition();
    }
    
    zoomIn() {
        this.isRotating = false;
        this.updateRotationButtonState();
        // Multiplicative step so it stays proportional at any scale, over the full zoom range.
        this.controls.distance *= 0.88;
        this.controls.distance = Math.max(0.2, Math.min(20000, this.controls.distance));
        this.updateCameraPosition();
    }

    zoomOut() {
        this.isRotating = false;
        this.updateRotationButtonState();
        this.controls.distance /= 0.88;
        this.controls.distance = Math.max(0.2, Math.min(20000, this.controls.distance));
        this.updateCameraPosition();
    }
    
    // Raw transaction data methods
    setupRawDataPanel() {
        // Raw data button - toggle panel
        document.getElementById('show-raw-data').addEventListener('click', () => {
            const modal = document.getElementById('raw-data-modal');
            if (modal.classList.contains('active')) {
                this.hideRawDataModal();
            } else {
                this.fetchRawTxData();
            }
        });
        
        // Raw data panel controls
        document.getElementById('close-raw-data').addEventListener('click', () => {
            this.hideRawDataModal();
        });
        
        document.getElementById('download-raw-data').addEventListener('click', () => {
            this.downloadRawData();
        });
        
        document.getElementById('copy-raw-data').addEventListener('click', () => {
            this.copyRawData();
        });
        
        // Close panel on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideRawDataModal();
            }
        });
        
        // Bytes per line dropdown
        document.getElementById('bytes-per-line').addEventListener('change', (e) => {
            const bytesValue = parseInt(e.target.value);
            this.reformatRawData(bytesValue);
            
            // Update URL with bytes parameter
            const url = new URL(window.location);
            url.searchParams.set('bytes', bytesValue);
            window.history.pushState({}, '', url);
        });
        
        // Set bytes per line from URL if provided
        if (this.urlBytesPerLine) {
            const bytesDropdown = document.getElementById('bytes-per-line');
            const validValues = ['16', '32', '64', '128', '256', '512'];
            if (validValues.includes(this.urlBytesPerLine)) {
                bytesDropdown.value = this.urlBytesPerLine;
            }
        }
        
        // View toggle (Hex/ASCII/Binary)
        document.getElementById('view-hex').addEventListener('click', () => {
            if (this.rawViewMode !== 'hex') {
                this.rawViewMode = 'hex';
                this.updateViewToggleButtons();
                document.getElementById('bytes-per-line').disabled = false;
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.delete('view'); // hex is default, remove param
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-ascii').addEventListener('click', () => {
            if (this.rawViewMode !== 'ascii') {
                this.rawViewMode = 'ascii';
                this.updateViewToggleButtons();
                document.getElementById('bytes-per-line').disabled = false;
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'ascii');
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-binary').addEventListener('click', () => {
            if (this.rawViewMode !== 'binary') {
                this.rawViewMode = 'binary';
                this.updateViewToggleButtons();
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'binary');
                window.history.pushState({}, '', url);
            }
        });
        
        document.getElementById('view-dump').addEventListener('click', () => {
            if (this.rawViewMode !== 'dump') {
                this.rawViewMode = 'dump';
                this.updateViewToggleButtons();
                document.getElementById('bytes-per-line').disabled = true;
                this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
                
                // Update URL with view parameter
                const url = new URL(window.location);
                url.searchParams.set('view', 'dump');
                window.history.pushState({}, '', url);
            }
        });
        
        // Decode toggle button
        document.getElementById('toggle-decode').addEventListener('click', () => {
            this.decodeMode = !this.decodeMode;
            const decodeBtn = document.getElementById('toggle-decode');
            const legend = document.getElementById('decode-legend');
            
            if (this.decodeMode) {
                decodeBtn.classList.add('active');
                legend.style.display = 'flex';
                // Parse transaction if not already done
                if (!this.decodedSections && this.rawTxData) {
                    this.decodedSections = this.parseTransaction(this.rawTxData.bytes);
                }
            } else {
                decodeBtn.classList.remove('active');
                legend.style.display = 'none';
            }
            
            // Re-render with or without decode highlighting
            this.reformatRawData(parseInt(document.getElementById('bytes-per-line').value) || 32);
            
            // Update URL with decode parameter
            const url = new URL(window.location);
            if (this.decodeMode) {
                url.searchParams.set('decode', 'on');
            } else {
                url.searchParams.delete('decode');
            }
            window.history.pushState({}, '', url);
        });
        
        // Auto-open raw data panel if URL parameter is set
        if (this.urlRawDataOpen) {
            this.fetchRawTxData();
        }
    }
    
    // Voronoi Treemap methods
    setupTreemapPanel() {
        // Treemap button - toggle panel
        document.getElementById('toggle-labels')?.addEventListener('click', () => this.toggleLabels());
        document.getElementById('toggle-tree')?.addEventListener('click', () => this.toggleTreeLayout());
        document.getElementById('toggle-tree')?.classList.toggle('active', !!this.treeLayout);
        document.getElementById('toggle-labels')?.classList.toggle('active', !!this.showLabels);

        document.getElementById('show-treemap')?.addEventListener('click', () => {
            const container = document.getElementById('treemap-container');
            if (container.style.display === 'none' || container.style.display === '') {
                this.showTreemap();
            } else {
                this.hideTreemap();
            }
        });
        
        // Close treemap
        document.getElementById('close-treemap')?.addEventListener('click', () => {
            this.hideTreemap();
        });
        
        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const container = document.getElementById('treemap-container');
                if (container && container.style.display !== 'none') {
                    this.hideTreemap();
                }
            }
        });
    }
    
    showTreemap() {
        const container = document.getElementById('treemap-container');
        if (!container) return;
        
        container.style.display = 'flex';
        document.body.classList.add('treemap-open');
        this.renderTreemaps();
        
        // Trigger resize to update camera
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
    
    hideTreemap() {
        const container = document.getElementById('treemap-container');
        if (container) {
            container.style.display = 'none';
        }
        
        document.body.classList.remove('treemap-open');
        
        // Clean up update intervals
        if (this.inputTreemapUpdateInterval) {
            clearInterval(this.inputTreemapUpdateInterval);
            this.inputTreemapUpdateInterval = null;
        }
        if (this.outputTreemapUpdateInterval) {
            clearInterval(this.outputTreemapUpdateInterval);
            this.outputTreemapUpdateInterval = null;
        }
        
        // Trigger resize to update camera
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
    
    async renderTreemaps() {
        if (!this.transactionData) return;
        
        // Wait for Voronoi.js to load (library exposes as window.voronoi, lowercase)
        if (typeof voronoi === 'undefined' || !voronoi.Treemap) {
            const container = document.getElementById('treemap-container');
            if (container) {
                container.querySelector('.treemap-content').innerHTML = 
                    '<div style="color: #fff; padding: 40px; text-align: center;">Loading Voronoi.js library...<br><small>If this message persists, the library may have failed to load.</small></div>';
            }
            
            // Try again after a short delay
            setTimeout(() => {
                if (typeof voronoi !== 'undefined' && voronoi.Treemap) {
                    this.renderTreemaps();
                } else {
                    const container = document.getElementById('treemap-container');
                    if (container) {
                        container.querySelector('.treemap-content').innerHTML = 
                            '<div style="color: #f44; padding: 40px; text-align: center;">Error: Voronoi.js library failed to load.<br><small>Please check your internet connection and refresh the page.</small></div>';
                    }
                }
            }, 1000);
            return;
        }
        
        // Prepare input data
        const inputs = this.transactionData.vin || [];
        const outputs = this.transactionData.vout || [];
        
        // Check if coinbase
        const isCoinbase = inputs.length > 0 && (
            inputs[0].coinbase !== undefined || 
            inputs[0].txid === '0000000000000000000000000000000000000000000000000000000000000000'
        );
        
        // Calculate total output value for coinbase
        const totalOutputValue = outputs.reduce((sum, out) => sum + (out.value || 0), 0);
        
        // Build input hierarchy
        const inputData = {
            name: 'inputs',
            children: inputs.map((input, i) => {
                const value = isCoinbase ? totalOutputValue : (input.prevout?.value || 1);
                const address = input.prevout?.scriptpubkey_address || (isCoinbase ? 'Coinbase' : 'Unknown');
                return {
                    name: address.length > 12 ? address.substring(0, 6) + '...' + address.slice(-4) : address,
                    fullAddress: address,
                    value: value,
                    index: i,
                    isCoinbase: isCoinbase && i === 0,
                    txid: input.txid
                };
            })
        };
        
        // Build output hierarchy - check spending status
        const outputData = {
            name: 'outputs',
            children: await Promise.all(outputs.map(async (output, i) => {
                const value = output.value || 1;
                const address = output.scriptpubkey_address || 'Unknown';
                
                // Check spending status
                let isSpent = false;
                try {
                    const response = await fetch(`https://mempool.space/api/tx/${this.txid}/outspend/${i}`);
                    if (response.ok) {
                        const spendingData = await response.json();
                        isSpent = spendingData.spent || false;
                    }
                } catch (error) {
                    console.error(`Error checking spending status for output ${i}:`, error);
                }
                
                return {
                    name: address.length > 12 ? address.substring(0, 6) + '...' + address.slice(-4) : address,
                    fullAddress: address,
                    value: value,
                    index: i,
                    scriptType: output.scriptpubkey_type,
                    scriptpubkey: output.scriptpubkey,
                    scriptpubkey_asm: output.scriptpubkey_asm,
                    value_hex: output.value_hex,
                    output: output, // Store full output object for tooltip
                    isSpent: isSpent
                };
            }))
        };
        
        // Render treemaps
        this.renderVoronoiTreemap('#input-treemap', inputData, 'input');
        this.renderVoronoiTreemap('#output-treemap', outputData, 'output');
    }
    
    // Draw one face of the 3D cylinder: the very same Voronoi cells (this.treemapLayout),
    // seen face-on with z → right and y → up. Both discs share one radius, as in 3D; the
    // output disc includes the fee cell, so outputs + fee visibly fill the same circle.
    renderVoronoiTreemap(selector, data, type) {
        const container = document.querySelector(selector);
        const layout = this.treemapLayout;
        if (!container || !layout) return;
        container.innerHTML = '';

        const width = container.clientWidth || 300;
        const height = container.clientHeight || 300;
        // Margin leaves room for the fee's outside label; same on both discs so they compare 1:1
        const radius = Math.min(width, height) / 2 - 28;
        const cx = width / 2, cy = height / 2;
        const k = radius / layout.discR;

        const leaves = (data.children || []).slice();
        const ports = type === 'input' ? layout.inputPorts : layout.outputCells;
        if (type === 'output' && layout.fee > 0) {
            leaves.push({ name: 'Fee', value: layout.fee, index: leaves.length, isFee: true });
        }

        const svg = d3.select(selector).append('svg')
            .attr('width', width).attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`);

        const cells = leaves.map((leaf, i) => {
            const port = ports[i];
            if (!port) return null;
            const pts = port.poly.map(q => [cx + (port.z + q.z) * k, cy - (port.y + q.y) * k]);
            const key = leaf.isFee ? 'fee' : `${type}:${leaf.index}`;
            return { leaf, port, pts, key, areaPx: port.area * k * k };
        }).filter(Boolean);

        // Same look as the 3D faces: see-through glass cells with thin white outlines;
        // unspent outputs glow solid white, inputs carry their 3D tint, the fee is grey.
        const shades = BitcoinTransactionExplorer.INPUT_SHADES;
        const hex = (n) => '#' + n.toString(16).padStart(6, '0');
        const fillFor = (c) => {
            if (c.leaf.isFee) return '#8a8a8a';
            if (type === 'input') return c.leaf.isCoinbase ? '#ffffff' : hex(shades[c.leaf.index % shades.length]);
            return '#ffffff';
        };
        const baseOpacity = (c) => {
            if (c.leaf.isFee) return 1;
            if (type === 'input') return c.leaf.isCoinbase ? 0.3 : 0.12;
            return c.leaf.isSpent === false ? 0.9 : 0.08;
        };

        // Glass edge: brighter toward the rim, like the 3D cylinder's fresnel
        const gradId = `glass-${type}-${Date.now()}`;
        const defs = svg.append('defs');
        const grad = defs.append('radialGradient').attr('id', gradId);
        // Fee: grey diagonal hatch, matching the striped stub in 3D
        const hatchId = `fee-hatch-${type}-${Date.now()}`;
        const hatch = defs.append('pattern').attr('id', hatchId)
            .attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5)
            .attr('patternTransform', 'rotate(45)');
        hatch.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#8a8a8a').attr('fill-opacity', 0.35);
        hatch.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 5)
            .attr('stroke', '#dcdcdc').attr('stroke-width', 2.2);
        grad.append('stop').attr('offset', '55%').attr('stop-color', '#fff').attr('stop-opacity', 0);
        grad.append('stop').attr('offset', '100%').attr('stop-color', '#fff').attr('stop-opacity', 0.14);

        svg.append('g').attr('class', 'treemap-cell-group')
            .selectAll('path.treemap-cell')
            .data(cells)
            .enter()
            .append('path')
            .attr('class', 'treemap-cell')
            .attr('data-key', c => c.key)
            .attr('d', c => 'M' + c.pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z')
            .attr('fill', c => c.leaf.isFee ? `url(#${hatchId})` : fillFor(c))
            .attr('fill-opacity', c => c.leaf.isFee ? 1 : baseOpacity(c))
            .attr('data-base-opacity', baseOpacity)
            .attr('stroke', 'rgba(255,255,255,0.55)')
            .attr('stroke-width', 0.75)
            .attr('stroke-linejoin', 'round')
            .on('mouseover', (event, c) => this.showTreemapTooltip(event, c.leaf, c.leaf.isFee ? 'fee' : type))
            .on('mousemove', (event) => this.moveTreemapTooltip(event))
            .on('mouseout', () => this.hideTreemapTooltip())
            // Click selects (same as clicking the arm in 3D); double-click navigates
            .on('click', (event, c) => {
                this._selection = this._selection === c.key ? null : c.key;
                this._applySelection();
            })
            .on('dblclick', (event, c) => { if (!c.leaf.isFee) this.handleTreemapClick(event, c.leaf, type); });

        // Fee is always labelled: inside its cell if it fits, else just outside the rim
        cells.filter(c => c.leaf.isFee).forEach((c) => {
            const px = cx + c.port.z * k, py = cy - c.port.y * k;
            if (c.areaPx >= 1800) {
                svg.append('text').attr('class', 'treemap-label treemap-fee-label')
                    .attr('x', px).attr('y', py).attr('dy', '0.35em').text('FEE');
                return;
            }
            const ang = Math.atan2(py - cy, px - cx);
            const lx = cx + Math.cos(ang) * (radius + 16), ly = cy + Math.sin(ang) * (radius + 16);
            svg.append('line').attr('class', 'treemap-fee-leader')
                .attr('x1', px).attr('y1', py).attr('x2', lx).attr('y2', ly);
            svg.append('text').attr('class', 'treemap-label treemap-fee-label')
                .attr('x', lx + (Math.cos(ang) >= 0 ? 4 : -4)).attr('y', ly).attr('dy', '0.35em')
                .attr('text-anchor', Math.cos(ang) >= 0 ? 'start' : 'end').text('FEE');
        });

        // Labels on cells big enough to hold one
        cells.forEach((c) => {
            if (c.leaf.isFee || c.areaPx < 1800) return;
            const dark = type === 'output' && c.leaf.isSpent === false;
            svg.append('text')
                .attr('class', c.areaPx > 4500 ? 'treemap-label' : 'treemap-label treemap-label-small')
                .attr('x', cx + c.port.z * k)
                .attr('y', cy - c.port.y * k)
                .attr('dy', '0.35em')
                .style('fill', dark ? '#000' : '#fff')
                .style('text-shadow', dark ? 'none' : null)
                .text(c.leaf.name);
        });

        svg.append('circle')
            .attr('class', 'treemap-border')
            .attr('cx', cx).attr('cy', cy).attr('r', radius)
            .attr('fill', `url(#${gradId})`)
            .attr('pointer-events', 'none')
            .attr('stroke', 'rgba(255,255,255,0.85)').attr('stroke-width', 1.25);

        // Totals under the disc: inputs = outputs + fee
        const btc = (sats) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, '') + ' BTC';
        const outTotal = (this.transactionData.vout || []).reduce((a, o) => a + (o.value || 0), 0);
        const caption = document.createElement('div');
        caption.className = 'treemap-caption';
        caption.textContent = type === 'input'
            ? `${btc(layout.totalIn)} in`
            : (layout.fee > 0 ? `${btc(outTotal)} out + ${btc(layout.fee)} fee` : `${btc(outTotal)} out`);
        container.parentElement.querySelector('.treemap-caption')?.remove();
        container.parentElement.appendChild(caption);

        this._syncTreemapSelection();
    }

    // Mirror the 3D selection in the side panel: selected cell bright, the rest faded
    _syncTreemapSelection() {
        const sel = this._selection || null;
        document.querySelectorAll('#treemap-container path.treemap-cell').forEach((el) => {
            const base = parseFloat(el.getAttribute('data-base-opacity')) || 0.1;
            const key = el.getAttribute('data-key');
            const op = !sel ? base : (key === sel ? Math.max(base, 0.85) : base * 0.25);
            el.setAttribute('fill-opacity', op);
            el.setAttribute('stroke-width', sel && key === sel ? 1.75 : 0.75);
            el.setAttribute('stroke', sel && key !== sel ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.55)');
        });
    }

    createCircularPolygon(centerX, centerY, radius, sides) {
        const polygon = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * 2 * Math.PI;
            polygon.push({
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            });
        }
        return polygon;
    }
    
    
    showTreemapTooltip(event, d, type) {
        // Remove existing tooltip
        d3.select('.treemap-tooltip').remove();
        
        const data = d.data || d;
        const amount = (data.value / 100000000).toFixed(8);
        const amountSats = data.value.toLocaleString();
        
        if (type === 'fee') {
            const tl = this.treemapLayout;
            const pct = tl && tl.totalIn ? ((data.value / tl.totalIn) * 100).toFixed(3) : '0';
            d3.select('body').append('div').attr('class', 'treemap-tooltip')
                .style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px')
                .html(`<strong>Fee</strong><br><span class="amount">${(data.value / 1e8).toFixed(8)} BTC</span>` +
                    `<br><span style="color: #94a3b8; font-size: 10px;">${pct}% of inputs</span>` +
                    `<br><em>Inputs − outputs, claimed by the miner</em>`);
            return;
        }
        let content = `<strong>${type === 'input' ? 'Input' : 'Output'} ${data.index + 1}</strong>`;
        content += `<br><span class="amount">${amount} BTC</span>`;
        content += `<br><span style="color: #94a3b8; font-size: 10px;">${amountSats} satoshis</span>`;
        
        // Calculate percentage of total
        if (this.transactionData) {
            let totalValue;
            if (type === 'input') {
                // For inputs, calculate total based on the same logic used in renderTreemaps
                const inputs = this.transactionData.vin || [];
                const isCoinbase = inputs.length > 0 && (
                    inputs[0].coinbase !== undefined || 
                    inputs[0].txid === '0000000000000000000000000000000000000000000000000000000000000000'
                );
                const totalOutputValue = (this.transactionData.vout || []).reduce((sum, out) => sum + (out.value || 0), 0);
                
                totalValue = inputs.reduce((sum, input, i) => {
                    const isInputCoinbase = isCoinbase && i === 0;
                    return sum + (isInputCoinbase ? totalOutputValue : (input.prevout?.value || 0));
                }, 0);
            } else {
                // For outputs, sum all output values
                totalValue = (this.transactionData.vout || []).reduce((sum, output) => sum + (output.value || 0), 0);
            }
            
            if (totalValue > 0) {
                const percentage = ((data.value / totalValue) * 100).toFixed(2);
                content += `<br><span style="color: #94a3b8; font-size: 10px;">${percentage}% of total</span>`;
            }
        }
        
        if (data.isCoinbase) {
            content += `<br><em style="color: #ffffff;">Coinbase (Block Reward)</em>`;
        } else if (data.fullAddress && data.fullAddress !== 'Unknown') {
            content += `<br><span class="address">${data.fullAddress}</span>`;
        }
        
        if (data.scriptType) {
            content += `<br><span style="color: #94a3b8; font-size: 10px;">Script Type: ${data.scriptType}</span>`;
        }
        
        // Add more details for outputs
        if (type === 'output' && data.output) {
            const output = data.output;
            
            // ScriptPubKey (truncated)
            if (output.scriptpubkey) {
                const scriptPreview = output.scriptpubkey.length > 32 
                    ? output.scriptpubkey.substring(0, 32) + '...' 
                    : output.scriptpubkey;
                content += `<br><span style="color: #94a3b8; font-size: 9px; font-family: monospace;">Script: ${scriptPreview}</span>`;
            }
            
            // ScriptPubKey ASM (if available, truncated)
            if (output.scriptpubkey_asm) {
                const asmPreview = output.scriptpubkey_asm.length > 40 
                    ? output.scriptpubkey_asm.substring(0, 40) + '...' 
                    : output.scriptpubkey_asm;
                content += `<br><span style="color: #94a3b8; font-size: 9px; font-family: monospace;">ASM: ${asmPreview}</span>`;
            }
            
            // Value in hex
            if (output.value_hex) {
                content += `<br><span style="color: #94a3b8; font-size: 9px; font-family: monospace;">Value (hex): ${output.value_hex}</span>`;
            }
        }
        
        // Add input details
        if (type === 'input' && !data.isCoinbase && data.txid) {
            content += `<br><span style="color: #94a3b8; font-size: 9px; font-family: monospace;">Source TX: ${data.txid.substring(0, 16)}...</span>`;
        }
        
        d3.select('body')
            .append('div')
            .attr('class', 'treemap-tooltip')
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .html(content);
    }
    
    moveTreemapTooltip(event) {
        d3.select('.treemap-tooltip')
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    }
    
    hideTreemapTooltip() {
        d3.select('.treemap-tooltip').remove();
    }
    
    handleTreemapClick(event, d, type) {
        const data = d.data || d;
        
        if (event.shiftKey) {
            // Shift+click: go to address
            const address = data.fullAddress;
            if (address && address !== 'Unknown' && address !== 'Coinbase') {
                explorerNavigate(`address.html?address=${address}`);
            }
        } else {
            // Click: go to transaction
            if (type === 'input' && !data.isCoinbase && data.txid) {
                explorerNavigate(`transaction.html?txid=${data.txid}`);
            }
        }
    }
    
    async fetchRawTxData() {
        if (!this.txid) {
            console.error('No transaction ID available');
            return;
        }
        
        const textElement = document.getElementById('raw-data-text');
        const sizeElement = document.getElementById('raw-data-size');
        const downloadBtn = document.getElementById('download-raw-data');
        
        // Show panel
        this.showRawDataModal();
        
        // If data is already loaded for this tx, just show it
        if (this.rawTxData && this.rawTxData.txid === this.txid) {
            return;
        }
        
        // Show loading state
        textElement.textContent = 'Loading...';
        textElement.className = 'raw-data-loading';
        sizeElement.textContent = 'Loading...';
        downloadBtn.disabled = true;
        
        try {
            const response = await fetch(`https://mempool.space/api/tx/${this.txid}/hex`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const hexString = await response.text();
            
            // Convert hex to bytes for ASCII view
            const bytes = new Uint8Array(hexString.length / 2);
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
            }
            
            // Store raw data
            this.rawTxData = {
                hex: hexString,
                bytes: bytes,
                txid: this.txid
            };
            
            // Format size
            const sizeBytes = bytes.length;
            const sizeFormatted = sizeBytes >= 1024 
                ? `${(sizeBytes / 1024).toFixed(2)} KB`
                : `${sizeBytes} bytes`;
            
            sizeElement.textContent = `Size: ${sizeFormatted} (${hexString.length.toLocaleString()} hex chars)`;
            
            // Parse transaction for decode mode
            this.decodedSections = this.parseTransaction(bytes);
            
            // Enable decode mode from URL if set
            if (this.urlDecodeMode && !this.decodeMode) {
                this.decodeMode = true;
                document.getElementById('toggle-decode').classList.add('active');
                document.getElementById('decode-legend').style.display = 'flex';
            }
            
            // Display data based on current view mode
            textElement.className = '';
            const bytesPerLine = parseInt(document.getElementById('bytes-per-line').value) || 32;
            await this.reformatRawData(bytesPerLine);
            
            downloadBtn.disabled = false;
            
        } catch (error) {
            console.error('Error fetching raw tx data:', error);
            textElement.className = '';
            textElement.textContent = `Error loading raw transaction data:\n${error.message}`;
            sizeElement.textContent = 'Error';
        }
    }
    
    async reformatRawData(bytesPerLine) {
        if (!this.rawTxData || !this.rawTxData.hex) {
            return;
        }
        
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawTxData.hex;
        const bytes = this.rawTxData.bytes;
        
        // Adjust font size based on bytes per line and view mode
        // ASCII = 2x hex, Binary gets progressively smaller at higher bytes/line
        const isAscii = this.rawViewMode === 'ascii';
        const isBinary = this.rawViewMode === 'binary';
        if (bytesPerLine >= 512) {
            textElement.style.fontSize = isAscii ? '0.12vw' : isBinary ? '0.015vw' : '0.06vw';
        } else if (bytesPerLine >= 256) {
            textElement.style.fontSize = isAscii ? '0.24vw' : isBinary ? '0.03vw' : '0.12vw';
        } else if (bytesPerLine >= 128) {
            textElement.style.fontSize = isAscii ? '0.6vw' : isBinary ? '0.07vw' : '0.3vw';
        } else if (bytesPerLine >= 64) {
            textElement.style.fontSize = isAscii ? '1vw' : isBinary ? '0.15vw' : '0.5vw';
        } else {
            textElement.style.fontSize = isAscii ? '20px' : isBinary ? '4px' : '10px';
        }
        
        // If decode mode is active, render with colored sections
        if (this.decodeMode && this.decodedSections) {
            if (this.rawViewMode === 'dump') {
                await this.renderDecodedDump();
            } else {
            this.renderDecodedData(bytesPerLine);
            }
            return;
        }
        
        if (this.rawViewMode === 'ascii') {
            // ASCII view
            const asciiString = this.bytesToAscii(bytes);
            const regex = new RegExp(`.{1,${bytesPerLine}}`, 'g');
            const formatted = asciiString.match(regex)?.join('\n') || asciiString;
            textElement.textContent = formatted;
        } else if (this.rawViewMode === 'binary') {
            // Binary view - 8 chars per byte
            const binaryString = this.bytesToBinary(bytes);
            const charsPerLine = bytesPerLine * 8;
            const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
            const formatted = binaryString.match(regex)?.join('\n') || binaryString;
            textElement.textContent = formatted;
        } else if (this.rawViewMode === 'dump') {
            // Hex dump view - classic format with offset, hex, and ASCII
            // Use HTML rendering to match decoded dump structure
            textElement.style.fontSize = '11px';
            this.renderDumpPlain();
        } else {
            // Hex view
            const charsPerLine = bytesPerLine * 2;
            const regex = new RegExp(`.{1,${charsPerLine}}`, 'g');
            const formattedHex = hexString.match(regex)?.join('\n') || hexString;
            textElement.textContent = formattedHex;
        }
    }
    
    renderDecodedData(bytesPerLine) {
        const textElement = document.getElementById('raw-data-text');
        const hexString = this.rawTxData.hex;
        const bytes = this.rawTxData.bytes;
        
        // Convert byte positions to character positions based on view mode
        const getCharPos = (bytePos) => {
            if (this.rawViewMode === 'ascii') {
                return bytePos;
            } else if (this.rawViewMode === 'binary') {
                return bytePos * 8;
            } else {
                return bytePos * 2;
            }
        };
        
        // Get the full string in current view mode
        let fullString;
        let charsPerLine;
        if (this.rawViewMode === 'ascii') {
            fullString = this.bytesToAscii(bytes);
            charsPerLine = bytesPerLine;
        } else if (this.rawViewMode === 'binary') {
            fullString = this.bytesToBinary(bytes);
            charsPerLine = bytesPerLine * 8;
        } else {
            fullString = hexString;
            charsPerLine = bytesPerLine * 2;
        }
        
        // Build HTML with colored spans
        // Sort sections by start position
        const sortedSections = [...this.decodedSections].sort((a, b) => a.start - b.start);
        
        let html = '';
        let currentCharPos = 0;
        let currentLinePos = 0;
        
        // Helper to add text with line breaks
        const addTextWithBreaks = (text, cssClass, section) => {
            let remaining = text;
            while (remaining.length > 0) {
                const spaceOnLine = charsPerLine - currentLinePos;
                const chunk = remaining.substring(0, spaceOnLine);
                remaining = remaining.substring(spaceOnLine);
                
                if (cssClass) {
                    const dataAttrs = section ? `data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"` : '';
                    html += `<span class="decode-section ${cssClass}" ${dataAttrs}>${this.escapeHtml(chunk)}</span>`;
                } else {
                    html += this.escapeHtml(chunk);
                }
                
                currentLinePos += chunk.length;
                if (currentLinePos >= charsPerLine && remaining.length > 0) {
                    html += '\n';
                    currentLinePos = 0;
                }
            }
        };
        
        for (const section of sortedSections) {
            const sectionStartChar = getCharPos(section.start);
            const sectionEndChar = getCharPos(section.end);
            
            // Add any gap before this section
            if (sectionStartChar > currentCharPos) {
                const gapText = fullString.substring(currentCharPos, sectionStartChar);
                addTextWithBreaks(gapText, null, null);
            }
            
            // Add the section with coloring
            const sectionText = fullString.substring(sectionStartChar, sectionEndChar);
            addTextWithBreaks(sectionText, section.cssClass, section);
            
            currentCharPos = sectionEndChar;
        }
        
        // Add any remaining text after the last section
        if (currentCharPos < fullString.length) {
            const remainingText = fullString.substring(currentCharPos);
            addTextWithBreaks(remainingText, null, null);
        }
        
        textElement.innerHTML = html;
        
        // Set up tooltip handlers
        this.setupDecodeTooltips();
    }
    
    renderDumpPlain() {
        const textElement = document.getElementById('raw-data-text');
        const bytes = this.rawTxData.bytes;
        const bytesPerLine = 16;
        
        let html = '';
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (using span for consistency with decoded view)
            const offset = i.toString(16).padStart(8, '0');
            html += `<span class="dump-offset">${offset}</span>  `;
            
            // Hex bytes (each wrapped in span for consistent spacing)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const hexByte = byte.toString(16).padStart(2, '0');
                    html += `<span class="dump-byte">${hexByte}</span> `;
                } else {
                    html += '   ';
                }
                if (j === 7) html += ' ';
            }
            
            html += '|';
            
            // ASCII (each wrapped in span for consistency)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                    html += `<span class="dump-ascii">${this.escapeHtml(char)}</span>`;
                } else {
                    html += ' ';
                }
            }
            
            html += '|\n';
        }
        
        textElement.innerHTML = html.trimEnd();
    }
    
    async renderDecodedDump(highlightByteStart = null, highlightByteEnd = null) {
        const textElement = document.getElementById('raw-data-text');
        const bytes = this.rawTxData.bytes;
        const bytesPerLine = 16; // Standard dump format
        
        // Set consistent font size for dump view
        textElement.style.fontSize = '11px';
        
        // Show loading for large transactions
        if (bytes.length > 50000) {
            textElement.innerHTML = 'Decoding dump view...';
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Create a map of byte position to section for quick lookup
        const byteToSection = new Map();
        for (const section of this.decodedSections) {
            for (let i = section.start; i < section.end; i++) {
                byteToSection.set(i, section);
            }
        }
        
        // Helper to check if byte is in highlight range
        const isHighlighted = (byteIndex) => {
            return highlightByteStart !== null && 
                   byteIndex >= highlightByteStart && 
                   byteIndex < highlightByteEnd;
        };
        
        let html = '';
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (using span for consistency)
            const offset = i.toString(16).padStart(8, '0');
            html += `<span class="dump-offset">${offset}</span>  `;
            
            // Hex bytes (always wrapped in span for consistent spacing)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const hexByte = byte.toString(16).padStart(2, '0');
                    const section = byteToSection.get(byteIndex);
                    const highlighted = isHighlighted(byteIndex);
                    
                    let classes = 'dump-byte';
                    let dataAttrs = '';
                    
                    if (section) {
                        classes += ` decode-section ${section.cssClass}`;
                        dataAttrs = ` data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"`;
                    }
                    if (highlighted) {
                        classes += section ? ' tx-highlight-decode' : ' tx-highlight';
                    }
                    
                    html += `<span class="${classes}"${dataAttrs}>${hexByte}</span> `;
                } else {
                    html += '   ';
                }
                // Extra space between the two groups of 8
                if (j === 7) html += ' ';
            }
            
            html += '|';
            
            // ASCII representation (always wrapped in span for consistency)
            for (let j = 0; j < bytesPerLine; j++) {
                const byteIndex = i + j;
                if (byteIndex < bytes.length) {
                    const byte = bytes[byteIndex];
                    const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                    const escapedChar = this.escapeHtml(char);
                    const section = byteToSection.get(byteIndex);
                    const highlighted = isHighlighted(byteIndex);
                    
                    let classes = 'dump-ascii';
                    let dataAttrs = '';
                    
                    if (section) {
                        classes += ` decode-section ${section.cssClass}`;
                        dataAttrs = ` data-label="${this.escapeAttr(section.label)}" data-value="${this.escapeAttr(String(section.value))}"`;
                    }
                    if (highlighted) {
                        classes += section ? ' tx-highlight-decode' : ' tx-highlight';
                    }
                    
                    html += `<span class="${classes}"${dataAttrs}>${escapedChar}</span>`;
                } else {
                    html += ' ';
                }
            }
            
            html += '|\n';
        }
        
        textElement.innerHTML = html.trimEnd();
        
        if (highlightByteStart !== null) {
            textElement.classList.add('has-highlight');
        }
        
        this.setupDecodeTooltips();
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    escapeAttr(text) {
        return text.replace(/&/g, '&amp;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#39;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');
    }
    
    setupDecodeTooltips() {
        // Create tooltip element if it doesn't exist
        let tooltip = document.getElementById('decode-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'decode-tooltip';
            tooltip.className = 'decode-tooltip';
            tooltip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.95);padding:8px 12px;font-size:13px;color:#fff;z-index:99999;max-width:350px;font-family:monospace;display:none;';
            document.body.appendChild(tooltip);
        }
        
        // Color map matching SatSigner's color scheme
        // https://github.com/satsigner/satsigner/blob/master/apps/mobile/components/SSTransactionDecoded.tsx#L69
        const sectionColors = {
            'decode-version': '#ffffff',
            'decode-marker': '#888888',
            'decode-flag': '#ffffff',
            'decode-txInVarInt': '#888888',
            'decode-txInHash': '#E01919',
            'decode-txInIndex': '#860B0B',
            'decode-txInScriptVarInt': '#DD9595',
            'decode-txInScript': '#860B0B',
            'decode-txInSequence': '#860B0B',
            'decode-txOutVarInt': '#93CC92',
            'decode-txOutValue': '#07BC03',
            'decode-txOutScriptVarInt': '#93CC92',
            'decode-txOutScript': '#608A64',
            'decode-witnessVarInt': '#8F5252',
            'decode-witnessItemsVarInt': '#8F5252',
            'decode-witnessItem': '#694040',
            'decode-witnessItemEmpty': '#694040',
            'decode-witnessItemPubkey': '#8F5252',
            'decode-witnessItemSignature': '#694040',
            'decode-witnessItemScript': '#694040',
            'decode-locktime': '#eeeeee',
            // Ordinals Inscription colors - envelope/content-type in muted red tones
            'decode-inscriptionEnvelope': '#A5463C',
            'decode-inscriptionContentTypeTag': '#964B41',
            'decode-inscriptionContentType': '#964B41',
            'decode-inscriptionBodyTag': '#694040',
            'decode-inscriptionBody': '#694040',
            'decode-inscriptionPushOpcode': '#8C4137',
            'decode-inscriptionBodyChunk': '#694040',
            'decode-inscriptionEndif': '#8F5252',
            'decode-inscriptionUnknownTag': '#694040',
            'decode-inscriptionUnknownValue': '#694040',
            // Taproot script elements - witness-related, muted reds
            'decode-taprootPubkeyPush': '#694040',
            'decode-taprootPubkey': '#8F5252',
            'decode-opChecksig': '#694040',
            // Taproot control block - witness-related, muted reds
            'decode-controlBlockPush': '#694040',
            'decode-controlByte': '#8F5252',
            'decode-internalPubkey': '#8F5252',
            'decode-merkleProof': '#694040'
        };
        
        const textElement = document.getElementById('raw-data-text');
        
        // Remove any existing global listener
        if (this._tooltipHandler) {
            textElement.removeEventListener('mouseover', this._tooltipHandler);
            textElement.removeEventListener('mouseout', this._tooltipOutHandler);
        }
        
        // Mouseover handler
        this._tooltipHandler = (e) => {
            const section = e.target.closest('.decode-section');
            if (section) {
                const label = section.getAttribute('data-label');
                const value = section.getAttribute('data-value');
                // Get the color from the section's class
                let color = '#fff';
                for (const [cls, clr] of Object.entries(sectionColors)) {
                    if (section.classList.contains(cls)) {
                        color = clr;
                        break;
                    }
                }
                if (label) {
                    const escapedLabel = this.escapeHtml(label);
                    const escapedValue = this.escapeHtml(value || '');
                    tooltip.innerHTML = '<div style="font-weight:bold;color:' + this.escapeAttr(color) + ';margin-bottom:4px;">' + escapedLabel + '</div><div style="color:rgba(255,255,255,0.8);">' + escapedValue + '</div>';
                    tooltip.style.left = (e.clientX + 15) + 'px';
                    tooltip.style.top = (e.clientY + 15) + 'px';
                    tooltip.style.display = 'block';
                }
            }
        };
        
        // Mouseout handler  
        this._tooltipOutHandler = (e) => {
            if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.decode-section')) {
                tooltip.style.display = 'none';
            }
        };
        
        textElement.addEventListener('mouseover', this._tooltipHandler);
        textElement.addEventListener('mouseout', this._tooltipOutHandler);
    }
    
    bytesToAscii(bytes) {
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            if (byte >= 32 && byte <= 126) {
                result += String.fromCharCode(byte);
            } else {
                result += '.';
            }
        }
        return result;
    }
    
    bytesToBinary(bytes) {
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            result += bytes[i].toString(2).padStart(8, '0');
        }
        return result;
    }
    
    bytesToDump(bytes) {
        // Classic hex dump format: offset | hex bytes | ASCII
        let result = '';
        const bytesPerLine = 16;
        
        for (let i = 0; i < bytes.length; i += bytesPerLine) {
            // Offset (8 hex chars)
            const offset = i.toString(16).padStart(8, '0');
            
            // Hex bytes (two groups of 8 bytes)
            let hexPart = '';
            let asciiPart = '';
            
            for (let j = 0; j < bytesPerLine; j++) {
                if (i + j < bytes.length) {
                    const byte = bytes[i + j];
                    hexPart += byte.toString(16).padStart(2, '0') + ' ';
                    // ASCII: printable range 32-126, else '.'
                    asciiPart += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                } else {
                    hexPart += '   ';
                    asciiPart += ' ';
                }
                // Add extra space between the two groups of 8
                if (j === 7) hexPart += ' ';
            }
            
            result += `${offset}  ${hexPart} |${asciiPart}|\n`;
        }
        
        return result.trimEnd();
    }
    
    // Parse a Bitcoin transaction and return sections with byte ranges
    // Based on SatSigner's txDecoded.ts implementation
    parseTransaction(bytes) {
        const sections = [];
        let offset = 0;
        
        // Helper to read bytes without advancing
        const peekBytes = (n) => bytes.slice(offset, offset + n);
        
        // Helper to read bytes
        const readBytes = (n) => {
            const slice = bytes.slice(offset, offset + n);
            offset += n;
            return slice;
        };
        
        // Helper to read little-endian integer
        const readLE = (n) => {
            let val = 0;
            for (let i = 0; i < n; i++) {
                val += bytes[offset + i] * Math.pow(256, i);
            }
            offset += n;
            return val;
        };
        
        // Helper to read VarInt and return start/end positions
        const readVarInt = () => {
            const start = offset;
            const first = bytes[offset++];
            let value;
            if (first < 0xfd) {
                value = first;
            } else if (first === 0xfd) {
                value = readLE(2);
            } else if (first === 0xfe) {
                value = readLE(4);
            } else {
                value = readLE(8);
            }
            return { value, start, end: offset };
        };
        
        // Helper to convert bytes to hex
        const toHex = (arr) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Helper to reverse endianness
        const reverseHex = (arr) => Array.from(arr).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
        
        try {
            // Version (4 bytes)
            const versionStart = offset;
            const version = readLE(4);
            sections.push({
                type: 'version',
                start: versionStart,
                end: offset,
                label: 'Version',
                value: version,
                cssClass: 'decode-version'
            });
            
            // Check for SegWit marker (0x00) and flag (0x01)
            let isSegWit = false;
            if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
                isSegWit = true;
                // Marker
                const markerStart = offset;
                offset += 1;
                sections.push({
                    type: 'marker',
                    start: markerStart,
                    end: offset,
                    label: 'Marker',
                    value: '00',
                    cssClass: 'decode-marker'
                });
                // Flag
                const flagStart = offset;
                offset += 1;
                sections.push({
                    type: 'flag',
                    start: flagStart,
                    end: offset,
                    label: 'Flag',
                    value: '01',
                    cssClass: 'decode-flag'
                });
            }
            
            // Input count (VarInt)
            const inputCountInfo = readVarInt();
            const inputCount = inputCountInfo.value;
            sections.push({
                type: 'txInVarInt',
                start: inputCountInfo.start,
                end: inputCountInfo.end,
                label: 'Input Count',
                value: inputCount,
                cssClass: 'decode-txInVarInt'
            });
            
            // Inputs
            for (let i = 0; i < inputCount; i++) {
                // Previous TX hash (32 bytes)
                const hashStart = offset;
                const prevTxHash = reverseHex(readBytes(32));
                sections.push({
                    type: 'txInHash',
                    start: hashStart,
                    end: offset,
                    label: `Input ${i} TXID`,
                    value: prevTxHash.substring(0, 16) + '...',
                    cssClass: 'decode-txInHash'
                });
                
                // Output index (4 bytes)
                const indexStart = offset;
                const outputIndex = readLE(4);
                sections.push({
                    type: 'txInIndex',
                    start: indexStart,
                    end: offset,
                    label: `Input ${i} Vout`,
                    value: outputIndex,
                    cssClass: 'decode-txInIndex'
                });
                
                // Script length (VarInt)
                const scriptLenInfo = readVarInt();
                const scriptLen = scriptLenInfo.value;
                sections.push({
                    type: 'txInScriptVarInt',
                    start: scriptLenInfo.start,
                    end: scriptLenInfo.end,
                    label: `Input ${i} Script Length`,
                    value: scriptLen,
                    cssClass: 'decode-txInScriptVarInt'
                });
                
                // Script (variable)
                if (scriptLen > 0) {
                    const scriptStart = offset;
                    const script = readBytes(scriptLen);
                    sections.push({
                        type: 'txInScript',
                        start: scriptStart,
                        end: offset,
                        label: `Input ${i} ScriptSig`,
                        value: toHex(script).substring(0, 20) + (scriptLen > 10 ? '...' : ''),
                        cssClass: 'decode-txInScript'
                    });
                }
                
                // Sequence (4 bytes)
                const seqStart = offset;
                const sequence = readLE(4);
                sections.push({
                    type: 'txInSequence',
                    start: seqStart,
                    end: offset,
                    label: `Input ${i} Sequence`,
                    value: '0x' + sequence.toString(16).padStart(8, '0'),
                    cssClass: 'decode-txInSequence'
                });
            }
            
            // Output count (VarInt)
            const outputCountInfo = readVarInt();
            const outputCount = outputCountInfo.value;
            sections.push({
                type: 'txOutVarInt',
                start: outputCountInfo.start,
                end: outputCountInfo.end,
                label: 'Output Count',
                value: outputCount,
                cssClass: 'decode-txOutVarInt'
            });
            
            // Outputs
            for (let i = 0; i < outputCount; i++) {
                // Value (8 bytes) - in satoshis
                const valueStart = offset;
                const valueLow = readLE(4);
                const valueHigh = readLE(4);
                const satoshis = valueLow + valueHigh * 0x100000000;
                sections.push({
                    type: 'txOutValue',
                    start: valueStart,
                    end: offset,
                    label: `Output ${i} Value`,
                    value: `${satoshis} sats (${(satoshis / 100000000).toFixed(8)} BTC)`,
                    cssClass: 'decode-txOutValue'
                });
                
                // Script length (VarInt)
                const scriptLenInfo = readVarInt();
                const scriptLen = scriptLenInfo.value;
                sections.push({
                    type: 'txOutScriptVarInt',
                    start: scriptLenInfo.start,
                    end: scriptLenInfo.end,
                    label: `Output ${i} Script Length`,
                    value: scriptLen,
                    cssClass: 'decode-txOutScriptVarInt'
                });
                
                // Script (variable)
                if (scriptLen > 0) {
                    const scriptStart = offset;
                    const script = readBytes(scriptLen);
                    sections.push({
                        type: 'txOutScript',
                        start: scriptStart,
                        end: offset,
                        label: `Output ${i} ScriptPubKey`,
                        value: toHex(script).substring(0, 20) + (scriptLen > 10 ? '...' : ''),
                        cssClass: 'decode-txOutScript'
                    });
                }
            }
            
            // Witness data (if SegWit)
            if (isSegWit) {
                for (let i = 0; i < inputCount; i++) {
                    // Witness stack count for this input
                    const witnessCountInfo = readVarInt();
                    const witnessCount = witnessCountInfo.value;
                    sections.push({
                        type: 'witnessVarInt',
                        start: witnessCountInfo.start,
                        end: witnessCountInfo.end,
                        label: `Witness ${i} Stack Items`,
                        value: witnessCount,
                        cssClass: 'decode-witnessVarInt'
                    });
                    
                    // Each witness item
                    for (let j = 0; j < witnessCount; j++) {
                        // Item length
                        const itemLenInfo = readVarInt();
                        const itemLen = itemLenInfo.value;
                        sections.push({
                            type: 'witnessItemsVarInt',
                            start: itemLenInfo.start,
                            end: itemLenInfo.end,
                            label: `Witness ${i}[${j}] Length`,
                            value: itemLen,
                            cssClass: 'decode-witnessItemsVarInt'
                        });
                        
                        // Item data
                        if (itemLen > 0) {
                            const itemStart = offset;
                            const item = readBytes(itemLen);
                            const itemHex = toHex(item);
                            
                            // Try to identify witness item type
                            let itemType = 'witnessItem';
                            let itemLabel = `Witness ${i}[${j}]`;
                            let itemValue = itemHex.substring(0, 20) + (itemLen > 10 ? '...' : '');
                            
                            // Check for Ordinals inscription (taproot script)
                            // Format: OP_FALSE OP_IF "ord" [content_type_tag] <content_type> [body_tag] <body...> OP_ENDIF
                            const inscription = this.parseInscription(item, itemStart);
                            if (inscription) {
                                // Add inscription sections instead of generic witness item
                                sections.push(...inscription.sections);
                                // Skip adding the generic witness item
                                continue;
                            }
                            
                            // Signature (typically 71-73 bytes, starts with 0x30)
                            if (itemLen >= 64 && itemLen <= 73 && item[0] === 0x30) {
                                itemType = 'witnessItemSignature';
                                itemLabel = `Witness ${i}[${j}] Signature`;
                            }
                            // Public key (33 bytes compressed, starts with 02 or 03)
                            else if (itemLen === 33 && (item[0] === 0x02 || item[0] === 0x03)) {
                                itemType = 'witnessItemPubkey';
                                itemLabel = `Witness ${i}[${j}] Pubkey`;
                            }
                            // Uncompressed public key (65 bytes, starts with 04)
                            else if (itemLen === 65 && item[0] === 0x04) {
                                itemType = 'witnessItemPubkey';
                                itemLabel = `Witness ${i}[${j}] Pubkey (uncompressed)`;
                            }
                            
                            sections.push({
                                type: itemType,
                                start: itemStart,
                                end: offset,
                                label: itemLabel,
                                value: itemValue,
                                cssClass: 'decode-' + itemType
                            });
                        } else {
                            // Empty witness item (often used for multisig)
                            sections.push({
                                type: 'witnessItemEmpty',
                                start: itemLenInfo.end,
                                end: itemLenInfo.end,
                                label: `Witness ${i}[${j}] (empty)`,
                                value: '(empty - OP_0)',
                                cssClass: 'decode-witnessItemEmpty'
                            });
                        }
                    }
                }
            }
            
            // Locktime (4 bytes)
            const locktimeStart = offset;
            const locktime = readLE(4);
            let locktimeValue;
            if (locktime === 0) {
                locktimeValue = '0 (no lock)';
            } else if (locktime < 500000000) {
                locktimeValue = `Block ${locktime}`;
            } else {
                locktimeValue = new Date(locktime * 1000).toISOString();
            }
            sections.push({
                type: 'locktime',
                start: locktimeStart,
                end: offset,
                label: 'Locktime',
                value: locktimeValue,
                cssClass: 'decode-locktime'
            });
            
        } catch (e) {
            console.error('Error parsing transaction:', e);
        }
        
        return sections;
    }
    
    // Parse Ordinals inscription from witness script
    // Based on https://github.com/casey/ord/blob/938b5cc97d48d026fd9250eae661d1e87286b377/src/inscription.rs
    parseInscription(script, baseOffset) {
        const sections = [];
        let pos = 0;
        
        // Helper to read a byte
        const readByte = () => script[pos++];
        
        // Helper to check if we have enough bytes
        const hasBytes = (n) => pos + n <= script.length;
        
        // Helper to read push data (handles different push opcodes)
        // Returns: { data, start, end, opcodeStart, opcodeEnd, opcodeType, opcodeLen }
        const readPushData = () => {
            if (pos >= script.length) return null;
            const opcode = script[pos];
            const opcodeStart = pos;
            
            // Direct push (1-75 bytes)
            if (opcode >= 0x01 && opcode <= 0x4b) {
                const len = opcode;
                pos++;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'direct', opcodeLen: len
                };
            }
            // OP_PUSHDATA1 (76 = 0x4c)
            else if (opcode === 0x4c) {
                pos++;
                if (!hasBytes(1)) return null;
                const len = script[pos++];
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA1', opcodeLen: len
                };
            }
            // OP_PUSHDATA2 (77 = 0x4d)
            else if (opcode === 0x4d) {
                pos++;
                if (!hasBytes(2)) return null;
                const len = script[pos] | (script[pos + 1] << 8);
                pos += 2;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA2', opcodeLen: len
                };
            }
            // OP_PUSHDATA4 (78 = 0x4e)
            else if (opcode === 0x4e) {
                pos++;
                if (!hasBytes(4)) return null;
                const len = script[pos] | (script[pos + 1] << 8) | (script[pos + 2] << 16) | (script[pos + 3] << 24);
                pos += 4;
                const dataStart = pos;
                if (!hasBytes(len)) return null;
                const data = script.slice(pos, pos + len);
                pos += len;
                return { 
                    data, start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: dataStart, dataStart, dataEnd: pos,
                    opcodeType: 'OP_PUSHDATA4', opcodeLen: len
                };
            }
            // OP_0 / OP_FALSE (empty push)
            else if (opcode === 0x00) {
                pos++;
                return { 
                    data: new Uint8Array(0), start: opcodeStart, end: pos,
                    opcodeStart, opcodeEnd: pos, dataStart: pos, dataEnd: pos,
                    opcodeType: 'OP_0', opcodeLen: 0
                };
            }
            
            return null;
        };
        
        // Look for inscription envelope: OP_FALSE (0x00) OP_IF (0x63) "ord"
        while (pos < script.length - 5) {
            // Look for OP_FALSE OP_IF pattern
            if (script[pos] === 0x00 && script[pos + 1] === 0x63) {
                const envelopeStart = pos;
                
                // Look backwards to find pubkey + OP_CHECKSIG before the envelope
                // Check if the byte before OP_FALSE is OP_CHECKSIG (0xac)
                if (envelopeStart > 0 && script[envelopeStart - 1] === 0xac) {
                    const checksigPos = envelopeStart - 1;
                    
                    // Look for pubkey push before OP_CHECKSIG
                    // Scan backwards to find the push opcode
                    let pubkeyEnd = checksigPos;
                    let pubkeyStart = 0;
                    let pubkeyLen = 0;
                    let pushOpcodeStart = 0;
                    
                    // Check what's before OP_CHECKSIG - should be pubkey data
                    // We need to find where the pubkey push starts
                    // Common patterns: 0x20 (32 bytes) or 0x21 (33 bytes) for pubkeys
                    
                    // Scan from beginning to find the last push before OP_CHECKSIG
                    let scanPos = 0;
                    let lastPushStart = -1;
                    let lastPushDataStart = -1;
                    let lastPushDataEnd = -1;
                    let lastPushLen = 0;
                    
                    while (scanPos < checksigPos) {
                        const opcode = script[scanPos];
                        
                        // Direct push (1-75 bytes)
                        if (opcode >= 0x01 && opcode <= 0x4b) {
                            lastPushStart = scanPos;
                            lastPushLen = opcode;
                            lastPushDataStart = scanPos + 1;
                            lastPushDataEnd = scanPos + 1 + opcode;
                            scanPos = lastPushDataEnd;
                        }
                        // OP_PUSHDATA1
                        else if (opcode === 0x4c && scanPos + 1 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1];
                            lastPushDataStart = scanPos + 2;
                            lastPushDataEnd = scanPos + 2 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        }
                        // OP_PUSHDATA2
                        else if (opcode === 0x4d && scanPos + 2 < checksigPos) {
                            lastPushStart = scanPos;
                            lastPushLen = script[scanPos + 1] | (script[scanPos + 2] << 8);
                            lastPushDataStart = scanPos + 3;
                            lastPushDataEnd = scanPos + 3 + lastPushLen;
                            scanPos = lastPushDataEnd;
                        }
                        else {
                            scanPos++;
                        }
                    }
                    
                    // If we found a push right before OP_CHECKSIG, add it as pubkey
                    if (lastPushStart >= 0 && lastPushDataEnd === checksigPos) {
                        // Add pubkey push opcode
                        if (lastPushDataStart > lastPushStart) {
                            sections.push({
                                type: 'taprootPubkeyPush',
                                start: baseOffset + lastPushStart,
                                end: baseOffset + lastPushDataStart,
                                label: 'Pubkey Push',
                                value: `OP_PUSHBYTES_${lastPushLen}`,
                                cssClass: 'decode-taprootPubkeyPush'
                            });
                        }
                        
                        // Add the pubkey itself
                        const pubkeyHex = Array.from(script.slice(lastPushDataStart, lastPushDataEnd))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        sections.push({
                            type: 'taprootPubkey',
                            start: baseOffset + lastPushDataStart,
                            end: baseOffset + lastPushDataEnd,
                            label: 'X-only Pubkey',
                            value: pubkeyHex.substring(0, 16) + '...',
                            cssClass: 'decode-taprootPubkey'
                        });
                    }
                    
                    // Add OP_CHECKSIG
                    sections.push({
                        type: 'opChecksig',
                        start: baseOffset + checksigPos,
                        end: baseOffset + checksigPos + 1,
                        label: 'OP_CHECKSIG',
                        value: '0xac',
                        cssClass: 'decode-opChecksig'
                    });
                }
                
                pos += 2; // Skip OP_FALSE OP_IF
                
                // Read protocol ID push
                const protocolPush = readPushData();
                if (!protocolPush) { pos = envelopeStart + 1; continue; }
                
                // Check if it's "ord"
                const protocolId = String.fromCharCode(...protocolPush.data);
                if (protocolId !== 'ord') { pos = envelopeStart + 1; continue; }
                
                // Found inscription!
                sections.push({
                    type: 'inscriptionEnvelope',
                    start: baseOffset + envelopeStart,
                    end: baseOffset + pos,
                    label: 'Inscription Envelope',
                    value: 'OP_FALSE OP_IF "ord"',
                    cssClass: 'decode-inscriptionEnvelope'
                });
                
                let contentType = null;
                let bodyChunks = [];
                let bodyStart = null;
                let bodyEnd = null;
                
                // Parse fields until OP_ENDIF (0x68)
                while (pos < script.length) {
                    if (script[pos] === 0x68) { // OP_ENDIF
                        const endifStart = pos;
                        pos++;
                        sections.push({
                            type: 'inscriptionEndif',
                            start: baseOffset + endifStart,
                            end: baseOffset + pos,
                            label: 'Inscription End',
                            value: 'OP_ENDIF',
                            cssClass: 'decode-inscriptionEndif'
                        });
                        
                        // Check for control block after OP_ENDIF
                        // Control block format: <push_opcode> <control_byte> <internal_pubkey>
                        if (pos < script.length) {
                            const controlPush = readPushData();
                            if (controlPush && controlPush.data.length >= 33) {
                                const controlByte = controlPush.data[0];
                                const leafVersion = controlByte & 0xfe;
                                const parity = controlByte & 0x01;
                                
                                // Add control block push opcode
                                if (controlPush.opcodeEnd > controlPush.opcodeStart) {
                                    sections.push({
                                        type: 'controlBlockPush',
                                        start: baseOffset + controlPush.opcodeStart,
                                        end: baseOffset + controlPush.opcodeEnd,
                                        label: 'Control Block Push',
                                        value: `${controlPush.opcodeType || 'push'} (${controlPush.data.length} bytes)`,
                                        cssClass: 'decode-controlBlockPush'
                                    });
                                }
                                
                                // Add control byte
                                sections.push({
                                    type: 'controlByte',
                                    start: baseOffset + controlPush.dataStart,
                                    end: baseOffset + controlPush.dataStart + 1,
                                    label: 'Control Byte',
                                    value: `0x${controlByte.toString(16)} (leaf v${leafVersion >> 1}, parity ${parity})`,
                                    cssClass: 'decode-controlByte'
                                });
                                
                                // Add internal pubkey (32 bytes after control byte)
                                if (controlPush.data.length >= 33) {
                                    const internalPubkey = Array.from(controlPush.data.slice(1, 33))
                                        .map(b => b.toString(16).padStart(2, '0')).join('');
                                    sections.push({
                                        type: 'internalPubkey',
                                        start: baseOffset + controlPush.dataStart + 1,
                                        end: baseOffset + controlPush.dataStart + 33,
                                        label: 'Internal Pubkey',
                                        value: internalPubkey.substring(0, 16) + '...',
                                        cssClass: 'decode-internalPubkey'
                                    });
                                }
                                
                                // If there's more data (merkle proof), add it
                                if (controlPush.data.length > 33) {
                                    const merkleBytes = controlPush.data.length - 33;
                                    sections.push({
                                        type: 'merkleProof',
                                        start: baseOffset + controlPush.dataStart + 33,
                                        end: baseOffset + controlPush.dataEnd,
                                        label: 'Merkle Proof',
                                        value: `${merkleBytes} bytes (${Math.floor(merkleBytes / 32)} hashes)`,
                                        cssClass: 'decode-merkleProof'
                                    });
                                }
                            }
                        }
                        
                        break;
                    }
                    
                    // Read tag
                    const tagPush = readPushData();
                    if (!tagPush) break;
                    
                    const tag = tagPush.data;
                    
                    // Empty tag = body start
                    if (tag.length === 0) {
                        sections.push({
                            type: 'inscriptionBodyTag',
                            start: baseOffset + tagPush.start,
                            end: baseOffset + tagPush.end,
                            label: 'Body Tag',
                            value: 'OP_0 (body start)',
                            cssClass: 'decode-inscriptionBodyTag'
                        });
                        
                        // Read body chunks until OP_ENDIF
                        let chunkIndex = 0;
                        let totalBodySize = 0;
                        while (pos < script.length && script[pos] !== 0x68) {
                            const chunkPush = readPushData();
                            if (!chunkPush) break;
                            
                            const chunkData = chunkPush.data;
                            totalBodySize += chunkData.length;
                            
                            // Add push opcode marker section (if not direct push)
                            if (chunkPush.opcodeType !== 'direct' && chunkPush.opcodeType !== 'OP_0') {
                                sections.push({
                                    type: 'inscriptionPushOpcode',
                                    start: baseOffset + chunkPush.opcodeStart,
                                    end: baseOffset + chunkPush.opcodeEnd,
                                    label: `Push Marker ${chunkIndex}`,
                                    value: `${chunkPush.opcodeType} (${chunkPush.opcodeLen} bytes)`,
                                    cssClass: 'decode-inscriptionPushOpcode'
                                });
                            }
                            
                            // Add the data section
                            if (chunkData.length > 0) {
                                // Try to preview chunk content
                                let chunkPreview = `${chunkData.length} bytes`;
                                if (contentType && contentType.includes('text') && chunkData.length > 0) {
                                    try {
                                        const text = new TextDecoder().decode(chunkData);
                                        chunkPreview = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                                    } catch (e) {
                                        // Keep byte count
                                    }
                                }
                                
                                sections.push({
                                    type: 'inscriptionBodyChunk',
                                    start: baseOffset + chunkPush.dataStart,
                                    end: baseOffset + chunkPush.dataEnd,
                                    label: `Body Chunk ${chunkIndex}`,
                                    value: chunkPreview,
                                    cssClass: 'decode-inscriptionBodyChunk'
                                });
                            }
                            
                            bodyChunks.push(chunkData);
                            chunkIndex++;
                        }
                        continue;
                    }
                    
                    // Tag [1] = content type
                    if (tag.length === 1 && tag[0] === 1) {
                        sections.push({
                            type: 'inscriptionContentTypeTag',
                            start: baseOffset + tagPush.start,
                            end: baseOffset + tagPush.end,
                            label: 'Content-Type Tag',
                            value: '0x01',
                            cssClass: 'decode-inscriptionContentTypeTag'
                        });
                        
                        // Read content type value
                        const valuePush = readPushData();
                        if (valuePush) {
                            contentType = String.fromCharCode(...valuePush.data);
                            sections.push({
                                type: 'inscriptionContentType',
                                start: baseOffset + valuePush.start,
                                end: baseOffset + valuePush.end,
                                label: 'Content-Type',
                                value: contentType,
                                cssClass: 'decode-inscriptionContentType'
                            });
                        }
                        continue;
                    }
                    
                    // Other tags (unknown)
                    sections.push({
                        type: 'inscriptionUnknownTag',
                        start: baseOffset + tagPush.start,
                        end: baseOffset + tagPush.end,
                        label: 'Unknown Tag',
                        value: `0x${Array.from(tag).map(b => b.toString(16).padStart(2, '0')).join('')}`,
                        cssClass: 'decode-inscriptionUnknownTag'
                    });
                    
                    // Read and skip the value
                    const unknownValue = readPushData();
                    if (unknownValue) {
                        sections.push({
                            type: 'inscriptionUnknownValue',
                            start: baseOffset + unknownValue.start,
                            end: baseOffset + unknownValue.end,
                            label: 'Unknown Value',
                            value: `${unknownValue.data.length} bytes`,
                            cssClass: 'decode-inscriptionUnknownValue'
                        });
                    }
                }
                
                // If we found sections, return them
                if (sections.length > 0) {
                    return { sections, contentType, bodySize: bodyChunks.reduce((sum, c) => sum + c.length, 0) };
                }
            }
            pos++;
        }
        
        return null;
    }
    
    updateViewToggleButtons() {
        const hexBtn = document.getElementById('view-hex');
        const binaryBtn = document.getElementById('view-binary');
        const asciiBtn = document.getElementById('view-ascii');
        const dumpBtn = document.getElementById('view-dump');
        const bytesSelect = document.getElementById('bytes-per-line');
        
        hexBtn.classList.remove('active');
        binaryBtn.classList.remove('active');
        asciiBtn.classList.remove('active');
        dumpBtn.classList.remove('active');
        
        if (this.rawViewMode === 'hex') {
            hexBtn.classList.add('active');
            bytesSelect.disabled = false;
        } else if (this.rawViewMode === 'binary') {
            binaryBtn.classList.add('active');
            bytesSelect.disabled = false;
        } else if (this.rawViewMode === 'dump') {
            dumpBtn.classList.add('active');
            bytesSelect.disabled = true;
        } else {
            asciiBtn.classList.add('active');
            bytesSelect.disabled = false;
        }
    }
    
    downloadRawData() {
        if (!this.rawTxData || !this.rawTxData.hex) return;
        
        const blob = new Blob([this.rawTxData.hex], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transaction_${this.txid}.hex`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    copyRawData() {
        if (!this.rawTxData || !this.rawTxData.hex) return;
        
        const copyBtn = document.getElementById('copy-raw-data');
        
        navigator.clipboard.writeText(this.rawTxData.hex).then(() => {
            // Show feedback
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
            copyBtn.textContent = 'Error';
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
            }, 1500);
        });
    }
    
    showRawDataModal() {
        const modal = document.getElementById('raw-data-modal');
        modal.classList.add('active');
        document.body.classList.add('raw-data-open');
        
        // Update view toggle buttons to reflect current mode
        this.updateViewToggleButtons();
        
        // Update URL with rawdata parameter
        const url = new URL(window.location);
        url.searchParams.set('rawdata', 'open');
        window.history.pushState({}, '', url);
        
        // Trigger resize
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
    
    hideRawDataModal() {
        const modal = document.getElementById('raw-data-modal');
        modal.classList.remove('active');
        document.body.classList.remove('raw-data-open');
        
        // Update URL - remove rawdata parameter
        const url = new URL(window.location);
        url.searchParams.delete('rawdata');
        window.history.pushState({}, '', url);
        
        // Trigger resize
        this.onWindowResize();
        setTimeout(() => {
            this.onWindowResize();
        }, 350);
    }
}

window.ExplorerPages = window.ExplorerPages || {};
window.ExplorerPages['transaction.html'] = {
    panelTitle: 'Transaction',
    panelDomId: 'tx-info',
    create: function (opts) { return new BitcoinTransactionExplorer(opts); }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.__softNav) return;
    window.__explorer = new BitcoinTransactionExplorer();
}); 
