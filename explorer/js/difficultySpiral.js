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
    var EPOCH_DISC_BASE = 1.65;
    var EPOCH_RADIUS_REF = 22.5;
    /* Spiral maxRadius per difficulty epoch (measured 2026-08-22, epochs 0–470). */
    var EPOCH_MAX_RADIUS = [30.2002,24.9658,25.81,26.1646,26.2065,26.1873,25.8028,26.9615,32.0343,32.8178,39.8304,32.5086,33.596,32.3175,28.0299,21.3522,22.0909,22.8627,19.9755,19.7176,18.9892,21.2094,23.1189,20.1323,20.4992,19.1976,21.9321,24.1551,19.6268,22.6976,21.9769,21.1126,16.7865,11.4585,20.0376,19.3541,19.2804,21.0655,21.7053,20.4729,19.3815,22.6986,18.6206,19.382,19.1823,18.9027,21.411,18.8683,21.3545,21.8825,21.8366,21.2443,21.3602,19.6162,18.8202,19.8282,24.3784,21.2511,21.9083,21.3056,19.3902,18.662,17.4215,20.3402,18.7037,18.5304,21.8059,22.316,21.9665,23.7273,23.3824,23.3606,23.6499,24.8792,25.5883,23.3126,24.2558,22.5618,23.1575,22.3591,22.7007,22.5924,23.2272,22.2583,23.2007,22.2806,23.5564,23.7246,21.6644,24.2078,23.2667,22.2261,23.0364,22.4774,22.2141,22.3813,21.9818,22.0985,22.5054,22.4641,23.1253,22.3991,22.9836,22.9791,23.4366,24.6729,22.2255,24.2685,22.0913,21.9875,21.2172,22.0191,19.7802,21.684,21.4641,21.9118,22.0192,22.2679,20.4921,20.8565,22.1035,20.96,21.2424,21.2362,19.9246,20.4259,20.2063,20.3923,20.2072,20.5916,19.5306,19.2327,20.31,21.2593,21.5472,20.5005,20.363,21.1839,20.6832,20.9653,21.2393,21.2436,21.028,21.9961,21.4034,20.9918,21.7419,21.6842,22.0704,21.3609,21.897,21.6862,20.7788,22.8637,22.3261,22.6115,21.1247,21.6494,22.2612,21.5412,23.0807,22.8836,22.1191,23.0137,23.282,23.3698,22.8627,22.3189,23.9495,22.3635,22.6461,23.033,23.3738,22.5668,23.6442,23.2003,22.9245,23.4949,22.7213,23.2728,22.8196,22.9461,23.1111,22.8823,22.6485,22.7411,22.9144,23.1961,22.9492,22.5694,22.0958,22.2601,21.3592,22.0193,22.2044,22.55,21.2019,21.7988,23.5692,22.7026,23.101,22.4267,23.2097,22.2387,22.9095,23.3947,22.4611,22.9861,23.1987,23.8542,22.3667,23.0214,22.9314,22.4549,22.4175,23.4187,23.1532,22.0617,22.9966,22.306,22.9187,22.534,21.5082,22.386,22.7232,22.698,22.8428,22.6458,22.7266,23.1871,22.4079,22.4891,21.7403,22.6639,23.2461,21.7804,22.4418,22.4084,23.6486,22.774,21.2366,22.992,22.507,21.0969,23.9324,23.3563,21.3673,21.4024,22.8384,21.6176,21.48,22.0902,22.6785,22.1941,22.6299,23.0501,22.1913,22.6841,22.8679,22.7667,21.6808,22.896,22.6028,23.617,21.6817,22.3981,22.6192,22.7211,22.981,22.7479,23.6333,23.1888,24.0968,25.1678,24.3861,22.1276,22.6793,23.3489,22.7335,23.1923,23.2087,22.646,23.1842,23.2859,22.5998,23.2038,22.0244,23.293,22.4431,21.7161,23.2683,22.0585,22.9744,22.5739,22.0972,22.3982,22.9822,22.6224,24.0661,22.9759,23.2961,23.1437,22.485,22.4401,22.6792,23.1515,23.2466,22.4546,25.3043,22.5648,22.2883,23.1022,23.9319,24.3509,21.6676,23.2144,22.1366,23.5088,23.1204,22.7984,23.3507,21.9923,23.1983,22.7977,25.3167,22.6654,22.2409,23.5054,23.2518,22.0531,23.0705,22.8769,23.0422,23.3569,22.9778,22.5489,22.984,24.8009,21.0622,25.2952,23.8378,27.3082,23.7781,22.537,22.3964,21.8121,22.6957,22.8422,22.6688,23.094,22.3488,22.6922,23.3806,22.2964,23.16,23.1518,22.1811,23.1676,22.6673,23.3816,23.244,22.7355,23.3387,22.5772,22.6427,23.718,23.058,23.4756,23.3723,23.8,23.0062,23.1265,22.1969,22.8176,23.452,21.7781,22.822,23.2269,23.1323,24.107,22.8334,23.6239,22.1104,22.6875,23.2639,22.114,23.067,22.3683,22.9513,23.0052,23.3705,22.8338,22.8148,22.9556,23.5813,22.4945,23.5401,23.1792,22.5224,23.5149,22.5891,23.16,22.4894,22.9318,22.806,22.6368,23.3116,22.4389,23.01,23.643,22.3962,22.3034,23.5543,22.5599,23.3231,22.7507,22.9626,23.8746,23.0194,23.2839,23.2108,23.807,22.8389,22.0796,23.6768,22.8598,22.7931,23.7485,22.7425,22.7556,22.5076,23.131,23.0191,22.7019,23.0605,23.1255,23.453,22.5887,23.582,23.0354,23.0507,22.4627,23.0409,23.5934,22.9675,22.7125,23.2548,24.1027,22.3206,23.0822,23.0333,23.1791,22.6656,22.6876,22.5498,23.5258,22.5076,23.488,23.3808,23.2711,23.1975,23.3408,23.5938,24.6198,21.6654,23.1566,24.1543,22.7646,23.485,23.4744,22.8527];

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

    function discRadiusForEpoch(index) {
        var list = EPOCH_MAX_RADIUS;
        var r = (index >= 0 && index < list.length) ? list[index] : list[list.length - 1];
        if (!(r > 0)) r = EPOCH_RADIUS_REF;
        return Math.max(0.45, EPOCH_DISC_BASE * (r / EPOCH_RADIUS_REF));
    }

    global.DifficultySpiral = {
        BLOCKS_PER_EPOCH: BLOCKS_PER_EPOCH,
        BLOCK_SIZE: BLOCK_SIZE,
        EPOCH_MAX_RADIUS: EPOCH_MAX_RADIUS,
        epochUrl: epochUrl,
        layoutBlocks: layoutBlocks,
        discRadiusForEpoch: discRadiusForEpoch
    };
})(typeof window !== 'undefined' ? window : this);
