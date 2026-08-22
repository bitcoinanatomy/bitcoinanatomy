/**
 * Shared Archimedean layout for a difficulty-adjustment epoch (up to 2016 blocks).
 * Matches explorer/js/difficulty.js createBlockSpiral constants and Newton–Raphson.
 */
(function (global) {
    'use strict';

    var FACTOR_BLOCK_DISTANCE = 0.2;
    var RADIUS_SPIRAL_START = 0.4;
    var FACTOR_SPIRAL_GROWTH = 0.13;
    var BLOCK_SIZE = 0.3;
    var MIN_BRIGHTNESS = 20;
    var MAX_BRIGHTNESS_SIZE = 5000;
    var MAX_BLOCKS = 2016;
    var BLOCKS_PER_EPOCH = 2016;

    function newtonRaphson(L, k, initialGuess, tolerance, maxIterations) {
        var t = initialGuess == null ? 1.0 : initialGuess;
        var tol = tolerance == null ? 1e-6 : tolerance;
        var maxIt = maxIterations == null ? 1000 : maxIterations;
        for (var i = 0; i < maxIt; i++) {
            var f_t = t * t - L * k;
            if (Math.abs(f_t) < tol) return t;
            t = t - f_t / (2 * t);
        }
        return t;
    }

    function epochUrl(adjustmentIndex) {
        var firstBlock = adjustmentIndex * BLOCKS_PER_EPOCH;
        var fileName = 'rcp_bitcoin_block_data_' + String(firstBlock).padStart(7, '0') + '.json';
        return 'https://pvxg.net/bitcoin_data/difficulty_epochs/' + fileName;
    }

    /**
     * @param {Array} blocks  blockData[0] from pvxg epoch JSON
     * @returns {{ count: number, positions: Float32Array, colors: Float32Array, rotationsY: Float32Array, maxRadius: number, blockSize: number }}
     */
    function layoutBlocks(blocks) {
        if (!blocks || !blocks.length) {
            return { count: 0, positions: new Float32Array(0), colors: new Float32Array(0), rotationsY: new Float32Array(0), maxRadius: 1, blockSize: BLOCK_SIZE };
        }

        var maxIterations = Math.min(MAX_BLOCKS, blocks.length);
        var positions = new Float32Array(maxIterations * 3);
        var colors = new Float32Array(maxIterations * 3);
        var rotationsY = new Float32Array(maxIterations);
        var maxRadius = RADIUS_SPIRAL_START;
        var totalTime = 0;

        var phi_spiral = RADIUS_SPIRAL_START / FACTOR_SPIRAL_GROWTH;
        var arc_distance = FACTOR_SPIRAL_GROWTH * (Math.asinh(phi_spiral) + phi_spiral * Math.sqrt(phi_spiral * phi_spiral + 1));

        for (var i = 0; i < maxIterations; i++) {
            var block = blocks[i];
            var timeDifference = (block[8] && block[8].time_difference) || 600;
            if (i === 0) timeDifference = 0;
            totalTime += timeDifference;
            var size = (block[5] && block[5].size) || 216;

            var block_distance = (i === 0 || i === MAX_BLOCKS - 1) ? 0 : timeDifference;
            arc_distance += block_distance * FACTOR_BLOCK_DISTANCE;
            phi_spiral = newtonRaphson(arc_distance, FACTOR_SPIRAL_GROWTH, phi_spiral);
            var radius_spiral = FACTOR_SPIRAL_GROWTH * phi_spiral;

            var x = radius_spiral * Math.sin(phi_spiral);
            var z = radius_spiral * Math.cos(phi_spiral);
            var brightness = MIN_BRIGHTNESS + (size / MAX_BRIGHTNESS_SIZE) * 256;
            var c = Math.max(0, Math.min(1, brightness / 255));

            positions[i * 3] = x;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = z;
            colors[i * 3] = c;
            colors[i * 3 + 1] = c;
            colors[i * 3 + 2] = c;
            rotationsY[i] = phi_spiral + Math.PI / 2;

            var r = Math.hypot(x, z);
            if (r > maxRadius) maxRadius = r;
        }

        maxRadius += BLOCK_SIZE * 0.5;
        return {
            count: maxIterations,
            positions: positions,
            colors: colors,
            rotationsY: rotationsY,
            maxRadius: maxRadius,
            arcLength: arc_distance,
            totalTime: totalTime,
            blockSize: BLOCK_SIZE
        };
    }

    global.DifficultySpiral = {
        BLOCKS_PER_EPOCH: BLOCKS_PER_EPOCH,
        BLOCK_SIZE: BLOCK_SIZE,
        epochUrl: epochUrl,
        layoutBlocks: layoutBlocks
    };
})(typeof window !== 'undefined' ? window : this);
