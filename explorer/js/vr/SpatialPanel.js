/**
 * SpatialPanel — renders a Canvas2D info panel as a Three.js PlaneGeometry mesh.
 * Used to display page data inside an immersive VR session where DOM panels are invisible.
 * Exposed as window.SpatialPanel.
 */
(function () {
    'use strict';

    var CANVAS_W = 512;
    var CANVAS_H = 384;
    var WORLD_W = 0.6;  // metres
    var WORLD_H = 0.45; // metres

    function SpatialPanel(options) {
        options = options || {};
        this.title = options.title || 'Info';

        // Canvas + texture
        this.canvas = document.createElement('canvas');
        this.canvas.width = CANVAS_W;
        this.canvas.height = CANVAS_H;
        this.ctx = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);

        // Mesh
        var geo = new THREE.PlaneGeometry(WORLD_W, WORLD_H);
        var mat = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, transparent: true, depthWrite: false });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.visible = false;
        this.mesh.renderOrder = 1;

        this._draw([]);
    }

    SpatialPanel.prototype._draw = function (lines) {
        var ctx = this.ctx;
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = '400 26px "BureauGrotesque", sans-serif';
        ctx.fillText(this.title.toUpperCase(), 20, 40);

        // Divider
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, 54);
        ctx.lineTo(CANVAS_W - 20, 54);
        ctx.stroke();

        // Lines
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = '20px monospace';
        var y = 82;
        for (var i = 0; i < Math.min(lines.length, 10); i++) {
            var text = lines[i] || '';
            ctx.fillText(text, 20, y);
            y += 28;
        }

        this.texture.needsUpdate = true;
    };

    SpatialPanel.prototype.update = function (lines) {
        this._draw(lines);
    };

    SpatialPanel.prototype.attachToScene = function (scene) {
        scene.add(this.mesh);
    };

    SpatialPanel.prototype.detachFromScene = function () {
        if (this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
    };

    SpatialPanel.prototype.setVisible = function (visible) {
        this.mesh.visible = !!visible;
    };

    SpatialPanel.prototype.setPosition = function (x, y, z) {
        this.mesh.position.set(x, y, z);
    };

    SpatialPanel.prototype.getMesh = function () {
        return this.mesh;
    };

    if (typeof window !== 'undefined') {
        window.SpatialPanel = SpatialPanel;
    }
})();
