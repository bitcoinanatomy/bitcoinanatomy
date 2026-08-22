/**
 * ExplorerAudio — shared Web Audio layer for explorer pages.
 * Survives soft-nav / WebXR; unlocks on a user gesture (Enter VR, first select).
 * Exposed as window.ExplorerAudio.
 */
(function () {
    'use strict';

    var STORAGE_MUTE = 'explorerAudioMuted';
    var CROSSFADE_S = 0.8;
    var SCAPE_GAIN = 0.28;
    var SFX_GAIN = 0.45;
    var DUCK_GAIN = 0.12;

    var PAGE_SCAPES = {
        'network.html': 'network',
        'node.html': 'node',
        'blockchain.html': 'blockchain',
        'difficulty.html': 'difficulty',
        'block.html': 'block',
        'transaction.html': 'transaction',
        'address.html': 'address',
        'mempool.html': 'mempool'
    };

    var SFX_IDS = {
        'ui-hover': 'ui-hover',
        'ui-select': 'ui-select',
        'ui-menu': 'ui-menu',
        'page-whoosh': 'page-whoosh'
    };

    var ext = null;
    var ctx = null;
    var master = null;
    var scapeBus = null;
    var sfxBus = null;
    var duckGain = null;
    var listener = null;
    var listenerParent = null;
    var unlocked = false;
    var muted = false;
    var pendingScape = null;
    var currentScapeKey = null;
    var activeSlot = 0;
    var slots = [null, null];
    var bufferCache = {};
    var loadPromises = {};
    var lastHoverAt = 0;

    try {
        muted = localStorage.getItem(STORAGE_MUTE) === '1';
    } catch (e) { /* ignore */ }

    function pickExt() {
        if (ext) return ext;
        var a = document.createElement('audio');
        if (a.canPlayType('audio/ogg; codecs="vorbis"')) ext = 'ogg';
        else ext = 'mp3';
        return ext;
    }

    function urlFor(kind, name) {
        return 'sounds/' + kind + '/' + name + '.' + pickExt();
    }

    function ensureContext() {
        if (ctx) return ctx;
        if (typeof THREE !== 'undefined' && THREE.AudioListener) {
            listener = new THREE.AudioListener();
            ctx = listener.context;
        } else {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        master = ctx.createGain();
        duckGain = ctx.createGain();
        scapeBus = ctx.createGain();
        sfxBus = ctx.createGain();
        scapeBus.gain.value = SCAPE_GAIN;
        sfxBus.gain.value = SFX_GAIN;
        duckGain.gain.value = 1;
        master.gain.value = muted ? 0 : 1;
        scapeBus.connect(duckGain);
        duckGain.connect(master);
        sfxBus.connect(master);
        master.connect(ctx.destination);
        return ctx;
    }

    function resume() {
        ensureContext();
        if (ctx.state === 'suspended') {
            ctx.resume().catch(function () { /* autoplay */ });
        }
        if (listener && listener.context && listener.context.state === 'suspended') {
            listener.context.resume().catch(function () { /* autoplay */ });
        }
    }

    function loadBuffer(url) {
        if (bufferCache[url]) return Promise.resolve(bufferCache[url]);
        if (loadPromises[url]) return loadPromises[url];
        ensureContext();
        loadPromises[url] = fetch(url, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.arrayBuffer();
            })
            .then(function (ab) {
                return ctx.decodeAudioData(ab);
            })
            .then(function (buf) {
                bufferCache[url] = buf;
                return buf;
            })
            .catch(function (err) {
                delete loadPromises[url];
                console.warn('[ExplorerAudio] failed to load', url, err);
                return null;
            });
        return loadPromises[url];
    }

    function stopSlot(i, fade) {
        var slot = slots[i];
        if (!slot) return;
        var now = ctx.currentTime;
        try {
            slot.gain.gain.cancelScheduledValues(now);
            slot.gain.gain.setValueAtTime(slot.gain.gain.value, now);
            slot.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        } catch (e) { /* ignore */ }
        var src = slot.src;
        setTimeout(function () {
            try { src.stop(); } catch (e2) { /* ignore */ }
            try { src.disconnect(); } catch (e3) { /* ignore */ }
            try { slot.gain.disconnect(); } catch (e4) { /* ignore */ }
        }, (fade + 0.05) * 1000);
        slots[i] = null;
    }

    function startSlot(i, buffer, fade) {
        if (!buffer || !ctx) return;
        var src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        var g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(g);
        g.connect(scapeBus);
        var now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(1, now + fade);
        try { src.start(); } catch (e) { /* ignore */ }
        slots[i] = { src: src, gain: g };
    }

    function applyScape(key) {
        if (!key || currentScapeKey === key) return;
        var url = urlFor('scapes', key);
        loadBuffer(url).then(function (buf) {
            if (!buf) return;
            if (pendingScape !== key) return;
            ensureContext();
            var next = 1 - activeSlot;
            startSlot(next, buf, CROSSFADE_S);
            stopSlot(activeSlot, CROSSFADE_S);
            activeSlot = next;
            currentScapeKey = key;
        });
    }

    function pageFileNow() {
        try {
            return (window.location.pathname || '').split('/').pop() || '';
        } catch (e) {
            return '';
        }
    }

    function syncDesktopToggle() {
        var btn = document.getElementById('toggle-audio');
        if (!btn) return;
        btn.classList.toggle('active', !muted);
        btn.title = muted ? 'Sound off' : 'Sound on';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
        var icon = document.getElementById('toggle-audio-icon');
        if (icon) {
            icon.innerHTML = muted
                ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
                : '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
        }
    }

    var ExplorerAudio = {
        unlock: function () {
            ensureContext();
            resume();
            unlocked = true;
            var key = pendingScape;
            if (!key) {
                var file = pageFileNow();
                key = PAGE_SCAPES[file] || null;
                pendingScape = key;
            }
            if (key && currentScapeKey !== key) applyScape(key);
            ['ui-hover', 'ui-select', 'ui-menu', 'page-whoosh'].forEach(function (id) {
                loadBuffer(urlFor('sfx', id));
            });
        },

        resume: resume,

        isMuted: function () { return muted; },

        isUnlocked: function () { return unlocked; },

        setMuted: function (on) {
            muted = !!on;
            ensureContext();
            var now = ctx.currentTime;
            master.gain.cancelScheduledValues(now);
            master.gain.setValueAtTime(master.gain.value, now);
            master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.12);
            try {
                localStorage.setItem(STORAGE_MUTE, muted ? '1' : '0');
            } catch (e) { /* ignore */ }
            syncDesktopToggle();
        },

        toggleMuted: function () {
            ExplorerAudio.setMuted(!muted);
            return muted;
        },

        setSoundscape: function (pageFile) {
            var key = PAGE_SCAPES[pageFile] || null;
            pendingScape = key;
            if (!key) {
                if (ctx) {
                    stopSlot(0, CROSSFADE_S);
                    stopSlot(1, CROSSFADE_S);
                }
                currentScapeKey = null;
                return;
            }
            if (!unlocked) return;
            applyScape(key);
        },

        prefetch: function (pageFile) {
            var key = PAGE_SCAPES[pageFile];
            if (!key) return;
            loadBuffer(urlFor('scapes', key));
        },

        play: function (id) {
            if (!unlocked || muted) return;
            var name = SFX_IDS[id];
            if (!name) return;
            if (id === 'ui-hover') {
                var t = performance.now();
                if (t - lastHoverAt < 80) return;
                lastHoverAt = t;
            }
            ensureContext();
            resume();
            loadBuffer(urlFor('sfx', name)).then(function (buf) {
                if (!buf || muted) return;
                var src = ctx.createBufferSource();
                src.buffer = buf;
                var g = ctx.createGain();
                g.gain.value = 1;
                src.connect(g);
                g.connect(sfxBus);
                try { src.start(); } catch (e) { /* ignore */ }
                src.onended = function () {
                    try { src.disconnect(); g.disconnect(); } catch (e2) { /* ignore */ }
                };
            });
        },

        setDuck: function (on) {
            if (!ctx || !duckGain) {
                ensureContext();
            }
            var now = ctx.currentTime;
            duckGain.gain.cancelScheduledValues(now);
            duckGain.gain.setValueAtTime(duckGain.gain.value, now);
            duckGain.gain.linearRampToValueAtTime(on ? DUCK_GAIN : 1, now + 0.4);
        },

        attachListener: function (camera) {
            if (!camera || typeof THREE === 'undefined') return;
            ensureContext();
            if (!listener) return;
            if (listenerParent === camera) return;
            if (listener.parent) listener.parent.remove(listener);
            camera.add(listener);
            listenerParent = camera;
        },

        bindDesktopToggle: function () {
            var btn = document.getElementById('toggle-audio');
            if (!btn || btn.dataset.audioBound) return;
            btn.dataset.audioBound = '1';
            btn.addEventListener('click', function () {
                ExplorerAudio.unlock();
                ExplorerAudio.toggleMuted();
            });
            syncDesktopToggle();
        }
    };

    if (typeof window !== 'undefined') {
        window.ExplorerAudio = ExplorerAudio;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                ExplorerAudio.bindDesktopToggle();
            });
        } else {
            ExplorerAudio.bindDesktopToggle();
        }
    }
})();
