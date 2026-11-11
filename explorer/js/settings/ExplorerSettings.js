/**
 * ExplorerSettings — shared, persisted user settings for all explorer pages.
 * Exposed as window.ExplorerSettings.
 *
 * Stored as one JSON blob in localStorage ('explorer.settings'). Every storage
 * access is guarded so pages still work with storage blocked (private mode).
 * URL params (?fx=0, ?quality=low) override for the current page load only.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'explorer.settings';
    var AUDIO_MUTE_KEY = 'explorerAudioMuted';

    function detectTier() {
        var ua = navigator.userAgent || '';
        var mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Quest/i.test(ua) ||
            (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024);
        var lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
        var lowCpu = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
        if (mobile || (lowMem && lowCpu)) return 'low';
        return 'high';
    }

    // Values filled in by each preset. Anything not listed keeps its value.
    var PRESETS = {
        low: {
            postprocessing: true, grain: 0.05, vignette: 0.35, bloom: 0, chromatic: false,
            backdrop: true, resolutionScale: 0.75, pixelRatioCap: 1.5, antialias: false, shadows: false
        },
        medium: {
            postprocessing: true, grain: 0.06, vignette: 0.4, bloom: 0.5, chromatic: false,
            backdrop: true, resolutionScale: 1, pixelRatioCap: 1.5, antialias: true, shadows: false
        },
        high: {
            postprocessing: true, grain: 0.06, vignette: 0.45, bloom: 0.8, chromatic: false,
            backdrop: true, resolutionScale: 1, pixelRatioCap: 2, antialias: true, shadows: true
        }
    };

    var tier = detectTier();

    function defaults() {
        var d = {
            preset: tier,
            showFps: false,
            grainMotionOnly: true,   // grain pattern animates only while the view moves
            globeStyle: 'photo',     // photo | dots | hidden
            maxNodes: 0              // 0 = all
        };
        var p = PRESETS[tier];
        for (var k in p) d[k] = p[k];
        return d;
    }

    // Keys that only take effect when the renderer / page is created.
    var RELOAD_KEYS = { antialias: true, maxNodes: true };

    function readStored() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) || {} : {};
        } catch (e) { return {}; }
    }

    function writeStored(obj) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (e) { /* storage blocked */ }
    }

    function urlOverrides() {
        var o = {};
        try {
            var q = new URLSearchParams(location.search);
            if (q.get('fx') === '0') o.postprocessing = false;
            if (q.get('fx') === '1') o.postprocessing = true;
            var preset = q.get('quality');
            if (preset && PRESETS[preset]) {
                var p = PRESETS[preset];
                for (var k in p) o[k] = p[k];
                o.preset = preset;
            }
        } catch (e) { /* ignore */ }
        return o;
    }

    var stored = readStored();
    var overrides = urlOverrides();
    var listeners = [];

    function merged() {
        var m = defaults();
        var k;
        for (k in stored) if (k in m) m[k] = stored[k];
        for (k in overrides) m[k] = overrides[k];
        return m;
    }

    var current = merged();

    function emit(changed) {
        var snapshot = all();
        listeners.slice().forEach(function (fn) {
            try { fn(snapshot, changed); } catch (e) { console.error('ExplorerSettings listener', e); }
        });
        try {
            window.dispatchEvent(new CustomEvent('explorer:settings', { detail: { settings: snapshot, changed: changed } }));
        } catch (e) { /* old browsers */ }
    }

    function all() {
        var o = {};
        for (var k in current) o[k] = current[k];
        o.muted = getMuted();
        return o;
    }

    function getMuted() {
        if (window.ExplorerAudio && typeof ExplorerAudio.isMuted === 'function') return ExplorerAudio.isMuted();
        try { return localStorage.getItem(AUDIO_MUTE_KEY) === '1'; } catch (e) { return false; }
    }

    function setMuted(v) {
        if (window.ExplorerAudio && typeof ExplorerAudio.setMuted === 'function') {
            ExplorerAudio.setMuted(!!v);
            return;
        }
        try { localStorage.setItem(AUDIO_MUTE_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    function get(key) {
        if (key === 'muted') return getMuted();
        return current[key];
    }

    /** Set one key, or several via an object. Editing a preset field switches preset to 'custom'. */
    function set(key, value) {
        var patch = {};
        if (typeof key === 'object') patch = key; else patch[key] = value;

        if ('muted' in patch) { setMuted(patch.muted); delete patch.muted; }

        if (patch.preset && PRESETS[patch.preset]) {
            var p = PRESETS[patch.preset];
            for (var pk in p) if (!(pk in patch)) patch[pk] = p[pk];
        } else if (!('preset' in patch)) {
            for (var fk in patch) {
                if (fk in PRESETS.high) { patch.preset = 'custom'; break; }
            }
        }

        var changed = [];
        for (var k in patch) {
            if (!(k in current)) continue;
            if (current[k] !== patch[k]) changed.push(k);
            current[k] = patch[k];
            stored[k] = patch[k];
            delete overrides[k];
        }
        writeStored(stored);
        emit(changed);
    }

    function reset() {
        stored = {};
        overrides = {};
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        current = merged();
        emit(Object.keys(current));
    }

    /** Subscribe; returns an unsubscribe function. Pass an AbortSignal to auto-unsubscribe. */
    function onChange(fn, signal) {
        listeners.push(fn);
        var off = function () {
            var i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        };
        if (signal) signal.addEventListener('abort', off, { once: true });
        return off;
    }

    // Changes made in another tab (e.g. the settings page) apply live here.
    window.addEventListener('storage', function (e) {
        if (e.key === STORAGE_KEY) {
            stored = readStored();
            var before = current;
            current = merged();
            var changed = [];
            for (var k in current) if (before[k] !== current[k]) changed.push(k);
            if (changed.length) emit(changed);
        } else if (e.key === AUDIO_MUTE_KEY) {
            var want = e.newValue === '1';
            if (window.ExplorerAudio && typeof ExplorerAudio.isMuted === 'function' &&
                ExplorerAudio.isMuted() !== want) {
                ExplorerAudio.setMuted(want);
            }
            emit(['muted']);
        }
    });

    /** Effective device pixel ratio after scale + cap. */
    function pixelRatio() {
        var dpr = window.devicePixelRatio || 1;
        return Math.max(0.5, Math.min(dpr, current.pixelRatioCap || 2) * (current.resolutionScale || 1));
    }

    /** Applies the resolution settings to a renderer, live (no-op while in XR). */
    function applyToRenderer(renderer) {
        if (!renderer || (renderer.xr && renderer.xr.isPresenting)) return;
        var pr = pixelRatio();
        if (Math.abs(renderer.getPixelRatio() - pr) > 0.001) {
            renderer.setPixelRatio(pr); // three re-applies the current size internally
        }
    }

    window.ExplorerSettings = {
        get: get,
        set: set,
        all: all,
        reset: reset,
        onChange: onChange,
        pixelRatio: pixelRatio,
        applyToRenderer: applyToRenderer,
        presets: PRESETS,
        tier: tier,
        isReloadKey: function (k) { return !!RELOAD_KEYS[k]; }
    };
})();
