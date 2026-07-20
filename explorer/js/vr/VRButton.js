/**
 * VRButton — wires up immersive-vr and immersive-ar WebXR sessions to buttons.
 *
 * #vr-button  → immersive-vr  (full VR)
 * #ar-button  → immersive-ar  (passthrough / mixed reality, Quest 3 / compatible devices)
 *
 * If the DOM elements already exist they are reused; otherwise floating fallbacks
 * are created. AR button is hidden when the device does not support immersive-ar.
 * Exposed as window.VRButton.
 */
(function () {
    'use strict';

    function showXRInstructions(currentUrl, onStartVR, onStartAR) {
        if (document.getElementById('vr-instructions-modal')) return;

        if (!document.getElementById('vr-inter-font')) {
            var link = document.createElement('link');
            link.id   = 'vr-inter-font';
            link.rel  = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap';
            document.head.appendChild(link);
        }

        var F  = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        var FC = '"BureauGrotesque", sans-serif';

        var overlay = document.createElement('div');
        overlay.id = 'vr-instructions-modal';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.82)',
            'backdrop-filter:blur(10px)', 'display:flex',
            'align-items:center', 'justify-content:center',
            'z-index:99999', 'padding:20px', 'box-sizing:border-box',
        ].join(';');

        var box = document.createElement('div');
        box.style.cssText = [
            'background:#000', 'border:1px solid rgba(255,255,255,0.1)',
            'border-radius:0', 'padding:0', 'max-width:520px', 'width:100%',
            'color:rgba(255,255,255,0.8)', 'font-family:' + F,
            'font-size:13px', 'font-weight:400', 'line-height:1.6',
            'position:relative', 'box-shadow:0 10px 40px rgba(0,0,0,0.6)',
        ].join(';');

        var pageUrl = currentUrl || window.location.href;

        var header = document.createElement('div');
        header.style.cssText = [
            'display:flex', 'justify-content:space-between', 'align-items:center',
            'padding:14px 20px', 'border-bottom:1px solid rgba(255,255,255,0.1)',
        ].join(';');

        var title = document.createElement('span');
        title.textContent = 'How to Enter XR';
        title.style.cssText = [
            'font-family:' + FC, 'font-size:1rem', 'font-weight:600',
            'letter-spacing:0.02em', 'color:rgba(255,255,255,0.95)', 'text-transform:uppercase',
        ].join(';');

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><line x1="13" y1="1" x2="1" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>';
        closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;line-height:0;padding:0;display:flex;align-items:center;justify-content:center;';
        header.appendChild(title);
        header.appendChild(closeBtn);

        var body = document.createElement('div');
        body.style.cssText = 'padding:24px 20px;';

        var sections = [
            {
                label: 'Desktop — Chrome / Edge',
                steps: [
                    'Install the <a href="https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;text-underline-offset:3px;">Meta Immersive Web Emulator</a> Chrome extension.',
                    'Reload this page — the extension adds virtual controllers.',
                    'Click <strong>Enter VR</strong> to start the simulated session.',
                ],
            },
            {
                label: 'Meta Quest 3 — VR + Mixed Reality',
                steps: [
                    'Open <strong>Meta Quest Browser</strong> on your headset.',
                    'Navigate to: <span style="display:inline-block;background:#111;border:1px solid rgba(255,255,255,0.1);padding:2px 6px;word-break:break-all;font-family:monospace;font-size:11px;">' + pageUrl + '</span>',
                    'Tap <strong>Enter VR</strong> for full immersion, or <strong>Enter MR</strong> to explore data layered over the real world.',
                ],
            },
            {
                label: 'Any WebXR Headset',
                steps: [
                    'Open this page in your headset\'s browser.',
                    'Supported on Meta Quest, Apple Vision Pro, Pico, and most standalone headsets.',
                    'Mixed reality (MR) requires a device with color passthrough.',
                ],
            },
        ];

        sections.forEach(function (sec, i) {
            var secEl = document.createElement('div');
            secEl.style.marginBottom = i < sections.length - 1 ? '20px' : '0';
            var lbl = document.createElement('div');
            lbl.textContent = sec.label;
            lbl.style.cssText = 'font-family:' + F + ';font-size:0.68rem;font-weight:300;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);margin-bottom:8px;';
            var ol = document.createElement('ol');
            ol.style.cssText = 'margin:0;padding-left:18px;color:rgba(255,255,255,0.75);';
            sec.steps.forEach(function (step) {
                var li = document.createElement('li');
                li.innerHTML = step;
                li.style.marginBottom = '4px';
                ol.appendChild(li);
            });
            secEl.appendChild(lbl);
            secEl.appendChild(ol);
            body.appendChild(secEl);
        });

        var note = document.createElement('div');
        note.innerHTML = 'XR requires HTTPS. Locally? Run <code style="background:#111;padding:1px 5px;font-size:11px;">node server.js --https</code> then accept the self-signed cert.';
        note.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.3);font-size:11px;line-height:1.5;';
        body.appendChild(note);

        var footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:14px 20px;border-top:1px solid rgba(255,255,255,0.1);';

        function dismiss() { overlay.remove(); }

        function makeFooterBtn(text, primary, onClick) {
            var btn = document.createElement('button');
            btn.textContent = text;
            btn.style.cssText = [
                'padding:0 20px', 'height:28px',
                'background:' + (primary ? '#fff' : 'rgba(255,255,255,0.06)'),
                'color:' + (primary ? '#000' : 'rgba(255,255,255,0.6)'),
                'border:' + (primary ? 'none' : '1px solid rgba(255,255,255,0.12)'),
                'border-radius:0', 'font-family:' + F,
                'font-size:0.72rem', 'font-weight:300',
                'letter-spacing:0.12em', 'text-transform:uppercase', 'cursor:pointer',
            ].join(';');
            btn.addEventListener('click', function () { dismiss(); if (onClick) onClick(); });
            return btn;
        }

        if (onStartAR) footer.appendChild(makeFooterBtn('Enter MR',   false, onStartAR));
        if (onStartVR) footer.appendChild(makeFooterBtn('Enter VR',   true,  onStartVR));
        footer.appendChild(makeFooterBtn(onStartVR || onStartAR ? 'Close' : 'Dismiss', false, null));

        closeBtn.addEventListener('click', dismiss);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });

        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // -------------------------------------------------------------------------

    var VRButton = {
        createButton: function (renderer, options) {
            var vrInit = Object.assign(
                { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'bounded-floor'] },
                options || {}
            );
            var arInit = {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['hand-tracking', 'dom-overlay'],
            };

            var vrBtn = document.getElementById('vr-button');
            var arBtn = document.getElementById('ar-button');
            if (!vrBtn) {
                vrBtn = document.createElement('button');
                vrBtn.id = 'vr-button';
                vrBtn.style.cssText = [
                    'position:fixed', 'bottom:20px', 'left:calc(50% - 60px)',
                    'padding:10px 22px', 'border:2px solid rgba(255,255,255,0.15)',
                    'border-radius:0', 'background:rgba(0,0,0,0.7)',
                    'color:rgba(255,255,255,0.7)', 'font-family:monospace',
                    'font-size:13px', 'cursor:pointer', 'z-index:9999',
                ].join(';');
                document.body.appendChild(vrBtn);
            }
            if (!arBtn) {
                arBtn = document.createElement('button');
                arBtn.id = 'ar-button';
                arBtn.style.cssText = [
                    'position:fixed', 'bottom:20px', 'left:calc(50% + 60px)',
                    'padding:10px 22px', 'border:2px solid rgba(255,255,255,0.10)',
                    'border-radius:0', 'background:rgba(0,0,0,0.7)',
                    'color:rgba(255,255,255,0.5)', 'font-family:monospace',
                    'font-size:13px', 'cursor:pointer', 'z-index:9999',
                    'display:none',
                ].join(';');
                document.body.appendChild(arBtn);
            }

            var currentSession = null;
            var vrSupported    = false;
            var arSupported    = false;

            function onSessionStarted(session) {
                currentSession = session;
                session.addEventListener('end', onSessionEnded);
                renderer.xr.setSession(session);
                var isAR = session.environmentBlendMode !== 'opaque';
                vrBtn.textContent = isAR ? 'Enter VR' : 'Exit VR';
                arBtn.textContent = isAR ? 'Exit MR'  : 'Enter MR';
                if (isAR) { arBtn.style.color = '#ffffff'; arBtn.style.borderColor = '#ffffff'; }
                else      { vrBtn.style.color = '#ffffff'; vrBtn.style.borderColor = '#ffffff'; }
            }

            function onSessionEnded() {
                currentSession.removeEventListener('end', onSessionEnded);
                currentSession = null;
                vrBtn.textContent = 'Enter VR';
                arBtn.textContent = 'Enter MR';
                vrBtn.style.color = ''; vrBtn.style.borderColor = '';
                arBtn.style.color = ''; arBtn.style.borderColor = '';
            }

            function startVR() {
                navigator.xr.requestSession('immersive-vr', vrInit)
                    .then(onSessionStarted)
                    .catch(function (e) { console.warn('[VRButton] VR session failed:', e); });
            }

            function startAR() {
                navigator.xr.requestSession('immersive-ar', arInit)
                    .then(onSessionStarted)
                    .catch(function (e) { console.warn('[VRButton] AR session failed:', e); });
            }

            if ('xr' in navigator) {
                // Check VR support
                navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
                    vrSupported = supported;
                    vrBtn.textContent = 'Enter VR';
                    vrBtn.disabled    = false;
                    if (supported) {
                        vrBtn.title = 'Enter immersive VR mode';
                        startVR();
                    } else {
                        vrBtn.style.opacity = '0.6';
                        vrBtn.title = 'VR not detected — click for setup instructions';
                    }
                }).catch(function () {
                    vrBtn.disabled = false; vrBtn.style.opacity = '0.6';
                });

                // Check AR support
                navigator.xr.isSessionSupported('immersive-ar').then(function (supported) {
                    arSupported = supported;
                    if (supported) {
                        arBtn.textContent = 'Enter MR';
                        arBtn.style.display = '';
                        arBtn.title = 'Enter mixed reality (passthrough) mode';
                    }
                }).catch(function () {});
            } else {
                vrBtn.disabled = false; vrBtn.style.opacity = '0.6';
                vrBtn.title = 'WebXR unavailable — click for setup instructions';
            }

            vrBtn.addEventListener('click', function () {
                if (currentSession) { currentSession.end(); return; }
                if (vrSupported) { startVR(); }
                else { showXRInstructions(window.location.href, null, arSupported ? startAR : null); }
            });

            arBtn.addEventListener('click', function () {
                if (currentSession) { currentSession.end(); return; }
                if (arSupported) { startAR(); }
                else { showXRInstructions(window.location.href, vrSupported ? startVR : null, null); }
            });

            return vrBtn;
        }
    };

    if (typeof window !== 'undefined') window.VRButton = VRButton;
})();
