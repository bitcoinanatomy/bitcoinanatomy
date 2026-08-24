/**
 * ExplorerRouter — soft-navigate between explorer pages without a full reload.
 *
 * Reuses the live WebGL renderer (and WebXR session when presenting).
 * First visit / hard refresh / open-in-new-tab still load real *.html files.
 *
 * Exposed as window.ExplorerRouter and window.explorerNavigate(url).
 */
(function () {
    'use strict';

    var PAGE_SCRIPTS = {
        'network.html':     'js/network.js',
        'node.html':        'js/node.js',
        'blockchain.html':  'js/blockchain.js',
        'difficulty.html':  'js/difficulty.js',
        'block.html':       'js/block.js',
        'transaction.html': 'js/transaction.js',
        'address.html':     'js/address.js',
        'mempool.html':     'js/mempool.js',
        'curve.html':       'js/crypto.js',
        'crypto.html':      'js/crypto.js',
        'script.html':      'js/script.js',
    };

    var EXPLORER_FILES = Object.keys(PAGE_SCRIPTS);

    var _gen = 0;
    var _navigating = false;
    var _loadedScripts = {};
    var _started = false;

    function pageFileFromUrl(url) {
        try {
            var u = new URL(url, window.location.href);
            var file = (u.pathname.split('/').pop() || '') || null;
            if (file === 'crypto.html') return 'curve.html';
            return file;
        } catch (e) {
            return null;
        }
    }

    function isExplorerFile(file) {
        return !!(file && PAGE_SCRIPTS[file]);
    }

    function sameDocumentUrl(url) {
        try {
            var u = new URL(url, window.location.href);
            return u.origin === window.location.origin &&
                u.pathname === window.location.pathname &&
                u.search === window.location.search;
        } catch (e) {
            return false;
        }
    }

    function loadScriptOnce(src) {
        if (_loadedScripts[src]) return _loadedScripts[src];
        _loadedScripts[src] = new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[src="' + src + '"]');
            if (existing && window.ExplorerPages) {
                resolve();
                return;
            }
            var s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(s);
        });
        return _loadedScripts[src];
    }

    function disposeObject3D(root) {
        if (!root) return;
        root.traverse(function (child) {
            if (child.geometry) {
                try { child.geometry.dispose(); } catch (e) { /* ignore */ }
            }
            var mats = child.material;
            if (!mats) return;
            var list = Array.isArray(mats) ? mats : [mats];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (!m) continue;
                try {
                    if (m.map) m.map.dispose();
                    m.dispose();
                } catch (e) { /* ignore */ }
            }
        });
    }

    function getShell() {
        var ex = window.__explorer;
        if (!ex || !ex.renderer || !ex.scene) return null;
        return {
            renderer: ex.renderer,
            scene: ex.scene,
            camera: ex.camera,
            vrManager: ex.vrManager || null,
        };
    }

    function updateNavbarActive(file) {
        document.querySelectorAll('nav.navbar .nav-link').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            var f = href.split('/').pop();
            if (f === file) a.classList.add('active');
            else a.classList.remove('active');
        });
    }

    /** Soft-nav only swaps #ui; disclaimer lives outside it — keep data sources in sync. */
    function updateDisclaimer(doc) {
        var next = doc.querySelector('.disclaimer');
        var cur = document.querySelector('.disclaimer');
        if (!next) {
            if (cur) cur.remove();
            return;
        }
        var imported = document.importNode(next, true);
        // Preserve VR/session visibility hide on the live element
        if (cur && cur.style && cur.style.visibility) {
            imported.style.visibility = cur.style.visibility;
        }
        if (cur) {
            cur.replaceWith(imported);
            return;
        }
        var container = document.getElementById('container');
        if (container) container.insertAdjacentElement('afterend', imported);
        else document.body.appendChild(imported);
    }

    /** Overlays live outside #ui (modals, raw data, treemap, node table). */
    var PAGE_OVERLAY_SELECTOR = [
        '.modal',
        '.raw-data-modal',
        '.treemap-container',
        '.node-table-pane',
        '.loading-modal',
    ].join(', ');

    function isChromeOverlay(el) {
        return !!(el && !el.closest('#container'));
    }

    function hidePageOverlays() {
        document.querySelectorAll('.modal, .raw-data-modal').forEach(function (el) {
            el.style.display = 'none';
        });
        document.querySelectorAll('.treemap-container').forEach(function (el) {
            el.style.display = 'none';
        });
        document.querySelectorAll('.loading-modal, .api-popup').forEach(function (el) {
            el.remove();
        });
    }

    /** Soft-nav only swaps #ui; bring page-specific body overlays along. */
    function syncPageOverlays(doc) {
        document.querySelectorAll(PAGE_OVERLAY_SELECTOR).forEach(function (el) {
            if (isChromeOverlay(el)) el.remove();
        });

        var insertAfter = document.querySelector('.disclaimer') ||
            document.getElementById('container');
        doc.querySelectorAll(PAGE_OVERLAY_SELECTOR).forEach(function (el) {
            if (!isChromeOverlay(el)) return;
            var imported = document.importNode(el, true);
            if (insertAfter) {
                insertAfter.insertAdjacentElement('afterend', imported);
                insertAfter = imported;
            } else {
                document.body.appendChild(imported);
                insertAfter = imported;
            }
        });
    }

    function rebindChrome(shell) {
        var camRoot = document.getElementById('controls-camera-root');
        if (camRoot && typeof ControlsCamera === 'function') {
            ControlsCamera(camRoot, { viewGroup: true });
        }
        if (shell && shell.renderer && typeof VRButton !== 'undefined' && VRButton.reattach) {
            VRButton.reattach(shell.renderer);
        }
        // The .navbar persists across soft-nav (only #ui is swapped). Rebind
        // Explore so listeners are not stacked, then close the drawer.
        if (typeof window.bindExplorerNav === 'function') {
            window.bindExplorerNav();
        }
        if (typeof window.closeExplorerNav === 'function') window.closeExplorerNav();
        if (typeof window.ExplorerAudio !== 'undefined' && ExplorerAudio.bindDesktopToggle) {
            ExplorerAudio.bindDesktopToggle();
        }
    }

    function installNavbarInterceptor() {
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a.nav-link, nav.navbar a[href]') : null;
            if (!a) return;
            if (e.defaultPrevented) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (a.target === '_blank') return;
            var href = a.getAttribute('href');
            if (!href || href.charAt(0) === '#') return;
            var file = pageFileFromUrl(href);
            if (!isExplorerFile(file)) return;
            e.preventDefault();
            if (typeof window.closeExplorerNav === 'function') window.closeExplorerNav();
            ExplorerRouter.navigate(href);
            if (typeof window.ExplorerAudio !== 'undefined') {
                ExplorerAudio.unlock();
                ExplorerAudio.play('ui-select');
            }
        }, true);
    }

    function installPopstate() {
        window.addEventListener('popstate', function () {
            if (!_started || !window.__explorer) return;
            var file = pageFileFromUrl(window.location.href);
            if (!isExplorerFile(file)) return;
            ExplorerRouter.navigate(window.location.href, { fromPopstate: true });
        });
    }

    var ExplorerRouter = {
        generation: function () { return _gen; },

        start: function () {
            if (_started) return;
            _started = true;
            // Mark scripts already on the page as loaded
            EXPLORER_FILES.forEach(function (file) {
                var src = PAGE_SCRIPTS[file];
                if (document.querySelector('script[src="' + src + '"]')) {
                    _loadedScripts[src] = Promise.resolve();
                }
            });
            ['js/ecc-curve.js', 'js/difficultySpiral.js'].forEach(function (src) {
                if (document.querySelector('script[src="' + src + '"]')) {
                    _loadedScripts[src] = Promise.resolve();
                }
            });
            installNavbarInterceptor();
            installPopstate();
            if (typeof window.ExplorerAudio !== 'undefined') {
                var bootFile = pageFileFromUrl(window.location.href);
                if (bootFile) ExplorerAudio.setSoundscape(bootFile);
            }
        },

        navigate: function (url, opts) {
            opts = opts || {};
            return ExplorerRouter._navigate(url, opts);
        },

        _navigate: async function (url, opts) {
            if (_navigating) return;
            var file = pageFileFromUrl(url);
            if (!isExplorerFile(file)) {
                window.location.assign(url);
                return;
            }

            var shell = getShell();
            var pages = window.ExplorerPages || {};
            // Soft-nav only after first explorer boot and when page is registered (or script loadable)
            if (!shell || !window.__explorer) {
                window.location.assign(url);
                return;
            }

            if (!opts.fromPopstate && !opts.force && sameDocumentUrl(url)) return;

            _navigating = true;
            window.__softNav = true;
            var myGen = ++_gen;

            try {
                var abs = new URL(url, window.location.href);
                if ((abs.pathname.split('/').pop() || '') === 'crypto.html') {
                    abs.pathname = abs.pathname.replace(/crypto\.html$/, 'curve.html');
                    url = abs.pathname + abs.search + abs.hash;
                }
                var targetPath = abs.pathname + abs.search + abs.hash;

                // Fetch target HTML for #ui + title
                var res = await fetch(abs.href, { credentials: 'same-origin' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var html = await res.text();
                if (myGen !== _gen) return;

                var doc = new DOMParser().parseFromString(html, 'text/html');
                var newUi = doc.getElementById('ui');
                var oldUi = document.getElementById('ui');
                if (!newUi || !oldUi) throw new Error('Missing #ui');

                // Ensure page script + registry entry
                if (file === 'blockchain.html') {
                    await loadScriptOnce('js/difficultySpiral.js');
                }
                if (file === 'curve.html' || file === 'crypto.html') {
                    await loadScriptOnce('js/ecc-curve.js');
                }
                await loadScriptOnce(PAGE_SCRIPTS[file]);
                if (myGen !== _gen) return;
                pages = window.ExplorerPages || {};
                if (!pages[file] || typeof pages[file].create !== 'function') {
                    throw new Error('ExplorerPages[' + file + '] not registered');
                }

                var presenting = !!(shell.renderer.xr && shell.renderer.xr.isPresenting);
                var old = window.__explorer;

                // Dispose previous page
                if (old && typeof old.dispose === 'function') {
                    try { old.dispose(); } catch (e) { console.warn('[ExplorerRouter] dispose:', e); }
                }
                if (shell.vrManager && typeof shell.vrManager.clearContent === 'function') {
                    shell.vrManager.clearContent();
                } else {
                    // Fallback: strip non-essential scene children
                    shell.scene.children.slice().forEach(function (c) {
                        if (shell.vrManager && shell.vrManager._shouldKeepInScene &&
                            shell.vrManager._shouldKeepInScene(c)) return;
                        if (c === shell.camera) return;
                        shell.scene.remove(c);
                        disposeObject3D(c);
                    });
                }

                hidePageOverlays();
                if (typeof window.ExplorerAudio !== 'undefined') {
                    ExplorerAudio.play('page-whoosh');
                    ExplorerAudio.setDuck(false);
                }

                // Swap UI
                oldUi.replaceWith(document.importNode(newUi, true));
                if (doc.title) document.title = doc.title;
                updateNavbarActive(file);
                updateDisclaimer(doc);
                syncPageOverlays(doc);

                if (!opts.fromPopstate) {
                    if (opts.replace) history.replaceState({ softNav: true }, '', targetPath);
                    else history.pushState({ softNav: true }, '', targetPath);
                }

                rebindChrome(shell);

                var meta = pages[file];
                var next = meta.create({ shell: shell });
                window.__explorer = next;

                if (shell.vrManager && typeof shell.vrManager.bindExplorer === 'function') {
                    shell.vrManager.bindExplorer(next, {
                        panelTitle: meta.panelTitle,
                        panelDomId: meta.panelDomId,
                        presenting: presenting,
                    });
                }

                if (typeof window.ExplorerAudio !== 'undefined') {
                    ExplorerAudio.setSoundscape(file);
                }

                if (presenting && shell.vrManager) {
                    if (typeof shell.vrManager.afterSoftNav === 'function') {
                        shell.vrManager.afterSoftNav();
                    }
                }
            } catch (err) {
                console.error('[ExplorerRouter] soft-nav failed, falling back:', err);
                window.location.assign(url);
            } finally {
                _navigating = false;
                window.__softNav = false;
            }
        },
    };

    function explorerNavigate(url, opts) {
        // External / non-explorer links always hard-navigate
        var file = pageFileFromUrl(url);
        if (!isExplorerFile(file)) {
            window.location.href = url;
            return;
        }
        if (window.ExplorerRouter) return window.ExplorerRouter.navigate(url, opts);
        window.location.href = url;
    }

    window.ExplorerRouter = ExplorerRouter;
    window.explorerNavigate = explorerNavigate;
    window.ExplorerPages = window.ExplorerPages || {};

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { ExplorerRouter.start(); });
    } else {
        ExplorerRouter.start();
    }
})();
