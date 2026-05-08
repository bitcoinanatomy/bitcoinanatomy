/**
 * VRButton — wires up an immersive-vr WebXR session to a button.
 * If a #vr-button element already exists in the DOM it is reused (no extra styles added),
 * so it naturally inherits the page's .controls-main button CSS.
 * If no element exists a floating fallback button is created and appended to document.body.
 * Exposed as window.VRButton.
 */
(function () {
    'use strict';

    function showVRInstructions(currentUrl, onStart) {
        if (document.getElementById('vr-instructions-modal')) return;

        // Inject Inter from Google Fonts once
        if (!document.getElementById('vr-inter-font')) {
            var link = document.createElement('link');
            link.id = 'vr-inter-font';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap';
            document.head.appendChild(link);
        }

        var F  = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        var FC = '"BureauGrotesque", sans-serif'; // site's condensed font — modal title + buttons

        var overlay = document.createElement('div');
        overlay.id = 'vr-instructions-modal';
        overlay.style.cssText = [
            'position: fixed',
            'inset: 0',
            'background: rgba(0,0,0,0.82)',
            'backdrop-filter: blur(10px)',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'z-index: 99999',
            'padding: 20px',
            'box-sizing: border-box',
        ].join(';');

        var box = document.createElement('div');
        box.style.cssText = [
            'background: #000',
            'border: 1px solid rgba(255,255,255,0.1)',
            'border-radius: 0',
            'padding: 0',
            'max-width: 520px',
            'width: 100%',
            'color: rgba(255,255,255,0.8)',
            'font-family: ' + F,
            'font-size: 13px',
            'font-weight: 400',
            'line-height: 1.6',
            'position: relative',
            'box-shadow: 0 10px 40px rgba(0,0,0,0.6)',
        ].join(';');

        var pageUrl = currentUrl || window.location.href;

        // Header
        var header = document.createElement('div');
        header.style.cssText = [
            'display: flex',
            'justify-content: space-between',
            'align-items: center',
            'padding: 14px 20px',
            'border-bottom: 1px solid rgba(255,255,255,0.1)',
        ].join(';');

        var title = document.createElement('span');
        title.textContent = 'How to Test in VR';
        title.style.cssText = [
            'font-family: ' + FC,
            'font-size: 1rem',
            'font-weight: 600',
            'letter-spacing: 0.02em',
            'color: rgba(255,255,255,0.95)',
            'text-transform: uppercase',
        ].join(';');

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><line x1="13" y1="1" x2="1" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>';
        closeBtn.style.cssText = [
            'background: none',
            'border: none',
            'color: rgba(255,255,255,0.35)',
            'cursor: pointer',
            'line-height: 0',
            'padding: 0',
            'display: flex',
            'align-items: center',
            'justify-content: center',
        ].join(';');

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Body
        var body = document.createElement('div');
        body.style.cssText = 'padding: 24px 20px;';

        var sections = [
            {
                label: 'Desktop — Chrome / Edge',
                steps: [
                    'Install the <a href="https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline;text-underline-offset:3px;">Meta Immersive Web Emulator</a> Chrome extension.',
                    'Reload this page — the extension adds a virtual headset &amp; controllers.',
                    'Click <strong>Enter VR</strong> to enter the simulated session.',
                ],
            },
            {
                label: 'Meta Quest 3 / Quest Pro',
                steps: [
                    'Open <strong>Meta Quest Browser</strong> on your headset.',
                    'Navigate to: <span style="display:inline-block;background:#111;border:1px solid rgba(255,255,255,0.1);padding:2px 6px;word-break:break-all;font-family:monospace;font-size:11px;">' + pageUrl + '</span>',
                    'Tap <strong>Enter VR</strong> to start the immersive experience.',
                ],
            },
            {
                label: 'Any WebXR Headset',
                steps: [
                    'Open this page in your headset\'s browser.',
                    'Supported on Meta Quest, Apple Vision Pro, Pico, and most standalone headsets.',
                ],
            },
        ];

        sections.forEach(function (sec, i) {
            var secEl = document.createElement('div');
            secEl.style.cssText = 'margin-bottom:' + (i < sections.length - 1 ? '20px' : '0') + ';';

            var lbl = document.createElement('div');
            lbl.textContent = sec.label;
            lbl.style.cssText = [
                'font-family: ' + F,
                'font-size: 0.68rem',
                'font-weight: 300',
                'text-transform: uppercase',
                'letter-spacing: 0.1em',
                'color: rgba(255,255,255,0.45)',
                'margin-bottom: 8px',
            ].join(';');

            var ol = document.createElement('ol');
            ol.style.cssText = 'margin:0;padding-left:18px;color:rgba(255,255,255,0.75);';
            sec.steps.forEach(function (step) {
                var li = document.createElement('li');
                li.innerHTML = step;
                li.style.cssText = 'margin-bottom:4px;';
                ol.appendChild(li);
            });

            secEl.appendChild(lbl);
            secEl.appendChild(ol);
            body.appendChild(secEl);
        });

        // HTTPS note
        var note = document.createElement('div');
        note.innerHTML = 'VR requires HTTPS. Serving locally? Run <code style="background:#111;padding:1px 5px;font-size:11px;">node server.js --https</code> then accept the self-signed cert on your headset.';
        note.style.cssText = [
            'margin-top: 20px',
            'padding-top: 16px',
            'border-top: 1px solid rgba(255,255,255,0.07)',
            'color: rgba(255,255,255,0.3)',
            'font-size: 11px',
            'line-height: 1.5',
        ].join(';');
        body.appendChild(note);

        // Footer buttons
        var footer = document.createElement('div');
        footer.style.cssText = [
            'display: flex',
            'gap: 8px',
            'justify-content: flex-end',
            'padding: 14px 20px',
            'border-top: 1px solid rgba(255,255,255,0.1)',
        ].join(';');

        function dismiss() { overlay.remove(); }

        if (onStart) {
            var startBtn = document.createElement('button');
            startBtn.textContent = 'Start VR';
            startBtn.style.cssText = [
                'padding: 0 20px',
                'height: 28px',
                'background: #fff',
                'color: #000',
                'border: none',
                'border-radius: 0',
                'font-family: ' + F,
                'font-size: 0.72rem',
                'font-weight: 300',
                'letter-spacing: 0.12em',
                'text-transform: uppercase',
                'cursor: pointer',
            ].join(';');
            startBtn.addEventListener('click', function () { dismiss(); onStart(); });
            footer.appendChild(startBtn);
        }

        var closeSecondary = document.createElement('button');
        closeSecondary.textContent = onStart ? 'Close' : 'Dismiss';
        closeSecondary.style.cssText = [
            'padding: 0 20px',
            'height: 28px',
            'background: rgba(255,255,255,0.06)',
            'color: rgba(255,255,255,0.6)',
            'border: 1px solid rgba(255,255,255,0.12)',
            'border-radius: 0',
            'font-family: ' + F,
            'font-size: 0.72rem',
            'font-weight: 300',
            'letter-spacing: 0.12em',
            'text-transform: uppercase',
            'cursor: pointer',
        ].join(';');

        closeSecondary.addEventListener('click', dismiss);
        closeBtn.addEventListener('click', dismiss);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });

        footer.appendChild(closeSecondary);
        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    var VRButton = {
        createButton: function (renderer, options) {
            var sessionInit = Object.assign(
                { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'bounded-floor'] },
                options || {}
            );

            // Prefer an existing in-page button over creating a floating one
            var existing = document.getElementById('vr-button');
            var button = existing || document.createElement('button');
            var currentSession = null;
            var vrSupported = false;

            function onSessionStarted(session) {
                currentSession = session;
                session.addEventListener('end', onSessionEnded);
                renderer.xr.setSession(session);
                button.textContent = 'Exit VR';
                button.style.color = '#f7931a';
                button.style.borderColor = '#f7931a';
            }

            function onSessionEnded() {
                currentSession.removeEventListener('end', onSessionEnded);
                currentSession = null;
                button.textContent = 'Enter VR';
                button.style.color = '';
                button.style.borderColor = '';
            }

            function startSession() {
                navigator.xr.requestSession('immersive-vr', sessionInit)
                    .then(onSessionStarted)
                    .catch(function (err) {
                        console.warn('[VRButton] Failed to start XR session:', err);
                    });
            }

            function showAutoOverlay() {
                if (document.getElementById('vr-auto-overlay')) return;
                var FC = '"BureauGrotesque", sans-serif';
                var F  = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

                var overlay = document.createElement('div');
                overlay.id = 'vr-auto-overlay';
                overlay.style.cssText = [
                    'position: fixed', 'inset: 0', 'z-index: 99998',
                    'display: flex', 'flex-direction: column',
                    'align-items: center', 'justify-content: center',
                    'cursor: pointer', 'background: transparent',
                ].join(';');

                var label = document.createElement('div');
                label.textContent = 'TAP TO ENTER VR';
                label.style.cssText = [
                    'font-family: ' + FC,
                    'font-size: clamp(1.4rem, 4vw, 2.4rem)',
                    'font-weight: 400',
                    'letter-spacing: 0.12em',
                    'color: rgba(255,255,255,0.90)',
                    'pointer-events: none',
                    'user-select: none',
                    'text-transform: uppercase',
                ].join(';');

                var sub = document.createElement('div');
                sub.textContent = 'WebXR headset detected';
                sub.style.cssText = [
                    'margin-top: 10px',
                    'font-family: ' + F,
                    'font-size: 0.72rem',
                    'font-weight: 300',
                    'letter-spacing: 0.1em',
                    'color: rgba(255,255,255,0.35)',
                    'pointer-events: none',
                    'user-select: none',
                    'text-transform: uppercase',
                ].join(';');

                overlay.appendChild(label);
                overlay.appendChild(sub);
                document.body.appendChild(overlay);

                overlay.addEventListener('click', function () {
                    overlay.remove();
                    startSession();
                });
            }

            if ('xr' in navigator) {
                navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
                    vrSupported = supported;
                    button.textContent = 'Enter VR';
                    button.disabled = false;
                    if (supported) {
                        button.title = 'Enter immersive VR mode';
                        // Auto-present: show tap-to-enter overlay immediately
                        showAutoOverlay();
                    } else {
                        button.style.opacity = '0.6';
                        button.title = 'VR not detected — click for setup instructions';
                    }
                }).catch(function () {
                    button.disabled = false;
                    button.style.opacity = '0.6';
                    button.title = 'VR not detected — click for setup instructions';
                });
            } else {
                button.disabled = false;
                button.style.opacity = '0.6';
                button.title = 'WebXR unavailable — click for setup instructions';
            }

            button.addEventListener('click', function () {
                if (currentSession) {
                    currentSession.end();
                    return;
                }
                if (vrSupported) {
                    // Supported: go straight into VR, no modal
                    startSession();
                } else {
                    // Not supported: show setup instructions
                    showVRInstructions(window.location.href, null);
                }
            });

            // Only apply floating styles when we created the element ourselves
            if (!existing) {
                button.id = 'vr-button';
                button.style.cssText = [
                    'position: fixed',
                    'bottom: 20px',
                    'left: 50%',
                    'transform: translateX(-50%)',
                    'padding: 10px 22px',
                    'border: 2px solid rgba(255,255,255,0.15)',
                    'border-radius: 6px',
                    'background: rgba(0,0,0,0.7)',
                    'color: rgba(255,255,255,0.7)',
                    'font-family: monospace',
                    'font-size: 13px',
                    'cursor: pointer',
                    'z-index: 9999',
                    'pointer-events: auto',
                ].join(';');
            }

            return button;
        }
    };

    if (typeof window !== 'undefined') {
        window.VRButton = VRButton;
    }
})();
