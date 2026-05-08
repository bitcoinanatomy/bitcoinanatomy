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
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(0, 0, CANVAS_W, CANVAS_H, 12) : ctx.rect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fill();

        // Border
        ctx.strokeStyle = '#f7931a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(2, 2, CANVAS_W - 4, CANVAS_H - 4, 10) : ctx.rect(2, 2, CANVAS_W - 4, CANVAS_H - 4);
        ctx.stroke();

        // Title
        ctx.fillStyle = '#f7931a';
        ctx.font = 'bold 26px monospace';
        ctx.fillText(this.title, 20, 40);

        // Divider
        ctx.strokeStyle = 'rgba(247,147,26,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(20, 54);
        ctx.lineTo(CANVAS_W - 20, 54);
        ctx.stroke();

        // Lines
        ctx.fillStyle = '#e8e8e8';
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
