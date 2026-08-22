/**
 * secp256k1 toy math for the Curve explorer: y² = x³ + 7 over ℝ and 𝔽_p.
 * No libsecp256k1 — pedagogical only.
 */
(function (global) {
    'use strict';

    var A = 0;
    var B = 7;
    var INSTANCE_CAP = 192000;
    var SCHEMATIC_DOTS = 192000;
    var INSTANCE_CAP_MAX = 768000;
    var ENUM_MAX_P = 70000;
    var SEARCH_RATE = 1e12;
    var LOG10_2 = Math.LN2 / Math.LN10;

    var PRIME_LADDER = [
        { bits: 2, p: 3, label: '𝔽₃', schematic: false },
        { bits: 4, p: 13, label: '𝔽₁₃', schematic: false },
        { bits: 8, p: 251, label: '𝔽₂₅₁', schematic: false },
        { bits: 16, p: 65521, label: '𝔽₆₅₅₂₁', schematic: false },
        { bits: 32, p: null, label: '𝔽₂³²', schematic: true },
        { bits: 64, p: null, label: '𝔽₂⁶⁴', schematic: true },
        { bits: 128, p: null, label: '𝔽₂¹²⁸', schematic: true },
        { bits: 256, p: null, label: 'secp256k1', schematic: true }
    ];

    /* 1:1 atom-count matches for 2^n — no ×10^k multipliers. */
    var ATOM_MATCH = {
        2: '≈ a few atoms',
        4: '≈ a small molecule',
        8: '≈ a peptide',
        16: '≈ a protein',
        32: '≈ a small bacterium',
        64: '≈ a grain of sand',
        128: '≈ a km³ of rock',
        256: '≈ the observable universe'
    };

    var SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

    function toSup(n) {
        return String(n).replace(/-/g, '⁻').replace(/\d/g, function (d) { return SUP[+d]; });
    }

    var DIM_STEPS = 5;
    var DIM_NAMES = [
        'Cartesian',
        'Rolling',
        'Cylinder',
        'Bent tube',
        'Torus'
    ];

    var VIEWS = ['family', 'domain', 'group', 'scalar'];

    function mod(n, p) {
        var r = n % p;
        if (r < 0) r += p;
        return r;
    }

    function modPow(base, exp, p) {
        var result = 1;
        var b = mod(base, p);
        var e = exp;
        while (e > 0) {
            if (e & 1) result = (result * b) % p;
            b = (b * b) % p;
            e = Math.floor(e / 2);
        }
        return result;
    }

    function modInv(a, p) {
        a = mod(a, p);
        if (a === 0) return null;
        var t = 0, newt = 1, r = p, newr = a;
        while (newr !== 0) {
            var q = Math.floor(r / newr);
            var tmp = newt;
            newt = t - q * newt;
            t = tmp;
            tmp = newr;
            newr = r - q * newr;
            r = tmp;
        }
        if (r > 1) return null;
        if (t < 0) t += p;
        return t;
    }

    function yUpperReal(x, b) {
        b = b === undefined ? B : b;
        var v = x * x * x + A * x + b;
        if (v < 0) return null;
        return Math.sqrt(v);
    }

    function sampleRealCurve(xMin, xMax, steps, b) {
        b = b === undefined ? B : b;
        var upper = [];
        var lower = [];
        var i, x, yu;
        for (i = 0; i <= steps; i++) {
            x = xMin + (i / steps) * (xMax - xMin);
            yu = yUpperReal(x, b);
            if (yu == null) continue;
            upper.push({ x: x, y: yu });
            lower.push({ x: x, y: -yu });
        }
        return { upper: upper, lower: lower };
    }

    function toyCurvePoints(p) {
        var pts = [];
        var sq = {};
        var y, x, rhs, y0, y1;
        for (y = 0; y < p; y++) sq[mod(y * y, p)] = y;
        for (x = 0; x < p; x++) {
            rhs = mod(x * x * x + B, p);
            if (sq[rhs] === undefined) continue;
            y0 = sq[rhs];
            pts.push({ x: x, y: y0 });
            y1 = mod(-y0, p);
            if (y1 !== y0) pts.push({ x: x, y: y1 });
        }
        return pts;
    }

    var INF = { inf: true };

    function eqPt(P, Q) {
        if (P.inf && Q.inf) return true;
        if (P.inf || Q.inf) return false;
        return P.x === Q.x && P.y === Q.y;
    }

    function negPt(P, p) {
        if (P.inf) return INF;
        return { x: P.x, y: mod(-P.y, p) };
    }

    function sumDoubleFp(P, p) {
        if (P.inf) return INF;
        if (P.y === 0) return INF;
        var inv = modInv(mod(2 * P.y, p), p);
        if (inv == null) return INF;
        var lam = mod((3 * P.x * P.x + A) * inv, p);
        var x = mod(lam * lam - 2 * P.x, p);
        var y = mod(lam * (P.x - x) - P.y, p);
        return { x: x, y: y, lam: lam };
    }

    function sumDistinctFp(P, Q, p) {
        if (P.inf) return Q;
        if (Q.inf) return P;
        if (P.x === Q.x && P.y === Q.y) return sumDoubleFp(P, p);
        if (P.x === Q.x) return INF;
        var inv = modInv(mod(Q.x - P.x, p), p);
        if (inv == null) return INF;
        var lam = mod((Q.y - P.y) * inv, p);
        var x = mod(lam * lam - P.x - Q.x, p);
        var y = mod(lam * (P.x - x) - P.y, p);
        return { x: x, y: y, lam: lam };
    }

    function addFp(P, Q, p) {
        return sumDistinctFp(P, Q, p);
    }

    function lineSlopeFp(P, Q, p) {
        if (!P || !Q || P.inf || Q.inf) return null;
        if (P.x === Q.x) return Infinity;
        var inv = modInv(mod(Q.x - P.x, p), p);
        if (inv == null) return null;
        var lam = mod((Q.y - P.y) * inv, p);
        if (lam > p / 2) lam -= p;
        return lam;
    }

    function shortenFp(n, p) {
        var r = mod(n, p);
        if (r > p / 2) r -= p;
        return r;
    }

    function pointOrder(P, p) {
        if (P.inf) return 1;
        var Q = P;
        var n = 1;
        var guard = p + 8;
        while (!Q.inf && n < guard) {
            Q = addFp(Q, P, p);
            n++;
        }
        return Q.inf ? n : 0;
    }

    function pickGenerator(p) {
        var pts = toyCurvePoints(p);
        var best = null;
        var bestN = 0;
        var i, n;
        for (i = 0; i < pts.length; i++) {
            n = pointOrder(pts[i], p);
            if (n > bestN) {
                bestN = n;
                best = pts[i];
            }
        }
        return { G: best, order: bestN, points: pts };
    }

    function multiplesOf(G, p, count) {
        var out = [];
        if (!G) return out;
        var Q = G;
        var k;
        for (k = 1; k <= count; k++) {
            if (Q.inf) {
                out.push({ k: k, inf: true });
                break;
            }
            out.push({ k: k, x: Q.x, y: Q.y });
            Q = addFp(Q, G, p);
        }
        return out;
    }

    function lerp3(a, b, t) {
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t
        };
    }

    function poseSquare(u, v) {
        var half = 2.2;
        return { x: (u - 0.5) * 2 * half, y: (v - 0.5) * 2 * half, z: 0 };
    }

    function poseRolling(u, v) {
        var R = 1.15, H = 2.5;
        var th0 = Math.PI * 0.35;
        var span = Math.PI * 1.30;
        var theta = th0 + u * span;
        var h = -H / 2 + v * H;
        return { x: R * Math.cos(theta), y: h, z: R * Math.sin(theta) };
    }

    function poseCylinder(u, v) {
        var R = 1.15, H = 2.5;
        var theta = u * 2 * Math.PI;
        var h = -H / 2 + v * H;
        return { x: R * Math.cos(theta), y: h, z: R * Math.sin(theta) };
    }

    function poseBent(u, v) {
        var bendR = 1.45, tubeR = 0.55;
        var theta = Math.PI + u * Math.PI;
        var phi = v * 2 * Math.PI;
        var ccx = bendR * Math.cos(theta);
        var ccy = bendR * Math.sin(theta);
        var nx0 = Math.cos(theta), ny0 = Math.sin(theta);
        return {
            x: ccx + tubeR * Math.cos(phi) * nx0,
            y: ccy + tubeR * Math.cos(phi) * ny0,
            z: tubeR * Math.sin(phi)
        };
    }

    function poseTorus(u, v) {
        var R = 1.55, r = 0.58;
        var theta = u * 2 * Math.PI;
        var phi = v * 2 * Math.PI;
        return {
            x: (R + r * Math.cos(phi)) * Math.cos(theta),
            y: (R + r * Math.cos(phi)) * Math.sin(theta),
            z: r * Math.sin(phi)
        };
    }

    var POSES = [poseSquare, poseRolling, poseCylinder, poseBent, poseTorus];

    function sampleDomain(u, v, t) {
        var scaled = t * (DIM_STEPS - 1);
        var i0 = Math.floor(scaled);
        if (i0 < 0) i0 = 0;
        if (i0 > DIM_STEPS - 2) i0 = DIM_STEPS - 2;
        var f = scaled - i0;
        if (t >= 1) {
            return poseTorus(u, v);
        }
        return lerp3(POSES[i0](u, v), POSES[i0 + 1](u, v), f);
    }

    function dimIndexToT(i) {
        if (i <= 0) return 0;
        if (i >= DIM_STEPS - 1) return 1;
        return i / (DIM_STEPS - 1);
    }

    function tToDimIndex(t) {
        return Math.round(t * (DIM_STEPS - 1));
    }

    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function schematicCountForBits(bits, cap) {
        if (bits >= 256) return 0;
        var bitN = INSTANCE_CAP;
        if (bits >= 128) bitN = INSTANCE_CAP_MAX;
        else if (bits >= 64) bitN = Math.round((INSTANCE_CAP + INSTANCE_CAP_MAX) / 2);
        var n = Math.max(cap || INSTANCE_CAP, bitN);
        return Math.min(INSTANCE_CAP_MAX, Math.max(INSTANCE_CAP, n));
    }

    function schematicPoints(n) {
        n = Math.min(Math.max(1, n || SCHEMATIC_DOTS), INSTANCE_CAP_MAX);
        var rand = mulberry32(0x9e3779b9);
        var pts = [];
        var side = Math.ceil(Math.sqrt(n));
        var i, j, u, v;
        for (j = 0; j < side; j++) {
            for (i = 0; i < side; i++) {
                if (pts.length >= n) break;
                u = (i + rand()) / side;
                v = (j + rand()) / side;
                if (u > 1) u = 1;
                if (v > 1) v = 1;
                pts.push({ u: u, v: v, schematic: true });
            }
        }
        return pts;
    }

    function downsample(pts, cap) {
        if (pts.length <= cap) return pts;
        var out = [];
        var i, n = pts.length;
        for (i = 0; i < cap; i++) out.push(pts[Math.floor(i * n / cap)]);
        return out;
    }

    function fieldPointsForPrime(entry, cap) {
        cap = Math.min(Math.max(1, cap || INSTANCE_CAP), INSTANCE_CAP_MAX);
        var bits = entry && entry.bits;
        if (!entry || entry.schematic || !entry.p || entry.p > ENUM_MAX_P) {
            var n = schematicCountForBits(bits, cap);
            if (n <= 0) {
                return {
                    points: [],
                    count: 0,
                    total: null,
                    exact: false,
                    solid: true,
                    p: entry && entry.p,
                    bits: bits
                };
            }
            var scatter = schematicPoints(n);
            return {
                points: scatter,
                count: scatter.length,
                total: null,
                exact: false,
                p: entry && entry.p,
                bits: bits
            };
        }
        var raw = toyCurvePoints(entry.p);
        var pts = raw.map(function (q) {
            return { x: q.x, y: q.y, u: q.x / entry.p, v: q.y / entry.p };
        });
        var drawn = downsample(pts, cap);
        return {
            points: drawn,
            count: drawn.length,
            total: raw.length,
            exact: true,
            p: entry.p,
            bits: bits,
            affine: raw.length <= cap ? raw : undefined
        };
    }

    function formatPow10(log10) {
        if (!isFinite(log10)) return '—';
        if (log10 < 6) {
            return String(Math.max(1, Math.round(Math.pow(10, log10))));
        }
        return '10' + toSup(Math.round(log10));
    }

    function formatPow2(bits) {
        if (bits <= 20) return String(Math.round(Math.pow(2, bits)));
        return '2' + toSup(bits) + ' ≈ 10' + toSup(Math.round(bits * LOG10_2));
    }

    function searchLabel(bits) {
        var log10Sec = (bits - 1) * LOG10_2 - Math.log(SEARCH_RATE) / Math.LN10;
        var log10Year = log10Sec - Math.log(31557600) / Math.LN10;
        var universeYears = 13.8e9;
        var log10Univ = Math.log(universeYears) / Math.LN10;
        if (log10Sec < -6) return '< 1 ns @ 10¹²/s';
        if (log10Sec < -3) return '~' + Math.round(Math.pow(10, log10Sec + 6)) + ' µs @ 10¹²/s';
        if (log10Sec < 0) return '~' + Math.round(Math.pow(10, log10Sec + 3)) + ' ms @ 10¹²/s';
        if (log10Sec < 1.8) return '~' + Math.round(Math.pow(10, log10Sec)) + ' s @ 10¹²/s';
        if (log10Sec < 3.8) return '~' + Math.round(Math.pow(10, log10Sec) / 60) + ' min @ 10¹²/s';
        if (log10Sec < 5.0) return '~' + Math.round(Math.pow(10, log10Sec) / 3600) + ' h @ 10¹²/s';
        if (log10Sec < 7.5) return '~' + Math.round(Math.pow(10, log10Sec) / 86400) + ' days @ 10¹²/s';
        if (log10Year < log10Univ) return '~' + formatPow10(log10Year) + ' years @ 10¹²/s';
        return '~' + formatPow10(log10Year - log10Univ) + ' universe-ages @ 10¹²/s';
    }

    function atomLabel(bits) {
        if (ATOM_MATCH[bits]) return ATOM_MATCH[bits];
        var keys = [2, 4, 8, 16, 32, 64, 128, 256];
        var i, best = keys[0], d, bestD = Math.abs(bits - keys[0]);
        for (i = 1; i < keys.length; i++) {
            d = Math.abs(bits - keys[i]);
            if (d < bestD) {
                bestD = d;
                best = keys[i];
            }
        }
        return ATOM_MATCH[best];
    }

    function fieldScale(entry) {
        var bits = (entry && entry.bits) || 0;
        return {
            bits: bits,
            entropy: bits + '-bit  ·  ' + formatPow2(bits),
            search: searchLabel(bits),
            atoms: atomLabel(bits)
        };
    }

    function wrapLineSamples(x0, y0, x1, y1, p, steps) {
        steps = steps || 48;
        var segs = [];
        var i, t, x, y, px, py, cur;
        cur = [];
        px = x0;
        py = y0;
        cur.push({ x: mod(x0, p), y: mod(y0, p) });
        for (i = 1; i <= steps; i++) {
            t = i / steps;
            x = x0 + (x1 - x0) * t;
            y = y0 + (y1 - y0) * t;
            var xm = mod(x, p);
            var ym = mod(y, p);
            var jump = Math.abs(xm - mod(px, p)) > p * 0.45 || Math.abs(ym - mod(py, p)) > p * 0.45;
            if (jump && cur.length) {
                segs.push(cur);
                cur = [];
            }
            cur.push({ x: xm, y: ym });
            px = x;
            py = y;
        }
        if (cur.length) segs.push(cur);
        return segs;
    }

    /** Chord through P,Q in the plane of F_p (unwrapped coords), then wrap. */
    function chordWraps(P, Q, p, extend) {
        extend = extend == null ? 1.4 : extend;
        if (!P || !Q || P.inf || Q.inf) return [];
        var dx = Q.x - P.x;
        var dy = Q.y - P.y;
        if (dx === 0 && dy === 0) return [];
        var x0 = P.x - dx * extend;
        var y0 = P.y - dy * extend;
        var x1 = Q.x + dx * extend;
        var y1 = Q.y + dy * extend;
        return wrapLineSamples(x0, y0, x1, y1, p, 64);
    }

    var F17 = pickGenerator(17);

    function sumDistinctReal(x1, y1, x2, y2) {
        var lam = (y2 - y1) / (x2 - x1);
        var x = lam * lam - x1 - x2;
        var y = lam * (x1 - x) - y1;
        return { x: x, y: y, lam: lam };
    }

    function sumDoubleReal(x1, y1) {
        var lam = (3 * x1 * x1 + A) / (2 * y1);
        var x = lam * lam - 2 * x1;
        var y = lam * (x1 - x) - y1;
        return { x: x, y: y, lam: lam };
    }

    function demoRealOps() {
        var px = 2;
        var qx = 3;
        var py = yUpperReal(px);
        var qy = yUpperReal(qx);
        var P = { x: px, y: py };
        var Q = { x: qx, y: qy };
        var R = sumDistinctReal(P.x, P.y, Q.x, Q.y);
        var Rp = { x: R.x, y: -R.y };
        var R2 = sumDoubleReal(P.x, P.y);
        var R2p = { x: R2.x, y: -R2.y };
        var nQ = { x: Q.x, y: -Q.y };
        var S = sumDistinctReal(P.x, P.y, nQ.x, nQ.y);
        var Sp = { x: S.x, y: -S.y };
        return { P: P, Q: Q, R: R, Rp: Rp, R2: R2, R2p: R2p, nP: { x: P.x, y: -P.y }, nQ: nQ, S: S, Sp: Sp };
    }

    function demoAddPair(p) {
        p = p || 17;
        var pts = p === 17 ? F17.points : toyCurvePoints(p);
        var P = null, Q = null, i;
        if (p === 17) {
            for (i = 0; i < pts.length; i++) {
                if (pts[i].x === 2) { P = pts[i]; break; }
            }
        }
        if (!P) P = pts[0];
        for (i = 0; i < pts.length; i++) {
            if (pts[i].x !== P.x) { Q = pts[i]; break; }
        }
        if (!Q) Q = pts[1] || pts[0];
        var R = addFp(P, Q, p);
        var Rp = R.inf ? INF : { x: R.x, y: mod(-R.y, p) };
        return { P: P, Q: Q, R: R, Rp: Rp, p: p };
    }

    global.ECC = {
        A: A,
        B: B,
        INSTANCE_CAP: INSTANCE_CAP,
        INSTANCE_CAP_MAX: INSTANCE_CAP_MAX,
        schematicCountForBits: schematicCountForBits,
        PRIME_LADDER: PRIME_LADDER,
        fieldScale: fieldScale,
        formatPow2: formatPow2,
        DIM_STEPS: DIM_STEPS,
        DIM_NAMES: DIM_NAMES,
        VIEWS: VIEWS,
        INF: INF,
        mod: mod,
        yUpperReal: yUpperReal,
        sampleRealCurve: sampleRealCurve,
        toyCurvePoints: toyCurvePoints,
        addFp: addFp,
        sumDoubleFp: sumDoubleFp,
        negPt: negPt,
        eqPt: eqPt,
        sampleDomain: sampleDomain,
        dimIndexToT: dimIndexToT,
        tToDimIndex: tToDimIndex,
        fieldPointsForPrime: fieldPointsForPrime,
        schematicPoints: schematicPoints,
        chordWraps: chordWraps,
        wrapLineSamples: wrapLineSamples,
        lineSlopeFp: lineSlopeFp,
        shortenFp: shortenFp,
        pickGenerator: pickGenerator,
        multiplesOf: multiplesOf,
        F17: F17,
        demoAddPair: demoAddPair,
        sumDistinctReal: sumDistinctReal,
        sumDoubleReal: sumDoubleReal,
        demoRealOps: demoRealOps
    };
})(typeof window !== 'undefined' ? window : this);
